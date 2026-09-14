import { existsSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";

export interface VitePlusProject {
  /** The declaring ancestor, or the nearest package/workspace root in forced mode. */
  root: string;
  /** Undefined means Vite+ is selected but is not installed locally. */
  vpPath?: string;
}

interface PackageJson {
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
  workspaces?: unknown;
}

function readPackageJson(dir: string): PackageJson | null {
  try {
    return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

function isRootWorkspace(dir: string, pkg: PackageJson | null): boolean {
  return (
    existsSync(path.join(dir, "pnpm-workspace.yaml")) ||
    existsSync(path.join(dir, "lerna.json")) ||
    Boolean(pkg?.workspaces)
  );
}

/**
 * Implements Phases 1 and 2 of the editor detection RFC. The bound is the
 * monorepo root, which can be above the folder opened in the editor.
 * Global lookup belongs to the caller and must only run for a non-null result.
 * https://github.com/voidzero-dev/vite-plus/pull/1614
 */
export function detectVitePlusProject(
  start: string,
  forceVitePlus = false,
  workspaceFolder?: string,
): VitePlusProject | null {
  let dir = path.resolve(start);
  try {
    if (statSync(dir).isFile()) {
      dir = path.dirname(dir);
    }
  } catch {
    // The caller can also pass a directory that does not exist yet.
  }

  let pkg = readPackageJson(dir);
  if (forceVitePlus) {
    // Explicit opt-in skips dependency detection, but still needs a stable cwd
    // when the active document moves between source directories.
    const fallbackRoot = workspaceFolder ? path.resolve(workspaceFolder) : dir;
    while (!pkg && !isRootWorkspace(dir, pkg)) {
      const parent = path.dirname(dir);
      if ((workspaceFolder && dir === fallbackRoot) || parent === dir) {
        dir = fallbackRoot;
        pkg = readPackageJson(dir);
        break;
      }
      dir = parent;
      pkg = readPackageJson(dir);
    }
  } else {
    while (!pkg?.dependencies?.["vite-plus"] && !pkg?.devDependencies?.["vite-plus"]) {
      const parent = path.dirname(dir);
      if (isRootWorkspace(dir, pkg) || dir === parent) {
        return null;
      }
      dir = parent;
      pkg = readPackageJson(dir);
    }
  }

  const root = dir;
  const binNames = process.platform === "win32" ? ["vp.cmd", "vp.exe"] : ["vp"];
  while (true) {
    for (const name of binNames) {
      const vpPath = path.join(dir, "node_modules", ".bin", name);
      if (existsSync(vpPath)) {
        return { root, vpPath };
      }
    }
    const parent = path.dirname(dir);
    if (isRootWorkspace(dir, pkg) || dir === parent) {
      return { root };
    }
    dir = parent;
    pkg = readPackageJson(dir);
  }
}

export class VitePlusError extends Error {}
