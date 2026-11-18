import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { isJapanese } from "./i18n";
import { logger } from "./logger";
import {
  presentWorkspaceSkillUpdates,
  type WorkspaceUpdateDiff,
  type WorkspaceUpdateOutcome,
  type WorkspaceUpdateTarget,
  type WorkspaceUpdateUiDependencies,
} from "./workspaceSkillUpdateUi";
import type { WorkspaceSkillCandidate } from "./workspaceSkillUpdate";

type Operations = Pick<
  WorkspaceUpdateUiDependencies,
  | "prepare"
  | "apply"
  | "discard"
  | "getVerifiedDiffs"
  | "guard"
  | "classifyBlocked"
  | "isRateLimit"
  | "isCancelled"
>;

const SCHEME = "resource-ninja-update-preview";
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_OPEN_DOCUMENTS = 20;

function text(value: unknown, limit = 180): string {
  if (typeof value !== "string") {
    return "";
  }
  return Array.from(value.slice(0, limit), (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || (code >= 127 && code <= 159) ||
      (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069)
      ? " " : character;
  }).join("").replace(/\$\(/g, "$ (");
}

function reasonText(reason: string | undefined, ja: boolean): string {
  switch (reason) {
    case "local-changes":
      return ja ? "保存済みのローカル編集があります" : "Saved local edits exist";
    case "dirty-or-unknown":
    case "dirty-or-unknown-document":
      return ja ? "未保存の編集または書き込み可否が不明です" : "Unsaved edits or write eligibility is unknown";
    case "invalid-or-local-baseline":
    case "missing-metadata":
      return ja ? "比較基準がありません" : "No usable baseline";
    case "cancelled":
      return ja ? "キャンセルされました" : "Cancelled";
    case "not-approved":
      return ja ? "更新が承認されませんでした" : "Update not approved";
    case "rate-limit":
      return ja ? "配布元のレート制限" : "Upstream rate limit";
    case "recovery-required":
      return ja ? "先行する項目の復旧が必要なため中止しました" : "Stopped because an earlier item requires recovery";
    case "snapshot-changed":
    case "preview-snapshot-changed":
    case "target-changed-during-prepare":
      return ja ? "確認後に内容が変更されました" : "Contents changed after the check";
    case "shared-location":
    case "known-synchronized-location":
    case "network-location":
    case "network-or-unknown-volume":
    case "linked-or-invalid-directory":
    case "linked-or-special-entry":
      return ja ? "共有・同期・ネットワークまたはリンクを含む対象です" : "Shared, synchronized, network, or linked location";
    case "candidate-preserved":
    case "discard-failed":
      return ja ? "候補の削除を確認できません。保存先を確認してください" : "Candidate cleanup could not be verified; inspect the retained location";
    case "pending-recovery":
      return ja ? "前回の更新に復旧が必要です" : "A previous update requires recovery";
    case "operation-failed":
      return ja ? "処理に失敗しました。出力ログを確認してください" : "Operation failed; see the output log";
    default:
      return ja ? "安全性を確認できません。出力ログを確認してください" : "Safety could not be verified; see the output log";
  }
}

function previewText(bytes: Uint8Array | undefined): { value: string } | { error: "large" | "binary" | "encoding" } {
  if (!bytes) {
    return { value: "" };
  }
  if (bytes.byteLength > MAX_FILE_BYTES) {
    return { error: "large" };
  }
  if (bytes.some((value) =>
    value < 32 && value !== 9 && value !== 10 && value !== 13,
  )) {
    return { error: "binary" };
  }
  try {
    return { value: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) };
  } catch {
    return { error: "encoding" };
  }
}

function previewError(error: "large" | "binary" | "encoding", ja: boolean): string {
  if (error === "large") {
    return ja ? "1 MiB を超えるため表示できません" : "Cannot preview files larger than 1 MiB";
  }
  if (error === "binary") {
    return ja ? "バイナリのため表示できません" : "Binary content cannot be previewed";
  }
  return ja ? "不正な UTF-8 のため表示できません" : "Invalid UTF-8 cannot be previewed";
}

