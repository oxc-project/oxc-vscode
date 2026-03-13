import { deepStrictEqual, strictEqual } from "assert";
import { workspace, WorkspaceFolder } from "vscode";
import { ConfigService } from "../../client/ConfigService.js";
import { WORKSPACE_FOLDER } from "../test-helpers.js";
import { sep } from "node:path";

const conf = workspace.getConfiguration("oxc");

suite("ConfigService", () => {
  setup(async () => {
    const keys = ["path.server", "path.oxlint", "path.oxfmt", "path.tsgolint"];

    await Promise.all(keys.map((key) => conf.update(key, undefined)));
  });

  teardown(async () => {
    const keys = ["path.server", "path.oxlint", "path.oxfmt", "path.tsgolint"];

    await Promise.all(keys.map((key) => conf.update(key, undefined)));
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

  suite("getOxfmtBinPathForFolder", () => {
    test("falls back to node resolving when server path is not set", async () => {
      const service = new ConfigService();
      const oxfmtPath = (await service.getOxfmtBinPathForFolder(WORKSPACE_FOLDER))!;
      const cwd = process.env.VSCODE_CWD!.replace(`${sep}editors${sep}vscode`, "");

      // it targets the oxc project's oxlint/bin/oxlint path
      strictEqual(oxfmtPath.startsWith(cwd), true, "path should start with cwd");
      strictEqual(
        oxfmtPath.endsWith(`oxfmt${sep}bin${sep}oxfmt`),
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
      const absoluteServerPath = await service.getOxfmtBinPathForFolder(WORKSPACE_FOLDER);

      strictEqual(absoluteServerPath, `${workspace_path}/absolute/oxfmt`);

      await conf.update("path.oxfmt", "./relative/oxfmt");
      const relativeServerPath = await service.getOxfmtBinPathForFolder(WORKSPACE_FOLDER);

      strictEqual(relativeServerPath, `${workspace_path}${sep}relative${sep}oxfmt`);

      await deleteWorkspaceFolderFileUri("absolute/oxfmt");
      await deleteWorkspaceFolderFileUri("relative/oxfmt");
    });

    test("returns undefined for unsafe server path", async () => {
      await createWorkspaceFolderFileUri("../unsafe/oxfmt");
      const service = new ConfigService();
      await conf.update("path.oxfmt", "../unsafe/oxfmt");
      const unsafeServerPath = await service.getOxfmtBinPathForFolder(WORKSPACE_FOLDER);

      strictEqual(unsafeServerPath, undefined);
      await deleteWorkspaceFolderFileUri("../unsafe/oxfmt");
    });

    test("returns backslashes path on Windows", async () => {
      if (process.platform !== "win32") {
        return;
      }
      await createWorkspaceFolderFileUri("./relative/oxfmt");
      const service = new ConfigService();
      await conf.update("path.oxfmt", "./relative/oxfmt");
      const relativeServerPath = await service.getOxfmtBinPathForFolder(WORKSPACE_FOLDER);
      const workspace_path = getWorkspaceFolderPlatformSafe();

      strictEqual(
        workspace_path[1],
        ":",
        "The test workspace folder must be an absolute path with a drive letter on Windows",
      );
      strictEqual(relativeServerPath, `${workspace_path}\\relative\\oxfmt`);
      await deleteWorkspaceFolderFileUri("./relative/oxfmt");
    });
  });

  suite("oxlintConfigForFolder", () => {
    test("returns config for a known workspace folder", () => {
      const service = new ConfigService();
      const result = service.oxlintConfigForFolder(WORKSPACE_FOLDER);

      strictEqual(result.length, 1);
      strictEqual(result[0].workspaceUri, WORKSPACE_FOLDER.uri.toString());
      strictEqual(typeof result[0].options, "object");
      strictEqual(typeof result[0].options.disableNestedConfig, "boolean");
    });

    test("returns empty array for an unknown folder", () => {
      const service = new ConfigService();
      const fakeFolder = {
        uri: WORKSPACE_FOLDER.uri.with({ path: "/non-existent-folder" }),
        name: "fake",
        index: 99,
      } as WorkspaceFolder;
      const result = service.oxlintConfigForFolder(fakeFolder);

      deepStrictEqual(result, []);
    });
  });

  suite("formatterConfigForFolder", () => {
    test("returns config for a known workspace folder", () => {
      const service = new ConfigService();
      const result = service.formatterConfigForFolder(WORKSPACE_FOLDER);

      strictEqual(result.length, 1);
      strictEqual(result[0].workspaceUri, WORKSPACE_FOLDER.uri.toString());
      strictEqual(typeof result[0].options, "object");
    });

    test("returns empty array for an unknown folder", () => {
      const service = new ConfigService();
      const fakeFolder = {
        uri: WORKSPACE_FOLDER.uri.with({ path: "/non-existent-folder" }),
        name: "fake",
        index: 99,
      } as WorkspaceFolder;
      const result = service.formatterConfigForFolder(fakeFolder);

      deepStrictEqual(result, []);
    });
  });

  suite("getOxlintBinPathForFolder", () => {
    test("falls back to node resolving when server path is not set", async () => {
      const service = new ConfigService();
      const oxlintPath = (await service.getOxlintBinPathForFolder(WORKSPACE_FOLDER))!;
      const cwd = process.env.VSCODE_CWD!.replace(`${sep}editors${sep}vscode`, "");

      // it targets the oxc project's oxlint/bin/oxlint path
      strictEqual(oxlintPath.startsWith(cwd), true, "path should start with cwd");
      strictEqual(
        oxlintPath.endsWith(`oxlint${sep}bin${sep}oxlint`),
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
      const absoluteServerPath = await service.getOxlintBinPathForFolder(WORKSPACE_FOLDER);

      strictEqual(absoluteServerPath, `${workspace_path}/absolute/oxlint`);

      await conf.update("path.oxlint", "./relative/oxlint");
      const relativeServerPath = await service.getOxlintBinPathForFolder(WORKSPACE_FOLDER);

      strictEqual(relativeServerPath, `${workspace_path}${sep}relative${sep}oxlint`);

      await deleteWorkspaceFolderFileUri("absolute/oxlint");
      await deleteWorkspaceFolderFileUri("relative/oxlint");
    });

    test("returns undefined for unsafe server path", async () => {
      await createWorkspaceFolderFileUri("../unsafe/oxlint");
      const service = new ConfigService();
      await conf.update("path.oxlint", "../unsafe/oxlint");
      const unsafeServerPath = await service.getOxlintBinPathForFolder(WORKSPACE_FOLDER);

      strictEqual(unsafeServerPath, undefined);
      await deleteWorkspaceFolderFileUri("../unsafe/oxlint");
    });

    test("returns backslashes path on Windows", async () => {
      if (process.platform !== "win32") {
        return;
      }

      await createWorkspaceFolderFileUri("./relative/oxlint");
      const service = new ConfigService();
      await conf.update("path.oxlint", "./relative/oxlint");
      const relativeServerPath = await service.getOxlintBinPathForFolder(WORKSPACE_FOLDER);
      const workspace_path = getWorkspaceFolderPlatformSafe();

      strictEqual(
        workspace_path[1],
        ":",
        "The test workspace folder must be an absolute path with a drive letter on Windows",
      );
      strictEqual(relativeServerPath, `${workspace_path}\\relative\\oxlint`);

      await deleteWorkspaceFolderFileUri("./relative/oxlint");
    });
  });
});
