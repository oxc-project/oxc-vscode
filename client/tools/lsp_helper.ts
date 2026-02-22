import { LogOutputChannel, window } from "vscode";
import { Executable, MessageType, ShowMessageParams } from "vscode-languageclient/node";

export function runExecutable(
  binaryPath: string,
  nodePath?: string,
  tsgolintPath?: string,
): Executable {
  // convert empty string to undefined to avoid prepending an empty path
  if (!nodePath) nodePath = undefined;

  const serverEnv: Record<string, string> = {
    ...process.env,
    RUST_LOG: process.env.RUST_LOG || "info", // Keep for backward compatibility for a while
    OXC_LOG: process.env.OXC_LOG || "info",
  };
  if (nodePath) {
    serverEnv.PATH = `${nodePath}${process.platform === "win32" ? ";" : ":"}${process.env.PATH ?? ""}`;
  }
  if (tsgolintPath) {
    serverEnv.OXLINT_TSGOLINT_PATH = tsgolintPath;
  }

  return {
    command: nodePath ?? "node",
    args: [binaryPath, "--lsp"],
    options: {
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
