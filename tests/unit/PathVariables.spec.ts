import { strictEqual } from "assert";
import { substitutePathVariables } from "../../client/PathVariables";
import os = require("node:os");

const ENV_VARIABLE = "OXC_TEST_BINARY_DIRECTORY";

function withHomedir(homedir: () => string, fn: () => void): void {
  const original = os.homedir;
  Object.defineProperty(os, "homedir", { configurable: true, writable: true, value: homedir });

  try {
    fn();
  } finally {
    Object.defineProperty(os, "homedir", { configurable: true, writable: true, value: original });
  }
}

suite("substitutePathVariables", () => {
  teardown(() => {
    delete process.env[ENV_VARIABLE];
  });

  test("`${userHome}` is replaced by the home directory", () => {
    strictEqual(substitutePathVariables("${userHome}/bin/oxlint"), `${os.homedir()}/bin/oxlint`);
  });

  test("a `$` in the home directory is not a replacement pattern", () => {
    withHomedir(
      () => "/home/a$'",
      () => {
        strictEqual(substitutePathVariables("${userHome}/bin/oxlint"), "/home/a$'/bin/oxlint");
      },
    );
  });

  test("`${env:NAME}` is replaced by the value of the environment variable", () => {
    process.env[ENV_VARIABLE] = "/opt/oxc";
    strictEqual(substitutePathVariables(`\${env:${ENV_VARIABLE}}/oxlint`), "/opt/oxc/oxlint");
  });

  test("`${env:NAME}` of an unset environment variable is replaced by an empty string", () => {
    strictEqual(
      substitutePathVariables(`./\${env:${ENV_VARIABLE}}node_modules/.bin/oxlint`),
      "./node_modules/.bin/oxlint",
    );
  });

  test("`${env:NAME}` of an empty environment variable is replaced by an empty string", () => {
    process.env[ENV_VARIABLE] = "";
    strictEqual(
      substitutePathVariables(`./\${env:${ENV_VARIABLE}}node_modules/.bin/oxlint`),
      "./node_modules/.bin/oxlint",
    );
  });

  test("any other `${...}` form is left untouched", () => {
    strictEqual(substitutePathVariables("${workspaceFolder}/oxlint"), "${workspaceFolder}/oxlint");
    strictEqual(substitutePathVariables("${userhome}/oxlint"), "${userhome}/oxlint");
    strictEqual(substitutePathVariables("${env}/oxlint"), "${env}/oxlint");
    strictEqual(substitutePathVariables("${env:}/oxlint"), "${env:}/oxlint");
  });

  test("`${userHome}` is left untouched when the home directory cannot be determined", () => {
    withHomedir(
      () => {
        throw new Error("no home directory");
      },
      () => {
        strictEqual(substitutePathVariables("${userHome}/bin/oxlint"), "${userHome}/bin/oxlint");
      },
    );
    withHomedir(
      () => "",
      () => {
        strictEqual(substitutePathVariables("${userHome}/bin/oxlint"), "${userHome}/bin/oxlint");
      },
    );
  });

  test("a value without a variable is returned unchanged", () => {
    strictEqual(substitutePathVariables("/opt/oxc/oxlint"), "/opt/oxc/oxlint");
    strictEqual(substitutePathVariables("../sibling/oxlint"), "../sibling/oxlint");
    strictEqual(substitutePathVariables("~/bin/oxlint"), "~/bin/oxlint");
  });
});
