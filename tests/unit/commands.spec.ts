import { ok } from "assert";
import { env } from "vscode";
import { copyDebugCommand } from "../../client/commands";
import type { VSCodeConfig } from "../../client/VSCodeConfig";

function createConfig(nodePath?: string, useExecPath?: boolean): VSCodeConfig {
  return {
    nodePath,
    useExecPath: useExecPath ?? false,
  } as VSCodeConfig;
}

suite("commands", () => {
  suite("copyDebugCommand", () => {
    test("copies debug info to clipboard with correct versions", async () => {
      await copyDebugCommand("1.50.0", "0.16.0", "0.5.0", createConfig());

      const clipboardContent = await env.clipboard.readText();

      ok(
        clipboardContent.includes("VS Code extension: v1.50.0"),
        "should include extension version",
      );
      ok(clipboardContent.includes("oxlint: v0.16.0"), "should include oxlint version");
      ok(clipboardContent.includes("oxfmt: v0.5.0"), "should include oxfmt version");
      ok(clipboardContent.includes("Editor:"), "should include editor info");
      ok(clipboardContent.includes("Operating System and Version:"), "should include OS info");
      ok(clipboardContent.includes("Node Version:"), "should include Node version");
      ok(
        clipboardContent.includes("```\nVS Code extension:"),
        "should start code fence before versions",
      );
      ok(clipboardContent.endsWith("```"), "should end with code fence");
    });

    test("includes the resolved node command in Node Version line", async () => {
      await copyDebugCommand("1.50.0", "0.16.0", "0.5.0", createConfig());

      const clipboardContent = await env.clipboard.readText();

      ok(clipboardContent.includes("Node Version:"), "should include Node version");
      ok(clipboardContent.includes("(node)"), "should show the resolved node command");
    });

    test("uses custom nodePath when provided", async () => {
      await copyDebugCommand("1.50.0", "0.16.0", "0.5.0", createConfig(process.execPath, false));

      const clipboardContent = await env.clipboard.readText();

      ok(clipboardContent.includes(`(${process.execPath})`), "should show the custom node path");
    });

    test("uses execPath when useExecPath is true", async () => {
      await copyDebugCommand("1.50.0", "0.16.0", "0.5.0", createConfig(undefined, true));

      const clipboardContent = await env.clipboard.readText();

      ok(
        clipboardContent.includes(`(${process.execPath})`),
        "should show execPath when useExecPath is true",
      );
    });

    test("shows 'unknown' for tools that have not reported versions", async () => {
      await copyDebugCommand("1.50.0", "unknown", "unknown", createConfig());

      const clipboardContent = await env.clipboard.readText();

      ok(clipboardContent.includes("oxlint: vunknown"), "should show unknown for oxlint");
      ok(clipboardContent.includes("oxfmt: vunknown"), "should show unknown for oxfmt");
    });

    test("uses provided fallback extension version text", async () => {
      await copyDebugCommand("<unknown>", "unknown", "unknown", createConfig());

      const clipboardContent = await env.clipboard.readText();

      ok(
        clipboardContent.includes("VS Code extension: v<unknown>"),
        "should show provided fallback extension version",
      );
    });

    test("shows 'unknown' node version when the binary is not found", async () => {
      await copyDebugCommand(
        "1.50.0",
        "0.16.0",
        "0.5.0",
        createConfig("/nonexistent/path/to/node", false),
      );

      const clipboardContent = await env.clipboard.readText();

      ok(
        clipboardContent.includes("Node Version: unknown"),
        "should show unknown when node binary is not found",
      );
    });
  });
});
