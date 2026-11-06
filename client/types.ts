/**
 * A type with a destructor for releasing resources when de-registered by an LSP client.
 *
 * There's a newer {@link Disposable} interface that works with `using`, but
 * VSCode uses this in its APIs.
 */
export interface IDisposable {
  dispose(): void | Promise<void>;
}

/** The tools handled by this extension, each one has its own language server. */
export type OxcTool = "oxlint" | "oxfmt";
