import { strictEqual } from "node:assert";
import { workspace } from "vscode";
import { WorkspaceConfig } from "../../client/WorkspaceConfig.js";
import { WORKSPACE_FOLDER } from "../test-helpers.js";

const keys = ["lint.run", "configPath", "disableNestedConfig"];

suite("WorkspaceConfig", () => {
  const updateConfiguration = async (key: string, value: unknown) => {
    const workspaceConfig = workspace.getConfiguration(
      "biome",
      WORKSPACE_FOLDER,
    );
    await workspaceConfig.update(key, value);
  };

  setup(async () => {
    await Promise.all(keys.map((key) => updateConfiguration(key, undefined)));
  });

  teardown(async () => {
    await Promise.all(keys.map((key) => updateConfiguration(key, undefined)));
  });

  test("default values on initialization", () => {
    const config = new WorkspaceConfig(WORKSPACE_FOLDER);
    strictEqual(config.runTrigger, "onType");
    strictEqual(config.configPath, null);
    strictEqual(config.disableNestedConfig, false);
  });

  test("refresh correctly populates properties from configuration", async () => {
    const config = new WorkspaceConfig(WORKSPACE_FOLDER);
    await updateConfiguration("lint.run", "onSave");
    await updateConfiguration("configPath", "./custom-biome.json");
    await updateConfiguration("disableNestedConfig", true);

    config.refresh();

    strictEqual(config.runTrigger, "onSave");
    strictEqual(config.configPath, "./custom-biome.json");
    strictEqual(config.disableNestedConfig, true);
  });

  test("toBiomeConfig method", () => {
    const config = new WorkspaceConfig(WORKSPACE_FOLDER);
    const biomeConfig = config.toBiomeConfig();
    strictEqual(biomeConfig.run, "onType");
    strictEqual(biomeConfig.configPath, null);
    strictEqual(biomeConfig.disableNestedConfig, false);
  });
});
