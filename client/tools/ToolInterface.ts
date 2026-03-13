import { ConfigurationChangeEvent, LogOutputChannel, WorkspaceFoldersChangeEvent } from "vscode";
import { ConfigService } from "../ConfigService";
import StatusBarItemHandler from "../StatusBarItemHandler";

export default interface ToolInterface {
  /**
   * Activates the tool for all current workspace folders.
   * Binary resolution and client creation is handled internally per folder.
   */
  activate(
    outputChannel: LogOutputChannel,
    configService: ConfigService,
    statusBarItemHandler: StatusBarItemHandler,
  ): Promise<void>;

  /**
   * Deactivates the tool and cleans up all resources.
   */
  deactivate(): Promise<void>;

  /**
   * Handles configuration changes.
   */
  onConfigChange(
    event: ConfigurationChangeEvent,
    configService: ConfigService,
    statusBarItemHandler: StatusBarItemHandler,
  ): Promise<void>;

  /**
   * Handles workspace folder additions and removals.
   */
  onWorkspaceFolderChange(
    event: WorkspaceFoldersChangeEvent,
    outputChannel: LogOutputChannel,
    configService: ConfigService,
    statusBarItemHandler: StatusBarItemHandler,
  ): Promise<void>;
}
