const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const { appendLog, createLspServer } = require("./fake_lsp_common");

const logPath = path.resolve(__dirname, "../../test_workspace/.fake-lsp-logs/oxlint.log");
const slowResponseMs = 5_000;

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
    "textDocument/codeAction": async () => {
      appendLog(logPath, "textDocument/codeAction");
      await delay(slowResponseMs);
      return [];
    },
    "textDocument/diagnostic": async () => {
      appendLog(logPath, "textDocument/diagnostic");
      await delay(slowResponseMs);
      return {
        kind: "full",
        items: [],
      };
    },
  },
  onNotification: {},
});
