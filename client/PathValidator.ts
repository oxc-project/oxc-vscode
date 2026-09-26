/**
 * Validates that the given binary path is safe to spawn.
 *
 * The path is rejected when it contains a character a shell could interpret, which allows command
 * injection: a binary using the native loader is spawned with `shell: true` on Windows, unless
 * `oxc.useExecPath` runs it through Node instead. See `runExecutable` in
 * `client/tools/lsp_helper.ts`.
 */
export function validateSafeBinaryPath(binary: string): boolean {
  // Check for malicious characters or patterns
  // These characters are never expected in a binary path.
  // If any of these characters are present, we consider the path unsafe.
  const maliciousPatterns = [
    // linux/macOS
    "$",
    "&",
    ";",
    "|",
    "`",
    ">",
    "<",
    "!",
    // windows
    "%",
    "^",
  ];
  for (const pattern of maliciousPatterns) {
    if (binary.includes(pattern)) {
      return false;
    }
  }

  return true;
}
