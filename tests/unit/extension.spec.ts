import { deepStrictEqual, strictEqual } from "assert";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { mock } from "node:test";
import { commands, ExtensionContext, Uri, window } from "vscode";
import { activate, deactivate } from "../../client/extension";
import type { BinarySearchResult } from "../../client/findBinary";
import Formatter from "../../client/tools/formatter";
import Linter from "../../client/tools/linter";
import { WORKSPACE_FOLDER } from "../test-helpers";
import { mockProcessEnv } from "../processMocks";

suite("navigation during extension activation", () => {
  const root = path.join(WORKSPACE_FOLDER.uri.fsPath, "startup-navigation");
  mockProcessEnv();
  let context: ExtensionContext;

  setup(() => {
    process.env.SKIP_LINTER_TEST = "false";
    process.env.SKIP_FORMATTER_TEST = "false";
    mkdirSync(root, { recursive: true });
    for (const name of ["a", "b"]) writeFileSync(path.join(root, `${name}.txt`), "");
    // The test host has already registered the extension's commands.
    mock.method(commands, "registerCommand", () => ({ dispose() {} }));
    // Log channels with the same name share a logger in VS Code. Keep disposal
    // of these test instances from closing the activated extension's channels.
    const createOutputChannel = window.createOutputChannel;
    mock.method(window, "createOutputChannel", (name: string, options: { log: true }) =>
      createOutputChannel(`Activation test ${name}`, options),
    );
    context = {
      extension: { packageJSON: { version: "test" } },
      subscriptions: [],
    } as unknown as ExtensionContext;
  });

  teardown(async () => {
    await deactivate();
    for (const disposable of context.subscriptions) disposable.dispose();
    mock.restoreAll();
    await commands.executeCommand("workbench.action.closeAllEditors");
    rmSync(root, { recursive: true, force: true });
  });

  for (const phase of ["discovery", "startup"] as const) {
    test(`reconciles a project switch during ${phase}`, async () => {
      const first = Uri.file(path.join(root, "a.txt"));
      const second = Uri.file(path.join(root, "b.txt"));
      await window.showTextDocument(first);
      let release!: () => void;
      let entered!: () => void;
      let waiting = 0;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      async function wait(): Promise<void> {
        if (++waiting === 2) entered();
        await gate;
      }
      const selected = new Map<string, string>();
      for (const [Tool, name] of [
        [Linter, "lint"],
        [Formatter, "fmt"],
      ] as const) {
        mock.method(Tool.prototype, "getBinary", async () => {
          const binary = {
            path: window.activeTextEditor!.document.uri.fsPath,
            loader: "native" as const,
          };
          if (phase === "discovery") await wait();
          return binary;
        });
        mock.method(Tool.prototype, "activate", async (binary?: BinarySearchResult) => {
          selected.set(name, binary!.path);
          if (phase === "startup") await wait();
        });
        mock.method(Tool.prototype, "restart", async (onlyIfBinaryChanged?: boolean) => {
          strictEqual(onlyIfBinaryChanged, true);
          selected.set(name, window.activeTextEditor!.document.uri.fsPath);
        });
        mock.method(Tool.prototype, "deactivate", async () => {});
      }
      const activation = activate(context);
      try {
        await ready;
        await window.showTextDocument(second);
      } finally {
        release();
      }
      await activation;
      deepStrictEqual([...selected.values()], [second.fsPath, second.fsPath]);
    });
  }
});
