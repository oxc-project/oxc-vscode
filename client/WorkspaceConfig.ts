import {
  type ConfigurationChangeEvent,
  type WorkspaceFolder,
  workspace,
} from "vscode";
import { DiagnosticPullMode } from "vscode-languageclient";
import { ConfigService } from "./ConfigService";

export const biomeConfigDefaultFilePattern = "**/{biome.json,biome.jsonc}";

/**
 * This interface defines the configuration sent between the VS Code extension and the LSP.
 * Extension configuration is handled by `VSCodeConfig`.
 */
interface WorkspaceConfigInterface {
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
}

export type BiomeWorkspaceConfigInterface = WorkspaceConfigInterface;

export class WorkspaceConfig {
  private _configPath: string | null = null;
  private _runTrigger: DiagnosticPullMode = DiagnosticPullMode.onType;
  private _disableNestedConfig: boolean = false;

  constructor(private readonly workspace: WorkspaceFolder) {
    this.refresh();
  }

  private get configuration() {
    return workspace.getConfiguration(ConfigService.namespace, this.workspace);
  }

  public refresh(): void {
    this._runTrigger =
      this.configuration.get<DiagnosticPullMode>("lint.run") ||
      DiagnosticPullMode.onType;
    this._configPath =
      this.configuration.get<string | null>("configPath") ?? null;
    this._disableNestedConfig =
      this.configuration.get<boolean>("disableNestedConfig") ?? false;
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
    return this._runTrigger;
  }

  get configPath(): string | null {
    return this._configPath;
  }

  get disableNestedConfig(): boolean {
    return this._disableNestedConfig;
  }

  public shouldRequestDiagnostics(
    diagnosticPullMode: DiagnosticPullMode,
  ): boolean {
    return diagnosticPullMode === this.runTrigger;
  }

  public toBiomeConfig(): BiomeWorkspaceConfigInterface {
    return {
      configPath: this.configPath,
      run: this.runTrigger,
      disableNestedConfig: this.disableNestedConfig,
    };
  }
}
