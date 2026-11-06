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
import { IDisposable, OxcTool } from "./types";
import { VSCodeConfig } from "./VSCodeConfig";
import {
  OxfmtWorkspaceConfigInterface,
  OxlintWorkspaceConfigInterface,
  WorkspaceConfig,
} from "./WorkspaceConfig";

/** The settings which decide what the client of a tool handles. */
const clientStateSections: Record<OxcTool, readonly string[]> = {
  oxlint: ["enable", "enable.oxlint", "requireConfig"],
  oxfmt: ["enable", "enable.oxfmt"],
};

/**
 * Whether a configuration change can change what the client of the tool handles.
 *
 * `affectsConfiguration` matches the changed keys against the section as a prefix: a change of
 * `oxc.enable` is **not** reported for the section `oxc.enable.oxlint`, while a change of
 * `oxc.enable.oxlint` is reported for the section `oxc.enable`. The parent and the tool specific
 * key are therefore both listed, and the change of the other tool which the parent also reports is
 * skipped by the state key.
 */
export function affectsClientState(
  event: ConfigurationChangeEvent,
  tool: OxcTool,
  scope?: WorkspaceFolder,
): boolean {
  return clientStateSections[tool].some((section) =>
    event.affectsConfiguration(`${ConfigService.namespace}.${section}`, scope),
  );
}

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

    // `${env:NAME}` is only substituted in trusted workspaces, so resolve again once trust is granted
    this._disposables.push(
      workspace.onDidGrantWorkspaceTrust(async () => {
        this.vsCodeConfig.refresh();
        for (const workspaceConfig of this.workspaceConfigs.values()) {
          workspaceConfig.refresh();
        }
        await this.onConfigChange?.({ affectsConfiguration: () => true });
      }),
    );
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
   * The configuration of the workspace folder which contains `resource`.
   * Resources outside of every workspace folder, like untitled documents, have none.
   */
  private workspaceConfigOf(resource: Uri): WorkspaceConfig | undefined {
    const folder = workspace.getWorkspaceFolder(resource);
    return folder === undefined ? undefined : this.getWorkspaceConfig(folder.uri);
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
   * Whether the tool is enabled for `resource`, resources outside of every workspace folder use
   * the window level value.
   */
  public isToolEnabled(tool: OxcTool, resource: Uri): boolean {
    return (this.workspaceConfigOf(resource) ?? this.vsCodeConfig).isEnabled(tool);
  }

  /**
   * Whether a workspace folder resolves the enable setting differently than the window,
   * in both directions.
   */
  public overridesToolEnabledInAnyWorkspace(tool: OxcTool): boolean {
    return this.someWorkspace(
      (config) => config.isEnabled(tool) !== this.vsCodeConfig.isEnabled(tool),
      false,
    );
  }

  /**
   * `oxc.requireConfig` of the workspace folder which contains `resource`.
   */
  public requiresConfig(resource: Uri): boolean {
    return (this.workspaceConfigOf(resource) ?? this.vsCodeConfig).requireConfig;
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

    const workspaceConfig = this.workspaceConfigOf(textDocumentUri);
    if (workspaceConfig !== undefined) {
      return workspaceConfig.shouldRequestDiagnostics(diagnosticPullMode);
    }

    // documents outside of every workspace folder follow the window level value
    return this.vsCodeConfig.runTrigger === diagnosticPullMode;
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
