import { execFile } from "node:child_process";
import * as os from "node:os";
import { env, type LogOutputChannel, version, window } from "vscode";
import type { BinarySearchResult } from "./findBinary";
import type { VSCodeConfig } from "./VSCodeConfig";

const _commandPrefix = "biome";

export enum BiomeCommands {
  ShowOutputChannelLint = "biome.showOutputChannel",
  RestartServerLint = "biome.restartServer",
  ToggleEnableLint = "biome.toggleEnable",
  ApplyAllFixesFile = "biome.applyAllFixesFile",
  CopyDebugInfo = "biome.copyDebugInfo",
  Rage = "biome.rage",
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
    "\\`\\`\\`\\`",
    `VS Code extension: v${extensionVersion}`,
    `biome: v${biomeVersion}`,
    `Editor: ${env.appName} v${version} (${env.appHost})`,
    `Operating System and Version: ${osName} (${os.release()})`,
    `Node Version: ${nodeVersion} (${nodeCommand})`,
    "\\`\\`\\`\\`",
  ].join("\n");

  await env.clipboard.writeText(info);
  window.showInformationMessage("Debug info copied to clipboard.");
}

/**
 * Executes 'biome rage' and prints the output to a channel.
 */
export async function rageCommand(
  binary: BinarySearchResult | undefined,
  outputChannel: LogOutputChannel,
  vscodeConfig: VSCodeConfig,
) {
  if (!binary) {
    window.showErrorMessage("Biome binary not found. Cannot run 'rage'.");
    return;
  }

  const nodeCommand = resolveNodeCommand(
    vscodeConfig.nodePath,
    vscodeConfig.useExecPath,
  );

  outputChannel.show();
  outputChannel.info("Running 'biome rage'...");

  const args = ["rage"];
  const options = {
    cwd: os.homedir(), // Or workspace root if possible
    env: { ...process.env },
  };

  execFile(binary.path, args, options, (error, stdout, stderr) => {
    if (error) {
      outputChannel.error(`'biome rage' failed: ${error.message}`);
      if (stderr) {
        outputChannel.error(stderr);
      }
      return;
    }
    outputChannel.info("--- Biome Rage Output ---");
    outputChannel.info(stdout);
    outputChannel.info("--- End of Output ---");
  });
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
