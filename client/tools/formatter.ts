import { promises as fsPromises } from "node:fs";

import {
  CodeAction,
  CodeActionKind,
  commands,
  ConfigurationChangeEvent,
  languages,
  LogOutputChannel,
  Uri,
  workspace,
} from "vscode";
import type { WorkspaceFoldersChangeEvent } from "vscode";

import {
  ConfigurationParams,
  DocumentSelector,
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
import {
  affectsClientState,
  buildStatusBarText,
  ClientLifecycle,
  ClientState,
  computeClientState,
  CreatedClient,
  onClientNotification,
  runExecutable,
} from "./lsp_helper";
import ToolInterface from "./ToolInterface";
import type { BinarySearchResult } from "../findBinary";

const languageClientName = "oxc";

const formatCodeActionKind = CodeActionKind.Source.append("format.oxc");

const formatCodeAction = new CodeAction("Format Document", formatCodeActionKind);
formatCodeAction.command = {
  command: "editor.action.formatDocument",
  title: "Format Document",
  tooltip: "Format the document using the default formatter",
};

// This list is not used as-is for implementation to determine whether formatting processing is possible.
const supportedExtensions = [
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
];

// Special filenames that are valid JS files
// https://github.com/oxc-project/oxc/blob/f3e9913f534e36195b9b5a6244dd21076ed8715e/crates/oxc_formatter/src/service/parse_utils.rs#L47C4-L52
const specialFilenames = [
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
];

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

const disabledStatusReason = "`oxc.enable.oxfmt` or `oxc.enable` is false";

/** The settings which decide what the oxfmt client handles. */
export const formatterStateSections = ["enable", "enable.oxfmt"];

export default class FormatterTool implements ToolInterface {
  private documentPatterns = [
    `**/*.{${supportedExtensions.join(",")}}`,
    ...specialFilenames.map((filename) => `**/${filename}`),
  ];

  // The document selector of the client, also used to offer the `source.format.oxc` code action.
  private documentSelectors = [
    ...this.documentPatterns.map((pattern) => ({
      pattern,
      scheme: "file",
    })),
    ...supportedLanguageIds.map((language) => ({
      language,
    })),
  ];

  // Only one client exists for the whole window, `oxc.enable.oxfmt` is `resource` scoped.
  private readonly lifecycle: ClientLifecycle<BinarySearchResult, LanguageClient>;

  // Command and provider disposables (registered once at construction)
  private readonly restartCommand: { dispose: () => void };
  private readonly toggleEnableCommand: { dispose: () => void };
  private readonly formatActionProvider: { dispose: () => void };

  constructor(
    private readonly outputChannel: LogOutputChannel,
    private readonly configService: ConfigService,
    private readonly statusBarItemHandler: StatusBarItemHandler,
  ) {
    this.lifecycle = new ClientLifecycle({
      toolName: "oxfmt",
      selector: this.documentSelectors,
      isEnabledForResource: (uri) => this.configService.isToolEnabled("oxfmt", uri),
      computeState: () => this.computeClientState(),
      resolveBinary: () => this.getBinary(),
      createClient: (selector, binary) => this.createClient(selector, binary),
      onStateChange: () => this.updateStatusBar(),
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.outputChannel.error(`Failed to update the oxfmt language server: ${message}`);
      },
    });

    // Register commands once at construction
    this.restartCommand = commands.registerCommand(OxcCommands.RestartServerFmt, async () => {
      if (this.outputChannel && this.configService && this.statusBarItemHandler) {
        await this.restart();
      }
    });

    this.toggleEnableCommand = commands.registerCommand(OxcCommands.ToggleEnableFmt, async () => {
      // the status bar shows whether the server runs, the toggle writes the value which stops or
      // starts it
      await this.lifecycle.toggle({
        currentValue: () => this.configService.vsCodeConfig.rawEnableOxfmt,
        update: (value) => this.configService.vsCodeConfig.updateEnableOxfmt(value),
      });
    });

    // Register code action provider once at construction
    this.formatActionProvider = languages.registerCodeActionsProvider(
      this.documentSelectors,
      {
        provideCodeActions: (doc, _range, _context, _token) => {
          if (
            // the client has to run and to handle this document
            !this.lifecycle.handlesDocument(doc) ||
            workspace.getConfiguration("editor", doc).get("defaultFormatter") !== "oxc.oxc-vscode"
          ) {
            return [];
          }
          return [formatCodeAction];
        },
      },
      {
        providedCodeActionKinds: [formatCodeActionKind],
      },
    );
  }

  getLspVersion(): string | undefined {
    return this.lifecycle.client?.initializeResult?.serverInfo?.version;
  }

  async getBinary(): Promise<BinarySearchResult | undefined> {
    if (process.env.SERVER_PATH_DEV_OXFMT) {
      const path = process.env.SERVER_PATH_DEV_OXFMT;
      return { path, loader: path.endsWith(".js") ? "node" : "native" };
    }
    const bin = await this.configService.getOxfmtServerBinPath();
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
    await this.lifecycle.activate(binary);
  }

  private async createClient(
    documentSelector: DocumentSelector,
    binary: BinarySearchResult | undefined,
  ): Promise<CreatedClient<LanguageClient> | undefined> {
    // No valid binary found for the formatter.
    if (!binary) {
      this.outputChannel.appendLine(
        "No valid oxfmt binary found. Formatter will not be activated.",
      );
      return undefined;
    }

    this.outputChannel.info(`Using server binary at: ${binary?.path}`);

    const run: Executable = await runExecutable(
      binary,
      this.configService.vsCodeConfig.useExecPath,
      this.configService.vsCodeConfig.nodePath,
    );

    const serverOptions: ServerOptions = {
      run,
      debug: run,
    };

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
      // The document selector does not depend on the configuration: documents of excluded
      // folders are filtered by the middleware, see the `ClientLifecycle` semantics.
      documentSelector,
      initializationOptions: this.configService.formatterServerConfig,
      outputChannel: this.outputChannel,
      traceOutputChannel: this.outputChannel,
      middleware: {
        // filters out the documents of the workspace folders which are excluded from oxfmt
        ...this.lifecycle.middleware,
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
                this.configService.getWorkspaceConfig(Uri.parse(item.scopeUri))?.toOxfmtConfig() ??
                null
              );
            });
          },
        },
      },
    };

    // Create the language client, the lifecycle starts it.
    const client = new LanguageClient(languageClientName, serverOptions, clientOptions);

    const onNotificationDispose = client.onNotification(ShowMessageNotification.type, (params) => {
      onClientNotification(params, this.outputChannel);
    });

    return {
      client,
      dispose: async () => {
        try {
          await client.dispose();
        } catch {
          // do nothing, the client may already be stopped
        }
        onNotificationDispose.dispose();
      },
    };
  }

  async deactivate(): Promise<void> {
    await this.lifecycle.deactivate();
  }

  async restart(): Promise<void> {
    await this.lifecycle.restart();
  }

  /**
   * Rules 1 to 3: the document selector never changes, the excluded workspace folders do.
   */
  private computeClientState(): Promise<ClientState> {
    return computeClientState({
      folders: workspace.workspaceFolders ?? [],
      windowEnabled: this.configService.vsCodeConfig.enableOxfmt,
      isEnabled: (folder) => this.configService.isToolEnabled("oxfmt", folder.uri),
      isOverriding: (folder) => this.configService.overridesToolEnabled("oxfmt", folder.uri),
      disabledReason: disabledStatusReason,
      missingConfigReason: disabledStatusReason,
    });
  }

  async onWorkspaceFoldersChange(event: WorkspaceFoldersChangeEvent): Promise<void> {
    // the server keeps the documents of a removed workspace folder open, they need a new client
    await this.lifecycle.applyClientStateSafely({ removedFolders: event.removed });
  }

  async onConfigChange(event: ConfigurationChangeEvent): Promise<void> {
    // `oxc.enable` has to be listed: a change of a parent key is not reported for the section of
    // one of its children. A change of `oxc.enable.oxlint` is reported by the parent section too,
    // the state key then skips it.
    if (affectsClientState(event, ConfigService.namespace, formatterStateSections)) {
      // the document selector is applied when the client starts, restart it when it changed
      await this.lifecycle.applyClientStateSafely();
    }
    this.updateStatusBar();

    const client = this.lifecycle.client;
    if (client === undefined) {
      return;
    }

    // update the initializationOptions for a possible restart
    client.clientOptions.initializationOptions = this.configService.formatterServerConfig;

    if (this.configService.effectsWorkspaceConfigChange(event) && client.isRunning()) {
      await client.sendNotification("workspace/didChangeConfiguration", {
        settings: this.configService.formatterServerConfig,
      });
    }
  }

  dispose(): void {
    this.restartCommand.dispose();
    this.toggleEnableCommand.dispose();
    this.formatActionProvider.dispose();
  }

  /**
   * Rule 4: the status bar shows whether the language server is running.
   */
  private updateStatusBar() {
    const isRunning = this.lifecycle.isRunning();

    this.statusBarItemHandler.updateTool(
      "formatter",
      isRunning,
      buildStatusBarText({
        toolName: "oxfmt",
        isRunning,
        reason: this.lifecycle.statusReason,
        showOutputCommand: OxcCommands.ShowOutputChannelFmt,
        restartCommand: OxcCommands.RestartServerFmt,
        toggleCommand: OxcCommands.ToggleEnableFmt,
      }),
      this.lifecycle.client?.initializeResult?.serverInfo?.version,
    );
  }
}
