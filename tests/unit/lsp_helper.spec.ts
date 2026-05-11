import { strictEqual } from "assert";
import { runExecutable } from "../../client/tools/lsp_helper";
import * as path from "node:path";

suite("runExecutable", () => {
  const originalPlatform = process.platform;
  const originalEnv = process.env;

  teardown(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    process.env = originalEnv;
  });

  test("should create Node.js executable for .js files", () => {
    const result = runExecutable({
      path: "/path/to/server.js",
      loader: "node",
    });

    // Node command should be resolved to an absolute path or remain as "node"
    // (depending on whether 'which'/'where' can find it in PATH)
    strictEqual(typeof result.command, "string");
    strictEqual(result.args?.[0], "/path/to/server.js");
    strictEqual(result.args?.[1], "--lsp");
  });

  test("should create Node.js executable for .cjs files", () => {
    const result = runExecutable({
      path: "/path/to/server.cjs",
      loader: "node",
    });

    // Node command should be resolved to an absolute path or remain as "node"
    strictEqual(typeof result.command, "string");
    strictEqual(result.args?.[0], "/path/to/server.cjs");
    strictEqual(result.args?.[1], "--lsp");
  });

  test("should create Node.js executable for .mjs files", () => {
    const result = runExecutable({
      path: "/path/to/server.mjs",
      loader: "node",
    });

    // Node command should be resolved to an absolute path or remain as "node"
    strictEqual(typeof result.command, "string");
    strictEqual(result.args?.[0], "/path/to/server.mjs");
    strictEqual(result.args?.[1], "--lsp");
  });

  test("should create binary executable for non-Node files", () => {
    const result = runExecutable({
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

  test("should use shell on Windows for binary executables", () => {
    Object.defineProperty(process, "platform", { value: "win32" });

    const result = runExecutable({
      path: "C:\\Path With Spaces\\oxc-language-server",
      loader: "native",
    });

    strictEqual(result.options?.shell, true);
  });

  test("should prepend nodePath to PATH", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    process.env.PATH = "/usr/bin:/bin";

    const result = runExecutable(
      {
        path: "/path/to/server.js",
        loader: "node",
      },
      false,
      "/custom/node/bin/node",
    );

    strictEqual(result.command, "/custom/node/bin/node");
    strictEqual(result.options?.env?.PATH, "/custom/node/bin:/usr/bin:/bin");
  });

  test("should set path in quotes on Windows for binary executables", () => {
    Object.defineProperty(process, "platform", { value: "win32" });

    const result = runExecutable({
      path: "C:\\Path With Spaces\\oxc-language-server",
      loader: "native",
    });

    strictEqual(result.command, '"C:\\Path With Spaces\\oxc-language-server"');
  });

  test("should use the provided node path for Node.js executables", () => {
    const result = runExecutable(
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

  test("should use 'execPath' with ELECTRON_RUN_AS_NODE", () => {
    const result = runExecutable(
      {
        path: "/path/to/server.js",
        loader: "node",
      },
      true,
    );

    strictEqual(result.command, process.execPath);
    strictEqual(result.options?.env?.ELECTRON_RUN_AS_NODE, "1");
  });

  test("should not set ELECTRON_RUN_AS_NODE server env", () => {
    const result = runExecutable(
      {
        path: "/path/to/server.js",
        loader: "node",
      },
      false,
    );
    strictEqual(result.options?.env?.ELECTRON_RUN_AS_NODE, undefined);
  });

  test("should set yarn PnP loader path when provided", () => {
    const result = runExecutable({
      path: "/path/to/server.js",
      loader: "node",
      yarnPnpLoaderPath: "/path/to/.pnp.cjs",
    });
    strictEqual(result.args?.includes("--require"), true);
    strictEqual(result.args?.includes("/path/to/.pnp.cjs"), true, JSON.stringify(result.args));
    strictEqual(result.args?.includes("--loader"), true);
    // will be converted to Windows path with backslashes
    strictEqual(
      result.args?.includes(`${path.sep}path${path.sep}to${path.sep}.pnp.loader.mjs`),
      true,
      JSON.stringify(result.args),
    );
  });

  test("should resolve node command and add its directory to PATH", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    const originalPath = process.env.PATH;
    process.env.PATH = "/usr/bin:/bin";

    const result = runExecutable({
      path: "/path/to/server.js",
      loader: "node",
    });

    // The resolved node path should be absolute and its directory should be in PATH
    if (path.isAbsolute(result.command)) {
      const nodeDir = path.dirname(result.command);
      strictEqual(
        result.options?.env?.PATH?.startsWith(`${nodeDir}:`),
        true,
        `Expected PATH to start with ${nodeDir}, but got: ${result.options?.env?.PATH}`,
      );
    }

    process.env.PATH = originalPath;
  });
});
