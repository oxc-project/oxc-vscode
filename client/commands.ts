import { execFile } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";
import {
  env,
  type LogOutputChannel,
  Uri,
  version,
  window,
  workspace,
} from "vscode";
import type { BinarySearchResult } from "./findBinary";
import type { VSCodeConfig } from "./VSCodeConfig";

const _commandPrefix = "biome";

export enum BiomeCommands {
  ShowOutput = "biome.showOutput",
  Restart = "biome.restart",
  ToggleEnabled = "biome.toggleEnabled",
  ApplyAllFixes = "biome.applyAllFixes",
  FormatProject = "biome.formatProject",
  FixProject = "biome.fixProject",
  FixProjectUnsafe = "biome.fixProjectUnsafe",
  OpenConfig = "biome.openConfig",
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
    "",
    `VS Code extension: v${extensionVersion}`,
    `biome: v${biomeVersion}`,
    `Editor: ${env.appName} v${version} (${env.appHost})`,
    `Operating System and Version: ${osName} (${os.release()})`,
    `Node Version: ${nodeVersion} (${nodeCommand})`,
    "",
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

/**
 * Generic function to run Biome command on the whole project.
 */
async function runBiomeOnProject(
  binary: BinarySearchResult | undefined,
  vscodeConfig: VSCodeConfig,
  biomeArgs: string[],
  commandLabel: string,
  successMessage: string,
) {
  if (!binary) {
    window.showErrorMessage(
      `Biome binary not found. Cannot ${commandLabel.toLowerCase()}.`,
    );
    return;
  }

  const activeEditor = window.activeTextEditor;
  const workspaceFolder = activeEditor
    ? workspace.getWorkspaceFolder(activeEditor.document.uri)
    : workspace.workspaceFolders?.[0];

  if (!workspaceFolder) {
    window.showErrorMessage(
      `No workspace folder found to ${commandLabel.toLowerCase()}.`,
    );
    return;
  }

  const isWindows = os.platform() === "win32";
  const isNode = binary.loader === "node";
  const nodeCommand = resolveNodeCommand(
    vscodeConfig.nodePath,
    vscodeConfig.useExecPath,
  );

  const serverEnv: Record<string, string> = {
    ...process.env,
    NO_COLOR: "1",
  };

  if (vscodeConfig.useExecPath) {
    serverEnv.ELECTRON_RUN_AS_NODE = "1";
  } else {
    delete serverEnv.ELECTRON_RUN_AS_NODE;
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
    args = [...pnpArgs, binary.path, ...biomeArgs];
  } else {
    command = isWindows ? `"${binary.path}"` : binary.path;
    args = [...biomeArgs];
    shell = isWindows;
  }

  const options = {
    cwd: workspaceFolder.uri.fsPath,
    env: serverEnv,
    shell,
  };

  execFile(command, args, options, (error) => {
    if (error) {
      // It failed, so let's run it in a terminal for the user to see
      const terminal = window.createTerminal({
        name: `Biome ${commandLabel}`,
        cwd: workspaceFolder.uri.fsPath,
        env: serverEnv,
      });

      let terminalCommand: string;
      if (isNode || vscodeConfig.useExecPath) {
        terminalCommand = `${nodeCommand} ${pnpArgs.join(" ")} "${binary.path}" ${biomeArgs.join(" ")}`;
      } else {
        terminalCommand = `${isWindows ? `"${binary.path}"` : binary.path} ${biomeArgs.join(" ")}`;
      }

      terminal.show();
      terminal.sendText(terminalCommand);
      return;
    }
    window.showInformationMessage(successMessage);
  });
}

/**
 * Executes 'biome format --write .' in the active workspace.
 */
export async function formatProjectCommand(
  binary: BinarySearchResult | undefined,
  vscodeConfig: VSCodeConfig,
) {
  await runBiomeOnProject(
    binary,
    vscodeConfig,
    ["format", "--write", "."],
    "Format Project",
    "Project formatted successfully.",
  );
}

/**
 * Executes 'biome check --write .' in the active workspace.
 */
export async function fixProjectCommand(
  binary: BinarySearchResult | undefined,
  vscodeConfig: VSCodeConfig,
) {
  await runBiomeOnProject(
    binary,
    vscodeConfig,
    ["check", "--write", "."],
    "Fix Project",
    "Project fixed successfully.",
  );
}

/**
 * Executes 'biome check --write --unsafe .' in the active workspace.
 */
export async function fixProjectUnsafeCommand(
  binary: BinarySearchResult | undefined,
  vscodeConfig: VSCodeConfig,
) {
  await runBiomeOnProject(
    binary,
    vscodeConfig,
    ["check", "--write", "--unsafe", "."],
    "Fix Project (Unsafe)",
    "Project fixed (with unsafe fixes) successfully.",
  );
}

/**
 * Opens the Biome configuration file relevant to the active editor.
 */
export async function openConfigCommand() {
  const activeEditor = window.activeTextEditor;
  const workspaceFolder = activeEditor
    ? workspace.getWorkspaceFolder(activeEditor.document.uri)
    : workspace.workspaceFolders?.[0];

  if (!workspaceFolder) {
    window.showErrorMessage("No workspace folder found.");
    return;
  }

  // Look for biome configuration files in the current folder or above
  const configFiles = [
    "biome.json",
    "biome.jsonc",
    ".biome.json",
    ".biome.jsonc",
  ];

  let currentPath = activeEditor
    ? path.dirname(activeEditor.document.uri.fsPath)
    : workspaceFolder.uri.fsPath;

  const workspaceRoot = workspaceFolder.uri.fsPath;

  while (currentPath.startsWith(workspaceRoot)) {
    for (const configFile of configFiles) {
      const configUri = Uri.file(path.join(currentPath, configFile));
      try {
        await workspace.fs.stat(configUri);
        const doc = await workspace.openTextDocument(configUri);
        await window.showTextDocument(doc);
        return;
      } catch {
        // Continue
      }
    }
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) break;
    currentPath = parentPath;
  }

  window.showErrorMessage("Biome configuration file not found.");
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
