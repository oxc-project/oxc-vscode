import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { LogOutputChannel, window } from "vscode";
import { Executable, MessageType, ShowMessageParams } from "vscode-languageclient/node";
import type { BinarySearchResult } from "../findBinary";
import { getShellEnv } from "../getShellEnv";
import { resolveVitePlusNodeEntry } from "../resolveVitePlusNodeEntry";

export async function runExecutable(
  binary: BinarySearchResult,
  useExecPath: boolean = false,
  nodePath?: string,
  tsgolintPath?: string,
  suppressProgramErrors?: boolean,
): Promise<Executable> {
  if (binary.vitePlus && useExecPath && binary.loader === "native") {
    const nodeEntry = resolveVitePlusNodeEntry(binary.path);
    if (nodeEntry) {
      binary = { ...binary, path: nodeEntry, loader: "node" };
    }
  }
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

  const args = binary.vitePlus ? [binary.vitePlus, "--lsp"] : ["--lsp"];

  if (isNode || (useExecPath && !binary.vitePlus)) {
    const nodeArgs = [binary.path, ...args];
    // Yarn PnP needs loaders for both CJS require() and ESM imports.
    if (isNode && binary.yarnPnpLoaderPath) {
      const esmLoaderPath = path.join(path.dirname(binary.yarnPnpLoaderPath), ".pnp.loader.mjs");
      nodeArgs.unshift(
        "--require",
        binary.yarnPnpLoaderPath,
        "--loader",
        pathToFileURL(esmLoaderPath).href,
      );
    }

    return {
      command: nodeCommand,
      args: nodeArgs,
      options: {
        cwd: binary.cwd,
        env: serverEnv,
      },
    };
  }

  // Keep native vp binaries and unresolved shell shims out of the Node launch path.
  const isWindows = process.platform === "win32";
  return {
    // Windows package-manager shims need a shell; quote paths that can contain spaces.
    command: isWindows ? `"${binary.path}"` : binary.path,
    args,
    options: {
      cwd: binary.cwd,
      shell: isWindows,
      env: serverEnv,
    },
  };
}

export function onClientNotification(
  params: ShowMessageParams,
  outputChannel: LogOutputChannel,
): void {
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
