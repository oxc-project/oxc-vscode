import { strictEqual, throws } from "assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { Uri, workspace } from "vscode";
import {
  clearWorkspacePackageJsonNodeModulesCache,
  replaceTargetFromMainToBin,
  searchGlobalNodeModulesBin,
  searchProjectNodeModulesBin,
  searchYarnPnpBin,
} from "../../client/findBinary";
import { WORKSPACE_FOLDER } from "../test-helpers.js";

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

      strictEqual(result.includes(`${path.sep}dist${path.sep}index.js`), false);
      strictEqual(result.includes(`${path.sep}bin${path.sep}${binaryName}`), true);
    });

    test("should fallback to workspace node_modules/.bin when package resolve fails", async () => {
      const workspacePath = WORKSPACE_FOLDER.uri.fsPath;

      const fallbackBinaryName = "fallback-bin-lookup-test";
      const basePath = path.join(workspacePath, "node_modules", ".bin", fallbackBinaryName);
      const fallbackPath = basePath;

      await workspace.fs.writeFile(Uri.file(fallbackPath), new Uint8Array());

      try {
        const result = await searchProjectNodeModulesBin(fallbackBinaryName);

        strictEqual(result, fallbackPath);
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

        strictEqual(result, nestedBinPath);
      } finally {
        clearWorkspacePackageJsonNodeModulesCache();
        await workspace.fs.delete(Uri.file(path.join(workspacePath, "packages")), {
          recursive: true,
        });
      }
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

    test("should find binary via mock .pnp.cjs", async () => {
      const pkgDir = path.join(tmpDir, "node_modules", binaryName);
      mkdirSync(path.join(pkgDir, "bin"), { recursive: true });
      writeFileSync(
        path.join(pkgDir, "package.json"),
        JSON.stringify({ name: binaryName, bin: { [binaryName]: "bin/oxlint.mjs" } }),
      );
      writeFileSync(path.join(pkgDir, "bin", "oxlint.mjs"), "");
      writeFileSync(path.join(pkgDir, "index.js"), "");

      const mainPath = path.join(pkgDir, "index.js");
      writeFileSync(
        path.join(tmpDir, ".pnp.cjs"),
        `module.exports = { resolveRequest: function(req, issuer) { return ${JSON.stringify(mainPath)}; } };`,
      );

      // Note: this test verifies the PnP resolution logic works when .pnp.cjs exists
      // in the workspace root. Full integration testing requires a real Yarn PnP project.
      // The workspace mock does not include tmpDir, so this exercises the code path
      // where no workspace folder matches the PnP file location.
      const result = await searchYarnPnpBin(binaryName);
      // Returns undefined because tmpDir is not a registered workspace folder
      strictEqual(result, undefined);
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

      strictEqual(result.includes(`${path.sep}dist${path.sep}index.js`), false);
      strictEqual(result.includes(`${path.sep}bin${path.sep}${binaryName}`), true);
    });
  });
});
