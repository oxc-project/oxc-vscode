# ⚓ Oxc

The Oxidation Compiler is creating a suite of high-performance tools for JavaScript and TypeScript.

## Installation

Any of the below options can be used to install the extension.

- Install through the VS Code extensions marketplace by searching for `Oxc`. Verify the identifier is `oxc.oxc-vscode`.
- From within VS Code, open the Quick Open (Ctrl+P or Cmd+P on macOS) and execute `ext install oxc.oxc-vscode`.

The extension does not bundle the Oxc tools. For the recommended setup, install the tool you want to use locally in your project: `oxlint` for linting and `oxfmt` for formatting. If you install a tool while VS Code is already open and it is not detected, run the **Oxc: Restart oxlint Server** and/or **Oxc: Restart oxfmt Server** commands, then hover over the `oxc` status item or check the corresponding `Oxc (Lint)` or `Oxc (Fmt)` output channel.

For [Vite+](https://viteplus.dev) projects, the extension runs `vp lint --lsp` and `vp fmt --lsp` from the locally installed `vite-plus` package, so the `lint` and `fmt` fields in `vite.config.*` are used. It resolves `vite-plus` from the workspace folders, like the standalone tools. Set `oxc.path.oxlint` or `oxc.path.oxfmt` to use a standalone tool instead.

See the official [Oxlint editor setup](https://oxc.rs/docs/guide/usage/linter/editors.html) and [Oxfmt editor setup](https://oxc.rs/docs/guide/usage/formatter/editors.html) guides for installation details.

## Oxlint

This is the linter for Oxc. The currently supported features are listed below.

- Highlighting for warnings or errors identified by Oxlint
- Quick fixes to fix a warning or error when possible
- JSON schema validation for supported Oxlint configuration files (does not include ESLint configuration files)
- Command to fix all auto-fixable content within the current text editor.
- Support for `source.fixAll.oxc` as a code action provider. Configure this in your settings `editor.codeActionsOnSave`
  to automatically apply fixes when saving the file.
- Support for multi-root workspaces.
- Support for type-aware linting when the `oxlint-tsgolint` package is installed and the `oxc.typeAware` setting is set to true.

## Oxfmt

This is the formatter for Oxc. The currently supported features are listed below.

- Support for `source.format.oxc` as a code action provider.

To enable it as your default formatter, use a VS Code `settings.json` like:

```jsonc
{
  "editor.defaultFormatter": "oxc.oxc-vscode",
  "editor.formatOnSave": true,
  "editor.formatOnSaveMode": "file", // tell oxfmt to format the whole file, not only the modified lines
  // Or enable it for specific file types:
  // "[javascript]": {
  //   "editor.defaultFormatter": "oxc.oxc-vscode"
  // },
}
```

To run Oxc formatting through VS Code code actions on save, configure `editor.codeActionsOnSave`:

```jsonc
{
  "editor.codeActionsOnSave": {
    "source.format.oxc": "always",
  },
}
```

Running formatting as a code action on save, allows to define the order of changes when both formatting and lint fixes are applied on save. For example, the below configuration will run the formatter first, and then apply lint fixes:

```jsonc
{
  "editor.defaultFormatter": "oxc.oxc-vscode",
  "editor.formatOnSave": false, // disable default behavior
  "editor.codeActionsOnSave": {
    "source.format.oxc": "always", // run formatter first
    "source.fixAll.oxc": "always", // run lint fixes after
  },
}
```

## Monorepos

### Recommended setup

Install the Oxc tools once, at the root of the repository, so every package is linted and formatted
with the same version:

- a single `oxlint` (and `oxfmt`) dependency in the root `package.json`
- a root configuration file (`.oxlintrc.json`, `.oxfmtrc.json`), extended by the per-package
  configuration files when a package needs to change something:

```jsonc
// packages/app/.oxlintrc.json
{
  "extends": ["../../.oxlintrc.json"],
  "rules": {
    "no-console": "off",
  },
}
```

With this setup, opening the repository root as a single workspace folder is enough: nested
configuration files are picked up automatically.

### `oxc.workingDirectories`

Some monorepos need each package to be treated as its own project root, for example when a package
has its own `tsconfig.json`, its own JS plugins, or a configuration file which does not extend the
root one. `oxc.workingDirectories` (see [#370](https://github.com/oxc-project/oxc-vscode/issues/370),
[#302](https://github.com/oxc-project/oxc-vscode/issues/302)) declares those additional roots below
a workspace folder. They are handled like `eslint.workingDirectories`.

Requires oxlint/oxfmt versions that support `workingDirectories` (see oxc-project/oxc#26848). The option
is always sent, an empty list keeps the previous behaviour and older language servers ignore it.

```jsonc
{
  // directories, relative to the workspace folder
  "oxc.workingDirectories": ["packages/app", "packages/lib"],
}
```

```jsonc
{
  // the object form is equivalent to the plain string
  "oxc.workingDirectories": [{ "directory": "client" }, { "directory": "server" }],
}
```

An entry of the object form may carry the `"!cwd"` flag of `eslint.workingDirectories`. It is
accepted so that an existing ESLint configuration can be copied over, the Oxc language server
ignores it and always resolves the configuration and the plugins from the working directory.

Each entry has to be an existing directory inside the workspace folder. `..`, absolute paths and `.`
are rejected, and glob characters are taken literally: globs and `{ "mode": "auto" }` are not
supported yet.

Each working directory is handled by the language server as if it were its own workspace folder:

- it performs its own configuration file lookup, starting from the working directory.
- a relative `oxc.configPath`, `oxc.tsConfigPath` or `oxc.fmt.configPath` set at the workspace
  folder level resolves inside each working directory, not at the workspace folder. Set them only
  when every working directory has a file at that relative location. A value set in the
  `.code-workspace` file is resolved to an absolute path and therefore applies everywhere.
- `tsgolint` and JS plugins are resolved from the working directory.

The setting is resource scoped, so it can be set per workspace folder in a multi-root workspace.
The default is `[]`, which keeps the previous behaviour (one root per workspace folder).

## Enabling and disabling per workspace folder

`oxc.enable`, `oxc.enable.oxlint`, `oxc.enable.oxfmt` and `oxc.requireConfig` are `resource` scoped,
so they can be set per workspace folder of a multi-root workspace
(see [#340](https://github.com/oxc-project/oxc-vscode/issues/340)):

```jsonc
// <folder>/.vscode/settings.json
{
  "oxc.enable.oxlint": false,
}
```

The extension runs a single language server per tool for the whole window. Its document selector is
always the same one, the per folder values decide which documents reach it:

- a tool is started as soon as **one** workspace folder enables it, and is stopped when none does
- the documents of a workspace folder which disabled the tool are filtered out by the extension: no
  diagnostics, no code actions and no formatting for them. The innermost workspace folder of a
  document decides, so a workspace folder nested inside another one follows its own settings
- `oxc.requireConfig` is evaluated per workspace folder: a folder which enables it and contains no
  oxlint configuration file is skipped by oxlint until such a file is created.
  Folders which do not enable it are never skipped, and the configuration file of a nested workspace
  folder only counts for that nested folder
- documents which belong to no workspace folder, such as unsaved files, follow the window level
  values of the settings
- changing one of these settings, or adding or removing a workspace folder, restarts the language
  server so that the new selection takes effect. The diagnostics of a workspace folder which became
  excluded are removed
- **Oxc: Fix all auto-fixable problems (file)** reports a warning instead of running when the active
  file is not handled
- the status bar entry shows whether the language server is running. **Oxc: Toggle whether
  oxlint/oxfmt is enabled** stays window wide: it writes `oxc.enable.oxlint` / `oxc.enable.oxfmt` to
  the user or workspace settings, and the value set in the settings of a workspace folder wins over
  it. To disable a single workspace folder, set the value in the settings of that folder
- `oxc.enable` is a master toggle: it wins over `oxc.enable.oxlint` and `oxc.enable.oxfmt` when it
  is set at the same or at a higher precedence level (workspace folder > workspace > user). A folder
  level `"oxc.enable.oxlint": false` therefore wins over a user level `"oxc.enable": true`, while an
  `"oxc.enable": false` in the settings of the same folder wins over it

Known limitation: an excluded workspace folder is still announced to the language server, which
keeps a worker for it. Only the extension stops sending its documents, so no diagnostics and no
formatting are produced for them.

### Breaking changes

- `oxc.enable` no longer overrides `oxc.enable.oxlint` / `oxc.enable.oxfmt` set at a **higher**
  precedence level. A user level `"oxc.enable": true` used to win over a workspace folder level
  `"oxc.enable.oxlint": false`, now the folder value wins. Set `oxc.enable` at the same level as the
  tool specific setting to keep the previous result.
- `oxc.requireConfig` is evaluated per workspace folder. In a multi-root workspace, a configuration
  file used to be enough for every folder; now every folder which enables the setting needs its own
  configuration file. Set `"oxc.requireConfig": false` in the folders without one to keep them
  handled.

## Configuration

For standalone Oxlint and Oxfmt, configuration file paths are optional:

- `oxc.configPath` for Oxlint
- `oxc.fmt.configPath` for Oxfmt

Leave these settings unset (`null`) to let each tool automatically discover configuration files. Nested configuration lookup is enabled by default; it can be disabled with `oxc.disableNestedConfig` for Oxlint or `oxc.fmt.disableNestedConfig` for Oxfmt.

Set a path only when you want to use a specific configuration file, such as one with a custom name or location. Specifying a path disables nested configuration lookup for that tool.

See the [Oxlint configuration guide](https://oxc.rs/docs/guide/usage/linter/config.html) and [Oxfmt configuration guide](https://oxc.rs/docs/guide/usage/formatter/config.html) for supported configuration files and discovery details.

<!-- START_GENERATED_CONFIGURATION -->

### Window Configuration

Following configurations are supported via `settings.json` and affect the window editor:

| Key                         | Default Value | Possible Values                  | Description                                                                                                                                                                                                                                                                        |
| --------------------------- | ------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `oxc.path.node`             | -             | `<string>`                       | Path to a Node.js binary. Will be added to the `oxfmt` and `oxlint` `PATH` environment. Supports [variables](#variables).                                                                                                                                                          |
| `oxc.path.oxfmt`            | -             | `<string>`                       | Path to an Oxc formatter binary. Default: auto detection in `node_modules`. Supports [variables](#variables).                                                                                                                                                                      |
| `oxc.path.oxlint`           | -             | `<string>`                       | Path to an Oxc linter binary. Default: auto detection in `node_modules`. Supports [variables](#variables).                                                                                                                                                                         |
| `oxc.path.tsgolint`         | -             | `<string>`                       | Path to an Oxc tsgolint binary. Default: auto detection from `oxlint`. Supports [variables](#variables).                                                                                                                                                                           |
| `oxc.suppressProgramErrors` | `false`       | `true` \| `false`                | Suppress tsconfig errors from tsgolint and still lint files under partially-valid tsconfig projects. When enabled, sets `OXLINT_TSGOLINT_DANGEROUSLY_SUPPRESS_PROGRAM_DIAGNOSTICS=true`. **Note:** Type-aware lint rules may produce degraded results when the tsconfig is broken. |
| `oxc.trace.server`          | `off`         | `off` \| `messages` \| `verbose` | Traces the communication between VS Code and the language server.                                                                                                                                                                                                                  |
| `oxc.useExecPath`           | `false`       | `true` \| `false`                | Whether to use the extension's execPath (Electron's bundled Node.js) as the JavaScript runtime for running Oxc tools, instead of looking for a system Node.js installation.                                                                                                        |
| Deprecated                  |               |                                  |                                                                                                                                                                                                                                                                                    |
| `oxc.path.server`           | -             | `<string>`                       | Path to Oxc language server binary. Mostly for testing the language server. Supports [variables](#variables).                                                                                                                                                                      |

### Workspace Configuration

Following configurations are supported via `settings.json` and can be changed for each workspace:

| Key                           | Default Value | Possible Values                                                                                               | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `oxc.configPath`              | `null`        | `<string>` \| `<null>`                                                                                        | Optional path to an Oxlint configuration file. When unset (`null`), Oxlint automatically discovers configuration files. Set this to use a specific file; doing so disables nested configuration. Supports [variables](#variables).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `oxc.disableNestedConfig`     | `false`       | `true` \| `false`                                                                                             | Disable searching for nested configuration files. When set to true, only the configuration file specified in `oxc.configPath` (if any) will be used.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `oxc.enable`                  | `null`        | `true` \| `false` \| `<null>`                                                                                 | This is a master toggle for both `oxc.enable.oxlint` and `oxc.enable.oxfmt`. It wins over them when it is set at the same or at a higher precedence level (workspace folder > workspace > user), so a folder level `oxc.enable.oxlint` wins over a user level `oxc.enable`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `oxc.enable.oxfmt`            | `true`        | `true` \| `false`                                                                                             | Enable oxfmt (formatter). Falls back to `oxc.enable` if not set. Can be set per workspace folder: the language server is started when at least one workspace folder enables it, and the documents of the workspace folders which disable it are not formatted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `oxc.enable.oxlint`           | `true`        | `true` \| `false`                                                                                             | Enable oxlint (linter). Falls back to `oxc.enable` if not set. Can be set per workspace folder: the language server is started when at least one workspace folder enables it, and the documents of the workspace folders which disable it are not linted.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `oxc.fixKind`                 | `null`        | `safe_fix` \| `safe_fix_or_suggestion` \| `dangerous_fix` \| `dangerous_fix_or_suggestion` \| `none` \| `all` | Specify the kind of fixes to suggest/apply.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `oxc.fmt.configPath`          | `null`        | `<string>` \| `<null>`                                                                                        | Optional path to an Oxfmt configuration file. When unset (`null`), Oxfmt automatically discovers configuration files. Set this to use a specific file; doing so disables nested configuration. Supports [variables](#variables).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `oxc.fmt.disableNestedConfig` | `false`       | `true` \| `false`                                                                                             | Disable searching for nested configuration files. When set to true, only the configuration file specified in `oxc.fmt.configPath` (if any) will be used.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `oxc.lint.customization`      | `null`        | `Record<string, object>` \| `<null>`                                                                          | Customizes linting rules behavior. See <https://oxc.rs/docs/guide/usage/linter/lsp-config-reference.html#rulescustomization> for details.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `oxc.lint.run`                | `onType`      | `onSave` \| `onType`                                                                                          | Run the linter on save (onSave) or on type (onType)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `oxc.requireConfig`           | `false`       | `true` \| `false`                                                                                             | Handle a workspace folder only when an oxlint configuration file (`.oxlintrc.json`, `.oxlintrc.jsonc`, `oxlint.config.ts` or `oxlint.config.mts`) exists inside it. The setting is evaluated per workspace folder: a workspace folder which enables it and has no configuration file is skipped by oxlint, workspace folders which do not enable it are never skipped. Nested workspace folders are not searched, their configuration file only counts for themselves.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `oxc.tsConfigPath`            | `null`        | `<string>` \| `<null>`                                                                                        | Path to the project's TypeScript config file. If your `tsconfig.json` is not at the root, you will need this set for the `import` plugin rules to resolve imports correctly. Supports [variables](#variables).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `oxc.typeAware`               | `null`        | `true` \| `false` \| `<null>`                                                                                 | Forces type-aware linting. Requires the `oxlint-tsgolint` package. It is preferred to use `options.typeAware` in your configuration file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `oxc.unusedDisableDirectives` | `null`        | `allow` \| `warn` \| `deny`                                                                                   | Define how directive comments like `// oxlint-disable-line` should be reported, when no errors would have been reported on that line anyway. It is preferred to use `options.reportUnusedDisableDirectives` in your configuration file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `oxc.workingDirectories`      | `[]`          | `<array>`                                                                                                     | Additional project roots below this workspace folder. Every entry is handled by the language server as if it were its own workspace folder, like `eslint.workingDirectories`. Accepted forms: a directory relative to the workspace folder (`"packages/a"`) or an object with the same meaning (`{ "directory": "client" }`, accepting an ignored `"!cwd"` flag). Each directory has to exist and stay inside the workspace folder; `..`, absolute paths and `.` are rejected, and glob characters are taken literally, so globs are not supported yet. A working directory is linted and formatted exactly as if it were opened alone: it does its own configuration file lookup, and `tsgolint` and JS plugins are resolved from it. A relative `oxc.configPath`, `oxc.tsConfigPath` or `oxc.fmt.configPath` set at the workspace folder level resolves inside each working directory; a value set in the `.code-workspace` file is resolved to an absolute path and therefore applies everywhere. Requires oxlint/oxfmt versions that support `workingDirectories` (see oxc-project/oxc#26848). See <https://github.com/oxc-project/oxc-vscode/issues/370>. |
| Deprecated                    |               |                                                                                                               |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `oxc.flags`                   | `{}`          | `Record<string, string>`                                                                                      | Specific Oxlint flags to pass to the language server.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `oxc.fmt.experimental`        | `true`        | `true` \| `false`                                                                                             | Enable Oxfmt formatting support.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

#### FixKind

- `"safe_fix"` (default)
- `"safe_fix_or_suggestion"`
- `"dangerous_fix"`
- `"dangerous_fix_or_suggestion"`
- `"none"`
- `"all"`

#### RulesCustomization

Each rule name maps to an object with the following optional properties:

- `autofix`: `true` \| `false` — Whether autofix should be disabled for this rule.
- `severity`: `"error"` \| `"warn"` \| `"info"` \| `"hint"` \| `"off"` — Diagnostic severity override for this rule.

**Example:**

```json
{
  "oxc.lint.customization": {
    "no-unused-vars": {
      "severity": "warning",
      "autofix": false
    }
  }
}
```

<!-- END_GENERATED_CONFIGURATION -->

### Variables

The following settings support variables: `oxc.path.oxlint`, `oxc.path.oxfmt`, `oxc.path.server`, `oxc.path.tsgolint`, `oxc.path.node`, `oxc.configPath`, `oxc.fmt.configPath` and `oxc.tsConfigPath`.

| Variable      | Replaced by                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| `${userHome}` | The home directory of the current user.                                                                  |
| `${env:NAME}` | The value of the environment variable `NAME`. An unset or empty variable is replaced by an empty string. |

Notes:

- `${env:NAME}` is only supported in trusted workspaces. In untrusted workspaces it is left unchanged.
- A value which is empty after the replacement counts as not configured: `oxc.path.*` settings use the auto detection, the config path settings are ignored.
- Every other `${...}` form (for example `${workspaceFolder}`) is not supported and is left unchanged.

# [Sponsored By](https://oxc.rs/sponsor)

<p align="center">
  <a href="https://oxc.rs/sponsor">
    <img src="https://raw.githubusercontent.com/oxc-project/sponsors/main/sponsors.png" alt="Our sponsors" />
  </a>
</p>
