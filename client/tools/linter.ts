import { promises as fsPromises } from "node:fs";

import {
  commands,
  ConfigurationChangeEvent,
  LogOutputChannel,
  Uri,
  window,
  workspace,
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
import { onClientNotification, runExecutable } from "./lsp_helper";
import ToolInterface from "./ToolInterface";
import type { BinarySearchResult } from "../findBinary";

const languageClientName = "oxc";

const enum LspCommands {
  FixAll = "oxc.fixAll",
}

const oxlintConfigDefaultFilePattern = `**/{.oxlintrc.json,.oxlintrc.jsonc,oxlint.config.ts,oxlint.config.mts}`;

export default class LinterTool implements ToolInterface {
  // Global flag to check if the user allows us to start the server.
  // When `oxc.requireConfig` is `true`, make sure one `.oxlintrc.json` file is present.
  private allowedToStartServer: boolean = false;

  // LSP client instance
  private client: LanguageClient | undefined;

  private disposeResources: (() => Promise<void>) | undefined;

  // Command disposables (registered once at construction)
  private readonly restartCommand: { dispose: () => void };
  private readonly toggleEnableCommand: { dispose: () => void };
  private readonly applyAllFixesCommand: { dispose: () => void };

  constructor(
    private readonly outputChannel: LogOutputChannel,
    private readonly configService: ConfigService,
    private readonly statusBarItemHandler: StatusBarItemHandler,
  ) {
    // Register commands once at construction
    this.restartCommand = commands.registerCommand(OxcCommands.RestartServerLint, async () => {
      if (this.outputChannel && this.configService && this.statusBarItemHandler) {
        await this.restart();
      }
    });

    this.toggleEnableCommand = commands.registerCommand(OxcCommands.ToggleEnableLint, async () => {
      if (this.configService) {
        await this.configService.vsCodeConfig.updateEnableOxlint(
          !this.configService.vsCodeConfig.enableOxlint,
        );
        // all future changes are handled by the onConfigChange listener, so we don't need to do it here
      }
    });

    this.applyAllFixesCommand = commands.registerCommand(
      OxcCommands.ApplyAllFixesFile,
      async () => {
        if (!this.client) {
          window.showErrorMessage("oxc client not found");
          return;
        }
        const textEditor = window.activeTextEditor;
        if (!textEditor) {
          window.showErrorMessage("active text editor not found");
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

        await this.client.sendRequest(ExecuteCommandRequest.type, params);
      },
    );
  }

  getLspVersion(): string | undefined {
    return this.client?.initializeResult?.serverInfo?.version;
  }

  async getBinary(): Promise<BinarySearchResult | undefined> {
    if (process.env.SERVER_PATH_DEV) {
      return { path: process.env.SERVER_PATH_DEV, loader: "native" };
    }
    const bin = await this.configService.getOxlintServerBinPath();
    if (bin) {
      try {
        await fsPromises.access(bin.path);
        return bin;
      } catch (e) {
        this.outputChannel.error(`Invalid bin path: ${bin.path}`, e);
      }
    }
  }

  async activate(binary?: BinarySearchResult): Promise<void> {
    if (!binary) {
      this.statusBarItemHandler.updateTool("linter", false, "No valid oxlint binary found.");
      this.outputChannel.appendLine("No valid oxlint binary found. Linter will not be activated.");
      return Promise.resolve();
    }

    this.allowedToStartServer = this.configService.vsCodeConfig.requireConfig
      ? (await workspace.findFiles(oxlintConfigDefaultFilePattern, "**/node_modules/**", 1))
          .length > 0
      : true;

    const run: Executable = await runExecutable(
      binary,
      this.configService.vsCodeConfig.useExecPath,
      this.configService.vsCodeConfig.nodePath,
      this.configService.vsCodeConfig.binPathTsGoLint,
      this.configService.vsCodeConfig.suppressProgramErrors,
    );
    const serverOptions: ServerOptions = {
      run,
      debug: run,
    };

    this.outputChannel.info(`Using server binary at: ${binary?.path}`);

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

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
      // Register the server for plain text documents
      documentSelector: [
        {
          pattern: `**/*.{${supportedExtensions.join(",")}}`,
          scheme: "file",
        },
      ],
      initializationOptions: this.configService.oxlintServerConfig,
      outputChannel: this.outputChannel,
      traceOutputChannel: this.outputChannel,
      diagnosticPullOptions: {
        onChange: true,
        onSave: true,
        onTabs: false,
        filter: (document, mode) =>
          !this.configService.shouldRequestDiagnostics(document.uri, mode),
      },
      middleware: {
        handleDiagnostics: (uri, diagnostics, next) => {
          for (const diag of diagnostics) {
            // https://github.com/oxc-project/oxc/issues/12404
            if (
              typeof diag.code === "object" &&
              // old diagnostic code since oxlint v1.63.0, but respect the js plugin version too
              (diag.code?.value === "eslint-plugin-unicorn(filename-case)" ||
                // new diagnostic code since oxlint v1.63.0
                diag.code?.value === "unicorn(filename-case)")
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
                this.configService.getWorkspaceConfig(Uri.parse(item.scopeUri))?.toOxlintConfig() ??
                null
              );
            });
          },
        },
      },
    };

    this.client = new LanguageClient(languageClientName, serverOptions, clientOptions);

    const onNotificationDispose = this.client.onNotification(
      ShowMessageNotification.type,
      (params) => {
        onClientNotification(params, this.outputChannel);
      },
    );

    const onDeleteFilesDispose = workspace.onDidDeleteFiles((event) => {
      for (const fileUri of event.files) {
        this.client?.diagnostics?.delete(fileUri);
      }
    });

    let activatorDispatcher: { dispose: () => void } | undefined;
    if (this.allowedToStartServer) {
      if (this.configService.vsCodeConfig.enableOxlint) {
        await this.client.start();
      }
    } else {
      activatorDispatcher = this.generateActivatorByConfig(this.configService.vsCodeConfig);
    }

    this.disposeResources = async () => {
      await this.client?.dispose();
      onNotificationDispose.dispose();
      onDeleteFilesDispose.dispose();
      activatorDispatcher?.dispose();
    };

    this.updateStatusBar(this.configService.vsCodeConfig.enableOxlint);
  }

  async deactivate(): Promise<void> {
    try {
      await this.client?.stop();
    } catch {
      // do nothing, the client may already be stopped
    }
    await this.disposeResources?.();
    this.disposeResources = undefined;
    this.client = undefined;
  }

  dispose(): void {
    this.restartCommand.dispose();
    this.toggleEnableCommand.dispose();
    this.applyAllFixesCommand.dispose();
  }

  async toggleClient(configService: ConfigService): Promise<void> {
    if (this.client === undefined || !this.allowedToStartServer) {
      return;
    }

    if (this.client.isRunning()) {
      if (!configService.vsCodeConfig.enableOxlint) {
        await this.client.stop();
      }
    } else {
      if (configService.vsCodeConfig.enableOxlint) {
        await this.client.start();
      }
    }
  }

  async restart(): Promise<void> {
    await this.deactivate();
    const newBinaryPath = await this.getBinary();
    await this.activate(newBinaryPath);
  }

  async onConfigChange(event: ConfigurationChangeEvent): Promise<void> {
    if (
      event.affectsConfiguration(`${ConfigService.namespace}.enable`) ||
      event.affectsConfiguration(`${ConfigService.namespace}.enable.oxlint`)
    ) {
      await this.toggleClient(this.configService); // update the client state
    }
    this.updateStatusBar(this.configService.vsCodeConfig.enableOxlint);

    if (this.client === undefined) {
      return;
    }

    // update the initializationOptions for a possible restart
    this.client.clientOptions.initializationOptions = this.configService.oxlintServerConfig;

    if (this.configService.effectsWorkspaceConfigChange(event) && this.client.isRunning()) {
      await this.client.sendNotification("workspace/didChangeConfiguration", {
        settings: this.configService.oxlintServerConfig,
      });
    }
  }

  /**
   * ------- Helpers -------
   */

  /**
   * Get the status bar state based on whether oxc is enabled and allowed to start.
   */
  getStatusBarState(enable: boolean): {
    isEnabled: boolean;
    tooltipText?: string;
  } {
    if (!this.allowedToStartServer) {
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

  updateStatusBar(enable: boolean) {
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

    this.statusBarItemHandler.updateTool(
      "linter",
      isEnabled,
      text,
      this.client?.initializeResult?.serverInfo?.version,
    );
  }

  generateActivatorByConfig(config: VSCodeConfig): { dispose: () => void } {
    const watcher = workspace.createFileSystemWatcher(
      oxlintConfigDefaultFilePattern,
      false,
      true,
      !config.requireConfig,
    );
    watcher.onDidCreate(async () => {
      this.allowedToStartServer = true;
      this.updateStatusBar(config.enableOxlint);
      if (this.client && !this.client.isRunning() && config.enableOxlint) {
        await this.client.start();
      }
    });

    watcher.onDidDelete(async () => {
      // only can be called when config.requireConfig
      this.allowedToStartServer =
        (await workspace.findFiles(oxlintConfigDefaultFilePattern, "**/node_modules/**", 1))
          .length > 0;
      if (!this.allowedToStartServer) {
        this.updateStatusBar(false);
        if (this.client && this.client.isRunning()) {
          await this.client.stop();
        }
      }
    });

    return watcher;
  }
}
