import type { SkillIndex, Source } from "./skillIndex";
import type { ScanMeta } from "./sharedManifest";

export const STALE_SOURCE_INDEX_DAYS = 30;
export const STALE_SOURCE_INDEX_MAX_AGE_MS =
  STALE_SOURCE_INDEX_DAYS * 24 * 60 * 60 * 1000;

export interface SourceFreshnessInfo {
  source: Source;
  timestamp?: string;
  stale: boolean;
}

function parseTimestampMs(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const timestampMs = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? Date.parse(`${trimmed}T00:00:00.000Z`)
    : Date.parse(trimmed);

  return Number.isFinite(timestampMs) ? timestampMs : undefined;
}

export function getSourceFreshnessTimestamp(
  source: Pick<Source, "id" | "lastIndexedAt">,
  scanMeta: Record<string, ScanMeta> | undefined,
  indexLastUpdated: string | undefined,
): string | undefined {
  return (
    source.lastIndexedAt ||
    scanMeta?.[source.id]?.lastScannedAt ||
    indexLastUpdated
  );
}

export function isSourceIndexStale(
  timestamp: string | undefined,
  options?: { nowMs?: number; maxAgeMs?: number },
): boolean {
  const nowMs = options?.nowMs ?? Date.now();
  const timestampMs = parseTimestampMs(timestamp);
  if (timestampMs === undefined || timestampMs > nowMs) {
    return true;
  }

  return (
    nowMs - timestampMs > (options?.maxAgeMs ?? STALE_SOURCE_INDEX_MAX_AGE_MS)
  );
}

export function collectStaleSources(
  index: Pick<SkillIndex, "sources" | "lastUpdated">,
  scanMeta?: Record<string, ScanMeta>,
  options?: { nowMs?: number; maxAgeMs?: number },
): SourceFreshnessInfo[] {
  return index.sources
    .map((source) => {
      const timestamp = getSourceFreshnessTimestamp(
        source,
        scanMeta,
        index.lastUpdated,
      );
      return {
        source,
        timestamp,
        stale: isSourceIndexStale(timestamp, options),
      };
    })
    .filter((entry) => entry.stale);
}

export function stampIndexedSources(
  sources: Source[],
  sourceIds: readonly string[],
  indexedAt: string,
): Source[] {
  if (sourceIds.length === 0) {
    return sources;
  }

  const stampedSourceIds = new Set(sourceIds);
  return sources.map((source) =>
    stampedSourceIds.has(source.id)
      ? { ...source, lastIndexedAt: indexedAt }
      : source,
  );
}
