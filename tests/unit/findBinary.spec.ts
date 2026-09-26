import { deepStrictEqual, strictEqual, throws } from "assert";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { Uri, workspace } from "vscode";
import {
  clearGlobalNodeModulesPathsCache,
  clearWorkspacePackageJsonNodeModulesCache,
  replaceTargetFromMainToBin,
  searchGlobalNodeModulesBin,
  searchEnvPath,
  searchProjectNodeModulesBin,
  searchVitePlusBin,
  searchYarnPnpBin,
} from "../../client/findBinary";
import { getShellEnv } from "../../client/getShellEnv";
import { WORKSPACE_FOLDER } from "../test-helpers.js";

const globalBinaryName = "global-node-modules-search-test-binary";

function createMockCommand(dir: string, name: string, scriptBody: string): void {
  writeFileSync(path.join(dir, name), `#!/bin/sh\n${scriptBody}\n`, { mode: 0o755 });
}

/** Creates a node_modules directory containing `globalBinaryName` and returns its path. */
function createGlobalNodeModules(parentDir: string): string {
  const nodeModules = path.join(parentDir, "node_modules");
  mkdirSync(path.join(nodeModules, ".bin"), { recursive: true });
  writeFileSync(path.join(nodeModules, ".bin", globalBinaryName), "", { mode: 0o755 });
  return nodeModules;
}

function globalBinaryPath(nodeModules: string): string {
  return path.join(nodeModules, ".bin", globalBinaryName);
}

