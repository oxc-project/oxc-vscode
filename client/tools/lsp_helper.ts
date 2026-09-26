import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
  languages,
  LogOutputChannel,
  RelativePattern,
  TabInputCustom,
  TabInputNotebook,
  TabInputText,
  TabInputTextDiff,
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
import { vsdiag } from "vscode-languageclient";
import type { DocumentSelector, Middleware } from "vscode-languageclient";
import { Executable, MessageType, ShowMessageParams } from "vscode-languageclient/node";
import type { BinarySearchResult } from "../findBinary";
import { getShellEnv } from "../getShellEnv";

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

/**
 * The documents the language client synchronizes with the server.
 *
 * It only sends the visible ones, which mirrors `vscode-languageclient`: the inputs of every tab,
 * a diff tab counting for its modified side, plus the visible editors for the peek editors.
 */
export function visibleDocumentUris(): Set<string> {
  const uris = new Set<string>();

  for (const group of window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (
        input instanceof TabInputText ||
        input instanceof TabInputCustom ||
        input instanceof TabInputNotebook
      ) {
        uris.add(input.uri.toString());
      } else if (input instanceof TabInputTextDiff) {
        uris.add(input.modified.toString());
      }
    }
  }

  // peek editors are not part of the tabs but are visible
  for (const editor of window.visibleTextEditors) {
    uris.add(editor.document.uri.toString());
  }

  return uris;
}

/** Whether `uri` is located inside one of the workspace folders. */
export function isInsideFolders(uri: Uri, folders: readonly WorkspaceFolder[]): boolean {
  if (folders.length === 0) {
    return false;
  }

  return folders.some((folder) => {
    if (folder.uri.scheme !== uri.scheme) {
      return false;
    }
    const relative = path.relative(folder.uri.fsPath, uri.fsPath);
    if (relative === "" || path.isAbsolute(relative)) {
      return false;
    }
    // inside unless the relative path starts with a `..` segment: `path.relative` only produces
    // `..` at the start, and an entry named `..archive` is a regular child of the folder
    return relative !== ".." && !relative.startsWith(`..${path.sep}`);
  });
}

export type EnabledFolders = {
  /** the workspace folders the tool handles */
  handled: WorkspaceFolder[];
  /** the workspace folders which disabled the tool */
  disabled: WorkspaceFolder[];
  /** the workspace folders which require a configuration file but have none */
  withoutConfig: WorkspaceFolder[];
  /** the workspace folders which resolve the enable setting differently than the window */
  overriding: WorkspaceFolder[];
};

/** Whether one of the file names exists directly inside the folder. */
async function hasRootFile(
  folder: WorkspaceFolder,
  fileNames: readonly string[],
): Promise<boolean> {
  const found = await Promise.all(
    fileNames.map(async (fileName) => {
      try {
        await workspace.fs.stat(Uri.joinPath(folder.uri, fileName));
        return true;
      } catch {
        return false;
      }
    }),
  );

  return found.some(Boolean);
}

/**
 * Splits the workspace folders into the ones a tool is allowed to handle and the ones it is not.
 *
 * A workspace folder is handled when the tool is enabled for it and, when it requires a
 * configuration file, when such a file exists inside it. A configuration file at the root of the
 * folder is the common case and is checked first. The configuration files of the nested workspace
 * folders do not count, they only count for themselves. They are filtered out by comparing paths
 * rather than through an exclude glob built from the folder path: a path can contain glob
 * metacharacters, for example a Next.js route directory named `[slug]`.
 */
