import { execFile } from "node:child_process";
import * as os from "node:os";

import { env, MarkdownString, StatusBarAlignment, StatusBarItem, window } from "vscode";

type StatusBarTool = "linter" | "formatter";

type ToolState = {
  isEnabled: boolean;
  content: string;
  version?: string;
};

export default class StatusBarItemHandler {
  private tooltipSections: Map<StatusBarTool, ToolState> = new Map([
    ["linter", { isEnabled: false, content: "", version: "unknown" }],
    ["formatter", { isEnabled: false, content: "", version: "unknown" }],
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
    isEnabled: boolean,
    text: string,
    version?: string,
  ): void {
    const section = this.tooltipSections.get(toolId);
    if (section) {
      section.isEnabled = isEnabled;
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
        const statusText = section.isEnabled ? `enabled (${version})` : "disabled";
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

    if (linterState.isEnabled && formatterState.isEnabled) {
      // Every tool is enabled.
      return "check-all";
    } else if (linterState.isEnabled || formatterState.isEnabled) {
      // Some tools are enabled.
      return "check";
    } else {
      // No tools are enabled.
      return "circle-slash";
    }
  }

  public async copyDebugInfo(nodePath?: string, useExecPath?: boolean): Promise<void> {
    const linter = this.tooltipSections.get("linter")!;
    const formatter = this.tooltipSections.get("formatter")!;

    const linterVersion = linter.version ?? "unknown";
    const formatterVersion = formatter.version ?? "unknown";

    const osName = this.getOsName();
    const nodeCommand = this.resolveNodeCommand(nodePath, useExecPath);
    const nodeVersion = await this.getNodeVersion(nodeCommand);

    const info = [
      "### Used Versions",
      "",
      "```",
      `VS Code extension: v${this.extensionVersion}`,
      `oxlint: v${linterVersion}`,
      `oxfmt: v${formatterVersion}`,
      `Editor: ${env.appName} ${env.appHost}`,
      `Operating System and Version: ${osName} (${os.arch()})`,
      `Node Version: ${nodeVersion} (${nodeCommand})`,
      "```",
    ].join("\n");

    await env.clipboard.writeText(info);
    window.showInformationMessage("Debug info copied to clipboard.");
  }

  private resolveNodeCommand(nodePath?: string, useExecPath?: boolean): string {
    if (useExecPath) {
      return process.execPath || nodePath || "node";
    }
    return nodePath || "node";
  }

  private getNodeVersion(nodeCommand: string): Promise<string> {
    return new Promise((resolve) => {
      execFile(nodeCommand, ["--version"], { timeout: 5000 }, (error, stdout) => {
        if (error) {
          resolve("unknown");
        } else {
          resolve(stdout.trim());
        }
      });
    });
  }

  private getOsName(): string {
    switch (os.platform()) {
      case "darwin":
        return `macOS ${os.release()}`;
      case "win32":
        return `Windows ${os.release()}`;
      case "linux":
        return `Linux ${os.release()}`;
      default:
        return `${os.platform()} ${os.release()}`;
    }
  }

  public dispose(): void {
    this.statusBarItem.dispose();
  }
}
