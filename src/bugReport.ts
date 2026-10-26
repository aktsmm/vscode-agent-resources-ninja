import * as vscode from "vscode";
import type {
  ReinstallBatchRecord,
  ReinstallFailureKind,
} from "./reinstallRecovery";

export const BUG_REPORT_ISSUE_URL =
  "https://github.com/aktsmm/vscode-agent-resources-ninja/issues/new";
export const BUG_REPORT_URL_MAX_LENGTH = 7_500;
const BUG_REPORT_TITLE_MAX_LENGTH = 256;
const BUG_REPORT_TRUNCATION_NOTICE =
  "\n\n[Details truncated to fit GitHub issue URL limits.]";
const REINSTALL_FAILURE_KINDS: readonly ReinstallFailureKind[] = [
  "rate-limit",
  "server-error",
  "transport",
  "sso-required",
  "classic-pat-forbidden",
  "auth-required",
  "not-found",
  "incomplete",
  "cancelled",
  "other",
];

const REINSTALL_RESOURCE_KINDS: readonly string[] = [
  "skill",
  "agent",
  "instruction",
  "prompt",
  "hook",
  "mcp",
  "plugin",
  "cursor-rule",
];
const REINSTALL_STAGES: readonly string[] = [
  "not-started",
  "remove",
  "install",
  "complete",
];

/** Counts values after mapping them onto a fixed list, so no free text can reach the report. */
function countByFixedValue(
  values: readonly (string | undefined)[],
  allowed: readonly string[],
): string {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value && allowed.includes(value) ? value : "other";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...allowed, "other"]
    .filter((key) => counts.has(key))
    .map((key) => `${key}: ${counts.get(key)}`)
    .join(", ");
}

export function buildReinstallBatchReport(
  records: readonly ReinstallBatchRecord<unknown>[],
  isJa: boolean,
): { title: string; body: string } {
  const failed = records.filter(
    (record) =>
      !record.result.success && record.result.failureKind !== "cancelled",
  );
  const cancelled = records.filter(
    (record) => record.result.failureKind === "cancelled",
  ).length;
  const failureCounts = new Map<ReinstallFailureKind, number>();
  for (const record of failed) {
    const candidate = record.result.failureKind;
    const kind =
      candidate && REINSTALL_FAILURE_KINDS.includes(candidate)
        ? candidate
        : "other";
    failureCounts.set(kind, (failureCounts.get(kind) || 0) + 1);
  }
  const kinds = REINSTALL_FAILURE_KINDS.filter((kind) =>
    failureCounts.has(kind),
  )
    .map((kind) => `${kind}: ${failureCounts.get(kind)}`)
    .join(", ");
  const succeeded = records.filter((record) => record.result.success).length;
  const notStarted = records.filter(
    (record) => record.result.stage === "not-started",
  ).length;
  const removedBeforeFailure = failed.filter(
    (record) => record.result.removed,
  ).length;
  const failedKinds = countByFixedValue(
    failed.map((record) => record.task.resourceKind),
    REINSTALL_RESOURCE_KINDS,
  );
  const failedStages = countByFixedValue(
    failed.map((record) => record.result.stage),
    REINSTALL_STAGES,
  );

  return isJa
    ? {
        title: "[バグ報告] 一括再インストール失敗",
        body: `**一括再インストールの結果**\n- 成功: ${succeeded}\n- 失敗: ${failed.length}\n- キャンセル: ${cancelled}\n- 未着手: ${notStarted}\n- 削除後に失敗: ${removedBeforeFailure}\n- 失敗種別: ${kinds}\n- 失敗したリソース種別: ${failedKinds}\n- 失敗した段階: ${failedStages}\n\n再現手順を記入してください。投稿前に秘密情報やログを含めないか確認してください。`,
      }
    : {
        title: "[Bug] Batch reinstall failure",
        body: `**Batch reinstall outcome**\n- Succeeded: ${succeeded}\n- Failed: ${failed.length}\n- Cancelled: ${cancelled}\n- Not started: ${notStarted}\n- Failed after removal: ${removedBeforeFailure}\n- Failure kinds: ${kinds}\n- Failed resource kinds: ${failedKinds}\n- Failed stages: ${failedStages}\n\nPlease add reproduction steps. Review the draft for secrets or raw logs before posting.`,
      };
}

function sliceWithoutBrokenSurrogate(value: string, maxLength: number): string {
  let end = Math.min(value.length, Math.max(0, maxLength));
  if (end > 0 && /[\uD800-\uDBFF]/.test(value.charAt(end - 1))) {
    end -= 1;
  }
  return value.slice(0, end);
}

function createBugReportUrl(title: string, body: string): string {
  const params = new URLSearchParams();
  params.set("title", title);
  params.set("body", body);
  return `${BUG_REPORT_ISSUE_URL}?${params.toString()}`;
}

export function buildBugReportUrl(title: string, body: string): string {
  const boundedTitle = sliceWithoutBrokenSurrogate(
    title,
    BUG_REPORT_TITLE_MAX_LENGTH,
  );
  const fullUrl = createBugReportUrl(boundedTitle, body);
  if (fullUrl.length <= BUG_REPORT_URL_MAX_LENGTH) {
    return fullUrl;
  }

  let low = 0;
  let high = body.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidateBody = `${sliceWithoutBrokenSurrogate(body, middle)}${BUG_REPORT_TRUNCATION_NOTICE}`;
    if (
      createBugReportUrl(boundedTitle, candidateBody).length <=
      BUG_REPORT_URL_MAX_LENGTH
    ) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return createBugReportUrl(
    boundedTitle,
    `${sliceWithoutBrokenSurrogate(body, low)}${BUG_REPORT_TRUNCATION_NOTICE}`,
  );
}

export async function openBugReport(
  title: string,
  body: string,
): Promise<void> {
  await vscode.env.openExternal(
    vscode.Uri.parse(buildBugReportUrl(title, body)),
  );
}

/**
 * Shows exactly what the draft will contain before the browser opens, so the
 * user decides with the diagnostics in front of them. Nothing is posted.
 */
export async function previewAndOpenBugReport(
  report: { title: string; body: string },
  isJa: boolean,
): Promise<boolean> {
  const openLabel = isJa ? "GitHub の下書きを開く" : "Open GitHub Draft";
  const choice = await vscode.window.showInformationMessage(
    isJa
      ? "次の内容で GitHub Issue の下書きを開きます。自動では投稿されません。"
      : "The GitHub issue draft will contain the following. Nothing is posted automatically.",
    { modal: true, detail: `${report.title}\n\n${report.body}` },
    openLabel,
  );
  if (choice !== openLabel) {
    return false;
  }
  await openBugReport(report.title, report.body);
  return true;
}
