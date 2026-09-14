import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { env } from "node:process";
import { Uri, workspace } from "vscode";
import { validateSafeBinaryPath } from "./PathValidator";
import { getShellEnv } from "./getShellEnv";

export type BinarySearchResult = {
  path: string;
  loader: "node" | "native";
  yarnPnpLoaderPath?: string; // only set if loader is 'node' and found via Yarn PnP
  vitePlus?: "lint" | "fmt";
  cwd?: string;
};

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

function binaryCandidates(folder: string, binaryName: string): string[] {
  const basePath = path.join(folder, binaryName);
  if (process.platform !== "win32") {
    return [basePath];
  }
  // Prefer Windows shims over the extensionless POSIX vp shim.
  if (binaryName === "vp") {
    return [`${basePath}.cmd`, `${basePath}.exe`, basePath];
  }
  return [basePath, `${basePath}.exe`];
}

async function searchNodeModulesDefaultBinPath(
  binaryName: string,
  folders: string[],
): Promise<BinarySearchResult | undefined> {
  const candidates = folders.flatMap((folder) =>
    binaryCandidates(path.join(folder, ".bin"), binaryName),
  );

  const binaries = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        await workspace.fs.stat(Uri.file(candidate));
        return { path: candidate, loader: "native" } as const;
      } catch {
        return undefined;
      }
    }),
  );

  return binaries.find(Boolean);
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
export async function searchProjectNodeModulesBin(
  binaryName: string,
): Promise<BinarySearchResult | undefined> {
  // try to find shared binary inside `node_modules/.bin` of each workspace folder
  // This is required, because the project can use `vite-plus`,
  // which has different environment variables for `oxlint` and `oxfmt`.
  // Example: It will skip the `vite.config.ts` search without `VP_VERSION` env variable.
  const workspaceNodeModules = (workspace.workspaceFolders ?? []).map((folder) =>
    path.join(folder.uri.fsPath, "node_modules"),
  );
  const result = await searchNodeModulesDefaultBinPath(binaryName, workspaceNodeModules);
  if (result) {
    return result;
  }

  // fallback to searching for package.json in workspace subfolders (monorepo support)
  const packageJsonNodeModules = await getWorkspacePackageJsonNodeModules();
  const result2 = await searchNodeModulesDefaultBinPath(binaryName, packageJsonNodeModules);
  if (result2) {
    return result2;
  }

  // fallback to direct binary lookup via require.resolve
  try {
    const resolvedPath = replaceTargetFromMainToBin(
      require.resolve(binaryName, {
        paths: workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [],
      }),
      binaryName,
    );
    return { path: resolvedPath, loader: "node" };
  } catch {}
}

interface PnpApi {
  resolveRequest(request: string, issuer: string): string | null;
}

function isPnpApi(value: unknown): value is PnpApi {
  return (
    typeof value === "object" &&
    value !== null &&
    "resolveRequest" in value &&
    typeof value.resolveRequest === "function"
  );
}

/**
 * Walk up from startDir to find and load a Yarn PnP API (.pnp.cjs or .pnp.js).
 * Returns the PnP API object and the absolute path to the loader file.
 *
 * SECURITY: This function executes JavaScript via require().
 * Callers MUST verify workspace.isTrusted before invoking.
 */
function findPnpApi(startDir: string): { api: PnpApi; loaderPath: string } | undefined {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    for (const name of [".pnp.cjs", ".pnp.js"]) {
      try {
        const pnpFilePath = path.join(dir, name);
        const loaded: unknown = require(pnpFilePath);
        if (isPnpApi(loaded)) {
          return { api: loaded, loaderPath: pnpFilePath };
        }
      } catch {
        // file doesn't exist or failed to load, try next
      }
    }
    dir = path.dirname(dir);
  }
  return undefined;
}

/**
 * Search for the binary using Yarn PnP resolution.
 * Loads .pnp.cjs/.pnp.js from the workspace (searching upward for monorepo support)
 * and uses pnpapi.resolveRequest() to locate the package.
 * Returns both the binary path and the PnP loader path (needed for --require injection).
 */
export async function searchYarnPnpBin(
  binaryName: string,
): Promise<BinarySearchResult | undefined> {
  if (!workspace.isTrusted) {
    return undefined;
  }

  const results = await Promise.all(
    (workspace.workspaceFolders ?? []).map(async (folder) => {
      const folderPath = folder.uri.fsPath;
      const pnpResult = findPnpApi(folderPath);
      if (!pnpResult) return undefined;
      try {
        const resolvedMain = pnpResult.api.resolveRequest(binaryName, folderPath + path.sep);
        if (!resolvedMain) return undefined;
        const binPath = replaceTargetFromMainToBin(resolvedMain, binaryName);
        await workspace.fs.stat(Uri.file(binPath));
        return { path: binPath, loader: "node", yarnPnpLoaderPath: pnpResult.loaderPath } as const;
      } catch {
        return undefined;
      }
    }),
  );

  return results.find(Boolean);
}

/**
 * Search for the binary in global node_modules.
 * Returns undefined if not found.
 */
