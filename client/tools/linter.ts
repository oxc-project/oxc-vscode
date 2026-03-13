import { promises as fsPromises } from "node:fs";
import * as path from "node:path";

import {
  commands,
  ConfigurationChangeEvent,
  LogOutputChannel,
  RelativePattern,
  Uri,
  window,
  workspace,
  WorkspaceFolder,
  WorkspaceFoldersChangeEvent,
} from "vscode";

import {
  ConfigurationParams,
  ExecuteCommandRequest,
  ShowMessageNotification,
} from "vscode-languageclient";

import {
  Executable,
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";

import { OxcCommands } from "../commands";
import { ConfigService } from "../ConfigService";
import StatusBarItemHandler from "../StatusBarItemHandler";
import { VSCodeConfig } from "../VSCodeConfig";
import { onClientNotification, removeExecuteCommandFeature, runExecutable } from "./lsp_helper";
import ToolInterface from "./ToolInterface";

const enum LspCommands {
  FixAll = "oxc.fixAll",
}

const oxlintConfigDefaultFilePattern = `**/{.oxlintrc.json,.oxlintrc.jsonc,oxlint.config.ts}`;

// see https://github.com/oxc-project/oxc/blob/9b475ad05b750f99762d63094174be6f6fc3c0eb/crates/oxc_linter/src/loader/partial_loader/mod.rs#L17-L20
const supportedExtensions = [
  "astro",
  "cjs",
  "cts",
  "js",
  "jsx",
  "mjs",
  "mts",
  "svelte",
  "ts",
  "tsx",
  "vue",
];

type FolderClientEntry = {
  client: LanguageClient;
  allowedToStart: boolean;
  activatorWatcher?: { dispose: () => void };
};

export default class LinterTool implements ToolInterface {
  private folderClients: Map<string, FolderClientEntry> = new Map();
  private pendingActivations: Map<string, Promise<void>> = new Map();
  private foldersWithNoBinary: Set<string> = new Set();

  private disposeGlobalResources: (() => Promise<void>) | undefined;

  private async resolveBinary(
    folder: WorkspaceFolder,
    outputChannel: LogOutputChannel,
    configService: ConfigService,
  ): Promise<string | undefined> {
    if (process.env.SERVER_PATH_DEV) {
      return process.env.SERVER_PATH_DEV;
    }
    const bin = await configService.getOxlintBinPathForFolder(folder);
    if (bin) {
      try {
        await fsPromises.access(bin);
        return bin;
      } catch (e) {
        outputChannel.error(`[${folder.name}] Invalid bin path: ${bin}`, e);
      }
    }
  }

  async activate(
    outputChannel: LogOutputChannel,
    configService: ConfigService,
    statusBarItemHandler: StatusBarItemHandler,
  ): Promise<void> {
    const restartCommand = commands.registerCommand(OxcCommands.RestartServerLint, async () => {
      // Clear so that folders are re-checked on next document open
      this.foldersWithNoBinary.clear();
      for (const entry of this.folderClients.values()) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- sequential LSP client restart
        await this.restartOneClient(entry);
      }
      this.updateStatusBar(statusBarItemHandler, configService.vsCodeConfig.enableOxlint);
    });

    const toggleEnable = commands.registerCommand(OxcCommands.ToggleEnableLint, async () => {
      await configService.vsCodeConfig.updateEnableOxlint(!configService.vsCodeConfig.enableOxlint);
    });

    const applyAllFixesFile = commands.registerCommand(OxcCommands.ApplyAllFixesFile, async () => {
      const textEditor = window.activeTextEditor;
      if (!textEditor) {
        window.showErrorMessage("active text editor not found");
        return;
      }

      const folder = workspace.getWorkspaceFolder(textEditor.document.uri);
      const entry = folder ? this.folderClients.get(folder.uri.toString()) : undefined;
      if (!entry?.client) {
        window.showErrorMessage("oxc client not found for this file");
        return;
      }

      const params = {
        command: LspCommands.FixAll,
        arguments: [
          {
            uri: textEditor.document.uri.toString(),
          },
        ],
      };

      await entry.client.sendRequest(ExecuteCommandRequest.type, params);
    });

    // Register `oxc.fixAll` ourselves to route to the correct per-folder client.
    // This replaces the auto-registration from ExecuteCommandFeature (which we disable
    // on all clients to prevent duplicate registration conflicts).
    const fixAllCommand = commands.registerCommand(LspCommands.FixAll, async (...args: any[]) => {
      const uri = args[0]?.uri;
      if (!uri) return;

      const documentUri = Uri.parse(uri);
      const folder = workspace.getWorkspaceFolder(documentUri);
      const entry = folder ? this.folderClients.get(folder.uri.toString()) : undefined;
      if (!entry?.client) return;

      await entry.client.sendRequest(ExecuteCommandRequest.type, {
        command: LspCommands.FixAll,
        arguments: args,
      });
    });

    const onDeleteFilesDispose = workspace.onDidDeleteFiles((event) => {
      for (const fileUri of event.files) {
        for (const entry of this.folderClients.values()) {
          entry.client.diagnostics?.delete(fileUri);
        }
      }
    });

    // Lazily activate per-folder clients when a matching document is opened
    const onDidOpenDispose = workspace.onDidOpenTextDocument((document) => {
      if (document.uri.scheme !== "file") return;
      const ext = path.extname(document.uri.fsPath).slice(1);
      if (!ext || !supportedExtensions.includes(ext)) return;

      const folder = workspace.getWorkspaceFolder(document.uri);
      if (!folder) return;

      void this.ensureFolderActivated(folder, outputChannel, configService, statusBarItemHandler);
    });

    this.disposeGlobalResources = async () => {
      restartCommand.dispose();
      toggleEnable.dispose();
      applyAllFixesFile.dispose();
      fixAllCommand.dispose();
      onDeleteFilesDispose.dispose();
      onDidOpenDispose.dispose();
    };

    // Activate for already-open documents
    for (const document of workspace.textDocuments) {
      if (document.uri.scheme !== "file") continue;
      const ext = path.extname(document.uri.fsPath).slice(1);
      if (!ext || !supportedExtensions.includes(ext)) continue;

      const folder = workspace.getWorkspaceFolder(document.uri);
      if (!folder) continue;

      void this.ensureFolderActivated(folder, outputChannel, configService, statusBarItemHandler);
    }

    this.updateStatusBar(statusBarItemHandler, configService.vsCodeConfig.enableOxlint);
  }

  private ensureFolderActivated(
    folder: WorkspaceFolder,
    outputChannel: LogOutputChannel,
    configService: ConfigService,
    statusBarItemHandler: StatusBarItemHandler,
  ): Promise<void> {
    const folderUri = folder.uri.toString();
    if (this.folderClients.has(folderUri) || this.foldersWithNoBinary.has(folderUri)) {
      return Promise.resolve();
    }

    const existing = this.pendingActivations.get(folderUri);
    if (existing) return existing;

    const promise = this.activateForFolder(
      folder,
      outputChannel,
      configService,
      statusBarItemHandler,
    )
      .then(() => {
        this.updateStatusBar(statusBarItemHandler, configService.vsCodeConfig.enableOxlint);
      })
      .catch((err) => {
        // On failure, the folder stays in neither folderClients nor foldersWithNoBinary,
        // so the next document open in this folder will retry activation.
        outputChannel.error(`[${folder.name}] Failed to activate linter`, err);
      })
      .finally(() => {
        this.pendingActivations.delete(folderUri);
      });
    this.pendingActivations.set(folderUri, promise);
    return promise;
  }

  private async activateForFolder(
    folder: WorkspaceFolder,
    outputChannel: LogOutputChannel,
    configService: ConfigService,
    statusBarItemHandler: StatusBarItemHandler,
  ): Promise<void> {
    const binaryPath = await this.resolveBinary(folder, outputChannel, configService);
    if (!binaryPath) {
      this.foldersWithNoBinary.add(folder.uri.toString());
      outputChannel.appendLine(
        `[${folder.name}] No valid oxlint binary found. Linter will not be activated for this folder.`,
      );
      return;
    }

    outputChannel.info(`[${folder.name}] Using oxlint binary at: ${binaryPath}`);

    const allowedToStart = configService.vsCodeConfig.requireConfig
      ? (
          await workspace.findFiles(
            new RelativePattern(folder, oxlintConfigDefaultFilePattern),
            "**/node_modules/**",
            1,
          )
        ).length > 0
      : true;

    const run: Executable = runExecutable(
      binaryPath,
      "oxlint",
      configService.vsCodeConfig.useExecPath,
      configService.vsCodeConfig.nodePath,
      configService.vsCodeConfig.binPathTsGoLint,
      configService.vsCodeConfig.suppressProgramErrors,
    );
    const serverOptions: ServerOptions = {
      run,
      debug: run,
    };

    const clientOptions: LanguageClientOptions = {
      documentSelector: [
        {
          pattern: `${folder.uri.fsPath}/**/*.{${supportedExtensions.join(",")}}`,
          scheme: "file",
        },
      ],
      workspaceFolder: folder,
      initializationOptions: configService.oxlintConfigForFolder(folder),
      outputChannel,
      traceOutputChannel: outputChannel,
      diagnosticPullOptions: {
        onChange: true,
        onSave: true,
        onTabs: false,
        filter: (document, mode) => !configService.shouldRequestDiagnostics(document.uri, mode),
      },
      middleware: {
        handleDiagnostics: (uri, diagnostics, next) => {
          for (const diag of diagnostics) {
            // https://github.com/oxc-project/oxc/issues/12404
            if (
              typeof diag.code === "object" &&
              diag.code?.value === "eslint-plugin-unicorn(filename-case)"
            ) {
              diag.message +=
                "\nYou may need to close the file and restart VSCode after renaming a file by only casing.";
            }
          }
          next(uri, diagnostics);
        },
        workspace: {
          configuration: (params: ConfigurationParams) => {
            return params.items.map((item) => {
              if (item.section !== "oxc_language_server") {
                return null;
              }
              if (item.scopeUri === undefined) {
                return null;
              }

              return (
                configService.getWorkspaceConfig(Uri.parse(item.scopeUri))?.toOxlintConfig() ?? null
              );
            });
          },
        },
      },
    };

    const clientId = `oxc-lint-${folder.uri.toString()}`;
    const client = new LanguageClient(clientId, "Oxc Lint", serverOptions, clientOptions);

    // Prevent duplicate VS Code command registration (e.g. oxc.fixAll) across clients.
    // We handle execute commands ourselves via applyAllFixesFile.
    removeExecuteCommandFeature(client);

    client.onNotification(ShowMessageNotification.type, (params) => {
      onClientNotification(params, outputChannel);
    });

    let activatorWatcher: { dispose: () => void } | undefined;
    if (allowedToStart) {
      if (configService.vsCodeConfig.enableOxlint) {
        await client.start();
      }
    } else {
      activatorWatcher = this.generateActivatorByConfigForFolder(
        folder,
        client,
        configService.vsCodeConfig,
        statusBarItemHandler,
      );
    }

    this.folderClients.set(folder.uri.toString(), {
      client,
      allowedToStart,
      activatorWatcher,
    });
  }

  private async deactivateForFolder(folderUri: string): Promise<void> {
    const entry = this.folderClients.get(folderUri);
    if (!entry) return;

    entry.activatorWatcher?.dispose();
    try {
      await entry.client.stop();
    } catch {
      // client may already be stopped
    }
    await entry.client.dispose();
    this.folderClients.delete(folderUri);
  }

  async deactivate(): Promise<void> {
    // Wait for any pending activations to complete before deactivating
    await Promise.all(this.pendingActivations.values());
    await Promise.all([...this.folderClients.keys()].map((uri) => this.deactivateForFolder(uri)));
    this.foldersWithNoBinary.clear();
    await this.disposeGlobalResources?.();
    this.disposeGlobalResources = undefined;
  }

  async onWorkspaceFolderChange(
    event: WorkspaceFoldersChangeEvent,
    _outputChannel: LogOutputChannel,
    configService: ConfigService,
    statusBarItemHandler: StatusBarItemHandler,
  ): Promise<void> {
    for (const folder of event.removed) {
      const folderUri = folder.uri.toString();
      this.foldersWithNoBinary.delete(folderUri);
      // oxlint-disable-next-line eslint/no-await-in-loop -- sequential LSP client cleanup
      await this.deactivateForFolder(folderUri);
    }
    // Added folders will be lazily activated when a document is opened
    this.updateStatusBar(statusBarItemHandler, configService.vsCodeConfig.enableOxlint);
  }

  async toggleClients(configService: ConfigService): Promise<void> {
    for (const entry of this.folderClients.values()) {
      if (!entry.allowedToStart) continue;

      if (entry.client.isRunning()) {
        if (!configService.vsCodeConfig.enableOxlint) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- sequential LSP client toggle
          await entry.client.stop();
        }
      } else {
        if (configService.vsCodeConfig.enableOxlint) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- sequential LSP client toggle
          await entry.client.start();
        }
      }
    }
  }

  private async restartOneClient(entry: FolderClientEntry): Promise<void> {
    try {
      if (entry.client.isRunning()) {
        await entry.client.restart();
      } else {
        await entry.client.start();
      }
    } catch (err) {
      entry.client.error("Restarting oxlint client failed", err, "force");
    }
  }

  async onConfigChange(
    event: ConfigurationChangeEvent,
    configService: ConfigService,
    statusBarItemHandler: StatusBarItemHandler,
  ): Promise<void> {
    if (
      event.affectsConfiguration(`${ConfigService.namespace}.enable`) ||
      event.affectsConfiguration(`${ConfigService.namespace}.enable.oxlint`)
    ) {
      await this.toggleClients(configService);
    }
    this.updateStatusBar(statusBarItemHandler, configService.vsCodeConfig.enableOxlint);

    if (this.folderClients.size === 0) {
      return;
    }

    const effectsConfig = configService.effectsWorkspaceConfigChange(event);

    for (const [folderUri, entry] of this.folderClients) {
      const folder = workspace.getWorkspaceFolder(Uri.parse(folderUri));
      if (!folder) continue;

      const config = configService.oxlintConfigForFolder(folder);
      entry.client.clientOptions.initializationOptions = config;

      if (effectsConfig && entry.client.isRunning()) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- sequential LSP notification
        await entry.client.sendNotification("workspace/didChangeConfiguration", {
          settings: config,
        });
      }
    }
  }

  /**
   * ------- Helpers -------
   */

  getStatusBarState(enable: boolean): {
    isEnabled: boolean;
    tooltipText?: string;
  } {
    const anyAllowed = [...this.folderClients.values()].some((e) => e.allowedToStart);
    if (this.folderClients.size > 0 && !anyAllowed) {
      return {
        isEnabled: false,
        tooltipText: "no oxlint config found",
      };
    } else if (!enable) {
      return {
        isEnabled: false,
        tooltipText: "`oxc.enable.oxlint` or `oxc.enable` is false",
      };
    }

    return {
      isEnabled: true,
    };
  }

  updateStatusBar(statusBarItemHandler: StatusBarItemHandler, enable: boolean) {
    const { isEnabled, tooltipText } = this.getStatusBarState(enable);

    let text =
      `[$(terminal) Open Output](command:${OxcCommands.ShowOutputChannelLint})\n\n` +
      `[$(refresh) Restart Server](command:${OxcCommands.RestartServerLint})\n\n`;

    if (enable) {
      text += `[$(stop) Stop Server](command:${OxcCommands.ToggleEnableLint})\n\n`;
    } else {
      text += `[$(play) Start Server](command:${OxcCommands.ToggleEnableLint})\n\n`;
    }

    if (tooltipText) {
      text = `${tooltipText}\n\n` + text;
    }

    // Collect versions from all running clients
    const versions = new Set<string>();
    for (const entry of this.folderClients.values()) {
      const v = entry.client.initializeResult?.serverInfo?.version;
      if (v) versions.add(v);
    }
    const version = versions.size > 0 ? [...versions].join(", ") : undefined;

    statusBarItemHandler.updateTool("linter", isEnabled, text, version);
  }

  private generateActivatorByConfigForFolder(
    folder: WorkspaceFolder,
    client: LanguageClient,
    config: VSCodeConfig,
    statusBarItemHandler: StatusBarItemHandler,
  ): { dispose: () => void } {
    const watcher = workspace.createFileSystemWatcher(
      new RelativePattern(folder, oxlintConfigDefaultFilePattern),
      false,
      true,
      !config.requireConfig,
    );

    const folderUri = folder.uri.toString();

    watcher.onDidCreate(async () => {
      const entry = this.folderClients.get(folderUri);
      if (entry) {
        entry.allowedToStart = true;
        this.updateStatusBar(statusBarItemHandler, config.enableOxlint);
        if (!client.isRunning() && config.enableOxlint) {
          await client.start();
        }
      }
    });

    watcher.onDidDelete(async () => {
      // only can be called when config.requireConfig
      const hasConfig =
        (
          await workspace.findFiles(
            new RelativePattern(folder, oxlintConfigDefaultFilePattern),
            "**/node_modules/**",
            1,
          )
        ).length > 0;

      const entry = this.folderClients.get(folderUri);
      if (entry) {
        entry.allowedToStart = hasConfig;
        if (!hasConfig) {
          this.updateStatusBar(statusBarItemHandler, false);
          if (client.isRunning()) {
            await client.stop();
          }
        }
      }
    });

    return watcher;
  }
}
