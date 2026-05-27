import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

let cachedEnv: Promise<Record<string, string | undefined>> | undefined;

/**
 * Get the shell environment variables by running a login shell and executing `env`.
 * This is necessary because the VSCode extension host process may not have the same environment variables as the user's shell,
 * which can lead to issues when running the language server that rely on certain environment variables.
 * e.g., PATH for starting the wrapper npm/pnpm node script like ` exec node  "$basedir/../oxlint/bin/oxlint" "$@"`.
 * It also helps to get the right global node_modules paths.
 *
 * On macOS/Linux, GUI-launched processes such as VS Code under Electron do not load `.bashrc` or `.zshrc`
 * the way an interactive shell does, so the language server can fail to start with "command not found: node".
 */
export async function getShellEnv(): Promise<Record<string, string | undefined>> {
  if (cachedEnv) {
    return cachedEnv;
  }

  // windows electron app does not have the problem of individual shell environment, as it inherits the environment from the parent process.
  if (process.platform === "win32") {
    cachedEnv = Promise.resolve({ ...process.env });
    return cachedEnv;
  }

  cachedEnv = getInteractiveShellEnv();
  return cachedEnv;
}

async function getInteractiveShellEnv(): Promise<Record<string, string | undefined>> {
  const shell = process.env.SHELL ?? "/bin/bash";

  try {
    // POSIX shells
    // Run the shell as a login shell to get the environment variables. The `-i` flag is for interactive shell, which is needed to load the shell configuration files.
    // The `-l` flag is for login shell, which is needed to load the environment variables defined in the shell configuration files.
    const { stdout } = await execFileAsync(
      shell,
      ["-ilc", 'echo -n "_ENV_DELIMITER_"; command env; echo -n "_ENV_DELIMITER_"; exit'],
      {
        env: {
          HOME: process.env.HOME,
        },
        timeout: 5000,
      },
    );

    const envsOutput = stdout.split("_ENV_DELIMITER_")[1] ?? "";
    if (!envsOutput) {
      // If the output is empty, return the current process.env as a fallback.
      return { ...process.env };
    }

    const env: Record<string, string | undefined> = {};
    for (const entry of envsOutput.split("\n")) {
      if (!entry) continue;

      const i = entry.indexOf("=");

      if (i === -1) continue;

      env[entry.slice(0, i)] = entry.slice(i + 1);
    }

    return env;
  } catch {
    // If there is an error (e.g., timeout, shell not found, etc.), return the current process.env as a fallback.
    return { ...process.env };
  }
}
