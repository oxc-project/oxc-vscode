import { deepStrictEqual, notStrictEqual, strictEqual } from "assert";
import { commands, ConfigurationTarget, Uri, window, workspace } from "vscode";
import {
  affectsClientState,
  buildStatusBarText,
  ClientLifecycle,
  computeClientState,
  ClientState,
  clientStateKey,
  CreatedClient,
  isInsideFolders,
  ManagedClient,
  resolveEnabledFolders,
  runExecutable,
  TaskQueue,
} from "../../client/tools/lsp_helper";
import type { DocumentSelector } from "vscode-languageclient";
import type { ConfigurationChangeEvent, DocumentSelector as VSCodeDocumentSelector } from "vscode";
import { linterStateSections } from "../../client/tools/linter";
import { formatterStateSections } from "../../client/tools/formatter";
import { WORKSPACE_FOLDER, WORKSPACE_SECOND_FOLDER } from "../test-helpers.js";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

suite("TaskQueue", () => {
  test("runs the tasks one after the other", async () => {
    const queue = new TaskQueue();
    const events: string[] = [];

    const task = (name: string) => async () => {
      events.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      events.push(`${name}:end`);
    };

    // both are triggered before the first one resolves
    const first = queue.run(task("first"));
    const second = queue.run(task("second"));
    await Promise.all([first, second]);

    deepStrictEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
  });

  test("a failing task does not block the queue", async () => {
    const queue = new TaskQueue();
    const events: string[] = [];

    const failing = queue.run(async () => {
      throw new Error("failed");
    });
    const next = queue.run(async () => {
      events.push("next");
    });

    await failing.then(
      () => {},
      () => {},
    );
    await next;

    deepStrictEqual(events, ["next"]);
  });
});

class FakeClient implements ManagedClient {
  public started = false;
  public stopped = false;
  public disposed = false;

  constructor(
    public readonly id: number,
    private readonly alive: Set<number>,
    private readonly failStart: boolean = false,
    // what the client matches, only the tests about the open documents need it
    private readonly matched: VSCodeDocumentSelector = [],
  ) {}

  async start(): Promise<void> {
    if (this.failStart) {
      throw new Error("the server did not start");
    }
    this.started = true;
    this.alive.add(this.id);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.alive.delete(this.id);
  }

  isRunning(): boolean {
    return this.started && !this.stopped;
  }

  /** The server died on its own, the client is not running anymore. */
  simulateCrash(): void {
    this.stopped = true;
    this.alive.delete(this.id);
  }

  public readonly protocol2CodeConverter = {
    asDocumentSelector: () => this.matched,
  };
}

const runningSelector: DocumentSelector = [{ scheme: "file", pattern: "**/*.js" }];

const createLifecycle = (
  states: ClientState[],
  failingStarts: number = 0,
  binaryError?: Error,
  isEnabledForResource: (uri: Uri) => boolean = () => true,
  matched: VSCodeDocumentSelector = [],
  createsClient: boolean = true,
) => {
  const alive = new Set<number>();
  const created: FakeClient[] = [];
  const errors: unknown[] = [];
  // one client at a time, the count of alive clients must never grow above one
  let maxAlive = 0;
  let stateChanges = 0;
  let resolvedBinaries = 0;

  const lifecycle = new ClientLifecycle<undefined, FakeClient>({
    toolName: "oxlint",
    selector: runningSelector,
    isEnabledForResource,
    computeState: async () => states[Math.min(created.length, states.length - 1)],
    resolveBinary: async () => {
      resolvedBinaries += 1;
      if (binaryError !== undefined) {
        throw binaryError;
      }
      return undefined;
    },
    createClient: async (): Promise<CreatedClient<FakeClient> | undefined> => {
      if (!createsClient) {
        return undefined;
      }
      const client = new FakeClient(created.length, alive, created.length < failingStarts, matched);
      created.push(client);
      return {
        client,
        dispose: async () => {
          client.disposed = true;
        },
      };
    },
    onStateChange: () => {
      stateChanges += 1;
      maxAlive = Math.max(maxAlive, alive.size);
    },
    onError: (error) => errors.push(error),
  });

  return {
    lifecycle,
    created,
    errors,
    aliveCount: () => alive.size,
    maxAlive: () => maxAlive,
    stateChanges: () => stateChanges,
    resolvedBinaries: () => resolvedBinaries,
  };
};

const running: ClientState = { shouldRun: true, windowEnabled: true, excludedFolders: [] };
const stopped: ClientState = {
  shouldRun: false,
  windowEnabled: false,
  excludedFolders: [],
  reason: "`oxc.enable.oxlint` or `oxc.enable` is false",
};

