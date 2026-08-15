import { ConfigurationChangeEvent } from "vscode";
import type { BinarySearchResult } from "../findBinary";

export default interface ToolInterface {
  /**
   * Gets the version of the tool's language server (if applicable).
   */
  getLspVersion(): string | undefined;
  /**
   * Gets the path to the tool's language server binary (if applicable).
   */
  getBinary(): Promise<BinarySearchResult | undefined>;
  /**
   * Activates the tool and initializes any necessary resources.
   */
  activate(binary?: BinarySearchResult): Promise<void>;

  /**
   * Deactivates the tool and cleans up any resources.
   */
  deactivate(): Promise<void>;

  /**
   * Dispose of commands registered at construction.
   * Should be called when the tool is permanently disposed (e.g., extension deactivation).
   */
  dispose(): void;

  /**
   * Restarts the tool, cleaning up resources and reinitializing with the current configuration.
   */
  restart(): Promise<void>;

  /**
   * Handles configuration changes.
   */
  onConfigChange(event: ConfigurationChangeEvent): Promise<void>;
}
