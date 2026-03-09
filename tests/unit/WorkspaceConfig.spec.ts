import { strictEqual } from "assert";
import { ConfigurationTarget, workspace } from "vscode";
import { DiagnosticPullMode } from "vscode-languageclient";
import { FixKind, WorkspaceConfig } from "../../client/WorkspaceConfig.js";
import { WORKSPACE_FOLDER } from "../test-helpers.js";

const keys = [
  "lint.run",
  "configPath",
  "configField",
  "tsConfigPath",
  "unusedDisableDirectives",
  "typeAware",
  "disableNestedConfig",
  "fixKind",
  "fmt.configPath",
  "fmt.configField",
  // deprecated
  "flags",
];

suite("WorkspaceConfig", () => {
  const updateConfiguration = async (key: string, value: unknown) => {
    const workspaceConfig = workspace.getConfiguration("oxc", WORKSPACE_FOLDER);
    const globalConfig = workspace.getConfiguration("oxc");

    await Promise.all([
      workspaceConfig.update(key, value, ConfigurationTarget.WorkspaceFolder),
      // VSCode will not save different workspace configuration inside a `.code-workspace` file.
      // Do not fail, we will make sure the global config is empty too.
      globalConfig.update(key, value),
    ]);
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
    strictEqual(config.configField, null);
    strictEqual(config.tsConfigPath, null);
    strictEqual(config.unusedDisableDirectives, null);
    strictEqual(config.typeAware, null);
    strictEqual(config.disableNestedConfig, false);
    strictEqual(config.fixKind, "safe_fix");
    strictEqual(config.formattingConfigPath, null);
    strictEqual(config.formattingConfigField, null);
  });

  test("deprecated values are respected", async () => {
    await updateConfiguration("flags", {
      disable_nested_config: "true",
      fix_kind: "dangerous_fix",
    });

    const config = new WorkspaceConfig(WORKSPACE_FOLDER);
    strictEqual(config.disableNestedConfig, true);
    strictEqual(config.fixKind, "dangerous_fix");
  });

  test("updating values updates the workspace configuration", async () => {
    const config = new WorkspaceConfig(WORKSPACE_FOLDER);

    await Promise.all([
      config.updateRunTrigger(DiagnosticPullMode.onSave),
      config.updateConfigPath("./somewhere"),
      config.updateConfigField("lint"),
      config.updateTsConfigPath("./tsconfig.json"),
      config.updateUnusedDisableDirectives("deny"),
      config.updateTypeAware(true),
      config.updateDisableNestedConfig(true),
      config.updateFixKind(FixKind.DangerousFix),
      config.updateFormattingConfigPath("./oxfmt.json"),
      config.updateFormattingConfigField("fmt"),
    ]);

    const wsConfig = workspace.getConfiguration("oxc", WORKSPACE_FOLDER);

    strictEqual(wsConfig.get("lint.run"), "onSave");
    strictEqual(wsConfig.get("configPath"), "./somewhere");
    strictEqual(wsConfig.get("configField"), "lint");
    strictEqual(wsConfig.get("tsConfigPath"), "./tsconfig.json");
    strictEqual(wsConfig.get("unusedDisableDirectives"), "deny");
    strictEqual(wsConfig.get("typeAware"), true);
    strictEqual(wsConfig.get("disableNestedConfig"), true);
    strictEqual(wsConfig.get("fixKind"), "dangerous_fix");
    strictEqual(wsConfig.get("fmt.configPath"), "./oxfmt.json");
    strictEqual(wsConfig.get("fmt.configField"), "fmt");
  });

  test("toOxlintConfig method", async () => {
    const config = new WorkspaceConfig(WORKSPACE_FOLDER);

    const oxlintConfig = config.toOxlintConfig();
    strictEqual(oxlintConfig.run, "onType");
    strictEqual(oxlintConfig.configPath, undefined);
    strictEqual(oxlintConfig.configField, undefined);
    strictEqual(oxlintConfig.tsConfigPath, undefined);
    strictEqual(oxlintConfig.unusedDisableDirectives, undefined);
    strictEqual(oxlintConfig.typeAware, undefined);
    strictEqual(oxlintConfig.disableNestedConfig, false);
    strictEqual(oxlintConfig.fixKind, "safe_fix");

    await Promise.all([
      config.updateRunTrigger(DiagnosticPullMode.onSave),
      config.updateConfigPath("./somewhere"),
      config.updateConfigField("lint"),
      config.updateTsConfigPath("./tsconfig.json"),
      config.updateUnusedDisableDirectives("deny"),
      config.updateTypeAware(true),
      config.updateDisableNestedConfig(true),
      config.updateFixKind(FixKind.DangerousFix),
      config.updateFormattingConfigPath("./oxfmt.json"),
    ]);

    const oxlintConfigUpdated = config.toOxlintConfig();

    strictEqual(oxlintConfigUpdated.run, "onSave");
    strictEqual(oxlintConfigUpdated.configPath, "./somewhere");
    strictEqual(oxlintConfigUpdated.configField, "lint");
    strictEqual(oxlintConfigUpdated.tsConfigPath, "./tsconfig.json");
    strictEqual(oxlintConfigUpdated.unusedDisableDirectives, "deny");
    strictEqual(oxlintConfigUpdated.typeAware, true);
    strictEqual(oxlintConfigUpdated.disableNestedConfig, true);
    strictEqual(oxlintConfigUpdated.fixKind, "dangerous_fix");
  });

  test("configField is ignored without configPath", async () => {
    const config = new WorkspaceConfig(WORKSPACE_FOLDER);

    await config.updateConfigField("lint");

    const oxlintConfig = config.toOxlintConfig();
    strictEqual(oxlintConfig.configField, undefined);

    await config.updateFormattingConfigField("fmt");

    const oxfmtConfig = config.toOxfmtConfig();
    strictEqual(oxfmtConfig["fmt.configField"], undefined);
  });

  test("toOxfmtConfig method", async () => {
    const config = new WorkspaceConfig(WORKSPACE_FOLDER);

    const oxfmtConfig = config.toOxfmtConfig();
    strictEqual(oxfmtConfig["fmt.configPath"], undefined);
    strictEqual(oxfmtConfig["fmt.configField"], undefined);

    await Promise.all([
      config.updateFormattingConfigPath("./oxfmt.json"),
      config.updateFormattingConfigField("fmt"),
    ]);

    const oxfmtConfigUpdated = config.toOxfmtConfig();

    // @ts-expect-error -- deprecated setting, kept for backward compatibility
    strictEqual(oxfmtConfigUpdated["fmt.experimental"], true);
    strictEqual(oxfmtConfigUpdated["fmt.configPath"], "./oxfmt.json");
    strictEqual(oxfmtConfigUpdated["fmt.configField"], "fmt");
  });
});
