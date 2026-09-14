import { deepStrictEqual, notStrictEqual, ok, rejects, strictEqual } from "assert";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { mock } from "node:test";
import {
  CancellationTokenSource,
  ConfigurationTarget,
  LogOutputChannel,
  window,
  workspace,
} from "vscode";
import type { LanguageClient } from "vscode-languageclient/node";
import { ConfigService } from "../../client/ConfigService";
import {
  BinarySearchResult,
  clearGlobalNodeModulesPathsCache,
  searchGlobalNodeModulesBin,
} from "../../client/findBinary";
import StatusBarItemHandler from "../../client/StatusBarItemHandler";
import Formatter from "../../client/tools/formatter";
import Linter from "../../client/tools/linter";
import { WORKSPACE_FOLDER } from "../test-helpers";

function getWorkspaceOptions(settings: { workspaceUri: string; options: unknown }[]): unknown {
  return settings.find(({ workspaceUri }) => workspaceUri === WORKSPACE_FOLDER.uri.toString())!
    .options;
}

for (const [Tool, command, getter] of [
  [Linter, "lint", "getOxlintServerBinPath"],
  [Formatter, "fmt", "getOxfmtServerBinPath"],
] as const) {
  suite(`Vite+ ${command} lifecycle`, () => {
    const root = path.join(WORKSPACE_FOLDER.uri.fsPath, `vp-${command}-lifecycle`);
    const nestedConfigKey = command === "lint" ? "disableNestedConfig" : "fmt.disableNestedConfig";
    let service: ConfigService;
    let tool: Linter | Formatter;
    let output: LogOutputChannel;
    let status: StatusBarItemHandler;
    let selected: BinarySearchResult;

    function assertNestedConfig(options: unknown, expected: boolean): void {
      const values = options as Record<string, unknown>;
      strictEqual(values[nestedConfigKey], expected);
      if (command === "lint") {
        strictEqual(
          (values.flags as Record<string, string>).disable_nested_config,
          String(expected),
        );
      }
    }

    setup(async () => {
      // No server needs to run to exercise client replacement on navigation.
      await workspace.getConfiguration("oxc").update("enable", false);
      mkdirSync(root, { recursive: true });
      const vpPath = path.join(root, "vp.cjs");
      writeFileSync(vpPath, "");
      selected = { path: vpPath, loader: "node", vitePlus: command, cwd: root };
      service = new ConfigService();
      mock.method(service, getter, async () => selected);
      output = window.createOutputChannel(`Vite+ ${command} lifecycle`, { log: true });
      status = new StatusBarItemHandler("test");
      tool = new Tool(output, service, status);
      await tool.activate(selected);
    });

    teardown(async () => {
      await tool.deactivate();
      tool.dispose();
      service.dispose();
      output.dispose();
      status.dispose();
      mock.restoreAll();
      clearGlobalNodeModulesPathsCache();
      await workspace.getConfiguration("oxc").update("enable", undefined);
      await workspace
        .getConfiguration("oxc", WORKSPACE_FOLDER.uri)
        .update(nestedConfigKey, undefined, ConfigurationTarget.WorkspaceFolder);
      rmSync(root, { recursive: true, force: true });
    });

    for (const userSetting of [false, true]) {
      test(`disables nested configs only for Vite+ with user setting ${userSetting}`, async () => {
        const config = workspace.getConfiguration("oxc", WORKSPACE_FOLDER.uri);
        await config.update(nestedConfigKey, userSetting, ConfigurationTarget.WorkspaceFolder);
        service.getWorkspaceConfig(WORKSPACE_FOLDER.uri)!.refresh();
        const event = {
          affectsConfiguration: (section: string) => section === `oxc.${nestedConfigKey}`,
        };

        async function checkClientConfig(expected: boolean): Promise<void> {
          const client = (tool as unknown as { client: LanguageClient }).client;

          assertNestedConfig(
            getWorkspaceOptions(client.clientOptions.initializationOptions),
            expected,
          );
          const cancellation = new CancellationTokenSource();
          try {
            const pulled = await client.clientOptions.middleware!.workspace!.configuration!(
              {
                items: [
                  { section: "oxc_language_server", scopeUri: WORKSPACE_FOLDER.uri.toString() },
                  { section: "unrelated", scopeUri: WORKSPACE_FOLDER.uri.toString() },
                  { section: "oxc_language_server" },
                ],
              },
              cancellation.token,
              async () => [],
            );
            ok(Array.isArray(pulled));
            assertNestedConfig(pulled[0], expected);
            deepStrictEqual(pulled.slice(1), [null, null]);
          } finally {
            cancellation.dispose();
          }

          const running = mock.method(client, "isRunning", () => true);
          const notification = mock.method(client, "sendNotification", async () => {});
          try {
            await tool.onConfigChange(event);
            strictEqual(notification.mock.callCount(), 1);
            const [method, params] = notification.mock.calls[0].arguments;
            strictEqual(method, "workspace/didChangeConfiguration");
            assertNestedConfig(getWorkspaceOptions(params.settings), expected);
            assertNestedConfig(
              getWorkspaceOptions(client.clientOptions.initializationOptions),
              expected,
            );
          } finally {
            running.mock.restore();
            notification.mock.restore();
          }
          strictEqual(
            workspace.getConfiguration("oxc", WORKSPACE_FOLDER.uri).get(nestedConfigKey),
            userSetting,
            "the saved setting must not change",
          );
        }

        await checkClientConfig(true);
        const vitePlus = selected;
        selected = { path: selected.path, loader: "node" };
        await tool.restart(true);
        await checkClientConfig(userSetting);
        selected = vitePlus;
        await tool.restart(true);
        await checkClientConfig(true);
      });
    }

    test("keeps the client for unchanged binaries and replaces it when the project or mode changes", async () => {
      const activation = mock.method(tool, "activate", tool.activate.bind(tool));
      await tool.restart(true);
      strictEqual(activation.mock.callCount(), 0);

      selected = { ...selected, cwd: path.join(root, "another-project") };
      await tool.restart(true);
      strictEqual(activation.mock.callCount(), 1);

      selected = { path: selected.path, loader: "node" };
      await tool.restart(true);
      strictEqual(activation.mock.callCount(), 2);

      await tool.restart();
      strictEqual(
        activation.mock.callCount(),
        3,
        "the restart command must allow an unchanged binary",
      );
    });

    test("replaces a client after its server fails to launch", async () => {
      mock.getter(service.vsCodeConfig, "useExecPath", () => false);
      mock.getter(service.vsCodeConfig, "nodePath", () => path.join(root, "missing-node"));
      await tool.restart();
      const failedClient = (tool as unknown as { client: LanguageClient }).client;
      await rejects(failedClient.start());

      await tool.restart();
      const replacement = (tool as unknown as { client: LanguageClient }).client;
      notStrictEqual(replacement, failedClient);
      ok(replacement, "a failed startup must not prevent the next activation");
    });

    test("navigation reuses global locations and an explicit restart refreshes them", async () => {
      const name = command === "lint" ? "oxlint" : "oxfmt";
      const firstModules = path.join(root, "first", "node_modules");
      const secondModules = path.join(root, "second", "node_modules");
      for (const dir of [firstModules, secondModules]) {
        mkdirSync(path.join(dir, ".bin"), { recursive: true });
        writeFileSync(path.join(dir, ".bin", name), "");
      }
      let globalModules = firstModules;
      const probes = mock.method(require("node:child_process"), "spawnSync", () => ({
        status: 0,
        stdout: globalModules,
      }));
      mock.method(service, getter, () => searchGlobalNodeModulesBin(name));
      const activation = mock.method(tool, "activate", tool.activate.bind(tool));
      await tool.restart();
      strictEqual(
        activation.mock.calls[0].arguments[0]?.path,
        path.join(firstModules, ".bin", name),
      );
      strictEqual(probes.mock.callCount(), 2);

      globalModules = secondModules;
      await tool.restart(true);
      strictEqual(activation.mock.callCount(), 1);
      strictEqual(probes.mock.callCount(), 2, "navigation must reuse the known locations");

      await tool.restart();
      strictEqual(
        activation.mock.calls[1].arguments[0]?.path,
        path.join(secondModules, ".bin", name),
      );
      strictEqual(probes.mock.callCount(), 4, "explicit restarts must query the locations again");
    });

    test("waits for an ongoing restart before processing another restart or shutdown", async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const activate = tool.activate.bind(tool);
      const activation = mock.method(tool, "activate", async (binary?: BinarySearchResult) => {
        await gate;
        await activate(binary);
      });
      const first = tool.restart();
      const second = tool.restart();
      const shutdown = tool.deactivate();
      release();
      await Promise.all([first, second, shutdown]);
      strictEqual(activation.mock.callCount(), 2);
      strictEqual(tool.getLspVersion(), undefined);
    });
  });
}
