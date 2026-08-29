import { strictEqual } from "assert";
import { CodeActionKind, CodeActionTriggerKind } from "vscode";
import type { CodeActionContext } from "vscode";
import { shouldProvideOxfmtCodeAction } from "../../client/tools/formatter.js";

function codeActionContext(only: CodeActionKind | undefined): CodeActionContext {
  return {
    diagnostics: [],
    only,
    triggerKind: CodeActionTriggerKind.Invoke,
  };
}

suite("formatter code action routing", () => {
  test("allows unscoped code action requests", () => {
    strictEqual(shouldProvideOxfmtCodeAction(codeActionContext(undefined)), true);
  });

  test("allows parent and format source action requests", () => {
    strictEqual(shouldProvideOxfmtCodeAction(codeActionContext(CodeActionKind.Source)), true);
    strictEqual(
      shouldProvideOxfmtCodeAction(codeActionContext(CodeActionKind.Source.append("format"))),
      true,
    );
    strictEqual(
      shouldProvideOxfmtCodeAction(codeActionContext(CodeActionKind.Source.append("format.oxc"))),
      true,
    );
  });

  test("skips unrelated code action requests", () => {
    strictEqual(
      shouldProvideOxfmtCodeAction(codeActionContext(CodeActionKind.SourceFixAll)),
      false,
    );
    strictEqual(
      shouldProvideOxfmtCodeAction(codeActionContext(CodeActionKind.SourceOrganizeImports)),
      false,
    );
    strictEqual(shouldProvideOxfmtCodeAction(codeActionContext(CodeActionKind.QuickFix)), false);
  });
});
