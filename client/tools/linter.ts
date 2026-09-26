import { promises as fsPromises } from "node:fs";

import {
  CodeActionKind,
  CodeActionTriggerKind,
  commands,
  ConfigurationChangeEvent,
  LogOutputChannel,
  Uri,
  window,
  workspace,
} from "vscode";
import type {
  CodeActionContext,
  FileSystemWatcher,
  TextDocument,
  WorkspaceFoldersChangeEvent,
} from "vscode";

import {
  ConfigurationParams,
  DocumentSelector,
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

const enum LspCommands {
  FixAll = "oxc.fixAll",
}

const oxlintConfigFileNames = [
  ".oxlintrc.json",
  ".oxlintrc.jsonc",
  "oxlint.config.ts",
  "oxlint.config.mts",
];

const oxlintConfigDefaultFilePattern = `**/{${oxlintConfigFileNames.join(",")}}`;

const disabledStatusReason = "`oxc.enable.oxlint` or `oxc.enable` is false";

/** The settings which decide what the oxlint client handles. */
export const linterStateSections = ["enable", "enable.oxlint", "requireConfig"];

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

const oxlintDocumentPattern = `**/*.{${supportedExtensions.join(",")}}`;

// The document selector of the oxlint client. It is the same in every configuration, see the
// `ClientLifecycle` semantics.
const broadDocumentSelector: DocumentSelector = [
  {
    pattern: oxlintDocumentPattern,
    scheme: "file",
  },
];

const oxlintSourceCodeActionKinds = [
  CodeActionKind.SourceFixAll.append("oxc"),
  CodeActionKind.Source.append("fixAllDangerous.oxc"),
];
const oxlintCodeActionKinds = [CodeActionKind.QuickFix, ...oxlintSourceCodeActionKinds];

type CodeActionsOnSaveSetting = boolean | "always" | "explicit" | "never";
type CodeActionsOnSave = Record<string, CodeActionsOnSaveSetting | undefined>;
type CodeActionsOnSaveConfiguration = CodeActionsOnSave | string[];

function isEnabledCodeActionsOnSaveSetting(setting: CodeActionsOnSaveSetting | undefined): boolean {
  // VS Code accepts legacy boolean values and current string values here.
  return setting === true || setting === "always" || setting === "explicit";
}

/** Checks whether save settings enable one concrete oxlint code action kind. */
export function shouldCodeActionsOnSaveRequestOxlint(
  codeActionsOnSave: CodeActionsOnSaveConfiguration,
  requestedKind: CodeActionKind,
): boolean {
  if (Array.isArray(codeActionsOnSave)) {
    return codeActionsOnSave.some((configuredKind) =>
      CodeActionKind.Empty.append(configuredKind).contains(requestedKind),
    );
  }

  let matchedKind: CodeActionKind | undefined;
  let matchedSetting: CodeActionsOnSaveSetting | undefined;
  for (const [configuredKindValue, configuredSetting] of Object.entries(codeActionsOnSave)) {
    if (configuredSetting === undefined) {
      continue;
    }
    const configuredKind = CodeActionKind.Empty.append(configuredKindValue);
    if (
      configuredKind.contains(requestedKind) &&
      (matchedKind === undefined || matchedKind.contains(configuredKind))
    ) {
      // The most specific setting overrides broader parents such as `source`.
      matchedKind = configuredKind;
      matchedSetting = configuredSetting;
    }
  }

  return isEnabledCodeActionsOnSaveSetting(matchedSetting);
}

function getCodeActionsOnSaveConfiguration(
  document: TextDocument,
): CodeActionsOnSaveConfiguration | undefined {
  return workspace
    .getConfiguration("editor", document)
    .get<CodeActionsOnSaveConfiguration>("codeActionsOnSave");
}

/** Filters code action requests before they reach the oxlint language server. */
export function shouldRequestOxlintCodeActions(
  context: CodeActionContext,
  codeActionsOnSave?: CodeActionsOnSaveConfiguration,
): boolean {
  const requestedKind = context.only;
  if (requestedKind === undefined) {
    // Empty automatic probes are used for editor UI discovery, not an explicit
    // user command or configured fix-all action. Keep diagnostic-bearing
    // automatic requests so VS Code can discover oxlint quick fixes.
    return (
      context.triggerKind !== CodeActionTriggerKind.Automatic || context.diagnostics.length > 0
    );
  }

  // Oxlint advertises generic `source.fixAll`, so VS Code also routes sibling
  // requests such as `source.fixAll.biome` to this provider. Keep only oxlint's
  // concrete kinds and their valid parents so siblings do not wait in its LSP queue.
  const requestedOxlintKinds = oxlintCodeActionKinds.filter((kind) => requestedKind.contains(kind));
  if (requestedOxlintKinds.length === 0) {
    return false;
  }

  if (context.triggerKind === CodeActionTriggerKind.Automatic) {
    const requestedSourceKinds = requestedOxlintKinds.filter((kind) =>
      CodeActionKind.Source.contains(kind),
    );
    if (requestedSourceKinds.length > 0) {
      // A broad `source` request can include safe and dangerous fix-all actions.
      // Keep it when any requested concrete action is enabled instead of letting
      // an opt-out for one action suppress the other action as well.
      return requestedSourceKinds.some(
        (kind) =>
          codeActionsOnSave !== undefined &&
          shouldCodeActionsOnSaveRequestOxlint(codeActionsOnSave, kind),
      );
    }
  }

  return true;
}

export default class LinterTool implements ToolInterface {
  // Only one client exists for the whole window. `oxc.enable.oxlint` and `oxc.requireConfig` are
  // `resource` scoped, the documents of the excluded workspace folders are filtered out by the
  // middleware of the lifecycle.
  private readonly lifecycle: ClientLifecycle<BinarySearchResult, LanguageClient>;

  // Command disposables (registered once at construction)
  private readonly restartCommand: { dispose: () => void };
  private readonly toggleEnableCommand: { dispose: () => void };
  private readonly applyAllFixesCommand: { dispose: () => void };
  // Watches the configuration files needed by `oxc.requireConfig`, only created when needed
  private configFileWatcher: FileSystemWatcher | undefined;

  constructor(
    private readonly outputChannel: LogOutputChannel,
    private readonly configService: ConfigService,
    private readonly statusBarItemHandler: StatusBarItemHandler,
  ) {
    this.lifecycle = new ClientLifecycle({
      toolName: "oxlint",
      selector: broadDocumentSelector,
      isEnabledForResource: (uri) => this.configService.isToolEnabled("oxlint", uri),
      computeState: () => this.computeClientState(),
      resolveBinary: () => this.getBinary(),
      createClient: (selector, binary) => this.createClient(selector, binary),
      onStateChange: () => this.updateStatusBar(),
      onError: (error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.outputChannel.error(`Failed to update the oxlint language server: ${message}`);
      },
    });

    // Register commands once at construction
    this.restartCommand = commands.registerCommand(OxcCommands.RestartServerLint, async () => {
      if (this.outputChannel && this.configService && this.statusBarItemHandler) {
        await this.restart();
      }
    });

    this.toggleEnableCommand = commands.registerCommand(OxcCommands.ToggleEnableLint, async () => {
      // the status bar shows whether the server runs, the toggle writes the value which stops or
      // starts it
      await this.lifecycle.toggle({
        currentValue: () => this.configService.vsCodeConfig.rawEnableOxlint,
        update: (value) => this.configService.vsCodeConfig.updateEnableOxlint(value),
      });
    });

    this.applyAllFixesCommand = commands.registerCommand(
      OxcCommands.ApplyAllFixesFile,
      async () => {
        const client = this.lifecycle.client;
        if (!client) {
          window.showErrorMessage("oxc client not found");
          return;
        }
        const textEditor = window.activeTextEditor;
        if (!textEditor) {
          window.showErrorMessage("active text editor not found");
          return;
        }

        if (!this.lifecycle.handlesDocument(textEditor.document)) {
          window.showWarningMessage("oxlint is not enabled for this file.");
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

        await client.sendRequest(ExecuteCommandRequest.type, params);
      },
    );

    this.syncConfigFileWatcher();
  }

  /**
   * A created or deleted configuration file can add or remove a workspace folder from the document
   * selector, but only when `oxc.requireConfig` is used somewhere.
   */
  private syncConfigFileWatcher(): void {
    const isNeeded = this.configService.requiresConfigInAnyWorkspace();
    if (isNeeded === (this.configFileWatcher !== undefined)) {
      return;
    }

    if (!isNeeded) {
      this.configFileWatcher?.dispose();
      this.configFileWatcher = undefined;
      return;
    }

    const watcher = workspace.createFileSystemWatcher(
      oxlintConfigDefaultFilePattern,
      false,
      true,
      false,
    );
    watcher.onDidCreate(async (uri) => {
      await this.onConfigFileChange(uri);
    });
    watcher.onDidDelete(async (uri) => {
      await this.onConfigFileChange(uri);
    });
    this.configFileWatcher = watcher;
  }

  private async onConfigFileChange(uri: Uri): Promise<void> {
    // a configuration file of a dependency never adds a workspace folder
    if (uri.path.includes("/node_modules/")) {
      return;
    }
    // only the workspace folders which require a configuration file can change their state
    if (!this.configService.requiresConfig(uri)) {
      return;
    }
    await this.lifecycle.applyClientStateSafely();
  }

  getLspVersion(): string | undefined {
    return this.lifecycle.client?.initializeResult?.serverInfo?.version;
  }

  async getBinary(): Promise<BinarySearchResult | undefined> {
    if (process.env.SERVER_PATH_DEV_OXLINT) {
      const path = process.env.SERVER_PATH_DEV_OXLINT;
      return { path, loader: path.endsWith(".js") ? "node" : "native" };
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
    await this.lifecycle.activate(binary);
  }

  private async createClient(
    documentSelector: DocumentSelector,
    binary: BinarySearchResult | undefined,
  ): Promise<CreatedClient<LanguageClient> | undefined> {
    if (!binary) {
      this.outputChannel.appendLine("No valid oxlint binary found. Linter will not be activated.");
      return undefined;
    }

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

    const sharedMiddleware = this.lifecycle.middleware;

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
      // The document selector does not depend on the configuration: documents of excluded
      // folders are filtered by the middleware, see the `ClientLifecycle` semantics.
      documentSelector,
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
        // filters out the documents of the workspace folders which are excluded from oxlint
        ...sharedMiddleware,
        provideCodeActions: (document, range, context, token, next) =>
          // the shared guard runs first, the oxlint specific filter is its `next`
          sharedMiddleware.provideCodeActions!(document, range, context, token, () => {
            const needsCodeActionsOnSaveConfig =
              context.triggerKind === CodeActionTriggerKind.Automatic &&
              context.only !== undefined &&
              oxlintSourceCodeActionKinds.some((kind) => context.only?.contains(kind));

            if (
              !shouldRequestOxlintCodeActions(
                context,
                needsCodeActionsOnSaveConfig
                  ? getCodeActionsOnSaveConfiguration(document)
                  : undefined,
              )
            ) {
              return [];
            }

            return next(document, range, context, token);
          }),
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

    const client = new LanguageClient(languageClientName, serverOptions, clientOptions);

    const onNotificationDispose = client.onNotification(ShowMessageNotification.type, (params) => {
      onClientNotification(params, this.outputChannel);
    });

    const onDeleteFilesDispose = workspace.onDidDeleteFiles((event) => {
      for (const fileUri of event.files) {
        client.diagnostics?.delete(fileUri);
      }
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
        onDeleteFilesDispose.dispose();
      },
    };
  }

  async deactivate(): Promise<void> {
    await this.lifecycle.deactivate();
  }

  dispose(): void {
    this.restartCommand.dispose();
    this.toggleEnableCommand.dispose();
    this.applyAllFixesCommand.dispose();
    this.configFileWatcher?.dispose();
  }

  async restart(): Promise<void> {
    await this.lifecycle.restart();
  }

  async onConfigChange(event: ConfigurationChangeEvent): Promise<void> {
    // `oxc.enable` has to be listed: a change of a parent key is not reported for the section of
    // one of its children. A change of `oxc.enable.oxfmt` is reported by the parent section too,
    // the state key then skips it.
    if (affectsClientState(event, ConfigService.namespace, linterStateSections)) {
      // `oxc.requireConfig` decides whether the configuration files have to be watched
      this.syncConfigFileWatcher();
      // the excluded workspace folders are applied when the client starts, restart it when needed
      await this.lifecycle.applyClientStateSafely();
    }
    this.updateStatusBar();

    const client = this.lifecycle.client;
    if (client === undefined) {
      return;
    }

    // update the initializationOptions for a possible restart
    client.clientOptions.initializationOptions = this.configService.oxlintServerConfig;

    if (this.configService.effectsWorkspaceConfigChange(event) && client.isRunning()) {
      await client.sendNotification("workspace/didChangeConfiguration", {
        settings: this.configService.oxlintServerConfig,
      });
    }
  }

  async onWorkspaceFoldersChange(event: WorkspaceFoldersChangeEvent): Promise<void> {
    // a nested workspace folder changes the configuration file search of its parent
    this.syncConfigFileWatcher();
    // the server keeps the documents of a removed workspace folder open, they need a new client
    await this.lifecycle.applyClientStateSafely({ removedFolders: event.removed });
  }

  /**
   * ------- Helpers -------
   */

  /**
   * Rules 1 to 3 and 6: the document selector never changes, only the excluded workspace folders do.
   */
  private computeClientState(): Promise<ClientState> {
    const { enableOxlint, requireConfig } = this.configService.vsCodeConfig;

    return computeClientState({
      folders: workspace.workspaceFolders ?? [],
      windowEnabled: enableOxlint,
      windowRequiresConfig: requireConfig,
      isEnabled: (folder) => this.configService.isToolEnabled("oxlint", folder.uri),
      isOverriding: (folder) => this.configService.overridesToolEnabled("oxlint", folder.uri),
      configRequirement: {
        requiresConfig: (folder) => this.configService.requiresConfig(folder.uri),
        fileNames: oxlintConfigFileNames,
        pattern: oxlintConfigDefaultFilePattern,
      },
      disabledReason: disabledStatusReason,
      missingConfigReason: "no oxlint config found",
    });
  }

  /**
   * Rule 4: the status bar shows whether the language server is running.
   */
  updateStatusBar() {
    const isRunning = this.lifecycle.isRunning();

    this.statusBarItemHandler.updateTool(
      "linter",
      isRunning,
      buildStatusBarText({
        toolName: "oxlint",
        isRunning,
        reason: this.lifecycle.statusReason,
        showOutputCommand: OxcCommands.ShowOutputChannelLint,
        restartCommand: OxcCommands.RestartServerLint,
        toggleCommand: OxcCommands.ToggleEnableLint,
      }),
      this.lifecycle.client?.initializeResult?.serverInfo?.version,
    );
  }
}
