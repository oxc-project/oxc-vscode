import { strictEqual } from "assert";
import { CodeActionKind, CodeActionTriggerKind, Diagnostic, Position, Range } from "vscode";
import type { CodeActionContext } from "vscode";
import {
  shouldCodeActionsOnSaveRequestOxlint,
  shouldRequestOxlintCodeActions,
} from "../../client/tools/linter.js";

const oxlintFixAllCodeActionKind = CodeActionKind.SourceFixAll.append("oxc");
const oxlintFixAllDangerousCodeActionKind = CodeActionKind.Source.append("fixAllDangerous.oxc");

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

suite("linter code actions on save settings", () => {
  test("allows broad source actions on save", () => {
    strictEqual(
      shouldCodeActionsOnSaveRequestOxlint({
        [CodeActionKind.Source.value]: "always",
      }),
      true,
    );
  });

  test("allows generic and oxlint fix-all actions on save", () => {
    strictEqual(
      shouldCodeActionsOnSaveRequestOxlint({
        [CodeActionKind.SourceFixAll.value]: "explicit",
      }),
      true,
    );
    strictEqual(
      shouldCodeActionsOnSaveRequestOxlint({
        [oxlintFixAllCodeActionKind.value]: true,
      }),
      true,
    );
  });

  test("honors source.fixAll.oxc opt-out over broader source settings", () => {
    strictEqual(
      shouldCodeActionsOnSaveRequestOxlint({
        [CodeActionKind.Source.value]: "always",
        [oxlintFixAllCodeActionKind.value]: "never",
      }),
      false,
    );
    strictEqual(
      shouldCodeActionsOnSaveRequestOxlint({
        [CodeActionKind.SourceFixAll.value]: "always",
        [oxlintFixAllCodeActionKind.value]: false,
      }),
      false,
    );
  });

  test("honors source.fixAll opt-out over broad source settings", () => {
    strictEqual(
      shouldCodeActionsOnSaveRequestOxlint({
        [CodeActionKind.Source.value]: "always",
        [CodeActionKind.SourceFixAll.value]: "never",
      }),
      false,
    );
  });

  test("allows legacy array source action settings", () => {
    strictEqual(shouldCodeActionsOnSaveRequestOxlint([CodeActionKind.Source.value]), true);
    strictEqual(shouldCodeActionsOnSaveRequestOxlint([CodeActionKind.SourceFixAll.value]), true);
    strictEqual(shouldCodeActionsOnSaveRequestOxlint([oxlintFixAllCodeActionKind.value]), true);
  });
});

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
    strictEqual(
      shouldRequestOxlintCodeActions(codeActionContext(oxlintFixAllDangerousCodeActionKind)),
      true,
    );
  });

  test("skips kinds oxlint does not handle", () => {
    strictEqual(
      shouldRequestOxlintCodeActions(codeActionContext(CodeActionKind.QuickFix.append("example"))),
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

  test("skips automatic fix-all requests when oxlint is opted out on save", () => {
    strictEqual(
      shouldRequestOxlintCodeActions(
        codeActionContext(CodeActionKind.SourceFixAll, CodeActionTriggerKind.Automatic),
      ),
      false,
    );
    strictEqual(
      shouldRequestOxlintCodeActions(
        codeActionContext(oxlintFixAllCodeActionKind, CodeActionTriggerKind.Automatic),
      ),
      false,
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
    strictEqual(
      shouldRequestOxlintCodeActions(
        codeActionContext(oxlintFixAllCodeActionKind, CodeActionTriggerKind.Automatic),
        true,
      ),
      true,
    );
  });
});
