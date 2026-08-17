import type { SkillIndex, Source } from "./skillIndex";
import type { ScanMeta } from "./sharedManifest";

export const STALE_SOURCE_INDEX_DAYS = 30;
export const STALE_SOURCE_INDEX_MAX_AGE_MS =
  STALE_SOURCE_INDEX_DAYS * 24 * 60 * 60 * 1000;
export const STALE_SOURCE_INDEX_MAX_PER_STARTUP = 5;

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

export interface SourceFreshnessOptions {
  /**
   * This extension's id. A `lastIndexedAt` stamped by a different extension is
   * not our scan evidence, so it is ignored here. Omitting the id keeps every
   * timestamp self-owned, which is what a caller without coexistence context wants.
   */
  selfExtensionId?: string;
}

/**
 * A source is only as fresh as the last scan of that source. The catalog publish
 * date is deliberately not a fallback: it would make a source nobody ever scanned
 * look up to date.
 *
 * A record with no `lastIndexedBy` is legacy data written before attribution
 * existed, so it counts as ours; treating it as foreign would turn every existing
 * source stale at once.
 */
export function getSourceFreshnessTimestamp(
  source: Pick<Source, "id" | "lastIndexedAt" | "lastIndexedBy">,
  scanMeta: Record<string, ScanMeta> | undefined,
  options?: SourceFreshnessOptions,
): string | undefined {
  const selfExtensionId = options?.selfExtensionId;
  const stampedByUs =
    !source.lastIndexedBy ||
    !selfExtensionId ||
    source.lastIndexedBy === selfExtensionId;

  if (stampedByUs && source.lastIndexedAt) {
    return source.lastIndexedAt;
  }

  // A foreign stamp still means the shared store holds a real scan, so the shared
  // index is consulted instead of rescanning work the sibling already did.
  return scanMeta?.[source.id]?.lastScannedAt;
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
  index: Pick<SkillIndex, "sources">,
  scanMeta?: Record<string, ScanMeta>,
  options?: { nowMs?: number; maxAgeMs?: number; selfExtensionId?: string },
): SourceFreshnessInfo[] {
  return index.sources
    .map((source) => {
      const timestamp = getSourceFreshnessTimestamp(source, scanMeta, {
        selfExtensionId: options?.selfExtensionId,
      });
      return {
        source,
        timestamp,
        stale: isSourceIndexStale(timestamp, options),
      };
    })
    .filter((entry) => entry.stale);
}

/**
 * Oldest first, never-indexed before everything else, ties keeping the caller's
 * order. A run cut short by a rate limit then spends its budget on the sources
 * that are furthest behind instead of the same head of the list every time.
 */
export function sortSourcesByFreshness(
  sources: readonly Source[],
  scanMeta?: Record<string, ScanMeta>,
  options?: SourceFreshnessOptions,
): Source[] {
  return sources
    .map((source, position) => ({
      source,
      position,
      timestampMs: parseTimestampMs(
        getSourceFreshnessTimestamp(source, scanMeta, options),
      ),
    }))
    .sort((left, right) => {
      if (left.timestampMs !== right.timestampMs) {
        if (left.timestampMs === undefined) {
          return -1;
        }
        if (right.timestampMs === undefined) {
          return 1;
        }
        return left.timestampMs - right.timestampMs;
      }
      return left.position - right.position;
    })
    .map((entry) => entry.source);
}

export function stampIndexedSources(
  sources: Source[],
  sourceIds: readonly string[],
  indexedAt: string,
  indexedBy?: string,
): Source[] {
  if (sourceIds.length === 0) {
    return sources;
  }

  const stampedSourceIds = new Set(sourceIds);
  return sources.map((source) =>
    stampedSourceIds.has(source.id)
      ? { ...source, lastIndexedAt: indexedAt, lastIndexedBy: indexedBy }
      : source,
  );
}

export interface StaleSourceStartupSelection {
  selected: Source[];
  deferred: Source[];
  nextCursorSourceId?: string;
}

/**
 * Caps how many stale sources one startup refreshes and rotates the starting point,
 * so a source that keeps failing cannot starve the ones behind it.
 */
export function selectStaleSourcesForStartup(
  staleSources: Source[],
  options?: { maxPerStartup?: number; startAfterSourceId?: string },
): StaleSourceStartupSelection {
  const maxPerStartup =
    options?.maxPerStartup ?? STALE_SOURCE_INDEX_MAX_PER_STARTUP;

  if (staleSources.length === 0 || maxPerStartup <= 0) {
    return { selected: [], deferred: [...staleSources] };
  }

  const cursorIndex = options?.startAfterSourceId
    ? staleSources.findIndex(
        (source) => source.id === options.startAfterSourceId,
      )
    : -1;
  const startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const rotated = [
    ...staleSources.slice(startIndex),
    ...staleSources.slice(0, startIndex),
  ];

  const selected = rotated.slice(0, maxPerStartup);
  return {
    selected,
    deferred: rotated.slice(maxPerStartup),
    nextCursorSourceId: selected[selected.length - 1]?.id,
  };
}
