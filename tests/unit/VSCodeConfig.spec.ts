import { strictEqual } from "assert";
import { workspace } from "vscode";
import { VSCodeConfig } from "../../client/VSCodeConfig.js";

const conf = workspace.getConfiguration("oxc");

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
  ];
  setup(async () => {
    await Promise.all(keys.map((key) => conf.update(key, undefined)));
  });

  teardown(async () => {
    await Promise.all(keys.map((key) => conf.update(key, undefined)));
  });

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
  });

  test("deprecated values are respected", async () => {
    await conf.update("path.server", "./deprecatedBinary");
    const config = new VSCodeConfig();

    strictEqual(config.binPathOxlint, "./deprecatedBinary");
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

    strictEqual(config.enableOxlint, false);
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
  });
});