suite("ClientLifecycle", () => {
  const excluding: ClientState = {
    shouldRun: true,
    windowEnabled: true,
    excludedFolders: [WORKSPACE_FOLDER],
  };

  test("an overlapping apply never leaves two clients alive", async () => {
    const { lifecycle, created, aliveCount, maxAlive } = createLifecycle([running, excluding]);

    // both are triggered before the activation finished
    await Promise.all([lifecycle.activate(undefined), lifecycle.applyClientState()]);

    strictEqual(created.length, 2, "the excluded folders changed, the client is recreated once");
    strictEqual(created[0].stopped, true, "the first client is stopped");
    strictEqual(created[0].disposed, true, "the first client is disposed");
    strictEqual(aliveCount(), 1);
    strictEqual(maxAlive(), 1, "two clients were never alive at the same time");
  });

  test("the client is kept when the state did not change", async () => {
    const { lifecycle, created, stateChanges } = createLifecycle([running]);

    await lifecycle.activate(undefined);
    const afterActivate = stateChanges();
    await lifecycle.applyClientState();
    await lifecycle.applyClientState();

    strictEqual(created.length, 1);
    strictEqual(lifecycle.isRunning(), true);
    // the status bar is refreshed even when the client is kept
    strictEqual(stateChanges(), afterActivate + 2);
  });

  test("a state which does not run does not create a client", async () => {
    const { lifecycle, created, resolvedBinaries } = createLifecycle([stopped]);

    await lifecycle.activate(undefined);

    strictEqual(created.length, 0, "the client is not even created");
    strictEqual(resolvedBinaries(), 0, "the binary is not searched");
    strictEqual(lifecycle.isRunning(), false);
    strictEqual(lifecycle.statusReason, stopped.reason);
  });

  test("a failing binary search keeps the client retriable", async () => {
    // the binary is only searched when the client is recreated, `activate` gets it from the caller
    const { lifecycle, created, errors } = createLifecycle(
      [running, excluding],
      0,
      new Error("the binary search failed"),
    );

    await lifecycle.activate(undefined);
    strictEqual(created.length, 1);

    // the state changed, the recreation fails while searching the binary
    await lifecycle.applyClientState();

    strictEqual(created.length, 1, "no second client is created");
    strictEqual(errors.length, 1, "the error is reported");
    strictEqual(lifecycle.isRunning(), false, "the previous client is disposed");

    // the state key was reset, the next trigger tries again
    await lifecycle.applyClientState();

    strictEqual(errors.length, 2, "the next trigger tried again");
  });

  test("a failing start disposes the client and the next trigger retries", async () => {
    const { lifecycle, created, errors, aliveCount } = createLifecycle([running], 1);

    await lifecycle.activate(undefined);

    strictEqual(created.length, 1);
    strictEqual(created[0].disposed, true, "the dead client is disposed");
    strictEqual(lifecycle.isRunning(), false);
    strictEqual(errors.length, 1, "the error is reported");
    strictEqual(lifecycle.statusReason, "the oxlint language server failed to start");

    // the state key was reset, the same state is applied again
    await lifecycle.applyClientState();

    strictEqual(created.length, 2, "a new client is created");
    strictEqual(lifecycle.isRunning(), true);
    strictEqual(lifecycle.statusReason, undefined);
    strictEqual(aliveCount(), 1);
  });

  test("a client which stopped on its own is recreated by the next apply", async () => {
    const { lifecycle, created } = createLifecycle([running]);

    await lifecycle.activate(undefined);
    strictEqual(created.length, 1);

    // the server died, the state did not change
    created[0].simulateCrash();
    strictEqual(lifecycle.isRunning(), false);

    await lifecycle.applyClientState();

    strictEqual(created.length, 2, "the unchanged state does not keep a dead client");
    strictEqual(lifecycle.isRunning(), true);
  });

  test("deactivate stops and disposes the client", async () => {
    const { lifecycle, created } = createLifecycle([running]);

    await lifecycle.activate(undefined);
    await lifecycle.deactivate();

    strictEqual(created[0].stopped, true);
    strictEqual(created[0].disposed, true);
    strictEqual(lifecycle.client, undefined);
  });

  test("an event before the first activation does not create a client", async () => {
    const { lifecycle, created } = createLifecycle([running]);

    // a configuration file watcher or a workspace folder event can fire while the extension
    // is still searching the binary
    await lifecycle.applyClientState();
    await lifecycle.applyClientStateSafely();

    strictEqual(created.length, 0, "the client is created by the activation only");

    await lifecycle.activate(undefined);

    strictEqual(created.length, 1);
    strictEqual(lifecycle.isRunning(), true);
  });

  test("restart activates the lifecycle, a later event is applied", async () => {
    const { lifecycle, created } = createLifecycle([running]);

    // the restart command can run before the activation finished
    await lifecycle.restart();
    strictEqual(created.length, 1);

    await lifecycle.applyClientState();

    strictEqual(created.length, 1, "the state did not change");
    strictEqual(lifecycle.isRunning(), true);
  });

  test("the server only receives the changes of the documents it opened", async () => {
    if (WORKSPACE_SECOND_FOLDER === undefined) {
      return;
    }

    const { lifecycle } = createLifecycle([
      {
        shouldRun: true,
        windowEnabled: true,
        excludedFolders: [WORKSPACE_SECOND_FOLDER],
      },
    ]);
    await lifecycle.activate(undefined);

    const middleware = lifecycle.middleware;
    const excluded = { uri: Uri.joinPath(WORKSPACE_SECOND_FOLDER.uri, "index.js") } as never;
    const handled = { uri: Uri.joinPath(WORKSPACE_FOLDER.uri, "index.js") } as never;
    const forwarded: string[] = [];

    // the excluded document is never opened, its changes must not be forwarded either
    await middleware.didOpen!(excluded, async () => {
      forwarded.push("open:excluded");
    });
    await middleware.didChange!({ document: excluded } as never, async () => {
      forwarded.push("change:excluded");
    });
    await middleware.didClose!(excluded, async () => {
      forwarded.push("close:excluded");
    });

    await middleware.didOpen!(handled, async () => {
      forwarded.push("open:handled");
    });
    await middleware.didChange!({ document: handled } as never, async () => {
      forwarded.push("change:handled");
    });
    await middleware.didClose!(handled, async () => {
      forwarded.push("close:handled");
    });
    // the document is closed, a late change must not reopen it on the server
    await middleware.didChange!({ document: handled } as never, async () => {
      forwarded.push("change:closed");
    });

    deepStrictEqual(forwarded, ["open:handled", "change:handled", "close:handled"]);
  });

  test("a removed workspace folder with open documents recreates the client", async () => {
    const { lifecycle, created } = createLifecycle([running]);
    await lifecycle.activate(undefined);

    const middleware = lifecycle.middleware;
    await middleware.didOpen!(
      { uri: Uri.joinPath(WORKSPACE_FOLDER.uri, "index.js") } as never,
      async () => {},
    );

    // the state does not change, but the server still has the documents of the removed folder
    await lifecycle.applyClientState({ removedFolders: [WORKSPACE_FOLDER] });

    strictEqual(created.length, 2, "the client is recreated to drop the stale documents");

    // a removed workspace folder without open documents does not
    await lifecycle.applyClientState({ removedFolders: [WORKSPACE_FOLDER] });

    strictEqual(created.length, 2);
  });

  test("rule 4: start does not write when the settings already ask for a running server", async () => {
    // rule 4 of the `ClientLifecycle` semantics: the toggle writes the value which matches its
    // label, but a server which should run and does not is not a setting problem
    const { lifecycle } = createLifecycle([running], 0, undefined, () => true, [], false);

    // the client can not be created, the state still selects a running server
    await lifecycle.activate(undefined);
    strictEqual(lifecycle.isRunning(), false);
    strictEqual(lifecycle.statusReason, "no valid oxlint binary found");

    const written: boolean[] = [];
    await lifecycle.toggle({
      currentValue: () => undefined,
      update: async (value) => {
        written.push(value);
      },
    });

    deepStrictEqual(written, [], "clicking start writes nothing");
    strictEqual(lifecycle.statusReason, "no valid oxlint binary found", "the reason is reported");
  });

  test("rule 4: the toggle writes the value which matches its label", async () => {
    // rule 4 of the `ClientLifecycle` semantics
    const { lifecycle } = createLifecycle([running]);
    await lifecycle.activate(undefined);
    strictEqual(lifecycle.isRunning(), true);

    const written: boolean[] = [];
    // the label shows "Stop Server", `false` is written
    await lifecycle.toggle({
      currentValue: () => true,
      update: async (value) => {
        written.push(value);
      },
    });

    deepStrictEqual(written, [false]);
  });

  test("a document which is not visible does not recreate the client", async () => {
    // the language client only synchronizes the visible documents, a document opened by another
    // extension is not missing from the server
    const fileUri = Uri.joinPath(WORKSPACE_FOLDER.uri, "resync-hidden.js");
    await workspace.fs.writeFile(fileUri, Buffer.from("let x = 1;\n"));
    await workspace.openTextDocument(fileUri);

    try {
      const { lifecycle, created } = createLifecycle([running], 0, undefined, () => true, [
        { scheme: "file", pattern: "**/resync-hidden.js" },
      ]);
      await lifecycle.activate(undefined);

      await lifecycle.applyClientState();
      await lifecycle.applyClientState();

      strictEqual(created.length, 1, "a hidden document never forces a recreation");
    } finally {
      await workspace.fs.delete(fileUri, { useTrash: false });
    }
  });

  test("a visible document which becomes handled recreates the client", async () => {
    // an added workspace folder, or one which stops being excluded, turns the documents it
    // contains into handled ones: the server never received a `didOpen` for them
    const fileUri = Uri.joinPath(WORKSPACE_FOLDER.uri, "resync-target.js");
    await workspace.fs.writeFile(fileUri, Buffer.from("let x = 1;\n"));
    const document = await workspace.openTextDocument(fileUri);
    await window.showTextDocument(document);

    try {
      const { lifecycle, created } = createLifecycle([running], 0, undefined, () => true, [
        { scheme: "file", pattern: "**/resync-target.js" },
      ]);
      await lifecycle.activate(undefined);
      strictEqual(created.length, 1);

      // the state does not change, but the visible document was never sent to the server
      await lifecycle.applyClientState();

      strictEqual(created.length, 2, "the client is recreated to synchronize the document");

      // once the server knows it, the state is stable again
      await lifecycle.middleware.didOpen!(document as never, async () => {});
      await lifecycle.applyClientState();

      strictEqual(created.length, 2);
    } finally {
      await commands.executeCommand("workbench.action.closeActiveEditor");
      await workspace.fs.delete(fileUri, { useTrash: false });
    }
  });

  test("deactivate is terminal, a pending event does not create a new client", async () => {
    const { lifecycle, created } = createLifecycle([running]);

    await lifecycle.activate(undefined);
    await lifecycle.deactivate();

    // an event which arrives after the deactivation, for example from a file watcher
    await lifecycle.applyClientState();
    await lifecycle.applyClientStateSafely();

    strictEqual(created.length, 1, "no client is created after the deactivation");
    strictEqual(lifecycle.client, undefined);
    strictEqual(lifecycle.isRunning(), false);
  });

  test("the state key follows the excluded workspace folders", () => {
    const base: ClientState = { shouldRun: true, windowEnabled: true, excludedFolders: [] };

    strictEqual(clientStateKey(base), clientStateKey({ ...base, reason: "ignored" }));
    notStrictEqual(clientStateKey(base), clientStateKey({ ...base, shouldRun: false }));
    notStrictEqual(
      clientStateKey(base),
      clientStateKey({ ...base, excludedFolders: [WORKSPACE_FOLDER] }),
    );
    // the documents outside of every workspace folder follow the window value
    notStrictEqual(clientStateKey(base), clientStateKey({ ...base, windowEnabled: false }));
  });

  test("the status bar text follows the client state", () => {
    const stoppedText = buildStatusBarText({
      toolName: "oxlint",
      isRunning: false,
      reason: "no oxlint config found",
      showOutputCommand: "oxc.showOutputChannel",
      restartCommand: "oxc.restartServer",
      toggleCommand: "oxc.toggleEnable",
    });

    strictEqual(stoppedText.includes("Start Server"), true);
    strictEqual(stoppedText.includes("no oxlint config found"), true);

    const runningText = buildStatusBarText({
      toolName: "oxlint",
      isRunning: true,
      reason: "no oxlint config found",
      showOutputCommand: "oxc.showOutputChannel",
      restartCommand: "oxc.restartServer",
      toggleCommand: "oxc.toggleEnable",
    });

    strictEqual(runningText.includes("Stop Server"), true);
    // a stale reason is not shown while the server runs
    strictEqual(runningText.includes("no oxlint config found"), false);
  });
});

