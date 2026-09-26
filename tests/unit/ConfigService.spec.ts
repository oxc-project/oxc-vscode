import { deepStrictEqual, notStrictEqual, strictEqual } from "assert";
import { workspace } from "vscode";
import { ConfigService } from "../../client/ConfigService.js";
import { WORKSPACE_FOLDER } from "../test-helpers.js";
import { resolve, sep } from "node:path";

const conf = workspace.getConfiguration("oxc");
const ENV_VARIABLE = "OXC_TEST_SETTINGS_BINARY";

suite("ConfigService", () => {
  setup(async () => {
    const keys = ["path.server", "path.oxlint", "path.oxfmt", "path.tsgolint"];

    await Promise.all(keys.map((key) => conf.update(key, undefined)));
  });

  teardown(async () => {
    const keys = ["path.server", "path.oxlint", "path.oxfmt", "path.tsgolint"];

    await Promise.all(keys.map((key) => conf.update(key, undefined)));
    delete process.env[ENV_VARIABLE];
  });

  const getWorkspaceFolderPlatformSafe = (folder = WORKSPACE_FOLDER) => {
    return folder.uri.fsPath;
  };

  const createWorkspaceFolderFileUri = async (relativePath: string, folder = WORKSPACE_FOLDER) => {
    const workspace_path = getWorkspaceFolderPlatformSafe(folder);
    const path =
      process.platform === "win32"
        ? `${workspace_path}\\${relativePath}`
        : `${workspace_path}/${relativePath}`;

    await workspace.fs.writeFile(folder.uri.with({ path }), new Uint8Array());
  };

  const deleteWorkspaceFolderFileUri = async (relativePath: string, folder = WORKSPACE_FOLDER) => {
    const workspace_path = getWorkspaceFolderPlatformSafe(folder);
    const path =
      process.platform === "win32"
        ? `${workspace_path}\\${relativePath}`
        : `${workspace_path}/${relativePath}`;

    await workspace.fs.delete(folder.uri.with({ path }));
  };

  suite("getOxfmtServerBinPath", () => {
    test("falls back to node resolving when server path is not set", async () => {
      const service = new ConfigService();
      const cwd = process.env.VSCODE_CWD!.replace(`${sep}editors${sep}vscode`, "");
      let oxfmtPath = (await service.getOxfmtServerBinPath())!;
      // on windows, uppercase the driver letter for consistent path comparison
      if (process.platform === "win32") {
        oxfmtPath.path = oxfmtPath.path[0].toUpperCase() + oxfmtPath.path.slice(1);
      }

      // it targets the oxc project's oxlint/bin/oxlint path
      strictEqual(oxfmtPath.loader, "node");
      strictEqual(
        oxfmtPath.path.startsWith(cwd),
        true,
        `path should start with cwd, cwd: ${cwd}, actual: ${oxfmtPath.path}`,
      );
      strictEqual(
        oxfmtPath.path.endsWith(`oxfmt${sep}bin${sep}oxfmt`),
        true,
        "path should end with oxfmt/bin/oxfmt",
      );
    });

    test("resolves relative server path with workspace folder", async () => {
      const service = new ConfigService();
      const workspace_path = getWorkspaceFolderPlatformSafe();

      await createWorkspaceFolderFileUri("absolute/oxfmt");
      await createWorkspaceFolderFileUri("relative/oxfmt");

      await conf.update("path.oxfmt", `${workspace_path}/absolute/oxfmt`);
      const absoluteServer = await service.getOxfmtServerBinPath();

      strictEqual(absoluteServer?.loader, "native");
      // the configured path is normalized, which turns the separators into platform ones
      strictEqual(absoluteServer?.path, `${workspace_path}${sep}absolute${sep}oxfmt`);

      await conf.update("path.oxfmt", "./relative/oxfmt");
      const relativeServer = await service.getOxfmtServerBinPath();

      strictEqual(relativeServer?.loader, "native");
      strictEqual(relativeServer?.path, `${workspace_path}${sep}relative${sep}oxfmt`);

      await deleteWorkspaceFolderFileUri("absolute/oxfmt");
      await deleteWorkspaceFolderFileUri("relative/oxfmt");
    });

    test("resolves server path outside of the workspace folder", async () => {
      const workspace_path = getWorkspaceFolderPlatformSafe();
      await createWorkspaceFolderFileUri("../outside/oxfmt");
      const service = new ConfigService();
      await conf.update("path.oxfmt", "../outside/oxfmt");
      const outsideServerPath = await service.getOxfmtServerBinPath();

      strictEqual(outsideServerPath?.loader, "native");
      strictEqual(outsideServerPath?.path, resolve(workspace_path, "../outside/oxfmt"));
      await deleteWorkspaceFolderFileUri("../outside/oxfmt");
    });

    test("resolves server path with an environment variable", async () => {
      const workspace_path = getWorkspaceFolderPlatformSafe();
      await createWorkspaceFolderFileUri("variable/oxfmt");
      const service = new ConfigService();
      process.env[ENV_VARIABLE] = workspace_path;
      await conf.update("path.oxfmt", `\${env:${ENV_VARIABLE}}/variable/oxfmt`);
      const variableServer = await service.getOxfmtServerBinPath();

      strictEqual(variableServer?.loader, "native");
      strictEqual(variableServer?.path, `${workspace_path}${sep}variable${sep}oxfmt`);
      await deleteWorkspaceFolderFileUri("variable/oxfmt");
    });

    test("resolves server path with an optional variable prefix", async () => {
      const workspace_path = getWorkspaceFolderPlatformSafe();
      await createWorkspaceFolderFileUri("optional/oxfmt");
      await createWorkspaceFolderFileUri("package/optional/oxfmt");
      const service = new ConfigService();
      await conf.update("path.oxfmt", `./\${env:${ENV_VARIABLE}}optional/oxfmt`);
      const unsetServer = await service.getOxfmtServerBinPath();

      strictEqual(unsetServer?.path, `${workspace_path}${sep}optional${sep}oxfmt`);

      process.env[ENV_VARIABLE] = "package/";
      const packageServer = await service.getOxfmtServerBinPath();

      strictEqual(packageServer?.path, `${workspace_path}${sep}package${sep}optional${sep}oxfmt`);
      await deleteWorkspaceFolderFileUri("optional/oxfmt");
      await deleteWorkspaceFolderFileUri("package/optional/oxfmt");
    });

    test("falls back to the default search when the server path is empty after substitution", async () => {
      const service = new ConfigService();
      const defaultServer = await service.getOxfmtServerBinPath();

      notStrictEqual(defaultServer, undefined);

      await conf.update("path.oxfmt", `\${env:${ENV_VARIABLE}}`);
      deepStrictEqual(await service.getOxfmtServerBinPath(), defaultServer);

      process.env[ENV_VARIABLE] = "";
      deepStrictEqual(await service.getOxfmtServerBinPath(), defaultServer);
    });

    test("returns backslashes path on Windows", async () => {
      if (process.platform !== "win32") {
        return;
      }
      await createWorkspaceFolderFileUri("./relative/oxfmt");
      const service = new ConfigService();
      await conf.update("path.oxfmt", "./relative/oxfmt");
      const relativeServer = await service.getOxfmtServerBinPath();
      const workspace_path = getWorkspaceFolderPlatformSafe();

      strictEqual(
        workspace_path[1],
        ":",
        "The test workspace folder must be an absolute path with a drive letter on Windows",
      );
      strictEqual(relativeServer?.path, `${workspace_path}\\relative\\oxfmt`);
      await deleteWorkspaceFolderFileUri("./relative/oxfmt");
    });
  });

  suite("getOxlintServerBinPath", () => {
    test("falls back to node resolving when server path is not set", async () => {
      const service = new ConfigService();
      const cwd = process.env.VSCODE_CWD!.replace(`${sep}editors${sep}vscode`, "");
      let oxlintPath = (await service.getOxlintServerBinPath())!;
      // on windows, uppercase the driver letter for consistent path comparison
      if (process.platform === "win32") {
        oxlintPath.path = oxlintPath.path[0].toUpperCase() + oxlintPath.path.slice(1);
      }
      // it targets the oxc project's oxlint/bin/oxlint path
      strictEqual(oxlintPath.loader, "node");
      strictEqual(
        oxlintPath.path.startsWith(cwd),
        true,
        `path should start with cwd, cwd: ${cwd}, actual: ${oxlintPath.path}`,
      );
      strictEqual(
        oxlintPath.path.endsWith(`oxlint${sep}bin${sep}oxlint`),
        true,
        "path should end with oxlint/bin/oxlint",
      );
    });

    test("resolves relative server path with workspace folder", async () => {
      const service = new ConfigService();
      const workspace_path = getWorkspaceFolderPlatformSafe();

      await createWorkspaceFolderFileUri("absolute/oxlint");
      await createWorkspaceFolderFileUri("relative/oxlint");

      await conf.update("path.oxlint", `${workspace_path}/absolute/oxlint`);
      const absoluteServer = await service.getOxlintServerBinPath();

      strictEqual(absoluteServer?.loader, "native");
      // the configured path is normalized, which turns the separators into platform ones
      strictEqual(absoluteServer?.path, `${workspace_path}${sep}absolute${sep}oxlint`);

      await conf.update("path.oxlint", "./relative/oxlint");
      const relativeServer = await service.getOxlintServerBinPath();

      strictEqual(relativeServer?.loader, "native");
      strictEqual(relativeServer?.path, `${workspace_path}${sep}relative${sep}oxlint`);

      await deleteWorkspaceFolderFileUri("absolute/oxlint");
      await deleteWorkspaceFolderFileUri("relative/oxlint");
    });

    test("resolves server path outside of the workspace folder", async () => {
      const workspace_path = getWorkspaceFolderPlatformSafe();
      await createWorkspaceFolderFileUri("../outside/oxlint");
      const service = new ConfigService();
      await conf.update("path.oxlint", "../outside/oxlint");
      const outsideServerPath = await service.getOxlintServerBinPath();

      strictEqual(outsideServerPath?.loader, "native");
      strictEqual(outsideServerPath?.path, resolve(workspace_path, "../outside/oxlint"));
      await deleteWorkspaceFolderFileUri("../outside/oxlint");
    });

    test("resolves server path with an environment variable", async () => {
      const workspace_path = getWorkspaceFolderPlatformSafe();
      await createWorkspaceFolderFileUri("variable/oxlint");
      const service = new ConfigService();
      process.env[ENV_VARIABLE] = workspace_path;
      await conf.update("path.oxlint", `\${env:${ENV_VARIABLE}}/variable/oxlint`);
      const variableServer = await service.getOxlintServerBinPath();

      strictEqual(variableServer?.loader, "native");
      strictEqual(variableServer?.path, `${workspace_path}${sep}variable${sep}oxlint`);
      await deleteWorkspaceFolderFileUri("variable/oxlint");
    });

    test("resolves server path with an optional variable prefix", async () => {
      const workspace_path = getWorkspaceFolderPlatformSafe();
      await createWorkspaceFolderFileUri("optional/oxlint");
      await createWorkspaceFolderFileUri("package/optional/oxlint");
      const service = new ConfigService();
      await conf.update("path.oxlint", `./\${env:${ENV_VARIABLE}}optional/oxlint`);
      const unsetServer = await service.getOxlintServerBinPath();

      strictEqual(unsetServer?.path, `${workspace_path}${sep}optional${sep}oxlint`);

      process.env[ENV_VARIABLE] = "package/";
      const packageServer = await service.getOxlintServerBinPath();

      strictEqual(packageServer?.path, `${workspace_path}${sep}package${sep}optional${sep}oxlint`);
      await deleteWorkspaceFolderFileUri("optional/oxlint");
      await deleteWorkspaceFolderFileUri("package/optional/oxlint");
    });

    test("falls back to the default search when the server path is empty after substitution", async () => {
      const service = new ConfigService();
      const defaultServer = await service.getOxlintServerBinPath();

      notStrictEqual(defaultServer, undefined);

      await conf.update("path.oxlint", `\${env:${ENV_VARIABLE}}`);
      deepStrictEqual(await service.getOxlintServerBinPath(), defaultServer);

      process.env[ENV_VARIABLE] = "";
      deepStrictEqual(await service.getOxlintServerBinPath(), defaultServer);
    });

    test("returns backslashes path on Windows", async () => {
      if (process.platform !== "win32") {
        return;
      }

      await createWorkspaceFolderFileUri("./relative/oxlint");
      const service = new ConfigService();
      await conf.update("path.oxlint", "./relative/oxlint");
      const relativeServer = await service.getOxlintServerBinPath();
      const workspace_path = getWorkspaceFolderPlatformSafe();

      strictEqual(
        workspace_path[1],
        ":",
        "The test workspace folder must be an absolute path with a drive letter on Windows",
      );
      strictEqual(relativeServer?.path, `${workspace_path}\\relative\\oxlint`);

      await deleteWorkspaceFolderFileUri("./relative/oxlint");
    });
  });
});
