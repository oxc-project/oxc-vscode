import {
  type ConfigurationChangeEvent,
  Uri,
  type WorkspaceFolder,
  workspace,
} from "vscode";
import type { DiagnosticPullMode } from "vscode-languageclient";
import {
  type BinarySearchResult,
  findExecutableBinary,
} from "./findBinary";
import type { IDisposable } from "./types";
import { VSCodeConfig } from "./VSCodeConfig";
import {
  type BiomeWorkspaceConfigInterface,
  WorkspaceConfig,
} from "./WorkspaceConfig";

export class ConfigService implements IDisposable {
  public static readonly namespace = "biome";
  private readonly _disposables: IDisposable[] = [];

  public vsCodeConfig: VSCodeConfig;

  private workspaceConfigs: Map<string, WorkspaceConfig> = new Map();

  /** Single-flight cache: stores the in-flight or resolved Promise so concurrent
   * callers share one waterfall run instead of racing each other. */
  private _binaryPathCache: Promise<BinarySearchResult | undefined> | undefined;

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

  public get biomeServerConfig(): {
    workspaceUri: string;
    options: BiomeWorkspaceConfigInterface;
  }[] {
    return [...this.workspaceConfigs.entries()].map(([path, config]) => {
      return {
        workspaceUri: Uri.file(path).toString(),
        options: config.toBiomeConfig(),
      };
    });
  }

  public addWorkspaceConfig(workspace: WorkspaceFolder): void {
    this.workspaceConfigs.set(
      workspace.uri.fsPath,
      new WorkspaceConfig(workspace),
    );
  }

  public removeWorkspaceConfig(workspace: WorkspaceFolder): void {
    this.workspaceConfigs.delete(workspace.uri.fsPath);
  }

  public getWorkspaceConfig(workspace: Uri): WorkspaceConfig | undefined {
    return this.workspaceConfigs.get(workspace.fsPath);
  }

  public effectsWorkspaceConfigChange(
    event: ConfigurationChangeEvent,
  ): boolean {
    for (const workspaceConfig of this.workspaceConfigs.values()) {
      if (workspaceConfig.effectsConfigChange(event)) {
        return true;
      }
    }
    return false;
  }

  public getBiomeServerBinPath(): Promise<BinarySearchResult | undefined> {
    this._binaryPathCache ??= findExecutableBinary(
      "biome",
      this.vsCodeConfig.binPathBiome,
    );
    return this._binaryPathCache;
  }

  /** Drops the cached binary resolution so the next call re-probes the filesystem. */
  public invalidateBinaryCache(): void {
    this._binaryPathCache = undefined;
  }

  public shouldRequestDiagnostics(
    textDocumentUri: Uri,
    diagnosticPullMode: DiagnosticPullMode,
  ): boolean {
    if (!this.vsCodeConfig.enableBiome) {
      return false;
    }

    const ws = workspace.getWorkspaceFolder(textDocumentUri);
    if (!ws) {
      return false;
    }
    const workspaceConfig = this.getWorkspaceConfig(ws.uri);

    return (
      workspaceConfig?.shouldRequestDiagnostics(diagnosticPullMode) ?? false
    );
  }

  private async onVscodeConfigChange(
    event: ConfigurationChangeEvent,
  ): Promise<void> {
    let isConfigChanged = false;

    if (event.affectsConfiguration(ConfigService.namespace)) {
      this.vsCodeConfig.refresh();
      this.invalidateBinaryCache();
      isConfigChanged = true;
    }

    for (const workspaceConfig of this.workspaceConfigs.values()) {
      if (workspaceConfig.effectsConfigChange(event)) {
        workspaceConfig.refresh();
        isConfigChanged = true;
      }
    }

    if (isConfigChanged) {
      await this.onConfigChange?.(event);
    }
  }

  dispose() {
    for (const disposable of this._disposables) {
      void disposable.dispose();
    }
  }
}
