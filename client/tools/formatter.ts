import { promises as fsPromises } from "node:fs";
import * as path from "node:path";

import {
  commands,
  ConfigurationChangeEvent,
  LogOutputChannel,
  Uri,
  workspace,
  WorkspaceFolder,
  WorkspaceFoldersChangeEvent,
} from "vscode";

import { ConfigurationParams, ShowMessageNotification } from "vscode-languageclient";

import {
  Executable,
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
} from "vscode-languageclient/node";

import { OxcCommands } from "../commands";
import { ConfigService } from "../ConfigService";
import StatusBarItemHandler from "../StatusBarItemHandler";
import { onClientNotification, removeExecuteCommandFeature, runExecutable } from "./lsp_helper";
import ToolInterface from "./ToolInterface";

// This list is not used as-is for implementation to determine whether formatting processing is possible.
const supportedExtensions = new Set([
  "cjs",
  "cts",
  "js",
  "jsx",
  "mjs",
  "mts",
  "ts",
  "tsx",
  // https://github.com/oxc-project/oxc/blob/f3e9913f534e36195b9b5a6244dd21076ed8715e/crates/oxc_formatter/src/service/parse_utils.rs#L24-L45
  "_js",
  "bones",
  "es",
  "es6",
  "gs",
  "jake",
  "javascript",
  "jsb",
  "jscad",
  "jsfl",
  "jslib",
  "jsm",
  "jspre",
  "jss",
  "njs",
  "pac",
  "sjs",
  "ssjs",
  "xsjs",
  "xsjslib",
  // https://github.com/oxc-project/oxc/blob/f3e9913f534e36195b9b5a6244dd21076ed8715e/crates/oxc_formatter/src/service/parse_utils.rs#L73
  // allow `*.start.frag` and `*.end.frag`,
  "frag",
  // https://github.com/oxc-project/oxc/pull/16524/
  // JSON
  "json",
  "4DForm",
  "4DProject",
  "avsc",
  "geojson",
  "gltf",
  "har",
  "ice",
  "JSON-tmLanguage",
  "json.example",
  "mcmeta",
  "sarif",
  "tact",
  "tfstate",
  "tfstate.backup",
  "topojson",
  "webapp",
  "webmanifest",
  "yy",
  "yyp",
  // JSONC
  "jsonc",
  "json5",
  "code-snippets",
  "code-workspace",
  "sublime-build",
  "sublime-color-scheme",
  "sublime-commands",
  "sublime-completions",
  "sublime-keymap",
  "sublime-macro",
  "sublime-menu",
  "sublime-mousemap",
  "sublime-project",
  "sublime-settings",
  "sublime-theme",
  "sublime-workspace",
  "sublime_metrics",
  "sublime_session",
  // HTML
  "html",
  "hta",
  "htm",
  "inc",
  "xht",
  "xhtml",
  // Vue
  "vue",
  // Angular
  // mjml
  "mjml",
  // CSS
  "css",
  "wxss",
  "pcss",
  "postcss",
  // less
  "less",
  // scss
  "scss",
  // GraphQL
  "graphql",
  "gql",
  "graphqls",
  // Handlebars
  "handlebars",
  "hbs",
  // Markdown
  "md",
  "livemd",
  "markdown",
  "mdown",
  "mdwn",
  "mkd",
  "mkdn",
  "mkdown",
  "ronn",
  "scd",
  "workbook",
  // mdx
  "mdx",
  // YAML
  "yml",
  "mir",
  "reek",
  "rviz",
  "sublime-syntax",
  "syntax",
  "yaml",
  "yaml-tmlanguage",
  // https://github.com/oxc-project/oxc/pull/17113/
  // TOML
  "toml",
  "toml.example",
  // https://github.com/oxc-project/oxc/pull/19807
  // Svelte
  "svelte",
]);

