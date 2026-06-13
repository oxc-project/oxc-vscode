import { readFileSync } from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { LogOutputChannel, window } from "vscode";
import { Executable, MessageType, ShowMessageParams } from "vscode-languageclient/node";
import type { BinarySearchResult } from "../findBinary";
import { getShellEnv } from "../getShellEnv";

export async function runExecutable(
  binary: BinarySearchResult,
  useExecPath: boolean = false,
  nodePath?: string,
  tsgolintPath?: string,
  suppressProgramErrors?: boolean,
): Promise<Executable> {
  const shellEnv = await getShellEnv();

  const serverEnv: Record<string, string> = {
    ...shellEnv,
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

  if (path.isAbsolute(nodeCommand)) {
    const nodeDir = path.dirname(nodeCommand);
    serverEnv.PATH = `${nodeDir}${path.delimiter}${serverEnv.PATH ?? ""}`;
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
    pnpArgs.push("--loader", pathToFileURL(esmLoaderPath).href);
  }

  // On Windows, .cmd files (npm/pnpm/yarn bin wrappers) are shell scripts that
  // invoke `node <actual-script>`. When VS Code is launched from the GUI, node
  // managers like fnm/nvm/Volta are not in PATH, so the shell execution fails.
  // Instead, we parse the .cmd file to extract the actual target script, then
  // use VS Code's own embedded Node.js (process.execPath) to run it directly.
  // This approach works on every Windows machine regardless of node manager.
  if (isWindows && binary.path.toLowerCase().endsWith(".cmd")) {
    const target = resolveCmdTarget(binary.path);
    if (target) {
      return {
        command: process.execPath,
        args: [target, "--lsp"],
        options: {
          env: { ...serverEnv, ELECTRON_RUN_AS_NODE: "1" },
        },
      };
    }
    // If parsing fails, fall through to shell execution below
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

/**
 * Parse a Windows .cmd wrapper script (from node_modules/.bin/) to extract
 * the actual target script path. .cmd files follow a standard format generated
 * by npm/pnpm/yarn:
 *
 *   node  "%~dp0\..\<pkg>\bin\<script>" %*
 *
 * "%~dp0" resolves to the directory of the .cmd file itself.
 */
function resolveCmdTarget(cmdPath: string): string | undefined {
  try {
    const content = readFileSync(cmdPath, "utf8");
    const cmdDir = path.dirname(cmdPath);

    // Find the execution line: node followed by a quoted path
    // Handles both: node  "%~dp0\..\foo" %*  and  node  "..\foo" %*
    const match = content.match(/node\s+"([^"]+)"/);
    if (!match) return undefined;

    // Replace %~dp0 with the actual directory of the .cmd file
    const resolved = match[1].replace(/%~dp0/g, cmdDir);
    return path.resolve(resolved);
  } catch {
    return undefined;
  }
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
