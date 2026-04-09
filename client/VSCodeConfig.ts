import { type ConfigurationChangeEvent, workspace } from "vscode";
import { ConfigService } from "./ConfigService";

export class VSCodeConfig implements VSCodeConfigInterface {
  private _enableBiome!: boolean;
  private _trace!: TraceLevel;
  private _binPathBiome: string | undefined;
  private _nodePath: string | undefined;
  private _useExecPath: boolean = false;
  private _requireConfig!: boolean;

  constructor() {
    this.refresh();
  }

  private get configuration() {
    return workspace.getConfiguration(ConfigService.namespace);
  }

  public refresh(): void {
    const enable = this.configuration.get<boolean | null>("enable") ?? true;

    this._enableBiome = enable;
    this._trace = this.configuration.get<TraceLevel>("trace.server") || "off";
    this._binPathBiome = this.configuration.get<string>("path.biome");
    this._nodePath = this.configuration.get<string>("path.node");
    this._useExecPath = this.configuration.get<boolean>("useExecPath") ?? false;
    this._requireConfig =
      this.configuration.get<boolean>("requireConfig") ?? false;
  }

  get enableBiome(): boolean {
    return this._enableBiome;
  }

  updateEnableBiome(value: boolean): PromiseLike<void> {
    this._enableBiome = value;
    return this.configuration.update("enable", value);
  }

  get trace(): TraceLevel {
    return this._trace;
  }

  updateTrace(value: TraceLevel): PromiseLike<void> {
    this._trace = value;
    return this.configuration.update("trace.server", value);
  }

  get binPathBiome(): string | undefined {
    return this._binPathBiome;
  }

  updateBinPathBiome(value: string | undefined): PromiseLike<void> {
    this._binPathBiome = value;
    return this.configuration.update("path.biome", value);
  }

  get nodePath(): string | undefined {
    return this._nodePath;
  }

  updateNodePath(value: string | undefined): PromiseLike<void> {
    this._nodePath = value;
    return this.configuration.update("path.node", value);
  }

  get useExecPath(): boolean {
    return this._useExecPath;
  }

  updateUseExecPath(value: boolean): PromiseLike<void> {
    this._useExecPath = value;
    return this.configuration.update("useExecPath", value);
  }

  get requireConfig(): boolean {
    return this._requireConfig;
  }

  updateRequireConfig(value: boolean): PromiseLike<void> {
    this._requireConfig = value;
    return this.configuration.update("requireConfig", value);
  }

  /**
   * These configuration changes need a complete restart of the language server
   */
  private effectsGeneralLSPConnection(
    event: ConfigurationChangeEvent,
  ): boolean {
    return (
      event.affectsConfiguration(`${ConfigService.namespace}.path.node`) ||
      event.affectsConfiguration(`${ConfigService.namespace}.useExecPath`)
    );
  }

  effectsBiomeConnection(event: ConfigurationChangeEvent): boolean {
    return (
      event.affectsConfiguration(`${ConfigService.namespace}.path.biome`) ||
      this.effectsGeneralLSPConnection(event)
    );
  }
}

type TraceLevel = "off" | "messages" | "verbose";

/**
 * See `"contributes.configuration"` in `package.json`
 */
interface VSCodeConfigInterface {
  /**
   * `biome.enable`
   * @default true
   */
  enableBiome: boolean;
  /**
   * Trace VSCode <-> Biome Language Server communication
   * `biome.trace.server`
   *
   * @default 'off'
   */
  trace: TraceLevel;
  /**
   * Path to the `biome` binary
   * `biome.path.biome`
   * @default undefined
   */
  binPathBiome: string | undefined;

  /**
   * Path to a JavaScript runtime binary (Node.js, bun, or deno)
   * `biome.path.node`
   * @default undefined
   */
  nodePath: string | undefined;

  /**
   * Whether to use the extension's execPath (Electron's bundled Node.js) as the JavaScript runtime for running Biome tools,
   * instead of looking for a system Node.js installation.
   */
  useExecPath: boolean;

  /**
   * Start the language server only when a `biome.json` file exists in one of the workspaces.
   * `biome.requireConfig`
   * @default false
   */
  requireConfig: boolean;
}
