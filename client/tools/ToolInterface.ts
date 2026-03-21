import { ConfigurationChangeEvent, LogOutputChannel } from "vscode";
import { ConfigService } from "../ConfigService";
import StatusBarItemHandler from "../StatusBarItemHandler";
import type { BinarySearchResult } from "../findBinary";

export default interface ToolInterface {
  /**
   * Gets the path to the tool's language server binary (if applicable).
   */
  getBinary(
    outputChannel: LogOutputChannel,
    configService: ConfigService,
  ): Promise<BinarySearchResult | undefined>;
  /**
   * Activates the tool and initializes any necessary resources.
   */
  activate(
    outputChannel: LogOutputChannel,
    configService: ConfigService,
    statusBarItemHandler: StatusBarItemHandler,
    binary?: BinarySearchResult,
  ): Promise<void>;

  /**
   * Deactivates the tool and cleans up any resources.
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
}
