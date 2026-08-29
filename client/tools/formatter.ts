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
import type { CodeActionContext } from "vscode";

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
import { onClientNotification, runExecutable } from "./lsp_helper";
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

/** Checks whether a VS Code code-action request includes the Oxfmt format source action. */
export function shouldProvideOxfmtCodeAction(context: CodeActionContext): boolean {
  const requestedKind = context.only;
  if (requestedKind === undefined) {
    return true;
  }

  // A parent `source` request includes each child source action.
  return formatCodeActionKind.intersects(requestedKind);
}

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

export default class FormatterTool implements ToolInterface {
  // LSP client instance
  private client: LanguageClient | undefined;

  private documentSelectors = [
    {
      pattern: `**/*.{${supportedExtensions.join(",")}}`,
      scheme: "file",
    },
    ...specialFilenames.map((filename) => ({
      pattern: `**/${filename}`,
      scheme: "file",
    })),
    ...supportedLanguageIds.map((language) => ({
      language,
    })),
  ];

  private disposeResources: (() => Promise<void>) | undefined;

  // Command and provider disposables (registered once at construction)
  private readonly restartCommand: { dispose: () => void };
  private readonly toggleEnableCommand: { dispose: () => void };
  private readonly formatActionProvider: { dispose: () => void };

  constructor(
    private readonly outputChannel: LogOutputChannel,
    private readonly configService: ConfigService,
    private readonly statusBarItemHandler: StatusBarItemHandler,
  ) {
    // Register commands once at construction
    this.restartCommand = commands.registerCommand(OxcCommands.RestartServerFmt, async () => {
      if (this.outputChannel && this.configService && this.statusBarItemHandler) {
        await this.restart();
      }
    });

    this.toggleEnableCommand = commands.registerCommand(OxcCommands.ToggleEnableFmt, async () => {
      if (this.configService) {
        await this.configService.vsCodeConfig.updateEnableOxfmt(
          !this.configService.vsCodeConfig.enableOxfmt,
        );
      }
    });

    // Register code action provider once at construction
    this.formatActionProvider = languages.registerCodeActionsProvider(
      this.documentSelectors,
      {
        provideCodeActions: (doc, _range, context) => {
          if (
            !this.configService ||
            !this.client ||
            !this.client.isRunning() ||
            this.configService.vsCodeConfig.enableOxfmt === false ||
            !shouldProvideOxfmtCodeAction(context) ||
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
    return this.client?.initializeResult?.serverInfo?.version;
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

  async activate(binary?: BinarySearchResult) {
    // No valid binary found for the formatter.
    if (!binary) {
      this.statusBarItemHandler.updateTool("formatter", false, "No valid oxfmt binary found.");
      this.outputChannel.appendLine(
        "No valid oxfmt binary found. Formatter will not be activated.",
      );
      return Promise.resolve();
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
      // Register the server for plain text documents
      documentSelector: this.documentSelectors,
      initializationOptions: this.configService.formatterServerConfig,
      outputChannel: this.outputChannel,
      traceOutputChannel: this.outputChannel,
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
                this.configService.getWorkspaceConfig(Uri.parse(item.scopeUri))?.toOxfmtConfig() ??
                null
              );
            });
          },
        },
      },
    };

    // Create the language client and start the client.
    this.client = new LanguageClient(languageClientName, serverOptions, clientOptions);

    const onNotificationDispose = this.client.onNotification(
      ShowMessageNotification.type,
      (params) => {
        onClientNotification(params, this.outputChannel);
      },
    );

    this.disposeResources = async () => {
      await this.client?.dispose();
      onNotificationDispose.dispose();
    };

    if (this.configService.vsCodeConfig.enableOxfmt) {
      await this.client.start();
    }
    this.updateStatusBar();
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

  async restart(): Promise<void> {
    await this.deactivate();
    const newBinaryPath = await this.getBinary();
    await this.activate(newBinaryPath);
  }

  async toggleClient(): Promise<void> {
    if (this.client === undefined) {
      return;
    }

    if (this.client.isRunning()) {
      if (!this.configService.vsCodeConfig.enableOxfmt) {
        await this.client.stop();
      }
    } else {
      if (this.configService.vsCodeConfig.enableOxfmt) {
        await this.client.start();
      }
    }
  }

  async onConfigChange(event: ConfigurationChangeEvent): Promise<void> {
    if (
      event.affectsConfiguration(`${ConfigService.namespace}.enable`) ||
      event.affectsConfiguration(`${ConfigService.namespace}.enable.oxfmt`)
    ) {
      await this.toggleClient(); // update the client state
    }
    this.updateStatusBar();

    if (this.client === undefined) {
      return;
    }

    // update the initializationOptions for a possible restart
    this.client.clientOptions.initializationOptions = this.configService.formatterServerConfig;

    if (this.configService.effectsWorkspaceConfigChange(event) && this.client.isRunning()) {
      await this.client.sendNotification("workspace/didChangeConfiguration", {
        settings: this.configService.formatterServerConfig,
      });
    }
  }

  dispose(): void {
    this.restartCommand.dispose();
    this.toggleEnableCommand.dispose();
    this.formatActionProvider.dispose();
  }

  private updateStatusBar() {
    const enable = this.configService.vsCodeConfig.enableOxfmt;

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

    this.statusBarItemHandler.updateTool(
      "formatter",
      enable,
      text,
      this.client?.initializeResult?.serverInfo?.version,
    );
  }
}
