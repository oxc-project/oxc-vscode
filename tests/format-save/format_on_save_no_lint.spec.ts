import { strictEqual } from "assert";
import { dirname, join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  CodeActionKind,
  languages,
  Position,
  Range,
  Uri,
  window,
  workspace,
  WorkspaceEdit,
} from "vscode";
import {
  activateExtension,
  deleteFixtures,
  fixturesWorkspaceUri,
  sleep,
  WORKSPACE_DIR,
} from "../test-helpers";

const LE = process.platform === "win32" ? "\r\n" : "\n";
const slowLintResponseMs = 5_000;
const settingsApplyTimeoutMs = 3_000;

const oxlintLogPath = join(WORKSPACE_DIR.fsPath, ".fake-lsp-logs", "oxlint.log");
const oxfmtLogPath = join(WORKSPACE_DIR.fsPath, ".fake-lsp-logs", "oxfmt.log");
const workspaceSettingsPath = join(WORKSPACE_DIR.fsPath, ".vscode", "settings.json");

async function resetLog(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "");
}

async function readLog(path: string): Promise<string> {
  return readFile(path, "utf8").catch(() => "");
}

function isExpectedSetting(key: string, expectedValue: unknown): boolean {
  const actualValue = workspace.getConfiguration().get(key);
  return JSON.stringify(actualValue) === JSON.stringify(expectedValue);
}

async function writeWorkspaceSettings(settings: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(workspaceSettingsPath), { recursive: true });
  await writeFile(workspaceSettingsPath, `${JSON.stringify(settings, null, 2)}${LE}`);

  // VS Code observes settings-file edits asynchronously; wait for the effective
  // config so save assertions do not race the file watcher.
  const startedAt = Date.now();
  while (
    !Object.entries(settings).every(([key, value]) => isExpectedSetting(key, value)) &&
    Date.now() - startedAt < settingsApplyTimeoutMs
  ) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- Polling VS Code config is intentional.
    await sleep(50);
  }

  for (const [key, value] of Object.entries(settings)) {
    strictEqual(isExpectedSetting(key, value), true, `expected workspace setting ${key} to apply`);
  }
}

async function writeFormatOnlySettings(): Promise<void> {
  await writeWorkspaceSettings({
    "editor.codeActionsOnSave": {},
    "editor.defaultFormatter": "oxc.oxc-vscode",
    "editor.formatOnSave": true,
    "editor.formatOnSaveMode": "file",
  });
}

async function createFormattingFile(fileName: string): Promise<Uri> {
  const fixturesDir = Uri.joinPath(fixturesWorkspaceUri(), "fixtures");
  await mkdir(fixturesDir.fsPath, { recursive: true });
  const fileUri = Uri.joinPath(fixturesDir, fileName);
  await writeFile(fileUri.fsPath, `class X { foo() { return 42; } }${LE}`);
  return fileUri;
}

