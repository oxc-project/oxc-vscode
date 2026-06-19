const path = require("node:path");

const { appendLog, createLspServer } = require("./fake_lsp_common");

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

createLspServer({
  logPath,
  capabilities: {
    documentFormattingProvider: true,
    textDocumentSync: 1,
  },
  onRequest: {
    "textDocument/formatting": (params) => {
      appendLog(logPath, `textDocument/formatting uri=${params.textDocument.uri}`);
      const text = documents.get(params.textDocument.uri) ?? "";

      return [
        {
          range: fullRange(text),
          newText: "class X {\n  foo() {\n    return 42;\n  }\n}\n",
        },
      ];
    },
  },
  onNotification: {
    "textDocument/didOpen": (params) => {
      documents.set(params.textDocument.uri, params.textDocument.text);
    },
    "textDocument/didChange": (params) => {
      const text = params.contentChanges[0]?.text;
      if (text !== undefined) {
        documents.set(params.textDocument.uri, text);
      }
    },
  },
});
