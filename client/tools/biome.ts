import {
  type ConfigurationChangeEvent,
  commands,
  type LogOutputChannel,
  Uri,
  window,
  workspace,
} from "vscode";
import { ExecuteCommandRequest } from "vscode-languageclient";
import {
  type ConfigurationParams,
  type Executable,
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  ShowMessageNotification,
} from "vscode-languageclient/node";
import { ConfigService } from "../ConfigService";
import { BiomeCommands, LspCommands } from "../commands";
import type { BinarySearchResult } from "../findBinary";
import type StatusBarItemHandler from "../StatusBarItemHandler";
import { biomeConfigDefaultFilePattern } from "../WorkspaceConfig";
import { onClientNotification, runExecutable } from "./lsp_helper";
import type ToolInterface from "./ToolInterface";

const languageClientName = "biome";

export default class BiomeTool implements ToolInterface {
  private client: LanguageClient | undefined;
  private disposeResources: (() => Promise<void>) | undefined;
  private allowedToStartServer: boolean = false;

  getLspVersion(): string | undefined {
    return this.client?.initializeResult?.serverInfo?.version;
  }

  async getBinary(
    outputChannel: LogOutputChannel,
    configService: ConfigService,
  ): Promise<BinarySearchResult | undefined> {
    const bin = await configService.getBiomeServerBinPath();
    if (bin) {
      return bin;
    }
    outputChannel.error("No valid biome binary found.");
    return undefined;
  }

  async activate(
    outputChannel: LogOutputChannel,
    configService: ConfigService,
    statusBarItemHandler: StatusBarItemHandler,
    binary?: BinarySearchResult,
  ): Promise<void> {
    if (!binary) {
      statusBarItemHandler.updateTool(
        "biome",
        false,
        "No valid biome binary found.",
      );
      outputChannel.appendLine(
        "No valid biome binary found. Biome will not be activated.",
      );
      return;
    }

    this.allowedToStartServer = configService.vsCodeConfig.requireConfig
      ? (
          await workspace.findFiles(
            biomeConfigDefaultFilePattern,
            "**/node_modules/**",
            1,
          )
        ).length > 0
      : true;

    const restartCommand = commands.registerCommand(
      BiomeCommands.RestartServerLint,
      async () => {
        await this.restartClient();
        this.updateStatusBar(statusBarItemHandler, configService);
      },
    );

    const toggleEnable = commands.registerCommand(
      BiomeCommands.ToggleEnableLint,
      async () => {
        await configService.vsCodeConfig.updateEnableBiome(
          !configService.vsCodeConfig.enableBiome,
        );
      },
    );

    const applyAllFixesFile = commands.registerCommand(
      BiomeCommands.ApplyAllFixesFile,
      async () => {
        if (!this.client) {
          window.showErrorMessage("biome client not found");
          return;
        }
        const textEditor = window.activeTextEditor;
        if (!textEditor) {
          window.showErrorMessage("active text editor not found");
          return;
        }

        const params = {
          command: LspCommands.FixAll,
          arguments: [{ uri: textEditor.document.uri.toString() }],
        };

        await this.client.sendRequest(ExecuteCommandRequest.type, params);
      },
    );

    const run: Executable = runExecutable(
      binary,
      configService.vsCodeConfig.useExecPath,
      configService.vsCodeConfig.nodePath,
    );
    const serverOptions: ServerOptions = { run, debug: run };

    outputChannel.info(`Using server binary at: ${binary?.path}`);

    const clientOptions: LanguageClientOptions = {
      documentSelector: [
        { language: "javascript", scheme: "file" },
        { language: "typescript", scheme: "file" },
        { language: "javascriptreact", scheme: "file" },
        { language: "typescriptreact", scheme: "file" },
        { language: "json", scheme: "file" },
        { language: "jsonc", scheme: "file" },
        { language: "css", scheme: "file" },
        { language: "graphql", scheme: "file" },
      ],
      initializationOptions: configService.biomeServerConfig,
      outputChannel,
      traceOutputChannel: outputChannel,
      middleware: {
        workspace: {
          configuration: (params: ConfigurationParams) => {
            return params.items.map((item) => {
              if (item.section !== "biome") {
                return null;
              }
              if (item.scopeUri === undefined) {
                return null;
              }
              return (
                configService
                  .getWorkspaceConfig(Uri.parse(item.scopeUri))
                  ?.toBiomeConfig() ?? null
              );
            });
          },
        },
      },
    };

    this.client = new LanguageClient(
      languageClientName,
      serverOptions,
      clientOptions,
    );

    const onNotificationDispose = this.client.onNotification(
      ShowMessageNotification.type,
      (params) => {
        onClientNotification(params, outputChannel);
      },
    );

    this.disposeResources = async () => {
      await this.client?.dispose();
      restartCommand.dispose();
      toggleEnable.dispose();
      applyAllFixesFile.dispose();
      onNotificationDispose.dispose();
    };

    if (this.allowedToStartServer && configService.vsCodeConfig.enableBiome) {
      await this.client.start();
    }

    this.updateStatusBar(statusBarItemHandler, configService);
  }

  async deactivate(): Promise<void> {
    try {
      await this.client?.stop();
    } catch {}
    await this.disposeResources?.();
    this.disposeResources = undefined;
    this.client = undefined;
  }

  async restartClient(): Promise<void> {
    if (this.client === undefined) {
      window.showErrorMessage("biome client not found");
      return;
    }

    try {
      if (this.client.isRunning()) {
        await this.client.restart();
        window.showInformationMessage("biome server restarted.");
      } else {
        await this.client.start();
      }
    } catch (err) {
      this.client.error("Restarting biome client failed", err, "force");
    }
  }

  async onConfigChange(
    event: ConfigurationChangeEvent,
    configService: ConfigService,
    statusBarItemHandler: StatusBarItemHandler,
  ): Promise<void> {
    if (event.affectsConfiguration(`${ConfigService.namespace}.enable`)) {
      if (this.client) {
        if (
          configService.vsCodeConfig.enableBiome &&
          !this.client.isRunning()
        ) {
          await this.client.start();
        } else if (
          !configService.vsCodeConfig.enableBiome &&
          this.client.isRunning()
        ) {
          await this.client.stop();
        }
      }
    }
    this.updateStatusBar(statusBarItemHandler, configService);

    if (
      this.client?.isRunning() &&
      configService.effectsWorkspaceConfigChange(event)
    ) {
      await this.client.sendNotification("workspace/didChangeConfiguration", {
        settings: configService.biomeServerConfig,
      });
    }
  }

  private updateStatusBar(
    statusBarItemHandler: StatusBarItemHandler,
    configService: ConfigService,
  ) {
    const enable = configService.vsCodeConfig.enableBiome;
    const isEnabled = this.allowedToStartServer && enable;

    let text =
      `[$(terminal) Open Output](command:${BiomeCommands.ShowOutputChannelLint})\n\n` +
      `[$(refresh) Restart Server](command:${BiomeCommands.RestartServerLint})\n\n`;

    if (enable) {
      text += `[$(stop) Stop Server](command:${BiomeCommands.ToggleEnableLint})\n\n`;
    } else {
      text += `[$(play) Start Server](command:${BiomeCommands.ToggleEnableLint})\n\n`;
    }

    statusBarItemHandler.updateTool(
      "biome",
      isEnabled,
      text,
      this.client?.initializeResult?.serverInfo?.version,
    );
  }
}
