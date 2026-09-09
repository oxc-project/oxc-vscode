import { strictEqual } from "assert";
import { commands, Uri, window, workspace } from "vscode";
import {
  activateExtension,
  deleteFixtures,
  fixturesWorkspaceUri,
  loadFixture,
  WORKSPACE_DIR,
} from "../test-helpers";

const LE = process.platform === "win32" ? "\r\n" : "\n";
const formatted = `class X {${LE}  foo() {${LE}    return 42;${LE}  }${LE}}${LE}`;

const failingServerUri = Uri.joinPath(WORKSPACE_DIR, "not-a-server");

async function restartFormatter(): Promise<void> {
  await commands.executeCommand("oxc.restartServerFormatter");
}

async function formatFixture(): Promise<string> {
  await loadFixture("formatting");
  const fileUri = Uri.joinPath(fixturesWorkspaceUri(), "fixtures", "formatting.ts");
  const document = await workspace.openTextDocument(fileUri);
  await window.showTextDocument(document);
  await commands.executeCommand("editor.action.formatDocument");
  await workspace.saveAll();
  return (await workspace.fs.readFile(fileUri)).toString();
}

suite("E2E Server Formatter Recovery", () => {
  if (process.env.SKIP_FORMATTER_TEST === "true") {
    return;
  }

  const serverPath = process.env.SERVER_PATH_DEV;

  suiteSetup(async () => {
    await activateExtension();
    await workspace.fs.writeFile(failingServerUri, new Uint8Array());
    await workspace.getConfiguration("editor").update("defaultFormatter", "oxc.oxc-vscode");
    await workspace.saveAll();
  });

  suiteTeardown(async () => {
    process.env.SERVER_PATH_DEV = serverPath;
    try {
      await restartFormatter();
    } catch {
      // leave the formatter usable for the suites that follow, if it can be
    }
    await workspace.getConfiguration("editor").update("defaultFormatter", undefined);
    await workspace.fs.delete(failingServerUri, { useTrash: false });
    await workspace.saveAll();
    await deleteFixtures();
  });

  test("restarts after the server failed to start", async () => {
    process.env.SERVER_PATH_DEV = failingServerUri.fsPath;
    try {
      await restartFormatter();
    } catch {
      // the server cannot be spawned, so this restart is expected to fail
    }

    process.env.SERVER_PATH_DEV = serverPath;
    await restartFormatter();

    strictEqual(await formatFixture(), formatted);
  });
});
