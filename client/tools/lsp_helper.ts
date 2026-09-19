import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
  EventEmitter,
  languages,
  LogLevel,
  LogOutputChannel,
  RelativePattern,
  Uri,
  window,
  workspace,
  WorkspaceFolder,
} from "vscode";
import type {
  ConfigurationChangeEvent,
  DocumentSelector as VSCodeDocumentSelector,
  TextDocument,
} from "vscode";
import { ConfigurationParams, ShowMessageNotification, vsdiag } from "vscode-languageclient";
import type { DocumentSelector, Middleware } from "vscode-languageclient";
import {
  Executable,
  LanguageClient,
  MessageType,
  ShowMessageParams,
} from "vscode-languageclient/node";
import { affectsClientState } from "../ConfigService";
import type { ConfigService } from "../ConfigService";
import type { BinarySearchResult } from "../findBinary";
import { getShellEnv } from "../getShellEnv";
import type { OxcTool } from "../types";
import type { WorkspaceConfig } from "../WorkspaceConfig";

/**
 * Get the currently configured trace setting for the oxc language server.
 */
const getConfiguredTrace = (): "off" | "messages" | "verbose" =>
  workspace.getConfiguration("oxc").get<"off" | "messages" | "verbose">("trace.server", "off");

/**
 * Get the corresponding LogLevel for the given trace setting.
 */
const getLogLevel = (trace: "off" | "messages" | "verbose"): LogLevel =>
  trace === "off" ? LogLevel.Off : LogLevel.Trace;
/**
 * vscode-languageclient v10 only forwards LSP protocol traces to the trace output
 * channel when that channel's *own* log level is set to `Trace`, ignoring the
 * `oxc.trace.server` setting entirely otherwise (channel log level defaults to `Info`).
 * Wrap the channel so tracing is controlled by `oxc.trace.server` again, like before v10.
 * The wrapped log level is kept off while `oxc.trace.server` is `off`, because v10 falls
 * back to `messages` if the setting is off while the channel's log level is `Trace`.
 * See https://github.com/microsoft/vscode-languageserver-node/issues/1754.
 */
export function createTraceOutputChannel(channel: LogOutputChannel): LogOutputChannel {
  const appendLine = (message: string) => channel.appendLine(message);
  const logLevelEmitter = new EventEmitter<LogLevel>();

  let configuredTrace = getConfiguredTrace();
  let logLevel = getLogLevel(configuredTrace);
  const configListener = workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration("oxc.trace.server")) {
      return;
    }
    const newTrace = getConfiguredTrace();
    if (newTrace !== configuredTrace) {
      configuredTrace = newTrace;
      logLevel = getLogLevel(configuredTrace);
      logLevelEmitter.fire(logLevel);
    }
  });

  return {
    ...channel,
    get logLevel() {
      return logLevel;
    },
    onDidChangeLogLevel: logLevelEmitter.event,
    trace: appendLine,
    debug: appendLine,
    info: appendLine,
    warn: appendLine,
    error: appendLine,
    dispose: () => {
      configListener.dispose();
      logLevelEmitter.dispose();
      channel.dispose();
    },
  };
}

/**
 * Runs the given tasks one after the other.
 *
 * Restarting a language client is not reentrant, two overlapping triggers (two configuration file
 * events, parallel setting updates, a workspace folder added while the tool activates) would
 * otherwise create two clients.
 */
export class TaskQueue {
  private pending: Promise<void> = Promise.resolve();

  public run(task: () => Promise<void>): Promise<void> {
    const next = this.pending.then(task);
    // a failing task must not block the queue
    this.pending = next.then(
      () => {},
      () => {},
    );
    return next;
  }
}

