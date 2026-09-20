import { deepStrictEqual, rejects, strictEqual } from "assert";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { mock } from "node:test";
import { commands, ConfigurationTarget, Uri, window, workspace } from "vscode";
import { ConfigService } from "../../client/ConfigService";
import type { BinarySearchResult } from "../../client/findBinary";
import { runExecutable } from "../../client/tools/lsp_helper";
import { WORKSPACE_FOLDER, WORKSPACE_SECOND_FOLDER } from "../test-helpers";
import { mockProcessEnv, mockProcessPlatform } from "../processMocks";

// Mock the shared CommonJS exports used by the compiled test modules.
const shellEnv: typeof import("../../client/getShellEnv") = require(
  path.join(__dirname, "../client/getShellEnv.js"),
);
const findBinary: typeof import("../../client/findBinary") = require(
  path.join(__dirname, "../client/findBinary.js"),
);

suite("Vite+ server selection", () => {
  const root = path.join(WORKSPACE_FOLDER.uri.fsPath, "vite-plus-tests");
  const secondRoot =
    WORKSPACE_SECOND_FOLDER && path.join(WORKSPACE_SECOND_FOLDER.uri.fsPath, "vite-plus-tests");
  const conf = workspace.getConfiguration("oxc", WORKSPACE_FOLDER.uri);
  const setPlatform = mockProcessPlatform();
  mockProcessEnv();
  let service: ConfigService;

  function file(relative: string, content = "", dir = root): string {
    const target = path.join(dir, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
    return target;
  }

  function declare(dir = root): void {
    file("package.json", JSON.stringify({ devDependencies: { "vite-plus": "latest" } }), dir);
  }

  function shim(dir = root): string {
    return file(
      path.join("node_modules/.bin", process.platform === "win32" ? "vp.cmd" : "vp"),
      "",
      dir,
    );
  }

  function standaloneTools(): Record<"oxlint" | "oxfmt", BinarySearchResult> {
    const binaries = {
      oxlint: { path: file("tools/oxlint.js"), loader: "node" as const },
      oxfmt: { path: file("tools/oxfmt.js"), loader: "node" as const },
    };
    mock.method(
      findBinary,
      "searchProjectNodeModulesBin",
      async (name: "oxlint" | "oxfmt") => binaries[name],
    );
    return binaries;
  }

  async function sources(lint: string, fmt: string): Promise<void> {
    await Promise.all([
      conf.update("lint.binarySource", lint, ConfigurationTarget.WorkspaceFolder),
      conf.update("fmt.binarySource", fmt, ConfigurationTarget.WorkspaceFolder),
    ]);
  }

  async function open(dir = root): Promise<void> {
    await window.showTextDocument(Uri.file(file("index.txt", "", dir)));
  }

  setup(async () => {
    findBinary.clearGlobalNodeModulesPathsCache();
    mock.method(shellEnv, "getShellEnv", async () => ({ PATH: process.env.PATH }));
    file("pnpm-workspace.yaml");
    await open();
    service = new ConfigService();
  });

  teardown(async () => {
    service.dispose();
    findBinary.clearGlobalNodeModulesPathsCache();
    mock.restoreAll();
    await commands.executeCommand("workbench.action.closeAllEditors");
    for (const folder of [WORKSPACE_FOLDER, WORKSPACE_SECOND_FOLDER]) {
      if (!folder) continue;
      const config = workspace.getConfiguration("oxc", folder.uri);
      // oxlint-disable-next-line no-await-in-loop -- reset each workspace folder
      await Promise.all(
        ["path.vp", "lint.binarySource", "fmt.binarySource"].map((key) =>
          config.update(key, undefined, ConfigurationTarget.WorkspaceFolder),
        ),
      );
    }
    await workspace.getConfiguration("oxc").update("path.oxlint", undefined);
    await workspace.getConfiguration("oxc").update("path.oxfmt", undefined);
    rmSync(root, { recursive: true, force: true });
    if (secondRoot) rmSync(secondRoot, { recursive: true, force: true });
  });

  test("uses vp lint/fmt for an active nested package", async () => {
    declare();
    const vpPath = shim();
    const [lint, fmt] = await Promise.all([
      service.getOxlintServerBinPath(),
      service.getOxfmtServerBinPath(),
    ]);
    deepStrictEqual(lint, { path: vpPath, loader: "native", cwd: root, vitePlus: "lint" });
    deepStrictEqual(fmt, { path: vpPath, loader: "native", cwd: root, vitePlus: "fmt" });
  });

  test("explicit sources work without a package.json dependency", async () => {
    const vpPath = shim();
    await sources("vite-plus", "vite-plus");
    strictEqual((await service.getOxlintServerBinPath())?.path, vpPath);
    strictEqual((await service.getOxfmtServerBinPath())?.vitePlus, "fmt");
  });

  test("explicit sources keep the same executable and cwd across source directories", async () => {
    file("package.json", "{}");
    const vpPath = shim();
    await sources("vite-plus", "vite-plus");
    await open(path.join(root, "src/pages"));
    const first = await service.getOxlintServerBinPath();
    await open(path.join(root, "src/components"));
    deepStrictEqual(await service.getOxlintServerBinPath(), first);
    deepStrictEqual(first, { path: vpPath, loader: "native", cwd: root, vitePlus: "lint" });
    strictEqual((await service.getOxfmtServerBinPath())?.cwd, root);
  });

  test("an explicit vp path opts in and resolves against the workspace folder", async () => {
    const vpPath = file("bin/custom-vp.js");
    await conf.update(
      "path.vp",
      "./vite-plus-tests/bin/custom-vp.js",
      ConfigurationTarget.WorkspaceFolder,
    );
    deepStrictEqual(await service.getOxlintServerBinPath(), {
      path: vpPath,
      loader: "node",
      cwd: WORKSPACE_FOLDER.uri.fsPath,
      vitePlus: "lint",
    });
    await commands.executeCommand("workbench.action.closeAllEditors");
    strictEqual(
      (await service.getOxfmtServerBinPath())?.path,
      vpPath,
      "uses workspace folders when no document is active",
    );
  });

  test("recognizes the extensionless vite-plus JavaScript entry point", async () => {
    const vpPath = file("node_modules/vite-plus/bin/vp");
    await conf.update("path.vp", vpPath, ConfigurationTarget.WorkspaceFolder);
    strictEqual((await service.getOxfmtServerBinPath())?.loader, "node");
  });

  test("invalid explicit vp paths give an error instead of falling back", async () => {
    declare();
    shim();
    await conf.update("path.vp", "./missing-vp", ConfigurationTarget.WorkspaceFolder);
    await rejects(service.getOxlintServerBinPath(), /Invalid Vite\+ binary.*oxc.path.vp/);
    await conf.update("path.vp", "../unsafe-vp", ConfigurationTarget.WorkspaceFolder);
    await rejects(service.getOxfmtServerBinPath(), /Invalid Vite\+ binary/);
  });

  test("explicit tool paths take priority over Vite+ for each tool", async () => {
    declare();
    shim();
    await sources("vite-plus", "vite-plus");
    const lintPath = file("custom/oxlint.js");
    const fmtPath = file("custom/oxfmt.js");
    await workspace.getConfiguration("oxc").update("path.oxlint", lintPath);
    strictEqual((await service.getOxlintServerBinPath())?.path, lintPath);
    strictEqual((await service.getOxlintServerBinPath())?.vitePlus, undefined);
    strictEqual((await service.getOxfmtServerBinPath())?.vitePlus, "fmt");
    await workspace.getConfiguration("oxc").update("path.oxfmt", fmtPath);
    strictEqual((await service.getOxfmtServerBinPath())?.path, fmtPath);
    strictEqual((await service.getOxfmtServerBinPath())?.vitePlus, undefined);
  });

  test("standalone sources ignore detection and an invalid explicit vp path", async () => {
    declare();
    shim();
    const binaries = standaloneTools();
    await conf.update("path.vp", "./missing-vp", ConfigurationTarget.WorkspaceFolder);
    await sources("oxc", "oxc");
    deepStrictEqual(await service.getOxlintServerBinPath(), binaries.oxlint);
    deepStrictEqual(await service.getOxfmtServerBinPath(), binaries.oxfmt);
  });

  for (const lintSource of ["auto", "vite-plus", "oxc"]) {
    for (const fmtSource of ["auto", "vite-plus", "oxc"]) {
      test(`selects tools independently: lint=${lintSource}, fmt=${fmtSource}`, async () => {
        declare();
        const vpPath = shim();
        const binaries = standaloneTools();
        await sources(lintSource, fmtSource);
        const [lint, fmt] = await Promise.all([
          service.getOxlintServerBinPath(),
          service.getOxfmtServerBinPath(),
        ]);
        deepStrictEqual(
          lint,
          lintSource === "oxc"
            ? binaries.oxlint
            : { path: vpPath, loader: "native", cwd: root, vitePlus: "lint" },
        );
        deepStrictEqual(
          fmt,
          fmtSource === "oxc"
            ? binaries.oxfmt
            : { path: vpPath, loader: "native", cwd: root, vitePlus: "fmt" },
        );
      });
    }
  }

  for (const command of ["lint", "fmt"] as const) {
    test(`forcing ${command} does not opt the other tool in without a dependency`, async () => {
      const vpPath = shim();
      const binaries = standaloneTools();
      await conf.update(
        `${command}.binarySource`,
        "vite-plus",
        ConfigurationTarget.WorkspaceFolder,
      );
      const [lint, fmt] = await Promise.all([
        service.getOxlintServerBinPath(),
        service.getOxfmtServerBinPath(),
      ]);
      if (command === "lint") {
        strictEqual(lint?.path, vpPath);
        deepStrictEqual(fmt, binaries.oxfmt);
      } else {
        deepStrictEqual(lint, binaries.oxlint);
        strictEqual(fmt?.path, vpPath);
      }
    });

    test(`an explicit vp path respects the standalone ${command} source`, async () => {
      const vpPath = file("bin/custom-vp.js");
      const binaries = standaloneTools();
      await conf.update("path.vp", vpPath, ConfigurationTarget.WorkspaceFolder);
      await conf.update(`${command}.binarySource`, "oxc", ConfigurationTarget.WorkspaceFolder);
      const [lint, fmt] = await Promise.all([
        service.getOxlintServerBinPath(),
        service.getOxfmtServerBinPath(),
      ]);
      if (command === "lint") {
        deepStrictEqual(lint, binaries.oxlint);
        strictEqual(fmt?.path, vpPath);
      } else {
        strictEqual(lint?.path, vpPath);
        deepStrictEqual(fmt, binaries.oxfmt);
      }
    });
  }

  test("root-declared-no-local-global-on-path", async () => {
    declare();
    const binDir = path.join(root, "global-bin");
    const vpPath = file(process.platform === "win32" ? "vp.cmd" : "vp", "", binDir);
    process.env.PATH = binDir;
    deepStrictEqual(await service.getOxlintServerBinPath(), {
      path: vpPath,
      loader: "native",
      cwd: root,
      vitePlus: "lint",
    });
    const localPath = shim();
    strictEqual(
      (await service.getOxlintServerBinPath())?.path,
      localPath,
      "local install must take priority after a restart",
    );
  });

  test("global-vp-without-declaration", async () => {
    const binDir = path.join(root, "global-bin");
    file(process.platform === "win32" ? "vp.cmd" : "vp", "", binDir);
    process.env.PATH = binDir;
    strictEqual((await service.getOxlintServerBinPath())?.vitePlus, undefined);
    strictEqual((await service.getOxfmtServerBinPath())?.vitePlus, undefined);
    await conf.update("lint.binarySource", "vite-plus", ConfigurationTarget.WorkspaceFolder);
    strictEqual(
      (await service.getOxlintServerBinPath())?.vitePlus,
      "lint",
      "explicit opt-in permits global resolution without a dependency",
    );
    strictEqual((await service.getOxfmtServerBinPath())?.vitePlus, undefined);
  });

  test("discovers global vp using the same shell PATH as the launcher", async () => {
    declare();
    const shellBin = path.join(root, "shell-bin");
    const vpPath = file(process.platform === "win32" ? "vp.cmd" : "vp", "", shellBin);
    process.env.PATH = path.join(root, "inherited-bin");
    mock.method(shellEnv, "getShellEnv", async () => ({ PATH: shellBin }));
    const binary = await service.getOxlintServerBinPath();
    strictEqual(binary?.path, vpPath);
    strictEqual((await runExecutable(binary!)).options?.env?.PATH, shellBin);
    strictEqual(
      process.env.PATH,
      path.join(root, "inherited-bin"),
      "shell discovery must not mutate the extension host environment",
    );
  });

  for (const extension of ["cmd", "exe"]) {
    test(`discovers global vp.${extension} from a Windows Path environment key`, async () => {
      declare();
      const shellBin = path.join(root, "shell-bin");
      const vpPath = file(`vp.${extension}`, "", shellBin);
      setPlatform("win32");
      for (const key of Object.keys(process.env)) {
        if (key.toUpperCase() === "PATH") delete process.env[key];
      }
      process.env.Path = shellBin;
      // Use a fresh instance of the real provider to exercise its environment copy.
      const { getShellEnv } = await import(`../../client/getShellEnv.ts?windowsPath=${extension}`);
      mock.method(shellEnv, "getShellEnv", getShellEnv);

      const binaries = await Promise.all([
        service.getOxlintServerBinPath(),
        service.getOxfmtServerBinPath(),
      ]);
      await Promise.all(
        binaries.map(async (binary) => {
          strictEqual(binary?.path, vpPath);
          const executable = await runExecutable(binary!, true);
          strictEqual(
            executable.options?.env?.PATH,
            `${path.dirname(process.execPath)}${path.delimiter}${shellBin}`,
          );
          strictEqual(executable.options?.env?.Path, undefined);
        }),
      );
      strictEqual(process.env.Path, shellBin);
      strictEqual(process.env.PATH, undefined);
    });
  }

  test("missing local and global installs give an install hint, even if plain tools exist", async () => {
    declare();
    process.env.PATH = root;
    mock.method(require("node:child_process"), "spawnSync", () => ({ status: 1 }));
    mock.method(require("node:os"), "homedir", () => root);
    await rejects(service.getOxlintServerBinPath(), /Vite\+ selected.*pnpm install/);
    await rejects(service.getOxfmtServerBinPath(), /Vite\+ selected.*pnpm install/);
    const vpPath = shim();
    strictEqual(
      (await service.getOxlintServerBinPath())?.path,
      vpPath,
      "missing installs must not be cached",
    );
  });

  test("explicit Vite+ sources report a missing install without falling back to standalone tools", async () => {
    standaloneTools();
    process.env.PATH = root;
    mock.method(require("node:child_process"), "spawnSync", () => ({ status: 1 }));
    mock.method(require("node:os"), "homedir", () => root);
    await sources("vite-plus", "vite-plus");
    await rejects(service.getOxlintServerBinPath(), /Vite\+ selected.*pnpm install/);
    await rejects(service.getOxfmtServerBinPath(), /Vite\+ selected.*pnpm install/);
  });

  test("resolves vp from a global vite-plus package, not a package named vp", async () => {
    declare();
    process.env.PATH = root;
    const globalModules = path.join(root, "global/node_modules");
    file(
      "vite-plus/package.json",
      JSON.stringify({ name: "vite-plus", bin: { vp: "bin/vp" } }),
      globalModules,
    );
    const vpPath = file("vite-plus/bin/vp", "", globalModules);
    mock.method(require("node:child_process"), "spawnSync", () => ({
      status: 0,
      stdout: globalModules,
    }));
    deepStrictEqual(await service.getOxfmtServerBinPath(), {
      path: vpPath,
      loader: "node",
      cwd: root,
      vitePlus: "fmt",
    });
  });

  test("reselects when navigating between Vite+ and plain workspace folders", async function () {
    if (!secondRoot) this.skip();
    declare();
    const vpPath = shim();
    strictEqual((await service.getOxlintServerBinPath())?.path, vpPath);
    file("pnpm-workspace.yaml", "", secondRoot!);
    await open(secondRoot!);
    strictEqual((await service.getOxlintServerBinPath())?.vitePlus, undefined);
    await open();
    strictEqual((await service.getOxlintServerBinPath())?.path, vpPath);
  });

  test("explicit settings are scoped to the active workspace folder", async function () {
    if (!secondRoot || !WORKSPACE_SECOND_FOLDER) this.skip();
    const firstPath = file("bin/vp.js");
    const secondPath = file("bin/vp.js", "", secondRoot!);
    await conf.update(
      "path.vp",
      "./vite-plus-tests/bin/vp.js",
      ConfigurationTarget.WorkspaceFolder,
    );
    await workspace
      .getConfiguration("oxc", WORKSPACE_SECOND_FOLDER!.uri)
      .update("path.vp", "./vite-plus-tests/bin/vp.js", ConfigurationTarget.WorkspaceFolder);
    strictEqual((await service.getOxlintServerBinPath())?.path, firstPath);
    await open(secondRoot!);
    strictEqual((await service.getOxlintServerBinPath())?.path, secondPath);
    strictEqual((await service.getOxfmtServerBinPath())?.cwd, WORKSPACE_SECOND_FOLDER!.uri.fsPath);
  });

  test("source settings follow the active workspace folder independently for each tool", async function () {
    if (!secondRoot || !WORKSPACE_SECOND_FOLDER) this.skip();
    declare();
    declare(secondRoot!);
    const firstPath = shim();
    const secondPath = shim(secondRoot!);
    const binaries = standaloneTools();
    await sources("oxc", "vite-plus");
    const secondConf = workspace.getConfiguration("oxc", WORKSPACE_SECOND_FOLDER!.uri);
    await secondConf.update("lint.binarySource", "vite-plus", ConfigurationTarget.WorkspaceFolder);
    await secondConf.update("fmt.binarySource", "oxc", ConfigurationTarget.WorkspaceFolder);
    deepStrictEqual(await service.getOxlintServerBinPath(), binaries.oxlint);
    strictEqual((await service.getOxfmtServerBinPath())?.path, firstPath);
    await open(secondRoot!);
    strictEqual((await service.getOxlintServerBinPath())?.path, secondPath);
    deepStrictEqual(await service.getOxfmtServerBinPath(), binaries.oxfmt);
    await open();
    deepStrictEqual(await service.getOxlintServerBinPath(), binaries.oxlint);
    strictEqual((await service.getOxfmtServerBinPath())?.path, firstPath);
  });

  test("a refresh replaces pending discovery without the old search clearing the new one", async () => {
    const vpPath = file("bin/vp.js");
    await conf.update("path.vp", vpPath, ConfigurationTarget.WorkspaceFolder);
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const searchSettingsBin = findBinary.searchSettingsBin;
    let lookups = 0;
    mock.method(
      findBinary,
      "searchSettingsBin",
      async (name: string, configuredPath: string, cwd?: string) => {
        await (++lookups === 1 ? firstGate : secondGate);
        return searchSettingsBin(name, configuredPath, cwd);
      },
    );
    const first = service.getOxlintServerBinPath();
    service.clearBinarySearchCaches();
    const second = service.getOxlintServerBinPath();
    try {
      strictEqual(lookups, 2, "refresh must start a new search");
      releaseFirst();
      await first;
      const third = service.getOxfmtServerBinPath();
      strictEqual(lookups, 2, "lint and format must still share the refreshed search");
      releaseSecond();
      strictEqual((await second)?.path, vpPath);
      strictEqual((await third)?.path, vpPath);
    } finally {
      releaseFirst();
      releaseSecond();
      await Promise.all([first, second]);
    }
  });

  for (const change of ["none", "folder", "setting", "source"] as const) {
    test(`shares an ongoing search only when its context is unchanged (${change})`, async function () {
      if (change === "folder" && (!secondRoot || !WORKSPACE_SECOND_FOLDER)) this.skip();
      const firstPath = file("bin/first-vp.js");
      const secondPath = file("bin/second-vp.js", "", change === "folder" ? secondRoot! : root);
      const standalone = change === "source" ? standaloneTools() : undefined;
      await conf.update("path.vp", firstPath, ConfigurationTarget.WorkspaceFolder);
      if (change === "folder") {
        await workspace
          .getConfiguration("oxc", WORKSPACE_SECOND_FOLDER!.uri)
          .update("path.vp", secondPath, ConfigurationTarget.WorkspaceFolder);
      }
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const searchSettingsBin = findBinary.searchSettingsBin;
      let firstPathLookups = 0;
      mock.method(
        findBinary,
        "searchSettingsBin",
        async (name: string, configuredPath: string, cwd?: string) => {
          if (configuredPath === firstPath) {
            firstPathLookups++;
            await gate;
          }
          return searchSettingsBin(name, configuredPath, cwd);
        },
      );
      const first = service.getOxlintServerBinPath();
      let second: ReturnType<ConfigService["getOxfmtServerBinPath"]>;
      try {
        if (change === "folder") await open(secondRoot!);
        if (change === "setting") {
          await conf.update("path.vp", secondPath, ConfigurationTarget.WorkspaceFolder);
        }
        if (change === "source") {
          await conf.update("fmt.binarySource", "oxc", ConfigurationTarget.WorkspaceFolder);
        }
        second = service.getOxfmtServerBinPath();
      } finally {
        release();
      }
      strictEqual((await first)?.path, firstPath);
      strictEqual(
        (await second!)?.path,
        standalone?.oxfmt.path ?? (change === "none" ? firstPath : secondPath),
      );
      strictEqual(firstPathLookups, 1, "matching lint/fmt requests should share discovery");
    });
  }
});
