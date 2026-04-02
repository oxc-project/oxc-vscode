import { commands, ExtensionContext, LogOutputChannel, window, workspace } from "vscode";

import { copyDebugCommand, OxcCommands } from "./commands";
import { ConfigService } from "./ConfigService";
import StatusBarItemHandler from "./StatusBarItemHandler";
import Formatter from "./tools/formatter";
import Linter from "./tools/linter";
import ToolInterface from "./tools/ToolInterface";

const outputChannelName = "Oxc";
const tools: ToolInterface[] = [];

if (process.env.SKIP_LINTER_TEST !== "true") {
  tools.push(new Linter());
}
if (process.env.SKIP_FORMATTER_TEST !== "true") {
  tools.push(new Formatter());
}

export async function activate(context: ExtensionContext) {
  const configService = new ConfigService();

  const outputChannelLint = window.createOutputChannel(outputChannelName + " (Lint)", {
    log: true,
  });

  const outputChannelFormat = window.createOutputChannel(outputChannelName + " (Fmt)", {
    log: true,
  });

  const statusBarItemHandler = new StatusBarItemHandler(context.extension.packageJSON?.version);

  const showOutputLintCommand = commands.registerCommand(OxcCommands.ShowOutputChannelLint, () => {
    outputChannelLint.show();
  });

  const showOutputFmtCommand = commands.registerCommand(OxcCommands.ShowOutputChannelFmt, () => {
    outputChannelFormat.show();
  });

  const copyDebugInfoCommand = commands.registerCommand(OxcCommands.CopyDebugInfo, async () => {
    await copyDebugCommand(
      context.extension.packageJSON?.version ?? "unknown",
      tools.find((tool) => tool instanceof Linter)?.getLspVersion() ?? "unknown",
      tools.find((tool) => tool instanceof Formatter)?.getLspVersion() ?? "unknown",
      configService.vsCodeConfig,
    );
  });

  const onDidChangeWorkspaceFoldersDispose = workspace.onDidChangeWorkspaceFolders(
    async (event) => {
      for (const folder of event.added) {
        configService.addWorkspaceConfig(folder);
      }
      for (const folder of event.removed) {
        configService.removeWorkspaceConfig(folder);
      }
    },
  );

  context.subscriptions.push(
    showOutputLintCommand,
    showOutputFmtCommand,
    copyDebugInfoCommand,
    configService,
    outputChannelLint,
    outputChannelFormat,
    onDidChangeWorkspaceFoldersDispose,
    statusBarItemHandler,
  );

  const restartTool = async (tool: ToolInterface, outputChannel: LogOutputChannel) => {
    try {
      await tool.restart(outputChannel, configService, statusBarItemHandler);
    } catch (e) {
      outputChannel.error(`Failed to restart tool, error: ${e instanceof Error ? e.message : String(e)}.
      Try to restart the editor manually.
      `);
    }
  };

  configService.onConfigChange = async function onConfigChange(event) {
    await Promise.all(
      tools.map((tool) => tool.onConfigChange(event, configService, statusBarItemHandler)),
    );

    if (configService.vsCodeConfig.effectsOxlintConnection(event)) {
      outputChannelLint.info("oxlint connection changed, restarting oxlint tool.");

      const linterTool = tools.find((tool) => tool instanceof Linter);
      if (linterTool) {
        await restartTool(linterTool, outputChannelLint);
      }
    }

    if (configService.vsCodeConfig.effectsOxfmtConnection(event)) {
      outputChannelFormat.info("oxfmt connection changed, restarting oxfmt tool.");

      const formatterTool = tools.find((tool) => tool instanceof Formatter);
      if (formatterTool) {
        await restartTool(formatterTool, outputChannelFormat);
      }
    }
  };

  outputChannelFormat.info("Searching for oxfmt binary.");
  outputChannelLint.info("Searching for oxlint binary.");

  const binaryPaths = await Promise.all(
    tools.map((tool) =>
      tool.getBinary(
        tool instanceof Linter ? outputChannelLint : outputChannelFormat,
        configService,
      ),
    ),
  );

  await Promise.all(
    tools.map((tool): Promise<void> => {
      const channel = tool instanceof Linter ? outputChannelLint : outputChannelFormat;
      const binaryPath = binaryPaths[tools.indexOf(tool)];

      return tool.activate(channel, configService, statusBarItemHandler, binaryPath);
    }),
  );

  // Finally show the status bar item.
  statusBarItemHandler.show();
}

export async function deactivate(): Promise<void> {
  await Promise.all(tools.map((tool) => tool.deactivate()));
}
