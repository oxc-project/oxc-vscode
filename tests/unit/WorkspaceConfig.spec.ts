import * as path from "node:path";
import { deepStrictEqual, strictEqual } from "assert";
import { ConfigurationTarget, workspace } from "vscode";
import { DiagnosticPullMode } from "vscode-languageclient";
import { FixKind, RuleCustomization, WorkspaceConfig } from "../../client/WorkspaceConfig.js";
import { WORKSPACE_FOLDER, WORKSPACE_SECOND_FOLDER } from "../test-helpers.js";

const keys = [
  "lint.run",
  "configPath",
  "tsConfigPath",
  "unusedDisableDirectives",
  "typeAware",
  "disableNestedConfig",
  "fixKind",
  "lint.customization",
  "fmt.configPath",
  "fmt.disableNestedConfig",
  "workingDirectories",
  "enable",
  "enable.oxlint",
  "enable.oxfmt",
  "requireConfig",
  // deprecated
  "flags",
];

suite("WorkspaceConfig", () => {
  const updateConfiguration = async (key: string, value: unknown) => {
    const workspaceConfig = workspace.getConfiguration("oxc", WORKSPACE_FOLDER);
    const globalConfig = workspace.getConfiguration("oxc", null);

    await Promise.all([
      workspaceConfig.update(key, value, ConfigurationTarget.WorkspaceFolder),
      // VSCode will not save different workspace configuration inside a `.code-workspace` file.
      // Do not fail, we will make sure the global config is empty too.
      globalConfig.update(key, value),
      // the user settings are shared by every suite, they must not keep a value
      globalConfig.update(key, value, ConfigurationTarget.Global),
    ]);
  };

  const updateSecondFolderConfiguration = async (key: string, value: unknown) => {
    if (WORKSPACE_SECOND_FOLDER === undefined) {
      return;
    }

    await workspace
      .getConfiguration("oxc", WORKSPACE_SECOND_FOLDER)
      .update(key, value, ConfigurationTarget.WorkspaceFolder);
  };

  setup(async () => {
    await Promise.all([
      ...keys.map((key) => updateConfiguration(key, undefined)),
      ...keys.map((key) => updateSecondFolderConfiguration(key, undefined)),
    ]);
  });
  teardown(async () => {
    await Promise.all([
      ...keys.map((key) => updateConfiguration(key, undefined)),
      ...keys.map((key) => updateSecondFolderConfiguration(key, undefined)),
    ]);
  });

  test("default values on initialization", () => {
    const config = new WorkspaceConfig(WORKSPACE_FOLDER);
    strictEqual(config.runTrigger, "onType");
    strictEqual(config.configPath, null);
    strictEqual(config.tsConfigPath, null);
    strictEqual(config.unusedDisableDirectives, null);
    strictEqual(config.typeAware, null);
    strictEqual(config.disableNestedConfig, false);
    strictEqual(config.fixKind, null);
    strictEqual(config.rulesCustomization, null);
    strictEqual(config.formattingConfigPath, null);
    strictEqual(config.formattingDisableNestedConfig, false);
    deepStrictEqual(config.workingDirectories, []);
    strictEqual(config.enableOxlint, true);
    strictEqual(config.enableOxfmt, true);
    strictEqual(config.requireConfig, false);
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
      config.updateTsConfigPath("./tsconfig.json"),
      config.updateUnusedDisableDirectives("deny"),
      config.updateTypeAware(true),
      config.updateDisableNestedConfig(true),
      config.updateFixKind(FixKind.DangerousFix),
      config.updateRulesCustomization({ "some.rule": { autofix: false } }),
      config.updateFormattingConfigPath("./oxfmt.json"),
      config.updateFormattingDisableNestedConfig(true),
    ]);

    const wsConfig = workspace.getConfiguration("oxc", WORKSPACE_FOLDER);

    strictEqual(wsConfig.get("lint.run"), "onSave");
    strictEqual(wsConfig.get("configPath"), "./somewhere");
    strictEqual(wsConfig.get("tsConfigPath"), "./tsconfig.json");
    strictEqual(wsConfig.get("unusedDisableDirectives"), "deny");
    strictEqual(wsConfig.get("typeAware"), true);
    strictEqual(wsConfig.get("disableNestedConfig"), true);
    strictEqual(wsConfig.get("fixKind"), "dangerous_fix");
    strictEqual(
      wsConfig.get<Record<string, RuleCustomization>>("lint.customization")!["some.rule"]?.[
        "autofix"
      ],
      false,
    );
    strictEqual(wsConfig.get("fmt.configPath"), "./oxfmt.json");
    strictEqual(wsConfig.get("fmt.disableNestedConfig"), true);
  });

  test("toOxlintConfig method", async () => {
    const config = new WorkspaceConfig(WORKSPACE_FOLDER);

    const oxlintConfig = config.toOxlintConfig();
    strictEqual(oxlintConfig.run, "onType");
    strictEqual(oxlintConfig.configPath, undefined);
    strictEqual(oxlintConfig.tsConfigPath, undefined);
    strictEqual(oxlintConfig.unusedDisableDirectives, undefined);
    strictEqual(oxlintConfig.typeAware, undefined);
    strictEqual(oxlintConfig.disableNestedConfig, false);
    strictEqual(oxlintConfig.fixKind, undefined);
    strictEqual(oxlintConfig.rulesCustomization, undefined);
    deepStrictEqual(oxlintConfig.workingDirectories, []);

    await Promise.all([
      config.updateRunTrigger(DiagnosticPullMode.onSave),
      config.updateConfigPath("./somewhere"),
      config.updateTsConfigPath("./tsconfig.json"),
      config.updateUnusedDisableDirectives("deny"),
      config.updateTypeAware(true),
      config.updateDisableNestedConfig(true),
      config.updateFixKind(FixKind.DangerousFix),
      config.updateFormattingConfigPath("./oxfmt.json"),
      config.updateRulesCustomization({ "some.rule": { autofix: false } }),
    ]);

    const oxlintConfigUpdated = config.toOxlintConfig();

    strictEqual(oxlintConfigUpdated.run, "onSave");
    strictEqual(oxlintConfigUpdated.configPath, "./somewhere");
    strictEqual(oxlintConfigUpdated.tsConfigPath, "./tsconfig.json");
    strictEqual(oxlintConfigUpdated.unusedDisableDirectives, "deny");
    strictEqual(oxlintConfigUpdated.typeAware, true);
    strictEqual(oxlintConfigUpdated.disableNestedConfig, true);
    strictEqual(oxlintConfigUpdated.fixKind, "dangerous_fix");
    strictEqual(oxlintConfigUpdated.rulesCustomization!["some.rule"]?.autofix, false);
  });

  test("toOxfmtConfig method", async () => {
    const config = new WorkspaceConfig(WORKSPACE_FOLDER);

    const oxfmtConfig = config.toOxfmtConfig();
    strictEqual(oxfmtConfig["fmt.configPath"], undefined);
    strictEqual(oxfmtConfig["fmt.disableNestedConfig"], false);
    deepStrictEqual(oxfmtConfig.workingDirectories, []);

    await Promise.all([
      config.updateFormattingConfigPath("./oxfmt.json"),
      config.updateFormattingDisableNestedConfig(true),
    ]);

    const oxfmtConfigUpdated = config.toOxfmtConfig();

    // @ts-expect-error -- deprecated setting, kept for backward compatibility
    strictEqual(oxfmtConfigUpdated["fmt.experimental"], true);
    strictEqual(oxfmtConfigUpdated["fmt.configPath"], "./oxfmt.json");
    strictEqual(oxfmtConfigUpdated["fmt.disableNestedConfig"], true);
  });

  test("rule 7: workingDirectories is always sent to both the oxlint and the oxfmt config", async () => {
    // rule 7 of the `ClientLifecycle` semantics
    const config = new WorkspaceConfig(WORKSPACE_FOLDER);

    // an empty list is sent too, so that clearing the setting is unambiguous
    deepStrictEqual(config.toOxlintConfig().workingDirectories, []);
    deepStrictEqual(config.toOxfmtConfig().workingDirectories, []);

    const workingDirectories = ["packages/*", { directory: "client" }, { mode: "auto" }];
    await workspace
      .getConfiguration("oxc", WORKSPACE_FOLDER)
      .update("workingDirectories", workingDirectories, ConfigurationTarget.WorkspaceFolder);
    config.refresh();

    deepStrictEqual(config.toOxlintConfig().workingDirectories, [
      "packages/*",
      { directory: "client" },
      { mode: "auto" },
    ]);
    deepStrictEqual(config.toOxfmtConfig().workingDirectories, [
      "packages/*",
      { directory: "client" },
      { mode: "auto" },
    ]);
    deepStrictEqual(workspace.getConfiguration("oxc", WORKSPACE_FOLDER).get("workingDirectories"), [
      "packages/*",
      { directory: "client" },
      { mode: "auto" },
    ]);
  });

  test("workingDirectories is read per workspace folder", async () => {
    if (WORKSPACE_SECOND_FOLDER === undefined) {
      return;
    }

    await workspace
      .getConfiguration("oxc", WORKSPACE_FOLDER)
      .update("workingDirectories", ["packages/*"], ConfigurationTarget.WorkspaceFolder);

    const firstConfig = new WorkspaceConfig(WORKSPACE_FOLDER);
    const secondConfig = new WorkspaceConfig(WORKSPACE_SECOND_FOLDER);

    deepStrictEqual(firstConfig.workingDirectories, ["packages/*"]);
    deepStrictEqual(secondConfig.workingDirectories, []);
  });

  test("enable and requireConfig are read per workspace folder", async () => {
    if (WORKSPACE_SECOND_FOLDER === undefined) {
      return;
    }

    const secondFolderConfiguration = workspace.getConfiguration("oxc", WORKSPACE_SECOND_FOLDER);
    await Promise.all([
      secondFolderConfiguration.update("enable.oxlint", false, ConfigurationTarget.WorkspaceFolder),
      secondFolderConfiguration.update("requireConfig", true, ConfigurationTarget.WorkspaceFolder),
    ]);

    const firstConfig = new WorkspaceConfig(WORKSPACE_FOLDER);
    const secondConfig = new WorkspaceConfig(WORKSPACE_SECOND_FOLDER);

    strictEqual(firstConfig.enableOxlint, true);
    strictEqual(firstConfig.requireConfig, false);
    strictEqual(secondConfig.enableOxlint, false);
    // `oxc.enable.oxfmt` is not affected by `oxc.enable.oxlint`
    strictEqual(secondConfig.enableOxfmt, true);
    strictEqual(secondConfig.requireConfig, true);
  });

  test("rule 5: a folder level `enable.oxlint` wins over a user level `enable`", async () => {
    // rule 5 of the `ClientLifecycle` semantics:
    // `oxc.enable` only wins when it is set at the same or at a higher precedence level
    await workspace.getConfiguration("oxc").update("enable", true, ConfigurationTarget.Global);
    await workspace
      .getConfiguration("oxc", WORKSPACE_FOLDER)
      .update("enable.oxlint", false, ConfigurationTarget.WorkspaceFolder);

    const config = new WorkspaceConfig(WORKSPACE_FOLDER);

    strictEqual(config.enableOxlint, false);
    strictEqual(config.enableOxfmt, true);
  });

  test("rule 5: `enable` of the same level wins over `enable.oxlint`", async () => {
    // rule 5 of the `ClientLifecycle` semantics
    const folderConfiguration = workspace.getConfiguration("oxc", WORKSPACE_FOLDER);
    await folderConfiguration.update("enable", false, ConfigurationTarget.WorkspaceFolder);
    await folderConfiguration.update("enable.oxlint", true, ConfigurationTarget.WorkspaceFolder);

    const config = new WorkspaceConfig(WORKSPACE_FOLDER);

    strictEqual(config.enableOxlint, false);
    strictEqual(config.enableOxfmt, false);
  });

  test("workspace-level relative paths resolve from code-workspace location", async () => {
    if (!workspace.workspaceFile) {
      return;
    }

    const relativePath = "fixtures/deep/tsconfig.json";
    await workspace
      .getConfiguration("oxc")
      .update("tsConfigPath", relativePath, ConfigurationTarget.Workspace);

    const config = new WorkspaceConfig(WORKSPACE_FOLDER);
    const oxlintConfig = config.toOxlintConfig();

    strictEqual(
      oxlintConfig.tsConfigPath,
      path.resolve(path.dirname(workspace.workspaceFile.fsPath), relativePath),
    );

    await workspace
      .getConfiguration("oxc")
      .update("tsConfigPath", undefined, ConfigurationTarget.Workspace);
  });
});
