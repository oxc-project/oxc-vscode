import { strictEqual } from "node:assert";
import { validateSafeBinaryPath } from "../../client/PathValidator";

suite("validateSafeBinaryPath", () => {
  test("should return true for valid binary paths", () => {
    strictEqual(validateSafeBinaryPath("/usr/local/bin/biome"), true);
    strictEqual(validateSafeBinaryPath("C:\\Program Files\\biome.exe"), true);
    strictEqual(validateSafeBinaryPath("./biome"), true);
    strictEqual(validateSafeBinaryPath("/opt/biome"), true);
  });

  test("should accept case variations of biome", () => {
    strictEqual(validateSafeBinaryPath("BIOME_LANGUAGE_SERVER"), true);
    strictEqual(validateSafeBinaryPath("BIOME_LANGUAGE_SERVER.exe"), true);
    strictEqual(
      validateSafeBinaryPath("/usr/local/bin/BIOME_LANGUAGE_SERVER"),
      true,
    );
    strictEqual(
      validateSafeBinaryPath("C:\\Program Files\\BIOME_LANGUAGE_SERVER.exe"),
      true,
    );
  });

  test("should reject paths with directory traversal", () => {
    strictEqual(validateSafeBinaryPath("../biome"), false);
    strictEqual(validateSafeBinaryPath("../../biome"), false);
    strictEqual(validateSafeBinaryPath("/usr/local/../bin/biome"), false);
    strictEqual(validateSafeBinaryPath("..\\biome"), false);
    strictEqual(validateSafeBinaryPath(".\\biome"), false);
  });

  test("should reject paths with malicious characters", () => {
    strictEqual(validateSafeBinaryPath("biome;rm -rf /"), false);
    strictEqual(validateSafeBinaryPath("biome|cat /etc/passwd"), false);
    strictEqual(validateSafeBinaryPath("biome$PATH"), false);
    strictEqual(validateSafeBinaryPath("biome>output.txt"), false);
    strictEqual(validateSafeBinaryPath("biome<input.txt"), false);
    strictEqual(validateSafeBinaryPath("biome`whoami`"), false);
    strictEqual(validateSafeBinaryPath("biome!"), false);

    // windows specific
    strictEqual(validateSafeBinaryPath("biome^&pause"), false);
    strictEqual(validateSafeBinaryPath("biome & del /f *"), false);
  });
});