// Special filenames that are valid JS files
// https://github.com/oxc-project/oxc/blob/f3e9913f534e36195b9b5a6244dd21076ed8715e/crates/oxc_formatter/src/service/parse_utils.rs#L47C4-L52
const specialFilenames = new Set([
  "Jakefile",

  // covered by the "frag" extension above
  // "start.frag",
  // "end.frag",

  // JSON filenames
  ".all-contributorsrc",
  ".arcconfig",
  ".auto-changelog",
  ".c8rc",
  ".htmlhintrc",
  ".imgbotconfig",
  ".nycrc",
  ".tern-config",
  ".tern-project",
  ".watchmanconfig",
  ".babelrc",
  ".jscsrc",
  ".jshintrc",
  ".jslintrc",
  ".swcrc",
  // Markdown filenames
  "contents.lr",
  "README",
  // YAML filenames
  ".clang-format",
  ".clang-tidy",
  ".clangd",
  ".gemrc",
  "CITATION.cff",
  "glide.lock",
  "pixi.lock",
  ".prettierrc",
  ".stylelintrc",
  ".lintstagedrc",
  // https://github.com/oxc-project/oxc/pull/17113/
  // TOML filenames
  "Pipfile",
  "Cargo.toml.orig",
]);

// used for unsaved files with schema `untitled` that have no filename yet
// https://github.com/oxc-project/oxc/blob/3e478df9a329244c005a09da05da503dd2b4d64b/apps/oxfmt/src/lsp/mod.rs#L59-L92
const supportedLanguageIds = [
  "javascript",
  "typescript",
  "javascriptreact",
  "typescriptreact",
  "css",
  "graphql",
  "handlebars",
  "json",
  "jsonc",
  "json5",
  "less",
  "markdown",
  "mdx",
  "mjml",
  "html",
  "scss",
  "toml",
  "vue",
  "yaml",
  "svelte",
  // astro
];

type FolderClientEntry = {
  client: LanguageClient;
};

export default class FormatterTool implements ToolInterface {
  private folderClients: Map<string, FolderClientEntry> = new Map();
  private pendingActivations: Map<string, Promise<void>> = new Map();
  private foldersWithNoBinary: Set<string> = new Set();

  private globalClient: LanguageClient | undefined;
  private globalClientPending: Promise<void> | undefined;
  private noGlobalBinary = false;

  private disposeGlobalResources: (() => Promise<void>) | undefined;

  private async resolveBinary(
    folder: WorkspaceFolder,
    outputChannel: LogOutputChannel,
    configService: ConfigService,
  ): Promise<string | undefined> {
    if (process.env.SERVER_PATH_DEV) {
      return process.env.SERVER_PATH_DEV;
    }
    const bin = await configService.getOxfmtBinPathForFolder(folder);
    if (bin) {
      try {
        await fsPromises.access(bin);
        return bin;
      } catch (e) {
        outputChannel.error(`[${folder.name}] Invalid bin path: ${bin}`, e);
      }
    }
  }

  private async resolveGlobalBinary(
    outputChannel: LogOutputChannel,
    configService: ConfigService,
  ): Promise<string | undefined> {
    if (process.env.SERVER_PATH_DEV) {
      return process.env.SERVER_PATH_DEV;
    }
    const bin = await configService.getOxfmtBinPathGlobal();
    if (bin) {
      try {
        await fsPromises.access(bin);
        return bin;
      } catch (e) {
        outputChannel.error(`Invalid global oxfmt bin path: ${bin}`, e);
      }
    }
  }

  async activate(
    outputChannel: LogOutputChannel,
    configService: ConfigService,
    statusBarItemHandler: StatusBarItemHandler,
  ): Promise<void> {
    const restartCommand = commands.registerCommand(OxcCommands.RestartServerFmt, async () => {
      // Clear so that folders/global are re-checked on next document open
      this.foldersWithNoBinary.clear();
      this.noGlobalBinary = false;
      for (const entry of this.folderClients.values()) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- sequential LSP client restart
        await this.restartOneClient(entry.client);
      }
      if (this.globalClient) {
        await this.restartOneClient(this.globalClient);
      }
      this.updateStatusBar(statusBarItemHandler, configService);
    });