export async function resolveEnabledFolders(options: {
  folders: readonly WorkspaceFolder[];
  isEnabled: (folder: WorkspaceFolder) => boolean;
  /** Whether the workspace folder resolves the enable setting differently than the window. */
  isOverriding?: (folder: WorkspaceFolder) => boolean;
  /** Only set by the tools which support `oxc.requireConfig`. */
  configRequirement?: {
    requiresConfig: (folder: WorkspaceFolder) => boolean;
    /** The configuration file names, looked up at the root of the folder first. */
    fileNames?: readonly string[];
    /** The recursive search pattern, used when the root of the folder has no configuration file. */
    pattern: string;
  };
}): Promise<EnabledFolders> {
  const { folders, isEnabled, isOverriding, configRequirement } = options;

  const resolved = await Promise.all(
    folders.map(async (folder) => {
      if (!isEnabled(folder)) {
        return { folder, state: "disabled" as const };
      }
      if (configRequirement === undefined || !configRequirement.requiresConfig(folder)) {
        return { folder, state: "handled" as const };
      }

      // the configuration file is usually at the root of the workspace folder
      if (
        configRequirement.fileNames !== undefined &&
        (await hasRootFile(folder, configRequirement.fileNames))
      ) {
        return { folder, state: "handled" as const };
      }

      const nested = folders.filter((other) => isInsideFolders(other.uri, [folder]));
      const configFiles = await workspace.findFiles(
        new RelativePattern(folder, configRequirement.pattern),
        "**/node_modules/**",
        // without a nested workspace folder, the first configuration file is enough
        nested.length === 0 ? 1 : undefined,
      );
      const ownConfigFile = configFiles.some((uri) => !isInsideFolders(uri, nested));

      return { folder, state: ownConfigFile ? ("handled" as const) : ("withoutConfig" as const) };
    }),
  );

  const pick = (state: "handled" | "disabled" | "withoutConfig") =>
    resolved.filter((entry) => entry.state === state).map((entry) => entry.folder);

  return {
    handled: pick("handled"),
    disabled: pick("disabled"),
    withoutConfig: pick("withoutConfig"),
    overriding: isOverriding === undefined ? [] : folders.filter((folder) => isOverriding(folder)),
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
  /** The workspace folders whose documents must not reach the language server. */
  excludedFolders: readonly WorkspaceFolder[];
  /** Why the language server does not run, shown in the status bar. */
  reason?: string;
  /** Whether a workspace folder resolves its enable setting differently than the window. */
  hasOverridingFolders?: boolean;
};

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
  isEnabled: (folder: WorkspaceFolder) => boolean;
  isOverriding: (folder: WorkspaceFolder) => boolean;
  configRequirement?: {
    requiresConfig: (folder: WorkspaceFolder) => boolean;
    fileNames?: readonly string[];
    pattern: string;
  };
  /** Shown when the tool is disabled everywhere. */
  disabledReason: string;
  /** Shown when every workspace folder misses its configuration file. */
  missingConfigReason: string;
}): Promise<ClientState> {
  const { folders, windowEnabled, windowRequiresConfig, disabledReason } = options;

  // no workspace folder is open, the window level configuration decides.
  // `oxc.requireConfig` can not be fulfilled, there is nothing to search in.
  if (folders.length === 0) {
    if (!windowEnabled) {
      return { shouldRun: false, windowEnabled, excludedFolders: [], reason: disabledReason };
    }
    if (windowRequiresConfig === true) {
      return {
        shouldRun: false,
        windowEnabled,
        excludedFolders: [],
        reason: "no workspace folder is open",
      };
    }
    return { shouldRun: true, windowEnabled, excludedFolders: [] };
  }

  const { handled, disabled, withoutConfig, overriding } = await resolveEnabledFolders({
    folders,
    isEnabled: options.isEnabled,
    isOverriding: options.isOverriding,
    configRequirement: options.configRequirement,
  });

  return {
    // the language server runs as soon as one workspace folder is handled
    shouldRun: handled.length > 0,
    windowEnabled,
    excludedFolders: [...disabled, ...withoutConfig],
    hasOverridingFolders: overriding.length > 0,
    reason:
      handled.length > 0
        ? undefined
        : withoutConfig.length > 0
          ? options.missingConfigReason
          : disabledReason,
  };
}

/**
 * Whether a configuration change can change what the client handles.
 *
 * `affectsConfiguration` matches the changed keys against the section as a prefix: a change of
 * `oxc.enable` is **not** reported for the section `oxc.enable.oxlint`, while a change of
 * `oxc.enable.oxlint` is reported for the section `oxc.enable`. The parent and the tool specific
 * key are therefore both listed, and the change of the other tool which the parent also reports is
 * skipped by the state key.
 */