suite("format on save without lint code actions", () => {
  suiteSetup(async () => {
    await writeFormatOnlySettings();
    await activateExtension(false);
  });

  setup(async () => {
    await resetLog(oxlintLogPath);
    await resetLog(oxfmtLogPath);
    await writeFormatOnlySettings();
  });

  teardown(async () => {
    await deleteFixtures();
  });

  suiteTeardown(async () => {
    await writeWorkspaceSettings({});
  });

  test("format-only save does not request oxlint code actions or diagnostics", async () => {
    const fileUri = await createFormattingFile("format_only.ts");
    const document = await workspace.openTextDocument(fileUri);
    await window.showTextDocument(document);

    const edit = new WorkspaceEdit();
    const fullRange = new Range(
      new Position(0, 0),
      document.lineAt(document.lineCount - 1).range.end,
    );
    edit.replace(fileUri, fullRange, `class X{foo(){return 42;}}${LE}`);
    await workspace.applyEdit(edit);

    await resetLog(oxlintLogPath);
    await resetLog(oxfmtLogPath);

    const startedAt = Date.now();
    const saved = await document.save();
    const elapsedMs = Date.now() - startedAt;
    strictEqual(saved, true, "expected target document to be saved");

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

  test("biome fix-all on save does not request oxlint code actions", async () => {
    const fakeBiomeKind = CodeActionKind.SourceFixAll.append("biome");
    let fakeBiomeRequests = 0;
    const disposable = languages.registerCodeActionsProvider(
      { language: "typescript", scheme: "file" },
      {
        provideCodeActions: (_document, _range, context) => {
          if (context.only?.value !== fakeBiomeKind.value) {
            return [];
          }

          fakeBiomeRequests += 1;
          return [];
        },
      },
      {
        providedCodeActionKinds: [fakeBiomeKind],
      },
    );

    try {
      await writeWorkspaceSettings({
        "editor.codeActionsOnSave": {
          "source.fixAll.biome": "explicit",
        },
        "editor.defaultFormatter": "oxc.oxc-vscode",
        "editor.formatOnSave": true,
        "editor.formatOnSaveMode": "file",
      });

      const fileUri = await createFormattingFile("format_biome.ts");
      const document = await workspace.openTextDocument(fileUri);
      await window.showTextDocument(document);

      const edit = new WorkspaceEdit();
      const fullRange = new Range(
        new Position(0, 0),
        document.lineAt(document.lineCount - 1).range.end,
      );
      edit.replace(fileUri, fullRange, `class X{foo(){return 42;}}${LE}`);
      await workspace.applyEdit(edit);

      await resetLog(oxlintLogPath);
      await resetLog(oxfmtLogPath);

      const startedAt = Date.now();
      const saved = await document.save();
      const elapsedMs = Date.now() - startedAt;
      strictEqual(saved, true, "expected target document to be saved");

      const oxfmtLog = await readLog(oxfmtLogPath);
      strictEqual(
        oxfmtLog.includes("textDocument/formatting"),
        true,
        `expected oxfmt formatting request, log:\n${oxfmtLog}`,
      );
      strictEqual(fakeBiomeRequests, 1);

      const oxlintLog = await readLog(oxlintLogPath);
      strictEqual(
        oxlintLog.includes("textDocument/codeAction"),
        false,
        `unexpected oxlint code action request, log:\n${oxlintLog}`,
      );
      strictEqual(
        elapsedMs < slowLintResponseMs,
        true,
        `save waited for slow oxlint code actions, elapsed ${elapsedMs}ms, log:\n${oxlintLog}`,
      );
    } finally {
      disposable.dispose();
    }
  });

  test("generic fix-all on save respects oxlint opt-out", async () => {
    let fakeFixAllRequests = 0;
    const disposable = languages.registerCodeActionsProvider(
      { language: "typescript", scheme: "file" },
      {
        provideCodeActions: (_document, _range, context) => {
          if (context.only?.value !== CodeActionKind.SourceFixAll.value) {
            return [];
          }

          fakeFixAllRequests += 1;
          return [];
        },
      },
      {
        providedCodeActionKinds: [CodeActionKind.SourceFixAll],
      },
    );

    try {
      await writeWorkspaceSettings({
        "editor.codeActionsOnSave": {
          "source.fixAll": "explicit",
          "source.fixAll.oxc": "never",
        },
        "editor.defaultFormatter": "oxc.oxc-vscode",
        "editor.formatOnSave": true,
        "editor.formatOnSaveMode": "file",
      });

      const fileUri = await createFormattingFile("format_generic_fix_all.ts");
      const document = await workspace.openTextDocument(fileUri);
      await window.showTextDocument(document);

      const edit = new WorkspaceEdit();
      const fullRange = new Range(
        new Position(0, 0),
        document.lineAt(document.lineCount - 1).range.end,
      );
      edit.replace(fileUri, fullRange, `class X{foo(){return 42;}}${LE}`);
      await workspace.applyEdit(edit);

      await resetLog(oxlintLogPath);
      await resetLog(oxfmtLogPath);

      const startedAt = Date.now();
      const saved = await document.save();
      const elapsedMs = Date.now() - startedAt;
      strictEqual(saved, true, "expected target document to be saved");

      const oxfmtLog = await readLog(oxfmtLogPath);
      strictEqual(
        oxfmtLog.includes("textDocument/formatting"),
        true,
        `expected oxfmt formatting request, log:\n${oxfmtLog}`,
      );
      strictEqual(fakeFixAllRequests, 1);

      const oxlintLog = await readLog(oxlintLogPath);
      strictEqual(
        oxlintLog.includes("textDocument/codeAction"),
        false,
        `unexpected oxlint code action request, log:\n${oxlintLog}`,
      );
      strictEqual(
        elapsedMs < slowLintResponseMs,
        true,
        `save waited for slow oxlint code actions, elapsed ${elapsedMs}ms, log:\n${oxlintLog}`,
      );
    } finally {
      disposable.dispose();
    }
  });
});
