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

export interface IndexedResourceEntry {
  source: string;
  kind?: string;
  path: string;
  name: string;
}

export interface IndexedResourceChanges {
  added: string[];
  removed: string[];
}

export function getIndexedResourceChanges(
  previous: readonly IndexedResourceEntry[],
  current: readonly IndexedResourceEntry[],
): IndexedResourceChanges {
  const identity = (resource: IndexedResourceEntry) =>
    JSON.stringify([resource.source, resource.kind || "skill", resource.path]);
  const oldEntries = new Map(
    previous.map((resource) => [identity(resource), resource.name]),
  );
  const newEntries = new Map(
    current.map((resource) => [identity(resource), resource.name]),
  );
  return {
    added: [...newEntries]
      .filter(([resourceId]) => !oldEntries.has(resourceId))
      .map(([, name]) => name)
      .sort(),
    removed: [...oldEntries]
      .filter(([resourceId]) => !newEntries.has(resourceId))
      .map(([, name]) => name)
      .sort(),
  };
}

export function formatIndexedResourceChanges(
  changes: IndexedResourceChanges,
  locale: string,
): string {
  const isJapanese = locale.toLowerCase().startsWith("ja");
  const formatNames = (names: string[], label: string) => {
    const displayNames = names
      .slice(0, 3)
      .map((name) =>
        Array.from(name.replace(/\s+/g, " ").trim()).slice(0, 80).join(""),
      );
    const remaining = names.length - displayNames.length;
    return `${label} ${names.length}${isJapanese ? " 件" : ""}: ${displayNames.join(", ")}${remaining > 0 ? ` (+${remaining})` : ""}`;
  };
  return [
    changes.added.length > 0 &&
      formatNames(changes.added, isJapanese ? "追加" : "Added"),
    changes.removed.length > 0 &&
      formatNames(changes.removed, isJapanese ? "削除" : "Removed"),
  ]
    .filter(Boolean)
    .join("; ");
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
  changes?: IndexedResourceChanges;
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
  const changeSummary = summary.changes
    ? formatIndexedResourceChanges(summary.changes, locale)
    : "";
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

  return `${statusLine}${changeSummary ? `\n\n${changeSummary}` : ""}

| ${labels.item} | ${labels.before} | ${labels.after} |
|---|---:|---:|
| ${labels.resources} | ${summary.oldCount} | ${summary.newCount} (${diffText}) |
| ${labels.updated} | ${summary.oldUpdated} | ${summary.newUpdated} |
| ${labels.sources} | - | ${summary.sourceStats} |`;
}