export function affectsClientState(
  event: ConfigurationChangeEvent,
  namespace: string,
  sections: readonly string[],
): boolean {
  return sections.some((section) => event.affectsConfiguration(`${namespace}.${section}`));
}

/** A stable representation of the client state, the client is recreated when it changes. */
export function clientStateKey(state: ClientState): string {
  return JSON.stringify([
    state.shouldRun,
    state.windowEnabled,
    state.excludedFolders.map((folder) => folder.uri.toString()).sort(),
  ]);
}

/** The status bar entry of one tool. */
export function buildStatusBarText(options: {
  toolName: string;
  isRunning: boolean;
  /** Why the language server does not run. */
  reason?: string;
  showOutputCommand: string;
  restartCommand: string;
  toggleCommand: string;
}): string {
  let text =
    `[$(terminal) Open Output](command:${options.showOutputCommand})\n\n` +
    `[$(refresh) Restart Server](command:${options.restartCommand})\n\n`;

  if (options.isRunning) {
    text += `[$(stop) Stop Server](command:${options.toggleCommand})\n\n`;
  } else {
    text += `[$(play) Start Server](command:${options.toggleCommand})\n\n`;
  }

  text += `\`oxc.enable.${options.toolName}\` of a workspace folder wins over this toggle.\n\n`;

  if (!options.isRunning && options.reason !== undefined) {
    text = `${options.reason}\n\n` + text;
  }

  return text;
}

/** The part of a `LanguageClient` the lifecycle needs. */
export type ManagedClient = {
  start(): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  readonly protocol2CodeConverter: {
    asDocumentSelector(selector: DocumentSelector): VSCodeDocumentSelector;
  };
};

/** A client together with the resources registered for it. */
export type CreatedClient<TClient extends ManagedClient> = {
  client: TClient;
  dispose: () => Promise<void>;
};

export type ClientLifecycleOptions<TBinary, TClient extends ManagedClient> = {
  /** The tool name, used in the messages shown to the user. */
  toolName: string;
  /** The document selector of the client, the same one in every configuration. */
  selector: DocumentSelector;
  /** Whether the tool is enabled for a resource, used for the documents outside of the folders. */
  isEnabledForResource: (uri: Uri) => boolean;
  /** Computes what the client has to handle. */
  computeState: () => Promise<ClientState>;
  /** Searches the binary of the language server. */
  resolveBinary: () => Promise<TBinary | undefined>;
  /** Creates the client, without starting it. Returns `undefined` when it can not be created. */
  createClient: (
    selector: DocumentSelector,
    binary: TBinary | undefined,
  ) => Promise<CreatedClient<TClient> | undefined>;
  /** Called after every step, to update the status bar. */
  onStateChange: () => void;
  /** Called when a step failed, to report it to the user. */
  onError: (error: unknown) => void;
};