suite("client lifecycle semantics", () => {
  const excludedSecondFolder: ClientState[] = [
    {
      shouldRun: true,
      windowEnabled: true,
      excludedFolders: WORKSPACE_SECOND_FOLDER === undefined ? [] : [WORKSPACE_SECOND_FOLDER],
    },
  ];

  test("rule 1: the document selector never changes", async () => {
    // rule 1 of the `ClientLifecycle` semantics: the historical selector is used in every
    // configuration, the excluded workspace folders do not narrow it
    const selectors: DocumentSelector[] = [];
    const lifecycle = new ClientLifecycle<undefined, FakeClient>({
      toolName: "oxlint",
      selector: runningSelector,
      isEnabledForResource: () => true,
      computeState: async () => excludedSecondFolder[0],
      resolveBinary: async () => undefined,
      createClient: async (selector) => {
        selectors.push(selector);
        return { client: new FakeClient(0, new Set()), dispose: async () => {} };
      },
      onStateChange: () => {},
      onError: () => {},
    });

    await lifecycle.activate(undefined);
    await lifecycle.restart();

    // the same selector, regardless of the excluded workspace folders
    deepStrictEqual(selectors, [runningSelector, runningSelector]);
  });

  test("rule 2: documents of an excluded workspace folder are filtered by the middleware", async () => {
    // rule 2 of the `ClientLifecycle` semantics: one shared middleware, the innermost workspace
    // folder of a document decides, so a nested workspace folder is covered too
    if (WORKSPACE_SECOND_FOLDER === undefined) {
      return;
    }

    const { lifecycle } = createLifecycle(excludedSecondFolder);
    await lifecycle.activate(undefined);

    const excludedFile = Uri.joinPath(WORKSPACE_SECOND_FOLDER.uri, "index.js");
    const handledFile = Uri.joinPath(WORKSPACE_FOLDER.uri, "index.js");

    strictEqual(lifecycle.ignoresDocument(excludedFile), true);
    strictEqual(lifecycle.ignoresDocument(handledFile), false);

    const middleware = lifecycle.middleware;
    let forwarded = false;
    await middleware.didOpen!({ uri: excludedFile } as never, () => {
      forwarded = true;
      return Promise.resolve();
    });
    strictEqual(forwarded, false, "`didOpen` is not forwarded to the server");

    const report = await middleware.provideDiagnostics!(
      excludedFile,
      undefined,
      undefined as never,
      () => {
        throw new Error("the server must not be asked");
      },
    );
    deepStrictEqual(report, { kind: "full", items: [] });

    const codeActions = await middleware.provideCodeActions!(
      { uri: excludedFile } as never,
      undefined as never,
      undefined as never,
      undefined as never,
      () => {
        throw new Error("the server must not be asked");
      },
    );
    deepStrictEqual(codeActions, []);

    const edits = await middleware.provideDocumentFormattingEdits!(
      { uri: excludedFile } as never,
      undefined as never,
      undefined as never,
      () => {
        throw new Error("the server must not be asked");
      },
    );
    deepStrictEqual(edits, []);
  });

  test("rule 3: documents outside of every workspace folder follow the window value", async () => {
    // rule 3 of the `ClientLifecycle` semantics
    const outside = Uri.file("/tmp/outside-of-the-workspace/index.js");
    const untitled = Uri.parse("untitled:Untitled-1");

    const enabled = createLifecycle(excludedSecondFolder, 0, undefined, () => true);
    await enabled.lifecycle.activate(undefined);

    strictEqual(enabled.lifecycle.ignoresDocument(outside), false);
    strictEqual(enabled.lifecycle.ignoresDocument(untitled), false);

    // the window level value disables the tool, those documents are not handled either
    const disabled = createLifecycle(excludedSecondFolder, 0, undefined, () => false);
    await disabled.lifecycle.activate(undefined);

    strictEqual(disabled.lifecycle.ignoresDocument(outside), true);
    strictEqual(disabled.lifecycle.ignoresDocument(untitled), true);
  });

  test("rule 4: the toggle label follows the real client state", async () => {
    // rule 4 of the `ClientLifecycle` semantics
    const started = createLifecycle([running]);
    await started.lifecycle.activate(undefined);
    strictEqual(started.lifecycle.isRunning(), true, "the label shows a running server");

    const notStarted = createLifecycle([stopped]);
    await notStarted.lifecycle.activate(undefined);
    strictEqual(notStarted.lifecycle.isRunning(), false, "the label shows a stopped server");
    // the toggle reports the last known reason instead of reporting a successful start
    strictEqual(notStarted.lifecycle.statusReason, stopped.reason);
  });
});

