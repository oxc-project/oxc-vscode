import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { Uri, workspace } from "vscode";
import { validateSafeBinaryPath } from "./PathValidator";

/** @internal only used for testing */
export function replaceTargetFromMainToBin(resolvedPath: string, binaryName: string): string {
  // Walk up from the resolved main file to find the nearest package.json
  // and use its "bin" entry to get the actual binary path
  let dir = path.dirname(resolvedPath);
  while (dir !== path.dirname(dir)) {
    let rawContent: string;
    try {
      rawContent = readFileSync(path.join(dir, "package.json"), "utf8");
    } catch {
      dir = path.dirname(dir);
      continue;
    }
    // Found the package.json — stop walking up here
    const packageJson: { bin?: string | Record<string, string> } = JSON.parse(rawContent);
    const binEntry =
      typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.[binaryName];
    if (!binEntry) {
      throw new Error(`No bin entry for "${binaryName}" found in package.json`);
    }
    return path.resolve(dir, binEntry);
  }
  throw new Error(`Could not find package.json for "${binaryName}"`);
}

async function searchNodeModulesDefaultBinPath(
  binaryName: string,
  folders: string[],
): Promise<string | undefined> {
  const candidates = folders.flatMap((folder) => {
    const basePath = path.join(folder, ".bin", binaryName);
    return process.platform === "win32" ? [basePath, `${basePath}.exe`] : [basePath];
  });

  const exists = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        await workspace.fs.stat(Uri.file(candidate));
        return true;
      } catch {
        return false;
      }
    }),
  );

  const firstExistingCandidateIndex = exists.findIndex(Boolean);
  if (firstExistingCandidateIndex === -1) {
    return undefined;
  }

  return candidates[firstExistingCandidateIndex];
}
/**
 * Returns node_modules paths derived from all package.json files found in the workspace.
 * The result is cached after the first call to avoid repeated file system scans.
 */
let cachedWorkspacePackageJsonNodeModules: Promise<string[]> | undefined;
function getWorkspacePackageJsonNodeModules(): Promise<string[]> {
  if (!cachedWorkspacePackageJsonNodeModules) {
    cachedWorkspacePackageJsonNodeModules = Promise.resolve(
      workspace
        .findFiles("**/package.json", "**/node_modules/**")
        .then((uris) => uris.map((uri) => path.join(path.dirname(uri.fsPath), "node_modules"))),
    );
  }
  return cachedWorkspacePackageJsonNodeModules;
}

/** @internal only used for clearing test states */
export function clearWorkspacePackageJsonNodeModulesCache(): void {
  cachedWorkspacePackageJsonNodeModules = undefined;
}

/**
 * Search for the binary in all workspaces' node_modules/.bin directories.
 * If multiple workspaces contain the binary, the first one found is returned.
 */
export async function searchProjectNodeModulesBin(binaryName: string): Promise<string | undefined> {
  // try to resolve via require.resolve
  try {
    const resolvedPath = replaceTargetFromMainToBin(
      require.resolve(binaryName, {
        paths: workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [],
      }),
      binaryName,
    );
    return resolvedPath;
  } catch {}

  // fallback to direct binary lookup in workspace node_modules/.bin
  const workspaceNodeModules = (workspace.workspaceFolders ?? []).map((folder) =>
    path.join(folder.uri.fsPath, "node_modules"),
  );
  const result = await searchNodeModulesDefaultBinPath(binaryName, workspaceNodeModules);
  if (result) {
    return result;
  }

  // fallback to searching for package.json in workspace subfolders (monorepo support)
  const packageJsonNodeModules = await getWorkspacePackageJsonNodeModules();
  return searchNodeModulesDefaultBinPath(binaryName, packageJsonNodeModules);
}

/**
 * Search for the binary in global node_modules.
 * Returns undefined if not found.
 */
export async function searchGlobalNodeModulesBin(binaryName: string): Promise<string | undefined> {
  const globalPaths = globalNodeModulesPaths();
  // try to resolve via require.resolve
  try {
    const resolvedPath = replaceTargetFromMainToBin(
      require.resolve(binaryName, { paths: globalPaths }),
      binaryName,
    );
    return resolvedPath;
  } catch {}

  // fallback to direct binary lookup in global node_modules/.bin
  return searchNodeModulesDefaultBinPath(binaryName, globalPaths);
}

/**
 * Search for the binary based on user settings.
 * If the path is relative, it is resolved against the first workspace folder.
 * Returns undefined if no valid binary is found or the path is unsafe.
 */
export async function searchSettingsBin(settingsBinary: string): Promise<string | undefined> {
  if (!workspace.isTrusted) {
    return;
  }

  // validates the given path is safe to use
  if (!validateSafeBinaryPath(settingsBinary)) {
    return undefined;
  }

  if (!path.isAbsolute(settingsBinary)) {
    const cwd = workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) {
      return undefined;
    }
    // if the path is not absolute, resolve it to the first workspace folder
    settingsBinary = path.normalize(path.join(cwd, settingsBinary));
  }

  if (process.platform !== "win32" && settingsBinary.endsWith(".exe")) {
    // on non-Windows, remove `.exe` extension if present
    settingsBinary = settingsBinary.slice(0, -4);
  }

  try {
    await workspace.fs.stat(Uri.file(settingsBinary));
    return settingsBinary;
  } catch {}

  // on Windows, also check for `.exe` extension (bun uses `.exe` for its binaries)
  if (process.platform === "win32") {
    if (!settingsBinary.endsWith(".exe")) {
      settingsBinary += ".exe";
    }

    try {
      await workspace.fs.stat(Uri.file(settingsBinary));
      return settingsBinary;
    } catch {}
  }

  // no valid binary found
  return undefined;
}

// copied from: https://github.com/biomejs/biome-vscode/blob/ae9b6df2254d0ff8ee9d626554251600eb2ca118/src/locator.ts#L28-L49
function globalNodeModulesPaths(): string[] {
  const npmGlobalNodeModulesPath = safeSpawnSync("npm", ["root", "-g"]);
  const pnpmGlobalNodeModulesPath = safeSpawnSync("pnpm", ["root", "-g"]);
  const bunGlobalNodeModulesPath = path.resolve(homedir(), ".bun/install/global/node_modules");

  return [npmGlobalNodeModulesPath, pnpmGlobalNodeModulesPath, bunGlobalNodeModulesPath].filter(
    Boolean,
  ) as string[];
}

// only use this function with internal code, because it executes shell commands
// which could be a security risk if the command or args are user-controlled
const safeSpawnSync = (command: string, args: readonly string[] = []): string | undefined => {
  let output: string | undefined;

  try {
    const result = spawnSync(command, args, {
      shell: true,
      encoding: "utf8",
    });

    if (result.error || result.status !== 0) {
      output = undefined;
    } else {
      const trimmed = result.stdout.trim();
      output = trimmed ? trimmed : undefined;
    }
  } catch {
    output = undefined;
  }

  return output;
};
