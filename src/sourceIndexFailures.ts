import type { Source } from "./skillIndex";
import { SourceScanError } from "./sourceUpdateReconcile";

export const SOURCE_INDEX_FAILURES_KEY = "resourceNinja.sourceIndexFailures";
export const PERSISTENT_FAILURE_RETRY_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Failures that a retry does not change on its own. Everything else is transient. */
export type PersistentSourceFailureKind = "empty-scan" | "identity-changed";

const PERSISTENT_KINDS: ReadonlySet<string> = new Set<string>([
  "empty-scan",
  "identity-changed",
] satisfies PersistentSourceFailureKind[]);

export interface SourceFailureRecord {
  kind: PersistentSourceFailureKind;
  lastFailedAt: string;
  /** Whether this cause was already shown. A different kind is shown again. */
  notified: boolean;
  /** The user opted this source out of automatic updates until a manual update succeeds. */
  muted: boolean;
  /** Ties the record to the source definition, so an edited source starts clean. */
  fingerprint: string;
}

export type SourceFailureState = Record<string, SourceFailureRecord>;

export function getSourceFingerprint(
  source: Pick<
    Source,
    "url" | "branch" | "scanner" | "includePaths" | "excludePaths"
  >,
): string {
  return JSON.stringify([
    source.url,
    source.branch ?? null,
    source.scanner ?? null,
    source.includePaths ?? null,
    source.excludePaths ?? null,
  ]);
}

/**
 * Classified by the error's type, never by its message: messages are translated,
 * so matching text would sort the same failure differently per language.
 */
export function classifyPersistentFailure(
  error: unknown,
): PersistentSourceFailureKind | undefined {
  return error instanceof SourceScanError && PERSISTENT_KINDS.has(error.kind)
    ? (error.kind as PersistentSourceFailureKind)
    : undefined;
}

export function normalizeFailureState(raw: unknown): SourceFailureState {
  const state: SourceFailureState = Object.create(null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return state;
  }

  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const record = value as Partial<SourceFailureRecord> | null;
    if (
      !record ||
      typeof record !== "object" ||
      typeof record.kind !== "string" ||
      !PERSISTENT_KINDS.has(record.kind) ||
      typeof record.lastFailedAt !== "string" ||
      Number.isNaN(Date.parse(record.lastFailedAt)) ||
      typeof record.fingerprint !== "string"
    ) {
      continue;
    }
    state[id] = {
      kind: record.kind,
      lastFailedAt: record.lastFailedAt,
      notified: record.notified === true,
      muted: record.muted === true,
      fingerprint: record.fingerprint,
    };
  }
  return state;
}

function currentRecord(
  state: SourceFailureState,
  source: Source,
): SourceFailureRecord | undefined {
  const record = state[source.id];
  return record && record.fingerprint === getSourceFingerprint(source)
    ? record
    : undefined;
}

/** Drops records of sources that were removed or retired, or whose definition changed. */
export function pruneFailureState(
  state: SourceFailureState,
  sources: readonly Source[],
): SourceFailureState {
  const next: SourceFailureState = Object.create(null);
  for (const source of sources) {
    const record = currentRecord(state, source);
    if (record) {
      next[source.id] = record;
    }
  }
  return next;
}

export function isEligibleForAutoUpdate(
  state: SourceFailureState,
  source: Source,
  now: Date = new Date(),
): boolean {
  const record = currentRecord(state, source);
  if (!record) {
    return true;
  }
  if (record.muted) {
    return false;
  }
  return (
    now.getTime() - Date.parse(record.lastFailedAt) >=
    PERSISTENT_FAILURE_RETRY_DAYS * DAY_MS
  );
}

