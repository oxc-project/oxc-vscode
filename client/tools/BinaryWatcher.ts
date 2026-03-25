import { FileSystemWatcher, LogOutputChannel, workspace } from "vscode";
import { clearWorkspacePackageJsonNodeModulesCache } from "../findBinary";

/**
 * Watches for the creation and deletion of a tool binary inside `node_modules/.bin`.
 * When a binary appears (e.g. after `npm install`) or disappears (e.g. after
 * `npm uninstall`), the registered callback is invoked so the tool can be
 * restarted and the extension UI is kept in sync without requiring a VS Code
 * restart.
 */
export class BinaryWatcher {
  private readonly watchers: FileSystemWatcher[] = [];

  constructor(
    binaryName: string,
    outputChannel: LogOutputChannel,
    onBinaryChanged: () => Promise<void>,
  ) {
    const patterns = [`**/node_modules/.bin/${binaryName}`];
    if (process.platform === "win32") {
      patterns.push(`**/node_modules/.bin/${binaryName}.exe`);
    }

    for (const pattern of patterns) {
      // ignoreCreateEvents=false, ignoreChangeEvents=true, ignoreDeleteEvents=false
      const watcher = workspace.createFileSystemWatcher(pattern, false, true, false);

      watcher.onDidCreate(async () => {
        outputChannel.info(
          `Binary "${binaryName}" detected in node_modules, restarting tool...`,
        );
        clearWorkspacePackageJsonNodeModulesCache();
        await onBinaryChanged();
      });

      watcher.onDidDelete(async () => {
        outputChannel.info(
          `Binary "${binaryName}" removed from node_modules, restarting tool...`,
        );
        clearWorkspacePackageJsonNodeModulesCache();
        await onBinaryChanged();
      });

      this.watchers.push(watcher);
    }
  }

  dispose(): void {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
  }
}
