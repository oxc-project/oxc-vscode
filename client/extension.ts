import {
  commands,
  type ExtensionContext,
  type LogOutputChannel,
  window,
  workspace,
} from "vscode";
import { ConfigService } from "./ConfigService";
import { BiomeCommands, copyDebugCommand } from "./commands";
import StatusBarItemHandler from "./StatusBarItemHandler";
import BiomeTool from "./tools/biome";
import type ToolInterface from "./tools/ToolInterface";

const outputChannelName = "Biome";
const tools: ToolInterface[] = [];

tools.push(new BiomeTool());

export async function activate(context: ExtensionContext) {
  const configService = new ConfigService();

  const outputChannel = window.createOutputChannel(outputChannelName, {
    log: true,
  });

  const statusBarItemHandler = new StatusBarItemHandler(
    context.extension.packageJSON?.version,
  );

  const showOutputCommand = commands.registerCommand(
    BiomeCommands.ShowOutputChannelLint,
    () => {
      outputChannel.show();
    },
  );

  const copyDebugInfoCommand = commands.registerCommand(
    BiomeCommands.CopyDebugInfo,
    async () => {
      const biomeTool = tools[0] as BiomeTool;
      await copyDebugCommand(
        context.extension.packageJSON?.version ?? "unknown",
        biomeTool.getLspVersion() ?? "unknown",
        configService.vsCodeConfig,
      );
    },
  );

  const onDidChangeWorkspaceFoldersDispose =
    workspace.onDidChangeWorkspaceFolders(async (event) => {
      for (const folder of event.added) {
        configService.addWorkspaceConfig(folder);
      }
      for (const folder of event.removed) {
        configService.removeWorkspaceConfig(folder);
      }
    });

  context.subscriptions.push(
    showOutputCommand,
    copyDebugInfoCommand,
    configService,
    outputChannel,
    onDidChangeWorkspaceFoldersDispose,
    statusBarItemHandler,
  );

  const restartTool = async (
    tool: ToolInterface,
    outputChannel: LogOutputChannel,
  ) => {
    try {
      await tool.deactivate();
      const newBinaryPath = await tool.getBinary(outputChannel, configService);
      await tool.activate(
        outputChannel,
        configService,
        statusBarItemHandler,
        newBinaryPath,
      );
    } catch (e) {
      outputChannel.error(`Failed to restart tool, error: ${e instanceof Error ? e.message : String(e)}.
      Try to restart the editor manually.
      `);
    }
  };

  configService.onConfigChange = async function onConfigChange(event) {
    await Promise.all(
      tools.map((tool) =>
        tool.onConfigChange(event, configService, statusBarItemHandler),
      ),
    );

    if (configService.vsCodeConfig.effectsBiomeConnection(event)) {
      outputChannel.info("biome connection changed, restarting biome tool.");
      await restartTool(tools[0], outputChannel);
    }
  };

  outputChannel.info("Searching for biome binary.");

  const binaryPath = await tools[0].getBinary(outputChannel, configService);
  await tools[0].activate(
    outputChannel,
    configService,
    statusBarItemHandler,
    binaryPath,
  );

  statusBarItemHandler.show();
}

export async function deactivate(): Promise<void> {
  await Promise.all(tools.map((tool) => tool.deactivate()));
}
