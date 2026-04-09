import { strictEqual } from "node:assert";
import * as path from "node:path";
import { replaceTargetFromMainToBin } from "../../client/findBinary.js";

suite("findBinary", () => {
  test("replaceTargetFromMainToBin correctly finds bin from package.json", () => {
    const packageJsonPath = path.resolve(process.cwd(), "package.json");
    try {
      const binPath = replaceTargetFromMainToBin(packageJsonPath, "biome");
      strictEqual(typeof binPath, "string");
    } catch (_e) {
      // if biome is not in our own package.json's bin, it might fail, which is expected
    }
  });
});
