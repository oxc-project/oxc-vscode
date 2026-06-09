import {
  commands,
  type ExtensionContext,
  type LogOutputChannel,
  window,
  workspace,
} from "vscode";
import { ConfigService } from "./ConfigService";
import {
  BiomeCommands,
  copyDebugCommand,
  fixProjectCommand,
  fixProjectUnsafeCommand,
  formatProjectCommand,
  openConfigCommand,
  rageCommand,
} from "./commands";
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

  const biomeTool = tools[0] as BiomeTool;

  const showOutputCommand = commands.registerCommand(
    BiomeCommands.ShowOutput,
    () => {
      outputChannel.show();
    },
  );

  const restartServerCommand = commands.registerCommand(
    BiomeCommands.Restart,
    async () => {
      await restartTool(biomeTool, outputChannel);
    },
  );

  const toggleEnableCommand = commands.registerCommand(
    BiomeCommands.ToggleEnabled,
    async () => {
      await configService.vsCodeConfig.updateEnableBiome(
        !configService.vsCodeConfig.enableBiome,
      );
    },
  );

  const applyAllFixesFileCommand = commands.registerCommand(
    BiomeCommands.ApplyAllFixes,
    async () => {
      await biomeTool.applyAllFixesFile();
    },
  );

  const formatProjectCommandRegistration = commands.registerCommand(
    BiomeCommands.FormatProject,
    async () => {
      await formatProjectCommand(
        await biomeTool.getBinary(outputChannel, configService),
        configService.vsCodeConfig,
      );
    },
  );

  const fixProjectCommandRegistration = commands.registerCommand(
    BiomeCommands.FixProject,
    async () => {
      await fixProjectCommand(
        await biomeTool.getBinary(outputChannel, configService),
        configService.vsCodeConfig,
      );
    },
  );

  const fixProjectUnsafeCommandRegistration = commands.registerCommand(
    BiomeCommands.FixProjectUnsafe,
    async () => {
      await fixProjectUnsafeCommand(
        await biomeTool.getBinary(outputChannel, configService),
        configService.vsCodeConfig,
      );
    },
  );

  const openConfigCommandRegistration = commands.registerCommand(
    BiomeCommands.OpenConfig,
    async () => {
      await openConfigCommand();
    },
  );

  const copyDebugInfoCommand = commands.registerCommand(
    BiomeCommands.CopyDebugInfo,
    async () => {
      await copyDebugCommand(
        context.extension.packageJSON?.version ?? "unknown",
        biomeTool.getLspVersion() ?? "unknown",
        configService.vsCodeConfig,
      );
    },
  );

  const rageCommandRegistration = commands.registerCommand(
    BiomeCommands.Rage,
    async () => {
      await rageCommand(
        await biomeTool.getBinary(outputChannel, configService),
        outputChannel,
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

  const onActiveEditorChangeDispose = window.onDidChangeActiveTextEditor(() => {
    biomeTool.updateStatusBar(statusBarItemHandler, configService);
  });

  context.subscriptions.push(
    showOutputCommand,
    restartServerCommand,
    toggleEnableCommand,
    applyAllFixesFileCommand,
    formatProjectCommandRegistration,
    fixProjectCommandRegistration,
    fixProjectUnsafeCommandRegistration,
    openConfigCommandRegistration,
    copyDebugInfoCommand,
    rageCommandRegistration,
    configService,
    outputChannel,
    onDidChangeWorkspaceFoldersDispose,
    onActiveEditorChangeDispose,
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
