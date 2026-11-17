import { MarkdownString, StatusBarAlignment, StatusBarItem, window } from "vscode";

type StatusBarTool = "linter" | "formatter";

type ToolState = {
  isRunning: boolean;
  content: string;
  version?: string;
};

export default class StatusBarItemHandler {
  private tooltipSections: Map<StatusBarTool, ToolState> = new Map([
    ["linter", { isRunning: false, content: "", version: "unknown" }],
    ["formatter", { isRunning: false, content: "", version: "unknown" }],
  ]);

  private statusBarItem: StatusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 100);

  private extensionVersion: string = "<unknown>";

  constructor(extensionVersion?: string) {
    if (extensionVersion) {
      this.extensionVersion = extensionVersion;
    }
  }

  public show(): void {
    this.statusBarItem.show();
  }

  /**
   * Updates the tooltip text for a specific tool section.
   * The tooltip can use markdown syntax and VSCode icons.
   */
  public updateTool(
    toolId: StatusBarTool,
    isRunning: boolean,
    text: string,
    version?: string,
  ): void {
    const section = this.tooltipSections.get(toolId);
    if (section) {
      section.isRunning = isRunning;
      section.content = text;
      section.version = version ?? "unknown";
      this.updateFullTooltip();
      const icon = this.getIcon();
      this.statusBarItem.text = `$(${icon}) oxc`;
    }
  }

  private updateFullTooltip(): void {
    const sections: [string, ToolState][] = [
      ["oxlint", this.tooltipSections.get("linter")!],
      ["oxfmt", this.tooltipSections.get("formatter")!],
    ];

    const text = sections
      .map(([tool, section]) => {
        const version = section.version ? `v${section.version}` : "unknown version";
        const statusText = section.isRunning ? `running (${version})` : "not running";
        return `**${tool} is ${statusText}**\n\n${section.content}`;
      })
      .join("\n\n---\n\n");

    // reset the tooltip to ensure the UI updates correctly
    this.statusBarItem.tooltip = new MarkdownString("", true);
    this.statusBarItem.tooltip.isTrusted = true;
    this.statusBarItem.tooltip.value = `VS Code Extension v${this.extensionVersion}\n\n---\n\n${text}`;
  }

  private getIcon(): string {
    const linterState = this.tooltipSections.get("linter")!;
    const formatterState = this.tooltipSections.get("formatter")!;

    if (linterState.isRunning && formatterState.isRunning) {
      // Every tool is running.
      return "check-all";
    } else if (linterState.isRunning || formatterState.isRunning) {
      // Some tools are running.
      return "check";
    } else {
      // No tools are running.
      return "circle-slash";
    }
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}
