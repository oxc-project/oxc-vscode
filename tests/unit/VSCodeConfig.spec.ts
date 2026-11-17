import { notStrictEqual, rejects, strictEqual } from "assert";
import { ConfigurationTarget, workspace } from "vscode";
import type { WorkspaceConfiguration } from "vscode";
import {
  enableUpdateTarget,
  enableUpdateTargetValue,
  VSCodeConfig,
} from "../../client/VSCodeConfig.js";
import { resetOxcSettings, sleep } from "../test-helpers.js";

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
  const resetKeys = () =>
    resetOxcSettings(keys, [ConfigurationTarget.Workspace, ConfigurationTarget.Global]);

  setup(resetKeys);

  teardown(resetKeys);

  test("default values on initialization", () => {
    const config = new VSCodeConfig();

    strictEqual(config.isEnabled("oxlint"), true, "oxlint should be enabled by default");
    strictEqual(config.isEnabled("oxfmt"), true, "oxfmt should be enabled by default");
    strictEqual(config.requireConfig, false);
    strictEqual(config.trace, "off");
    strictEqual(config.binPathOxlint, undefined);
    strictEqual(config.binPathOxfmt, undefined);
    strictEqual(config.binPathTsGoLint, undefined);
    strictEqual(config.nodePath, undefined);
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

  test("the toggle replaces the master key by the tool keys when it governs at that level", async () => {
    // `oxc.enable` is set in the workspace settings, writing `oxc.enable.oxlint` next to it would
    // have no effect: the master toggle wins at the same level
    await conf.update("enable", false, ConfigurationTarget.Workspace);

    const config = new VSCodeConfig();
    await config.updateEnable("oxlint", true);

    const inspected = workspace.getConfiguration("oxc", null);
    strictEqual(inspected.inspect("enable.oxlint")?.workspaceValue, true, "the toggled tool");
    strictEqual(inspected.inspect("enable.oxfmt")?.workspaceValue, false, "the other tool");
    notStrictEqual(typeof inspected.inspect("enable")?.workspaceValue, "boolean", "master cleared");

    const refreshed = new VSCodeConfig();
    strictEqual(refreshed.isEnabled("oxlint"), true);
    strictEqual(refreshed.isEnabled("oxfmt"), false);
  });

  /** Replaces `update` of every configuration read until the returned function is called. */
  const stubUpdate = (update: () => Promise<void>) => {
    const original = workspace.getConfiguration;
    (workspace as any).getConfiguration = (...args: any[]) => {
      // the configuration objects of VS Code are frozen
      const configuration: WorkspaceConfiguration = (original as any).apply(workspace, args);
      return {
        get: configuration.get.bind(configuration),
        has: configuration.has.bind(configuration),
        inspect: configuration.inspect.bind(configuration),
        update,
      };
    };
    return () => {
      (workspace as any).getConfiguration = original;
    };
  };

  test("the cached values follow the toggle without waiting for the settings", async () => {
    await conf.update("enable", false, ConfigurationTarget.Workspace);
    const config = new VSCodeConfig();

    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const restore = stubUpdate(() => gate);
    try {
      const updating = config.updateEnable("oxlint", true);
      await sleep(10);

      strictEqual(config.isEnabled("oxlint"), true);
      strictEqual(config.isEnabled("oxfmt"), false, "the other tool keeps the master value");

      release();
      await updating;
    } finally {
      restore();
    }
  });

  test("a rejected write puts the cached values back in line with the settings", async () => {
    await conf.update("enable", false, ConfigurationTarget.Workspace);
    const config = new VSCodeConfig();

    const restore = stubUpdate(async () => {
      throw new Error("the settings file is read only");
    });
    try {
      await rejects(config.updateEnable("oxlint", true), /read only/);
    } finally {
      restore();
    }

    strictEqual(config.isEnabled("oxlint"), false, "the master toggle still disables it");
  });

  test("the toggles of both tools do not interleave", async () => {
    await conf.update("enable", true, ConfigurationTarget.Workspace);
    const config = new VSCodeConfig();

    await Promise.all([config.updateEnable("oxlint", false), config.updateEnable("oxfmt", false)]);

    const refreshed = new VSCodeConfig();
    strictEqual(refreshed.isEnabled("oxlint"), false);
    strictEqual(refreshed.isEnabled("oxfmt"), false);
  });

  test("the toggle writes the tool key when no master is set at that level", async () => {
    const config = new VSCodeConfig();

    await config.updateEnable("oxfmt", false);

    const inspected = workspace.getConfiguration("oxc", null);
    strictEqual(inspected.inspect("enable.oxfmt")?.workspaceValue, false);
    strictEqual(inspected.inspect("enable.oxlint")?.workspaceValue, undefined);
    // `oxc.enable` holds the tool keys of that level as an object, the master toggle is not set
    notStrictEqual(typeof inspected.inspect("enable")?.workspaceValue, "boolean");
    strictEqual(new VSCodeConfig().isEnabled("oxfmt"), false);
  });

  test("update enable, will update enable.oxlint and enable.oxfmt respectively", async () => {
    await conf.update("enable", false);
    const config = new VSCodeConfig();

    strictEqual(config.isEnabled("oxlint"), false);
    strictEqual(config.isEnabled("oxfmt"), false);
  });

  test("update `enable.oxlint` to false, while `enable` is true", async () => {
    await conf.update("enable", true);
    await conf.update("enable.oxlint", false);
    const config = new VSCodeConfig();

    strictEqual(config.isEnabled("oxlint"), true);
    strictEqual(config.isEnabled("oxfmt"), true);
  });

  test("updating values updates the workspace configuration", async () => {
    const config = new VSCodeConfig();

    await Promise.all([
      config.updateEnable("oxlint", false),
      config.updateEnable("oxfmt", false),
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

  test("resolves path variables in path.tsgolint", async () => {
    process.env.OXC_TEST_TSGOLINT_DIR = "/opt/oxc";
    try {
      await conf.update("path.tsgolint", "${env:OXC_TEST_TSGOLINT_DIR}/tsgolint");
      strictEqual(new VSCodeConfig().binPathTsGoLint, "/opt/oxc/tsgolint");

      delete process.env.OXC_TEST_TSGOLINT_DIR;
      await conf.update("path.tsgolint", "${env:OXC_TEST_TSGOLINT_DIR}");
      strictEqual(new VSCodeConfig().binPathTsGoLint, undefined);
    } finally {
      delete process.env.OXC_TEST_TSGOLINT_DIR;
    }
  });

  const pathSettings = [
    { key: "path.oxlint", read: (c: VSCodeConfig) => c.binPathOxlint },
    { key: "path.server", read: (c: VSCodeConfig) => c.binPathOxlint },
    { key: "path.oxfmt", read: (c: VSCodeConfig) => c.binPathOxfmt },
    { key: "path.tsgolint", read: (c: VSCodeConfig) => c.binPathTsGoLint },
    { key: "path.node", read: (c: VSCodeConfig) => c.nodePath },
  ];

  for (const { key, read } of pathSettings) {
    test(`resolves path variables in ${key}`, async () => {
      process.env.OXC_TEST_BIN_DIR = "/opt/oxc";
      try {
        await conf.update(key, "${env:OXC_TEST_BIN_DIR}/bin");
        strictEqual(read(new VSCodeConfig()), "/opt/oxc/bin");
      } finally {
        delete process.env.OXC_TEST_BIN_DIR;
      }
    });

    test(`${key} with an unsupported variable is treated as not configured`, async () => {
      await conf.update(key, "${workspaceFolder}/bin");
      strictEqual(read(new VSCodeConfig()), undefined);
    });

    test(`${key} with a shell metacharacter is treated as not configured`, async () => {
      await conf.update(key, "/opt/bin&calc");
      strictEqual(read(new VSCodeConfig()), undefined);
    });
  }

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
