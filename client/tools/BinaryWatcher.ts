import * as path from "node:path";
import { FileSystemWatcher, LogOutputChannel, RelativePattern, Uri, workspace } from "vscode";
import { clearWorkspacePackageJsonNodeModulesCache } from "../findBinary";
import type { BinarySearchResult } from "../findBinary";

/**
 * Watches a single binary file for creation and deletion.
 * The watched path is taken from the `findBinary` result so the watcher
 * targets exactly the file the extension is using. When no binary was found
 * the watcher falls back to the default installation location inside the
 * first workspace folder.
 *
 * When the binary appears (e.g. after `npm install`) or disappears (e.g.
 * after `npm uninstall`), the registered callback is invoked so the tool
 * can be restarted and the extension UI is kept in sync without requiring
 * a VS Code restart.
 */
export class BinaryWatcher {
  private readonly watcher: FileSystemWatcher | undefined;

  constructor(
    binary: BinarySearchResult | undefined,
    binaryName: string,
    outputChannel: LogOutputChannel,
    onBinaryChanged: () => Promise<void>,
  ) {
    const watchPath = this.resolveWatchPath(binary, binaryName);
    if (!watchPath) {
      return;
    }

    // ignoreCreateEvents=false, ignoreChangeEvents=true, ignoreDeleteEvents=false
    this.watcher = workspace.createFileSystemWatcher(
      new RelativePattern(Uri.file(path.dirname(watchPath)), path.basename(watchPath)),
      false,
      true,
      false,
    );

    this.watcher.onDidCreate(async () => {
      outputChannel.info(`Binary "${binaryName}" detected, restarting tool...`);
      clearWorkspacePackageJsonNodeModulesCache();
      await onBinaryChanged();
    });

    this.watcher.onDidDelete(async () => {
      outputChannel.info(`Binary "${binaryName}" removed, restarting tool...`);
      clearWorkspacePackageJsonNodeModulesCache();
      await onBinaryChanged();
    });
  }

  /**
   * Returns the path of the file to watch.
   *
   * When the binary was already found by `findBinary`, that exact path is
   * used. Otherwise the expected default installation location within the
   * first workspace folder is returned so that an initial `npm install` is
   * also detected.
   */
  private resolveWatchPath(
    binary: BinarySearchResult | undefined,
    binaryName: string,
  ): string | undefined {
    if (binary) {
      return binary.path;
    }

    const firstWorkspaceFolder = workspace.workspaceFolders?.[0];
    if (!firstWorkspaceFolder) {
      return undefined;
    }

    const expectedPath = path.join(
      firstWorkspaceFolder.uri.fsPath,
      "node_modules",
      ".bin",
      binaryName,
    );

    return process.platform === "win32" ? `${expectedPath}.exe` : expectedPath;
  }

  dispose(): void {
    this.watcher?.dispose();
  }
}
