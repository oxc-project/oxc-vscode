import { deepStrictEqual, strictEqual } from "assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { mock } from "node:test";
import { runExecutable } from "../../client/tools/lsp_helper";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { mockProcessEnv, mockProcessPlatform } from "../processMocks";

// Mock the shared CommonJS exports used by the compiled test modules.
const shellEnv: typeof import("../../client/getShellEnv") = require(
  path.join(__dirname, "../client/getShellEnv.js"),
);

suite("runExecutable", () => {
  const originalPlatform = process.platform;
  const setPlatform = mockProcessPlatform();
  mockProcessEnv();
  let tempDir: string;

  setup(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "vp-runtime-"));
    mock.method(shellEnv, "getShellEnv", async () => ({ PATH: process.env.PATH }));
  });

  teardown(() => {
    mock.restoreAll();
    rmSync(tempDir, { recursive: true, force: true });
  });

  for (const command of ["lint", "fmt"] as const) {
    test(`runs vp ${command} --lsp in the project directory`, async () => {
      const result = await runExecutable({
        path: "/project/node_modules/.bin/vp",
        loader: "native",
        vitePlus: command,
        cwd: "/project",
      });
      deepStrictEqual(result.args, [command, "--lsp"]);
      strictEqual(result.options?.cwd, "/project");
    });

    test(`runs the vp JavaScript entry point with ${command} --lsp and the configured runtime`, async () => {
      const result = await runExecutable(
        {
          path: "/project/node_modules/vite-plus/bin/vp",
          loader: "node",
          vitePlus: command,
          cwd: "/project",
        },
        true,
      );
      strictEqual(result.command, process.execPath);
      deepStrictEqual(result.args, ["/project/node_modules/vite-plus/bin/vp", command, "--lsp"]);
      strictEqual(result.options?.cwd, "/project");
      strictEqual(result.options?.env?.ELECTRON_RUN_AS_NODE, "1");
    });
  }

  for (const shimType of [
    "npm",
    "pnpm",
    "cmd",
    "global-cmd",
    "global-pnpm",
    "global-pnpm-symlink",
    "global-pnpm-cmd",
  ] as const) {
    for (const command of ["lint", "fmt"] as const) {
      test(`runs ${shimType} vp ${command} with bundled Node and no system Node`, async function () {
        if ((shimType === "npm" || shimType.endsWith("symlink")) && originalPlatform === "win32") {
          this.skip();
        }
        const isGlobalPnpm = shimType.startsWith("global-pnpm");
        const isCmd = shimType.endsWith("cmd");
        const modulesDir = isGlobalPnpm
          ? path.join(tempDir, "custom global store", "5", "node_modules")
          : path.join(tempDir, "node_modules");
        const nodeEntry = path.join(modulesDir, "vite-plus", "bin", "vp");
        let binDir = path.join(tempDir, "node_modules", ".bin");
        if (isGlobalPnpm) {
          binDir = path.join(tempDir, "global bin");
        } else if (shimType === "global-cmd") {
          binDir = tempDir;
        }
        let shim = path.join(binDir, isCmd ? "vp.cmd" : "vp");
        mkdirSync(path.dirname(nodeEntry), { recursive: true });
        mkdirSync(path.dirname(shim), { recursive: true });
        writeFileSync(
          path.join(path.dirname(nodeEntry), "child.cjs"),
          "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n",
        );
        writeFileSync(
          nodeEntry,
          `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const script = require("node:path").join(__dirname, "child.cjs");
const child = spawnSync(process.execPath, [script, ...args], {
  encoding: "utf8",
});
if (child.error) throw child.error;
process.stdout.write(child.stdout);
process.stderr.write(child.stderr);
process.exit(child.status ?? 1);
`,
        );
        if (shimType === "npm") {
          symlinkSync(nodeEntry, shim);
        } else {
          const relativeEntry = path.relative(binDir, nodeEntry);
          // pnpm shims can contain long NODE_PATH setup before the launch command.
          const padding = isGlobalPnpm ? " ".repeat(512) : "";
          const script = isCmd
            ? `@SETLOCAL\r\n@REM ${padding}\r\nnode "%~dp0\\${relativeEntry.replaceAll(path.sep, "\\")}" %*\r\n`
            : `#!/bin/sh\nbasedir=$(dirname "$0")\n# ${padding}\nexec node "$basedir/${relativeEntry.replaceAll(path.sep, "/")}" "$@"\n`;
          writeFileSync(shim, script);
        }
        if (isGlobalPnpm) {
          // The recorded target must win over an unrelated adjacent installation.
          const adjacentEntry = path.join(binDir, "node_modules", "vite-plus", "bin", "vp");
          mkdirSync(path.dirname(adjacentEntry), { recursive: true });
          writeFileSync(adjacentEntry, "#!/usr/bin/env node\nthrow new Error('wrong entry');\n");
          if (shimType === "global-pnpm-symlink") {
            const alias = path.join(tempDir, "linked bin", "nested", "vp");
            mkdirSync(path.dirname(alias), { recursive: true });
            symlinkSync(shim, alias);
            shim = alias;
          }
        }
        process.env.PATH = path.join(tempDir, "no-system-node");

        const result = await runExecutable(
          { path: shim, loader: "native", vitePlus: command, cwd: tempDir },
          true,
        );
        strictEqual(result.command, process.execPath);
        let expectedEntry = nodeEntry;
        if (shimType === "npm") expectedEntry = shim;
        if (shimType === "global-pnpm-symlink") expectedEntry = realpathSync(nodeEntry);
        deepStrictEqual(result.args, [expectedEntry, command, "--lsp"]);
        strictEqual(result.options?.env?.ELECTRON_RUN_AS_NODE, "1");
        // vp must reuse process.execPath for its subprocess, without PATH shims.
        const child = spawnSync(result.command, result.args, {
          ...result.options,
          encoding: "utf8",
          timeout: 5000,
        });
        strictEqual(child.status, 0, child.stderr || child.error?.message);
        deepStrictEqual(JSON.parse(child.stdout), [command, "--lsp"]);
      });
    }
  }

  test("keeps an unrecognized shell wrapper despite an adjacent Vite+ installation", async function () {
    if (originalPlatform === "win32") this.skip();
    const shim = path.join(tempDir, "node_modules", ".bin", "vp");
    const adjacentEntry = path.join(tempDir, "node_modules", "vite-plus", "bin", "vp");
    mkdirSync(path.dirname(shim), { recursive: true });
    mkdirSync(path.dirname(adjacentEntry), { recursive: true });
    writeFileSync(shim, '#!/bin/sh\nprintf "%s\\n" "custom wrapper" "$@"\n', { mode: 0o755 });
    writeFileSync(adjacentEntry, "#!/usr/bin/env node\nthrow new Error('wrong entry');\n");
    process.env.PATH = path.join(tempDir, "no-system-node");

    const result = await runExecutable(
      { path: shim, loader: "native", vitePlus: "lint", cwd: tempDir },
      true,
    );
    strictEqual(result.command, shim);
    deepStrictEqual(result.args, ["lint", "--lsp"]);
    const child = spawnSync(result.command, result.args, {
      ...result.options,
      encoding: "utf8",
      timeout: 5000,
    });
    strictEqual(child.status, 0, child.stderr || child.error?.message);
    strictEqual(child.stdout, "custom wrapper\nlint\n--lsp\n");
  });

  test("keeps a global shim when its recorded target is not a Node entry", async () => {
    const shim = path.join(tempDir, "vp.cmd");
    writeFileSync(shim, '@echo off\r\n"%~dp0\\native-vp" %*\r\n');
    writeFileSync(path.join(tempDir, "native-vp"), Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
    const adjacentEntry = path.join(tempDir, "node_modules", "vite-plus", "bin", "vp");
    mkdirSync(path.dirname(adjacentEntry), { recursive: true });
    writeFileSync(adjacentEntry, "#!/usr/bin/env node\n");

    const result = await runExecutable({ path: shim, loader: "native", vitePlus: "lint" }, true);
    strictEqual(result.command, process.platform === "win32" ? `"${shim}"` : shim);
    deepStrictEqual(result.args, ["lint", "--lsp"]);
  });

  test("keeps a standalone native vp executable with useExecPath", async () => {
    const vpPath = path.join(tempDir, "node_modules", ".bin", "vp");
    const nodeEntry = path.join(tempDir, "node_modules", "vite-plus", "bin", "vp");
    mkdirSync(path.dirname(vpPath), { recursive: true });
    mkdirSync(path.dirname(nodeEntry), { recursive: true });
    writeFileSync(vpPath, Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
    writeFileSync(nodeEntry, "#!/usr/bin/env node\n");
    const result = await runExecutable({ path: vpPath, loader: "native", vitePlus: "lint" }, true);
    strictEqual(result.command, process.platform === "win32" ? `"${vpPath}"` : vpPath);
    deepStrictEqual(result.args, ["lint", "--lsp"]);
  });

  test("quotes Windows vp.cmd paths and passes the subcommand through the shell", async () => {
    setPlatform("win32");
    const result = await runExecutable({
      path: "C:\\My Project\\node_modules\\.bin\\vp.cmd",
      loader: "native",
      vitePlus: "fmt",
    });
    strictEqual(result.command, '"C:\\My Project\\node_modules\\.bin\\vp.cmd"');
    strictEqual(result.options?.shell, true);
    deepStrictEqual(result.args, ["fmt", "--lsp"]);
  });

  test("should create Node.js executable for .js files", async () => {
    const result = await runExecutable({
      path: "/path/to/server.js",
      loader: "node",
    });

    strictEqual(result.command, "node");
    strictEqual(result.args?.[0], "/path/to/server.js");
    strictEqual(result.args?.[1], "--lsp");
  });

  test("should create Node.js executable for .cjs files", async () => {
    const result = await runExecutable({
      path: "/path/to/server.cjs",
      loader: "node",
    });

    strictEqual(result.command, "node");
    strictEqual(result.args?.[0], "/path/to/server.cjs");
    strictEqual(result.args?.[1], "--lsp");
  });

  test("should create Node.js executable for .mjs files", async () => {
    const result = await runExecutable({
      path: "/path/to/server.mjs",
      loader: "node",
    });

    strictEqual(result.command, "node");
    strictEqual(result.args?.[0], "/path/to/server.mjs");
    strictEqual(result.args?.[1], "--lsp");
  });

  test("should create binary executable for non-Node files", async () => {
    const result = await runExecutable({
      path: "/path/to/oxc-language-server",
      loader: "native",
    });

    let expectedCommand = "/path/to/oxc-language-server";
    if (process.platform === "win32") {
      expectedCommand = `"${expectedCommand}"`;
    }

    strictEqual(result.command, expectedCommand);
    strictEqual(result.args?.[0], "--lsp");
    strictEqual(result.options?.shell, process.platform === "win32");
  });

  test("should use shell on Windows for binary executables", async () => {
    setPlatform("win32");

    const result = await runExecutable({
      path: "C:\\Path With Spaces\\oxc-language-server",
      loader: "native",
    });

    strictEqual(result.options?.shell, true);
  });

  test("should prepend nodePath to PATH", async () => {
    setPlatform("linux");
    process.env.PATH = "/usr/bin:/bin";

    const result = await runExecutable(
      {
        path: "/path/to/server.js",
        loader: "node",
      },
      false,
      "/custom/node/bin/node",
    );

    strictEqual(result.command, "/custom/node/bin/node");
    strictEqual(result.options?.env?.PATH?.includes(`/custom/node/bin${path.delimiter}`), true);
  });

  test("should set path in quotes on Windows for binary executables", async () => {
    setPlatform("win32");

    const result = await runExecutable({
      path: "C:\\Path With Spaces\\oxc-language-server",
      loader: "native",
    });

    strictEqual(result.command, '"C:\\Path With Spaces\\oxc-language-server"');
  });

  test("should use the provided node path for Node.js executables", async () => {
    const result = await runExecutable(
      {
        path: "/path/to/server.js",
        loader: "node",
      },
      false,
      "/custom/node/bin/node",
    );

    strictEqual(result.command, "/custom/node/bin/node");
    strictEqual(result.args?.[0], "/path/to/server.js");
    strictEqual(result.args?.[1], "--lsp");
  });

  test("should use 'execPath' with ELECTRON_RUN_AS_NODE", async () => {
    const result = await runExecutable(
      {
        path: "/path/to/server.js",
        loader: "node",
      },
      true,
    );

    strictEqual(result.command, process.execPath);
    strictEqual(result.options?.env?.ELECTRON_RUN_AS_NODE, "1");
  });

  test("should not set ELECTRON_RUN_AS_NODE server env", async () => {
    const result = await runExecutable(
      {
        path: "/path/to/server.js",
        loader: "node",
      },
      false,
    );
    strictEqual(result.options?.env?.ELECTRON_RUN_AS_NODE, undefined);
  });

  test("should set yarn PnP loader path when provided", async () => {
    const result = await runExecutable({
      path: "/path/to/server.js",
      loader: "node",
      yarnPnpLoaderPath: "/path/to/.pnp.cjs",
    });
    strictEqual(result.args?.includes("--require"), true);
    strictEqual(result.args?.includes("/path/to/.pnp.cjs"), true, JSON.stringify(result.args));
    strictEqual(result.args?.includes("--loader"), true);
    const expectedEsmLoaderPath = pathToFileURL(
      `${path.sep}path${path.sep}to${path.sep}.pnp.loader.mjs`,
    ).href;
    strictEqual(result.args?.includes(expectedEsmLoaderPath), true, JSON.stringify(result.args));
  });
});
