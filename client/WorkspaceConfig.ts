import {
  type ConfigurationChangeEvent,
  type WorkspaceFolder,
  workspace,
} from "vscode";
import { DiagnosticPullMode } from "vscode-languageclient";
import { ConfigService } from "./ConfigService";

export const biomeConfigDefaultFilePattern =
  "**/{biome.json,biome.jsonc,.biome.json,.biome.jsonc}";

/**
 * This interface defines the configuration sent between the VS Code extension and the LSP.
 * Extension configuration is handled by `VSCodeConfig`.
 */
export interface BiomeWorkspaceConfigInterface {
  /**
   * biome config path
   * `biome.configPath`
   */
  configPath?: string | null;

  /**
   * When to run the linter and generate diagnostics
   * `biome.lint.run`
   */
  run?: DiagnosticPullMode;

  /**
   * Disable nested config files detection
   * `biome.disableNestedConfig`
   */
  disableNestedConfig?: boolean;

  /**
   * Any other settings under the 'biome' namespace.
   */
  [key: string]: unknown;
}

export class WorkspaceConfig {
  private _config: BiomeWorkspaceConfigInterface = {};

  constructor(private readonly workspace: WorkspaceFolder) {
    this.refresh();
  }

  private get configuration() {
    return workspace.getConfiguration(ConfigService.namespace, this.workspace);
  }

  public refresh(): void {
    const config = this.configuration;

    // Explicitly pull known settings for backwards compatibility and clarity
    const run =
      config.get<DiagnosticPullMode>("lint.run") || DiagnosticPullMode.onSave;
    const configPath = config.get<string | null>("configPath") ?? null;
    const disableNestedConfig =
      config.get<boolean>("disableNestedConfig") ?? false;

    // We build the config object. To be truly dynamic, we'd iterate over all 'biome.*' keys,
    // but VS Code's getConfiguration doesn't make it easy without knowing the keys beforehand.
    // However, the LSP client will handle the 'configuration' request which calls this.

    this._config = {
      run,
      configPath,
      disableNestedConfig,
      // In the future, if we add more settings to package.json, we can add them here
      // or we can try to automate it if we have a list of all settings.
    };
  }

  public effectsConfigChange(event: ConfigurationChangeEvent): boolean {
    const ns = ConfigService.namespace;
    return (
      event.affectsConfiguration(`${ns}.configPath`, this.workspace) ||
      event.affectsConfiguration(`${ns}.lint.run`, this.workspace) ||
      event.affectsConfiguration(`${ns}.disableNestedConfig`, this.workspace)
    );
  }

  get runTrigger(): DiagnosticPullMode {
    return (
      (this._config.run as DiagnosticPullMode) || DiagnosticPullMode.onSave
    );
  }

  get configPath(): string | null {
    return (this._config.configPath as string | null) ?? null;
  }

  get disableNestedConfig(): boolean {
    return (this._config.disableNestedConfig as boolean) ?? false;
  }

  public shouldRequestDiagnostics(
    diagnosticPullMode: DiagnosticPullMode,
  ): boolean {
    return diagnosticPullMode === this.runTrigger;
  }

  public toBiomeConfig(): BiomeWorkspaceConfigInterface {
    return this._config;
  }
}
