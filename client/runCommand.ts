/**
 * Shared runner for the short lived commands the extension executes, several of them on the
 * activation path of the single threaded extension host.
 *
 * `execFile` is not the base of this module because it does not forward `detached` to `spawn`,
 * which leaves its child in the process group of the extension host and out of reach of a group
 * kill.
 */

import { type ChildProcess, spawn } from "node:child_process";

/** Upper bound for the captured output, in bytes, the default `maxBuffer` of `spawnSync`. */
const MAX_OUTPUT_BYTES = 1024 * 1024;

export interface RunCommandOptions {
  /** Upper bound for the wait, in milliseconds. */
  timeoutMs: number;
  /**
   * Runs the command through a shell.
   *
   * A shell runs the command and its arguments unescaped, so only use it for commands which are
   * not user-controlled.
   */
  shell?: boolean;
  /** Environment of the command, the environment of the extension host when left out. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Kills a child process together with its process group, best effort.
 *
 * The group of a child which already exited is left alone: its pid is released and the group id
 * may belong to an unrelated process by now, so the grandchildren that child left behind survive.
 * On Windows the kill reaches the direct child only, Node cannot signal a process group there.
 *
 * @internal exported for testing, the Windows branch is out of reach of a behaviour test on POSIX
 */
export function killProcessGroup(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  try {
    if (process.platform === "win32") {
      child.kill("SIGKILL");
    } else {
      // the negative pid targets the process group, the grandchildren of the command included
      process.kill(-child.pid, "SIGKILL");
    }
  } catch {
    // a kill which fails leaves the process behind, the wait ends at the same moment
  }
}

/**
 * Runs a command and resolves with its stdout, or with `undefined`.
 *
 * The wait ends at `timeoutMs` whether or not the child has exited, and earlier on an output past
 * `MAX_OUTPUT_BYTES` or an error on the stdout pipe. A child still running then is killed with
 * its process group, a child which already exited keeps the output it produced. A command which
 * fails to start, exits with a non-zero status or produces no output resolves with `undefined`.
 *
 * The stdout is resolved as it was captured, a caller which needs a trimmed value trims it.
 */
export async function runCommand(
  command: string,
  args: readonly string[],
  { timeoutMs, shell = false, env }: RunCommandOptions,
): Promise<string | undefined> {
  let child: ChildProcess;
  try {
    child = spawn(command, args, {
      shell,
      env,
      // on POSIX `detached` calls `setsid`, the child runs in a session and process group of its
      // own which `killProcessGroup` targets as a whole
      detached: process.platform !== "win32",
      // stdin is ignored so the command cannot wait for input, stderr so a command writing a lot
      // of it cannot block on a pipe nothing reads
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return undefined;
  }

  return new Promise<string | undefined>((resolve) => {
    let stdout = "";
    let stdoutBytes = 0;
    let settled = false;
    let timeoutId: NodeJS.Timeout | undefined;

    const settle = (output: string | undefined): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      killProcessGroup(child);
      // a grandchild can hold the pipe open after the child exited, destroying the stream leaves
      // no open handle behind
      child.stdout?.destroy();
      resolve(output);
    };

    const settleWithCapturedOutput = (code: number | null): void => {
      settle(code === 0 && stdout ? stdout : undefined);
    };

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      // the decoded string is measured in bytes, so the bound holds for multi-byte output too
      stdoutBytes += Buffer.byteLength(chunk, "utf8");
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        settle(undefined);
      }
    });
    // an error on a stdio stream is not reported through the `error` event of the child process
    child.stdout?.on("error", () => settle(undefined));
    child.once("error", () => settle(undefined));
    // `close` fires once the child terminated and its stdout has been read to the end
    child.once("close", settleWithCapturedOutput);

    timeoutId = setTimeout(() => {
      settleWithCapturedOutput(child.exitCode);
    }, timeoutMs);
  });
}