    const toggleEnable = commands.registerCommand(OxcCommands.ToggleEnableFmt, async () => {
      await configService.vsCodeConfig.updateEnableOxfmt(!configService.vsCodeConfig.enableOxfmt);
    });

    // Lazily activate per-folder clients when a matching document is opened
    const onDidOpenDispose = workspace.onDidOpenTextDocument((document) => {
      // Handle untitled files via the global client
      if (document.uri.scheme === "untitled") {
        if (supportedLanguageIds.includes(document.languageId)) {
          void this.ensureGlobalClientActivated(outputChannel, configService, statusBarItemHandler);
        }
        return;
      }

      if (document.uri.scheme !== "file") return;

      const folder = workspace.getWorkspaceFolder(document.uri);
      if (!folder) return;

      // Check extension or special filename match
      const fileName = path.basename(document.uri.fsPath);
      const ext = path.extname(fileName).slice(1);
      const isSupported = (ext && supportedExtensions.has(ext)) || specialFilenames.has(fileName);
      if (!isSupported) return;

      void this.ensureFolderActivated(folder, outputChannel, configService, statusBarItemHandler);
    });

    this.disposeGlobalResources = async () => {
      restartCommand.dispose();
      toggleEnable.dispose();
      onDidOpenDispose.dispose();
    };

    // Activate for already-open documents
    for (const document of workspace.textDocuments) {
      if (document.uri.scheme === "untitled") {
        if (supportedLanguageIds.includes(document.languageId)) {
          void this.ensureGlobalClientActivated(outputChannel, configService, statusBarItemHandler);
        }
        continue;
      }

      if (document.uri.scheme !== "file") continue;

      const folder = workspace.getWorkspaceFolder(document.uri);
      if (!folder) continue;

      const fileName = path.basename(document.uri.fsPath);
      const ext = path.extname(fileName).slice(1);
      const isSupported = (ext && supportedExtensions.has(ext)) || specialFilenames.has(fileName);
      if (!isSupported) continue;

      void this.ensureFolderActivated(folder, outputChannel, configService, statusBarItemHandler);
    }

    this.updateStatusBar(statusBarItemHandler, configService);
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

