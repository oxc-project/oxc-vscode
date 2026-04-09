# ⚓ Oxc

The Oxidation Compiler is creating a suite of high-performance tools for JavaScript and TypeScript.

## Installation

Any of the below options can be used to install the extension.

- Install through the VS Code extensions marketplace by searching for `Oxc`. Verify the identifier is `oxc.oxc-vscode`.
- From within VS Code, open the Quick Open (Ctrl+P or Cmd+P on macOS) and execute `ext install oxc.oxc-vscode`.

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

```json
{
  "editor.defaultFormatter": "oxc.oxc-vscode",
  "editor.formatOnSave": true,
  "editor.formatOnSaveMode": "file" // tell oxfmt to format the whole file, not only the modified lines
  // Or enable it for specific file types:
  // "[javascript]": {
  //   "editor.defaultFormatter": "oxc.oxc-vscode"
  // },
}
```

To run Oxc formatting through VS Code code actions on save, configure `editor.codeActionsOnSave`:

```json
{
  "editor.codeActionsOnSave": {
    "source.format.oxc": "always"
  }
}
```

Running formatting as a code action on save, allows to define the order of changes when both formatting and lint fixes are applied on save. For example, the below configuration will run the formatter first, and then apply lint fixes:

```json
{
  "editor.defaultFormatter": "oxc.oxc-vscode",
  "editor.formatOnSave": false, // disable default behavior
  "editor.codeActionsOnSave": {
    "source.format.oxc": "always", // run formatter first
    "source.fixAll.oxc": "always" // run lint fixes after
  }
}
```

## Configuration

<!-- START_GENERATED_CONFIGURATION -->

### Window Configuration

Following configurations are supported via `settings.json` and affect the window editor:

| Key                         | Default Value | Possible Values                  | Description                                                                                                                                                                                                                                                                        |
| --------------------------- | ------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `oxc.enable`                | `null`        | `true` \| `false` \| `<null>`    | This is a master toggle for both `oxc.enable.oxlint` and `oxc.enable.oxfmt`.                                                                                                                                                                                                       |
| `oxc.enable.oxfmt`          | `true`        | `true` \| `false`                | Enable oxfmt (formatter). Falls back to `oxc.enable` if not set.                                                                                                                                                                                                                   |
| `oxc.enable.oxlint`         | `true`        | `true` \| `false`                | Enable oxlint (linter). Falls back to `oxc.enable` if not set.                                                                                                                                                                                                                     |
| `oxc.path.node`             | -             | `<string>`                       | Path to a Node.js binary. Will be added to the `oxfmt` and `oxlint` `PATH` environment.                                                                                                                                                                                            |
| `oxc.path.oxfmt`            | -             | `<string>`                       | Path to an Oxc formatter binary. Default: auto detection in `node_modules`.                                                                                                                                                                                                        |
| `oxc.path.oxlint`           | -             | `<string>`                       | Path to an Oxc linter binary. Default: auto detection in `node_modules`.                                                                                                                                                                                                           |
| `oxc.path.tsgolint`         | -             | `<string>`                       | Path to an Oxc tsgolint binary. Default: auto detection from `oxlint`.                                                                                                                                                                                                             |
| `oxc.suppressProgramErrors` | `false`       | `true` \| `false`                | Suppress tsconfig errors from tsgolint and still lint files under partially-valid tsconfig projects. When enabled, sets `OXLINT_TSGOLINT_DANGEROUSLY_SUPPRESS_PROGRAM_DIAGNOSTICS=true`. **Note:** Type-aware lint rules may produce degraded results when the tsconfig is broken. |
| `oxc.trace.server`          | `off`         | `off` \| `messages` \| `verbose` | Traces the communication between VS Code and the language server.                                                                                                                                                                                                                  |
| `oxc.useExecPath`           | `false`       | `true` \| `false`                | Whether to use the extension's execPath (Electron's bundled Node.js) as the JavaScript runtime for running Oxc tools, instead of looking for a system Node.js installation.                                                                                                        |
| Deprecated                  |               |                                  |                                                                                                                                                                                                                                                                                    |
| `oxc.path.server`           | -             | `<string>`                       | Path to Oxc language server binary. Mostly for testing the language server.                                                                                                                                                                                                        |

### Workspace Configuration

Following configurations are supported via `settings.json` and can be changed for each workspace:

| Key                           | Default Value | Possible Values                                                                                               | Description                                                                                                                                                                                                                            |
| ----------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `oxc.configPath`              | `null`        | `<string>` \| `<null>`                                                                                        | Path to oxlint configuration. Keep it empty to enable nested configuration.                                                                                                                                                            |
| `oxc.disableNestedConfig`     | `false`       | `true` \| `false`                                                                                             | Disable searching for nested configuration files. When set to true, only the configuration file specified in `oxc.configPath` (if any) will be used.                                                                                   |
| `oxc.fixKind`                 | `null`        | `safe_fix` \| `safe_fix_or_suggestion` \| `dangerous_fix` \| `dangerous_fix_or_suggestion` \| `none` \| `all` | Specify the kind of fixes to suggest/apply.                                                                                                                                                                                            |
| `oxc.fmt.configPath`          | `null`        | `<string>` \| `<null>`                                                                                        | Path to an oxfmt configuration file                                                                                                                                                                                                    |
| `oxc.lint.run`                | `onType`      | `onSave` \| `onType`                                                                                          | Run the linter on save (onSave) or on type (onType)                                                                                                                                                                                    |
| `oxc.requireConfig`           | `false`       | `true` \| `false`                                                                                             | Start the language server only when a `.oxlintrc.json(c)` or `oxlint.config.ts` file exists in one of the workspaces.                                                                                                                  |
| `oxc.tsConfigPath`            | `null`        | `<string>` \| `<null>`                                                                                        | Path to the project's TypeScript config file. If your `tsconfig.json` is not at the root, you will need this set for the `import` plugin rules to resolve imports correctly.                                                           |
| `oxc.typeAware`               | `null`        | `true` \| `false` \| `<null>`                                                                                 | Forces type-aware linting. Requires the `oxlint-tsgolint` package. It is preferred to use `options.typeAware` in your configuration file                                                                                               |
| `oxc.unusedDisableDirectives` | `null`        | `allow` \| `warn` \| `deny`                                                                                   | Define how directive comments like `// oxlint-disable-line` should be reported, when no errors would have been reported on that line anyway. It is preferred to use `options.reportUnusedDisableDirectives` in your configuration file |
| Deprecated                    |               |                                                                                                               |                                                                                                                                                                                                                                        |
| `oxc.flags`                   | `{}`          | `Record<string, string>`                                                                                      | Specific Oxlint flags to pass to the language server.                                                                                                                                                                                  |
| `oxc.fmt.experimental`        | `true`        | `true` \| `false`                                                                                             | Enable Oxfmt formatting support.                                                                                                                                                                                                       |

#### FixKind

- `"safe_fix"` (default)
- `"safe_fix_or_suggestion"`
- `"dangerous_fix"`
- `"dangerous_fix_or_suggestion"`
- `"none"`
- `"all"`

<!-- END_GENERATED_CONFIGURATION -->