suite("affectsClientState", () => {
  const conf = workspace.getConfiguration("oxc", null);

  /** Runs the update and returns the configuration change event it produced. */
  const changeOf = async (key: string, value: unknown): Promise<ConfigurationChangeEvent> => {
    const event = new Promise<ConfigurationChangeEvent>((resolve) => {
      const disposable = workspace.onDidChangeConfiguration((changed) => {
        if (changed.affectsConfiguration("oxc")) {
          disposable.dispose();
          resolve(changed);
        }
      });
    });

    await conf.update(key, value, ConfigurationTarget.Global);
    return event;
  };

  teardown(async () => {
    await Promise.all(
      ["enable", "enable.oxlint", "enable.oxfmt", "requireConfig"].map((key) =>
        conf.update(key, undefined, ConfigurationTarget.Global),
      ),
    );
  });

  test("a change of `oxc.enable` alone is reported for both tools", async () => {
    // `affectsConfiguration` matches the changed keys as a prefix of the section: the parent key
    // is not reported for the section of one of its children, it has to be listed
    const event = await changeOf("enable", false);

    strictEqual(event.affectsConfiguration("oxc.enable"), true);
    strictEqual(
      event.affectsConfiguration("oxc.enable.oxlint"),
      false,
      "a child section does not report the change of its parent",
    );

    strictEqual(affectsClientState(event, "oxc", linterStateSections), true);
    strictEqual(affectsClientState(event, "oxc", formatterStateSections), true);
  });

  test("a change of `oxc.enable.oxfmt` is reported for both tools", async () => {
    // the parent section reports the change of a child, oxlint then skips it with its state key
    const event = await changeOf("enable.oxfmt", false);

    strictEqual(affectsClientState(event, "oxc", formatterStateSections), true);
    strictEqual(affectsClientState(event, "oxc", linterStateSections), true);
  });

  test("a change of `oxc.requireConfig` is only reported for oxlint", async () => {
    const event = await changeOf("requireConfig", true);

    strictEqual(affectsClientState(event, "oxc", linterStateSections), true);
    strictEqual(affectsClientState(event, "oxc", formatterStateSections), false);
  });
});

