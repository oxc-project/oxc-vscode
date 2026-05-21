import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "out_test/unit/**/*.spec.js",
  workspaceFolder: "tests/unit",
  launchArgs: ["--disable-updates"],
  mocha: {
    ui: "tdd",
    timeout: 20000,
  },
});