/** Create once per extension host and dispose through the extension context. */
export function createWorkspaceSkillUpdateAdapter(
  context: vscode.ExtensionContext,
  operations: Operations,
): {
  present(targets: readonly WorkspaceUpdateTarget[]): Promise<readonly WorkspaceUpdateOutcome[]>;
  dispose(): void;
} {
  const contents = new Map<string, string>();
  const unavailable = new WeakMap<WorkspaceSkillCandidate, number>();
  const provider = vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
    provideTextDocumentContent(uri) {
      return contents.get(uri.toString()) ?? (isJapanese() ? "プレビューは終了しました。" : "Preview expired.");
    },
  });
  const closeListener = vscode.workspace.onDidCloseTextDocument((document) => {
    if (document.uri.scheme === SCHEME) {
      contents.delete(document.uri.toString());
    }
  });
  let disposed = false;
  let retryRequested = false;
  let retrying = false;
  // A rate limit, an unfinished recovery or a changed target is not fixed by repeating the request.
  const retryable = (outcomes: readonly WorkspaceUpdateOutcome[]) =>
    outcomes.filter((entry) =>
      entry.status === "failed" &&
      entry.reason !== "rate-limit" && entry.reason !== "target-mismatch");

  const openDiff = async (item: WorkspaceUpdateDiff, ja: boolean): Promise<void> => {
    const local = previewText(item.local);
    const staged = previewText(item.staged);
    if ("error" in local || "error" in staged) {
      await vscode.window.showWarningMessage(
        previewError("error" in local ? local.error : (staged as { error: "large" | "binary" | "encoding" }).error, ja),
      );
      return;
    }
    if (contents.size + 2 > MAX_OPEN_DOCUMENTS) {
      await vscode.window.showWarningMessage(
        ja ? "開いている差分を閉じてから再度表示してください。" : "Close some preview documents before opening another diff.",
      );
      return;
    }
    const id = randomUUID();
    const left = vscode.Uri.from({ scheme: SCHEME, path: `/${id}/local` });
    const right = vscode.Uri.from({ scheme: SCHEME, path: `/${id}/staged` });
    contents.set(left.toString(), local.value);
    contents.set(right.toString(), staged.value);
    const absent = ja ? "（存在しない）" : " (absent)";
    const title = `${text(item.path)}: ${ja ? "保存済み" : "Saved"}${item.local ? "" : absent} ↔ ${ja ? "配布元" : "Upstream"}${item.staged ? "" : absent}`;
    try {
      await vscode.commands.executeCommand("vscode.diff", left, right, title, { preview: true });
    } catch (error) {
      contents.delete(left.toString());
      contents.delete(right.toString());
      throw error;
    }
  };

  const ui: WorkspaceUpdateUiDependencies = {
    ...operations,
    isCancelled: () => disposed || operations.isCancelled(),
    notify: async (targets) => {
      const ja = isJapanese();
      const bulk = ja ? "まとめて更新" : "Update All";
      const details = ja ? "詳細" : "Details";
      const choice = await vscode.window.showInformationMessage(
        ja
          ? `${targets.length} 件の配布元に変更があります。まとめて更新では、基準なし・不明・ローカル編集・未保存の項目をスキップします。共有・同期の検出は完全ではありません。`
          : `${targets.length} upstream update(s) found. Bulk update skips missing baselines, unknowns, local edits, and unsaved files. Sharing and synchronization detection is incomplete.`,
        bulk,
        details,
      );
      return choice === bulk ? "bulk" : choice === details ? "details" : undefined;
    },
    confirmBulk: async () => true,
    chooseTarget: async (targets) => {
      const ja = isJapanese();
      const items = targets.map((target) => ({
        label: text(target.label),
        description: text(target.workspace.fsPath, 500),
        detail: text(target.target.fsPath, 500),
        target,
      }));
      const chosen = await vscode.window.showQuickPick(items, {
        title: ja ? "更新候補を選択" : "Select an update candidate",
        matchOnDescription: true,
        matchOnDetail: true,
      });
      return chosen?.target;
    },
    showDetails: async (candidate, diffs) => {
      const ja = isJapanese();
      const files = diffs.map((diff) => {
        const local = previewText(diff.local);
        const staged = previewText(diff.staged);
        const error = "error" in local ? local.error : "error" in staged ? staged.error : undefined;
        return {
          label: `$(diff) ${text(diff.path)}`,
          description: error ? previewError(error, ja) : undefined,
          action: "diff" as const,
          diff,
          error,
        };
      });
      unavailable.set(candidate, files.filter((file) => file.error).length);
      for (;;) {
        const apply = { label: ja ? "$(check) この候補を更新" : "$(check) Update this candidate", action: "apply" as const };
        const selected = await vscode.window.showQuickPick([apply, ...files], {
          title: ja ? "保存済みと固定された配布元の差分" : "Saved vs pinned upstream",
          placeHolder: ja ? "ファイルを選択して差分を表示" : "Select a file to view its diff",
        });
        if (!selected) {
          return "close";
        }
        if (selected.action === "apply") {
          return "update";
        }
        await openDiff(selected.diff, ja);
      }
    },
    confirmSingle: async (candidate) => {
      const ja = isJapanese();
      const confirm = ja ? "更新する" : "Update";
      const edited = candidate.localChanges.length > 0;
      const notPreviewed = unavailable.get(candidate) || 0;
      const detail = ja
        ? `${edited ? "保存済みのローカル編集を上書きします。 " : ""}${notPreviewed ? `${notPreviewed} 件のファイルは差分を表示できません。 ` : ""}共有・同期は完全には検出できません。未保存または確認後に変更されたファイルは更新しません。`
        : `${edited ? "Saved local edits will be overwritten. " : ""}${notPreviewed ? `${notPreviewed} file(s) cannot be previewed. ` : ""}Sharing and synchronization cannot be fully detected. Unsaved or changed-after-check files will not be updated.`;
      return (await vscode.window.showWarningMessage(
        ja ? "この候補を更新しますか？" : "Update this candidate?",
        { modal: true, detail },
        confirm,
      )) === confirm;
    },
    report: async (outcomes) => {
      const ja = isJapanese();
      const updated = outcomes.filter((entry) => entry.status === "updated").length;
      const failed = outcomes.filter((entry) => entry.status === "failed" || entry.status === "recovery-required").length;
      const skipped = outcomes.length - updated - failed;
      const action = ja ? "結果の詳細" : "Show Results";
      const retryCount = retrying ? 0 : retryable(outcomes).length;
      const retryAction = ja ? `失敗分を再試行 (${retryCount})` : `Retry Failed (${retryCount})`;
      const actions = retryCount ? [action, retryAction] : [action];
      const firstProblem = outcomes.find((entry) => entry.status === "failed" || entry.status === "recovery-required");
      const summary = ja
        ? `更新 ${updated} 件、スキップ ${skipped} 件、失敗・要復旧 ${failed} 件${firstProblem ? `: ${reasonText(firstProblem.reason, ja)}` : ""}`
        : `Updated ${updated}, skipped ${skipped}, failed/recovery ${failed}${firstProblem ? `: ${reasonText(firstProblem.reason, ja)}` : ""}`;
      const choice = failed
        ? await vscode.window.showWarningMessage(summary, ...actions)
        : await vscode.window.showInformationMessage(summary, ...actions);
      if (choice === retryAction) {
        retryRequested = true;
      }
      if (choice === action) {
        await vscode.window.showQuickPick(outcomes.map((entry) => ({
          label: text(entry.target.label),
          description: entry.status === "updated" ? (ja ? "更新済み" : "Updated")
            : entry.status === "unchanged" ? (ja ? "変更なし" : "Unchanged")
            : entry.status === "skipped" ? (ja ? "スキップ" : "Skipped")
            : entry.status === "recovery-required" ? (ja ? "要復旧" : "Recovery required")
            : (ja ? "失敗" : "Failed"),
          detail: [
            entry.reason ? reasonText(entry.reason, ja) : "",
            entry.target.target.fsPath,
            entry.recoveryDirectory ? `${ja ? "保管先" : "Retained"}: ${entry.recoveryDirectory.fsPath}` : "",
          ].filter(Boolean).map((part) => text(part, 500)).join(" — "),
        })), { title: ja ? "更新結果" : "Update results", matchOnDetail: true });
      }
    },
    log: (message, error) => {
      // Do not put remote responses, tokens, or arbitrary error messages in diagnostics.
      logger.warn(text(message), error ? reasonText(
        typeof error === "string" ? error : error instanceof Error ? error.message : undefined, false,
      ) : "");
    },
  };

  const adapter = {
    present(targets: readonly WorkspaceUpdateTarget[]) {
      if (disposed) {
        return Promise.reject(new Error("Workspace update adapter disposed"));
      }
      return (async () => {
        let outcomes = await presentWorkspaceSkillUpdates(targets, ui);
        if (retryRequested && !disposed) {
          retryRequested = false;
          const retryTargets = retryable(outcomes).map((entry) => entry.target);
          retrying = true;
          try {
            const retried = await presentWorkspaceSkillUpdates(retryTargets, ui, "bulk");
            const handled = new Set(retryTargets);
            outcomes = [...outcomes.filter((entry) => !handled.has(entry.target)), ...retried];
          } finally {
            retrying = false;
          }
        }
        retryRequested = false;
        return outcomes;
      })();
    },
    dispose() {
      if (!disposed) {
        disposed = true;
        contents.clear();
        provider.dispose();
        closeListener.dispose();
      }
    },
  };
  context.subscriptions.push(adapter);
  return adapter;
}
