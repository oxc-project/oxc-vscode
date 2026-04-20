import { existsSync } from "node:fs";
import * as path from "node:path";
import { FileSystemWatcher, LogOutputChannel, RelativePattern, Uri, workspace } from "vscode";
import { clearWorkspacePackageJsonNodeModulesCache } from "../findBinary";
import type { BinarySearchResult } from "../findBinary";

/**
 * Glob pattern matching all known dependency lock files.
 */
const LOCK_FILE_GLOB = "{package-lock.json,yarn.lock,pnpm-lock.yaml,bun.lockb,bun.lock}";

/**
 * Lock file names in priority order, used when walking up the directory tree.
 */
const LOCK_FILE_NAMES = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
] as const;

/**
 * Watches for dependency changes so that tools are restarted automatically
 * after `npm install`, `pnpm install`, `yarn install`, or `bun install` —
 * without requiring a VS Code restart.
 *
 * **Project-local binaries** (no `watcherPath` set on `BinarySearchResult`):
 * Walks up from the resolved binary path to find the project root containing a
 * lock file and watches that directory. This correctly handles pnpm's versioned
 * store layout (`.pnpm/pkg@version/node_modules/…`) where updating a package
 * creates a brand-new directory instead of modifying the existing binary.
 * Falls back to all workspace folders when no binary is found yet (initial
 * install) or no lock file is found on the walk.
 *
 * **Global / settings-specified binaries** (`watcherPath` set on
 * `BinarySearchResult`): Watches that specific file for creation, change, and
 * deletion, since global installs have no project lock file.
 */
export class BinaryWatcher {
  private readonly watchers: FileSystemWatcher[] = [];

  constructor(
    binary: BinarySearchResult | undefined,
    binaryName: string,
    outputChannel: LogOutputChannel,
    onBinaryChanged: () => Promise<void>,
  ) {
    if (binary?.watcherPath) {
      // Global or settings-specified binary: watch the resolved binary file directly.
      const watcher = workspace.createFileSystemWatcher(
        new RelativePattern(
          Uri.file(path.dirname(binary.watcherPath)),
          path.basename(binary.watcherPath),
        ),
        false,
        false,
        false,
      );
      const fileHandler = async () => {
        outputChannel.info(`Binary "${binaryName}" changed, restarting tool...`);
        clearWorkspacePackageJsonNodeModulesCache();
        await onBinaryChanged();
      };
      watcher.onDidCreate(fileHandler);
      watcher.onDidChange(fileHandler);
      watcher.onDidDelete(fileHandler);
      this.watchers.push(watcher);
      return;
    }

    // Project-local binary (or no binary found yet): watch lock files.
    const watchDirs = resolveLockFileWatchDirectories(binary);
    for (const dir of watchDirs) {
      const watcher = workspace.createFileSystemWatcher(
        new RelativePattern(Uri.file(dir), LOCK_FILE_GLOB),
        false,
        false,
        false,
      );
      const lockHandler = async () => {
        outputChannel.info(`Dependency lock file changed, restarting "${binaryName}" tool...`);
        clearWorkspacePackageJsonNodeModulesCache();
        await onBinaryChanged();
      };
      watcher.onDidCreate(lockHandler);
      watcher.onDidChange(lockHandler);
      watcher.onDidDelete(lockHandler);
      this.watchers.push(watcher);
    }
  }

  dispose(): void {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
  }
}

/**
 * Returns the directories to watch for lock file changes.
 *
 * If a binary was resolved, walks up from its path to find the project root
 * (the first ancestor containing a lock file). Falls back to all workspace
 * folders when the binary is not found or no lock file exists on the walk.
 */
function resolveLockFileWatchDirectories(binary: BinarySearchResult | undefined): string[] {
  const workspaceFolderPaths = (workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);

  if (!binary) {
    return workspaceFolderPaths;
  }

  const projectRoot = findProjectRoot(binary.path);
  return projectRoot ? [projectRoot] : workspaceFolderPaths;
}

/**
 * Walk up from `binaryPath` and return the first ancestor directory that
 * contains a known lock file. Returns `undefined` if none is found.
 */
function findProjectRoot(binaryPath: string): string | undefined {
  let dir = path.dirname(binaryPath);
  const root = path.parse(dir).root;

  while (dir !== root) {
    for (const lockFile of LOCK_FILE_NAMES) {
      if (existsSync(path.join(dir, lockFile))) {
        return dir;
      }
    }
    dir = path.dirname(dir);
  }

  return undefined;
}

