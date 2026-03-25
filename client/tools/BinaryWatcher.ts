import * as path from "node:path";
import { FileSystemWatcher, LogOutputChannel, RelativePattern, Uri, workspace } from "vscode";
import { clearWorkspacePackageJsonNodeModulesCache } from "../findBinary";
import type { BinarySearchResult } from "../findBinary";

/**
 * Watches the resolved binary file for creation and deletion.
 * When the binary appears (e.g. after `npm install`) or disappears (e.g.
 * after `npm uninstall`), the registered callback is invoked so the tool
 * can be restarted and the extension UI is kept in sync without requiring
 * a VS Code restart.
 *
 * No watcher is created when `binary` is `undefined` (binary not found).
 */
export class BinaryWatcher {
  private readonly watcher: FileSystemWatcher | undefined;

  constructor(
    binary: BinarySearchResult | undefined,
    binaryName: string,
    outputChannel: LogOutputChannel,
    onBinaryChanged: () => Promise<void>,
  ) {
    if (!binary) {
      return;
    }

    // ignoreCreateEvents=false, ignoreChangeEvents=true, ignoreDeleteEvents=false
    this.watcher = workspace.createFileSystemWatcher(
      new RelativePattern(Uri.file(path.dirname(binary.path)), path.basename(binary.path)),
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

  dispose(): void {
    this.watcher?.dispose();
  }
}
