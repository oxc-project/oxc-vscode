import { strictEqual } from "node:assert";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { runInNewContext } from "node:vm";

// Exercise the compiled resolver with Windows path semantics on every CI platform.
// These tests do not claim to exercise Windows process creation.
suite("Windows Vite+ shim targets", () => {
  const filename = path.join(__dirname, "../client/resolveVitePlusNodeEntry.js");
  const source = readFileSync(filename, "utf8");
  const realRequire = createRequire(filename);
  const shimPath = "C:\\global bin\\vp.cmd";

  for (const target of [
    "C:\\global store\\5\\node_modules\\vite-plus\\bin\\vp",
    "D:\\global store\\5\\node_modules\\vite-plus\\bin\\vp",
    "\\\\server\\share\\vite-plus\\bin\\vp",
  ]) {
    test(`resolves an absolute target: ${target}`, () => {
      const files = new Map([
        [shimPath, `@echo off\r\nnode "${target}" %*\r\n`],
        [target, "#!/usr/bin/env node\n"],
      ]);
      function read(file: string): string {
        const contents = files.get(file);
        if (contents === undefined) throw new Error(`ENOENT: ${file}`);
        return contents;
      }
      const exports: typeof import("../../client/resolveVitePlusNodeEntry") = runInNewContext(
        `${source}\nexports;`,
        {
          Buffer,
          exports: {},
          require(id: string) {
            if (id === "node:path") return path.win32;
            if (id === "node:fs") {
              return {
                openSync: (file: string) => file,
                closeSync() {},
                readFileSync: read,
                realpathSync: (file: string) => file,
                readSync(file: string, buffer: Buffer, offset: number, length: number) {
                  return buffer.write(read(file).slice(0, length), offset, length, "utf8");
                },
              };
            }
            return realRequire(id);
          },
        },
      );
      strictEqual(exports.resolveVitePlusNodeEntry(shimPath), target);
    });
  }
});
