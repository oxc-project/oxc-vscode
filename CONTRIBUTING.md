# Contributing

To contribute to this extension, please follow the guidelines on [biomejs.dev](https://biomejs.dev).

## Development Stack

- **Package Manager**: [pnpm](https://pnpm.io/)
- **Bundler**: [rolldown](https://rolldown.rs/)
- **Language**: TypeScript

## Development Workflow

1. **Clone the repository**:
   ```bash
   git clone https://github.com/simwai/biome-vscode.git
   cd biome-vscode
   ```

2. **Install dependencies**:
   ```bash
   pnpm install
   ```

3. **Build the extension**:
   To compile the TypeScript code and package the extension:
   ```bash
   pnpm run build
   ```
   This will generate a `biome_formatter.vsix` file.

4. **Run tests**:
   Unit tests can be run using:
   ```bash
   pnpm run test:unit
   ```
   For full integration tests:
   ```bash
   pnpm run test
   ```
   *Note: In headless Linux environments (like CI), you may need to use `xvfb-run -a pnpm run test:unit`.*

5. **Lint and Format**:
   Biome is used to lint and format the project itself:
   ```bash
   pnpm run lint
   pnpm run format
   ```

## Technical Details

- The extension uses a unified Language Server Protocol (LSP) to provide both linting and formatting.
- It prioritizes project-local Biome installations found in `node_modules` or Yarn PnP.
- It supports monorepos and multi-root workspaces by detecting nested configuration files (`biome.json`, `biome.jsonc`, `.biome.json`, `.biome.jsonc`).
