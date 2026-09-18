import { strictEqual } from "assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { mockProcessEnv, mockProcessPlatform } from "../processMocks";

type GetShellEnvModule = {
  getShellEnv: () => Promise<Record<string, string | undefined>>;
};

let moduleId = 0;

async function loadFreshGetShellEnvModule(): Promise<GetShellEnvModule> {
  // append a query parameter to force a fresh import of the module to reset the cachedEnv variable
  return import(`../../client/getShellEnv.ts?testModule=${moduleId++}`);
}

function createMockShellScript(dir: string, name: string, scriptBody: string): string {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, `#!/bin/sh\n${scriptBody}\n`, { mode: 0o755 });
  return filePath;
}

suite("getShellEnv", () => {
  let tempDir: string;
  const setPlatform = mockProcessPlatform();
  mockProcessEnv();

  setup(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "get-shell-env-test-"));
  });

  teardown(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("copies process.env on win32", async () => {
    setPlatform("win32");
    process.env.GET_SHELL_ENV_TEST_KEY = "windows-fast-path";
    process.env.SHELL = path.join(tempDir, "does-not-matter-on-win32");

    const { getShellEnv } = await loadFreshGetShellEnvModule();
    const env = await getShellEnv();

    strictEqual(env.GET_SHELL_ENV_TEST_KEY, "windows-fast-path");
  });

  for (const key of ["Path", "PATH", "pAtH"]) {
    test(`normalizes ${key} in the Windows environment copy`, async () => {
      setPlatform("win32");
      process.env = { [key]: tempDir, KEEP_ME: "unchanged" };
      const { getShellEnv } = await loadFreshGetShellEnvModule();
      const env = await getShellEnv();

      strictEqual(env.PATH, tempDir);
      strictEqual(env.KEEP_ME, "unchanged");
      strictEqual(Object.keys(env).filter((name) => name.toUpperCase() === "PATH").length, 1);
      strictEqual(process.env[key], tempDir, "the original environment must not change");
      strictEqual(Object.keys(process.env)[0], key);
    });
  }

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

    const { getShellEnv } = await loadFreshGetShellEnvModule();
    const env = await getShellEnv();

    strictEqual(env.PATH, "/mock/bin");
    strictEqual(env.FOO, "bar");
    strictEqual(env.EQ, "a=b");
  });

  test("falls back to process.env when shell output is empty", async function () {
    if (process.platform === "win32") {
      this.skip();
    }

    process.env.GET_SHELL_ENV_TEST_KEY = "fallback-works";
    const shellPath = createMockShellScript(tempDir, "mock-shell-empty.sh", "# no output");

    process.env.SHELL = shellPath;

    const { getShellEnv } = await loadFreshGetShellEnvModule();
    const env = await getShellEnv();

    strictEqual(env.GET_SHELL_ENV_TEST_KEY, "fallback-works");
  });

  test("falls back to process.env when shell executable is invalid", async () => {
    process.env.GET_SHELL_ENV_TEST_KEY = "reject-fallback";
    process.env.SHELL = path.join(tempDir, "does-not-exist-shell");

    const { getShellEnv } = await loadFreshGetShellEnvModule();
    const env = await getShellEnv();

    strictEqual(env.GET_SHELL_ENV_TEST_KEY, "reject-fallback");
  });

  test("falls back to process.env after timeout", async function () {
    if (process.platform === "win32") {
      this.skip();
    }

    process.env.GET_SHELL_ENV_TEST_KEY = "timeout-fallback";

    const shellPath = createMockShellScript(
      tempDir,
      "mock-shell-timeout.sh",
      'sleep 6; printf "_ENV_DELIMITER_TIMEOUT_SHOULD_NOT_APPEAR=1\\n_ENV_DELIMITER_"',
    );

    process.env.SHELL = shellPath;

    const { getShellEnv } = await loadFreshGetShellEnvModule();
    const env = await getShellEnv();

    strictEqual(env.GET_SHELL_ENV_TEST_KEY, "timeout-fallback");
    strictEqual(env.TIMEOUT_SHOULD_NOT_APPEAR, undefined);
  });
});
