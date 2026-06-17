const fs = require("node:fs");
const path = require("node:path");

function appendLog(logPath, message) {
  if (!logPath) {
    return;
  }

  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${message}\n`);
}

function createLspServer({ logPath, capabilities, onRequest, onNotification }) {
  let buffer = Buffer.alloc(0);

  function send(message) {
    const json = JSON.stringify(message);
    const contentLength = Buffer.byteLength(json, "utf8");
    process.stdout.write(`Content-Length: ${contentLength}\r\n\r\n${json}`);
  }

  async function handleMessage(message) {
    if (message.method === "initialize") {
      send({
        id: message.id,
        jsonrpc: "2.0",
        result: {
          capabilities,
          serverInfo: {
            name: "oxc-vscode-fake-lsp",
            version: "0.0.0",
          },
        },
      });
      return;
    }

    if (message.method === "shutdown") {
      send({ id: message.id, jsonrpc: "2.0", result: null });
      return;
    }

    if (message.method === "exit") {
      process.exit(0);
    }

    if (Object.hasOwn(message, "id")) {
      const handler = onRequest[message.method];
      const result = handler ? await handler(message.params) : null;
      send({ id: message.id, jsonrpc: "2.0", result });
      return;
    }

    const notificationHandler = onNotification[message.method];
    if (notificationHandler) {
      notificationHandler(message.params);
    }
  }

  function parseMessages() {
    while (true) {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return;
      }

      const header = buffer.subarray(0, headerEnd).toString("ascii");
      const match = header.match(/Content-Length: (\d+)/i);
      if (!match) {
        throw new Error(`Invalid LSP header: ${header}`);
      }

      const contentLength = Number(match[1]);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + contentLength;
      if (buffer.length < messageEnd) {
        return;
      }

      const rawMessage = buffer.subarray(messageStart, messageEnd).toString("utf8");
      buffer = buffer.subarray(messageEnd);
      void handleMessage(JSON.parse(rawMessage));
    }
  }

  process.stdin.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    parseMessages();
  });

  process.on("uncaughtException", (error) => {
    appendLog(logPath, `error:${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

module.exports = {
  appendLog,
  createLspServer,
};