suite("computeClientState", () => {
  const folder = (name: string, index: number) => ({
    uri: Uri.joinPath(WORKSPACE_FOLDER.uri, name),
    name,
    index,
  });
  const folderA = folder("state-a", 0);
  const folderB = folder("state-b", 1);
  const folderC = folder("state-c", 2);

  const configRequirement = {
    requiresConfig: (candidate: { name: string }) => candidate.name === "state-c",
    fileNames: [".oxlintrc-state-test.json"],
    pattern: "**/.oxlintrc-state-test.json",
  };

  test("a mixed window runs and excludes the folders it does not handle", async () => {
    const state = await computeClientState({
      folders: [folderA, folderB, folderC],
      windowEnabled: true,
      windowRequiresConfig: false,
      // `state-b` disables the tool, `state-c` requires a configuration file it does not have
      isEnabled: (candidate) => candidate.name !== "state-b",
      isOverriding: () => false,
      configRequirement,
      disabledReason: "disabled",
      missingConfigReason: "no config",
    });

    strictEqual(state.shouldRun, true, "one handled workspace folder is enough");
    deepStrictEqual(
      state.excludedFolders.map((excluded) => excluded.name),
      ["state-b", "state-c"],
    );
    strictEqual(state.reason, undefined);
  });

  test("without a workspace folder, `oxc.requireConfig` can not be fulfilled", async () => {
    const state = await computeClientState({
      folders: [],
      windowEnabled: true,
      windowRequiresConfig: true,
      isEnabled: () => true,
      isOverriding: () => false,
      configRequirement,
      disabledReason: "disabled",
      missingConfigReason: "no config",
    });

    strictEqual(state.shouldRun, false);
    strictEqual(state.reason, "no workspace folder is open");
    deepStrictEqual(state.excludedFolders, []);
  });

  test("every workspace folder disabled does not run", async () => {
    const state = await computeClientState({
      folders: [folderA, folderB],
      windowEnabled: false,
      isEnabled: () => false,
      isOverriding: () => false,
      disabledReason: "disabled",
      missingConfigReason: "no config",
    });

    strictEqual(state.shouldRun, false);
    strictEqual(state.reason, "disabled");
    deepStrictEqual(
      state.excludedFolders.map((excluded) => excluded.name),
      ["state-a", "state-b"],
    );
  });
});

