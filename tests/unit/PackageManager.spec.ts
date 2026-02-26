import { deepStrictEqual, strictEqual, throws } from "assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { Uri, workspace } from "vscode";
import {
  copyPackageToStorage,
  findPackageFolderFromResolvedPath,
  findPackageFolderInNodeModules,
  getBinaryPathFromPackageFolder,
  GlobalNodeModulesPackageSource,
  PackageManager,
  PackageSource,
  ProjectNodeModulesPackageSource,
} from "../../client/PackageManager";

suite("PackageManager", () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "test-pkg-mgr-"));
  });

  teardown(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  suite("findPackageFolderFromResolvedPath", () => {
    test("returns the directory containing package.json", () => {
      const pkgDir = path.join(tmpDir, "node_modules", "oxlint");
      mkdirSync(path.join(pkgDir, "dist"), { recursive: true });
      writeFileSync(
        path.join(pkgDir, "package.json"),
        JSON.stringify({ name: "oxlint", bin: { oxlint: "bin/oxlint" } }),
      );

      const result = findPackageFolderFromResolvedPath(path.join(pkgDir, "dist", "index.js"));

      strictEqual(result, pkgDir);
    });

    test("returns undefined when no package.json is found", () => {
      const deepDir = path.join(tmpDir, "a", "b", "c");
      mkdirSync(deepDir, { recursive: true });

      const result = findPackageFolderFromResolvedPath(path.join(deepDir, "index.js"));

      strictEqual(result, undefined);
    });

    test("finds package.json in an ancestor directory", () => {
      const pkgDir = path.join(tmpDir, "pkg");
      const nestedDir = path.join(pkgDir, "dist", "nested");
      mkdirSync(nestedDir, { recursive: true });
      writeFileSync(
        path.join(pkgDir, "package.json"),
        JSON.stringify({ name: "pkg", bin: "bin/pkg" }),
      );

      const result = findPackageFolderFromResolvedPath(path.join(nestedDir, "helper.js"));

      strictEqual(result, pkgDir);
    });
  });

  suite("getBinaryPathFromPackageFolder", () => {
    test("resolves binary path from bin object entry", () => {
      const pkgDir = path.join(tmpDir, "oxlint");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        path.join(pkgDir, "package.json"),
        JSON.stringify({ bin: { oxlint: "bin/oxlint.mjs" } }),
      );

      const result = getBinaryPathFromPackageFolder(pkgDir, "oxlint");

      strictEqual(result, path.join(pkgDir, "bin", "oxlint.mjs"));
    });

    test("resolves binary path from bin string entry", () => {
      const pkgDir = path.join(tmpDir, "oxlint");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        path.join(pkgDir, "package.json"),
        JSON.stringify({ bin: "bin/oxlint.mjs" }),
      );

      const result = getBinaryPathFromPackageFolder(pkgDir, "oxlint");

      strictEqual(result, path.join(pkgDir, "bin", "oxlint.mjs"));
    });

    test("throws when bin entry is missing for the binary name", () => {
      const pkgDir = path.join(tmpDir, "oxlint");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        path.join(pkgDir, "package.json"),
        JSON.stringify({ bin: { "other-tool": "bin/other" } }),
      );

      throws(() => getBinaryPathFromPackageFolder(pkgDir, "oxlint"));
    });
  });

  suite("findPackageFolderInNodeModules", () => {
    test("returns the package folder when package.json exists", async () => {
      const nodeModulesDir = path.join(tmpDir, "node_modules");
      const pkgDir = path.join(nodeModulesDir, "oxlint");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ name: "oxlint" }));

      const result = await findPackageFolderInNodeModules("oxlint", [nodeModulesDir]);

      strictEqual(result, pkgDir);
    });

    test("returns undefined when the package is not found", async () => {
      const nodeModulesDir = path.join(tmpDir, "node_modules");
      mkdirSync(nodeModulesDir, { recursive: true });

      const result = await findPackageFolderInNodeModules("non-existent-pkg-12345", [
        nodeModulesDir,
      ]);

      strictEqual(result, undefined);
    });

    test("returns the first matching package folder across multiple paths", async () => {
      const first = path.join(tmpDir, "first", "node_modules");
      const second = path.join(tmpDir, "second", "node_modules");
      const secondPkgDir = path.join(second, "oxlint");
      mkdirSync(path.join(first), { recursive: true });
      mkdirSync(secondPkgDir, { recursive: true });
      writeFileSync(path.join(secondPkgDir, "package.json"), JSON.stringify({ name: "oxlint" }));

      const result = await findPackageFolderInNodeModules("oxlint", [first, second]);

      strictEqual(result, secondPkgDir);
    });
  });

  suite("copyPackageToStorage", () => {
    test("copies package folder to extension storage and returns the destination path", async () => {
      const pkgDir = path.join(tmpDir, "source", "oxlint");
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        path.join(pkgDir, "package.json"),
        JSON.stringify({ bin: { oxlint: "bin/oxlint" } }),
      );

      const storageUri = Uri.file(path.join(tmpDir, "storage"));
      const result = await copyPackageToStorage(pkgDir, storageUri, "oxlint");

      const expectedPath = Uri.joinPath(storageUri, "packages", "oxlint").fsPath;
      strictEqual(result, expectedPath);

      // Verify the package.json was copied
      await workspace.fs.stat(Uri.file(path.join(expectedPath, "package.json")));
    });
  });

  suite("ProjectNodeModulesPackageSource", () => {
    test("returns undefined when binary is not in project node_modules", async () => {
      const source = new ProjectNodeModulesPackageSource();
      const result = await source.findPackageFolder("non-existent-pkg-12345");
      strictEqual(result, undefined);
    });

    test("finds the oxlint package folder in project node_modules", async () => {
      const source = new ProjectNodeModulesPackageSource();
      const result = await source.findPackageFolder("oxlint");

      // oxlint is installed as a dev dependency in this project
      strictEqual(result !== undefined, true);
      // The returned path should be a directory containing package.json
      await workspace.fs.stat(Uri.file(path.join(result!, "package.json")));
    });
  });

  suite("GlobalNodeModulesPackageSource", () => {
    test("returns undefined when binary is not in global node_modules", async () => {
      const source = new GlobalNodeModulesPackageSource();
      const result = await source.findPackageFolder("non-existent-pkg-12345");
      strictEqual(result, undefined);
    });
  });

  suite("PackageManager", () => {
    test("getManagedBinaryPath returns undefined when no source finds the package", async () => {
      const source: PackageSource = {
        sourceName: "stub",
        findPackageFolder: async () => undefined,
      };
      const storageUri = Uri.file(path.join(tmpDir, "storage"));
      const manager = new PackageManager(storageUri, [source]);

      const result = await manager.getManagedBinaryPath("non-existent-pkg-12345");
      strictEqual(result, undefined);
    });

    test("getManagedBinaryPath copies package and returns binary path from storage", async () => {
      const pkgDir = path.join(tmpDir, "source", "mypkg");
      const binDir = path.join(pkgDir, "bin");
      mkdirSync(binDir, { recursive: true });
      writeFileSync(
        path.join(pkgDir, "package.json"),
        JSON.stringify({ bin: { mypkg: "bin/mypkg" } }),
      );
      writeFileSync(path.join(binDir, "mypkg"), "#!/usr/bin/env node");

      const source: PackageSource = {
        sourceName: "stub",
        findPackageFolder: async () => pkgDir,
      };

      const storageUri = Uri.file(path.join(tmpDir, "storage"));
      const manager = new PackageManager(storageUri, [source]);
      const result = await manager.getManagedBinaryPath("mypkg");

      const expectedBin = Uri.joinPath(storageUri, "packages", "mypkg", "bin", "mypkg").fsPath;
      strictEqual(result, expectedBin);
    });

    test("getManagedBinaryPath uses the first source that provides a package", async () => {
      const pkgDir = path.join(tmpDir, "source", "mypkg");
      mkdirSync(path.join(pkgDir, "bin"), { recursive: true });
      writeFileSync(
        path.join(pkgDir, "package.json"),
        JSON.stringify({ bin: { mypkg: "bin/mypkg" } }),
      );
      writeFileSync(path.join(pkgDir, "bin", "mypkg"), "");

      const calledSources: string[] = [];
      const sources: PackageSource[] = [
        {
          sourceName: "first-miss",
          findPackageFolder: async () => {
            calledSources.push("first-miss");
            return undefined;
          },
        },
        {
          sourceName: "second-hit",
          findPackageFolder: async () => {
            calledSources.push("second-hit");
            return pkgDir;
          },
        },
        {
          sourceName: "third-never",
          findPackageFolder: async () => {
            calledSources.push("third-never");
            return pkgDir;
          },
        },
      ];

      const storageUri = Uri.file(path.join(tmpDir, "storage"));
      const manager = new PackageManager(storageUri, sources);
      await manager.getManagedBinaryPath("mypkg");

      deepStrictEqual(calledSources, ["first-miss", "second-hit"]);
    });

    test("getManagedBinaryPath uses oxlint from project node_modules when available", async () => {
      const storageUri = Uri.file(path.join(tmpDir, "storage"));

      const manager = new PackageManager(storageUri, [
        new ProjectNodeModulesPackageSource(),
        new GlobalNodeModulesPackageSource(),
      ]);

      const result = await manager.getManagedBinaryPath("oxlint");

      strictEqual(result !== undefined, true, "expected a binary path for oxlint");
      // The binary path should be inside the extension storage, not in node_modules
      strictEqual(
        result!.startsWith(storageUri.fsPath),
        true,
        "binary path should be in the managed storage",
      );
    });
  });
});
