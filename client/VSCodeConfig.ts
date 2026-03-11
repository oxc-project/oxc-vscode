import { ConfigurationChangeEvent, workspace } from "vscode";
import { ConfigService } from "./ConfigService";

export class VSCodeConfig implements VSCodeConfigInterface {
  private _enableOxlint!: boolean;
  private _enableOxfmt!: boolean;
  private _trace!: TraceLevel;
  private _binPathOxlint: string | undefined;
  private _binPathOxfmt: string | undefined;
  private _binPathTsGoLint: string | undefined;
  private _nodePath: string | undefined;
  private _useExecPath: boolean = false;
  private _requireConfig!: boolean;
  private _suppressProgramErrors!: boolean;

  constructor() {
    this.refresh();
  }

  private get configuration() {
    return workspace.getConfiguration(ConfigService.namespace);
  }

  public refresh(): void {
    let binPathOxlint = this.configuration.get<string>("path.oxlint");
    // fallback to deprecated 'path.server' setting
    if (!binPathOxlint) {
      binPathOxlint = this.configuration.get<string>("path.server");
    }
    let enable =
      this.configuration.get<boolean | null | { oxlint?: boolean; oxfmt?: boolean }>("enable") ??
      true;

    if (typeof enable === "boolean") {
      // If main enable is true, both tools are enabled
      // this is how VS Code resolves config. `oxc.enable` always wins over  `oxc.enable.oxlint` and `oxc.enable.oxfmt`
      enable = { oxlint: enable, oxfmt: enable };
    } else if (typeof enable === "object") {
      // If main enable is an object, we need to ensure both keys are present
      enable = {
        oxlint: enable.oxlint ?? true,
        oxfmt: enable.oxfmt ?? true,
      };
    } else {
      // Fallback to enabling both if the config is somehow invalid
      enable = { oxlint: true, oxfmt: true };
    }

    this._enableOxlint = enable.oxlint!;
    this._enableOxfmt = enable.oxfmt!;
    this._trace = this.configuration.get<TraceLevel>("trace.server") || "off";
    this._binPathOxlint = binPathOxlint;
    this._binPathOxfmt = this.configuration.get<string>("path.oxfmt");
    this._binPathTsGoLint = this.configuration.get<string>("path.tsgolint");
    this._nodePath = this.configuration.get<string>("path.node");
    this._useExecPath = this.configuration.get<boolean>("useExecPath") ?? false;
    this._requireConfig = this.configuration.get<boolean>("requireConfig") ?? false;
    this._suppressProgramErrors = this.configuration.get<boolean>("suppressProgramErrors") ?? false;
  }

  get enableOxlint(): boolean {
    return this._enableOxlint;
  }

  updateEnableOxlint(value: boolean): PromiseLike<void> {
    this._enableOxlint = value;
    return this.configuration.update("enable.oxlint", value);
  }

  get enableOxfmt(): boolean {
    return this._enableOxfmt;
  }

  updateEnableOxfmt(value: boolean): PromiseLike<void> {
    this._enableOxfmt = value;
    return this.configuration.update("enable.oxfmt", value);
  }

  get trace(): TraceLevel {
    return this._trace;
  }

  updateTrace(value: TraceLevel): PromiseLike<void> {
    this._trace = value;
    return this.configuration.update("trace.server", value);
  }

  get binPathOxlint(): string | undefined {
    return this._binPathOxlint;
  }

  updateBinPathOxlint(value: string | undefined): PromiseLike<void> {
    this._binPathOxlint = value;
    return this.configuration.update("path.oxlint", value);
  }

  get binPathOxfmt(): string | undefined {
    return this._binPathOxfmt;
  }

  updateBinPathOxfmt(value: string | undefined): PromiseLike<void> {
    this._binPathOxfmt = value;
    return this.configuration.update("path.oxfmt", value);
  }

  get binPathTsGoLint(): string | undefined {
    return this._binPathTsGoLint;
  }

  updateBinPathTsGoLint(value: string | undefined): PromiseLike<void> {
    this._binPathTsGoLint = value;
    return this.configuration.update("path.tsgolint", value);
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

  get suppressProgramErrors(): boolean {
    return this._suppressProgramErrors;
  }

  updateSuppressTsconfigErrors(value: boolean): PromiseLike<void> {
    this._suppressProgramErrors = value;
    return this.configuration.update("suppressProgramErrors", value);
  }

  /**
   * These configuration changes need a complete restart of all language servers
   */
  private effectsGeneralLSPConnection(event: ConfigurationChangeEvent): boolean {
    return (
      event.affectsConfiguration(`${ConfigService.namespace}.path.node`) ||
      event.affectsConfiguration(`${ConfigService.namespace}.useExecPath`)
    );
  }

  effectsOxlintConnection(event: ConfigurationChangeEvent): boolean {
    return (
      event.affectsConfiguration(`${ConfigService.namespace}.path.oxlint`) ||
      event.affectsConfiguration(`${ConfigService.namespace}.path.tsgolint`) ||
      this.effectsGeneralLSPConnection(event)
    );
  }

  effectsOxfmtConnection(event: ConfigurationChangeEvent): boolean {
    return (
      event.affectsConfiguration(`${ConfigService.namespace}.path.oxfmt`) ||
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
   * `oxc.enable.oxlint`
   *
   * @default true (falls back to `oxc.enable` if not set)
   */
  enableOxlint: boolean;
  /**
   * `oxc.enable.oxfmt`
   *
   * @default true (falls back to `oxc.enable` if not set)
   */
  enableOxfmt: boolean;
  /**
   * Trace VSCode <-> Oxc Language Server communication
   * `oxc.trace.server`
   *
   * @default 'off'
   */
  trace: TraceLevel;
  /**
   * Path to the `oxlint` binary
   * `oxc.path.oxlint`
   * @default undefined
   */
  binPathOxlint: string | undefined;

  /**
   * Path to the `tsgolint` binary
   * `oxc.path.tsgolint`
   * @default undefined
   */
  binPathTsGoLint: string | undefined;

  /**
   * Path to a JavaScript runtime binary (Node.js, bun, or deno)
   * `oxc.path.node`
   * @default undefined
   */
  nodePath: string | undefined;

  /**
   * Whether to use the extension's execPath (Electron's bundled Node.js) as the JavaScript runtime for running Oxc tools,
   * instead of looking for a system Node.js installation.
   */
  useExecPath: boolean;

  /**
   * Start the language server only when a `.oxlintrc.json` file exists in one of the workspaces.
   * `oxc.requireConfig`
   * @default false
   */
  requireConfig: boolean;

  /**
   * Suppress tsconfig errors from tsgolint and still lint files under partially-valid tsconfig projects.
   * `oxc.suppressProgramErrors`
   * @default false
   */
  suppressProgramErrors: boolean;
}