suite("isInsideFolders", () => {
  const folder = {
    uri: Uri.joinPath(WORKSPACE_FOLDER.uri, "[slug]"),
    name: "[slug]",
    index: 0,
  };

  test("a child whose name starts with two dots is inside the folder, a parent path is not", () => {
    const sibling = Uri.joinPath(WORKSPACE_FOLDER.uri, "..archive", "index.js");

    // `..archive` is a child of the workspace folder, not a parent path segment
    strictEqual(isInsideFolders(sibling, [WORKSPACE_FOLDER]), true);
    strictEqual(
      isInsideFolders(Uri.joinPath(WORKSPACE_FOLDER.uri, "..", "other.js"), [WORKSPACE_FOLDER]),
      false,
    );
  });

  test("compares paths, a folder name can contain glob characters", () => {
    strictEqual(isInsideFolders(Uri.joinPath(folder.uri, "index.js"), [folder]), true);
    strictEqual(isInsideFolders(Uri.joinPath(WORKSPACE_FOLDER.uri, "index.js"), [folder]), false);
    // the folder itself is not inside of it
    strictEqual(isInsideFolders(folder.uri, [folder]), false);
    strictEqual(isInsideFolders(Uri.joinPath(folder.uri, "index.js"), []), false);
    // another scheme never matches
    strictEqual(isInsideFolders(Uri.parse("untitled:Untitled-1"), [folder]), false);
  });
});

