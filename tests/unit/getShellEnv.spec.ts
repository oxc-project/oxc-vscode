import { strictEqual } from "assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { clearShellEnvCache, getShellEnv } from "../../client/getShellEnv";

/**
 * Restores `process.env` in place from a snapshot, without replacing the object.
 *
 * Assigning `process.env` leaves a plain object behind, which `os.homedir` and the other readers of
 * the real environment no longer see, so the later suites of the run read stale values.
 */
function restoreEnv(snapshot: NodeJS.ProcessEnv): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in snapshot)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(snapshot)) {
    if (value !== undefined && process.env[key] !== value) {
      process.env[key] = value;
    }
  }
}

function createMockShellScript(dir: string, name: string, scriptBody: string): string {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, `#!/bin/sh\n${scriptBody}\n`, { mode: 0o755 });
  return filePath;
}

suite("getShellEnv", () => {
  let tempDir: string;
  let originalEnv: NodeJS.ProcessEnv;
  const originalPlatform = process.platform;

  setup(() => {
    // a copy, not `process.env` itself: the reference reads back the values the test assigns
    originalEnv = { ...process.env };
    tempDir = mkdtempSync(path.join(tmpdir(), "get-shell-env-test-"));
    clearShellEnvCache();
  });

  teardown(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    restoreEnv(originalEnv);
    clearShellEnvCache();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("returns process.env directly on win32", async () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    process.env.GET_SHELL_ENV_TEST_KEY = "windows-fast-path";
    process.env.SHELL = path.join(tempDir, "does-not-matter-on-win32");

    const env = await getShellEnv();

    strictEqual(env.GET_SHELL_ENV_TEST_KEY, "windows-fast-path");
  });

  test("parses shell output into env object", async function () {
    if (process.platform === "win32") {
      this.skip();
    }

    const shellPath = createMockShellScript(
      tempDir,
      "mock-shell-success.sh",
      'printf "_ENV_DELIMITER_PATH=/mock/bin\\nFOO=bar\\nEQ=a=b\\n_ENV_DELIMITER_"',
    );

    process.env.SHELL = shellPath;

    const env = await getShellEnv();

    strictEqual(env.PATH, "/mock/bin");
    strictEqual(env.FOO, "bar");
    strictEqual(env.EQ, "a=b");
  });

  test("runs the shell with a restricted environment", async function () {
    if (process.platform === "win32") {
      this.skip();
    }

    process.env.GET_SHELL_ENV_TEST_KEY = "must-not-be-inherited";

    // the mock shell reports what it received instead of its own environment
    const shellPath = createMockShellScript(
      tempDir,
      "mock-shell-environment.sh",
      'printf "_ENV_DELIMITER_RESOLVING=%s\\nSHELL_HOME=%s\\nINHERITED=%s\\n_ENV_DELIMITER_" "$VSCODE_RESOLVING_ENVIRONMENT" "$HOME" "$GET_SHELL_ENV_TEST_KEY"',
    );

    process.env.SHELL = shellPath;

    const env = await getShellEnv();

    strictEqual(env.RESOLVING, "1");
    strictEqual(env.SHELL_HOME, process.env.HOME);
    strictEqual(env.INHERITED, "");
  });

  test("falls back to process.env when the shell fails to start", async () => {
    process.env.GET_SHELL_ENV_TEST_KEY = "reject-fallback";
    process.env.SHELL = path.join(tempDir, "does-not-exist-shell");

    const env = await getShellEnv();

    strictEqual(env.GET_SHELL_ENV_TEST_KEY, "reject-fallback");
  });

  test("falls back to process.env when the shell output carries no delimiter", async function () {
    if (process.platform === "win32") {
      this.skip();
    }

    process.env.GET_SHELL_ENV_TEST_KEY = "no-delimiter-fallback";

    const shellPath = createMockShellScript(
      tempDir,
      "mock-shell-no-delimiter.sh",
      'printf "PATH=/mock/bin\nFOO=bar\n"',
    );

    process.env.SHELL = shellPath;

    const env = await getShellEnv();

    strictEqual(env.GET_SHELL_ENV_TEST_KEY, "no-delimiter-fallback");
    strictEqual(env.FOO, undefined);
  });
});
