import { strictEqual } from "assert";
import { ConfigurationTarget, Uri, workspace } from "vscode";
import { DiagnosticPullMode } from "vscode-languageclient";
import { ConfigService } from "../../client/ConfigService.js";
import { WORKSPACE_FOLDER, WORKSPACE_SECOND_FOLDER } from "../test-helpers.js";
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
      strictEqual(absoluteServer?.path, `${workspace_path}/absolute/oxfmt`);

      await conf.update("path.oxfmt", "./relative/oxfmt");
      const relativeServer = await service.getOxfmtServerBinPath();

      strictEqual(relativeServer?.loader, "native");
      strictEqual(relativeServer?.path, `${workspace_path}${sep}relative${sep}oxfmt`);

      await deleteWorkspaceFolderFileUri("absolute/oxfmt");
      await deleteWorkspaceFolderFileUri("relative/oxfmt");
    });

    test("returns undefined for unsafe server path", async () => {
      await createWorkspaceFolderFileUri("../unsafe/oxfmt");
      const service = new ConfigService();
      await conf.update("path.oxfmt", "../unsafe/oxfmt");
      const unsafeServerPath = await service.getOxfmtServerBinPath();

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

  suite("resource scoped enable settings", () => {
    const enableKeys = ["enable", "enable.oxlint", "enable.oxfmt", "requireConfig"];
    const folders = [WORKSPACE_FOLDER, WORKSPACE_SECOND_FOLDER].filter(
      (folder) => folder !== undefined,
    );

    const resetEnableKeys = async () => {
      await Promise.all([
        ...enableKeys.map((key) => conf.update(key, undefined)),
        // the user settings are shared by every suite, they must not keep a value
        ...enableKeys.map((key) => conf.update(key, undefined, ConfigurationTarget.Global)),
        ...folders.flatMap((folder) =>
          enableKeys.map((key) =>
            workspace
              .getConfiguration("oxc", folder)
              .update(key, undefined, ConfigurationTarget.WorkspaceFolder),
          ),
        ),
      ]);
    };

    setup(resetEnableKeys);
    teardown(resetEnableKeys);

    test("a workspace folder can disable oxlint on its own", async () => {
      if (WORKSPACE_SECOND_FOLDER === undefined) {
        return;
      }

      await workspace
        .getConfiguration("oxc", WORKSPACE_SECOND_FOLDER)
        .update("enable.oxlint", false, ConfigurationTarget.WorkspaceFolder);

      const service = new ConfigService();
      const firstFile = Uri.joinPath(WORKSPACE_FOLDER.uri, "index.js");
      const secondFile = Uri.joinPath(WORKSPACE_SECOND_FOLDER.uri, "index.js");

      strictEqual(service.isToolEnabled("oxlint", firstFile), true);
      strictEqual(service.isToolEnabled("oxlint", secondFile), false);
      // oxfmt is not affected
      strictEqual(service.isToolEnabled("oxfmt", secondFile), true);

      service.dispose();
    });

    test("rule 4: a workspace folder which overrides the window value is reported", async () => {
      // rule 4 of the `ClientLifecycle` semantics: the toggle is window wide, and it tells the
      // user when the settings of a workspace folder take precedence over it
      if (WORKSPACE_SECOND_FOLDER === undefined) {
        return;
      }

      await workspace
        .getConfiguration("oxc", WORKSPACE_SECOND_FOLDER)
        .update("enable.oxlint", false, ConfigurationTarget.WorkspaceFolder);

      const service = new ConfigService();

      // the window value is `true`, the second workspace folder overrides it
      strictEqual(service.overridesToolEnabled("oxlint", WORKSPACE_SECOND_FOLDER.uri), true);
      strictEqual(service.overridesToolEnabled("oxlint", WORKSPACE_FOLDER.uri), false);
      strictEqual(service.overridesToolEnabled("oxfmt", WORKSPACE_SECOND_FOLDER.uri), false);

      service.dispose();
    });

    test("rule 3: a document outside of every workspace folder follows the window value", async () => {
      // rule 3 of the `ClientLifecycle` semantics, the diagnostics follow the same rule
      const outside = Uri.file("/tmp/outside-of-the-workspace/index.js");

      const service = new ConfigService();
      // the window value enables oxlint, the default run trigger is `onType`
      strictEqual(service.shouldRequestDiagnostics(outside, DiagnosticPullMode.onType), true);
      strictEqual(service.shouldRequestDiagnostics(outside, DiagnosticPullMode.onSave), false);
      service.dispose();

      await conf.update("enable.oxlint", false);

      const disabledService = new ConfigService();
      strictEqual(
        disabledService.shouldRequestDiagnostics(outside, DiagnosticPullMode.onType),
        false,
      );
      disabledService.dispose();
    });

    test("rule 6: `oxc.requireConfig` is read per workspace folder", async () => {
      if (WORKSPACE_SECOND_FOLDER === undefined) {
        return;
      }

      await workspace
        .getConfiguration("oxc", WORKSPACE_SECOND_FOLDER)
        .update("requireConfig", true, ConfigurationTarget.WorkspaceFolder);

      const service = new ConfigService();

      // rule 6 of the `ClientLifecycle` semantics
      strictEqual(service.requiresConfig(WORKSPACE_FOLDER.uri), false);
      strictEqual(service.requiresConfig(WORKSPACE_SECOND_FOLDER.uri), true);
      strictEqual(service.requiresConfigInAnyWorkspace(), true);

      service.dispose();
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
      strictEqual(absoluteServer?.path, `${workspace_path}/absolute/oxlint`);

      await conf.update("path.oxlint", "./relative/oxlint");
      const relativeServer = await service.getOxlintServerBinPath();

      strictEqual(relativeServer?.loader, "native");
      strictEqual(relativeServer?.path, `${workspace_path}${sep}relative${sep}oxlint`);

      await deleteWorkspaceFolderFileUri("absolute/oxlint");
      await deleteWorkspaceFolderFileUri("relative/oxlint");
    });

    test("returns undefined for unsafe server path", async () => {
      await createWorkspaceFolderFileUri("../unsafe/oxlint");
      const service = new ConfigService();
      await conf.update("path.oxlint", "../unsafe/oxlint");
      const unsafeServerPath = await service.getOxlintServerBinPath();

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
