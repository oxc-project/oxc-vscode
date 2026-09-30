import { homedir } from "node:os";
import { env } from "node:process";
import { workspace } from "vscode";

/**
 * Substitutes the variables supported in user configured binary paths.
 *
 * Supported forms:
 * - `${userHome}`, standing for the home directory
 * - `${env:NAME}`, standing for the value of the environment variable `NAME`, or an empty string
 *   when it is unset
 *
 * Every other `${...}` form is left as it is, and so is `${userHome}` when the home directory
 * cannot be determined. It keeps its `$` character, which `validateSafeBinaryPath` rejects.
 */
export function substitutePathVariables(value: string): string {
  // the replacement is a function, so that a `$` in a substituted value is not a pattern
  return value.replaceAll(
    /\$\{(userHome|env:([^}]+))\}/g,
    (match, _variable: string, name: string | undefined) => {
      if (name === undefined) {
        return homeDirectory() ?? match;
      }
      // `${env:NAME}` is left as it is in an untrusted workspace
      return workspace.isTrusted ? (env[name] ?? "") : match;
    },
  );
}

/**
 * `os.homedir()` throws when there is no home directory, and returns `$HOME` even when it is empty.
 */
function homeDirectory(): string | undefined {
  try {
    return homedir() || undefined;
  } catch {
    return undefined;
  }
}
