import { ConfigurationChangeEvent, Uri, workspace, WorkspaceFolder } from "vscode";
import { DiagnosticPullMode } from "vscode-languageclient";
import {
  BinarySearchResult,
  searchGlobalNodeModulesBin,
  searchEnvPath,
  searchProjectNodeModulesBin,
  searchSettingsBin,
  searchVitePlusBin,
  searchYarnPnpBin,
} from "./findBinary";
import { IDisposable } from "./types";
import { EnabledTools, VSCodeConfig } from "./VSCodeConfig";
import {
  OxfmtWorkspaceConfigInterface,
  OxlintWorkspaceConfigInterface,
  WorkspaceConfig,
} from "./WorkspaceConfig";

/** The tools handled by this extension, each one has its own language server. */
export type OxcTool = "oxlint" | "oxfmt";

const enablePicker: Record<OxcTool, (config: EnabledTools) => boolean> = {
  oxlint: (config) => config.enableOxlint,
  oxfmt: (config) => config.enableOxfmt,
};

export class ConfigService implements IDisposable {
  public static readonly namespace = "oxc";
  private readonly _disposables: IDisposable[] = [];

  public vsCodeConfig: VSCodeConfig;

  private workspaceConfigs: Map<string, WorkspaceConfig> = new Map();

  public onConfigChange:
    | ((this: ConfigService, config: ConfigurationChangeEvent) => Promise<void>)
    | undefined;

  constructor() {
    this.vsCodeConfig = new VSCodeConfig();
    const { workspaceFolders } = workspace;
    if (workspaceFolders) {
      for (const folder of workspaceFolders) {
        this.addWorkspaceConfig(folder);
      }
    }
    this.onConfigChange = undefined;

    const disposeChangeListener = workspace.onDidChangeConfiguration(
      this.onVscodeConfigChange.bind(this),
    );
    this._disposables.push(disposeChangeListener);
  }

  public get oxlintServerConfig(): {
    workspaceUri: string;
    options: OxlintWorkspaceConfigInterface;
  }[] {
    return [...this.workspaceConfigs.entries()].map(([path, config]) => {
      const options = config.toOxlintConfig();

      return {
        workspaceUri: Uri.file(path).toString(),
        options,
      };
    });
  }

  public get formatterServerConfig(): {
    workspaceUri: string;
    options: OxfmtWorkspaceConfigInterface;
  }[] {
    return [...this.workspaceConfigs.entries()].map(([path, config]) => ({
      workspaceUri: Uri.file(path).toString(),
      options: config.toOxfmtConfig(),
    }));
  }

  public addWorkspaceConfig(workspace: WorkspaceFolder): void {
    this.workspaceConfigs.set(workspace.uri.fsPath, new WorkspaceConfig(workspace));
  }

  public removeWorkspaceConfig(workspace: WorkspaceFolder): void {
    this.workspaceConfigs.delete(workspace.uri.fsPath);
  }

  public getWorkspaceConfig(workspace: Uri): WorkspaceConfig | undefined {
    return this.workspaceConfigs.get(workspace.fsPath);
  }

  /**
   * Resolves a `resource` scoped setting for the workspace folder which contains `resource`.
   * Resources outside of every workspace folder, like untitled documents, use `fallback`.
   */
  private forResource<T>(resource: Uri, pick: (config: WorkspaceConfig) => T, fallback: T): T {
    const folder = workspace.getWorkspaceFolder(resource);
    const config = folder === undefined ? undefined : this.getWorkspaceConfig(folder.uri);
    return config === undefined ? fallback : pick(config);
  }

  /**
   * Whether at least one workspace folder resolves the setting to `true`.
   * Without any workspace folder, the window level value is used.
   */
  private someWorkspace(pick: (config: WorkspaceConfig) => boolean, fallback: boolean): boolean {
    if (this.workspaceConfigs.size === 0) {
      return fallback;
    }
    return [...this.workspaceConfigs.values()].some(pick);
  }

