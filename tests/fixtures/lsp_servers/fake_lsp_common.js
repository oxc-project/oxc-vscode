const fs = require("node:fs");
const path = require("node:path");

function appendLog(logPath, message) {
  if (!logPath) {
    return;
  }

  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${message}\n`);
}

module.exports = {
  appendLog,
};