export function recordPersistentFailure(
  state: SourceFailureState,
  source: Source,
  kind: PersistentSourceFailureKind,
  now: Date = new Date(),
  /** When false no notice can be shown, so the cause is not marked as shown. */
  canNotify: boolean = true,
): { state: SourceFailureState; shouldNotify: boolean } {
  const existing = currentRecord(state, source);
  const needsNotice = !existing || existing.kind !== kind || !existing.notified;
  const shouldNotify = needsNotice && canNotify;
  return {
    state: {
      ...state,
      [source.id]: {
        kind,
        lastFailedAt: now.toISOString(),
        notified: needsNotice ? shouldNotify : true,
        muted: existing?.muted ?? false,
        fingerprint: getSourceFingerprint(source),
      },
    },
    shouldNotify,
  };
}

export function muteSource(
  state: SourceFailureState,
  source: Source,
): SourceFailureState {
  const existing = currentRecord(state, source);
  return existing
    ? { ...state, [source.id]: { ...existing, muted: true } }
    : state;
}

/**
 * Splits one batch of failures into the ones to report every time and the lasting
 * ones to report once per cause. At most `maxNotices` lasting causes are shown in
 * one run; the rest stay unshown in the state so a later run can show them.
 */
export function triageSourceFailures<
  T extends { entry: Source; error: unknown },
>(
  state: SourceFailureState,
  failures: readonly T[],
  options: { maxNotices: number; now?: Date },
): {
  state: SourceFailureState;
  transient: T[];
  notices: Array<{ source: Source; kind: PersistentSourceFailureKind }>;
} {
  let next = state;
  const transient: T[] = [];
  const notices: Array<{
    source: Source;
    kind: PersistentSourceFailureKind;
  }> = [];
  for (const failure of failures) {
    const kind = classifyPersistentFailure(failure.error);
    if (!kind) {
      transient.push(failure);
      continue;
    }
    const recorded = recordPersistentFailure(
      next,
      failure.entry,
      kind,
      options.now,
      notices.length < options.maxNotices,
    );
    next = recorded.state;
    if (recorded.shouldNotify) {
      notices.push({ source: failure.entry, kind });
    }
  }
  return { state: next, transient, notices };
}

/**
 * Causes that were recorded but never shown because a run hit its notice limit.
 * They are shown without scanning anything, and marked as shown here.
 */
export function takeUnshownFailures(
  state: SourceFailureState,
  sources: readonly Source[],
  maxNotices: number,
): {
  state: SourceFailureState;
  notices: Array<{ source: Source; kind: PersistentSourceFailureKind }>;
} {
  let next = state;
  const notices: Array<{
    source: Source;
    kind: PersistentSourceFailureKind;
  }> = [];
  for (const source of sources) {
    if (notices.length >= maxNotices) {
      break;
    }
    const record = currentRecord(next, source);
    if (record && !record.notified && !record.muted) {
      notices.push({ source, kind: record.kind });
      next = { ...next, [source.id]: { ...record, notified: true } };
    }
  }
  return { state: next, notices };
}

/** Ids of sources the user stopped auto-updating, for sources whose record is still current. */
export function getMutedSourceIds(
  state: SourceFailureState,
  sources: readonly Source[],
): Set<string> {
  const ids = new Set<string>();
  for (const source of sources) {
    if (currentRecord(state, source)?.muted) {
      ids.add(source.id);
    }
  }
  return ids;
}

export function clearFailure(
  state: SourceFailureState,
  sourceId: string,
): SourceFailureState {
  if (!(sourceId in state)) {
    return state;
  }
  const next = { ...state };
  delete next[sourceId];
  return next;
}

/**
 * A source that updated successfully has a newer `lastIndexedAt`. Comparing the
 * index before and after finds exactly those, without changing what the update
 * functions return.
 */
export function clearRecoveredSources(
  state: SourceFailureState,
  before: readonly Source[],
  after: readonly Source[],
): SourceFailureState {
  const beforeStamps = new Map(
    before.map((source) => [source.id, source.lastIndexedAt]),
  );
  let next = state;
  for (const source of after) {
    if (
      beforeStamps.has(source.id) &&
      beforeStamps.get(source.id) !== source.lastIndexedAt
    ) {
      next = clearFailure(next, source.id);
    }
  }
  return next;
}
