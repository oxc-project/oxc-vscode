import { deepStrictEqual, ok, strictEqual } from "assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { ChildProcess } from "node:child_process";
import { killProcessGroup, runCommand } from "../../client/runCommand";

/** The `node:child_process` exports `runCommand` calls `spawn` through, patchable per test. */
const childProcess: {
  spawn: typeof import("node:child_process").spawn;
} = require("node:child_process");

/** Bound used by most tests, short enough to keep the suite fast and long enough to measure. */
const boundMs = 1000;

/** Bound for the waits which end on their own, out of reach of a loaded runner. */
const unreachableBoundMs = 5000;

function createMockCommand(dir: string, name: string, scriptBody: string): string {
  const commandPath = path.join(dir, name);
  writeFileSync(commandPath, `#!/bin/sh\n${scriptBody}\n`, { mode: 0o755 });
  return commandPath;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(pidFile: string): number {
  const pid = Number(readFileSync(pidFile, "utf8"));
  ok(Number.isInteger(pid) && pid > 0, `expected a recorded pid, got ${pid}`);
  return pid;
}

/** Resolves once the process disappeared, or after `timeoutMs`. */
function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve) => {
    const interval = setInterval(() => {
      if (!isProcessAlive(pid) || Date.now() > deadline) {
        clearInterval(interval);
        resolve();
      }
    }, 20);
  });
}

/** Disposes of a process a test is responsible for, whether or not it is still running. */
async function killProcess(pid: number): Promise<void> {
  if (!isProcessAlive(pid)) {
    return;
  }
  process.kill(pid, "SIGKILL");
  await waitForProcessExit(pid, 2000);
}

/** Disposes of the process a mock command recorded, whether or not the test read its pid. */
async function killRecordedProcess(pidFile: string): Promise<void> {
  let pid: number;
  try {
    pid = Number(readFileSync(pidFile, "utf8"));
  } catch {
    return;
  }

  if (Number.isInteger(pid) && pid > 0) {
    await killProcess(pid);
  }
}

/** Records every `kill` a child received, the object holds only what `killProcessGroup` reads. */
function fakeChild(state: { pid?: number; exitCode?: number | null; signalCode?: string | null }): {
  child: ChildProcess;
  childKills: (NodeJS.Signals | number | undefined)[];
} {
  const childKills: (NodeJS.Signals | number | undefined)[] = [];
  const child = {
    pid: 4321,
    exitCode: null,
    signalCode: null,
    ...state,
    kill: (signal?: NodeJS.Signals | number) => {
      childKills.push(signal);
      return true;
    },
  } as unknown as ChildProcess;

  return { child, childKills };
}

/**
 * Runs `killProcessGroup` as if the extension host ran on `platform` and records the group kills.
 *
 * `process.kill` is replaced rather than called, so the assertion covers the Windows branch on a
 * machine which has no process group to signal.
 */
function killProcessGroupOn(
  platform: NodeJS.Platform,
  child: ChildProcess,
): [number, NodeJS.Signals | number | undefined][] {
  const groupKills: [number, NodeJS.Signals | number | undefined][] = [];
  const originalPlatform = process.platform;
  const originalKill = process.kill.bind(process);

  Object.defineProperty(process, "platform", { value: platform });
  process.kill = ((pid: number, signal?: NodeJS.Signals | number) => {
    groupKills.push([pid, signal]);
    return true;
  }) as typeof process.kill;

  try {
    killProcessGroup(child);
  } finally {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    process.kill = originalKill;
  }

  return groupKills;
}

/** Asserts the wait ended at the bound, neither before it nor a multiple of it later. */
function assertBounded(elapsed: number, timeoutMs: number): void {
  ok(
    elapsed >= timeoutMs - 50 && elapsed < timeoutMs + 600,
    `expected the wait to end at the ${timeoutMs}ms bound, took ${elapsed}ms`,
  );
}

