import { strictEqual } from "assert";
import { runExecutable } from "../../client/tools/lsp_helper";

suite("runExecutable", () => {
  const originalPlatform = process.platform;
  const originalEnv = process.env;

  teardown(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    process.env = originalEnv;
  });

  test("should create Node.js executable for files", () => {
    const result = runExecutable("/path/to/server");

    strictEqual(result.command, "node");
    strictEqual(result.args?.[0], "/path/to/server");
    strictEqual(result.args?.[1], "--lsp");
  });

  test("should prepend nodePath to PATH", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    process.env.PATH = "/usr/bin:/bin";

    const result = runExecutable("/path/to/server", "/custom/node/path");

    strictEqual(result.options?.env?.PATH, "/custom/node/path:/usr/bin:/bin");
  });
});
