import * as path from "node:path";
import { ConfigurationChangeEvent, Uri, window, workspace, WorkspaceFolder } from "vscode";
import { DiagnosticPullMode } from "vscode-languageclient";
import { detectVitePlusProject, VitePlusError } from "./detectVitePlus";
import {
  BinarySearchResult,
  clearGlobalNodeModulesPathsCache,
  searchGlobalNodeModulesBin,
  searchEnvPath,
  searchProjectNodeModulesBin,
  searchSettingsBin,
  searchYarnPnpBin,
} from "./findBinary";
import { getShellEnv } from "./getShellEnv";
import { IDisposable } from "./types";
import { VSCodeConfig } from "./VSCodeConfig";
import {
  OxfmtWorkspaceConfigInterface,
  OxlintWorkspaceConfigInterface,
  WorkspaceConfig,
} from "./WorkspaceConfig";

type BinarySource = "auto" | "vite-plus" | "oxc";

interface VitePlusSearchFolder {
  root: string;
  start: string;
  source: BinarySource;
  configuredPath: string | undefined;
}

export class ConfigService implements IDisposable {
  public static readonly namespace = "oxc";
  private readonly _disposables: IDisposable[] = [];

  public vsCodeConfig: VSCodeConfig;

  private workspaceConfigs: Map<string, WorkspaceConfig> = new Map();
  private readonly vitePlusSearches = new Map<string, Promise<BinarySearchResult | null>>();

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

  public getOxlintServerConfig(isVitePlus = false): {
    workspaceUri: string;
    options: OxlintWorkspaceConfigInterface;
  }[] {
    return [...this.workspaceConfigs.entries()].map(([path, config]) => ({
      workspaceUri: Uri.file(path).toString(),
      options: config.toOxlintConfig(isVitePlus),
    }));
  }

  public getFormatterServerConfig(isVitePlus = false): {
    workspaceUri: string;
    options: OxfmtWorkspaceConfigInterface;
  }[] {
    return [...this.workspaceConfigs.entries()].map(([path, config]) => ({
      workspaceUri: Uri.file(path).toString(),
      options: config.toOxfmtConfig(isVitePlus),
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

  public effectsWorkspaceConfigChange(event: ConfigurationChangeEvent): boolean {
    for (const workspaceConfig of this.workspaceConfigs.values()) {
      if (workspaceConfig.effectsConfigChange(event)) {
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

  public clearBinarySearchCaches(): void {
    clearGlobalNodeModulesPathsCache();
    this.vitePlusSearches.clear();
  }

  public shouldRequestDiagnostics(
    textDocumentUri: Uri,
    diagnosticPullMode: DiagnosticPullMode,
  ): boolean {
    if (!this.vsCodeConfig.enableOxlint) {
      return false;
    }

    const ws = workspace.getWorkspaceFolder(textDocumentUri);
    if (!ws) {
      return false;
    }
    const workspaceConfig = this.getWorkspaceConfig(ws.uri);

    return workspaceConfig?.shouldRequestDiagnostics(diagnosticPullMode) ?? false;
  }

  private async searchBinaryPath(
    settingsBinary: string | undefined,
    defaultBinaryName: "oxlint" | "oxfmt",
  ): Promise<BinarySearchResult | undefined> {
    if (settingsBinary) {
      return searchSettingsBin(defaultBinaryName, settingsBinary);
    }

    const command = defaultBinaryName === "oxlint" ? "lint" : "fmt";
    const vitePlus = await this.searchVitePlus(command);
    if (vitePlus) {
      return { ...vitePlus, vitePlus: command };
    }

    return (
      (await searchProjectNodeModulesBin(defaultBinaryName)) ??
      (await searchYarnPnpBin(defaultBinaryName)) ??
      (await searchGlobalNodeModulesBin(defaultBinaryName)) ??
      (await searchEnvPath(defaultBinaryName))
    );
  }

  private async searchVitePlus(command: "lint" | "fmt"): Promise<BinarySearchResult | null> {
    if (!workspace.isTrusted) {
      return null;
    }

    const documentUri = window.activeTextEditor?.document.uri;
    const activeFolder =
      documentUri?.scheme === "file" ? workspace.getWorkspaceFolder(documentUri) : undefined;
    const workspaceFolders = activeFolder ? [activeFolder] : (workspace.workspaceFolders ?? []);
    const folders = workspaceFolders.map((folder): VitePlusSearchFolder => {
      const config = workspace.getConfiguration(ConfigService.namespace, folder.uri);
      return {
        root: folder.uri.fsPath,
        start: activeFolder && documentUri ? path.dirname(documentUri.fsPath) : folder.uri.fsPath,
        source: config.get<BinarySource>(`${command}.binarySource`) ?? "auto",
        configuredPath: config.get<string>("path.vp"),
      };
    });
    // Share only searches with the same document context and settings. A slow
    // search for another project must not select its binary after navigation.
    const key = JSON.stringify(folders);
    const pending = this.vitePlusSearches.get(key);
    if (pending) {
      return pending;
    }
    const search = this.resolveVitePlus(folders);
    this.vitePlusSearches.set(key, search);
    try {
      return await search;
    } finally {
      if (this.vitePlusSearches.get(key) === search) {
        this.vitePlusSearches.delete(key);
      }
    }
  }

  private async resolveVitePlus(
    folders: VitePlusSearchFolder[],
  ): Promise<BinarySearchResult | null> {
    for (const { root, start, source, configuredPath } of folders) {
      if (source === "oxc") {
        continue;
      }
      if (configuredPath) {
        // An explicit vp path opts in without requiring a dependency declaration.
        // oxlint-disable-next-line no-await-in-loop -- workspace folder order is significant
        const binary = await searchSettingsBin("vp", configuredPath, root);
        if (!binary) {
          throw new VitePlusError(`Invalid Vite+ binary: ${configuredPath}. Check oxc.path.vp.`);
        }
        return { ...binary, cwd: root };
      }

      const project = detectVitePlusProject(start, source === "vite-plus", root);
      if (!project) {
        continue;
      }
      if (project.vpPath) {
        return { path: project.vpPath, loader: "native", cwd: project.root };
      }
      // Global vp is eligible only after detection or explicit opt-in.
      // oxlint-disable no-await-in-loop -- global lookup requires a Vite+ project
      const binary =
        (await searchEnvPath("vp", await getShellEnv())) ??
        (await searchGlobalNodeModulesBin("vp", "vite-plus"));
      // oxlint-enable no-await-in-loop
      if (!binary) {
        throw new VitePlusError(
          `Vite+ selected in ${project.root}, but no vp binary was found. Run your package manager's install command (for example, pnpm install), or set oxc.path.vp, then restart the Oxc servers.`,
        );
      }
      return { ...binary, cwd: project.root };
    }
    return null;
  }

  private async onVscodeConfigChange(event: ConfigurationChangeEvent): Promise<void> {
    let isConfigChanged = false;

    if (event.affectsConfiguration(ConfigService.namespace)) {
      this.vsCodeConfig.refresh();
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
