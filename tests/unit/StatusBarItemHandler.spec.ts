import { strictEqual } from "assert";
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
});
