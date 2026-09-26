import { notStrictEqual, strictEqual } from "assert";
import { ConfigurationTarget, workspace } from "vscode";
import {
  enableUpdateTarget,
  enableUpdateTargetValue,
  VSCodeConfig,
} from "../../client/VSCodeConfig.js";

const conf = workspace.getConfiguration("oxc");

suite("enable update target", () => {
  test("an empty window can only store the value in the user settings", () => {
    strictEqual(enableUpdateTarget(false), ConfigurationTarget.Global);
    strictEqual(enableUpdateTarget(true), ConfigurationTarget.Workspace);
  });

  test("the raw value is read at the level the toggle writes to", () => {
    const inspected = { globalValue: true, workspaceValue: false };

    strictEqual(enableUpdateTargetValue(inspected, false), true, "the user value");
    strictEqual(enableUpdateTargetValue(inspected, true), false, "the workspace value");
    strictEqual(enableUpdateTargetValue({ globalValue: true }, true), undefined);
    strictEqual(enableUpdateTargetValue(undefined, false), undefined);
  });
});

suite("VSCodeConfig", () => {
  const keys = [
    "enable",
    "enable.oxlint",
    "enable.oxfmt",
    "requireConfig",
    "trace.server",
    "path.server",
    "path.oxlint",
    "path.oxfmt",
    "path.tsgolint",
    "path.node",
    "useExecPath",
    "suppressProgramErrors",
  ];
  const resetKeys = async () => {
    await Promise.all([
      ...keys.map((key) => conf.update(key, undefined)),
      // the user settings are shared by every suite, they must not keep a value
      ...keys.map((key) => conf.update(key, undefined, ConfigurationTarget.Global)),
      ...keys.map((key) => conf.update(key, undefined, ConfigurationTarget.Workspace)),
    ]);
  };

  setup(resetKeys);

  teardown(resetKeys);

  test("default values on initialization", () => {
    const config = new VSCodeConfig();

    strictEqual(config.enableOxlint, true, "enableOxlint should default to true");
    strictEqual(config.enableOxfmt, true, "enableOxfmt should default to true");
    strictEqual(config.requireConfig, false);
    strictEqual(config.trace, "off");
    strictEqual(config.binPathOxlint, "");
    strictEqual(config.binPathOxfmt, "");
    strictEqual(config.binPathTsGoLint, "");
    strictEqual(config.nodePath, "");
    strictEqual(config.useExecPath, false);
    strictEqual(
      config.suppressProgramErrors,
      false,
      "suppressProgramErrors should default to false",
    );
  });

  test("deprecated values are respected", async () => {
    await conf.update("path.server", "./deprecatedBinary");
    const config = new VSCodeConfig();

    strictEqual(config.binPathOxlint, "./deprecatedBinary");
  });

  test("the toggle writes the master key when it governs at that level", async () => {
    // `oxc.enable` is set in the workspace settings, writing `oxc.enable.oxlint` next to it would
    // have no effect: the master toggle wins at the same level
    await conf.update("enable", false, ConfigurationTarget.Workspace);

    const config = new VSCodeConfig();
    strictEqual(config.rawEnableOxlint, false, "the raw value comes from the master toggle");

    await config.updateEnableOxlint(true);

    const inspected = workspace.getConfiguration("oxc", null);
    strictEqual(inspected.inspect("enable")?.workspaceValue, true, "the master key was written");
    strictEqual(
      inspected.inspect("enable.oxlint")?.workspaceValue,
      undefined,
      "the tool key was left alone",
    );

    await conf.update("enable", undefined, ConfigurationTarget.Workspace);
  });

  test("the toggle writes the tool key when no master is set at that level", async () => {
    const config = new VSCodeConfig();
    strictEqual(config.rawEnableOxfmt, undefined);

    await config.updateEnableOxfmt(false);

    const inspected = workspace.getConfiguration("oxc", null);
    strictEqual(inspected.inspect("enable.oxfmt")?.workspaceValue, false);
    // `oxc.enable` holds the tool keys of that level as an object, the master toggle is not set
    notStrictEqual(typeof inspected.inspect("enable")?.workspaceValue, "boolean");
    strictEqual(new VSCodeConfig().rawEnableOxfmt, false);
  });

  test("update enable, will update enable.oxlint and enable.oxfmt respectively", async () => {
    await conf.update("enable", false);
    const config = new VSCodeConfig();

    strictEqual(config.enableOxlint, false);
    strictEqual(config.enableOxfmt, false);
  });

  test("update `enable.oxlint` to false, while `enable` is true", async () => {
    await conf.update("enable", true);
    await conf.update("enable.oxlint", false);
    const config = new VSCodeConfig();

    strictEqual(config.enableOxlint, true);
    strictEqual(config.enableOxfmt, true);
  });

  test("updating values updates the workspace configuration", async () => {
    const config = new VSCodeConfig();

    await Promise.all([
      config.updateEnableOxlint(false),
      config.updateEnableOxfmt(false),
      config.updateRequireConfig(true),
      config.updateTrace("messages"),
      config.updateBinPathOxlint("./binary"),
      config.updateBinPathOxfmt("./formatter"),
      config.updateBinPathTsGoLint("./tsgolint"),
      config.updateNodePath("./node"),
      config.updateUseExecPath(true),
      config.updateSuppressTsconfigErrors(true),
    ]);

    const wsConfig = workspace.getConfiguration("oxc");

    strictEqual(wsConfig.get("enable.oxlint"), false);
    strictEqual(wsConfig.get("enable.oxfmt"), false);
    strictEqual(wsConfig.get("requireConfig"), true);
    strictEqual(wsConfig.get("trace.server"), "messages");
    strictEqual(wsConfig.get("path.oxlint"), "./binary");
    strictEqual(wsConfig.get("path.oxfmt"), "./formatter");
    strictEqual(wsConfig.get("path.tsgolint"), "./tsgolint");
    strictEqual(wsConfig.get("path.node"), "./node");
    strictEqual(wsConfig.get("useExecPath"), true);
    strictEqual(wsConfig.get("suppressProgramErrors"), true);
  });

  test("effectsOxlintConnection detects changes to oxlint connection related settings", async () => {
    const config = new VSCodeConfig();
    const wsConfig = workspace.getConfiguration("oxc");

    const testCases = [
      { key: "path.oxlint", affects: true },
      { key: "path.tsgolint", affects: true },
      { key: "path.node", affects: true },
      { key: "useExecPath", affects: true },
      { key: "requireConfig", affects: false },
      { key: "path.oxfmt", affects: false },
    ];

    for (const { key, affects } of testCases) {
      let promise = new Promise<void>((resolve) => {
        const disposer = workspace.onDidChangeConfiguration((event) => {
          strictEqual(config.effectsOxlintConnection(event), affects);
          disposer.dispose();
          resolve();
        });
      });

      wsConfig.update(key, "testValue");
      // oxlint-disable-next-line no-await-in-loop -- testing sequentially to ensure correct event handling
      await promise;
    }
  });

  test("effectsOxfmtConnection detects changes to oxfmt connection related settings", async () => {
    const config = new VSCodeConfig();
    const wsConfig = workspace.getConfiguration("oxc");

    const testCases = [
      { key: "path.oxfmt", affects: true },
      { key: "path.node", affects: true },
      { key: "useExecPath", affects: true },
      { key: "path.tsgolint", affects: false },
      { key: "requireConfig", affects: false },
      { key: "path.oxlint", affects: false },
    ];

    for (const { key, affects } of testCases) {
      let promise = new Promise<void>((resolve) => {
        const disposer = workspace.onDidChangeConfiguration((event) => {
          strictEqual(config.effectsOxfmtConnection(event), affects);
          disposer.dispose();
          resolve();
        });
      });

      wsConfig.update(key, "testValue");
      // oxlint-disable-next-line no-await-in-loop -- testing sequentially to ensure correct event handling
      await promise;
    }
  });
});
