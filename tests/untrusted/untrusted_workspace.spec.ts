import { chmod, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { rejects, strictEqual } from "assert";
import { commands, Uri, window, workspace } from "vscode";
import {
  activateExtension,
  deleteFixtures,
  getDiagnostics,
  loadFixture,
  sleep,
  WORKSPACE_DIR,
} from "../test-helpers";

const workspacePath = WORKSPACE_DIR.fsPath;
const binDir = path.join(workspacePath, "node_modules", ".bin");
const lintMarkerPath = path.join(workspacePath, "oxlint-ran.marker");
const fmtMarkerPath = path.join(workspacePath, "oxfmt-ran.marker");
const originalIsTrusted = Object.getOwnPropertyDescriptor(workspace, "isTrusted")!;

async function createFakeBinary(binaryName: string, markerPath: string): Promise<void> {
  const binaryPath = path.join(binDir, binaryName);
  const script = `#!/bin/sh
echo ran > "${markerPath}"
exit 1
`;

  await writeFile(binaryPath, script, { encoding: "utf8" });
  await chmod(binaryPath, 0o755);
}

suiteSetup(async () => {
  Object.defineProperty(workspace, "isTrusted", {
    configurable: true,
    get: () => false,
  });
  // The VS Code test runner disables native workspace trust, so simulate its API state.
  strictEqual(workspace.isTrusted, false);
  await rm(lintMarkerPath, { force: true });
  await rm(fmtMarkerPath, { force: true });
  await workspace.fs.createDirectory(Uri.file(binDir));
  await createFakeBinary("oxlint", lintMarkerPath);
  await createFakeBinary("oxfmt", fmtMarkerPath);
  await activateExtension(false);
});

teardown(async () => {
  await workspace.getConfiguration("editor").update("defaultFormatter", undefined);
  await workspace.saveAll();
  await deleteFixtures();
});

suiteTeardown(async () => {
  await rm(lintMarkerPath, { force: true });
  await rm(fmtMarkerPath, { force: true });
  Object.defineProperty(workspace, "isTrusted", originalIsTrusted);
  await workspace.fs.delete(Uri.file(path.join(workspacePath, "node_modules")), {
    recursive: true,
    useTrash: false,
  });
});

suite("Untrusted Workspace", () => {
  test("does not execute workspace-local oxlint in Restricted Mode", async () => {
    await commands.executeCommand("oxc.restartServer");
    await loadFixture("debugger");
    const diagnostics = await getDiagnostics("debugger.js", undefined, 1500);

    strictEqual(diagnostics.length, 0);

    await rejects(async () => workspace.fs.stat(Uri.file(lintMarkerPath)), {
      code: "FileNotFound",
    });
  });

  test("does not execute workspace-local oxfmt in Restricted Mode", async () => {
    await commands.executeCommand("oxc.restartServerFormatter");
    await workspace.getConfiguration("editor").update("defaultFormatter", "oxc.oxc-vscode");
    await workspace.saveAll();
    await loadFixture("formatting");

    const fileUri = Uri.joinPath(WORKSPACE_DIR, "fixtures", "formatting.ts");
    const originalContent = await workspace.fs.readFile(fileUri);
    const document = await workspace.openTextDocument(fileUri);
    await window.showTextDocument(document);
    await sleep(500);
    const edits = await commands.executeCommand("vscode.executeFormatDocumentProvider", fileUri, {
      tabSize: 2,
      insertSpaces: true,
    });
    strictEqual(edits, undefined);
    await workspace.saveAll();

    const content = await workspace.fs.readFile(fileUri);
    strictEqual(content.toString(), originalContent.toString());

    await rejects(async () => workspace.fs.stat(Uri.file(fmtMarkerPath)), { code: "FileNotFound" });
  });
});
