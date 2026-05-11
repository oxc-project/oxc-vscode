import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { LogOutputChannel, window } from "vscode";
import { Executable, MessageType, ShowMessageParams } from "vscode-languageclient/node";
import type { BinarySearchResult } from "../findBinary";

// Cache for resolved node paths to avoid multiple expensive lookups
const nodePathCache = new Map<string, string>();
// Use SharedArrayBuffer with Atomics for proper synchronous locking
// to prevent duplicate resolutions when called concurrently
const lockBuffer = new SharedArrayBuffer(4);
const lockArray = new Int32Array(lockBuffer);
const LOCK_INDEX = 0;

/**
 * Resolves the node command to its absolute path.
 * This is necessary when VSCode is launched from a GUI (e.g., start menu)
 * where the PATH environment is not fully inherited from the shell.
 * The result is cached per command to avoid multiple expensive lookups.
 * Uses Atomics to ensure only one resolution happens even when called concurrently.
 * @param nodeCommand - The node command to resolve (e.g., "node")
 * @returns The absolute path to node, or the original command if resolution fails
 */
function resolveNodePath(nodeCommand: string): string {
  // Check cache first
  const cached = nodePathCache.get(nodeCommand);
  if (cached !== undefined) {
    return cached;
  }

  // Acquire lock using atomic compare-and-swap
  // If another thread is resolving, wait for it to finish
  while (Atomics.compareExchange(lockArray, LOCK_INDEX, 0, 1) !== 0) {
    // Check cache again in case another thread just finished
    const nowCached = nodePathCache.get(nodeCommand);
    if (nowCached !== undefined) {
      return nowCached;
    }
    // Wait briefly before retrying (Atomics.wait would block the main thread completely)
    // Since Node.js is single-threaded for JS, this is mostly for async boundary protection
    const start = Date.now();
    while (Date.now() - start < 10) {
      // Tiny busy wait
    }
  }

  try {
    // Double-check cache after acquiring lock
    const cached = nodePathCache.get(nodeCommand);
    if (cached !== undefined) {
      return cached;
    }

    let resolvedPath: string;

    // If already absolute, use as is
    if (path.isAbsolute(nodeCommand)) {
      resolvedPath = nodeCommand;
    } else {
      // Try to resolve node using 'which' on Unix or 'where' on Windows
      const whichCommand = process.platform === "win32" ? "where" : "which";
      try {
        const result = spawnSync(whichCommand, [nodeCommand], {
          encoding: "utf8",
          timeout: 5000,
        });

        if (result.status === 0 && result.stdout) {
          // Get the first line (in case multiple paths are returned)
          const firstPath = result.stdout.trim().split("\n")[0];
          resolvedPath = firstPath || nodeCommand;
        } else {
          resolvedPath = nodeCommand;
        }
      } catch {
        // If resolution fails, fall back to the original command
        resolvedPath = nodeCommand;
      }
    }

    // Cache the result
    nodePathCache.set(nodeCommand, resolvedPath);
    return resolvedPath;
  } finally {
    // Release lock
    Atomics.store(lockArray, LOCK_INDEX, 0);
  }
}

export function runExecutable(
  binary: BinarySearchResult,
  useExecPath: boolean = false,
  nodePath?: string,
  tsgolintPath?: string,
  suppressProgramErrors?: boolean,
): Executable {
  const serverEnv: Record<string, string> = {
    ...process.env,
    RUST_LOG: process.env.RUST_LOG || "info", // Keep for backward compatibility for a while
    OXC_LOG: process.env.OXC_LOG || "info",
    NO_COLOR: "1",
  };
  if (tsgolintPath) {
    serverEnv.OXLINT_TSGOLINT_PATH = tsgolintPath;
  }
  if (suppressProgramErrors) {
    serverEnv.OXLINT_TSGOLINT_DANGEROUSLY_SUPPRESS_PROGRAM_DIAGNOSTICS = "true";
  }
  // when the binary path ends with `oxlint/bin/oxlint` or a common js extension, we should run it with `node`
  // the path is defined in `ConfigService.searchNodeModulesBin`
  // Probably it would be better to read the shebang for unknown extensions, and run with `node` if the shebang contains `node`,
  // but for now we can just check for common node extensions and the known path for `oxlint`
  const isNode = binary.loader === "node";

  let nodeCommand: string;
  if (useExecPath) {
    nodeCommand = process.execPath || nodePath || "node";
    serverEnv.ELECTRON_RUN_AS_NODE = "1";
  } else {
    nodeCommand = nodePath || "node";
    delete serverEnv.ELECTRON_RUN_AS_NODE;
  }

  // Resolve node to its absolute path to ensure the node directory is in PATH
  // This is critical when VSCode is launched from a GUI where PATH is not inherited
  nodeCommand = resolveNodePath(nodeCommand);

  if (path.isAbsolute(nodeCommand)) {
    const nodeDir = path.dirname(nodeCommand);
    serverEnv.PATH = `${nodeDir}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`;
  }

  const isWindows = process.platform === "win32";

  // In Yarn PnP environments, inject the PnP loaders so that both CJS require()
  // and ESM import calls can resolve dependencies through PnP.
  // --require .pnp.cjs: patches CJS resolution (e.g., oxlint's NAPI-RS bindings via createRequire)
  // --loader .pnp.loader.mjs: patches ESM resolution (e.g., oxfmt's tinypool import)
  const pnpArgs: string[] = [];
  if (isNode && binary.yarnPnpLoaderPath) {
    pnpArgs.push("--require", binary.yarnPnpLoaderPath);
    const esmLoaderPath = path.join(path.dirname(binary.yarnPnpLoaderPath), ".pnp.loader.mjs");
    pnpArgs.push("--loader", esmLoaderPath);
  }

  return isNode || useExecPath
    ? {
        command: nodeCommand,
        args: [...pnpArgs, binary.path, "--lsp"],
        options: {
          env: serverEnv,
        },
      }
    : {
        // On Windows with shell, quote the command path to handle spaces in usernames/paths
        command: isWindows ? `"${binary.path}"` : binary.path,
        args: ["--lsp"],
        options: {
          // On Windows we need to run the binary in a shell to be able to execute the shell npm bin script.
          // Searching for the right `.exe` file inside `node_modules/` is not reliable as it depends on
          // the package manager used (npm, yarn, pnpm, etc) and the package version.
          // The npm bin script is a shell script that points to the actual binary.
          // Security: We validated the user defined binary path in `configService.searchBinaryPath()`.
          shell: isWindows,
          env: serverEnv,
        },
      };
}

export function onClientNotification(params: ShowMessageParams, outputChannel: LogOutputChannel) {
  switch (params.type) {
    case MessageType.Debug:
      outputChannel.debug(params.message);
      break;
    case MessageType.Log:
      outputChannel.info(params.message);
      break;
    case MessageType.Info:
      window.showInformationMessage(params.message);
      break;
    case MessageType.Warning:
      window.showWarningMessage(params.message);
      break;
    case MessageType.Error:
      window.showErrorMessage(params.message);
      break;
    default:
      outputChannel.info(params.message);
  }
}
