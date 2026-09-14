import { commands, ExtensionContext, LogOutputChannel, window, workspace } from "vscode";

import { copyDebugCommand, OxcCommands } from "./commands";
import { ConfigService } from "./ConfigService";
import StatusBarItemHandler from "./StatusBarItemHandler";
import Formatter from "./tools/formatter";
import Linter from "./tools/linter";
import ToolInterface from "./tools/ToolInterface";

const outputChannelName = "Oxc";
const tools: ToolInterface[] = [];

export async function activate(context: ExtensionContext): Promise<void> {
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

  // Instantiate tools after base commands are registered to maintain command registration order
  if (process.env.SKIP_LINTER_TEST !== "true") {
    const linter = new Linter(outputChannelLint, configService, statusBarItemHandler);
    tools.push(linter);
    context.subscriptions.push(linter);
  }
  if (process.env.SKIP_FORMATTER_TEST !== "true") {
    const formatter = new Formatter(outputChannelFormat, configService, statusBarItemHandler);
    tools.push(formatter);
    context.subscriptions.push(formatter);
  }

  async function restartTool(tool: ToolInterface, outputChannel: LogOutputChannel): Promise<void> {
    try {
      await tool.restart();
    } catch (e) {
      outputChannel.error(`Failed to restart tool, error: ${e instanceof Error ? e.message : String(e)}.
      Try to restart the editor manually.
      `);
    }
  }

  configService.onConfigChange = async function onConfigChange(event) {
    await Promise.all(tools.map((tool) => tool.onConfigChange(event)));

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

  const initialDocument = window.activeTextEditor?.document.uri.toString();
  const binaryPaths = await Promise.all(tools.map((tool) => tool.getBinary()));

  await Promise.all(tools.map((tool, index) => tool.activate(binaryPaths[index])));

  // A window has one client per tool. Re-resolve on navigation, and restart
  // only when the executable, Vite+ command, or project directory changes.
  async function switchProject(): Promise<void> {
    await Promise.all(
      tools.map(async (tool) => {
        try {
          await tool.restart(true);
        } catch (error) {
          const output = tool instanceof Linter ? outputChannelLint : outputChannelFormat;
          output.error(
            `Failed to switch language server: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }),
    );
  }
  context.subscriptions.push(
    window.onDidChangeActiveTextEditor((editor) => {
      if (
        editor?.document.uri.scheme !== "file" ||
        !workspace.getWorkspaceFolder(editor.document.uri)
      ) {
        return;
      }
      void switchProject();
    }),
  );

  // Navigation during binary discovery or server startup predates the listener.
  if (window.activeTextEditor?.document.uri.toString() !== initialDocument) {
    await switchProject();
  }

  // Finally show the status bar item.
  statusBarItemHandler.show();
}

export async function deactivate(): Promise<void> {
  await Promise.all(tools.map((tool) => tool.deactivate()));
  tools.length = 0;
}
