const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const { appendLog, createLspServer } = require("./fake_lsp_common");

const logPath = path.resolve(__dirname, "../../test_workspace/.fake-lsp-logs/oxlint.log");
const defaultResponseMs = Number(process.env.FAKE_OXLINT_RESPONSE_MS ?? 5_000);
const codeActionResponseMs = Number(process.env.FAKE_OXLINT_CODE_ACTION_MS ?? defaultResponseMs);
const diagnosticResponseMs = Number(process.env.FAKE_OXLINT_DIAGNOSTIC_MS ?? defaultResponseMs);

createLspServer({
  logPath,
  capabilities: {
    codeActionProvider: {
      codeActionKinds: ["quickfix", "source.fixAll", "source.fixAll.oxc"],
    },
    diagnosticProvider: {
      interFileDependencies: false,
      workspaceDiagnostics: false,
    },
    textDocumentSync: 1,
  },
  onRequest: {
    "textDocument/codeAction": async (params) => {
      appendLog(
        logPath,
        `textDocument/codeAction only=${JSON.stringify(params.context?.only ?? null)} trigger=${String(params.context?.triggerKind ?? null)}`,
      );
      await delay(codeActionResponseMs);
      appendLog(logPath, "codeAction:end");
      return [];
    },
    "textDocument/diagnostic": async () => {
      appendLog(logPath, "textDocument/diagnostic");
      await delay(diagnosticResponseMs);
      appendLog(logPath, "diagnostic:end");
      return {
        kind: "full",
        items: [],
      };
    },
  },
  onNotification: {
    "textDocument/didOpen": () => {
      appendLog(logPath, "textDocument/didOpen");
    },
    "textDocument/didChange": () => {
      appendLog(logPath, "textDocument/didChange");
    },
    "textDocument/didSave": () => {
      appendLog(logPath, "textDocument/didSave");
    },
  },
});
