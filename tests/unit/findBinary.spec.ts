import { strictEqual } from "assert";
import * as path from "node:path";
import { Uri, workspace } from "vscode";
import { searchGlobalNodeModulesBin, searchProjectNodeModulesBin } from "../../client/findBinary";
import { WORKSPACE_FOLDER } from "../test-helpers.js";

suite("findBinary", () => {
  const binaryName = "oxlint";

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
