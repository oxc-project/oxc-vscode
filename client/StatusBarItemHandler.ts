import {
  MarkdownString,
  StatusBarAlignment,
  type StatusBarItem,
  window,
} from "vscode";
import { BiomeCommands } from "./commands";

type ToolState = {
  isEnabled: boolean;
  content: string;
  version?: string;
  isFileActive?: boolean;
};

export default class StatusBarItemHandler {
  private biomeState: ToolState = {
    isEnabled: false,
    content: "",
    version: "unknown",
    isFileActive: false,
  };
  private statusBarItem: StatusBarItem = window.createStatusBarItem(
    StatusBarAlignment.Right,
    100,
  );
  private extensionVersion: string = "<unknown>";

  constructor(extensionVersion?: string) {
    if (extensionVersion) {
      this.extensionVersion = extensionVersion;
    }
    this.statusBarItem.command = BiomeCommands.OpenConfig;
  }

  public show(): void {
    this.statusBarItem.show();
  }

  public updateTool(
    _toolId: string,
    isEnabled: boolean,
    text: string,
    version?: string,
    isFileActive?: boolean,
  ): void {
    this.biomeState.isEnabled = isEnabled;
    this.biomeState.content = text;
    this.biomeState.version = version ?? "unknown";
    this.biomeState.isFileActive = isFileActive;

    this.updateFullTooltip();
    const icon = this.getIcon();
    this.statusBarItem.text = `$(${icon}) Biome`;
  }

  private updateFullTooltip(): void {
    const version = this.biomeState.version
      ? `v${this.biomeState.version}`
      : "unknown version";
    const statusText = this.biomeState.isEnabled
      ? `enabled (${version})`
      : "disabled";

    const fileStatusText = this.biomeState.isFileActive
      ? "Active on this file"
      : "Inactive on this file";

    const text = `**Biome is ${statusText}**\n\n${fileStatusText}\n\n---\n\n${this.biomeState.content}`;

    this.statusBarItem.tooltip = new MarkdownString("", true);
    this.statusBarItem.tooltip.isTrusted = true;
    this.statusBarItem.tooltip.value = `VS Code Extension v${this.extensionVersion}\n\n---\n\n${text}`;
  }

  private getIcon(): string {
    if (!this.biomeState.isEnabled) {
      return "circle-slash";
    }
    return this.biomeState.isFileActive ? "check-all" : "circle-outline";
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}
