import { match, strictEqual } from "assert";
import StatusBarItemHandler from "../../client/StatusBarItemHandler.js";

suite("StatusBarItemHandler", () => {
  suite("getIcon - icon selection based on tool enablement", () => {
    test("returns 'check-all' when both linter and formatter are running", () => {
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
        "Icon should be 'check-all' when both tools are running",
      );
    });

    test("returns 'check' when only linter is running", () => {
      const handler = new StatusBarItemHandler("1.0.0");
      handler.show();

      // Enable only linter
      handler.updateTool("linter", true, "Linter is running", "1.0.0");
      handler.updateTool("formatter", false, "Formatter is not running", "1.0.0");

      const statusBarText = (handler as any).statusBarItem.text;
      strictEqual(
        statusBarText,
        "$(check) oxc",
        "Icon should be 'check' when only linter is running",
      );
    });

    test("returns 'check' when only formatter is running", () => {
      const handler = new StatusBarItemHandler("1.0.0");
      handler.show();

      // Enable only formatter
      handler.updateTool("linter", false, "Linter is not running", "1.0.0");
      handler.updateTool("formatter", true, "Formatter is running", "1.0.0");

      const statusBarText = (handler as any).statusBarItem.text;
      strictEqual(
        statusBarText,
        "$(check) oxc",
        "Icon should be 'check' when only formatter is running",
      );
    });

    test("returns 'circle-slash' when both tools are not running", () => {
      const handler = new StatusBarItemHandler("1.0.0");
      handler.show();

      // Disable both tools
      handler.updateTool("linter", false, "Linter is not running", "1.0.0");
      handler.updateTool("formatter", false, "Formatter is not running", "1.0.0");

      const statusBarText = (handler as any).statusBarItem.text;
      strictEqual(
        statusBarText,
        "$(circle-slash) oxc",
        "Icon should be 'circle-slash' when both tools are not running",
      );
    });

    test("updates icon when toggling linter from running to not running", () => {
      const handler = new StatusBarItemHandler("1.0.0");
      handler.show();

      // Start with both running
      handler.updateTool("linter", true, "Linter is running", "1.0.0");
      handler.updateTool("formatter", true, "Formatter is running", "1.0.0");
      let statusBarText = (handler as any).statusBarItem.text;
      strictEqual(statusBarText, "$(check-all) oxc", "Should start with 'check-all'");

      // Disable linter
      handler.updateTool("linter", false, "Linter is not running", "1.0.0");
      statusBarText = (handler as any).statusBarItem.text;
      strictEqual(
        statusBarText,
        "$(check) oxc",
        "Should change to 'check' when linter is not running",
      );
    });

    test("updates icon when toggling formatter from running to not running", () => {
      const handler = new StatusBarItemHandler("1.0.0");
      handler.show();

      // Start with both running
      handler.updateTool("linter", true, "Linter is running", "1.0.0");
      handler.updateTool("formatter", true, "Formatter is running", "1.0.0");
      let statusBarText = (handler as any).statusBarItem.text;
      strictEqual(statusBarText, "$(check-all) oxc", "Should start with 'check-all'");

      // Disable formatter
      handler.updateTool("formatter", false, "Formatter is not running", "1.0.0");
      statusBarText = (handler as any).statusBarItem.text;
      strictEqual(
        statusBarText,
        "$(check) oxc",
        "Should change to 'check' when formatter is not running",
      );
    });

    test("updates icon when starting linter from all-stopped state", () => {
      const handler = new StatusBarItemHandler("1.0.0");
      handler.show();

      // Start with both not running
      handler.updateTool("linter", false, "Linter is not running", "1.0.0");
      handler.updateTool("formatter", false, "Formatter is not running", "1.0.0");
      let statusBarText = (handler as any).statusBarItem.text;
      strictEqual(statusBarText, "$(circle-slash) oxc", "Should start with 'circle-slash'");

      // Enable linter
      handler.updateTool("linter", true, "Linter is running", "1.0.0");
      statusBarText = (handler as any).statusBarItem.text;
      strictEqual(statusBarText, "$(check) oxc", "Should change to 'check' when linter is running");
    });

    test("updates icon when starting formatter from all-stopped state", () => {
      const handler = new StatusBarItemHandler("1.0.0");
      handler.show();

      // Start with both not running
      handler.updateTool("linter", false, "Linter is not running", "1.0.0");
      handler.updateTool("formatter", false, "Formatter is not running", "1.0.0");
      let statusBarText = (handler as any).statusBarItem.text;
      strictEqual(statusBarText, "$(circle-slash) oxc", "Should start with 'circle-slash'");

      // Enable formatter
      handler.updateTool("formatter", true, "Formatter is running", "1.0.0");
      statusBarText = (handler as any).statusBarItem.text;
      strictEqual(
        statusBarText,
        "$(check) oxc",
        "Should change to 'check' when formatter is running",
      );
    });

    test("updates icon when enabling both tools from partial state", () => {
      const handler = new StatusBarItemHandler("1.0.0");
      handler.show();

      // Start with only linter running
      handler.updateTool("linter", true, "Linter is running", "1.0.0");
      handler.updateTool("formatter", false, "Formatter is not running", "1.0.0");
      let statusBarText = (handler as any).statusBarItem.text;
      strictEqual(statusBarText, "$(check) oxc", "Should start with 'check'");

      // Enable formatter to have both running
      handler.updateTool("formatter", true, "Formatter is running", "1.0.0");
      statusBarText = (handler as any).statusBarItem.text;
      strictEqual(
        statusBarText,
        "$(check-all) oxc",
        "Should change to 'check-all' when both tools are running",
      );
    });

    test("the tooltip header says whether the tool is running", () => {
      const handler = new StatusBarItemHandler("1.0.0");
      handler.updateTool("linter", true, "Linter content", "2.0.0");
      handler.updateTool("formatter", false, "no oxfmt binary found");

      const tooltip = (handler as any).statusBarItem.tooltip.value;
      match(tooltip, /\*\*oxlint is running \(v2\.0\.0\)\*\*\n\nLinter content/);
      match(tooltip, /\*\*oxfmt is not running\*\*\n\nno oxfmt binary found/);
      handler.dispose();
    });

    test("cleans up status bar item on dispose", () => {
      const handler = new StatusBarItemHandler("1.0.0");
      handler.show();
      handler.updateTool("linter", true, "Linter is running", "1.0.0");

      // Dispose should not throw
      handler.dispose();
    });
  });
});
