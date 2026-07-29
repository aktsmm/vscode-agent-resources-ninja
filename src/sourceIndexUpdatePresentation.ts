export type SourceIndexUpdateNotificationKind = "success" | "warning";

export function getSourceIndexUpdateNotificationKind(
  failureCount: number,
): SourceIndexUpdateNotificationKind {
  return failureCount > 0 ? "warning" : "success";
}

export function scaleSourceIndexProgressIncrement(
  sourceCount: number,
  increment: number | undefined,
): number | undefined {
  if (increment === undefined || !Number.isFinite(increment)) {
    return undefined;
  }

  return sourceCount > 0 ? increment / sourceCount : increment;
}

export function formatSourceIndexResetAt(
  resetAt: string,
  locale: string,
): string {
  const date = new Date(resetAt);
  if (Number.isNaN(date.getTime())) {
    return resetAt;
  }

  return new Intl.DateTimeFormat(locale || undefined, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export interface SourceIndexUpdateToolSummary {
  oldCount: number;
  newCount: number;
  oldUpdated: string;
  newUpdated: string;
  sourceStats: string;
  totalSources: number;
  succeededCount: number;
  failureCount: number;
  skippedCount: number;
  failedSources: string[];
}

export function formatSourceIndexUpdateToolResult(
  summary: SourceIndexUpdateToolSummary,
  locale: string,
): string {
  const isJapanese = locale.toLowerCase().startsWith("ja");
  const diff = summary.newCount - summary.oldCount;
  const diffText = diff > 0 ? `+${diff}` : diff === 0 ? "±0" : `${diff}`;
  const statusLine =
    summary.failureCount > 0
      ? isJapanese
        ? `⚠️ リソースインデックスの更新結果: ${summary.succeededCount}/${summary.totalSources} 件更新、${summary.failureCount} 件失敗、${summary.skippedCount} 件未試行。失敗: ${summary.failedSources.join(", ") || "不明"}。`
        : `⚠️ Resource index update partially completed: ${summary.succeededCount}/${summary.totalSources} updated, ${summary.failureCount} failed, ${summary.skippedCount} not attempted. Failed: ${summary.failedSources.join(", ") || "unknown"}.`
      : isJapanese
        ? "✅ リソースインデックスを更新しました。"
        : "✅ Resource index updated.";
  const labels = isJapanese
    ? {
        item: "項目",
        before: "更新前",
        after: "更新後",
        resources: "リソース数",
        updated: "最終更新",
        sources: "ソース",
      }
    : {
        item: "Item",
        before: "Before",
        after: "After",
        resources: "Resources",
        updated: "Last updated",
        sources: "Sources",
      };

  return `${statusLine}

| ${labels.item} | ${labels.before} | ${labels.after} |
|---|---:|---:|
| ${labels.resources} | ${summary.oldCount} | ${summary.newCount} (${diffText}) |
| ${labels.updated} | ${summary.oldUpdated} | ${summary.newUpdated} |
| ${labels.sources} | - | ${summary.sourceStats} |`;
}