suite("findBinary", () => {
  const binaryName = "oxlint";

  suite("replaceTargetFromMainToBin", () => {
    let tmpDir: string;

    setup(() => {
      tmpDir = mkdtempSync(path.join(tmpdir(), "test-replace-"));
    });

    teardown(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    test("should resolve bin path from package.json bin object", () => {
      const pkgDir = path.join(tmpDir, "node_modules", "oxlint");
      mkdirSync(path.join(pkgDir, "dist"), { recursive: true });
      writeFileSync(
        path.join(pkgDir, "package.json"),
        JSON.stringify({ bin: { oxlint: "bin/oxlint.mjs" } }),
      );

      const result = replaceTargetFromMainToBin(path.join(pkgDir, "dist", "index.js"), "oxlint");

      strictEqual(result, path.join(pkgDir, "bin", "oxlint.mjs"));
    });

    test("should resolve bin path from package.json bin string", () => {
      const pkgDir = path.join(tmpDir, "node_modules", "oxlint");
      mkdirSync(path.join(pkgDir, "dist"), { recursive: true });
      writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ bin: "bin/oxlint.mjs" }));

      const result = replaceTargetFromMainToBin(path.join(pkgDir, "dist", "index.js"), "oxlint");

      strictEqual(result, path.join(pkgDir, "bin", "oxlint.mjs"));
    });

    test("should throw when package.json has no bin entry for binaryName", () => {
      const pkgDir = path.join(tmpDir, "node_modules", "oxlint");
      mkdirSync(path.join(pkgDir, "dist"), { recursive: true });
      writeFileSync(
        path.join(pkgDir, "package.json"),
        JSON.stringify({ bin: { "other-binary": "bin/other" } }),
      );

      throws(() => replaceTargetFromMainToBin(path.join(pkgDir, "dist", "index.js"), "oxlint"));
    });

    test("should throw when no package.json is found", () => {
      const deepDir = path.join(tmpDir, "a", "b", "c");
      mkdirSync(deepDir, { recursive: true });

      throws(() => replaceTargetFromMainToBin(path.join(deepDir, "index.js"), "oxlint"));
    });
  });

  suite("searchProjectNodeModulesBin", () => {
    test("should return undefined when binary is not found in project node_modules", async () => {
      const result = await searchProjectNodeModulesBin("non-existent-binary-package-name-12345");
      strictEqual(result, undefined);
    });

    // this depends on the binary being installed in the oxc project's node_modules
    test("should replace dist/index.js with bin/<binary-name> in resolved path", async () => {
      const result = (await searchProjectNodeModulesBin(binaryName))!;

      strictEqual(result.loader, "node");
      strictEqual(result.path.includes(`${path.sep}dist${path.sep}index.js`), false);
      strictEqual(result.path.includes(`${path.sep}bin${path.sep}${binaryName}`), true);
    });

    test("should fallback to workspace node_modules/.bin when package resolve fails", async () => {
      const workspacePath = WORKSPACE_FOLDER.uri.fsPath;

      const fallbackBinaryName = "fallback-bin-lookup-test";
      const basePath = path.join(workspacePath, "node_modules", ".bin", fallbackBinaryName);
      const fallbackPath = basePath;

      await workspace.fs.writeFile(Uri.file(fallbackPath), new Uint8Array());

      try {
        const result = await searchProjectNodeModulesBin(fallbackBinaryName);

        strictEqual(result?.loader, "native");
        strictEqual(result?.path, fallbackPath);
      } finally {
        await workspace.fs.delete(Uri.file(fallbackPath));
      }
    });

    test("should fallback to nested package.json directory node_modules/.bin in monorepo", async () => {
      const workspacePath = WORKSPACE_FOLDER.uri.fsPath;

      const fallbackBinaryName = "fallback-nested-bin-lookup-test";
      const nestedPackageDir = path.join(workspacePath, "packages", "nested-app");
      const nestedPackageJson = path.join(nestedPackageDir, "package.json");
      const nestedBinPath = path.join(nestedPackageDir, "node_modules", ".bin", fallbackBinaryName);

      await workspace.fs.writeFile(
        Uri.file(nestedPackageJson),
        Buffer.from(JSON.stringify({ name: "nested-app" })),
      );
      await workspace.fs.writeFile(Uri.file(nestedBinPath), new Uint8Array());

      // clear cache so the newly created package.json is discovered
      clearWorkspacePackageJsonNodeModulesCache();

      try {
        const result = await searchProjectNodeModulesBin(fallbackBinaryName);

        strictEqual(result?.loader, "native");
        strictEqual(result?.path, nestedBinPath);
      } finally {
        clearWorkspacePackageJsonNodeModulesCache();
        await workspace.fs.delete(Uri.file(path.join(workspacePath, "packages")), {
          recursive: true,
        });
      }
    });
  });

  suite("searchVitePlusBin", () => {
    let tmpDir: string;

    const installVitePlus = (dir: string) => {
      const pkgDir = path.join(dir, "node_modules", "vite-plus");
      mkdirSync(path.join(pkgDir, "bin"), { recursive: true });
      writeFileSync(
        path.join(pkgDir, "package.json"),
        JSON.stringify({ name: "vite-plus", main: "index.js", bin: { vp: "./bin/vp" } }),
      );
      writeFileSync(path.join(pkgDir, "index.js"), "");
      writeFileSync(path.join(pkgDir, "bin", "vp"), "");
      return path.join(pkgDir, "bin", "vp");
    };

    setup(() => {
      // `require.resolve` returns real paths, e.g. `/private/var` for `/var` on macOS.
      tmpDir = realpathSync(mkdtempSync(path.join(tmpdir(), "test-vite-plus-")));
    });

    teardown(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    test("should find vp installed in the workspace folder", () => {
      const vpPath = installVitePlus(tmpDir);

      const result = searchVitePlusBin("lint", [tmpDir]);

      strictEqual(result?.path, vpPath);
      strictEqual(result?.loader, "node");
      deepStrictEqual(result?.args, ["lint"]);
    });

    test("should find vp hoisted to an ancestor", () => {
      const vpPath = installVitePlus(tmpDir);
      const pkgDir = path.join(tmpDir, "packages", "app");
      mkdirSync(pkgDir, { recursive: true });

      strictEqual(searchVitePlusBin("fmt", [pkgDir])?.path, vpPath);
    });

    test("should return undefined when vite-plus is not installed", () => {
      strictEqual(searchVitePlusBin("lint", [tmpDir]), undefined);
    });
  });

  suite("searchYarnPnpBin", () => {
    let tmpDir: string;

    setup(() => {
      tmpDir = mkdtempSync(path.join(tmpdir(), "test-pnp-"));
    });

    teardown(() => {
      rmSync(tmpDir, { recursive: true, force: true });
      // Clear require cache for any .pnp.cjs files we created
      for (const key of Object.keys(require.cache)) {
        if (key.includes(".pnp.")) {
          delete require.cache[key];
        }
      }
    });

    test("should return undefined when no .pnp.cjs exists", async () => {
      const result = await searchYarnPnpBin("non-existent-binary");
      strictEqual(result, undefined);
    });

    test("should return undefined when .pnp.cjs exists but binary is not installed", async () => {
      // Create a .pnp.cjs that rejects all resolve requests in the workspace folder
      const workspacePath = WORKSPACE_FOLDER.uri.fsPath;
      const pnpPath = path.join(workspacePath, ".pnp.cjs");
      writeFileSync(
        pnpPath,
        `module.exports = { resolveRequest: function(req, issuer) { throw new Error("not found"); } };`,
      );

      try {
        const result = await searchYarnPnpBin(binaryName);
        strictEqual(result, undefined);
      } finally {
        rmSync(pnpPath, { force: true });
      }
    });

    test("should detect binary using .pnp.cjs", async () => {
      // Create a .pnp.cjs that resolves the binary path in the workspace folder
      const workspacePath = WORKSPACE_FOLDER.uri.fsPath;
      const pnpPath = path.join(workspacePath, ".pnp.cjs");
      writeFileSync(
        pnpPath,
        `module.exports = { resolveRequest: function(req, issuer) { return '${process.env.YARN_FOUND_BIN?.replaceAll("\\", "\\\\")}'; } };`,
      );

      try {
        const result = await searchYarnPnpBin(binaryName);
        strictEqual(result?.loader, "node");
        strictEqual(
          result?.path,
          process.env.YARN_FOUND_BIN!.replace(`dist${path.sep}cli.js`, `bin${path.sep}oxlint`),
        );
        strictEqual(result?.yarnPnpLoaderPath, pnpPath);
      } finally {
        rmSync(pnpPath, { force: true });
      }
    });
  });

  suite("searchGlobalNodeModulesBin", () => {
    test("should return undefined when binary is not found in global node_modules", async () => {
      const result = await searchGlobalNodeModulesBin("non-existent-binary-package-name-12345");
      strictEqual(result, undefined);
    });

    // Skipping this test as it may depend on the actual global installation of the binary
    test.skip("should replace dist/index.js with bin/<binary-name> in resolved path", async () => {
      const result = (await searchGlobalNodeModulesBin(binaryName))!;

      strictEqual(result.loader, "node");
      strictEqual(result.path.includes(`${path.sep}dist${path.sep}index.js`), false);
      strictEqual(result.path.includes(`${path.sep}bin${path.sep}${binaryName}`), true);
    });
  });

  suite("global node_modules paths", () => {
    let tmpDir: string;
    let commandDir: string;
    let shellEnv: Record<string, string | undefined>;
    let originalShellPath: string | undefined;
    let originalHome: string | undefined;

    suiteSetup(async () => {
      shellEnv = await getShellEnv();
    });

    setup(() => {
      tmpDir = mkdtempSync(path.join(tmpdir(), "test-global-node-modules-"));
      commandDir = path.join(tmpDir, "commands");
      mkdirSync(commandDir, { recursive: true });

      // the commands inherit the environment of `getShellEnv`, which is cached and shared with the
      // extension, so the mock command directory is prepended to its `PATH` and restored afterwards
      originalShellPath = shellEnv.PATH;
      shellEnv.PATH = `${commandDir}${path.delimiter}${originalShellPath ?? ""}`;

      // `homedir` reads `HOME`, which moves the bun path into the temporary directory
      originalHome = process.env.HOME;
      process.env.HOME = path.join(tmpDir, "home");

      clearGlobalNodeModulesPathsCache();
    });

    teardown(() => {
      shellEnv.PATH = originalShellPath;
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      clearGlobalNodeModulesPathsCache();
      rmSync(tmpDir, { recursive: true, force: true });
    });

    test("`npm root -g` and `pnpm root -g` run concurrently", async function () {
      if (process.platform === "win32") {
        this.skip();
      }

      const npmNodeModules = createGlobalNodeModules(path.join(tmpDir, "npm"));
      const pnpmNodeModules = createGlobalNodeModules(path.join(tmpDir, "pnpm"));
      const npmStarted = path.join(tmpDir, "npm.started");
      const pnpmStarted = path.join(tmpDir, "pnpm.started");
      // each command prints its path only once the other one has started, one command waiting for
      // the other to finish leaves both without a path
      createMockCommand(
        commandDir,
        "npm",
        `printf "x" > "${npmStarted}"; sleep 1; [ -f "${pnpmStarted}" ] && printf "%s" "${npmNodeModules}"`,
      );
      createMockCommand(
        commandDir,
        "pnpm",
        `printf "x" > "${pnpmStarted}"; sleep 1; [ -f "${npmStarted}" ] && printf "%s" "${pnpmNodeModules}"`,
      );

      const result = await searchGlobalNodeModulesBin(globalBinaryName);

      strictEqual(result?.path, globalBinaryPath(npmNodeModules));
    });

    test("a command exiting with a non-zero status contributes no path, the other paths are kept", async function () {
      if (process.platform === "win32") {
        this.skip();
      }

      const npmNodeModules = createGlobalNodeModules(path.join(tmpDir, "npm"));
      const pnpmNodeModules = createGlobalNodeModules(path.join(tmpDir, "pnpm"));
      createMockCommand(commandDir, "npm", `printf "%s" "${npmNodeModules}"; exit 1`);
      createMockCommand(commandDir, "pnpm", `printf "%s" "${pnpmNodeModules}"`);

      const result = await searchGlobalNodeModulesBin(globalBinaryName);

      strictEqual(result?.path, globalBinaryPath(pnpmNodeModules));
    });

    test("the bun path is returned when neither command produces a path", async function () {
      if (process.platform === "win32") {
        this.skip();
      }

      const bunNodeModules = createGlobalNodeModules(
        path.join(process.env.HOME!, ".bun/install/global"),
      );
      const bunRuns = path.join(tmpDir, "bun.runs");
      createMockCommand(commandDir, "npm", "exit 1");
      createMockCommand(commandDir, "pnpm", "exit 1");
      // the bun path is a fixed location, a `bun` command on the `PATH` is never run
      createMockCommand(commandDir, "bun", `printf "x" >> "${bunRuns}"; exit 1`);

      const result = await searchGlobalNodeModulesBin(globalBinaryName);

      strictEqual(result?.path, globalBinaryPath(bunNodeModules));
      strictEqual(existsSync(bunRuns), false);
    });

    test("the returned order stays npm, pnpm, bun", async function () {
      if (process.platform === "win32") {
        this.skip();
      }

      const npmNodeModules = createGlobalNodeModules(path.join(tmpDir, "npm"));
      const pnpmNodeModules = createGlobalNodeModules(path.join(tmpDir, "pnpm"));
      createGlobalNodeModules(path.join(process.env.HOME!, ".bun/install/global"));
      createMockCommand(commandDir, "npm", `printf "%s" "${npmNodeModules}"`);
      createMockCommand(commandDir, "pnpm", `printf "%s" "${pnpmNodeModules}"`);

      const result = await searchGlobalNodeModulesBin(globalBinaryName);

      strictEqual(result?.path, globalBinaryPath(npmNodeModules));
    });

    test("concurrent resolutions share a single pair of commands", async function () {
      if (process.platform === "win32") {
        this.skip();
      }

      const npmNodeModules = createGlobalNodeModules(path.join(tmpDir, "npm"));
      const npmRuns = path.join(tmpDir, "npm.runs");
      const pnpmRuns = path.join(tmpDir, "pnpm.runs");
      createMockCommand(
        commandDir,
        "npm",
        `printf "x" >> "${npmRuns}"; printf "%s" "${npmNodeModules}"`,
      );
      createMockCommand(commandDir, "pnpm", `printf "x" >> "${pnpmRuns}"; exit 1`);

      writeFileSync(path.join(npmNodeModules, ".bin", "oxlint"), "", { mode: 0o755 });
      writeFileSync(path.join(npmNodeModules, ".bin", "oxfmt"), "", { mode: 0o755 });

      const [oxlintResult, oxfmtResult] = await Promise.all([
        searchGlobalNodeModulesBin("oxlint"),
        searchGlobalNodeModulesBin("oxfmt"),
      ]);

      strictEqual(oxlintResult?.path, path.join(npmNodeModules, ".bin", "oxlint"));
      strictEqual(oxfmtResult?.path, path.join(npmNodeModules, ".bin", "oxfmt"));
      strictEqual(readFileSync(npmRuns, "utf8"), "x");
      strictEqual(readFileSync(pnpmRuns, "utf8"), "x");
    });

    test("clearGlobalNodeModulesPathsCache lets the commands run again", async function () {
      if (process.platform === "win32") {
        this.skip();
      }

      const npmNodeModules = createGlobalNodeModules(path.join(tmpDir, "npm"));
      const npmRuns = path.join(tmpDir, "npm.runs");
      createMockCommand(
        commandDir,
        "npm",
        `printf "x" >> "${npmRuns}"; printf "%s" "${npmNodeModules}"`,
      );
      createMockCommand(commandDir, "pnpm", "exit 1");

      await searchGlobalNodeModulesBin(globalBinaryName);
      clearGlobalNodeModulesPathsCache();
      await searchGlobalNodeModulesBin(globalBinaryName);

      strictEqual(readFileSync(npmRuns, "utf8"), "xx");
    });

    test("the commands run with the environment of getShellEnv", async function () {
      if (process.platform === "win32") {
        this.skip();
      }

      const npmNodeModules = createGlobalNodeModules(path.join(tmpDir, "npm"));
      shellEnv.GLOBAL_NODE_MODULES_TEST_PATH = npmNodeModules;

      createMockCommand(commandDir, "npm", `printf "%s" "$GLOBAL_NODE_MODULES_TEST_PATH"`);
      createMockCommand(commandDir, "pnpm", "exit 1");

      try {
        const result = await searchGlobalNodeModulesBin(globalBinaryName);

        strictEqual(process.env.GLOBAL_NODE_MODULES_TEST_PATH, undefined);
        strictEqual(result?.path, globalBinaryPath(npmNodeModules));
      } finally {
        delete shellEnv.GLOBAL_NODE_MODULES_TEST_PATH;
      }
    });
  });

  suite("searchEnvPath", () => {
    let originalPath: string | undefined;

    setup(() => {
      originalPath = process.env.PATH;
    });

    teardown(() => {
      if (originalPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = originalPath;
      }
    });

    test("should find binary in PATH", async () => {
      const tmpPathDir = mkdtempSync(path.join(tmpdir(), "test-search-path-"));
      const binaryPath = path.join(tmpPathDir, binaryName);
      writeFileSync(binaryPath, "");

      process.env.PATH = tmpPathDir;

      try {
        const result = await searchEnvPath(binaryName);
        if (process.platform === "win32" && result) {
          // Uppercase drive letter for assertion on Windows
          result.path = `${result.path[0].toUpperCase()}${result.path.slice(1)}`;
        }
        strictEqual(result?.loader, "native");
        strictEqual(result?.path, binaryPath);
      } finally {
        rmSync(tmpPathDir, { recursive: true, force: true });
      }
    });

    test("should return undefined when PATH is not set", async () => {
      delete process.env.PATH;
      const result = await searchEnvPath(binaryName);

      strictEqual(result, undefined);
    });
  });
});
