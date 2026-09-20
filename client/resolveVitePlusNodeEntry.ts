import { closeSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from "node:fs";
import * as path from "node:path";

const nodeShebangPattern = /^#!\s*(?:\S*\/node|\S*\/env\s+(?:-S\s+)?node)(?:\s|$)/;

function readShebang(file: string): string {
  const fd = openSync(file, "r");
  try {
    // A standalone native vp can be large; only read its header.
    const buffer = Buffer.alloc(256);
    const length = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.toString("utf8", 0, length).split(/\r?\n/, 1)[0];
  } finally {
    closeSync(fd);
  }
}

/** Resolve Node entry points without interpreting shell shims or native vp binaries as JS. */
export function resolveVitePlusNodeEntry(vpPath: string): string | undefined {
  try {
    const shebang = readShebang(vpPath);
    if (nodeShebangPattern.test(shebang)) {
      return vpPath;
    }

    const isCmd = path.extname(vpPath) === ".cmd";
    if (!isCmd && !/^#!.*(?:\/|\s)(?:sh|bash|dash|zsh|ksh)(?:\s|$)/.test(shebang)) {
      return undefined;
    }

    // Read the literal target used by npm/pnpm shims, including custom global directories.
    // Do not execute the shim or expand shell variables to locate the entry.
    const shim = readFileSync(vpPath, "utf8");
    const target = isCmd
      ? /"((?:%(?:~dp0|dp0%)[\\/]|[a-zA-Z]:[\\/]|\\\\)[^"\r\n]+)"[ \t]+%\*/.exec(shim)
      : /"\$basedir\/([^"\r\n]+)"[ \t]+"\$@"/.exec(shim);
    if (!target) {
      return undefined;
    }

    // pnpm shell shims can follow symlinks before computing their base directory.
    const shimPath = !isCmd && lstatSync(vpPath).isSymbolicLink() ? realpathSync(vpPath) : vpPath;
    const entryPath = isCmd
      ? target[1].replace(/^%(?:~dp0|dp0%)[\\/]/, "").replaceAll("\\", path.sep)
      : target[1];
    const nodeEntry = path.resolve(path.dirname(shimPath), entryPath);

    if (nodeShebangPattern.test(readShebang(nodeEntry))) {
      return nodeEntry;
    }
  } catch {
    // An absent or unreadable entry must leave the original executable intact.
  }
  return undefined;
}