/**
 * Owns the language client of one tool.
 *
 * ## Semantics
 *
 * One language client per tool serves the whole window, the `resource` scoped settings are applied
 * to its documents. The rules below are the agreed contract, each one is pinned by a unit test
 * named after its number in `tests/unit/`:
 *
 * 1. **Document selector**: the client always uses the same, historical document selector of its
 *    tool. The per folder settings never change it, so nothing changes for the workspaces which do
 *    not use them.
 * 2. **Excluded workspace folders**: the documents of a workspace folder which disabled the tool,
 *    or which does not fulfil `oxc.requireConfig`, are filtered out by the single shared middleware
 *    of this class. The innermost workspace folder of a document decides, so a workspace folder
 *    nested inside another one is covered too. The language server runs as soon as one workspace
 *    folder is handled, and is recreated when the excluded workspace folders change, which drops
 *    the diagnostics they published.
 * 3. **Outside of the workspace folders**: documents which belong to no workspace folder, such as
 *    unsaved files, and the documents of another scheme follow the window level values.
 * 4. **Toggles**: the toggle commands and the status bar are window wide. The label follows the
 *    real client state, the toggle writes the value which starts or stops the server, and reports
 *    why when the settings of a workspace folder take precedence over it.
 * 5. **Master toggle**: `oxc.enable` wins over `oxc.enable.<tool>` only when it is set at the same
 *    or at a higher precedence level (workspace folder > workspace > user).
 * 6. **`oxc.requireConfig`**: it is evaluated per workspace folder, a folder which enables it and
 *    has no configuration file is excluded, the other folders are not.
 * 7. **`oxc.workingDirectories`**: it is always sent to the language server, an empty list included,
 *    so that clearing it at runtime is unambiguous.
 *
 * Explicit non-goal: the language server is always given every workspace folder of the window, the
 * excluded ones included. It creates a worker per announced folder regardless of its options, so
 * filtering them out of the workspace options would not prevent anything. Per folder enabling is a
 * client concern, handled by the middleware above.
 *
 * Every step runs on one queue and always disposes the previous client first, so two triggers can
 * never leave two clients, and two server processes, alive.
 */
export class ClientLifecycle<TBinary, TClient extends ManagedClient> {
  private readonly queue = new TaskQueue();
  private created: CreatedClient<TClient> | undefined;
  private state: ClientState = { shouldRun: false, windowEnabled: true, excludedFolders: [] };
  // the uris of `state.excludedFolders`, `ignoresDocument` runs for every document
  private excludedFolderUris: Set<string> = new Set();
  private stateKey: string = "";
  // resolved on the next state change, used by the toggle commands
  private stateChangeListeners: (() => void)[] = [];
  // the converted selector, `languages.match` does not understand the protocol filters
  private matchSelector: VSCodeDocumentSelector = [];
  private reason: string | undefined;
  // `idle` until the first activation, `deactivated` once the tool is gone: a pending event must
  // not create a client in those phases
  private phase: "idle" | "active" | "deactivated" = "idle";
  // the documents the server received a `didOpen` for, its view has to stay in sync
  private openDocuments: Set<string> = new Set();

  constructor(private readonly options: ClientLifecycleOptions<TBinary, TClient>) {
    this.reason = `${options.toolName} is not running yet`;
  }

  public get client(): TClient | undefined {
    return this.created?.client;
  }

  /** The last known reason why the language server does not run. */
  public get statusReason(): string | undefined {
    return this.reason;
  }

  public isRunning(): boolean {
    return this.created?.client.isRunning() === true;
  }

  /** Creates the client with an already resolved binary. */
  public activate(binary: TBinary | undefined): Promise<void> {
    this.phase = "active";
    return this.queue.run(() => this.recreate(async () => binary));
  }

  public restart(): Promise<void> {
    this.phase = "active";
    return this.queue.run(() => this.recreate(this.options.resolveBinary));
  }

  /** Terminal state: the client is disposed and the pending events do not create a new one. */
  public deactivate(): Promise<void> {
    this.phase = "deactivated";
    return this.queue.run(async () => {
      await this.disposeClient();
      this.setState({ shouldRun: false, windowEnabled: true, excludedFolders: [] });
      this.stateKey = "";
      this.matchSelector = [];
    });
  }

  /**
   * Recreates the client when what it has to handle changed.
   *
   * `removedFolders` forces the recreation when the server still has open documents of a workspace
   * folder which is gone, its view of them can not be corrected otherwise.
   */
  public applyClientState(options?: {
    removedFolders?: readonly WorkspaceFolder[];
  }): Promise<void> {
    return this.queue.run(async () => {
      // before the first activation the binary is not known yet, and after the deactivation the
      // tool is gone: a watcher or workspace folder event must not create a client
      if (this.phase !== "active") {
        return;
      }

      const state = await this.options.computeState();
      const needsResync =
        (options?.removedFolders !== undefined && this.hasOpenDocumentIn(options.removedFolders)) ||
        this.hasUnsynchronizedDocuments(state);

      await this.applyState(state, needsResync);
    });
  }