  /**
   * Whether the tool is enabled for `resource`.
   */
  public isToolEnabled(tool: OxcTool, resource: Uri): boolean {
    return this.forResource(resource, enablePicker[tool], enablePicker[tool](this.vsCodeConfig));
  }

  /**
   * Whether the workspace folder resolves the enable setting differently than the window,
   * in both directions.
   */
  public overridesToolEnabled(tool: OxcTool, resource: Uri): boolean {
    return this.isToolEnabled(tool, resource) !== enablePicker[tool](this.vsCodeConfig);
  }

  /**
   * `oxc.requireConfig` of the workspace folder which contains `resource`.
   */
  public requiresConfig(resource: Uri): boolean {
    return this.forResource(
      resource,
      (config) => config.requireConfig,
      this.vsCodeConfig.requireConfig,
    );
  }

  /**
   * Whether at least one workspace folder requires a configuration file.
   */
  public requiresConfigInAnyWorkspace(): boolean {
    return this.someWorkspace((config) => config.requireConfig, this.vsCodeConfig.requireConfig);
  }

  public effectsWorkspaceConfigChange(event: ConfigurationChangeEvent): boolean {
    for (const workspaceConfig of this.workspaceConfigs.values()) {
      if (workspaceConfig.effectsServerOptionsChange(event)) {
        return true;
      }
    }
    return false;
  }

  public async getOxlintServerBinPath(): Promise<BinarySearchResult | undefined> {
    return this.searchBinaryPath(this.vsCodeConfig.binPathOxlint, "oxlint");
  }

  public async getOxfmtServerBinPath(): Promise<BinarySearchResult | undefined> {
    return this.searchBinaryPath(this.vsCodeConfig.binPathOxfmt, "oxfmt");
  }

  public shouldRequestDiagnostics(
    textDocumentUri: Uri,
    diagnosticPullMode: DiagnosticPullMode,
  ): boolean {
    if (!this.isToolEnabled("oxlint", textDocumentUri)) {
      return false;
    }

    const folder = workspace.getWorkspaceFolder(textDocumentUri);
    const workspaceConfig = folder === undefined ? undefined : this.getWorkspaceConfig(folder.uri);
    if (workspaceConfig !== undefined) {
      return workspaceConfig.shouldRequestDiagnostics(diagnosticPullMode);
    }

    // documents outside of every workspace folder follow the window level value
    const runTrigger =
      workspace
        // `null` selects the window level value of this `resource` scoped setting
        .getConfiguration(ConfigService.namespace, null)
        .get<DiagnosticPullMode>("lint.run") ?? DiagnosticPullMode.onType;

    return runTrigger === diagnosticPullMode;
  }

  private async searchBinaryPath(
    settingsBinary: string | undefined,
    defaultBinaryName: string,
  ): Promise<BinarySearchResult | undefined> {
    if (settingsBinary) {
      return searchSettingsBin(defaultBinaryName, settingsBinary);
    }

    return (
      searchVitePlusBin(defaultBinaryName === "oxlint" ? "lint" : "fmt") ??
      (await searchProjectNodeModulesBin(defaultBinaryName)) ??
      (await searchYarnPnpBin(defaultBinaryName)) ??
      (await searchGlobalNodeModulesBin(defaultBinaryName)) ??
      (await searchEnvPath(defaultBinaryName))
    );
  }

  private async onVscodeConfigChange(event: ConfigurationChangeEvent): Promise<void> {
    if (!event.affectsConfiguration(ConfigService.namespace)) {
      return;
    }

    this.vsCodeConfig.refresh();
    // `resource` scoped settings are resolved per workspace folder, refresh the affected ones.
    for (const workspaceConfig of this.workspaceConfigs.values()) {
      if (workspaceConfig.effectsConfigChange(event)) {
        workspaceConfig.refresh();
      }
    }

    await this.onConfigChange?.(event);
  }

  dispose() {
    for (const disposable of this._disposables) {
      void disposable.dispose();
    }
  }
}
