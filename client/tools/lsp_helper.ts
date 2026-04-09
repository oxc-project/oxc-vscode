import * as path from "node:path";
import { type LogOutputChannel, window } from "vscode";
import {
  type Executable,
  MessageType,
  type ShowMessageParams,
} from "vscode-languageclient/node";
import type { BinarySearchResult } from "../findBinary";

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
    BIOME_LOG: process.env.BIOME_LOG || "info",
    NO_COLOR: "1",
  };
  if (tsgolintPath) {
    serverEnv.BIOME_TSGOLINT_PATH = tsgolintPath;
  }
  if (suppressProgramErrors) {
    serverEnv.BIOME_TSGOLINT_DANGEROUSLY_SUPPRESS_PROGRAM_DIAGNOSTICS = "true";
  }
  // when the binary path ends with `biome/bin/biome` or a common js extension, we should run it with `node`
  // the path is defined in `ConfigService.searchNodeModulesBin`
  // Probably it would be better to read the shebang for unknown extensions, and run with `node` if the shebang contains `node`,
  // but for now we can just check for common node extensions and the known path for `biome`
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
  // --require .pnp.cjs: patches CJS resolution (e.g., biome's NAPI-RS bindings via createRequire)
  // --loader .pnp.loader.mjs: patches ESM resolution (e.g., biome's tinypool import)
  const pnpArgs: string[] = [];
  if (isNode && binary.yarnPnpLoaderPath) {
    pnpArgs.push("--require", binary.yarnPnpLoaderPath);
    const esmLoaderPath = path.join(
      path.dirname(binary.yarnPnpLoaderPath),
      ".pnp.loader.mjs",
    );
    pnpArgs.push("--loader", esmLoaderPath);
  }

  return isNode || useExecPath
    ? {
        command: nodeCommand,
        args: [...pnpArgs, binary.path, "lsp-proxy"],
        options: {
          env: serverEnv,
        },
      }
    : {
        // On Windows with shell, quote the command path to handle spaces in usernames/paths
        command: isWindows ? `"${binary.path}"` : binary.path,
        args: ["lsp-proxy"],
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

export function onClientNotification(
  params: ShowMessageParams,
  outputChannel: LogOutputChannel,
) {
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