export async function searchGlobalNodeModulesBin(
  binaryName: string,
  packageName = binaryName,
): Promise<BinarySearchResult | undefined> {
  const globalPaths = await globalNodeModulesPaths();

  // try to find shared binary inside `node_modules/.bin` of each workspace folder
  // This is required, because the project can use `vite-plus`,
  // which has different environment variables for `oxlint` and `oxfmt`.
  // Example: It will skip the `vite.config.ts` search without `VP_VERSION` env variable.
  const result = await searchNodeModulesDefaultBinPath(binaryName, globalPaths);
  if (result) {
    return result;
  }
  // A package's executable can have a different name (vite-plus provides vp).
  // Read only the global package directories, without resolving into a parent.
  if (packageName !== binaryName) {
    for (const globalPath of globalPaths) {
      try {
        const packageDir = path.join(globalPath, packageName);
        const pkg = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));
        const binEntry = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.[binaryName];
        if (pkg.name !== packageName || typeof binEntry !== "string") continue;
        const binPath = path.resolve(packageDir, binEntry);
        // oxlint-disable-next-line no-await-in-loop -- preserve global lookup priority
        await workspace.fs.stat(Uri.file(binPath));
        return { path: binPath, loader: "node" };
      } catch {}
    }
    return undefined;
  }
  // fallback to direct binary lookup via require.resolve
  try {
    const resolvedPath = replaceTargetFromMainToBin(
      require.resolve(binaryName, { paths: globalPaths }),
      binaryName,
    );
    return { path: resolvedPath, loader: "node" };
  } catch {}
}

/**
 * Search for the binary in the PATH.
 * Returns undefined if not found.
 */
export async function searchEnvPath(
  defaultBinaryName: string,
  environment: Record<string, string | undefined> = env,
): Promise<BinarySearchResult | undefined> {
  const envPath = environment.PATH;

  if (!envPath) {
    return undefined;
  }

  // Ignore empty PATH entries and preserve directory and executable priority.
  const candidates = envPath.split(path.delimiter).flatMap((folder) => {
    if (!folder) {
      return [];
    }
    return binaryCandidates(folder, defaultBinaryName);
  });

  const binary = await Promise.all(
    candidates.map(async (candidate) => {
      const candidateUri = Uri.file(candidate);
      try {
        await workspace.fs.stat(candidateUri);
        return { path: candidateUri.fsPath, loader: "native" } as const;
      } catch {
        return undefined;
      }
    }),
  );

  return binary.find(Boolean);
}

/**
 * Search for the binary based on user settings.
 * If the path is relative, it is resolved against the first workspace folder.
 * Returns undefined if no valid binary is found or the path is unsafe.
 */
export async function searchSettingsBin(
  defaultBinaryName: string,
  settingsBinary: string,
  cwd = workspace.workspaceFolders?.[0]?.uri.fsPath,
): Promise<BinarySearchResult | undefined> {
  if (!workspace.isTrusted) {
    return;
  }

  // validates the given path is safe to use
  if (!validateSafeBinaryPath(settingsBinary)) {
    return undefined;
  }

  if (!path.isAbsolute(settingsBinary)) {
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

  const isNode =
    settingsBinary.endsWith(".js") ||
    settingsBinary.endsWith(".cjs") ||
    settingsBinary.endsWith(".mjs") ||
    settingsBinary.endsWith(`${defaultBinaryName}${path.sep}bin${path.sep}${defaultBinaryName}`) ||
    (defaultBinaryName === "vp" && settingsBinary.endsWith(path.join("vite-plus", "bin", "vp")));

  // npm creates both a POSIX shim and a .cmd shim on Windows. Prefer the
  // latter when the configured vp path omits the extension.
  if (
    process.platform === "win32" &&
    defaultBinaryName === "vp" &&
    !isNode &&
    !path.extname(settingsBinary)
  ) {
    try {
      await workspace.fs.stat(Uri.file(`${settingsBinary}.cmd`));
      return { path: `${settingsBinary}.cmd`, loader: "native" };
    } catch {}
  }

  try {
    await workspace.fs.stat(Uri.file(settingsBinary));
    return { path: settingsBinary, loader: isNode ? "node" : "native" };
  } catch {}

  // on Windows, also check for `.exe` extension (bun uses `.exe` for its binaries)
  if (process.platform === "win32") {
    if (!settingsBinary.endsWith(".exe")) {
      settingsBinary += ".exe";
    }

    try {
      await workspace.fs.stat(Uri.file(settingsBinary));
      return { path: settingsBinary, loader: "native" };
    } catch {}
  }

  // no valid binary found
  return undefined;
}

let cachedGlobalNodeModulesPaths: Promise<string[]> | undefined;

/** Refresh package-manager locations on an explicit server restart. */
export function clearGlobalNodeModulesPathsCache(): void {
  cachedGlobalNodeModulesPaths = undefined;
}

function globalNodeModulesPaths(): Promise<string[]> {
  // Lint and format share the pending lookup and its result across navigation.
  // Only locations are cached; binary searches still check the filesystem.
  return (cachedGlobalNodeModulesPaths ??= resolveGlobalNodeModulesPaths());
}

// copied from: https://github.com/biomejs/biome-vscode/blob/ae9b6df2254d0ff8ee9d626554251600eb2ca118/src/locator.ts#L28-L49
async function resolveGlobalNodeModulesPaths(): Promise<string[]> {
  const npmGlobalNodeModulesPath = await safeSpawnSync("npm", ["root", "-g"]);
  const pnpmGlobalNodeModulesPath = await safeSpawnSync("pnpm", ["root", "-g"]);
  const bunGlobalNodeModulesPath = path.resolve(homedir(), ".bun/install/global/node_modules");

  return [npmGlobalNodeModulesPath, pnpmGlobalNodeModulesPath, bunGlobalNodeModulesPath].filter(
    Boolean,
  ) as string[];
}

// only use this function with internal code, because it executes shell commands
// which could be a security risk if the command or args are user-controlled
async function safeSpawnSync(
  command: string,
  args: readonly string[] = [],
): Promise<string | undefined> {
  try {
    const result = spawnSync(command, args, {
      shell: true,
      encoding: "utf8",
      env: await getShellEnv(),
    });

    if (result.error || result.status !== 0) {
      return undefined;
    }
    return result.stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}