    const promise = this.activateForFolder(folder, outputChannel, configService)
      .then(() => {
        this.updateStatusBar(statusBarItemHandler, configService);
      })
      .catch((err) => {
        // On failure, the folder stays in neither folderClients nor foldersWithNoBinary,
        // so the next document open in this folder will retry activation.
        outputChannel.error(`[${folder.name}] Failed to activate formatter`, err);
      })
      .finally(() => {
        this.pendingActivations.delete(folderUri);
      });
    this.pendingActivations.set(folderUri, promise);
    return promise;
  }

  private ensureGlobalClientActivated(
    outputChannel: LogOutputChannel,
    configService: ConfigService,
    statusBarItemHandler: StatusBarItemHandler,
  ): Promise<void> {
    if (this.globalClient || this.noGlobalBinary) {
      return Promise.resolve();
    }
    if (this.globalClientPending) return this.globalClientPending;

    const promise = this.activateGlobalClient(outputChannel, configService)
      .then(() => {
        this.updateStatusBar(statusBarItemHandler, configService);
      })
      .catch((err) => {
        outputChannel.error("Failed to activate global formatter client", err);
      })
      .finally(() => {
        this.globalClientPending = undefined;
      });
    this.globalClientPending = promise;
    return promise;
  }

  private async activateForFolder(
    folder: WorkspaceFolder,
    outputChannel: LogOutputChannel,
    configService: ConfigService,
  ): Promise<void> {
    const binaryPath = await this.resolveBinary(folder, outputChannel, configService);
    if (!binaryPath) {
      this.foldersWithNoBinary.add(folder.uri.toString());
      outputChannel.appendLine(
        `[${folder.name}] No valid oxfmt binary found. Formatter will not be activated for this folder.`,
      );
      return;
    }

    outputChannel.info(`[${folder.name}] Using oxfmt binary at: ${binaryPath}`);

    const run: Executable = runExecutable(
      binaryPath,
      "oxfmt",
      configService.vsCodeConfig.useExecPath,
      configService.vsCodeConfig.nodePath,
    );

    const serverOptions: ServerOptions = {
      run,
      debug: run,
    };

    const clientOptions: LanguageClientOptions = {
      documentSelector: [
        {
          pattern: `${folder.uri.fsPath}/**/*.{${[...supportedExtensions].join(",")}}`,
          scheme: "file",
        },
        ...[...specialFilenames].map((filename) => ({
          pattern: `${folder.uri.fsPath}/**/${filename}`,
          scheme: "file",
        })),
      ],
      workspaceFolder: folder,
      initializationOptions: configService.formatterConfigForFolder(folder),
      outputChannel,
      traceOutputChannel: outputChannel,
      middleware: {
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
                configService.getWorkspaceConfig(Uri.parse(item.scopeUri))?.toOxfmtConfig() ?? null
              );
            });
          },
        },
      },
    };

    const clientId = `oxc-fmt-${folder.uri.toString()}`;
    const client = new LanguageClient(clientId, "Oxc Fmt", serverOptions, clientOptions);

    // Prevent duplicate VS Code command registration across clients
    removeExecuteCommandFeature(client);

    client.onNotification(ShowMessageNotification.type, (params) => {
      onClientNotification(params, outputChannel);
    });

    if (configService.vsCodeConfig.enableOxfmt) {
      await client.start();
    }

    this.folderClients.set(folder.uri.toString(), {
      client,
    });
  }

  private async activateGlobalClient(
    outputChannel: LogOutputChannel,
    configService: ConfigService,
  ): Promise<void> {
    const binaryPath = await this.resolveGlobalBinary(outputChannel, configService);
    if (!binaryPath) {
      this.noGlobalBinary = true;
      outputChannel.appendLine(
        "No valid global oxfmt binary found. Formatter will not be activated for untitled files.",
      );
      return;
    }

    outputChannel.info(`Using global oxfmt binary at: ${binaryPath}`);

    const run: Executable = runExecutable(
      binaryPath,
      "oxfmt",
      configService.vsCodeConfig.useExecPath,
      configService.vsCodeConfig.nodePath,
    );

    const serverOptions: ServerOptions = {
      run,
      debug: run,
    };

    const clientOptions: LanguageClientOptions = {
      documentSelector: supportedLanguageIds.map((language) => ({
        language,
        scheme: "untitled",
      })),
      // No workspaceFolder or middleware needed: this client only handles untitled files,
      // so workspace/configuration requests have no applicable folder config to return.
      outputChannel,
      traceOutputChannel: outputChannel,
    };

    const client = new LanguageClient(
      "oxc-fmt-global",
      "Oxc Fmt (Global)",
      serverOptions,
      clientOptions,
    );

    removeExecuteCommandFeature(client);

    client.onNotification(ShowMessageNotification.type, (params) => {
      onClientNotification(params, outputChannel);
    });

    if (configService.vsCodeConfig.enableOxfmt) {
      await client.start();
    }

    this.globalClient = client;
  }

  private async deactivateForFolder(folderUri: string): Promise<void> {
    const entry = this.folderClients.get(folderUri);
    if (!entry) return;

    try {
      await entry.client.stop();
    } catch {
      // client may already be stopped
    }
    await entry.client.dispose();
    this.folderClients.delete(folderUri);
  }

  private async deactivateGlobalClient(): Promise<void> {
    if (!this.globalClient) return;

    try {
      await this.globalClient.stop();
    } catch {
      // client may already be stopped
    }
    await this.globalClient.dispose();
    this.globalClient = undefined;
  }

  async deactivate(): Promise<void> {
    await Promise.all(this.pendingActivations.values());
    await this.globalClientPending;
    await Promise.all([...this.folderClients.keys()].map((uri) => this.deactivateForFolder(uri)));
    await this.deactivateGlobalClient();
    this.foldersWithNoBinary.clear();
    this.noGlobalBinary = false;
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
    this.updateStatusBar(statusBarItemHandler, configService);
  }

  private async restartOneClient(client: LanguageClient): Promise<void> {
    try {
      if (client.isRunning()) {
        await client.restart();
      } else {
        await client.start();
      }
    } catch (err) {
      client.error("Restarting oxfmt client failed", err, "force");
    }
  }

  async toggleClients(configService: ConfigService): Promise<void> {
    for (const entry of this.folderClients.values()) {
      if (entry.client.isRunning()) {
        if (!configService.vsCodeConfig.enableOxfmt) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- sequential LSP client toggle
          await entry.client.stop();
        }
      } else {
        if (configService.vsCodeConfig.enableOxfmt) {
          // oxlint-disable-next-line eslint/no-await-in-loop -- sequential LSP client toggle
          await entry.client.start();
        }
      }
    }

    if (this.globalClient) {
      if (this.globalClient.isRunning()) {
        if (!configService.vsCodeConfig.enableOxfmt) {
          await this.globalClient.stop();
        }
      } else {
        if (configService.vsCodeConfig.enableOxfmt) {
          await this.globalClient.start();
        }
      }
    }
  }

  async onConfigChange(
    event: ConfigurationChangeEvent,
    configService: ConfigService,
    statusBarItemHandler: StatusBarItemHandler,
  ): Promise<void> {
    if (
      event.affectsConfiguration(`${ConfigService.namespace}.enable`) ||
      event.affectsConfiguration(`${ConfigService.namespace}.enable.oxfmt`)
    ) {
      await this.toggleClients(configService);
    }
    this.updateStatusBar(statusBarItemHandler, configService);

    const effectsConfig = configService.effectsWorkspaceConfigChange(event);

    for (const [folderUri, entry] of this.folderClients) {
      const folder = workspace.getWorkspaceFolder(Uri.parse(folderUri));
      if (!folder) continue;

      const config = configService.formatterConfigForFolder(folder);
      entry.client.clientOptions.initializationOptions = config;

      if (effectsConfig && entry.client.isRunning()) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- sequential LSP notification
        await entry.client.sendNotification("workspace/didChangeConfiguration", {
          settings: config,
        });
      }
    }
  }

  private updateStatusBar(
    statusBarItemHandler: StatusBarItemHandler,
    configService: ConfigService,
  ) {
    const enable = configService.vsCodeConfig.enableOxfmt;

    let text =
      `[$(terminal) Open Output](command:${OxcCommands.ShowOutputChannelFmt})\n\n` +
      `[$(refresh) Restart Server](command:${OxcCommands.RestartServerFmt})\n\n`;

    if (enable) {
      text += `[$(stop) Stop Server](command:${OxcCommands.ToggleEnableFmt})\n\n`;
    } else {
      text += `[$(play) Start Server](command:${OxcCommands.ToggleEnableFmt})\n\n`;
    }

    const tooltipText = enable ? undefined : "`oxc.enable.oxfmt` or `oxc.enable` is false";
    if (tooltipText) {
      text = `${tooltipText}\n\n` + text;
    }

    // Collect versions from all running clients
    const versions = new Set<string>();
    for (const entry of this.folderClients.values()) {
      const v = entry.client.initializeResult?.serverInfo?.version;
      if (v) versions.add(v);
    }
    if (this.globalClient) {
      const v = this.globalClient.initializeResult?.serverInfo?.version;
      if (v) versions.add(v);
    }
    const version = versions.size > 0 ? [...versions].join(", ") : undefined;

    statusBarItemHandler.updateTool("formatter", enable, text, version);
  }
}
