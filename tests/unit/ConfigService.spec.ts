import { strictEqual } from "node:assert";
import { workspace } from "vscode";
import { ConfigService } from "../../client/ConfigService.js";
import test, { suite } from 'node:test';

suite("ConfigService", () => {
  test("biomeServerConfig correctly maps workspace configs", () => {
    const configService = new ConfigService();
    const serverConfigs = configService.biomeServerConfig;

    strictEqual(serverConfigs.length, workspace.workspaceFolders?.length ?? 0);
    if (serverConfigs.length > 0) {
      strictEqual(
        serverConfigs[0].workspaceUri,
        workspace.workspaceFolders?.[0].uri.toString(),
      );
    }
  });
});
