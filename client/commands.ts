import { VSCodeConfig } from "./VSCodeConfig";
import { execFile } from "node:child_process";
import * as os from "node:os";
import { env, version, window } from "vscode";

const commandPrefix = "oxc";

export const enum OxcCommands {
  // always available, even if no tool is active
  ShowOutputChannelLint = `${commandPrefix}.showOutputChannel`,
  ShowOutputChannelFmt = `${commandPrefix}.showOutputChannelFormatter`,

  // only for linter.ts usage
  RestartServerLint = `${commandPrefix}.restartServer`, // without `Linter` suffix for backward compatibility
  ToggleEnableLint = `${commandPrefix}.toggleEnable`, // without `Linter` suffix for backward compatibility
  ApplyAllFixesFile = `${commandPrefix}.applyAllFixesFile`,

  // only for formatter.ts usage
  RestartServerFmt = `${commandPrefix}.restartServerFormatter`,
  ToggleEnableFmt = `${commandPrefix}.toggleEnableFormatter`,

  // always available
  CopyDebugInfo = `${commandPrefix}.copyDebugInfo`,
}

export async function copyDebugCommand(
  extensionVersion: string,
  oxlintVersion: string,
  oxfmtVersion: string,
  vscodeConfig: VSCodeConfig,
) {
  const osName = getOsName();
  const nodeCommand = resolveNodeCommand(vscodeConfig.nodePath, vscodeConfig.useExecPath);
  const nodeVersion = await getNodeVersion(nodeCommand);

  const info = [
    "### Used Versions",
    "",
    "```",
    `VS Code extension: v${extensionVersion}`,
    `oxlint: v${oxlintVersion}`,
    `oxfmt: v${oxfmtVersion}`,
    `Editor: ${env.appName} v${version} (${env.appHost})`,
    `Operating System and Version: ${osName} (${os.arch()})`,
    `Node Version: ${nodeVersion} (${nodeCommand})`,
    "```",
  ].join("\n");

  await env.clipboard.writeText(info);
  window.showInformationMessage("Debug info copied to clipboard.");
}

function getNodeVersion(nodeCommand: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(nodeCommand, ["--version"], { timeout: 5000 }, (error, stdout) => {
      if (error) {
        resolve("unknown");
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

function getOsName(): string {
  switch (os.platform()) {
    case "darwin":
      return `macOS ${os.release()}`;
    case "win32":
      return `Windows ${os.release()}`;
    case "linux":
      return `Linux ${os.release()}`;
    default:
      return `${os.platform()} ${os.release()}`;
  }
}

function resolveNodeCommand(nodePath?: string, useExecPath?: boolean): string {
  if (useExecPath) {
    return process.execPath || nodePath || "node";
  }
  return nodePath || "node";
}
