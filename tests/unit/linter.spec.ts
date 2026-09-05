import { strictEqual } from "assert";
import { CodeActionKind, CodeActionTriggerKind, Diagnostic, Position, Range } from "vscode";
import type { CodeActionContext } from "vscode";
import {
  shouldCodeActionsOnSaveRequestOxlint,
  shouldRequestOxlintCodeActions,
} from "../../client/tools/linter.js";

const oxlintFixAllCodeActionKind = CodeActionKind.SourceFixAll.append("oxc");
const oxlintFixAllDangerousCodeActionKind = CodeActionKind.Source.append("fixAllDangerous.oxc");
type CodeActionsOnSave = Record<string, boolean | "always" | "explicit" | "never">;

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
      shouldCodeActionsOnSaveRequestOxlint(
        { [CodeActionKind.Source.value]: "always" },
        oxlintFixAllCodeActionKind,
      ),
      true,
    );
  });

  test("allows generic and oxlint fix-all actions on save", () => {
    strictEqual(
      shouldCodeActionsOnSaveRequestOxlint(
        { [CodeActionKind.SourceFixAll.value]: "explicit" },
        oxlintFixAllCodeActionKind,
      ),
      true,
    );
    strictEqual(
      shouldCodeActionsOnSaveRequestOxlint(
        { [oxlintFixAllCodeActionKind.value]: true },
        oxlintFixAllCodeActionKind,
      ),
      true,
    );
  });

  test("honors source.fixAll.oxc opt-out over broader source settings", () => {
    strictEqual(
      shouldCodeActionsOnSaveRequestOxlint(
        {
          [CodeActionKind.Source.value]: "always",
          [oxlintFixAllCodeActionKind.value]: "never",
        },
        oxlintFixAllCodeActionKind,
      ),
      false,
    );
    strictEqual(
      shouldCodeActionsOnSaveRequestOxlint(
        {
          [CodeActionKind.SourceFixAll.value]: "always",
          [oxlintFixAllCodeActionKind.value]: false,
        },
        oxlintFixAllCodeActionKind,
      ),
      false,
    );
  });

  test("honors source.fixAll opt-out over broad source settings", () => {
    strictEqual(
      shouldCodeActionsOnSaveRequestOxlint(
        {
          [CodeActionKind.Source.value]: "always",
          [CodeActionKind.SourceFixAll.value]: "never",
        },
        oxlintFixAllCodeActionKind,
      ),
      false,
    );
  });

  test("keeps dangerous fixes enabled when normal fix-all is opted out", () => {
    const codeActionsOnSave: CodeActionsOnSave = {
      [CodeActionKind.Source.value]: "always",
      [oxlintFixAllCodeActionKind.value]: "never",
    };

    strictEqual(
      shouldCodeActionsOnSaveRequestOxlint(codeActionsOnSave, oxlintFixAllCodeActionKind),
      false,
    );
    strictEqual(
      shouldCodeActionsOnSaveRequestOxlint(codeActionsOnSave, oxlintFixAllDangerousCodeActionKind),
      true,
    );
  });

  test("allows legacy array source action settings", () => {
    strictEqual(
      shouldCodeActionsOnSaveRequestOxlint(
        [CodeActionKind.Source.value],
        oxlintFixAllDangerousCodeActionKind,
      ),
      true,
    );
    strictEqual(
      shouldCodeActionsOnSaveRequestOxlint(
        [CodeActionKind.SourceFixAll.value],
        oxlintFixAllCodeActionKind,
      ),
      true,
    );
    strictEqual(
      shouldCodeActionsOnSaveRequestOxlint(
        [oxlintFixAllCodeActionKind.value],
        oxlintFixAllCodeActionKind,
      ),
      true,
    );
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
    const codeActionsOnSave: CodeActionsOnSave = {
      [oxlintFixAllCodeActionKind.value]: "explicit",
    };

    strictEqual(
      shouldRequestOxlintCodeActions(
        codeActionContext(CodeActionKind.Source, CodeActionTriggerKind.Automatic),
        codeActionsOnSave,
      ),
      true,
    );
    strictEqual(
      shouldRequestOxlintCodeActions(
        codeActionContext(CodeActionKind.SourceFixAll, CodeActionTriggerKind.Automatic),
        codeActionsOnSave,
      ),
      true,
    );
    strictEqual(
      shouldRequestOxlintCodeActions(
        codeActionContext(oxlintFixAllCodeActionKind, CodeActionTriggerKind.Automatic),
        codeActionsOnSave,
      ),
      true,
    );
  });

  test("allows dangerous fixes under broad source when normal fix-all is opted out", () => {
    const codeActionsOnSave: CodeActionsOnSave = {
      [CodeActionKind.Source.value]: "always",
      [oxlintFixAllCodeActionKind.value]: "never",
    };
    const broadSourceContext = codeActionContext(
      CodeActionKind.Source,
      CodeActionTriggerKind.Automatic,
    );

    strictEqual(shouldRequestOxlintCodeActions(broadSourceContext, codeActionsOnSave, true), true);
    strictEqual(
      shouldRequestOxlintCodeActions(broadSourceContext, codeActionsOnSave, false),
      false,
    );
    strictEqual(
      shouldRequestOxlintCodeActions(
        codeActionContext(CodeActionKind.SourceFixAll, CodeActionTriggerKind.Automatic),
        codeActionsOnSave,
        true,
      ),
      false,
    );
  });
});
