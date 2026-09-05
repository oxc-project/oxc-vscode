const path = require("node:path");
const { createConnection, ProposedFeatures } = require("vscode-languageserver/node");

const { appendLog } = require("./fake_lsp_common");

const logPath = path.resolve(__dirname, "../../test_workspace/.fake-lsp-logs/oxfmt.log");
const documents = new Map();

function fullRange(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const lastLine = lines[lines.length - 1] ?? "";

  return {
    start: { line: 0, character: 0 },
    end: { line: lines.length - 1, character: lastLine.length },
  };
}

function documentEndOfLine(text) {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

// The extension launches JavaScript servers with `--lsp`, so pass the stdio
// streams explicitly instead of relying on the library's CLI transport flags.
const connection = createConnection(ProposedFeatures.all, process.stdin, process.stdout);

connection.onInitialize(() => ({
  capabilities: {
    documentFormattingProvider: true,
    textDocumentSync: 1,
  },
  serverInfo: {
    name: "oxc-vscode-fake-oxfmt",
    version: "0.0.0",
  },
}));

connection.onRequest("textDocument/formatting", (params) => {
  appendLog(logPath, `textDocument/formatting uri=${params.textDocument.uri}`);
  const text = documents.get(params.textDocument.uri) ?? "";
  const endOfLine = documentEndOfLine(text);

  return [
    {
      range: fullRange(text),
      // Preserve the document's EOL so the fake formatter behaves like a real formatter.
      newText: ["class X {", "  foo() {", "    return 42;", "  }", "}", ""].join(endOfLine),
    },
  ];
});

connection.onNotification("textDocument/didOpen", (params) => {
  documents.set(params.textDocument.uri, params.textDocument.text);
});
connection.onNotification("textDocument/didChange", (params) => {
  const text = params.contentChanges[0]?.text;
  if (text !== undefined) {
    documents.set(params.textDocument.uri, text);
  }
});

connection.listen();
