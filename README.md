# Biome Formatter (Unofficial)

![Biome Formatter Banner](banner.svg)

> [!CAUTION]
> **Unofficial & Experimental**
>
> This extension is **not** the official Biome extension. It is an experimental fork of the [oxlint VS Code extension](https://github.com/oxc-project/oxc-vscode), modified to support [Biome](https://biomejs.dev/). Use it with caution.

## Installation

Install through the VS Code extensions marketplace by searching for `Biome Formatter`.
**Verify the identifier is `simwai.biome-vscode`**.

## Features

- **High-performance**: Leveraging Biome's Rust-based toolchain.
- **Unified LSP**: Provides both linting and formatting through a single connection.
- **Extended Language Support**: Supports JavaScript, TypeScript, JSON, HTML, CSS, Astro, Svelte, Vue, Markdown, and more.
- **Auto-fixes**: Command to fix all auto-fixable issues in a file.
- **Monorepo & Multi-root Support**: Works seamlessly with multi-root workspaces and monorepos (supports nested `biome.json` files).

## Configuration

To get the most out of this extension, set it as your default formatter in your `settings.json`:

```json
{
  "editor.defaultFormatter": "simwai.biome-vscode",
  "editor.formatOnSave": true,
  "biome.enable": true,
  "biome.lint.run": "onType"
}
```

## Commands

This extension provides several commands accessible via the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`):

- **Biome: Restart Biome Server**: Restarts the underlying language server.
- **Biome: Toggle whether Biome is enabled**: Quickly enable or disable the extension.
- **Biome: Show Output Channel**: View the logs from the Biome LSP.
- **Biome: Fix all auto-fixable problems (file)**: Applies all suggested fixes to the current file.
- **Biome: Copy Debug Info**: Copies environment and version information to the clipboard.
- **Biome: Rage (Debug Info)**: Generates a detailed diagnostic report.

## Settings

- `biome.enable`: Enable or disable the extension. (Default: `true`)
- `biome.lint.run`: Run the linter `onSave` or `onType`. (Default: `onType`)
- `biome.requireConfig`: Start the server only when a `biome.json` or `biome.jsonc` file exists. (Default: `false`)
- `biome.configPath`: Custom path to the Biome configuration file.
- `biome.disableNestedConfig`: Disable searching for nested configuration files.
- `biome.path.biome`: Custom path to a Biome binary.
- `biome.path.node`: Custom path to a Node.js binary.
- `biome.useExecPath`: Use the extension's bundled Node.js runtime.

## Comparison with Official Extension

While the official Biome extension (`biomejs.biome`) is the recommended choice for most users, this version (`simwai.biome-vscode`) offers some differences:

| Feature | simwai.biome-vscode (This) | biomejs.biome (Official) |
| :--- | :--- | :--- |
| **Origin** | Forked from `oxlint` extension | Built from scratch for Biome |
| **Settings Prefix** | `biome.enable`, `biome.configPath` | `biome.enabled`, `biome.configurationPath` |
| **Languages** | Broad (Astro, Svelte, Vue, etc.) | Standard JS/TS/JSON |
| **Diagnostics** | Includes `biome.rage` command | Standard LSP diagnostics |
| **Status** | Experimental | Stable |

## Contributing

This project is open-source. Contributions are welcome!
