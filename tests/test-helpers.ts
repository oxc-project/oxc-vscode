import {
  extensions,
  languages,
  Uri,
  WorkspaceEdit,
  type WorkspaceFolder,
  workspace,
} from "vscode";

export type Func = (this: Mocha.Context, done: Mocha.Done) => void;

type BiomeConfigIgnorePatterns = string[];
type BiomeConfigRules = Record<string, unknown>;
type BiomeConfigOverride = {
  includes?: string[];
  linter?: {
    rules?: BiomeConfigRules;
  };
};

export type BiomeConfig = {
  linter?: {
    enabled?: boolean;
    rules?: BiomeConfigRules;
  };
  overrides?: BiomeConfigOverride[];
  ignorePatterns?: BiomeConfigIgnorePatterns;
};

export const WORKSPACE_FOLDER: WorkspaceFolder =
  workspace.workspaceFolders?.[0];
export const WORKSPACE_SECOND_FOLDER: WorkspaceFolder | undefined =
  workspace.workspaceFolders?.[1];

export const WORKSPACE_DIR = WORKSPACE_FOLDER.uri;
export const WORKSPACE_SECOND_DIR = WORKSPACE_SECOND_FOLDER?.uri;

const rootBiomeConfigUri = Uri.joinPath(WORKSPACE_DIR, ".biomerc.json");

export function testSingleFolderMode(title: string, fn: Func) {
  if (process.env.SINGLE_FOLDER_WORKSPACE !== "true") {
    return;
  }

  test(`${title} (single folder workspace)`, fn);
}

export function testMultiFolderMode(title: string, fn: Func) {
  if (process.env.MULTI_FOLDER_WORKSPACE !== "true") {
    return;
  }

  test(`${title} (multi folder workspace)`, fn);
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function activateExtension(full: boolean = true): Promise<void> {
  const ext = extensions.getExtension("simwai.biome-vscode")!;
  if (!ext.isActive) {
    await ext.activate();
  }

  if (full) {
    // wait for initialized requests
    await sleep(250);
  }
}

export async function createBiomeConfiguration(
  configuration: BiomeConfig,
): Promise<void> {
  const edit = new WorkspaceEdit();
  edit.createFile(rootBiomeConfigUri, {
    contents: Buffer.from(JSON.stringify(configuration)),
    overwrite: true,
  });
  await workspace.applyEdit(edit);
}

export async function deleteBiomeConfiguration(): Promise<void> {
  const edit = new WorkspaceEdit();
  edit.deleteFile(rootBiomeConfigUri, { ignoreIfNotExists: true });
  await workspace.applyEdit(edit);
}

export async function waitForDiagnosticChange(): Promise<void> {
  return new Promise<void>((resolve) =>
    languages.onDidChangeDiagnostics(() => {
      resolve();
    }),
  );
}
