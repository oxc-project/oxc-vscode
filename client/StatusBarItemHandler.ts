import {
  MarkdownString,
  StatusBarAlignment,
  type StatusBarItem,
  window,
} from "vscode";

type ToolState = {
  isEnabled: boolean;
  content: string;
  version?: string;
};

export default class StatusBarItemHandler {
  private biomeState: ToolState = {
    isEnabled: false,
    content: "",
    version: "unknown",
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
  }

  public show(): void {
    this.statusBarItem.show();
  }

  public updateTool(
    _toolId: string,
    isEnabled: boolean,
    text: string,
    version?: string,
  ): void {
    this.biomeState.isEnabled = isEnabled;
    this.biomeState.content = text;
    this.biomeState.version = version ?? "unknown";

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
    const text = `**Biome is ${statusText}**\n\n${this.biomeState.content}`;

    this.statusBarItem.tooltip = new MarkdownString("", true);
    this.statusBarItem.tooltip.isTrusted = true;
    this.statusBarItem.tooltip.value = `VS Code Extension v${this.extensionVersion}\n\n---\n\n${text}`;
  }

  private getIcon(): string {
    return this.biomeState.isEnabled ? "check-all" : "circle-slash";
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}
