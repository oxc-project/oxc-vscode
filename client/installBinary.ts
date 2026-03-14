import { promises as fs } from "node:fs";
import { join } from "node:path";

import { extract } from "tar";
import { LogOutputChannel, ProgressLocation, window } from "vscode";

import { replaceTargetFromMainToBin } from "./findBinary";

const versionFile = (storagePath: string, toolName: string) =>
  join(storagePath, `${toolName}.version`);

function getBindingPackage(toolName: string) {
  const { platform, arch } = process;
  const suffixes: Record<string, Record<string, string>> = {
    darwin: { arm64: "darwin-arm64", x64: "darwin-x64" },
    linux: { arm64: "linux-arm64-gnu", x64: "linux-x64-gnu", arm: "linux-arm-gnueabihf" },
    win32: { arm64: "win32-arm64-msvc", x64: "win32-x64-msvc", ia32: "win32-ia32-msvc" },
    freebsd: { x64: "freebsd-x64" },
  };
  const suffix = suffixes[platform]?.[arch];
  if (!suffix) throw new Error(`Unsupported platform: ${platform}-${arch}`);

  const scope = toolName === "oxlint" ? "@oxlint" : "@oxfmt";
  return `${scope}/binding-${suffix}`;
}

async function fetchNpmTarball(
  pkg: string,
  version = "latest",
): Promise<{ version: string; tarball: string }> {
  const res = await fetch(`https://registry.npmjs.org/${pkg}/${version}`);
  if (!res.ok) throw new Error(`npm registry returned ${res.status} for ${pkg}@${version}`);
  const data = (await res.json()) as { version: string; dist: { tarball: string } };
  return { version: data.version, tarball: data.dist.tarball };
}

async function downloadAndExtract(tarballUrl: string, destDir: string) {
  await fs.mkdir(destDir, { recursive: true });
  const tmp = join(destDir, ".tmp.tgz");

  const res = await fetch(tarballUrl);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  await fs.writeFile(tmp, Buffer.from(await res.arrayBuffer()));

  await extract({ file: tmp, cwd: destDir, strip: 1 });
  await fs.unlink(tmp);
}

/** Download a tool and its platform-specific binding from npm. */
async function install(
  storagePath: string,
  toolName: string,
  outputChannel: LogOutputChannel,
): Promise<string> {
  const bindingPkg = getBindingPackage(toolName);

  outputChannel.info(`Fetching latest ${toolName} version from npm...`);
  const mainInfo = await fetchNpmTarball(toolName);
  const bindingInfo = await fetchNpmTarball(bindingPkg, mainInfo.version);

  const nodeModules = join(storagePath, "node_modules");
  const mainDir = join(nodeModules, toolName);
  const bindingDir = join(nodeModules, ...bindingPkg.split("/"));

  outputChannel.info(`Downloading ${toolName}@${mainInfo.version}...`);
  await Promise.all([
    downloadAndExtract(mainInfo.tarball, mainDir),
    downloadAndExtract(bindingInfo.tarball, bindingDir),
  ]);
  await fs.writeFile(versionFile(storagePath, toolName), mainInfo.version);

  const binPath = replaceTargetFromMainToBin(
    require.resolve(toolName, { paths: [storagePath] }),
    toolName,
  );
  outputChannel.info(`Installed ${toolName}@${mainInfo.version} at ${binPath}`);

  return binPath;
}

/** Returns the path to a previously installed binary, or undefined. */
export function getDownloadedBinaryPath(storagePath: string, toolName: string) {
  try {
    return replaceTargetFromMainToBin(
      require.resolve(toolName, { paths: [storagePath] }),
      toolName,
    );
  } catch {
    return undefined;
  }
}

/** Prompt the user to download a missing tool. */
export async function promptDownloadBinary(
  storagePath: string,
  toolName: string,
  outputChannel: LogOutputChannel,
): Promise<string | undefined> {
  const confirm = await window.showInformationMessage(
    `${toolName} was not found. Would you like to download it?`,
    "Download",
    "Cancel",
  );
  if (confirm !== "Download") return undefined;

  try {
    const result = await window.withProgress(
      { location: ProgressLocation.Notification, title: `Downloading ${toolName}...` },
      () => install(storagePath, toolName, outputChannel),
    );
    window.showInformationMessage(`${toolName} installed!`);
    return result;
  } catch (e) {
    window.showErrorMessage(`Failed to install ${toolName}: ${e}`);
    return undefined;
  }
}

/** Check for a newer version and install it if available. */
export async function checkForUpdate(
  storagePath: string,
  toolName: string,
  outputChannel: LogOutputChannel,
) {
  const currentVersion = await fs
    .readFile(versionFile(storagePath, toolName), "utf-8")
    .catch(() => "");
  if (!currentVersion) return false;

  try {
    const { version: latest } = await fetchNpmTarball(toolName);
    if (latest === currentVersion) return false;

    outputChannel.info(`Updating ${toolName} to ${latest}...`);
    await install(storagePath, toolName, outputChannel);
    return true;
  } catch (e) {
    outputChannel.warn(`Update failed for ${toolName}: ${e}`);
    return false;
  }
}
