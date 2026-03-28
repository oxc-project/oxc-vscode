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
 * Watches dependency lock files for changes so that tools are restarted
 * automatically after `npm install`, `pnpm install`, `yarn install`, or
 * `bun install` — without requiring a VS Code restart.
 *
 * When a binary was found, the watcher walks up from the resolved binary path
 * to locate the project root (the first ancestor directory that contains a
 * lock file). This correctly handles pnpm's versioned store layout
 * (`.pnpm/pkg@version/node_modules/…`) where the binary itself is replaced by
 * a file in a brand-new directory on update, making direct binary watching
 * unreliable.
 *
 * When no binary was found yet, every workspace folder is watched so that an
 * initial installation is detected too.
 *
 * On any lock file creation, change, or deletion the callback is invoked and
 * the tool restarts with a freshly resolved binary path.
 */
export class BinaryWatcher {
  private readonly watchers: FileSystemWatcher[] = [];

  constructor(
    binary: BinarySearchResult | undefined,
    binaryName: string,
    outputChannel: LogOutputChannel,
    onBinaryChanged: () => Promise<void>,
  ) {
    const watchDirs = resolveWatchDirectories(binary);

    const handler = async () => {
      outputChannel.info(`Dependency lock file changed, restarting "${binaryName}" tool...`);
      clearWorkspacePackageJsonNodeModulesCache();
      await onBinaryChanged();
    };

    for (const dir of watchDirs) {
      const watcher = workspace.createFileSystemWatcher(
        new RelativePattern(Uri.file(dir), LOCK_FILE_GLOB),
        false,
        false,
        false,
      );
      watcher.onDidCreate(handler);
      watcher.onDidChange(handler);
      watcher.onDidDelete(handler);
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
function resolveWatchDirectories(binary: BinarySearchResult | undefined): string[] {
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

