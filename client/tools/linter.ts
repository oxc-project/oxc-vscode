import { promises as fsPromises } from "node:fs";

import {
  commands,
  ConfigurationChangeEvent,
  Diagnostic,
  DiagnosticSeverity,
  ExtensionContext,
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
import type { RuleCustomization } from "../WorkspaceConfig";
import StatusBarItemHandler from "../StatusBarItemHandler";
import { VSCodeConfig } from "../VSCodeConfig";
import { onClientNotification, runExecutable } from "./lsp_helper";
import ToolInterface from "./ToolInterface";

const languageClientName = "oxc";

/**
 * Match a rule name against a glob-like pattern.
 * Supports `*` as a wildcard for all rules, and `*` within a pattern as a glob.
 */
function ruleMatchesPattern(ruleId: string, pattern: string): boolean {
  if (pattern === "*") return true;
  // Convert simple glob pattern to regex: escape special chars, replace * with .*
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(ruleId);
}

/**
 * Apply rules.customizations severity overrides to a diagnostic.
 * Patterns are applied in order; later entries override earlier ones (like CSS specificity).
 */
function applyRulesCustomizations(diag: Diagnostic, customizations: RuleCustomization[]): void {
  if (customizations.length === 0) return;

  const ruleId =
    typeof diag.code === "object" ? String(diag.code?.value ?? "") : String(diag.code ?? "");
  if (!ruleId) return;

  const originalSeverity = diag.severity;
  let newSeverity: DiagnosticSeverity | undefined;

  for (const customization of customizations) {
    if (!ruleMatchesPattern(ruleId, customization.rule)) continue;

    switch (customization.severity) {
      case "downgrade":
        // Downgrade from the original severity (not from a previously customized one)
        if (originalSeverity === DiagnosticSeverity.Error) {
          newSeverity = DiagnosticSeverity.Warning;
        } else if (originalSeverity === DiagnosticSeverity.Warning) {
          newSeverity = DiagnosticSeverity.Information;
        } else if (originalSeverity === DiagnosticSeverity.Information) {
          newSeverity = DiagnosticSeverity.Hint;
        }
        break;
      case "error":
        newSeverity = DiagnosticSeverity.Error;
        break;
      case "warn":
        newSeverity = DiagnosticSeverity.Warning;
        break;
      case "info":
        newSeverity = DiagnosticSeverity.Information;
        break;
      case "default":
        newSeverity = undefined; // reset to original
        break;
      case "off":
        // Mark with Hint severity — VS Code won't show squiggly lines for Hint by default
        newSeverity = DiagnosticSeverity.Hint;
        break;
    }
  }

  if (newSeverity !== undefined) {
    diag.severity = newSeverity;
  }
}

const enum LspCommands {
  FixAll = "oxc.fixAll",
}

export default class LinterTool implements ToolInterface {
  // Global flag to check if the user allows us to start the server.
  // When `oxc.requireConfig` is `true`, make sure one `.oxlintrc.json` file is present.
  private allowedToStartServer: boolean = false;

  // LSP client instance
  private client: LanguageClient | undefined;

  async getBinary(
    outputChannel: LogOutputChannel,
    configService: ConfigService,
  ): Promise<string | undefined> {
    if (process.env.SERVER_PATH_DEV) {
      return process.env.SERVER_PATH_DEV;
    }
    const bin = await configService.getOxlintServerBinPath();
    if (bin) {
      try {
        await fsPromises.access(bin);
        return bin;
      } catch (e) {
        outputChannel.error(`Invalid bin path: ${bin}`, e);
      }
    }
  }

  async activate(
    context: ExtensionContext,
    outputChannel: LogOutputChannel,
    configService: ConfigService,
    statusBarItemHandler: StatusBarItemHandler,
    binaryPath?: string,
  ): Promise<void> {
    if (!binaryPath) {
      statusBarItemHandler.updateTool("linter", false, "No valid oxlint binary found.");
      outputChannel.appendLine("No valid oxlint binary found. Linter will not be activated.");
      return Promise.resolve();
    }

    this.allowedToStartServer = configService.vsCodeConfig.requireConfig
      ? (await workspace.findFiles(`**/{.oxlintrc.json,oxlint.config.ts}`, "**/node_modules/**", 1))
          .length > 0
      : true;

    const restartCommand = commands.registerCommand(OxcCommands.RestartServerLint, async () => {
      await this.restartClient();
      this.updateStatusBar(statusBarItemHandler, configService.vsCodeConfig.enableOxlint);
    });

    const toggleEnable = commands.registerCommand(OxcCommands.ToggleEnableLint, async () => {
      await configService.vsCodeConfig.updateEnableOxlint(!configService.vsCodeConfig.enableOxlint);
      // all future changes are handled by the onConfigChange listener, so we don't need to do it here
    });

    const applyAllFixesFile = commands.registerCommand(OxcCommands.ApplyAllFixesFile, async () => {
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
    });

    context.subscriptions.push(restartCommand, toggleEnable, applyAllFixesFile);

    const run: Executable = runExecutable(
      binaryPath,
      "oxlint",
      configService.vsCodeConfig.nodePath,
      configService.vsCodeConfig.binPathTsGoLint,
    );
    const serverOptions: ServerOptions = {
      run,
      debug: run,
    };

    outputChannel.info(`Using server binary at: ${binaryPath}`);

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
      initializationOptions: configService.oxlintServerConfig,
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
          const customizations = configService.getRulesCustomizations(uri);

          for (const diag of diagnostics) {
            // https://github.com/oxc-project/oxc/issues/12404
            if (
              typeof diag.code === "object" &&
              diag.code?.value === "eslint-plugin-unicorn(filename-case)"
            ) {
              diag.message +=
                "\nYou may need to close the file and restart VSCode after renaming a file by only casing.";
            }

            applyRulesCustomizations(diag, customizations);
          }

          // Filter out diagnostics that have been "turned off" (set to Hint with "off" severity)
          const filtered = customizations.some((c) => c.severity === "off")
            ? diagnostics.filter((d) => {
                const ruleId =
                  typeof d.code === "object" ? String(d.code?.value ?? "") : String(d.code ?? "");
                return !customizations.some(
                  (c) => c.severity === "off" && ruleMatchesPattern(ruleId, c.rule),
                );
              })
            : diagnostics;

          next(uri, filtered);
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

    this.client = new LanguageClient(languageClientName, serverOptions, clientOptions);

    const onNotificationDispose = this.client.onNotification(
      ShowMessageNotification.type,
      (params) => {
        onClientNotification(params, outputChannel);
      },
    );

    context.subscriptions.push(onNotificationDispose);

    const onDeleteFilesDispose = workspace.onDidDeleteFiles((event) => {
      for (const fileUri of event.files) {
        this.client?.diagnostics?.delete(fileUri);
      }
    });

    context.subscriptions.push(onDeleteFilesDispose);

    if (this.allowedToStartServer) {
      if (configService.vsCodeConfig.enableOxlint) {
        await this.client.start();
      }
    } else {
      this.generateActivatorByConfig(configService.vsCodeConfig, context, statusBarItemHandler);
    }

    this.updateStatusBar(statusBarItemHandler, configService.vsCodeConfig.enableOxlint);
  }

  async deactivate(): Promise<void> {
    if (!this.client) {
      return undefined;
    }
    await this.client.stop();
    this.client = undefined;
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

  async restartClient(): Promise<void> {
    if (this.client === undefined) {
      window.showErrorMessage("oxlint client not found");
      return;
    }

    try {
      if (this.client.isRunning()) {
        await this.client.restart();
        window.showInformationMessage("oxlint server restarted.");
      } else {
        await this.client.start();
      }
    } catch (err) {
      this.client.error("Restarting oxlint client failed", err, "force");
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
      await this.toggleClient(configService); // update the client state
    }
    this.updateStatusBar(statusBarItemHandler, configService.vsCodeConfig.enableOxlint);

    if (this.client === undefined) {
      return;
    }

    // update the initializationOptions for a possible restart
    this.client.clientOptions.initializationOptions = configService.oxlintServerConfig;

    if (configService.effectsWorkspaceConfigChange(event) && this.client.isRunning()) {
      await this.client.sendNotification("workspace/didChangeConfiguration", {
        settings: configService.oxlintServerConfig,
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

    statusBarItemHandler.updateTool(
      "linter",
      isEnabled,
      text,
      this.client?.initializeResult?.serverInfo?.version,
    );
  }

  generateActivatorByConfig(
    config: VSCodeConfig,
    context: ExtensionContext,
    statusBarItemHandler: StatusBarItemHandler,
  ): void {
    const watcher = workspace.createFileSystemWatcher(
      "**/{.oxlintrc.json,oxlint.config.ts}",
      false,
      true,
      !config.requireConfig,
    );
    watcher.onDidCreate(async () => {
      this.allowedToStartServer = true;
      this.updateStatusBar(statusBarItemHandler, config.enableOxlint);
      if (this.client && !this.client.isRunning() && config.enableOxlint) {
        await this.client.start();
      }
    });

    watcher.onDidDelete(async () => {
      // only can be called when config.requireConfig
      this.allowedToStartServer =
        (await workspace.findFiles(`**/{.oxlintrc.json,oxlint.config.ts}`, "**/node_modules/**", 1))
          .length > 0;
      if (!this.allowedToStartServer) {
        this.updateStatusBar(statusBarItemHandler, false);
        if (this.client && this.client.isRunning()) {
          await this.client.stop();
        }
      }
    });

    context.subscriptions.push(watcher);
  }
}
