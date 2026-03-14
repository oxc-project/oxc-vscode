import { promises as fs } from "node:fs";
import { join } from "node:path";

import { commands, LogOutputChannel, ProgressLocation, window } from "vscode";

import * as AdmZip from "adm-zip";
import * as tar from "tar";

type ToolName = "oxlint" | "oxfmt";

const GITHUB_REPO = "oxc-project/oxc";

/** Map Node.js platform/arch to the Rust target triple used in release asset names. */
function getTarget(): { triple: string; ext: ".tar.gz" | ".zip" } {
  const archMap: Record<string, string> = {
    x64: "x86_64",
    arm64: "aarch64",
    arm: "armv7",
  };

  const rustArch = archMap[process.arch];
  if (!rustArch) throw new Error(`Unsupported architecture: ${process.arch}`);

  switch (process.platform) {
    case "darwin":
      return { triple: `${rustArch}-apple-darwin`, ext: ".tar.gz" };
    case "linux":
      return { triple: `${rustArch}-unknown-linux-gnu`, ext: ".tar.gz" };
    case "win32":
      return { triple: `${rustArch}-pc-windows-msvc`, ext: ".zip" };
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

/** Resolved path where the downloaded binary is stored. */
function binaryPath(storagePath: string, toolName: ToolName): string {
  const name = process.platform === "win32" ? `${toolName}.exe` : toolName;
  return join(storagePath, name);
}

/** Returns the path to a previously downloaded binary, or undefined if not found. */
export async function getDownloadedBinaryPath(
  storagePath: string,
  toolName: ToolName,
  outputChannel: LogOutputChannel,
): Promise<string | undefined> {
  const path = binaryPath(storagePath, toolName);
  try {
    await fs.access(path);
    outputChannel.info(`Found downloaded ${toolName} binary at: ${path}`);
    return path;
  } catch {
    return undefined;
  }
}

/** Fetch the latest version from the most recent `apps_v*` GitHub release. */
async function fetchLatestVersion(): Promise<string> {
  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=20`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);

  const releases = (await response.json()) as { tag_name: string }[];
  const release = releases.find((r) => r.tag_name.startsWith("apps_v"));
  if (!release) throw new Error("No apps release found");

  return release.tag_name.replace("apps_v", "");
}

/** Download a tool binary from a GitHub release and extract it into storagePath. */
async function downloadAndExtract(
  storagePath: string,
  toolName: ToolName,
  version: string,
  outputChannel: LogOutputChannel,
): Promise<string> {
  const { triple, ext } = getTarget();
  const assetName = `${toolName}-${triple}${ext}`;
  const url = `https://github.com/${GITHUB_REPO}/releases/download/apps_v${version}/${assetName}`;

  outputChannel.info(`Downloading ${toolName} v${version} from ${url}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed with status ${response.status}`);
  const buffer = await response.arrayBuffer();

  await fs.mkdir(storagePath, { recursive: true });
  // Save the archive to disk, extract, then clean up.
  const archivePath = join(storagePath, assetName);
  await fs.writeFile(archivePath, Buffer.from(buffer));

  if (ext === ".zip") new AdmZip(archivePath).extractAllTo(storagePath, true);
  else await tar.extract({ file: archivePath, cwd: storagePath });
  await fs.unlink(archivePath);

  // The extracted binary is named with the full target triple (e.g. "oxlint-x86_64-apple-darwin").
  // Rename it to a consistent name so getBinary can find it later.
  const extractedName = `${toolName}-${triple}${process.platform === "win32" ? ".exe" : ""}`;
  const finalPath = binaryPath(storagePath, toolName);
  await fs.rename(join(storagePath, extractedName), finalPath);
  // Ensure the binary is executable on Unix.
  if (process.platform !== "win32") await fs.chmod(finalPath, 0o755);

  // Persist version for future update checks.
  await fs.writeFile(join(storagePath, "version"), version);
  outputChannel.info(`Installed ${toolName} v${version} at ${finalPath}`);

  return finalPath;
}

/** Prompt the user to download a missing binary, showing progress and offering reload on success. */
export async function promptDownloadBinary(
  storagePath: string,
  toolName: ToolName,
  outputChannel: LogOutputChannel,
): Promise<string | undefined> {
  const choice = await window.showInformationMessage(
    `${toolName} was not found. Would you like to download it?`,
    "Download",
    "Cancel",
  );

  if (choice !== "Download") return undefined;

  try {
    const result = await window.withProgress(
      { location: ProgressLocation.Notification, title: `Downloading ${toolName}...` },
      async () => {
        const version = await fetchLatestVersion();
        return downloadAndExtract(storagePath, toolName, version, outputChannel);
      },
    );

    promptReload(`${toolName} has been downloaded. Reload to activate.`);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    outputChannel.error(`Failed to download ${toolName}: ${msg}`);
    window.showErrorMessage(`Failed to download ${toolName}: ${msg}`);
    return undefined;
  }
}

/** Ask the user to reload the window. */
function promptReload(message: string) {
  window.showInformationMessage(message, "Reload").then((action) => {
    if (action === "Reload") commands.executeCommand("workbench.action.reloadWindow");
  });
}

/** Check for a newer version and download it if available. Returns true if updated. */
export async function checkForUpdate(
  storagePath: string,
  toolName: ToolName,
  outputChannel: LogOutputChannel,
): Promise<boolean> {
  try {
    const versionFile = join(storagePath, "version");
    const currentVersion = await fs.readFile(versionFile, "utf-8").catch(() => "");

    const version = await fetchLatestVersion();
    if (version === currentVersion) return false;

    outputChannel.info(`Updating ${toolName} from ${currentVersion || "unknown"} to ${version}`);
    await downloadAndExtract(storagePath, toolName, version, outputChannel);
    promptReload(`${toolName} has been updated to v${version}. Reload to apply.`);
    return true;
  } catch (e) {
    outputChannel.error(
      `Update check failed for ${toolName}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
}
