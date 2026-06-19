import type { Uri } from "vscode";

const recentOxfmtEditWindowMs = 2_000;
type RecentOxfmtEdit = {
  expiresAt: number;
  skipNextOnTypeDiagnostic: boolean;
};

const recentOxfmtEdits = new Map<string, RecentOxfmtEdit>();

export function rememberOxfmtFormattingEdit(uri: Uri): void {
  // VS Code applies formatter edits after the formatting provider returns, and
  // that edit can trigger oxlint diagnostics and automatic code-action refreshes.
  // Remember the URI briefly so format-only saves do not start type-aware lint work.
  const key = uri.toString();
  const expiresAt = Date.now() + recentOxfmtEditWindowMs;
  recentOxfmtEdits.set(key, {
    expiresAt,
    skipNextOnTypeDiagnostic: true,
  });
  setTimeout(() => {
    if (recentOxfmtEdits.get(key)?.expiresAt === expiresAt) {
      recentOxfmtEdits.delete(key);
    }
  }, recentOxfmtEditWindowMs);
}

function getRecentOxfmtEdit(uri: Uri): RecentOxfmtEdit | undefined {
  const key = uri.toString();
  const edit = recentOxfmtEdits.get(key);
  if (!edit) {
    return undefined;
  }

  if (Date.now() > edit.expiresAt) {
    recentOxfmtEdits.delete(key);
    return undefined;
  }

  return edit;
}

export function hasRecentOxfmtFormattingEdit(uri: Uri): boolean {
  return getRecentOxfmtEdit(uri) !== undefined;
}

export function consumeNextOxfmtOnTypeDiagnostic(uri: Uri): boolean {
  const edit = getRecentOxfmtEdit(uri);
  if (!edit?.skipNextOnTypeDiagnostic) {
    return false;
  }

  edit.skipNextOnTypeDiagnostic = false;
  return true;
}