suite("runCommand", () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "test-run-command-"));
  });

  teardown(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("rule 1: the command runs without blocking the event loop", async function () {
    if (process.platform === "win32") {
      this.skip();
    }

    const command = createMockCommand(tmpDir, "slow", 'sleep 1; printf "done"');

    let ticks = 0;
    const interval = setInterval(() => {
      ticks += 1;
    }, 20);

    try {
      strictEqual(await runCommand(command, [], { timeoutMs: 5000 }), "done");
    } finally {
      clearInterval(interval);
    }

    ok(ticks > 10, `expected the event loop to keep running, got ${ticks} ticks`);
  });

  test("rule 2: the wait ends at the timeout of the caller", async function () {
    if (process.platform === "win32") {
      this.skip();
    }

    // `exec` keeps the command a single process, which the kill at the bound disposes of
    const command = createMockCommand(tmpDir, "never-exits", "exec sleep 60");

    // two bounds, so a wait ending at a fixed duration instead of the one passed fails here
    const measure = async (timeoutMs: number): Promise<void> => {
      const start = Date.now();
      const result = await runCommand(command, [], { timeoutMs });
      const elapsed = Date.now() - start;

      strictEqual(result, undefined);
      assertBounded(elapsed, timeoutMs);
    };

    await measure(400);
    await measure(1200);
  });

  test("rule 3: the output of a command which exited is used although a grandchild holds the pipe", async function () {
    if (process.platform === "win32") {
      this.skip();
    }

    const grandchildPidFile = path.join(tmpDir, "grandchild.pid");
    // the backgrounded `sleep` inherits stdout and outlives the command itself
    const command = createMockCommand(
      tmpDir,
      "leaves-grandchild",
      `sleep 60 &\nprintf "%s" "$!" > "${grandchildPidFile}"\nprintf "captured"`,
    );

    const start = Date.now();
    const result = await runCommand(command, [], { timeoutMs: boundMs });
    const elapsed = Date.now() - start;
    try {
      const grandchildPid = readPid(grandchildPidFile);

      strictEqual(result, "captured");
      assertBounded(elapsed, boundMs);
      // the group of a command which already exited is left alone
      strictEqual(isProcessAlive(grandchildPid), true);
    } finally {
      await killRecordedProcess(grandchildPidFile);
    }
  });

  test("rule 4: a command still running at the bound is killed with its process group", async function () {
    if (process.platform === "win32") {
      this.skip();
    }

    const commandPidFile = path.join(tmpDir, "command.pid");
    const grandchildPidFile = path.join(tmpDir, "grandchild.pid");
    // only a kill targeting the group reaches the backgrounded `sleep`
    const command = createMockCommand(
      tmpDir,
      "with-grandchild",
      `printf "%s" "$$" > "${commandPidFile}"\nsleep 60 &\nprintf "%s" "$!" > "${grandchildPidFile}"\nsleep 60`,
    );

    const result = await runCommand(command, [], { timeoutMs: boundMs });
    try {
      const commandPid = readPid(commandPidFile);
      const grandchildPid = readPid(grandchildPidFile);

      strictEqual(result, undefined);
      await waitForProcessExit(commandPid, 2000);
      await waitForProcessExit(grandchildPid, 2000);
      strictEqual(isProcessAlive(commandPid), false);
      strictEqual(isProcessAlive(grandchildPid), false);
    } finally {
      await killRecordedProcess(commandPidFile);
      await killRecordedProcess(grandchildPidFile);
    }
  });

  test("rule 4: a failing kill changes neither the result nor the waiting time", async function () {
    if (process.platform === "win32") {
      this.skip();
    }

    const pidFile = path.join(tmpDir, "survivor.pid");
    const command = createMockCommand(
      tmpDir,
      "survives-the-kill",
      `printf "%s" "$$" > "${pidFile}"; exec sleep 60`,
    );

    const originalKill = process.kill.bind(process);
    process.kill = ((pid: number, signal?: number | string) => {
      if (pid < 0) {
        throw new Error("kill of the process group failed");
      }
      return originalKill(pid, signal);
    }) as typeof process.kill;

    const start = Date.now();
    let result: string | undefined;
    try {
      result = await runCommand(command, [], { timeoutMs: boundMs });
    } finally {
      process.kill = originalKill;
    }
    const elapsed = Date.now() - start;
    try {
      const survivingPid = readPid(pidFile);

      strictEqual(result, undefined);
      assertBounded(elapsed, boundMs);
      strictEqual(isProcessAlive(survivingPid), true);
    } finally {
      await killRecordedProcess(pidFile);
    }
  });

  test("rule 4: the kill targets the process group of the child off Windows", () => {
    const { child, childKills } = fakeChild({ pid: 4321 });

    const groupKills = killProcessGroupOn("linux", child);

    deepStrictEqual(groupKills, [[-4321, "SIGKILL"]]);
    deepStrictEqual(childKills, []);
  });

  test("rule 4: the kill targets the child alone on Windows", () => {
    const { child, childKills } = fakeChild({ pid: 4321 });

    const groupKills = killProcessGroupOn("win32", child);

    deepStrictEqual(childKills, ["SIGKILL"]);
    deepStrictEqual(groupKills, []);
  });

  test("rule 4: a child which is no longer running is killed on neither platform", () => {
    const gone = [
      { pid: undefined },
      { pid: 4321, exitCode: 0 },
      { pid: 4321, signalCode: "SIGTERM" },
    ];

    for (const platform of ["linux", "win32"] as NodeJS.Platform[]) {
      for (const state of gone) {
        const { child, childKills } = fakeChild(state);

        const groupKills = killProcessGroupOn(platform, child);

        deepStrictEqual(groupKills, [], `${platform}: ${JSON.stringify(state)}`);
        deepStrictEqual(childKills, [], `${platform}: ${JSON.stringify(state)}`);
      }
    }
  });

  test("rule 5: an output past the bound yields no value and kills the command", async function () {
    if (process.platform === "win32") {
      this.skip();
    }

    const pidFile = path.join(tmpDir, "flooding.pid");
    // the command floods stdout, then waits without writing, so nothing but the kill ends it
    const command = createMockCommand(
      tmpDir,
      "floods-stdout",
      `printf "%s" "$$" > "${pidFile}"; head -c 2000000 /dev/zero | tr "\\000" "a"; exec sleep 60`,
    );

    const start = Date.now();
    const result = await runCommand(command, [], { timeoutMs: unreachableBoundMs });
    const elapsed = Date.now() - start;

    try {
      const pid = readPid(pidFile);

      strictEqual(result, undefined);
      ok(
        elapsed < unreachableBoundMs,
        `expected the output bound to end the wait, took ${elapsed}ms`,
      );
      await waitForProcessExit(pid, 2000);
      strictEqual(isProcessAlive(pid), false);
    } finally {
      await killRecordedProcess(pidFile);
    }
  });

  test("rule 6: an error on the stdout pipe yields no value, kills the command and raises no uncaught exception", async function () {
    if (process.platform === "win32") {
      this.skip();
    }

    const command = createMockCommand(tmpDir, "long-running", "exec sleep 60");

    const originalSpawn = childProcess.spawn;
    let spawnedPid: number | undefined;
    // the stdout pipe fails right after the command was started
    childProcess.spawn = ((...args: Parameters<typeof childProcess.spawn>) => {
      const child = originalSpawn(...args);
      spawnedPid = child.pid;
      setImmediate(() => child.stdout?.emit("error", new Error("stdout pipe failed")));
      return child;
    }) as typeof childProcess.spawn;

    const uncaught: unknown[] = [];
    const collectUncaught = (error: unknown): void => {
      uncaught.push(error);
    };
    process.on("uncaughtException", collectUncaught);

    const start = Date.now();
    let result: string | undefined;
    try {
      result = await runCommand(command, [], { timeoutMs: unreachableBoundMs });
    } finally {
      childProcess.spawn = originalSpawn;
      process.off("uncaughtException", collectUncaught);
    }
    const elapsed = Date.now() - start;

    try {
      ok(spawnedPid !== undefined, "expected the command to have been started");
      strictEqual(result, undefined);
      strictEqual(uncaught.length, 0, `expected no uncaught exception, got ${uncaught.length}`);
      ok(
        elapsed < unreachableBoundMs,
        `expected the pipe error to end the wait, took ${elapsed}ms`,
      );
      await waitForProcessExit(spawnedPid, 2000);
      strictEqual(isProcessAlive(spawnedPid), false);
    } finally {
      if (spawnedPid !== undefined) {
        await killProcess(spawnedPid);
      }
    }
  });

  test("rule 7: a command which exits with a non-zero status yields no value", async function () {
    if (process.platform === "win32") {
      this.skip();
    }

    const command = createMockCommand(tmpDir, "fails", 'printf "value"; exit 1');

    strictEqual(await runCommand(command, [], { timeoutMs: boundMs }), undefined);
  });

  test("rule 7: a command which produces no output yields no value", async function () {
    if (process.platform === "win32") {
      this.skip();
    }

    const command = createMockCommand(tmpDir, "silent", "exit 0");

    strictEqual(await runCommand(command, [], { timeoutMs: boundMs }), undefined);
  });

  test("rule 7: a command which fails to start yields no value", async () => {
    const command = path.join(tmpDir, "does-not-exist");

    const start = Date.now();
    const result = await runCommand(command, [], { timeoutMs: boundMs });
    const elapsed = Date.now() - start;

    strictEqual(result, undefined);
    ok(elapsed < boundMs, `expected the start failure to end the wait, took ${elapsed}ms`);
  });

  test("rule 8: the arguments are passed to the command and its stdout is not trimmed", async function () {
    if (process.platform === "win32") {
      this.skip();
    }

    const command = createMockCommand(tmpDir, "echo-argument", 'printf "  %s\\n" "$1"');

    strictEqual(await runCommand(command, ["value"], { timeoutMs: boundMs }), "  value\n");
  });

  test("rule 8: the command runs with the environment of the caller", async function () {
    if (process.platform === "win32") {
      this.skip();
    }

    const command = createMockCommand(tmpDir, "echo-env", 'printf "%s" "$RUN_COMMAND_TEST_VALUE"');

    const result = await runCommand(command, [], {
      timeoutMs: boundMs,
      env: { RUN_COMMAND_TEST_VALUE: "from-the-caller" },
    });

    strictEqual(result, "from-the-caller");
    strictEqual(process.env.RUN_COMMAND_TEST_VALUE, undefined);
  });

  test("rule 8: the command runs through a shell only when the caller asks for it", async function () {
    if (process.platform === "win32") {
      this.skip();
    }

    // two commands joined by a semicolon are not the name of an executable file
    const commandText = 'printf "one"; printf "two"';

    strictEqual(await runCommand(commandText, [], { timeoutMs: boundMs, shell: true }), "onetwo");
    strictEqual(await runCommand(commandText, [], { timeoutMs: boundMs }), undefined);
  });
});