suite("resolveEnabledFolders", () => {
  const configFilePattern = "**/.oxlintrc-selector-test.json";
  const configFileUri = Uri.joinPath(WORKSPACE_FOLDER.uri, ".oxlintrc-selector-test.json");

  const folders = [WORKSPACE_FOLDER, WORKSPACE_SECOND_FOLDER].filter(
    (folder) => folder !== undefined,
  );

  test("keeps only the workspace folders which enable the tool", async () => {
    const enabled = await resolveEnabledFolders({
      folders,
      isEnabled: (folder) => folder.uri.fsPath === WORKSPACE_FOLDER.uri.fsPath,
    });

    deepStrictEqual(
      enabled.handled.map((folder) => folder.uri.fsPath),
      [WORKSPACE_FOLDER.uri.fsPath],
    );
    deepStrictEqual(
      enabled.disabled.map((folder) => folder.uri.fsPath),
      folders.slice(1).map((folder) => folder.uri.fsPath),
    );
  });

  test("skips a workspace folder which requires a configuration file it does not have", async () => {
    const enabled = await resolveEnabledFolders({
      folders: [WORKSPACE_FOLDER],
      isEnabled: () => true,
      configRequirement: {
        requiresConfig: () => true,
        fileNames: [".oxlintrc-selector-test.json"],
        pattern: configFilePattern,
      },
    });

    strictEqual(enabled.handled.length, 0);
    // the workspace folder is not disabled, it only misses its configuration file
    strictEqual(enabled.disabled.length, 0);
    strictEqual(enabled.withoutConfig.length, 1);
  });

  test("keeps a workspace folder which requires a configuration file and has one", async () => {
    await workspace.fs.writeFile(configFileUri, Buffer.from("{}"));

    try {
      const enabled = await resolveEnabledFolders({
        folders: [WORKSPACE_FOLDER],
        isEnabled: () => true,
        // the configuration file is at the root of the folder, it is found without a search
        configRequirement: {
          requiresConfig: () => true,
          fileNames: [".oxlintrc-selector-test.json"],
          pattern: "**/never-searched.json",
        },
      });

      deepStrictEqual(
        enabled.handled.map((folder) => folder.uri.fsPath),
        [WORKSPACE_FOLDER.uri.fsPath],
      );
    } finally {
      await workspace.fs.delete(configFileUri, { useTrash: false });
    }
  });

  test("does not count the configuration file of a nested workspace folder", async () => {
    // the folder name contains glob metacharacters on purpose (a Next.js route directory): the
    // nested folders are filtered out by comparing paths, not with an exclude pattern
    const nestedFolder = {
      uri: Uri.joinPath(WORKSPACE_FOLDER.uri, "[slug]"),
      name: "[slug]",
      index: WORKSPACE_FOLDER.index + 1,
    };
    const nestedConfigUri = Uri.joinPath(nestedFolder.uri, ".oxlintrc-selector-test.json");
    await workspace.fs.writeFile(nestedConfigUri, Buffer.from("{}"));

    try {
      const enabled = await resolveEnabledFolders({
        folders: [WORKSPACE_FOLDER, nestedFolder],
        isEnabled: () => true,
        configRequirement: { requiresConfig: () => true, pattern: configFilePattern },
      });

      // only the nested workspace folder owns the configuration file
      deepStrictEqual(
        enabled.handled.map((folder) => folder.uri.fsPath),
        [nestedFolder.uri.fsPath],
      );
    } finally {
      await workspace.fs.delete(nestedFolder.uri, { recursive: true, useTrash: false });
    }
  });

  test("ignores the configuration file of a workspace folder which does not require one", async () => {
    const enabled = await resolveEnabledFolders({
      folders: [WORKSPACE_FOLDER],
      isEnabled: () => true,
      configRequirement: { requiresConfig: () => false, pattern: configFilePattern },
    });

    deepStrictEqual(
      enabled.handled.map((folder) => folder.uri.fsPath),
      [WORKSPACE_FOLDER.uri.fsPath],
    );
  });
});

