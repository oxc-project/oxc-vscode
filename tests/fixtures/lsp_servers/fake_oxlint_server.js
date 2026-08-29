const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { createConnection, ProposedFeatures } = require("vscode-languageserver/node");

const { appendLog } = require("./fake_lsp_common");

const logPath = path.resolve(__dirname, "../../test_workspace/.fake-lsp-logs/oxlint.log");
const defaultResponseMs = Number(process.env.FAKE_OXLINT_RESPONSE_MS ?? 5_000);
const codeActionResponseMs = Number(process.env.FAKE_OXLINT_CODE_ACTION_MS ?? defaultResponseMs);
const diagnosticResponseMs = Number(process.env.FAKE_OXLINT_DIAGNOSTIC_MS ?? defaultResponseMs);

// The extension launches JavaScript servers with `--lsp`, so pass the stdio
// streams explicitly instead of relying on the library's CLI transport flags.
const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout);

connection.onInitialize(() => ({
  capabilities: {
    codeActionProvider: {
      codeActionKinds: [
        "quickfix",
        "source.fixAll",
        "source.fixAll.oxc",
        "source.fixAllDangerous.oxc",
      ],
    },
    diagnosticProvider: {
      interFileDependencies: false,
      workspaceDiagnostics: false,
    },
    textDocumentSync: 1,
  },
  serverInfo: {
    name: "oxc-vscode-fake-oxlint",
    version: "0.0.0",
  },
}));

connection.onRequest("textDocument/codeAction", async (params) => {
  appendLog(
    logPath,
    `textDocument/codeAction only=${JSON.stringify(params.context?.only ?? null)} trigger=${String(params.context?.triggerKind ?? null)}`,
  );
  await delay(codeActionResponseMs);
  appendLog(logPath, "codeAction:end");
  return [];
});

connection.onRequest("textDocument/diagnostic", async () => {
  appendLog(logPath, "textDocument/diagnostic");
  await delay(diagnosticResponseMs);
  appendLog(logPath, "diagnostic:end");
  return {
    kind: "full",
    items: [],
  };
});

connection.onNotification("textDocument/didOpen", () => {
  appendLog(logPath, "textDocument/didOpen");
});
connection.onNotification("textDocument/didChange", () => {
  appendLog(logPath, "textDocument/didChange");
});
connection.onNotification("textDocument/didSave", () => {
  appendLog(logPath, "textDocument/didSave");
});

connection.listen();
