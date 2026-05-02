import { execFile } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import { env, type LogOutputChannel, version, window, workspace } from "vscode";
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
    "````",
    `VS Code extension: v${extensionVersion}`,
    `biome: v${biomeVersion}`,
    `Editor: ${env.appName} v${version} (${env.appHost})`,
    `Operating System and Version: ${osName} (${os.release()})`,
    `Node Version: ${nodeVersion} (${nodeCommand})`,
    "````",
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

  const isWindows = os.platform() === "win32";
  const isNode = binary.loader === "node";
  const nodeCommand = resolveNodeCommand(
    vscodeConfig.nodePath,
    vscodeConfig.useExecPath,
  );

  outputChannel.show();
  outputChannel.info("Running 'biome rage'...");

  const serverEnv: Record<string, string> = {
    ...process.env,
    RUST_LOG: process.env.RUST_LOG || "info",
    BIOME_LOG: process.env.BIOME_LOG || "info",
    NO_COLOR: "1",
  };

  if (vscodeConfig.useExecPath) {
    serverEnv.ELECTRON_RUN_AS_NODE = "1";
  } else {
    delete serverEnv.ELECTRON_RUN_AS_NODE;
  }

  if (path.isAbsolute(nodeCommand)) {
    const nodeDir = path.dirname(nodeCommand);
    serverEnv.PATH = `${nodeDir}${isWindows ? ";" : ":"}${process.env.PATH ?? ""}`;
  }

  const pnpArgs: string[] = [];
  if (isNode && binary.yarnPnpLoaderPath) {
    pnpArgs.push("--require", binary.yarnPnpLoaderPath);
    const esmLoaderPath = path.join(
      path.dirname(binary.yarnPnpLoaderPath),
      ".pnp.loader.mjs",
    );
    pnpArgs.push("--loader", esmLoaderPath);
  }

  let command: string;
  let args: string[];
  let shell = false;

  if (isNode || vscodeConfig.useExecPath) {
    command = nodeCommand;
    args = [...pnpArgs, binary.path, "rage"];
  } else {
    command = isWindows ? `"${binary.path}"` : binary.path;
    args = ["rage"];
    shell = isWindows;
  }

  const options = {
    cwd: workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir(),
    env: serverEnv,
    shell,
  };

  execFile(command, args, options, (error, stdout, stderr) => {
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