suite("runExecutable", () => {
  const originalPlatform = process.platform;
  const originalEnv = process.env;

  teardown(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    process.env = originalEnv;
  });

  test("should create Node.js executable for .js files", async () => {
    const result = await runExecutable({
      path: "/path/to/server.js",
      loader: "node",
    });

    strictEqual(result.command, "node");
    strictEqual(result.args?.[0], "/path/to/server.js");
    strictEqual(result.args?.[1], "--lsp");
  });

  test("should create Node.js executable for .cjs files", async () => {
    const result = await runExecutable({
      path: "/path/to/server.cjs",
      loader: "node",
    });

    strictEqual(result.command, "node");
    strictEqual(result.args?.[0], "/path/to/server.cjs");
    strictEqual(result.args?.[1], "--lsp");
  });

  test("should create Node.js executable for .mjs files", async () => {
    const result = await runExecutable({
      path: "/path/to/server.mjs",
      loader: "node",
    });

    strictEqual(result.command, "node");
    strictEqual(result.args?.[0], "/path/to/server.mjs");
    strictEqual(result.args?.[1], "--lsp");
  });

  test("should create binary executable for non-Node files", async () => {
    const result = await runExecutable({
      path: "/path/to/oxc-language-server",
      loader: "native",
    });

    let expectedCommand = "/path/to/oxc-language-server";
    if (process.platform === "win32") {
      expectedCommand = `"${expectedCommand}"`;
    }

    strictEqual(result.command, expectedCommand);
    strictEqual(result.args?.[0], "--lsp");
    strictEqual(result.options?.shell, process.platform === "win32");
  });

  test("should use shell on Windows for binary executables", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });

    const result = await runExecutable({
      path: "C:\\Path With Spaces\\oxc-language-server",
      loader: "native",
    });

    strictEqual(result.options?.shell, true);
  });

  test("should prepend nodePath to PATH", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    process.env.PATH = "/usr/bin:/bin";

    const result = await runExecutable(
      {
        path: "/path/to/server.js",
        loader: "node",
      },
      false,
      "/custom/node/bin/node",
    );

    strictEqual(result.command, "/custom/node/bin/node");
    strictEqual(result.options?.env?.PATH?.includes(`/custom/node/bin${path.delimiter}`), true);
  });

  test("should set path in quotes on Windows for binary executables", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });

    const result = await runExecutable({
      path: "C:\\Path With Spaces\\oxc-language-server",
      loader: "native",
    });

    strictEqual(result.command, '"C:\\Path With Spaces\\oxc-language-server"');
  });

  test("should use the provided node path for Node.js executables", async () => {
    const result = await runExecutable(
      {
        path: "/path/to/server.js",
        loader: "node",
      },
      false,
      "/custom/node/bin/node",
    );

    strictEqual(result.command, "/custom/node/bin/node");
    strictEqual(result.args?.[0], "/path/to/server.js");
    strictEqual(result.args?.[1], "--lsp");
  });

  test("should use 'execPath' with ELECTRON_RUN_AS_NODE", async () => {
    const result = await runExecutable(
      {
        path: "/path/to/server.js",
        loader: "node",
      },
      true,
    );

    strictEqual(result.command, process.execPath);
    strictEqual(result.options?.env?.ELECTRON_RUN_AS_NODE, "1");
  });

  test("should not set ELECTRON_RUN_AS_NODE server env", async () => {
    const result = await runExecutable(
      {
        path: "/path/to/server.js",
        loader: "node",
      },
      false,
    );
    strictEqual(result.options?.env?.ELECTRON_RUN_AS_NODE, undefined);
  });

  test("should pass the Vite+ command before --lsp", async () => {
    const result = await runExecutable({
      path: "/path/to/node_modules/vite-plus/bin/vp",
      loader: "node",
      args: ["fmt"],
    });

    strictEqual(result.command, "node");
    strictEqual(result.args?.[0], "/path/to/node_modules/vite-plus/bin/vp");
    strictEqual(result.args?.[1], "fmt");
    strictEqual(result.args?.[2], "--lsp");
  });

  test("should set yarn PnP loader path when provided", async () => {
    const result = await runExecutable({
      path: "/path/to/server.js",
      loader: "node",
      yarnPnpLoaderPath: "/path/to/.pnp.cjs",
    });
    strictEqual(result.args?.includes("--require"), true);
    strictEqual(result.args?.includes("/path/to/.pnp.cjs"), true, JSON.stringify(result.args));
    strictEqual(result.args?.includes("--loader"), true);
    const expectedEsmLoaderPath = pathToFileURL(
      `${path.sep}path${path.sep}to${path.sep}.pnp.loader.mjs`,
    ).href;
    strictEqual(result.args?.includes(expectedEsmLoaderPath), true, JSON.stringify(result.args));
  });
});
