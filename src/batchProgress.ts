export function formatBatchFailureMessage(
  scopeLabel: string,
  success: number,
  total: number,
  failedNames: readonly string[],
  japanese: boolean,
): string {
  const failed = total - success;
  const summary = failedNames.slice(0, 3).join(", ");
  return japanese
    ? `${scopeLabel}: ${success}/${total} 件成功、${failed} 件失敗${summary ? ` (${summary}${failedNames.length > 3 ? "..." : ""})` : ""}`
    : `${scopeLabel}: ${success}/${total} succeeded, ${failed} failed${summary ? ` (${summary}${failedNames.length > 3 ? "..." : ""})` : ""}`;
}

export function formatBatchCancellationSuffix(
  processed: number,
  requested: number,
  japanese: boolean,
): string {
  const unprocessed = Math.max(0, requested - processed);
  return japanese
    ? `。キャンセルされ、${unprocessed} 件は未処理です`
    : `. Canceled with ${unprocessed} unprocessed`;
}