  /** Same as `applyClientState`, for event handlers: it never rejects. */
  public async applyClientStateSafely(options?: {
    removedFolders?: readonly WorkspaceFolder[];
  }): Promise<void> {
    try {
      await this.applyClientState(options);
    } catch (error) {
      this.options.onError(error);
    }
  }

  /** Runs inside a queued task: applies a freshly computed state. */
  private async applyState(state: ClientState, force: boolean = false): Promise<void> {
    // the queue serializes the steps, the key is up to date here.
    // a client which is not running anymore, after a crash or a start which was given up,
    // has to be recreated even when the state did not change.
    const isUpToDate =
      !force && clientStateKey(state) === this.stateKey && (!state.shouldRun || this.isRunning());

    if (isUpToDate) {
      // the reason and the overriding workspace folders may have changed
      this.setState(state);
      this.updateReason(state.reason);
      this.notifyStateChange();
      return;
    }

    await this.recreate(this.options.resolveBinary, state);
  }

  private hasOpenDocumentIn(folders: readonly WorkspaceFolder[]): boolean {
    if (folders.length === 0 || this.openDocuments.size === 0) {
      return false;
    }
    return [...this.openDocuments].some((uri) => isInsideFolders(Uri.parse(uri), folders));
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

    const excludedUris = new Set(state.excludedFolders.map((folder) => folder.uri.toString()));
    // only the visible documents are sent to the server, the others are not missing from it
    const visibleUris = visibleDocumentUris();

    return workspace.textDocuments.some((document) => {
      const uri = document.uri.toString();
      // the server already knows it, it would not receive it, or it is not for this client
      if (this.openDocuments.has(uri) || !visibleUris.has(uri)) {
        return false;
      }
      if (languages.match(this.matchSelector, document) === 0) {
        return false;
      }
      return !this.ignoresDocumentIn(document.uri, excludedUris);
    });
  }

  /** Whether the document belongs to a workspace folder which is excluded from the tool. */
  public ignoresDocument(uri: Uri): boolean {
    return this.ignoresDocumentIn(uri, this.excludedFolderUris);
  }

  private ignoresDocumentIn(uri: Uri, excludedUris: ReadonlySet<string>): boolean {
    // the innermost workspace folder of the document decides, nested folders included
    const folder = workspace.getWorkspaceFolder(uri);
    if (folder === undefined) {
      // documents outside of every workspace folder, and the unsaved ones, follow the window value
      return !this.options.isEnabledForResource(uri);
    }

    return excludedUris.has(folder.uri.toString());
  }

  private setState(state: ClientState): void {
    this.state = state;
    this.excludedFolderUris = new Set(state.excludedFolders.map((folder) => folder.uri.toString()));
  }

