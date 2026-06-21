import { strictEqual } from "assert";
import { CodeActionKind, CodeActionTriggerKind, Diagnostic, Position, Range } from "vscode";
import type { CodeActionContext } from "vscode";
import { shouldRequestOxlintCodeActions } from "../../client/tools/linter.js";

function codeActionContext(
  only: CodeActionKind | undefined,
  triggerKind: CodeActionTriggerKind = CodeActionTriggerKind.Invoke,
  diagnostics: Diagnostic[] = [],
): CodeActionContext {
  return {
    diagnostics,
    only,
    triggerKind,
  };
}

function diagnostic(): Diagnostic {
  return new Diagnostic(new Range(new Position(0, 0), new Position(0, 1)), "test");
}

suite("linter code action routing", () => {
  test("allows unscoped code action requests", () => {
    strictEqual(shouldRequestOxlintCodeActions(codeActionContext(undefined)), true);
  });

  test("skips unscoped automatic code action requests", () => {
    strictEqual(
      shouldRequestOxlintCodeActions(codeActionContext(undefined, CodeActionTriggerKind.Automatic)),
      false,
    );
  });

  test("allows unscoped automatic code action requests with diagnostics", () => {
    strictEqual(
      shouldRequestOxlintCodeActions(
        codeActionContext(undefined, CodeActionTriggerKind.Automatic, [diagnostic()]),
      ),
      true,
    );
  });

  test("allows quick fixes and fix-all requests", () => {
    strictEqual(shouldRequestOxlintCodeActions(codeActionContext(CodeActionKind.QuickFix)), true);
    strictEqual(
      shouldRequestOxlintCodeActions(codeActionContext(CodeActionKind.SourceFixAll)),
      true,
    );
    strictEqual(
      shouldRequestOxlintCodeActions(codeActionContext(CodeActionKind.SourceFixAll.append("oxc"))),
      true,
    );
  });

  test("skips unrelated source action requests", () => {
    strictEqual(
      shouldRequestOxlintCodeActions(codeActionContext(CodeActionKind.SourceOrganizeImports)),
      false,
    );
    strictEqual(
      shouldRequestOxlintCodeActions(codeActionContext(CodeActionKind.Source.append("format.oxc"))),
      false,
    );
    strictEqual(
      shouldRequestOxlintCodeActions(
        codeActionContext(CodeActionKind.SourceFixAll.append("biome")),
      ),
      false,
    );
  });

  test("skips broad automatic source requests", () => {
    strictEqual(
      shouldRequestOxlintCodeActions(
        codeActionContext(CodeActionKind.Source, CodeActionTriggerKind.Automatic),
      ),
      false,
    );
  });

  test("allows precise automatic fix-all requests", () => {
    strictEqual(
      shouldRequestOxlintCodeActions(
        codeActionContext(CodeActionKind.SourceFixAll, CodeActionTriggerKind.Automatic),
      ),
      true,
    );
  });

  test("allows automatic source requests when fix-all runs on save", () => {
    strictEqual(
      shouldRequestOxlintCodeActions(
        codeActionContext(CodeActionKind.Source, CodeActionTriggerKind.Automatic),
        true,
      ),
      true,
    );
    strictEqual(
      shouldRequestOxlintCodeActions(
        codeActionContext(CodeActionKind.SourceFixAll, CodeActionTriggerKind.Automatic),
        true,
      ),
      true,
    );
  });
});
