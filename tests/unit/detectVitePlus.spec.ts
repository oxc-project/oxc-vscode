import { deepStrictEqual, strictEqual } from "assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { detectVitePlusProject } from "../../client/detectVitePlus";
import { mockProcessPlatform } from "../processMocks";

suite("detectVitePlusProject", () => {
  let root: string;
  const setPlatform = mockProcessPlatform();

  function file(relative: string, content = ""): string {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
    return target;
  }

  function pkg(
    relative = "",
    value: object = { devDependencies: { "vite-plus": "latest" } },
  ): string {
    return file(path.join(relative, "package.json"), JSON.stringify(value));
  }

  function shim(relative = ""): string {
    return file(
      path.join(relative, "node_modules/.bin", process.platform === "win32" ? "vp.cmd" : "vp"),
    );
  }

  setup(() => {
    root = mkdtempSync(path.join(tmpdir(), "detect-vite-plus-"));
    file("pnpm-workspace.yaml");
  });

  teardown(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("root-declared-and-installed, starting from a file", () => {
    pkg();
    const vpPath = shim();
    const start = file("src/index.ts");
    deepStrictEqual(detectVitePlusProject(start), { root, vpPath });
  });

  test("pnpm-subpackage-declared-root-hoisted", () => {
    pkg("packages/app");
    const vpPath = shim();
    const start = file("packages/app/src/index.ts");
    deepStrictEqual(detectVitePlusProject(start), {
      root: path.join(root, "packages/app"),
      vpPath,
    });
  });

  test("npm-subpackage-direct-dep-unhoisted", () => {
    rmSync(path.join(root, "pnpm-workspace.yaml"));
    pkg("", { workspaces: ["packages/*"] });
    pkg("packages/app", { dependencies: { "vite-plus": "latest" } });
    const vpPath = shim("packages/app");
    deepStrictEqual(detectVitePlusProject(path.join(root, "packages/app")), {
      root: path.join(root, "packages/app"),
      vpPath,
    });
  });

  test("root-declared-no-local-no-global", () => {
    pkg();
    deepStrictEqual(detectVitePlusProject(root), { root });
  });

  test("transitive-install", () => {
    pkg("", { dependencies: { other: "latest" } });
    pkg("node_modules/vite-plus", { name: "vite-plus" });
    shim();
    strictEqual(detectVitePlusProject(root), null);
  });

  test("plain-non-vite-plus", () => {
    pkg("", {
      name: "plain",
      peerDependencies: { "vite-plus": "latest" },
      optionalDependencies: { "vite-plus": "latest" },
    });
    strictEqual(detectVitePlusProject(root), null);
  });

  test("yarn4-pnp", () => {
    pkg();
    file(".pnp.cjs", "throw new Error('the detector must not execute PnP code')");
    deepStrictEqual(detectVitePlusProject(root), { root });
  });

  for (const marker of ["pnpm", "npm", "lerna"]) {
    test(`parent-vite-plus-nested-repo (${marker})`, () => {
      pkg();
      shim();
      pkg("nested", marker === "npm" ? { workspaces: ["packages/*"] } : {});
      if (marker !== "npm")
        file(`nested/${marker === "pnpm" ? "pnpm-workspace.yaml" : "lerna.json"}`);
      const start = file("nested/src/index.ts");
      strictEqual(detectVitePlusProject(start), null);
    });

    test(`does not resolve a local binary above a ${marker} workspace`, () => {
      pkg();
      shim();
      pkg("nested", {
        dependencies: { "vite-plus": "latest" },
        ...(marker === "npm" ? { workspaces: [] } : {}),
      });
      if (marker !== "npm")
        file(`nested/${marker === "pnpm" ? "pnpm-workspace.yaml" : "lerna.json"}`);
      deepStrictEqual(detectVitePlusProject(path.join(root, "nested")), {
        root: path.join(root, "nested"),
      });
    });
  }

  test("continues past malformed package.json files", () => {
    pkg();
    const vpPath = shim();
    const start = file("src/package.json", "{");
    deepStrictEqual(detectVitePlusProject(start), { root, vpPath });
  });

  test("explicit opt-in does not require a dependency declaration", () => {
    pkg("", {});
    const vpPath = shim();
    deepStrictEqual(detectVitePlusProject(root, true), { root, vpPath });
  });

  for (const marker of ["package", "workspace", "none"]) {
    test(`forced mode has a stable project root with ${marker} metadata`, () => {
      if (marker !== "workspace") rmSync(path.join(root, "pnpm-workspace.yaml"));
      if (marker === "package") pkg("", {});
      const vpPath = shim();
      const firstFile = file("src/pages/index.ts");
      const secondFile = file("src/components/button.ts");
      deepStrictEqual(detectVitePlusProject(firstFile, true, root), { root, vpPath });
      deepStrictEqual(detectVitePlusProject(secondFile, true, root), { root, vpPath });
    });
  }

  test("forced mode retains a nested package root and a hoisted install", () => {
    pkg("packages/app", {});
    const vpPath = shim();
    const start = file("packages/app/src/index.ts");
    deepStrictEqual(detectVitePlusProject(start, true, root), {
      root: path.join(root, "packages/app"),
      vpPath,
    });
  });

  test("prefers the nearest declaring package and its install", () => {
    pkg();
    shim();
    pkg("packages/app");
    const vpPath = shim("packages/app");
    deepStrictEqual(detectVitePlusProject(path.join(root, "packages/app")), {
      root: path.join(root, "packages/app"),
      vpPath,
    });
  });

  test("selects vp.cmd on Windows", () => {
    setPlatform("win32");
    pkg();
    file("node_modules/.bin/vp");
    file("node_modules/.bin/vp.exe");
    const vpPath = shim();
    deepStrictEqual(detectVitePlusProject(root), { root, vpPath });
  });

  test("selects a local vp.exe shim on Windows before a hoisted vp.cmd", () => {
    setPlatform("win32");
    pkg("packages/app");
    shim();
    const vpPath = file("packages/app/node_modules/.bin/vp.exe");
    deepStrictEqual(detectVitePlusProject(path.join(root, "packages/app")), {
      root: path.join(root, "packages/app"),
      vpPath,
    });
  });
});