  private notifyStateChange(): void {
    const listeners = this.stateChangeListeners;
    this.stateChangeListeners = [];
    for (const listener of listeners) {
      listener();
    }
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
   * setting is only written when the level the toggle writes to does not have it already, and the
   * new state is applied and reported by this task. A concurrent watcher or restart can therefore
   * neither invert the write nor the report.
   */
  public toggle(options: {
    /** The raw value of the setting at the level the toggle writes to. */
    currentValue: () => boolean | undefined;
    update: (value: boolean) => Thenable<void>;
  }): Promise<void> {
    return this.queue.run(async () => {
      if (this.phase !== "active") {
        return;
      }

      // the label and the written value come from the same source
      const shouldEnable = !this.isRunning();

      // the settings already select a running server, something else prevents it: writing the
      // setting would not start it, so the stored reason is reported instead
      if (shouldEnable && this.state.shouldRun) {
        window.showInformationMessage(this.reason ?? `${this.options.toolName} is not running.`);
        return;
      }

      // the level the toggle writes to already has the wanted value, writing it changes nothing
      if (options.currentValue() === shouldEnable) {
        this.reportToggleResult(shouldEnable);
        return;
      }

      try {
        await options.update(shouldEnable);
      } catch (error) {
        this.options.onError(error);
        this.notifyStateChange();
        return;
      }

      // the configuration change event also applies the new state, the queue serializes both and
      // the second one finds an up to date state
      await this.applyState(await this.options.computeState());
      this.reportToggleResult(shouldEnable);
    });
  }

  /**
   * Tells the user why a toggle did not have the expected effect:
   * because a workspace folder sets the value itself, or for the last known reason.
   */
  public reportToggleResult(expectedRunning: boolean): void {
    if (this.isRunning() === expectedRunning) {
      return;
    }

    if (this.state.hasOverridingFolders) {
      window.showInformationMessage(
        `\`oxc.enable.${this.options.toolName}\` of a workspace folder takes precedence over this toggle.`,
      );
      return;
    }

    window.showInformationMessage(
      this.reason ?? `${this.options.toolName} did not change its state.`,
    );
  }

  /**
   * The middleware which keeps the documents of an excluded workspace folder away from the language
   * server. It does nothing as long as no workspace folder is excluded.
   */
  public get middleware(): Middleware {
    const ignores = (document: TextDocument | Uri): boolean =>
      this.ignoresDocument(document instanceof Uri ? document : document.uri);

    return {
      didOpen: async (document, next) => {
        if (ignores(document)) {
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
        if (ignores(document)) {
          // an empty report clears the diagnostics of the document
          return { kind: vsdiag.DocumentDiagnosticReportKind.full, items: [] };
        }
        return next(document, previousResultId, token);
      },
      provideCodeActions: (document, range, context, token, next) => {
        if (ignores(document)) {
          return [];
        }
        return next(document, range, context, token);
      },
      provideDocumentFormattingEdits: (document, options, token, next) => {
        if (ignores(document)) {
          return [];
        }
        return next(document, options, token);
      },
      provideDocumentRangeFormattingEdits: (document, range, options, token, next) => {
        if (ignores(document)) {
          return [];
        }
        return next(document, range, options, token);
      },
    };
  }

  private async recreate(
    resolveBinary: () => Promise<TBinary | undefined>,
    precomputedState?: ClientState,
  ): Promise<void> {
    // never leave two clients alive
    await this.disposeClient();

    try {
      this.setState(precomputedState ?? (await this.options.computeState()));
      this.stateKey = clientStateKey(this.state);
      this.updateReason(this.state.reason);

      // no workspace folder is handled, the binary is not even needed
      if (!this.state.shouldRun) {
        return;
      }

      const created = await this.options.createClient(this.options.selector, await resolveBinary());
      if (created === undefined) {
        // no client could be created, let the next trigger try again
        this.stateKey = "";
        this.reason = `no valid ${this.options.toolName} binary found`;
        return;
      }

      this.created = created;
      this.matchSelector = created.client.protocol2CodeConverter.asDocumentSelector(
        this.options.selector,
      );

      try {
        await created.client.start();
        this.reason = undefined;
      } catch (error) {
        // the client is dead, drop it and let the next trigger create a new one
        await this.disposeClient();
        this.stateKey = "";
        this.reason = `the ${this.options.toolName} language server failed to start`;
        this.options.onError(error);
      }
    } catch (error) {
      // searching the binary or creating the client failed, let the next trigger try again
      await this.disposeClient();
      this.stateKey = "";
      this.reason = `the ${this.options.toolName} language server could not be started`;
      this.options.onError(error);
    } finally {
      this.notifyStateChange();
    }
  }

  /** Keeps the last known reason when the new state does not know a better one. */
  private updateReason(reason: string | undefined): void {
    if (reason !== undefined) {
      this.reason = reason;
    }
  }

  private async disposeClient(): Promise<void> {
    const created = this.created;
    this.created = undefined;
    this.matchSelector = [];
    // a new client synchronizes the documents from scratch
    this.openDocuments.clear();
    if (created === undefined) {
      return;
    }

    try {
      await created.client.stop();
    } catch {
      // do nothing, the client may already be stopped
    }
    await created.dispose();
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
