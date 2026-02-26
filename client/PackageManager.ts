import { readFileSync } from "node:fs";
import * as path from "node:path";
import { Uri, workspace } from "vscode";
import { globalNodeModulesPaths } from "./findBinary";

/**
 * Interface for a pluggable package source.
 * Different implementations can find packages from different locations
 * (e.g., node_modules, manual download, npm registry).
 */
export interface PackageSource {
  readonly sourceName: string;
  findPackageFolder(binaryName: string): Promise<string | undefined>;
}

/**
 * Walks up from a resolved file path to find the nearest directory containing a package.json.
 */
export function findPackageFolderFromResolvedPath(resolvedPath: string): string | undefined {
  let dir = path.dirname(resolvedPath);
  while (dir !== path.dirname(dir)) {
    try {
      readFileSync(path.join(dir, "package.json"), "utf8");
      return dir;
    } catch {
      dir = path.dirname(dir);
    }
  }
  return undefined;
}

/**
 * Searches the given node_modules paths for a package folder (directory containing package.json).
 */
export async function findPackageFolderInNodeModules(
  binaryName: string,
  nodeModulesPaths: string[],
): Promise<string | undefined> {
  for (const nodeModulesPath of nodeModulesPaths) {
    const packageFolder = path.join(nodeModulesPath, binaryName);
    try {
      await workspace.fs.stat(Uri.file(path.join(packageFolder, "package.json")));
      return packageFolder;
    } catch {}
  }
  return undefined;
}

/**
 * Reads the package.json in the given folder and resolves the binary path from its `bin` entry.
 */
export function getBinaryPathFromPackageFolder(packageFolder: string, binaryName: string): string {
  const rawContent = readFileSync(path.join(packageFolder, "package.json"), "utf8");
  const packageJson: { bin?: string | Record<string, string> } = JSON.parse(rawContent);
  const binEntry =
    typeof packageJson.bin === "string" ? packageJson.bin : packageJson.bin?.[binaryName];
  if (!binEntry) {
    throw new Error(`No bin entry for "${binaryName}" found in package.json`);
  }
  return path.resolve(packageFolder, binEntry);
}

/**
 * Copies a package folder into the extension's managed storage and returns the destination path.
 * Skips copying if the binary already exists in storage.
 */
export async function copyPackageToStorage(
  packageFolder: string,
  storageUri: Uri,
  binaryName: string,
): Promise<string> {
  const targetUri = Uri.joinPath(storageUri, "packages", binaryName);
  const targetExists = await workspace.fs.stat(targetUri).then(
    () => true,
    () => false,
  );
  if (!targetExists) {
    await workspace.fs.copy(Uri.file(packageFolder), targetUri, { overwrite: false });
  }
  return targetUri.fsPath;
}

/**
 * Finds packages in the project's node_modules directories.
 */
export class ProjectNodeModulesPackageSource implements PackageSource {
  readonly sourceName = "project-node-modules";

  async findPackageFolder(binaryName: string): Promise<string | undefined> {
    const workspacePaths = workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? [];

    // Try to resolve via require.resolve
    try {
      const resolvedMain = require.resolve(binaryName, { paths: workspacePaths });
      const folder = findPackageFolderFromResolvedPath(resolvedMain);
      if (folder) return folder;
    } catch {}

    // Fallback: search workspace node_modules directories directly
    const workspaceNodeModules = workspacePaths.map((p) => path.join(p, "node_modules"));
    return findPackageFolderInNodeModules(binaryName, workspaceNodeModules);
  }
}

/**
 * Finds packages in global node_modules directories (npm, pnpm, bun).
 */
export class GlobalNodeModulesPackageSource implements PackageSource {
  readonly sourceName = "global-node-modules";

  async findPackageFolder(binaryName: string): Promise<string | undefined> {
    const globalPaths = globalNodeModulesPaths();

    // Try to resolve via require.resolve
    try {
      const resolvedMain = require.resolve(binaryName, { paths: globalPaths });
      const folder = findPackageFolderFromResolvedPath(resolvedMain);
      if (folder) return folder;
    } catch {}

    // Fallback: search global node_modules directly
    return findPackageFolderInNodeModules(binaryName, globalPaths);
  }
}

/**
 * Manages binary packages for the extension.
 *
 * Discovers packages from pluggable sources, copies them into the extension's
 * managed storage, and returns stable binary paths from that storage.
 * This design allows future sources (e.g., manual download via a UI button)
 * to be added by implementing {@link PackageSource} and passing them during construction.
 */
export class PackageManager {
  constructor(
    private readonly storageUri: Uri,
    private readonly sources: PackageSource[],
  ) {}

  /**
   * Finds the package for the given binary name using the registered sources,
   * copies the package folder into extension storage, and returns the binary path
   * within that managed copy.
   *
   * Returns `undefined` if no source can locate the package.
   */
  async getManagedBinaryPath(binaryName: string): Promise<string | undefined> {
    const packageFolder = await this.findPackageFromSources(binaryName);
    if (!packageFolder) {
      return undefined;
    }

    const managedFolder = await copyPackageToStorage(packageFolder, this.storageUri, binaryName);
    return getBinaryPathFromPackageFolder(managedFolder, binaryName);
  }

  /**
   * Iterates through the registered sources in order and returns the folder
   * of the first source that can locate the package.
   */
  private async findPackageFromSources(binaryName: string): Promise<string | undefined> {
    for (const source of this.sources) {
      const folder = await source.findPackageFolder(binaryName);
      if (folder) {
        return folder;
      }
    }
    return undefined;
  }
}
