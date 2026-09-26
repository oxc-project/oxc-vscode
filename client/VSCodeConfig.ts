import {
  ConfigurationChangeEvent,
  ConfigurationTarget,
  workspace,
  WorkspaceConfiguration,
} from "vscode";
import { ConfigService } from "./ConfigService";

/** The resolved state of `oxc.enable.oxlint` and `oxc.enable.oxfmt` for one scope. */
export type EnabledTools = {
  enableOxlint: boolean;
  enableOxfmt: boolean;
};

// from the highest to the lowest precedence, the default value is excluded: it is not configured
const configurationScopes = ["workspaceFolderValue", "workspaceValue", "globalValue"] as const;

type ConfigurationScope = (typeof configurationScopes)[number];

type InspectedValue = { [Scope in ConfigurationScope]?: unknown } | undefined;

/**
 * The precedence of the highest configuration scope which defines a boolean,
 * `3` for the workspace folder, `2` for the workspace and `1` for the user settings.
 */
function booleanPrecedence(
  inspected: InspectedValue,
): { precedence: number; value: boolean } | undefined {
  if (inspected === undefined) {
    return undefined;
  }

  for (const [index, scope] of configurationScopes.entries()) {
    const value = inspected[scope];
    if (typeof value === "boolean") {
      return { precedence: configurationScopes.length - index, value };
    }
  }

  return undefined;
}

/**
 * Resolves `oxc.enable`, `oxc.enable.oxlint` and `oxc.enable.oxfmt` for one configuration scope.
 *
 * `oxc.enable` is a master toggle which wins over `oxc.enable.oxlint` and `oxc.enable.oxfmt` when
 * it is set at the same or at a higher precedence level (workspace folder > workspace > user).
 * A folder level `oxc.enable.oxlint` therefore wins over a user level `oxc.enable`.
 */
function isToolEnabled(configuration: WorkspaceConfiguration, tool: "oxlint" | "oxfmt"): boolean {
  // `oxc.enable.oxlint` is part of the `oxc.enable` object when `oxc.enable` itself is not set,
  // only a boolean value is a value of the master toggle.
  const master = booleanPrecedence(configuration.inspect("enable"));
  const specific = booleanPrecedence(configuration.inspect(`enable.${tool}`));

  // the master toggle only wins when it is set with the same or a higher precedence
  if (
    master !== undefined &&
    (specific === undefined || master.precedence >= specific.precedence)
  ) {
    return master.value;
  }

  return specific?.value ?? true;
}

/**
 * The level `oxc.enable.<tool>` is written to. Without a workspace, VS Code can only store it in
 * the user settings.
 */
export function enableUpdateTarget(hasWorkspace: boolean): ConfigurationTarget {
  return hasWorkspace ? ConfigurationTarget.Workspace : ConfigurationTarget.Global;
}

/**
 * The raw value at the level `enableUpdateTarget` writes to.
 *
 * `oxc.enable` holds an object at a level which only sets `oxc.enable.<tool>`, only a boolean is a
 * value of the master toggle.
 */
export function enableUpdateTargetValue(
  inspected: { globalValue?: unknown; workspaceValue?: unknown } | undefined,
  hasWorkspace: boolean,
): boolean | undefined {
  if (inspected === undefined) {
    return undefined;
  }
  const value = hasWorkspace ? inspected.workspaceValue : inspected.globalValue;
  return typeof value === "boolean" ? value : undefined;
}

export function resolveEnabledTools(configuration: WorkspaceConfiguration): EnabledTools {
  return {
    enableOxlint: isToolEnabled(configuration, "oxlint"),
    enableOxfmt: isToolEnabled(configuration, "oxfmt"),
  };
}

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
    // `null` selects the window level values of the `resource` scoped settings
    return workspace.getConfiguration(ConfigService.namespace, null);
  }

  /** Whether a workspace is open, the settings can only be stored in the user settings without. */
  private get hasWorkspace(): boolean {
    return workspace.workspaceFolders !== undefined;
  }

  public refresh(): void {
    let binPathOxlint = this.configuration.get<string>("path.oxlint");
    // fallback to deprecated 'path.server' setting
    if (!binPathOxlint) {
      binPathOxlint = this.configuration.get<string>("path.server");
    }
    const enable = resolveEnabledTools(this.configuration);

    this._enableOxlint = enable.enableOxlint;
    this._enableOxfmt = enable.enableOxfmt;
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

  /**
   * The raw value which decides oxlint at the level `updateEnableOxlint` writes to.
   * The master toggle wins there, `undefined` when only another level sets it.
   */
  get rawEnableOxlint(): boolean | undefined {
    return this.rawEnable("oxlint");
  }

  /** The cached value is refreshed by the configuration change event. */
  updateEnableOxlint(value: boolean): PromiseLike<void> {
    return this.updateEnable("oxlint", value);
  }

  get enableOxfmt(): boolean {
    return this._enableOxfmt;
  }

  /**
   * The raw value which decides oxfmt at the level `updateEnableOxfmt` writes to.
   * The master toggle wins there, `undefined` when only another level sets it.
   */
  get rawEnableOxfmt(): boolean | undefined {
    return this.rawEnable("oxfmt");
  }

  /** The cached value is refreshed by the configuration change event. */
  updateEnableOxfmt(value: boolean): PromiseLike<void> {
    return this.updateEnable("oxfmt", value);
  }

  /** The master toggle wins over the tool specific key set at the same level. */
  private rawEnable(tool: "oxlint" | "oxfmt"): boolean | undefined {
    const master = enableUpdateTargetValue(this.configuration.inspect("enable"), this.hasWorkspace);
    if (master !== undefined) {
      return master;
    }
    return enableUpdateTargetValue(this.configuration.inspect(`enable.${tool}`), this.hasWorkspace);
  }

  /**
   * Writes the key which decides the tool at that level: the master toggle when it is set there,
   * because writing `oxc.enable.<tool>` next to it would have no effect.
   */
  private updateEnable(tool: "oxlint" | "oxfmt", value: boolean): PromiseLike<void> {
    const hasMaster =
      enableUpdateTargetValue(this.configuration.inspect("enable"), this.hasWorkspace) !==
      undefined;

    return this.configuration.update(
      hasMaster ? "enable" : `enable.${tool}`,
      value,
      enableUpdateTarget(this.hasWorkspace),
    );
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
   * `oxc.enable.oxlint`, resolved without a resource.
   * The setting is `resource` scoped, `WorkspaceConfig.enableOxlint` resolves it
   * for one workspace folder.
   *
   * @default true (falls back to `oxc.enable` if not set)
   */
  enableOxlint: boolean;
  /**
   * `oxc.enable.oxfmt`, resolved without a resource.
   * The setting is `resource` scoped, `WorkspaceConfig.enableOxfmt` resolves it
   * for one workspace folder.
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
   * Handle a workspace folder only when an oxlint configuration file exists inside it (the
   * names oxlint accepts are listed in `oxlintConfigFileNames`).
   * `oxc.requireConfig`, resolved without a resource.
   * The setting is `resource` scoped, `WorkspaceConfig.requireConfig` resolves it
   * for one workspace folder.
   *
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