/** Whether the path of `uri` is located inside the path of `folderUri`, the schemes are ignored. */
function isPathInside(folderUri: Uri, uri: Uri): boolean {
  // an unsaved document has a relative path
  if (!path.isAbsolute(uri.fsPath)) {
    return false;
  }
  const relative = path.relative(folderUri.fsPath, uri.fsPath);
  if (relative === "" || path.isAbsolute(relative)) {
    return false;
  }
  // inside unless the relative path starts with a `..` segment: `path.relative` only produces
  // `..` at the start, and an entry named `..archive` is a regular child of the folder
  return relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

/** Whether `uri` is located inside one of the workspace folders. */
export function isInsideFolders(uri: Uri, folders: readonly WorkspaceFolder[]): boolean {
  return folders.some(
    (folder) => folder.uri.scheme === uri.scheme && isPathInside(folder.uri, uri),
  );
}

/**
 * The innermost workspace folder whose path contains the document, whatever its scheme.
 *
 * `workspace.getWorkspaceFolder` also compares the scheme, so a `git:` document of a workspace
 * folder belongs to none of them.
 */
function innermostFolderByPath(uri: Uri): WorkspaceFolder | undefined {
  let innermost: WorkspaceFolder | undefined;
  for (const folder of workspace.workspaceFolders ?? []) {
    if (
      isPathInside(folder.uri, uri) &&
      (innermost === undefined || folder.uri.fsPath.length > innermost.uri.fsPath.length)
    ) {
      innermost = folder;
    }
  }
  return innermost;
}

/**
 * The result of the configuration file search, one per workspace folder: the file which was found,
 * or `null` when there is none. A creation is reported by the file watcher, a file which vanished
 * out of its sight (a renamed directory) is detected when the verdict is read.
 */
export class ConfigFileCache {
  private readonly verdicts = new Map<string, Uri | null>();
  // a search which started before an invalidation must not store its outdated verdict
  private epoch = 0;

  public async get(
    folder: WorkspaceFolder,
    search: () => Promise<Uri | undefined>,
  ): Promise<boolean> {
    const key = folder.uri.toString();
    const known = this.verdicts.get(key);
    if (known === null) {
      return false;
    }
    if (known !== undefined) {
      if (await exists(known)) {
        return true;
      }
      this.verdicts.delete(key);
    }

    const epoch = this.epoch;
    const found = await search();
    if (epoch === this.epoch) {
      this.verdicts.set(key, found ?? null);
    }
    return found !== undefined;
  }

  /** Forgets the verdict of one workspace folder, or of every one. */
  public invalidate(folder?: WorkspaceFolder): void {
    this.epoch += 1;
    if (folder === undefined) {
      this.verdicts.clear();
    } else {
      this.verdicts.delete(folder.uri.toString());
    }
  }
}

async function exists(uri: Uri): Promise<boolean> {
  try {
    await workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

type ConfigRequirement = {
  /** Remembers the search, a recompute for an unrelated setting then costs no I/O. */
  cache?: ConfigFileCache;
  requiresConfig: (folder: WorkspaceFolder) => boolean;
  /** The configuration file names, looked up at the root of the folder first. */
  fileNames: readonly string[];
};

/** The recursive search pattern of the configuration files, used when the root has none. */
export function configFilePattern(fileNames: readonly string[]): string {
  return `**/{${fileNames.join(",")}}`;
}

export type EnabledFolders = {
  /** the workspace folders the tool handles */
  handled: WorkspaceFolder[];
  /** the workspace folders which disabled the tool */
  disabled: WorkspaceFolder[];
  /** the workspace folders which require a configuration file but have none */
  withoutConfig: WorkspaceFolder[];
};

/**
 * The path of `other` relative to `folder` as a glob. A path can contain glob metacharacters, for
 * example a Next.js route directory named `[slug]`: they are matched literally.
 */
function toGlobPath(folder: WorkspaceFolder, other: WorkspaceFolder): string {
  return path
    .relative(folder.uri.fsPath, other.uri.fsPath)
    .split(path.sep)
    .join("/")
    .replace(/[[\]*?{},]/g, (character) => `[${character}]`);
}

/** The configuration file of the folder, the nested workspace folders excluded. */
async function findConfigFile(
  folder: WorkspaceFolder,
  folders: readonly WorkspaceFolder[],
  fileNames: readonly string[],
): Promise<Uri | undefined> {
  // the configuration file is usually at the root of the workspace folder
  const rootFiles = await Promise.all(
    fileNames.map(async (fileName) => {
      const uri = Uri.joinPath(folder.uri, fileName);
      return (await exists(uri)) ? uri : undefined;
    }),
  );
  const rootFile = rootFiles.find((uri) => uri !== undefined);
  if (rootFile !== undefined) {
    return rootFile;
  }

  const nested = folders.filter((other) => isInsideFolders(other.uri, [folder]));
  const excluded = [
    "**/node_modules/**",
    ...nested.map((other) => `${toGlobPath(folder, other)}/**`),
  ];
  const [configFile] = await workspace.findFiles(
    new RelativePattern(folder, configFilePattern(fileNames)),
    new RelativePattern(folder, `{${excluded.join(",")}}`),
    // the first configuration file is enough
    1,
  );

  return configFile;
}

/**
 * Splits the workspace folders into the ones a tool is allowed to handle and the ones it is not.
 *
 * A workspace folder is handled when the tool is enabled for it and, when it requires a
 * configuration file, when such a file exists inside it. A configuration file at the root of the
 * folder is the common case and is checked first. The configuration files of the nested workspace
 * folders do not count, they only count for themselves, they are excluded from the search.
 */
export async function resolveEnabledFolders(options: {
  folders: readonly WorkspaceFolder[];
  isEnabled: (uri: Uri) => boolean;
  /** Only set by the tools which support `oxc.requireConfig`. */
  configRequirement?: ConfigRequirement;
}): Promise<EnabledFolders> {
  const { folders, isEnabled, configRequirement } = options;

  const resolved = await Promise.all(
    folders.map(async (folder) => {
      if (!isEnabled(folder.uri)) {
        return { folder, state: "disabled" as const };
      }
      if (configRequirement === undefined || !configRequirement.requiresConfig(folder)) {
        return { folder, state: "handled" as const };
      }

      const search = () => findConfigFile(folder, folders, configRequirement.fileNames);
      const found = configRequirement.cache
        ? await configRequirement.cache.get(folder, search)
        : (await search()) !== undefined;

      return { folder, state: found ? ("handled" as const) : ("withoutConfig" as const) };
    }),
  );

  const pick = (state: "handled" | "disabled" | "withoutConfig") =>
    resolved.filter((entry) => entry.state === state).map((entry) => entry.folder);

  return {
    handled: pick("handled"),
    disabled: pick("disabled"),
    withoutConfig: pick("withoutConfig"),
  };
}

/** What the client has to handle, and why it does not run. */
export type ClientState = {
  /** Whether the language server has to run. */
  shouldRun: boolean;
  /**
   * The window level value of the enable setting. The documents outside of every workspace folder
   * follow it, so a change of it has to recreate the client to resynchronize them.
   */
  windowEnabled: boolean;
  /**
   * The window level value of `oxc.requireConfig`. No configuration file can be looked up for the
   * documents outside of every workspace folder, they are not handled when it is set.
   */
  windowRequiresConfig: boolean;
  /** The uris of the workspace folders whose documents must not reach the language server. */
  excludedFolders: ReadonlySet<string>;
  /** Why the language server does not run, shown in the status bar. */
  reason?: string;
};

const stoppedState = (): ClientState => ({
  shouldRun: false,
  windowEnabled: true,
  windowRequiresConfig: false,
  excludedFolders: new Set(),
});

/**
 * The single branching of the per folder settings, shared by both tools.
 *
 * The document selector never changes, only the workspace folders which are excluded from it do.
 */
export async function computeClientState(options: {
  folders: readonly WorkspaceFolder[];
  /** `oxc.enable.<tool>` resolved without a resource. */
  windowEnabled: boolean;
  /** `oxc.requireConfig` resolved without a resource, only for the tools which support it. */
  windowRequiresConfig?: boolean;
  isEnabled: (uri: Uri) => boolean;
  configRequirement?: ConfigRequirement;
  /** Shown when the tool is disabled at the window level. */
  disabledReason: string;
  /** Shown when the window enables the tool but every workspace folder disables it. */
  foldersDisabledReason: string;
  /** Shown when every workspace folder misses its configuration file. */
  missingConfigReason?: string;
}): Promise<ClientState> {
  const { folders, windowEnabled, disabledReason } = options;
  const windowRequiresConfig = options.windowRequiresConfig === true;
  const windowValues = { windowEnabled, windowRequiresConfig };

  // no workspace folder is open, the window level configuration decides.
  // `oxc.requireConfig` can not be fulfilled, there is nothing to search in.
  if (folders.length === 0) {
    if (!windowEnabled) {
      return {
        shouldRun: false,
        ...windowValues,
        excludedFolders: new Set(),
        reason: disabledReason,
      };
    }
    if (windowRequiresConfig) {
      return {
        shouldRun: false,
        ...windowValues,
        excludedFolders: new Set(),
        reason: "no workspace folder is open",
      };
    }
    return { shouldRun: true, ...windowValues, excludedFolders: new Set() };
  }

  const { handled, disabled, withoutConfig } = await resolveEnabledFolders({
    folders,
    isEnabled: options.isEnabled,
    configRequirement: options.configRequirement,
  });

  return {
    // the language server runs as soon as one workspace folder is handled
    shouldRun: handled.length > 0,
    ...windowValues,
    excludedFolders: new Set(
      [...disabled, ...withoutConfig].map((folder) => folder.uri.toString()),
    ),
    reason:
      handled.length > 0
        ? undefined
        : withoutConfig.length > 0
          ? (options.missingConfigReason ?? disabledReason)
          : windowEnabled
            ? options.foldersDisabledReason
            : disabledReason,
  };
}

/** A stable representation of the client state, the client is recreated when it changes. */
export function clientStateKey(state: ClientState): string {
  return JSON.stringify([
    state.shouldRun,
    state.windowEnabled,
    state.windowRequiresConfig,
    [...state.excludedFolders].sort(),
  ]);
}

/** The part of a `LanguageClient` the lifecycle needs. */
export type ManagedClient = {
  start(): Promise<void>;
  isRunning(): boolean;
  /** Fired when the client starts, stops or crashes. */
  onDidChangeState(listener: () => void): { dispose(): void };
  readonly protocol2CodeConverter: {
    asDocumentSelector(selector: DocumentSelector): VSCodeDocumentSelector;
  };
};

/** A client together with the resources registered for it. */
export type CreatedClient<TClient extends ManagedClient> = {
  client: TClient;
  dispose: () => Promise<void>;
};

/**
 * Wraps a language client for the lifecycle: the messages of the server are shown to the user,
 * and disposing it also disposes the given resources.
 */
export function toCreatedClient(
  client: LanguageClient,
  outputChannel: LogOutputChannel,
  ...disposables: { dispose(): unknown }[]
): CreatedClient<LanguageClient> {
  const onNotificationDispose = client.onNotification(ShowMessageNotification.type, (params) => {
    onClientNotification(params, outputChannel);
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
      for (const disposable of disposables) {
        disposable.dispose();
      }
    },
  };
}

/**
 * Answers the `workspace/configuration` requests of the language server with the configuration of
 * the workspace folder it asks for.
 */
export function workspaceConfigurationMiddleware(
  configService: ConfigService,
  toServerConfig: (config: WorkspaceConfig) => unknown,
): NonNullable<Middleware["workspace"]> {
  return {
    configuration: (params: ConfigurationParams) =>
      params.items.map((item) => {
        if (item.section !== "oxc_language_server" || item.scopeUri === undefined) {
          return null;
        }

        const config = configService.getWorkspaceConfig(Uri.parse(item.scopeUri));
        return config === undefined ? null : toServerConfig(config);
      }),
  };
}

type ClientLifecycleOptions<TBinary, TClient extends ManagedClient> = {
  toolName: OxcTool;
  /** The document selector of the client, the same one in every configuration. */
  selector: DocumentSelector;
  /** Where the failures are reported. */
  outputChannel: Pick<LogOutputChannel, "error">;
  /** The commands of the links shown in the status bar. */
  statusCommands: { showOutput: string; restart: string; toggle: string };
  /** `oxc.enable.<tool>` resolved without a resource. */
  isWindowEnabled: () => boolean;
  /** Whether a workspace folder resolves the enable setting differently than the window. */
  hasOverridingFolders: () => boolean;
  /** Computes what the client has to handle. */
  computeState: (configFiles: ConfigFileCache) => Promise<ClientState>;
  /** Searches the binary of the language server. */
  resolveBinary: () => Promise<TBinary | undefined>;
  /** Creates the client, without starting it. Returns `undefined` when it can not be created. */
  createClient: (binary: TBinary | undefined) => Promise<CreatedClient<TClient> | undefined>;
  /** Called after every step, to update the status bar. */
  onStateChange: () => void;
};

/**
 * Owns the language client of one tool: one client serves the whole window.
 *
 * The language server is always given every workspace folder, it creates a worker per announced
 * folder regardless of its options. The middleware filters out the documents of the folders which
 * disabled the tool or lack the configuration file `oxc.requireConfig` asks for, the innermost
 * folder of a document decides and the documents outside of every folder follow the window value.
 * The client is recreated when `clientStateKey` changes, which drops the diagnostics of the
 * excluded folders. Every step runs on one queue and disposes the previous client first, so two
 * triggers can never leave two clients, and two server processes, alive.
 */
export class ClientLifecycle<TBinary, TClient extends ManagedClient> {
  private readonly queue = new TaskQueue();
  private created: CreatedClient<TClient> | undefined;
  // the status bar follows the client, which can stop on its own
  private stateSubscription: { dispose(): void } | undefined;
  private state: ClientState = stoppedState();
  private stateKey: string = "";
  // the binary search walks the workspace folders and reads the connection settings: the cache
  // is dropped by a change of the workspace folders, the settings restart the tool
  private lastBinary: TBinary | undefined;
  // an `applyClientStateSafely` which did not start yet, a new trigger joins it
  private pendingApply: { removedFolders: WorkspaceFolder[]; promise: Promise<void> } | undefined;
  // the converted selector, `languages.match` does not understand the protocol filters
  private matchSelector: VSCodeDocumentSelector = [];
  private reason: string | undefined;
  // false until the first activation and once the tool is gone: a pending event must not create a
  // client then
  private active = false;
  // the tool is gone for good, a late event must not start it again
  private deactivated = false;
  // the documents the server received a `didOpen` for, its view has to stay in sync
  private openDocuments: Set<string> = new Set();

  /**
   * The middleware which keeps the documents of an excluded workspace folder away from the language
   * server. It does nothing as long as no workspace folder is excluded.
   */
  public readonly middleware: Middleware = {
    didOpen: async (document, next) => {
      if (this.ignores(document)) {
        return;
      }
      this.openDocuments.add(document.uri.toString());
      await next(document);
    },
    didChange: async (event, next) => {
      // the server only knows the documents it received a `didOpen` for
      if (!this.openDocuments.has(event.document.uri.toString())) {
        return;
      }
      await next(event);
    },
    didSave: async (document, next) => {
      if (!this.openDocuments.has(document.uri.toString())) {
        return;
      }
      await next(document);
    },
    didClose: async (document, next) => {
      if (!this.openDocuments.delete(document.uri.toString())) {
        return;
      }
      await next(document);
    },
    provideDiagnostics: (document, previousResultId, token, next) => {
      if (this.ignores(document)) {
        // an empty report clears the diagnostics of the document
        return { kind: vsdiag.DocumentDiagnosticReportKind.full, items: [] };
      }
      return next(document, previousResultId, token);
    },
    provideCodeActions: (document, range, context, token, next) => {
      if (this.ignores(document)) {
        return [];
      }
      return next(document, range, context, token);
    },
    provideDocumentFormattingEdits: (document, options, token, next) => {
      if (this.ignores(document)) {
        return [];
      }
      return next(document, options, token);
    },
    provideDocumentRangeFormattingEdits: (document, range, options, token, next) => {
      if (this.ignores(document)) {
        return [];
      }
      return next(document, range, options, token);
    },
  };

  constructor(private readonly options: ClientLifecycleOptions<TBinary, TClient>) {
    this.reason = `${options.toolName} is not running yet`;
  }

  public get client(): TClient | undefined {
    return this.created?.client;
  }

  /** The status bar entry: why the server does not run, the links and the note on the toggle. */
  public statusText(): string {
    const { showOutput, restart, toggle } = this.options.statusCommands;
    const isRunning = this.isRunning();

    return [
      isRunning
        ? undefined
        : (this.reason ?? `the ${this.options.toolName} language server stopped`),
      `[$(terminal) Open Output](command:${showOutput})`,
      `[$(refresh) Restart Server](command:${restart})`,
      isRunning
        ? `[$(stop) Stop Server](command:${toggle})`
        : `[$(play) Start Server](command:${toggle})`,
      this.options.hasOverridingFolders()
        ? `\`oxc.enable.${this.options.toolName}\` of a workspace folder wins over this toggle.`
        : undefined,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  public isRunning(): boolean {
    return this.created?.client.isRunning() === true;
  }

  /** The verdicts of the configuration file search, see `invalidateConfigFile`. */
  private readonly configFiles = new ConfigFileCache();

  /**
   * Forgets what is known about the configuration files of a workspace folder, or of every one.
   * The next state computation searches them again.
   */
  public invalidateConfigFile(folder?: WorkspaceFolder): void {
    this.configFiles.invalidate(folder);
  }

  /**
   * Applies the added or removed workspace folders: what was searched in the previous ones, the
   * configuration files and the binary, is searched again.
   */
  public onWorkspaceFoldersChange(removedFolders: readonly WorkspaceFolder[]): Promise<void> {
    this.configFiles.invalidate();
    this.lastBinary = undefined;
    return this.applyClientStateSafely(removedFolders);
  }

  /** Creates the client with an already resolved binary. */
  public activate(binary: TBinary | undefined): Promise<void> {
    this.active = true;
    this.deactivated = false;
    return this.queue.run(() => this.recreate(async () => binary));
  }

  public restart(): Promise<void> {
    // a settings sync or a trust grant can fire while the extension deactivates
    if (this.deactivated) {
      return Promise.resolve();
    }
    this.active = true;
    return this.queue.run(() => this.recreate(this.options.resolveBinary));
  }

  /** Terminal state: the client is disposed and the pending events do not create a new one. */
  public deactivate(): Promise<void> {
    this.active = false;
    this.deactivated = true;
    return this.queue.run(async () => {
      await this.disposeClient();
      this.lastBinary = undefined;
      this.state = stoppedState();
      this.matchSelector = [];
    });
  }

  /**
   * Recreates the client when what it has to handle changed, for event handlers: it never rejects.
   *
   * `removedFolders` forces the recreation when the server still has open documents of a workspace
   * folder which is gone, its view of them can not be corrected otherwise.
   */
  public applyClientStateSafely(removedFolders: readonly WorkspaceFolder[] = []): Promise<void> {
    // the queued apply computes the state when it starts, it covers this trigger too
    if (this.pendingApply !== undefined) {
      this.pendingApply.removedFolders.push(...removedFolders);
      return this.pendingApply.promise;
    }

    // shared with the triggers which join this apply, the queued task reads it when it starts
    const removed = [...removedFolders];
    const promise = this.queue.run(async () => {
      this.pendingApply = undefined;

      // before the first activation the binary is not known yet, and after the deactivation the
      // tool is gone: a watcher or workspace folder event must not create a client
      if (!this.active) {
        return;
      }

      // the failure is logged here once, the triggers which joined this apply only wait for it
      try {
        const state = await this.options.computeState(this.configFiles);
        const needsResync =
          this.hasOpenDocumentIn(removed) || this.hasUnsynchronizedDocuments(state);

        await this.applyState(state, needsResync);
      } catch (error) {
        this.reportError(error);
      }
    });
    this.pendingApply = { removedFolders: removed, promise };

    return promise;
  }

  /** Runs inside a queued task: applies a freshly computed state. */
  private async applyState(state: ClientState, force: boolean = false): Promise<void> {
    // the queue serializes the steps, the key is up to date here.
    // a client which is not running anymore, after a crash or a start which was given up,
    // has to be recreated even when the state did not change.
    const isUpToDate =
      !force && clientStateKey(state) === this.stateKey && (!state.shouldRun || this.isRunning());

    if (isUpToDate) {
      // the reason may have changed
      this.state = state;
      this.updateReason(state);
      this.notifyStateChange();
      return;
    }

    await this.recreate(async () => this.lastBinary ?? this.options.resolveBinary(), state);
  }

  private hasOpenDocumentIn(folders: readonly WorkspaceFolder[]): boolean {
    if (folders.length === 0 || this.openDocuments.size === 0) {
      return false;
    }
    return [...this.openDocuments].some((uri) => {
      const document = Uri.parse(uri);
      return folders.some((folder) => isPathInside(folder.uri, document));
    });
  }

  /**
   * Whether an open document the server does not know would be handled by the new state.
   *
   * A workspace folder which is added, or which stops being excluded, turns the documents it
   * contains into handled ones. The middleware can not send a `didOpen` for them on its own, the
   * client has to be recreated so that it synchronizes them. The other direction, a handled
   * document which becomes ignored, is handled by the middleware and by the recreation which the
   * state key already triggers.
   */
  private hasUnsynchronizedDocuments(state: ClientState): boolean {
    // without a client there is nothing to synchronize, a new one starts from scratch
    if (this.created === undefined) {
      return false;
    }

    return workspace.textDocuments.some((document) => {
      // the server already knows it
      if (this.openDocuments.has(document.uri.toString())) {
        return false;
      }
      // it is not for this client
      if (languages.match(this.matchSelector, document) === 0) {
        return false;
      }
      return !this.ignoresDocumentIn(document.uri, state);
    });
  }

  /** Whether the document belongs to a workspace folder which is excluded from the tool. */
  public ignoresDocument(uri: Uri): boolean {
    return this.ignoresDocumentIn(uri, this.state);
  }

  // `provideDiagnostics` is asked with a uri for the documents which are not open
  private ignores(document: TextDocument | Uri): boolean {
    return this.ignoresDocument(document instanceof Uri ? document : document.uri);
  }

  private ignoresDocumentIn(uri: Uri, state: ClientState): boolean {
    // the innermost workspace folder of the document decides, nested folders included
    const folder = workspace.getWorkspaceFolder(uri) ?? innermostFolderByPath(uri);
    if (folder === undefined) {
      // documents outside of every workspace folder, and the unsaved ones, follow the window values
      return !state.windowEnabled || state.windowRequiresConfig;
    }

    return state.excludedFolders.has(folder.uri.toString());
  }

  private notifyStateChange(): void {
    this.options.onStateChange();
  }

  /** Whether the running client handles the document. */
  public handlesDocument(document: TextDocument): boolean {
    if (!this.isRunning()) {
      return false;
    }
    if (languages.match(this.matchSelector, document) === 0) {
      return false;
    }
    return !this.ignoresDocument(document.uri);
  }

  /**
   * Starts or stops the language server from the status bar entry.
   *
   * Everything runs in one queued task: the wanted state comes from the last computed state, the
   * setting is only written when the window level value is not the wanted one already, and the
   * new state is applied and reported by this task. A concurrent watcher or restart can therefore
   * neither invert the write nor the report.
   */
  public toggle(
    /** What the label the user clicked offered: starting (`true`) or stopping the server. */
    shouldEnable: boolean,
    options: { update: (value: boolean) => Thenable<void> },
  ): Promise<void> {
    return this.queue.run(async () => {
      if (this.deactivated) {
        return;
      }
      // before the first activation, the setting is picked up by the activation
      if (!this.active) {
        if (this.options.isWindowEnabled() !== shouldEnable) {
          await this.writeSetting(shouldEnable, options.update);
        }
        return;
      }

      // a step queued before the click already did what the label offered
      if (this.isRunning() === shouldEnable) {
        return;
      }

      // the settings already select a running server, but it is not running anymore, after a crash
      // or a start which was given up: writing the setting would change nothing, start it again
      if (shouldEnable && this.state.shouldRun) {
        await this.recreate(this.options.resolveBinary);
        if (!this.isRunning()) {
          window.showInformationMessage(this.reason ?? `${this.options.toolName} is not running.`);
        }
        return;
      }

      // the window level value is the wanted one already, something else (a workspace folder, a
      // missing configuration file) decides: writing the setting would change nothing
      if (this.state.windowEnabled === shouldEnable) {
        this.reportToggleResult(shouldEnable);
        return;
      }

      if (!(await this.writeSetting(shouldEnable, options.update))) {
        return;
      }

      try {
        // the configuration change event also applies the new state, the queue serializes both and
        // the second one finds an up to date state
        await this.applyState(await this.options.computeState(this.configFiles));
      } catch (error) {
        this.reportError(error);
        this.notifyStateChange();
        return;
      }

      this.reportToggleResult(shouldEnable);
    });
  }

  /** Writes the setting, a failure is shown to the user. */
  private async writeSetting(
    value: boolean,
    update: (value: boolean) => Thenable<void>,
  ): Promise<boolean> {
    try {
      await update(value);
      return true;
    } catch (error) {
      window.showErrorMessage(this.reportError(error));
      this.notifyStateChange();
      return false;
    }
  }

  /**
   * Tells the user why a toggle did not have the expected effect:
   * because a workspace folder sets the value itself, or for the last known reason.
   */
  private reportToggleResult(expectedRunning: boolean): void {
    if (this.isRunning() === expectedRunning) {
      return;
    }

    // the settings select a running server, a workspace folder is not what prevents it
    if (!(expectedRunning && this.state.shouldRun) && this.options.hasOverridingFolders()) {
      window.showInformationMessage(
        `\`oxc.enable.${this.options.toolName}\` of a workspace folder takes precedence over this toggle.`,
      );
      return;
    }

    window.showInformationMessage(
      this.reason ?? `${this.options.toolName} did not change its state.`,
    );
  }

  /** Logs the failure and returns the message. */
  private reportError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const report = `Failed to update the ${this.options.toolName} language server: ${message}`;
    this.options.outputChannel.error(report);
    return report;
  }

  private async recreate(
    resolveBinary: () => Promise<TBinary | undefined>,
    precomputedState?: ClientState,
  ): Promise<void> {
    // the previous client is dropped, a failure before that point keeps it
    let disposed = false;
    try {
      // the running client keeps serving while the configuration files are searched and the
      // binary is resolved, which can be slow
      const state = precomputedState ?? (await this.options.computeState(this.configFiles));
      // no workspace folder is handled, the binary is not even needed
      const binary = state.shouldRun ? await resolveBinary() : undefined;
      if (state.shouldRun) {
        this.lastBinary = binary;
      }

      // never leave two clients alive, the previous one is disposed before the next is created
      await this.disposeClient();
      disposed = true;

      this.state = state;
      this.stateKey = clientStateKey(state);
      this.updateReason(state);
      if (!state.shouldRun) {
        return;
      }

      const created = await this.options.createClient(binary);
      if (created === undefined) {
        // no client could be created, the next trigger tries again
        this.reason = `no valid ${this.options.toolName} binary found`;
        return;
      }

      this.created = created;
      this.stateSubscription = created.client.onDidChangeState(() => this.notifyStateChange());
      this.matchSelector = created.client.protocol2CodeConverter.asDocumentSelector(
        this.options.selector,
      );

      try {
        await created.client.start();
        this.reason = undefined;
      } catch (error) {
        // the client is dead, drop it, the next trigger creates a new one
        await this.disposeClient();
        this.lastBinary = undefined;
        this.reason = `the ${this.options.toolName} language server failed to start`;
        this.reportError(error);
      }
    } catch (error) {
      // searching the binary or creating the client failed. Once the previous client is dropped, the
      // next trigger tries again because the state asks for a server which is not running
      // before that point the running client is untouched, neither the state nor the reason say
      // otherwise: it is only reported
      if (disposed) {
        await this.disposeClient();
        this.lastBinary = undefined;
        this.reason = `the ${this.options.toolName} language server could not be started`;
      }
      this.reportError(error);
    } finally {
      this.notifyStateChange();
    }
  }

  /**
   * Keeps the last known reason when the new state does not know a better one, and forgets it once
   * the state asks for a server which runs.
   */
  private updateReason(state: ClientState): void {
    if (state.reason !== undefined) {
      this.reason = state.reason;
    } else if (state.shouldRun && this.isRunning()) {
      this.reason = undefined;
    }
  }

  private async disposeClient(): Promise<void> {
    const created = this.created;
    this.created = undefined;
    this.stateSubscription?.dispose();
    this.stateSubscription = undefined;
    this.matchSelector = [];
    // a new client synchronizes the documents from scratch
    this.openDocuments.clear();
    if (created === undefined) {
      return;
    }

    // disposing the client also stops it
    await created.dispose();
  }
}

/**
 * The flow shared by the tools when a configuration changes: the client state is applied, the
 * initialization options are kept up to date for a restart, and the running server is told about
 * the new settings.
 */
export async function applyConfigChange<TBinary>(
  lifecycle: ClientLifecycle<TBinary, LanguageClient>,
  tool: OxcTool,
  event: ConfigurationChangeEvent,
  options: {
    serverConfig: () => unknown;
    /** Whether the change restarts the tool, which recomputes the client state anyway. */
    effectsConnection: (event: ConfigurationChangeEvent) => boolean;
    /** Whether the change affects an option sent to the language server. */
    effectsServerConfig: (event: ConfigurationChangeEvent) => boolean;
  },
): Promise<void> {
  // a change of `oxc.enable.<other tool>` is also reported here, the state key then skips it
  if (affectsClientState(event, tool) && !options.effectsConnection(event)) {
    await lifecycle.applyClientStateSafely();
  }

  const client = lifecycle.client;
  if (client === undefined) {
    return;
  }

  const serverConfig = options.serverConfig();
  // update the initializationOptions for a possible restart
  client.clientOptions.initializationOptions = serverConfig;

  if (options.effectsServerConfig(event) && client.isRunning()) {
    await client.sendNotification("workspace/didChangeConfiguration", { settings: serverConfig });
  }
}

export async function runExecutable(
  binary: BinarySearchResult,
  useExecPath: boolean = false,
  nodePath?: string,
  tsgolintPath?: string,
  suppressProgramErrors?: boolean,
): Promise<Executable> {
  const shellEnv = await getShellEnv();

  const serverEnv: Record<string, string> = {
    ...shellEnv,
    RUST_LOG: process.env.RUST_LOG || "info", // Keep for backward compatibility for a while
    OXC_LOG: process.env.OXC_LOG || "info",
    NO_COLOR: "1",
  };
  if (tsgolintPath) {
    serverEnv.OXLINT_TSGOLINT_PATH = tsgolintPath;
  }
  if (suppressProgramErrors) {
    serverEnv.OXLINT_TSGOLINT_DANGEROUSLY_SUPPRESS_PROGRAM_DIAGNOSTICS = "true";
  }
  // when the binary path ends with `oxlint/bin/oxlint` or a common js extension, we should run it with `node`
  // the path is defined in `ConfigService.searchNodeModulesBin`
  // Probably it would be better to read the shebang for unknown extensions, and run with `node` if the shebang contains `node`,
  // but for now we can just check for common node extensions and the known path for `oxlint`
  const isNode = binary.loader === "node";

  let nodeCommand: string;
  if (useExecPath) {
    nodeCommand = process.execPath || nodePath || "node";
    serverEnv.ELECTRON_RUN_AS_NODE = "1";
  } else {
    nodeCommand = nodePath || "node";
    delete serverEnv.ELECTRON_RUN_AS_NODE;
  }

  if (path.isAbsolute(nodeCommand)) {
    const nodeDir = path.dirname(nodeCommand);
    serverEnv.PATH = `${nodeDir}${path.delimiter}${serverEnv.PATH ?? ""}`;
  }

  const isWindows = process.platform === "win32";

  // In Yarn PnP environments, inject the PnP loaders so that both CJS require()
  // and ESM import calls can resolve dependencies through PnP.
  // --require .pnp.cjs: patches CJS resolution (e.g., oxlint's NAPI-RS bindings via createRequire)
  // --loader .pnp.loader.mjs: patches ESM resolution (e.g., oxfmt's tinypool import)
  const pnpArgs: string[] = [];
  if (isNode && binary.yarnPnpLoaderPath) {
    pnpArgs.push("--require", binary.yarnPnpLoaderPath);
    const esmLoaderPath = path.join(path.dirname(binary.yarnPnpLoaderPath), ".pnp.loader.mjs");
    pnpArgs.push("--loader", pathToFileURL(esmLoaderPath).href);
  }

  const lspArgs = [...(binary.args ?? []), "--lsp"];

  return isNode || useExecPath
    ? {
        command: nodeCommand,
        args: [...pnpArgs, binary.path, ...lspArgs],
        options: {
          env: serverEnv,
        },
      }
    : {
        // On Windows with shell, quote the command path to handle spaces in usernames/paths
        command: isWindows ? `"${binary.path}"` : binary.path,
        args: lspArgs,
        options: {
          // On Windows we need to run the binary in a shell to be able to execute the shell npm bin script.
          // Searching for the right `.exe` file inside `node_modules/` is not reliable as it depends on
          // the package manager used (npm, yarn, pnpm, etc) and the package version.
          // The npm bin script is a shell script that points to the actual binary.
          // Security: We validated the user defined binary path in `configService.searchBinaryPath()`.
          shell: isWindows,
          env: serverEnv,
        },
      };
}

export function onClientNotification(params: ShowMessageParams, outputChannel: LogOutputChannel) {
  switch (params.type) {
    case MessageType.Debug:
      outputChannel.debug(params.message);
      break;
    case MessageType.Log:
      outputChannel.info(params.message);
      break;
    case MessageType.Info:
      window.showInformationMessage(params.message);
      break;
    case MessageType.Warning:
      window.showWarningMessage(params.message);
      break;
    case MessageType.Error:
      window.showErrorMessage(params.message);
      break;
    default:
      outputChannel.info(params.message);
  }
}
