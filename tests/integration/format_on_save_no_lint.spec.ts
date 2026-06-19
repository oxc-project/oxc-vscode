import { strictEqual } from "assert";
import { dirname, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Position, Range, Uri, window, workspace, WorkspaceEdit } from "vscode";
import {
  activateExtension,
  deleteFixtures,
  fixturesWorkspaceUri,
  loadFixture,
  sleep,
  WORKSPACE_DIR,
} from "../test-helpers";

const LE = process.platform === "win32" ? "\r\n" : "\n";
const slowLintResponseMs = 5_000;

const oxlintLogPath = join(WORKSPACE_DIR.fsPath, ".fake-lsp-logs", "oxlint.log");
const oxfmtLogPath = join(WORKSPACE_DIR.fsPath, ".fake-lsp-logs", "oxfmt.log");
const workspaceSettingsPath = join(WORKSPACE_DIR.fsPath, ".vscode", "settings.json");
const isFormatSavePathSuite =
  process.env.SERVER_PATH_DEV_OXLINT?.includes("fake_oxlint_server.js") === true &&
  process.env.SERVER_PATH_DEV_OXFMT?.includes("fake_oxfmt_server.js") === true;

async function resetLog(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "");
}

async function readLog(path: string): Promise<string> {
  return readFile(path, "utf8").catch(() => "");
}

async function writeWorkspaceSettings(settings: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(workspaceSettingsPath), { recursive: true });
  await writeFile(workspaceSettingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

suite("format on save without lint code actions", () => {
  if (!isFormatSavePathSuite) {
    return;
  }

  suiteSetup(async () => {
    await resetLog(oxlintLogPath);
    await resetLog(oxfmtLogPath);
    await writeWorkspaceSettings({
      "editor.codeActionsOnSave": {},
      "editor.defaultFormatter": "oxc.oxc-vscode",
      "editor.formatOnSave": true,
      "editor.formatOnSaveMode": "file",
    });
    await activateExtension(false);
  });

  teardown(async () => {
    await deleteFixtures();
    await writeWorkspaceSettings({});
  });

  test("format-only save does not request oxlint code actions or diagnostics", async () => {
    await loadFixture("formatting");

    const fileUri = Uri.joinPath(fixturesWorkspaceUri(), "fixtures", "formatting.ts");
    const document = await workspace.openTextDocument(fileUri);
    await window.showTextDocument(document);
    await sleep(1_000);

    const edit = new WorkspaceEdit();
    const fullRange = new Range(
      new Position(0, 0),
      document.lineAt(document.lineCount - 1).range.end,
    );
    edit.replace(fileUri, fullRange, "class X{foo(){return 42;}}\n");
    await workspace.applyEdit(edit);
    await sleep(500);

    await resetLog(oxlintLogPath);
    await resetLog(oxfmtLogPath);

    const startedAt = Date.now();
    await workspace.saveAll();
    const elapsedMs = Date.now() - startedAt;
    await sleep(500);

    const content = await workspace.fs.readFile(fileUri);
    strictEqual(
      content.toString(),
      `class X {${LE}  foo() {${LE}    return 42;${LE}  }${LE}}${LE}`,
      `unexpected saved content:\n${content.toString()}`,
    );

    const oxfmtLog = await readLog(oxfmtLogPath);
    strictEqual(
      oxfmtLog.includes("textDocument/formatting"),
      true,
      `expected oxfmt formatting request, log:\n${oxfmtLog}`,
    );

    const oxlintLog = await readLog(oxlintLogPath);
    strictEqual(
      oxlintLog.includes("textDocument/codeAction"),
      false,
      `unexpected oxlint code action request, log:\n${oxlintLog}`,
    );
    strictEqual(
      oxlintLog.includes("textDocument/diagnostic"),
      false,
      `unexpected oxlint diagnostic request, log:\n${oxlintLog}`,
    );
    strictEqual(elapsedMs < slowLintResponseMs, true, `save took ${elapsedMs}ms`);
  });
});
