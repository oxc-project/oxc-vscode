import { ok, strictEqual } from "assert";
import { env } from "vscode";
import StatusBarItemHandler from "../../client/StatusBarItemHandler.js";

suite("StatusBarItemHandler", () => {
  suite("getIcon - icon selection based on tool enablement", () => {
    test("returns 'check-all' when both linter and formatter are enabled", () => {
      const handler = new StatusBarItemHandler("1.0.0");
      handler.show();

      // Enable both tools
      handler.updateTool("linter", true, "Linter is running", "1.0.0");
      handler.updateTool("formatter", true, "Formatter is running", "1.0.0");

      // Access the statusBarItem text to verify the icon
      const statusBarText = (handler as any).statusBarItem.text;
      strictEqual(
        statusBarText,
        "$(check-all) oxc",
        "Icon should be 'check-all' when both tools are enabled",
      );
    });

    test("returns 'check' when only linter is enabled", () => {
      const handler = new StatusBarItemHandler("1.0.0");
      handler.show();

      // Enable only linter
      handler.updateTool("linter", true, "Linter is running", "1.0.0");
      handler.updateTool("formatter", false, "Formatter is disabled", "1.0.0");

      const statusBarText = (handler as any).statusBarItem.text;
      strictEqual(
        statusBarText,
        "$(check) oxc",
        "Icon should be 'check' when only linter is enabled",
      );
    });

    test("returns 'check' when only formatter is enabled", () => {
      const handler = new StatusBarItemHandler("1.0.0");
      handler.show();

      // Enable only formatter
      handler.updateTool("linter", false, "Linter is disabled", "1.0.0");
      handler.updateTool("formatter", true, "Formatter is running", "1.0.0");

      const statusBarText = (handler as any).statusBarItem.text;
      strictEqual(
        statusBarText,
        "$(check) oxc",
        "Icon should be 'check' when only formatter is enabled",
      );
    });

    test("returns 'circle-slash' when both tools are disabled", () => {
      const handler = new StatusBarItemHandler("1.0.0");
      handler.show();

      // Disable both tools
      handler.updateTool("linter", false, "Linter is disabled", "1.0.0");
      handler.updateTool("formatter", false, "Formatter is disabled", "1.0.0");

      const statusBarText = (handler as any).statusBarItem.text;
      strictEqual(
        statusBarText,
        "$(circle-slash) oxc",
        "Icon should be 'circle-slash' when both tools are disabled",
      );
    });

    test("updates icon when toggling linter from enabled to disabled", () => {
      const handler = new StatusBarItemHandler("1.0.0");
      handler.show();

      // Start with both enabled
      handler.updateTool("linter", true, "Linter is running", "1.0.0");
      handler.updateTool("formatter", true, "Formatter is running", "1.0.0");
      let statusBarText = (handler as any).statusBarItem.text;
      strictEqual(statusBarText, "$(check-all) oxc", "Should start with 'check-all'");

      // Disable linter
      handler.updateTool("linter", false, "Linter is disabled", "1.0.0");
      statusBarText = (handler as any).statusBarItem.text;
      strictEqual(
        statusBarText,
        "$(check) oxc",
        "Should change to 'check' when linter is disabled",
      );
    });

    test("updates icon when toggling formatter from enabled to disabled", () => {
      const handler = new StatusBarItemHandler("1.0.0");
      handler.show();

      // Start with both enabled
      handler.updateTool("linter", true, "Linter is running", "1.0.0");
      handler.updateTool("formatter", true, "Formatter is running", "1.0.0");
      let statusBarText = (handler as any).statusBarItem.text;
      strictEqual(statusBarText, "$(check-all) oxc", "Should start with 'check-all'");

      // Disable formatter
      handler.updateTool("formatter", false, "Formatter is disabled", "1.0.0");
      statusBarText = (handler as any).statusBarItem.text;
      strictEqual(
        statusBarText,
        "$(check) oxc",
        "Should change to 'check' when formatter is disabled",
      );
    });

    test("updates icon when enabling linter from all-disabled state", () => {
      const handler = new StatusBarItemHandler("1.0.0");
      handler.show();

      // Start with both disabled
      handler.updateTool("linter", false, "Linter is disabled", "1.0.0");
      handler.updateTool("formatter", false, "Formatter is disabled", "1.0.0");
      let statusBarText = (handler as any).statusBarItem.text;
      strictEqual(statusBarText, "$(circle-slash) oxc", "Should start with 'circle-slash'");

      // Enable linter
      handler.updateTool("linter", true, "Linter is running", "1.0.0");
      statusBarText = (handler as any).statusBarItem.text;
      strictEqual(statusBarText, "$(check) oxc", "Should change to 'check' when linter is enabled");
    });

    test("updates icon when enabling formatter from all-disabled state", () => {
      const handler = new StatusBarItemHandler("1.0.0");
      handler.show();

      // Start with both disabled
      handler.updateTool("linter", false, "Linter is disabled", "1.0.0");
      handler.updateTool("formatter", false, "Formatter is disabled", "1.0.0");
      let statusBarText = (handler as any).statusBarItem.text;
      strictEqual(statusBarText, "$(circle-slash) oxc", "Should start with 'circle-slash'");

      // Enable formatter
      handler.updateTool("formatter", true, "Formatter is running", "1.0.0");
      statusBarText = (handler as any).statusBarItem.text;
      strictEqual(
        statusBarText,
        "$(check) oxc",
        "Should change to 'check' when formatter is enabled",
      );
    });

    test("updates icon when enabling both tools from partial state", () => {
      const handler = new StatusBarItemHandler("1.0.0");
      handler.show();

      // Start with only linter enabled
      handler.updateTool("linter", true, "Linter is running", "1.0.0");
      handler.updateTool("formatter", false, "Formatter is disabled", "1.0.0");
      let statusBarText = (handler as any).statusBarItem.text;
      strictEqual(statusBarText, "$(check) oxc", "Should start with 'check'");

      // Enable formatter to have both enabled
      handler.updateTool("formatter", true, "Formatter is running", "1.0.0");
      statusBarText = (handler as any).statusBarItem.text;
      strictEqual(
        statusBarText,
        "$(check-all) oxc",
        "Should change to 'check-all' when both tools are enabled",
      );
    });

    test("cleans up status bar item on dispose", () => {
      const handler = new StatusBarItemHandler("1.0.0");
      handler.show();
      handler.updateTool("linter", true, "Linter is running", "1.0.0");

      // Dispose should not throw
      handler.dispose();
    });
  });

  suite("copyDebugInfo", () => {
    test("copies debug info to clipboard with correct versions", async () => {
      const handler = new StatusBarItemHandler("1.50.0");
      handler.updateTool("linter", true, "running", "0.16.0");
      handler.updateTool("formatter", true, "running", "0.5.0");

      await handler.copyDebugInfo();

      const clipboardContent = await env.clipboard.readText();

      ok(clipboardContent.includes("VS Code extension: v1.50.0"), "should include extension version");
      ok(clipboardContent.includes("oxlint: v0.16.0"), "should include oxlint version");
      ok(clipboardContent.includes("oxfmt: v0.5.0"), "should include oxfmt version");
      ok(clipboardContent.includes("Editor:"), "should include editor info");
      ok(
        clipboardContent.includes("Operating System and Version:"),
        "should include OS info",
      );
      ok(clipboardContent.includes("Node Version:"), "should include Node version");
      // Everything should be inside a single code fence
      ok(clipboardContent.includes("```\nVS Code extension:"), "should start code fence before versions");
      ok(clipboardContent.endsWith("```"), "should end with code fence");
    });

    test("includes the resolved node command in Node Version line", async () => {
      const handler = new StatusBarItemHandler("1.50.0");

      await handler.copyDebugInfo();

      const clipboardContent = await env.clipboard.readText();

      // Default (no nodePath, no useExecPath) resolves to "node"
      ok(clipboardContent.includes("Node Version:"), "should include Node version");
      ok(clipboardContent.includes("(node)"), "should show the resolved node command");
    });

    test("uses custom nodePath when provided", async () => {
      const handler = new StatusBarItemHandler("1.50.0");

      // Pass a real node path (process.execPath is the Electron binary running this test)
      await handler.copyDebugInfo(process.execPath, false);

      const clipboardContent = await env.clipboard.readText();

      ok(
        clipboardContent.includes(`(${process.execPath})`),
        "should show the custom node path",
      );
    });

    test("uses execPath when useExecPath is true", async () => {
      const handler = new StatusBarItemHandler("1.50.0");

      await handler.copyDebugInfo(undefined, true);

      const clipboardContent = await env.clipboard.readText();

      ok(
        clipboardContent.includes(`(${process.execPath})`),
        "should show execPath when useExecPath is true",
      );
    });

    test("shows 'unknown' for tools that have not reported versions", async () => {
      const handler = new StatusBarItemHandler("1.50.0");
      // Don't call updateTool — versions default to "unknown"

      await handler.copyDebugInfo();

      const clipboardContent = await env.clipboard.readText();

      ok(clipboardContent.includes("oxlint: vunknown"), "should show unknown for oxlint");
      ok(clipboardContent.includes("oxfmt: vunknown"), "should show unknown for oxfmt");
    });

    test("uses <unknown> when extension version is not provided", async () => {
      const handler = new StatusBarItemHandler();

      await handler.copyDebugInfo();

      const clipboardContent = await env.clipboard.readText();

      ok(
        clipboardContent.includes("VS Code extension: v<unknown>"),
        "should show <unknown> for extension version",
      );
    });

    test("shows 'unknown' node version when the binary is not found", async () => {
      const handler = new StatusBarItemHandler("1.50.0");

      await handler.copyDebugInfo("/nonexistent/path/to/node", false);

      const clipboardContent = await env.clipboard.readText();

      ok(
        clipboardContent.includes("Node Version: unknown"),
        "should show unknown when node binary is not found",
      );
    });
  });
});
