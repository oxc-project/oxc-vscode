import {
  ConfigurationChangeEvent,
  ConfigurationTarget,
  workspace,
  WorkspaceConfiguration,
} from "vscode";
import { DiagnosticPullMode } from "vscode-languageclient";
import { ConfigService } from "./ConfigService";
import { validateSafeBinaryPath } from "./PathValidator";
import { substitutePathVariables } from "./PathVariables";
import type { OxcTool } from "./types";

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
function resolveEnable(configuration: WorkspaceConfiguration, tool: OxcTool): boolean {
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

export function resolveEnabledTools(
  configuration: WorkspaceConfiguration,
): Record<OxcTool, boolean> {
  return {
    oxlint: resolveEnable(configuration, "oxlint"),
    oxfmt: resolveEnable(configuration, "oxfmt"),
  };
}

export class VSCodeConfig implements VSCodeConfigInterface {
  private _enabled!: Record<OxcTool, boolean>;
  // the writes of `oxc.enable.<tool>` of both tools run one after the other
  private pendingEnableUpdate: Promise<void> = Promise.resolve();
  private _runTrigger!: DiagnosticPullMode;
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

  // a setting which is empty after substitution counts as not configured, so that
  // `${env:OXLINT_BIN}` with the variable unset behaves like an empty setting
  // an unsafe path (see `validateSafeBinaryPath`) is treated the same way
  private resolveBinPath(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }
    const resolved = substitutePathVariables(value);
    return resolved && validateSafeBinaryPath(resolved) ? resolved : undefined;
  }

  private getResolvedBinPath(section: string): string | undefined {
    return this.resolveBinPath(this.configuration.get<string>(section));
  }

  public refresh(): void {
    let binPathOxlint = this.getResolvedBinPath("path.oxlint");
    // fallback to deprecated 'path.server' setting
    if (!binPathOxlint) {
      binPathOxlint = this.getResolvedBinPath("path.server");
    }
    this._enabled = resolveEnabledTools(this.configuration);
    this._runTrigger =
      this.configuration.get<DiagnosticPullMode>("lint.run") ?? DiagnosticPullMode.onType;
    this._trace = this.configuration.get<TraceLevel>("trace.server") || "off";
    this._binPathOxlint = binPathOxlint;
    this._binPathOxfmt = this.getResolvedBinPath("path.oxfmt");
    this._binPathTsGoLint = this.getResolvedBinPath("path.tsgolint");
    this._nodePath = this.getResolvedBinPath("path.node");
    this._useExecPath = this.configuration.get<boolean>("useExecPath") ?? false;
    this._requireConfig = this.configuration.get<boolean>("requireConfig") ?? false;
    this._suppressProgramErrors = this.configuration.get<boolean>("suppressProgramErrors") ?? false;
  }

  isEnabled(tool: OxcTool): boolean {
    return this._enabled[tool];
  }

  /**
   * Writes `oxc.enable.<tool>` at that level. The master toggle governs both tools when it is set
   * there, so it is replaced by the two tool keys, the other tool keeping the value it had.
   * The cached values are updated right away, they do not wait for the configuration change event.
   *
   * The calls of both tools run one after the other, each one reads the settings it replaces.
   */
  updateEnable(tool: OxcTool, value: boolean): Promise<void> {
    const run = this.pendingEnableUpdate.then(() => this.writeEnable(tool, value));
    this.pendingEnableUpdate = run.catch(() => {});
    return run;
  }

  private async writeEnable(tool: OxcTool, value: boolean): Promise<void> {
    const target = enableUpdateTarget(this.hasWorkspace);
    const configuration = this.configuration;
    // `oxc.enable` holds an object at a level which only sets the tool keys
    const master = enableUpdateTargetValue(configuration.inspect("enable"), this.hasWorkspace);
    this._enabled[tool] = value;

    try {
      if (master === undefined) {
        await configuration.update(`enable.${tool}`, value, target);
        return;
      }

      // the master toggle wins at that level, the tool keys have no effect until it is cleared
      const other = tool === "oxlint" ? "oxfmt" : "oxlint";
      // a tool key at the level of the master toggle is not visible, it can not be kept
      this._enabled[other] = master;
      await configuration.update(`enable.${tool}`, value, target);
      await configuration.update(`enable.${other}`, master, target);
      await configuration.update("enable", undefined, target);
    } catch (error) {
      // the settings are what they are now, not what was expected
      this._enabled = resolveEnabledTools(this.configuration);
      throw error;
    }
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
    this._binPathOxlint = this.resolveBinPath(value);
    return this.configuration.update("path.oxlint", value);
  }

  get binPathOxfmt(): string | undefined {
    return this._binPathOxfmt;
  }

  updateBinPathOxfmt(value: string | undefined): PromiseLike<void> {
    this._binPathOxfmt = this.resolveBinPath(value);
    return this.configuration.update("path.oxfmt", value);
  }

  get binPathTsGoLint(): string | undefined {
    return this._binPathTsGoLint;
  }

  updateBinPathTsGoLint(value: string | undefined): PromiseLike<void> {
    this._binPathTsGoLint = this.resolveBinPath(value);
    return this.configuration.update("path.tsgolint", value);
  }

  get nodePath(): string | undefined {
    return this._nodePath;
  }

  updateNodePath(value: string | undefined): PromiseLike<void> {
    this._nodePath = this.resolveBinPath(value);
    return this.configuration.update("path.node", value);
  }

  get useExecPath(): boolean {
    return this._useExecPath;
  }

  updateUseExecPath(value: boolean): PromiseLike<void> {
    this._useExecPath = value;
    return this.configuration.update("useExecPath", value);
  }

  /** `oxc.lint.run`, resolved without a resource. */
  get runTrigger(): DiagnosticPullMode {
    return this._runTrigger;
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
   * `oxc.enable.<tool>`, resolved without a resource.
   * The setting is `resource` scoped, `WorkspaceConfig.isEnabled` resolves it
   * for one workspace folder.
   *
   * @default true (falls back to `oxc.enable` if not set)
   */
  isEnabled(tool: OxcTool): boolean;
  /**
   * When to run the linter, `oxc.lint.run`, resolved without a resource.
   * The setting is `resource` scoped, `WorkspaceConfig.runTrigger` resolves it
   * for one workspace folder.
   *
   * @default 'onType'
   */
  runTrigger: DiagnosticPullMode;
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
