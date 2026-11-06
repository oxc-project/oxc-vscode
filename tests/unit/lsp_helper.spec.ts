import { deepStrictEqual, doesNotMatch, match, notStrictEqual, strictEqual } from "assert";
import { ConfigurationTarget, Uri, window, workspace } from "vscode";
import type {
  ConfigurationChangeEvent,
  DocumentSelector as VSCodeDocumentSelector,
  WorkspaceFolder,
} from "vscode";
import type { DocumentSelector } from "vscode-languageclient";
import { affectsClientState } from "../../client/ConfigService";
import {
  ClientLifecycle,
  computeClientState,
  ConfigFileCache,
  ClientState,
  clientStateKey,
  CreatedClient,
  isInsideFolders,
  ManagedClient,
  resolveEnabledFolders,
  runExecutable,
  TaskQueue,
} from "../../client/tools/lsp_helper";
import {
  resetOxcSettings,
  sleep,
  withTempFile,
  WORKSPACE_FOLDER,
  WORKSPACE_SECOND_FOLDER,
} from "../test-helpers.js";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

suite("TaskQueue", () => {
  test("runs the tasks one after the other", async () => {
    const queue = new TaskQueue();
    const events: string[] = [];

    const task = (name: string) => async () => {
      events.push(`${name}:start`);
      await sleep(10);
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
  private readonly listeners = new Set<() => void>();

  constructor(
    public readonly id: number,
    private readonly alive: Set<number>,
    private readonly options: {
      failStart?: boolean;
      // what the client matches, only the tests about the open documents need it
      matched?: VSCodeDocumentSelector;
    } = {},
  ) {}

  async start(): Promise<void> {
    if (this.options.failStart) {
      throw new Error("the server did not start");
    }
    this.started = true;
    this.alive.add(this.id);
  }

  /** Disposing the client also stops it. */
  dispose(): void {
    this.stopped = true;
    this.disposed = true;
    this.alive.delete(this.id);
  }

  isRunning(): boolean {
    return this.started && !this.stopped;
  }

  /** The server died on its own, the client is not running anymore. */
  simulateCrash(): void {
    this.stopped = true;
    this.alive.delete(this.id);
    for (const listener of this.listeners) {
      listener();
    }
  }

  onDidChangeState(listener: () => void) {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  public readonly protocol2CodeConverter = {
    asDocumentSelector: () => this.options.matched ?? [],
  };
}

const runningSelector: DocumentSelector = [{ scheme: "file", pattern: "**/*.js" }];

const createLifecycle = (
  states: ClientState[],
  options: {
    failingStarts?: number;
    binaryError?: Error;
    // the binary search waits for it
    binaryGate?: Promise<void>;
    // the state computed next, by default the one at the index of the number of created clients
    stateIndex?: { current: number };
    // makes the next computation of the state fail
    computeFailure?: { error?: Error };
    hasOverridingFolders?: () => boolean;
    isWindowEnabled?: () => boolean;
    matched?: VSCodeDocumentSelector;
    createsClient?: boolean;
  } = {},
) => {
  const { failingStarts = 0, binaryError, createsClient = true } = options;
  const alive = new Set<number>();
  const created: FakeClient[] = [];
  const errors: unknown[] = [];
  // one client at a time, the count of alive clients must never grow above one
  let maxAlive = 0;
  let stateChanges = 0;
  let computedStates = 0;
  let resolvedBinaries = 0;

  const lifecycle = new ClientLifecycle<string | undefined, FakeClient>({
    toolName: "oxlint",
    selector: runningSelector,
    outputChannel: { error: (message) => errors.push(message) },
    statusCommands: {
      showOutput: "oxc.showOutputChannel",
      restart: "oxc.restartServer",
      toggle: "oxc.toggleEnable",
    },
    isWindowEnabled: options.isWindowEnabled ?? (() => true),
    hasOverridingFolders: options.hasOverridingFolders ?? (() => false),
    computeState: async () => {
      computedStates += 1;
      if (options.computeFailure?.error !== undefined) {
        throw options.computeFailure.error;
      }
      const index = options.stateIndex?.current ?? created.length;
      return states[Math.min(index, states.length - 1)];
    },
    resolveBinary: async () => {
      resolvedBinaries += 1;
      await options.binaryGate;
      if (binaryError !== undefined) {
        throw binaryError;
      }
      return "resolved";
    },
    createClient: async (): Promise<CreatedClient<FakeClient> | undefined> => {
      if (!createsClient) {
        return undefined;
      }
      const client = new FakeClient(created.length, alive, {
        failStart: created.length < failingStarts,
        matched: options.matched,
      });
      created.push(client);
      return {
        client,
        dispose: async () => client.dispose(),
      };
    },
    onStateChange: () => {
      stateChanges += 1;
      maxAlive = Math.max(maxAlive, alive.size);
    },
  });

  return {
    lifecycle,
    created,
    errors,
    aliveCount: () => alive.size,
    maxAlive: () => maxAlive,
    stateChanges: () => stateChanges,
    computedStates: () => computedStates,
    resolvedBinaries: () => resolvedBinaries,
  };
};

const excludedUris = (...folders: WorkspaceFolder[]) =>
  new Set(folders.map((folder) => folder.uri.toString()));

const running: ClientState = {
  shouldRun: true,
  windowEnabled: true,
  windowRequiresConfig: false,
  excludedFolders: new Set(),
};
const stopped: ClientState = {
  shouldRun: false,
  windowEnabled: false,
  windowRequiresConfig: false,
  excludedFolders: new Set(),
  reason: "`oxc.enable.oxlint` or `oxc.enable` is false",
};
const excluding: ClientState = { ...running, excludedFolders: excludedUris(WORKSPACE_FOLDER) };
const excludingSecondFolder: ClientState = {
  ...running,
  excludedFolders: excludedUris(
    ...(WORKSPACE_SECOND_FOLDER === undefined ? [] : [WORKSPACE_SECOND_FOLDER]),
  ),
};

suite("ClientLifecycle", () => {
  test("an overlapping apply never leaves two clients alive", async () => {
    const { lifecycle, created, aliveCount, maxAlive } = createLifecycle([running, excluding]);

    // both are triggered before the activation finished
    await Promise.all([lifecycle.activate(undefined), lifecycle.applyClientStateSafely()]);

    strictEqual(created.length, 2, "the excluded folders changed, the client is recreated once");
    strictEqual(created[0].stopped, true, "the first client is stopped");
    strictEqual(created[0].disposed, true, "the first client is disposed");
    strictEqual(aliveCount(), 1);
    strictEqual(maxAlive(), 1, "two clients were never alive at the same time");
  });

  test("the failure of an apply shared by several triggers is reported once", async () => {
    const computeFailure: { error?: Error } = {};
    const { lifecycle, errors } = createLifecycle([running], { computeFailure });
    await lifecycle.activate(undefined);

    computeFailure.error = new Error("the share is gone");
    await Promise.all([
      lifecycle.applyClientStateSafely(),
      lifecycle.applyClientStateSafely(),
      lifecycle.applyClientStateSafely(),
    ]);

    strictEqual(errors.length, 1);
    match(String(errors[0]), /the share is gone/);
  });

  test("a toggle before the first activation writes the setting and creates no client", async () => {
    const { lifecycle, created } = createLifecycle([running], { isWindowEnabled: () => false });

    const written: boolean[] = [];
    await lifecycle.toggle(true, {
      update: async (value) => {
        written.push(value);
      },
    });

    deepStrictEqual(written, [true], "the activation picks the setting up");
    strictEqual(created.length, 0);
  });

  test("a toggle before the first activation writes nothing when the setting is enabled", async () => {
    const { lifecycle } = createLifecycle([running], { isWindowEnabled: () => true });

    const written: boolean[] = [];
    await lifecycle.toggle(true, {
      update: async (value) => {
        written.push(value);
      },
    });

    deepStrictEqual(written, []);
  });

  test("the triggers which arrive while an apply is queued share it", async () => {
    const { lifecycle, created, computedStates } = createLifecycle([running]);
    await lifecycle.activate(undefined);
    const afterActivate = computedStates();

    await Promise.all([
      lifecycle.applyClientStateSafely(),
      lifecycle.applyClientStateSafely(),
      lifecycle.applyClientStateSafely(),
    ]);

    strictEqual(computedStates(), afterActivate + 1, "the state is computed once");
    strictEqual(created.length, 1);

    // an apply which already ran does not absorb the next trigger
    await lifecycle.applyClientStateSafely();

    strictEqual(computedStates(), afterActivate + 2);
  });

  test("a trigger which joins a queued apply keeps its removed workspace folders", async () => {
    const { lifecycle, created } = createLifecycle([running]);
    await lifecycle.activate(undefined);
    await lifecycle.middleware.didOpen!(
      { uri: Uri.joinPath(WORKSPACE_FOLDER.uri, "index.js") } as never,
      async () => {},
    );

    await Promise.all([
      lifecycle.applyClientStateSafely(),
      lifecycle.applyClientStateSafely([WORKSPACE_FOLDER]),
    ]);

    strictEqual(created.length, 2, "the server still has the documents of the removed folder");
  });

  test("the client is kept when the state did not change", async () => {
    const { lifecycle, created, stateChanges } = createLifecycle([running]);

    await lifecycle.activate(undefined);
    const afterActivate = stateChanges();
    await lifecycle.applyClientStateSafely();
    await lifecycle.applyClientStateSafely();

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
    match(lifecycle.statusText(), new RegExp(`^${stopped.reason!.replace(/[`.]/g, "\\$&")}\\n\\n`));
  });

  test("a failing binary search keeps the client retriable", async () => {
    // the binary is only searched when the client is recreated, `activate` gets it from the caller
    const { lifecycle, created, errors } = createLifecycle([running, excluding], {
      binaryError: new Error("the binary search failed"),
    });

    await lifecycle.activate(undefined);
    strictEqual(created.length, 1);

    // the state changed, the recreation fails while searching the binary
    await lifecycle.applyClientStateSafely();

    strictEqual(created.length, 1, "no second client is created");
    strictEqual(errors.length, 1, "the error is reported");
    match(
      String(errors[0]),
      /Failed to update the oxlint language server: the binary search failed/,
    );
    strictEqual(lifecycle.isRunning(), true, "the previous client keeps running");
    strictEqual(created[0].disposed, false);

    // the next trigger tries again
    await lifecycle.applyClientStateSafely();

    strictEqual(errors.length, 2, "the next trigger tried again");
  });

  test("a failing start makes the next trigger search the binary again", async () => {
    const { lifecycle, created, resolvedBinaries } = createLifecycle([running], {
      failingStarts: 1,
    });

    await lifecycle.activate("binary");
    strictEqual(lifecycle.isRunning(), false);

    await lifecycle.applyClientStateSafely();

    strictEqual(resolvedBinaries(), 1, "the binary of the failed start is not trusted");
    strictEqual(created.length, 2);
    strictEqual(lifecycle.isRunning(), true);
  });

  test("a change of the workspace folders makes the next recreation search the binary again", async () => {
    const { lifecycle, created, resolvedBinaries } = createLifecycle([running, excluding]);

    await lifecycle.activate("binary");
    await lifecycle.onWorkspaceFoldersChange([]);

    strictEqual(created.length, 2, "the state changed, the client is recreated");
    strictEqual(resolvedBinaries(), 1, "the binary search walks the workspace folders");
  });

  test("the binary is searched again by a restart only", async () => {
    // the binary only changes through the connection settings, which restart the tool
    const { lifecycle, created, resolvedBinaries } = createLifecycle([running, excluding]);

    await lifecycle.activate("binary");
    await lifecycle.applyClientStateSafely();

    strictEqual(created.length, 2, "the state changed, the client is recreated");
    strictEqual(resolvedBinaries(), 0, "the binary of the activation is reused");

    await lifecycle.restart();

    strictEqual(resolvedBinaries(), 1);
  });

  test("a failing start disposes the client and the next trigger retries", async () => {
    const { lifecycle, created, errors, aliveCount } = createLifecycle([running], {
      failingStarts: 1,
    });

    await lifecycle.activate(undefined);

    strictEqual(created.length, 1);
    strictEqual(created[0].disposed, true, "the dead client is disposed");
    strictEqual(lifecycle.isRunning(), false);
    strictEqual(errors.length, 1, "the error is reported");
    match(lifecycle.statusText(), /^the oxlint language server failed to start\n\n/);

    // the same state is applied again
    await lifecycle.applyClientStateSafely();

    strictEqual(created.length, 2, "a new client is created");
    strictEqual(lifecycle.isRunning(), true);
    doesNotMatch(lifecycle.statusText(), /Start Server/);
    strictEqual(aliveCount(), 1);
  });

  test("a client which stopped on its own is recreated by the next apply", async () => {
    const { lifecycle, created } = createLifecycle([running]);

    await lifecycle.activate(undefined);
    strictEqual(created.length, 1);

    // the server died, the state did not change
    created[0].simulateCrash();
    strictEqual(lifecycle.isRunning(), false);
    match(lifecycle.statusText(), /^the oxlint language server stopped\n\n/);

    await lifecycle.applyClientStateSafely();

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
    await lifecycle.applyClientStateSafely();

    strictEqual(created.length, 0, "the client is created by the activation only");

    await lifecycle.activate(undefined);

    strictEqual(created.length, 1);
    strictEqual(lifecycle.isRunning(), true);
  });

  test("restart after the deactivation does not create a client", async () => {
    const { lifecycle, created } = createLifecycle([running]);

    await lifecycle.activate(undefined);
    await lifecycle.deactivate();

    // a settings sync or a trust grant can fire while the extension deactivates
    await lifecycle.restart();

    strictEqual(created.length, 1, "no client is created after the deactivation");
    strictEqual(lifecycle.isRunning(), false);
  });

  test("the running client serves while the binary of the next one is searched", async () => {
    let release = () => {};
    const binaryGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { lifecycle, created } = createLifecycle([running], { binaryGate });
    await lifecycle.activate(undefined);

    const restarting = lifecycle.restart();
    await sleep(10);

    strictEqual(lifecycle.isRunning(), true, "the client is kept while searching the binary");
    strictEqual(created.length, 1);

    release();
    await restarting;

    strictEqual(created.length, 2);
    strictEqual(created[0].disposed, true, "the previous client is disposed");
    strictEqual(lifecycle.isRunning(), true);
  });

  test("restart activates the lifecycle, a later event is applied", async () => {
    const { lifecycle, created } = createLifecycle([running]);

    // the restart command can run before the activation finished
    await lifecycle.restart();
    strictEqual(created.length, 1);

    await lifecycle.applyClientStateSafely();

    strictEqual(created.length, 1, "the state did not change");
    strictEqual(lifecycle.isRunning(), true);
  });

  test("a removed workspace folder with open documents recreates the client", async () => {
    const { lifecycle, created } = createLifecycle([running]);
    await lifecycle.activate(undefined);

    await lifecycle.middleware.didOpen!(
      { uri: Uri.joinPath(WORKSPACE_FOLDER.uri, "index.js") } as never,
      async () => {},
    );

    // the state does not change, but the server still has the documents of the removed folder
    await lifecycle.applyClientStateSafely([WORKSPACE_FOLDER]);

    strictEqual(created.length, 2, "the client is recreated to drop the stale documents");

    // a removed workspace folder without open documents does not
    await lifecycle.applyClientStateSafely([WORKSPACE_FOLDER]);

    strictEqual(created.length, 2);
  });

  test("a document of another scheme in a removed workspace folder recreates the client", async () => {
    const { lifecycle, created } = createLifecycle([running]);
    await lifecycle.activate(undefined);

    const gitDocument = Uri.joinPath(WORKSPACE_FOLDER.uri, "index.js").with({
      scheme: "git",
      query: "{}",
    });
    await lifecycle.middleware.didOpen!({ uri: gitDocument } as never, async () => {});

    await lifecycle.applyClientStateSafely([WORKSPACE_FOLDER]);

    strictEqual(created.length, 2);
  });

  test("start does not write when the settings already ask for a running server", async () => {
    // the toggle writes the value which matches its label, but a server which should run and
    // does not is not a setting problem
    const { lifecycle } = createLifecycle([running], { createsClient: false });

    // the client can not be created, the state still selects a running server
    await lifecycle.activate(undefined);
    strictEqual(lifecycle.isRunning(), false);
    match(lifecycle.statusText(), /^no valid oxlint binary found\n\n/);

    const written: boolean[] = [];
    await lifecycle.toggle(true, {
      update: async (value) => {
        written.push(value);
      },
    });

    deepStrictEqual(written, [], "clicking start writes nothing");
    match(lifecycle.statusText(), /^no valid oxlint binary found\n\n/, "the reason is reported");
  });

  test("start recreates a client which stopped while the settings select a running server", async () => {
    const { lifecycle, created } = createLifecycle([running]);
    await lifecycle.activate(undefined);

    // the server died and the client gave up
    created[0].simulateCrash();
    strictEqual(lifecycle.isRunning(), false);

    const written: boolean[] = [];
    await lifecycle.toggle(true, {
      update: async (value) => {
        written.push(value);
      },
    });

    deepStrictEqual(written, [], "the settings are not the problem");
    strictEqual(created.length, 2, "a new client is created");
    strictEqual(lifecycle.isRunning(), true);
  });

  test("start does not write when the window value is enabled already", async () => {
    // a missing configuration file, or workspace folders which disable the tool, keep the server
    // stopped: `oxc.enable.<tool>: true` would change nothing
    const { lifecycle } = createLifecycle([
      { ...stopped, windowEnabled: true, reason: "no oxlint config found" },
    ]);
    await lifecycle.activate(undefined);

    const written: boolean[] = [];
    await lifecycle.toggle(true, {
      update: async (value) => {
        written.push(value);
      },
    });

    deepStrictEqual(written, []);
    match(lifecycle.statusText(), /^no oxlint config found\n\n/);
  });

  test("the status follows a client which stops on its own", async () => {
    const { lifecycle, created, stateChanges } = createLifecycle([running]);
    await lifecycle.activate(undefined);
    const afterActivate = stateChanges();

    created[0].simulateCrash();

    strictEqual(stateChanges(), afterActivate + 1, "the status bar is refreshed");
    match(lifecycle.statusText(), /^the oxlint language server stopped\n\n/);
  });

  test("a toggle which does not start a server selected by the settings shows the reason", async () => {
    // a workspace folder overrides the window value, but it is not what prevents the server
    const stateIndex = { current: 0 };
    const { lifecycle } = createLifecycle([stopped, running], {
      failingStarts: 1,
      stateIndex,
      hasOverridingFolders: () => true,
    });
    await lifecycle.activate(undefined);

    const messages: unknown[] = [];
    const original = window.showInformationMessage;
    (window as any).showInformationMessage = async (message: unknown) => {
      messages.push(message);
    };
    try {
      await lifecycle.toggle(true, {
        update: async () => {
          stateIndex.current = 1;
        },
      });
    } finally {
      (window as any).showInformationMessage = original;
    }

    deepStrictEqual(messages, ["the oxlint language server failed to start"]);
  });

  test("a failing write is reported to the user", async () => {
    const { lifecycle, errors, stateChanges } = createLifecycle([stopped]);
    await lifecycle.activate(undefined);
    const afterActivate = stateChanges();

    const messages: unknown[] = [];
    const original = window.showErrorMessage;
    (window as any).showErrorMessage = async (message: unknown) => {
      messages.push(message);
    };
    try {
      await lifecycle.toggle(true, {
        update: async () => {
          throw new Error("the settings file is read only");
        },
      });
    } finally {
      (window as any).showErrorMessage = original;
    }

    strictEqual(errors.length, 1);
    strictEqual(messages.length, 1);
    match(String(messages[0]), /the settings file is read only/);
    strictEqual(stateChanges(), afterActivate + 1);
  });

  test("a failing computation after the write is reported and refreshes the status", async () => {
    const computeFailure: { error?: Error } = {};
    const { lifecycle, errors, stateChanges } = createLifecycle([stopped], { computeFailure });
    await lifecycle.activate(undefined);
    const afterActivate = stateChanges();

    await lifecycle.toggle(true, {
      update: async () => {
        computeFailure.error = new Error("the share is gone");
      },
    });

    strictEqual(errors.length, 1);
    match(String(errors[0]), /the share is gone/);
    strictEqual(stateChanges(), afterActivate + 1);
  });

  test("a toggle queued behind a step which started the server does not stop it", async () => {
    const { lifecycle, created } = createLifecycle([running], { failingStarts: 1 });
    await lifecycle.activate(undefined);
    strictEqual(lifecycle.isRunning(), false, "the label offers to start");

    // the click happens while a restart is queued, the label is what the user saw
    const written: boolean[] = [];
    const restarting = lifecycle.restart();
    const toggling = lifecycle.toggle(true, {
      update: async (value) => {
        written.push(value);
      },
    });
    await Promise.all([restarting, toggling]);

    deepStrictEqual(written, []);
    strictEqual(created.length, 2);
    strictEqual(lifecycle.isRunning(), true);
  });

  test("a failing binary search before the client is dropped only reports the error", async () => {
    const { lifecycle, errors } = createLifecycle([running], {
      failingStarts: 1,
      binaryError: new Error("the binary search failed"),
    });
    await lifecycle.activate("binary");
    match(lifecycle.statusText(), /^the oxlint language server failed to start\n\n/);
    const afterActivate = errors.length;

    await lifecycle.applyClientStateSafely();

    strictEqual(errors.length, afterActivate + 1);
    match(lifecycle.statusText(), /^the oxlint language server failed to start\n\n/);
  });

  test("the toggle writes the value which matches its label", async () => {
    const { lifecycle } = createLifecycle([running]);
    await lifecycle.activate(undefined);
    strictEqual(lifecycle.isRunning(), true);

    const written: boolean[] = [];
    // the label shows "Stop Server", `false` is written
    await lifecycle.toggle(false, {
      update: async (value) => {
        written.push(value);
      },
    });

    deepStrictEqual(written, [false]);
  });

  test("a document which becomes handled recreates the client", async () => {
    // an added workspace folder, or one which stops being excluded, turns the documents it
    // contains into handled ones: the server never received a `didOpen` for them
    const fileUri = Uri.joinPath(WORKSPACE_FOLDER.uri, "resync-target.js");

    await withTempFile(fileUri, "let x = 1;\n", async () => {
      const document = await workspace.openTextDocument(fileUri);

      const { lifecycle, created } = createLifecycle([running], {
        matched: [{ scheme: "file", pattern: "**/resync-target.js" }],
      });
      await lifecycle.activate(undefined);
      strictEqual(created.length, 1);

      // the state does not change, but the document was never sent to the server
      await lifecycle.applyClientStateSafely();

      strictEqual(created.length, 2, "the client is recreated to synchronize the document");

      // once the server knows it, the state is stable again
      await lifecycle.middleware.didOpen!(document as never, async () => {});
      await lifecycle.applyClientStateSafely();

      strictEqual(created.length, 2);
    });
  });

  test("deactivate is terminal, a pending event does not create a new client", async () => {
    const { lifecycle, created } = createLifecycle([running]);

    await lifecycle.activate(undefined);
    await lifecycle.deactivate();

    // an event which arrives after the deactivation, for example from a file watcher
    await lifecycle.applyClientStateSafely();

    strictEqual(created.length, 1, "no client is created after the deactivation");
    strictEqual(lifecycle.client, undefined);
    strictEqual(lifecycle.isRunning(), false);
  });

  test("the state key follows the excluded workspace folders", () => {
    strictEqual(clientStateKey(running), clientStateKey({ ...running, reason: "ignored" }));
    notStrictEqual(clientStateKey(running), clientStateKey({ ...running, shouldRun: false }));
    notStrictEqual(clientStateKey(running), clientStateKey(excluding));
    // the documents outside of every workspace folder follow the window value
    notStrictEqual(clientStateKey(running), clientStateKey({ ...running, windowEnabled: false }));
    notStrictEqual(
      clientStateKey(running),
      clientStateKey({ ...running, windowRequiresConfig: true }),
    );
  });

  test("the status text follows the client state", async () => {
    const notRunning = createLifecycle([{ ...stopped, reason: "no oxlint config found" }], {
      hasOverridingFolders: () => true,
    });
    await notRunning.lifecycle.activate(undefined);

    const stoppedText = notRunning.lifecycle.statusText();
    match(stoppedText, /^no oxlint config found\n\n/);
    match(stoppedText, /\[\$\(play\) Start Server\]\(command:oxc\.toggleEnable\)/);
    match(stoppedText, /\(command:oxc\.showOutputChannel\)/);
    match(stoppedText, /\(command:oxc\.restartServer\)/);
    match(stoppedText, /`oxc\.enable\.oxlint` of a workspace folder wins over this toggle/);

    const started = createLifecycle([running]);
    await started.lifecycle.activate(undefined);

    const runningText = started.lifecycle.statusText();
    match(runningText, /\[\$\(stop\) Stop Server\]\(command:oxc\.toggleEnable\)/);
    doesNotMatch(runningText, /Start Server|no oxlint config found/);
    // no workspace folder overrides the toggle, nothing wins over it
    doesNotMatch(runningText, /wins over this toggle/);
  });
});

suite("ClientLifecycle middleware", () => {
  const never = () => {
    throw new Error("the server must not be asked");
  };

  test("the server only receives the changes of the documents it opened", async () => {
    if (WORKSPACE_SECOND_FOLDER === undefined) {
      return;
    }

    const { lifecycle } = createLifecycle([excludingSecondFolder]);
    await lifecycle.activate(undefined);

    const middleware = lifecycle.middleware;
    const excluded = { uri: Uri.joinPath(WORKSPACE_SECOND_FOLDER.uri, "index.js") } as never;
    const handled = { uri: Uri.joinPath(WORKSPACE_FOLDER.uri, "index.js") } as never;
    const forwarded: string[] = [];
    const fwd = (label: string) => async () => {
      forwarded.push(label);
    };

    // the excluded document is never opened, its changes must not be forwarded either
    await middleware.didOpen!(excluded, fwd("open:excluded"));
    await middleware.didChange!({ document: excluded } as never, fwd("change:excluded"));
    await middleware.didClose!(excluded, fwd("close:excluded"));

    await middleware.didOpen!(handled, fwd("open:handled"));
    await middleware.didChange!({ document: handled } as never, fwd("change:handled"));
    await middleware.didClose!(handled, fwd("close:handled"));
    // the document is closed, a late change must not reopen it on the server
    await middleware.didChange!({ document: handled } as never, fwd("change:closed"));

    deepStrictEqual(forwarded, ["open:handled", "change:handled", "close:handled"]);
  });

  test("documents of an excluded workspace folder are filtered by the middleware", async () => {
    // the innermost workspace folder of a document decides, so a nested workspace folder is
    // covered too
    if (WORKSPACE_SECOND_FOLDER === undefined) {
      return;
    }

    const { lifecycle } = createLifecycle([excludingSecondFolder]);
    await lifecycle.activate(undefined);

    const excludedFile = Uri.joinPath(WORKSPACE_SECOND_FOLDER.uri, "index.js");
    const handledFile = Uri.joinPath(WORKSPACE_FOLDER.uri, "index.js");

    strictEqual(lifecycle.ignoresDocument(excludedFile), true);
    strictEqual(lifecycle.ignoresDocument(handledFile), false);

    const middleware = lifecycle.middleware;
    const forwarded: string[] = [];
    await middleware.didOpen!({ uri: excludedFile } as never, async () => {
      forwarded.push("open");
    });
    deepStrictEqual(forwarded, [], "`didOpen` is not forwarded to the server");

    const report = await middleware.provideDiagnostics!(
      excludedFile,
      undefined,
      undefined as never,
      never,
    );
    deepStrictEqual(report, { kind: "full", items: [] });

    const codeActions = await middleware.provideCodeActions!(
      { uri: excludedFile } as never,
      undefined as never,
      undefined as never,
      undefined as never,
      never,
    );
    deepStrictEqual(codeActions, []);

    const edits = await middleware.provideDocumentFormattingEdits!(
      { uri: excludedFile } as never,
      undefined as never,
      undefined as never,
      never,
    );
    deepStrictEqual(edits, []);
  });

  test("a document of another scheme belongs to the workspace folder of its path", async () => {
    if (WORKSPACE_SECOND_FOLDER === undefined) {
      return;
    }

    const { lifecycle } = createLifecycle([excludingSecondFolder]);
    await lifecycle.activate(undefined);

    // `git:` documents have no scheme in common with the workspace folders
    const gitDocument = (folder: WorkspaceFolder) =>
      Uri.joinPath(folder.uri, "index.js").with({ scheme: "git", query: "{}" });

    strictEqual(lifecycle.ignoresDocument(gitDocument(WORKSPACE_SECOND_FOLDER)), true);
    strictEqual(lifecycle.ignoresDocument(gitDocument(WORKSPACE_FOLDER)), false);
  });

  test("documents outside of every workspace folder follow the window value", async () => {
    const outside = Uri.file("/tmp/outside-of-the-workspace/index.js");
    const untitled = Uri.parse("untitled:Untitled-1");

    const enabled = createLifecycle([excludingSecondFolder]);
    await enabled.lifecycle.activate(undefined);

    strictEqual(enabled.lifecycle.ignoresDocument(outside), false);
    strictEqual(enabled.lifecycle.ignoresDocument(untitled), false);

    // the window level value disables the tool, those documents are not handled either
    const disabled = createLifecycle([{ ...excludingSecondFolder, windowEnabled: false }]);
    await disabled.lifecycle.activate(undefined);

    strictEqual(disabled.lifecycle.ignoresDocument(outside), true);
    strictEqual(disabled.lifecycle.ignoresDocument(untitled), true);

    // no configuration file can be looked up for them, `oxc.requireConfig` at the window level
    // excludes them
    const requiring = createLifecycle([{ ...excludingSecondFolder, windowRequiresConfig: true }]);
    await requiring.lifecycle.activate(undefined);

    strictEqual(requiring.lifecycle.ignoresDocument(outside), true);
    strictEqual(requiring.lifecycle.ignoresDocument(untitled), true);
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

  teardown(() =>
    resetOxcSettings(
      ["enable", "enable.oxlint", "enable.oxfmt", "requireConfig"],
      [ConfigurationTarget.Global],
    ),
  );

  test("a change of a parent key is not reported for the section of its children", async () => {
    // `affectsConfiguration` matches the changed keys as a prefix of the section, so the parent
    // key has to be listed besides the tool specific one
    const event = await changeOf("enable", false);

    strictEqual(event.affectsConfiguration("oxc.enable"), true);
    strictEqual(event.affectsConfiguration("oxc.enable.oxlint"), false);
  });

  // the parent section reports the change of a child, the other tool then skips it with its state key
  const cases = [
    { key: "enable", value: false, oxlint: true, oxfmt: true },
    { key: "enable.oxfmt", value: false, oxlint: true, oxfmt: true },
    { key: "requireConfig", value: true, oxlint: true, oxfmt: false },
  ];

  for (const { key, value, oxlint, oxfmt } of cases) {
    test(`a change of \`oxc.${key}\` is reported for oxlint: ${oxlint}, for oxfmt: ${oxfmt}`, async () => {
      const event = await changeOf(key, value);

      strictEqual(affectsClientState(event, "oxlint"), oxlint);
      strictEqual(affectsClientState(event, "oxfmt"), oxfmt);
    });
  }
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

  const base = {
    folders: [folderA, folderB, folderC],
    windowEnabled: true,
    isEnabled: () => true,
    disabledReason: "disabled",
    foldersDisabledReason: "disabled in the folders",
    missingConfigReason: "no config",
  };

  test("a mixed window runs and excludes the folders it does not handle", async () => {
    const state = await computeClientState({
      ...base,
      windowRequiresConfig: false,
      // `state-b` disables the tool, `state-c` requires a configuration file it does not have
      isEnabled: (uri) => uri.toString() !== folderB.uri.toString(),
      configRequirement: {
        requiresConfig: (candidate) => candidate.name === "state-c",
        fileNames: [".oxlintrc-state-test.json"],
      },
    });

    strictEqual(state.shouldRun, true, "one handled workspace folder is enough");
    deepStrictEqual(state.excludedFolders, excludedUris(folderB, folderC));
    strictEqual(state.reason, undefined);
  });

  test("without a workspace folder, `oxc.requireConfig` can not be fulfilled", async () => {
    const state = await computeClientState({
      ...base,
      folders: [],
      windowRequiresConfig: true,
      configRequirement: { requiresConfig: () => true, fileNames: [".oxlintrc-state-test.json"] },
    });

    strictEqual(state.shouldRun, false);
    strictEqual(state.reason, "no workspace folder is open");
    strictEqual(state.windowRequiresConfig, true);
    deepStrictEqual(state.excludedFolders, new Set());
  });

  test("a window which enables the tool but whose folders all disable it does not run", async () => {
    const state = await computeClientState({
      ...base,
      folders: [folderA, folderB],
      isEnabled: () => false,
    });

    strictEqual(state.shouldRun, false);
    strictEqual(state.reason, "disabled in the folders");
  });

  test("every workspace folder disabled does not run", async () => {
    const state = await computeClientState({
      ...base,
      folders: [folderA, folderB],
      windowEnabled: false,
      isEnabled: () => false,
      missingConfigReason: undefined,
    });

    strictEqual(state.shouldRun, false);
    strictEqual(state.reason, "disabled");
    deepStrictEqual(state.excludedFolders, excludedUris(folderA, folderB));
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
  const fileNames = [".oxlintrc-selector-test.json"];
  const configFileUri = Uri.joinPath(WORKSPACE_FOLDER.uri, fileNames[0]);

  const folders = [WORKSPACE_FOLDER, WORKSPACE_SECOND_FOLDER].filter(
    (folder) => folder !== undefined,
  );

  test("keeps only the workspace folders which enable the tool", async () => {
    const enabled = await resolveEnabledFolders({
      folders,
      isEnabled: (uri) => uri.fsPath === WORKSPACE_FOLDER.uri.fsPath,
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
      configRequirement: { requiresConfig: () => true, fileNames },
    });

    strictEqual(enabled.handled.length, 0);
    // the workspace folder is not disabled, it only misses its configuration file
    strictEqual(enabled.disabled.length, 0);
    strictEqual(enabled.withoutConfig.length, 1);
  });

  test("keeps a workspace folder which requires a configuration file and has one", async () => {
    await withTempFile(configFileUri, "{}", async () => {
      const enabled = await resolveEnabledFolders({
        folders: [WORKSPACE_FOLDER],
        isEnabled: () => true,
        // the configuration file is at the root of the folder
        configRequirement: { requiresConfig: () => true, fileNames },
      });

      deepStrictEqual(
        enabled.handled.map((folder) => folder.uri.fsPath),
        [WORKSPACE_FOLDER.uri.fsPath],
      );
    });
  });

  // the folder names contain glob metacharacters on purpose (a Next.js route directory): they are
  // excluded from the search of their parent literally
  for (const name of ["[slug]", "[a],{b,c}"]) {
    test(`does not count the configuration file of a nested workspace folder named ${name}`, async () => {
      const nestedFolder = {
        uri: Uri.joinPath(WORKSPACE_FOLDER.uri, name),
        name,
        index: WORKSPACE_FOLDER.index + 1,
      };
      const nestedConfigUri = Uri.joinPath(nestedFolder.uri, fileNames[0]);
      await workspace.fs.writeFile(nestedConfigUri, Buffer.from("{}"));

      try {
        const enabled = await resolveEnabledFolders({
          folders: [WORKSPACE_FOLDER, nestedFolder],
          isEnabled: () => true,
          configRequirement: { requiresConfig: () => true, fileNames },
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
  }

  test("a configuration file next to a nested workspace folder is still found", async () => {
    const nestedFolder = {
      uri: Uri.joinPath(WORKSPACE_FOLDER.uri, "[slug]"),
      name: "[slug]",
      index: WORKSPACE_FOLDER.index + 1,
    };
    const siblingConfigUri = Uri.joinPath(WORKSPACE_FOLDER.uri, "sibling", fileNames[0]);
    await workspace.fs.writeFile(siblingConfigUri, Buffer.from("{}"));

    try {
      const enabled = await resolveEnabledFolders({
        folders: [WORKSPACE_FOLDER, nestedFolder],
        isEnabled: () => true,
        configRequirement: { requiresConfig: () => true, fileNames },
      });

      deepStrictEqual(
        enabled.handled.map((folder) => folder.uri.fsPath),
        [WORKSPACE_FOLDER.uri.fsPath],
      );
    } finally {
      await workspace.fs.delete(Uri.joinPath(WORKSPACE_FOLDER.uri, "sibling"), {
        recursive: true,
        useTrash: false,
      });
    }
  });

  test("the cache remembers the search until it is invalidated", async () => {
    const cache = new ConfigFileCache();
    const configRequirement = { requiresConfig: () => true, fileNames, cache };
    const searchFolder = (folder: WorkspaceFolder) =>
      resolveEnabledFolders({ folders: [folder], isEnabled: () => true, configRequirement });
    const nestedFolder = {
      uri: Uri.joinPath(WORKSPACE_FOLDER.uri, "cache-nested"),
      name: "cache-nested",
      index: WORKSPACE_FOLDER.index + 1,
    };

    let searches = 0;
    const original = workspace.findFiles;
    (workspace as any).findFiles = (...args: Parameters<typeof original>) => {
      searches += 1;
      return original(...args);
    };
    try {
      await searchFolder(WORKSPACE_FOLDER);
      await searchFolder(nestedFolder);
      strictEqual(searches, 2, "one search per workspace folder");

      await searchFolder(WORKSPACE_FOLDER);
      await searchFolder(nestedFolder);
      strictEqual(searches, 2, "the second computation costs no search");

      // a configuration file event of one workspace folder
      cache.invalidate(nestedFolder);
      await searchFolder(WORKSPACE_FOLDER);
      await searchFolder(nestedFolder);
      strictEqual(searches, 3, "only that workspace folder is searched again");

      cache.invalidate();
      await searchFolder(WORKSPACE_FOLDER);
      await searchFolder(nestedFolder);
      strictEqual(searches, 5, "every workspace folder is searched again");
    } finally {
      (workspace as any).findFiles = original;
    }
  });

  test("a remembered configuration file which vanished is searched again", async () => {
    const cache = new ConfigFileCache();
    const configRequirement = { requiresConfig: () => true, fileNames, cache };
    const search = () =>
      resolveEnabledFolders({
        folders: [WORKSPACE_FOLDER],
        isEnabled: () => true,
        configRequirement,
      });

    await withTempFile(configFileUri, "{}", async () => {
      const found = await search();
      strictEqual(found.handled.length, 1);
    });

    // the file was deleted without the watcher noticing, the verdict is not trusted anymore
    const afterDeletion = await search();
    strictEqual(afterDeletion.handled.length, 0);
    strictEqual(afterDeletion.withoutConfig.length, 1);
  });

  test("a search which started before an invalidation is not remembered", async () => {
    const cache = new ConfigFileCache();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const pending = cache.get(WORKSPACE_FOLDER, async () => {
      await gate;
      return undefined;
    });
    cache.invalidate(WORKSPACE_FOLDER);
    release();
    await pending;

    strictEqual(await cache.get(WORKSPACE_FOLDER, async () => WORKSPACE_FOLDER.uri), true);
  });

  test("ignores the configuration file of a workspace folder which does not require one", async () => {
    const enabled = await resolveEnabledFolders({
      folders: [WORKSPACE_FOLDER],
      isEnabled: () => true,
      configRequirement: { requiresConfig: () => false, fileNames },
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
