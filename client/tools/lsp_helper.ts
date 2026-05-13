import * as path from "node:path";
import { LogOutputChannel, window } from "vscode";
import { Executable, MessageType, ShowMessageParams } from "vscode-languageclient/node";
import type { BinarySearchResult } from "../findBinary";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let cachedEnv: Record<string, string> | undefined;

/***
 * Get the shell environment variables by running a login shell and executing `env -0`.
 * This is necessary because the VSCode extension host process may not have the same environment variables as the user's shell,
 * which can lead to issues when running the language server that rely on certain environment variables.
 * e.g., PATH for starting the wrapper npm/pnpm node script like ` exec node  "$basedir/../oxlint/bin/oxlint" "$@"`.
 *
 * Mac/Linux GUI shells (which does happen in VS Code context, because of Electron) do not load `.bashrc` or `.zshrc` for non-interactive shells,
 * and thus the language server fails to start with "command not found: node".
 */
export async function getShellEnv(): Promise<Record<string, string>> {
  if (cachedEnv) {
    return cachedEnv;
  }

  const shell = process.env.SHELL ?? "/bin/bash";

  // POSIX shells
  if (process.platform == "win32") {
    // windows electron app does not have the problem of individual shell environment, as it inherits the environment from the parent process,
    cachedEnv = { ...process.env } as Record<string, string>;
    return cachedEnv;
  }
  // Run the shell as a login shell to get the environment variables. The `-i` flag is for interactive shell, which is needed to load the shell configuration files.
  // The `-l` flag is for login shell, which is needed to load the environment variables defined in the shell configuration files.
  const { stdout } = await execFileAsync(shell, ["-ilc", "env -0"], {
    env: {
      HOME: process.env.HOME,
    },
  });

  cachedEnv = {};

  for (const entry of stdout.split("\0")) {
    if (!entry) continue;

    const i = entry.indexOf("=");

    if (i === -1) continue;

    cachedEnv[entry.slice(0, i)] = entry.slice(i + 1);
  }

  return cachedEnv;
}

export async function runExecutable(
  binary: BinarySearchResult,
  useExecPath: boolean = false,
  nodePath?: string,
  tsgolintPath?: string,
  suppressProgramErrors?: boolean,
): Promise<Executable> {
  const processEnv = process.env;
  const shellEnv = await getShellEnv();

  // only for debugging purpose
  {
    if (Object.keys(processEnv).length !== Object.keys(shellEnv).length) {
      const missingInProcessEnv = Object.keys(shellEnv).filter((key) => !(key in processEnv));
      const missingInShellEnv = Object.keys(processEnv).filter((key) => !(key in shellEnv));

      console.warn("Process env and shell env have different number of keys", {
        missingInProcessEnv,
        missingInShellEnv,
      });
    }

    if (processEnv.PATH !== shellEnv.PATH) {
      const processEnvPATH = processEnv.PATH?.split(path.delimiter) ?? [];
      const shellEnvPATH = shellEnv.PATH?.split(path.delimiter) ?? [];
      const missingInProcessEnvPATH = shellEnvPATH.filter((p) => !processEnvPATH.includes(p));
      const missingInShellEnvPATH = processEnvPATH.filter((p) => !shellEnvPATH.includes(p));

      console.warn("Process env and shell env have different PATH values", {
        missingInProcessEnvPATH,
        missingInShellEnvPATH,
      });
    }
  }

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
