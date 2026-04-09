import { execFile } from "node:child_process";
import * as os from "node:os";
import { env, version, window } from "vscode";
import type { VSCodeConfig } from "./VSCodeConfig";

const _commandPrefix = "biome";

export enum BiomeCommands {
  ShowOutputChannelLint = "biome.showOutputChannel",
  RestartServerLint = "biome.restartServer",
  ToggleEnableLint = "biome.toggleEnable",
  ApplyAllFixesFile = "biome.applyAllFixesFile",
  CopyDebugInfo = "biome.copyDebugInfo",
}

export enum LspCommands {
  FixAll = "biome.fixAll",
}

export async function copyDebugCommand(
  extensionVersion: string,
  biomeVersion: string,
  vscodeConfig: VSCodeConfig,
) {
  const osName = getOsName();
  const nodeCommand = resolveNodeCommand(
    vscodeConfig.nodePath,
    vscodeConfig.useExecPath,
  );
  const nodeVersion = await getNodeVersion(nodeCommand);

  const info = [
    "### Used Versions",
    "",
    "```",
    `VS Code extension: v${extensionVersion}`,
    `biome: v${biomeVersion}`,
    `Editor: ${env.appName} v${version} (${env.appHost})`,
    `Operating System and Version: ${osName} (${os.release()})`,
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
      return "macOS";
    case "win32":
      return "Windows";
    case "linux":
      return "Linux";
    default:
      return os.platform();
  }
}

function resolveNodeCommand(nodePath?: string, useExecPath?: boolean): string {
  if (useExecPath) {
    return process.execPath || nodePath || "node";
  }
  return nodePath || "node";
}
