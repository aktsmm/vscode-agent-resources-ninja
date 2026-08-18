import * as fs from "fs/promises";
import { SELF_EXTENSION_ID } from "./coexistence";
import { isSafeGitHubRepositoryUrl, isSafeGitRef } from "./gitHubRefSafety";
import {
  createEmptySharedSourcesManifest,
  getAgentNinjaSharedDirectoryPath,
  getSharedSourcesManifestUri,
  SHARED_MANIFEST_SCHEMA_VERSION,
  SHARED_SOURCES_MANIFEST_MAX_BYTES,
  SHARED_SOURCES_MANIFEST_TEMP_FILE,
  SharedSourcesManifest,
  SourceEntry,
} from "./sharedManifest";
import type { SourceScanner } from "./skillIndex";
import { logger } from "./logger";
import {
  describeSharedStoreLockFailure,
  withSharedStoreLock,
} from "./sharedStoreLock";

/** Every field the manifest schema knows about; anything else belongs to another writer. */
const KNOWN_SOURCE_ENTRY_KEYS: readonly string[] = [
  "id",
  "name",
  "url",
  "type",
  "repoId",
  "scanner",
  "foreignScanner",
  "branch",
  "lastIndexedAt",
  "lastIndexedBy",
  "description",
  "description_ja",
  "includePaths",
  "excludePaths",
];

/** Assigning these on a plain object rewrites its prototype, so they never round-trip. */
const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const SOURCE_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
// Wide enough for any scanner name either extension may add, narrow enough that a
// value we keep for another writer cannot smuggle a path or a control character.
// Exported so the contract test can assert the value the sibling extension uses.
export const FOREIGN_SCANNER_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const MAX_FIELD_LENGTH = 512;
const MAX_PATH_ENTRIES = 64;
/** A file with more entries than this is treated as hostile rather than curated. */
export const MAX_SHARED_SOURCE_ENTRIES = 500;

/**
 * Reads and writes are held to the same limits. A writer looser than the reader
 * emits a file it refuses on the next read, and refusing a file we may not repair
 * means every entry in it is lost.
 */
function describeOversizedManifest(
  entryCount: number,
  byteLength: number,
): string | undefined {
  if (byteLength > SHARED_SOURCES_MANIFEST_MAX_BYTES) {
    return `${byteLength} bytes exceeds the ${SHARED_SOURCES_MANIFEST_MAX_BYTES} byte limit`;
  }
  if (entryCount > MAX_SHARED_SOURCE_ENTRIES) {
    return `${entryCount} entries exceeds the ${MAX_SHARED_SOURCE_ENTRIES} entry limit`;
  }
  return undefined;
}

export type SharedSourcesManifestReadResult =
  | { status: "missing" }
  | { status: "rejected"; reason: string }
  | {
      status: "valid";
      manifest: SharedSourcesManifest;
      /** Verbatim entries as they were read, so a rewrite cannot drop foreign data. */
      rawEntries: unknown[];
      /** How many entries failed validation and are therefore not usable. */
      rejectedEntryCount: number;
    };

export type SharedSourcesManifestWriteResult =
  | { status: "written"; lastUpdated: string }
  | { status: "rejected"; reason: string };

/**
 * The `lastUpdated` of the manifest this process last observed. Removing an entry
 * is only safe while that view is current: an id missing from our own list is a
 * deliberate local removal, but after a sibling writes it could just as easily be
 * a source we have not loaded yet.
 */
let lastObservedManifestVersion: string | undefined;
let hasObservedManifest = false;

/** Test seam: the observed version is process state and must not leak between cases. */
export function resetSharedSourcesManifestSession(): void {
  lastObservedManifestVersion = undefined;
  hasObservedManifest = false;
}

function readBoundedString(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_FIELD_LENGTH
    ? value
    : undefined;
}

// The shared store is writable by any tool on the machine, so a repository id is
// only trusted when it looks like a real GitHub numeric id.
function normalizeRepoId(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

const KNOWN_SOURCE_SCANNERS: SourceScanner[] = [
  "auto",
  "claude-commands",
  "top-level-dirs",
];

function normalizeScanner(value: unknown): SourceScanner | undefined {
  return KNOWN_SOURCE_SCANNERS.includes(value as SourceScanner)
    ? (value as SourceScanner)
    : undefined;
}

/**
 * Path prefixes decide what this extension downloads, so an externally written
 * value may only ever point inside the repository it belongs to.
 */
function isSafeRelativePath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_FIELD_LENGTH ||
    value.includes("\0")
  ) {
    return false;
  }

  const normalized = value.replace(/\\/g, "/");
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("~") ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    return false;
  }

  return !normalized.split("/").some((segment) => segment === "..");
}

function normalizePathList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_PATH_ENTRIES) {
    return undefined;
  }
  return value.every(isSafeRelativePath) ? [...(value as string[])] : undefined;
}

interface InspectedSourceEntry {
  /** Present only when the entry carries every field the runtime requires. */
  entry?: SourceEntry;
  /** The known fields that passed validation, used to rebuild a safe rewrite. */
  known: Record<string, unknown>;
  /** Fields written by some other tool, preserved untouched. */
  unknown: Record<string, unknown>;
}

/**
 * Splits one raw entry into "safe to use", "safe to keep" and "drop". An entry
 * that fails validation is never used at runtime, but it is still another
 * writer's data and is carried through a rewrite verbatim.
 */
function inspectSourceEntry(raw: unknown): InspectedSourceEntry {
  const known: Record<string, unknown> = {};
  const unknown: Record<string, unknown> = {};

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { known, unknown };
  }

  const candidate = raw as Record<string, unknown>;
  for (const [key, value] of Object.entries(candidate)) {
    if (UNSAFE_OBJECT_KEYS.has(key) || KNOWN_SOURCE_ENTRY_KEYS.includes(key)) {
      continue;
    }
    unknown[key] = value;
  }

  const id =
    typeof candidate.id === "string" && SOURCE_ID_PATTERN.test(candidate.id)
      ? candidate.id
      : undefined;
  const name = readBoundedString(candidate.name);
  const url = isSafeGitHubRepositoryUrl(candidate.url)
    ? candidate.url
    : undefined;
  const type = readBoundedString(candidate.type);
  const description =
    typeof candidate.description === "string" &&
    candidate.description.length <= MAX_FIELD_LENGTH
      ? candidate.description
      : undefined;

  const validated: Record<string, unknown> = {
    id,
    name,
    url,
    type,
    repoId: normalizeRepoId(candidate.repoId),
    scanner: normalizeScanner(candidate.scanner),
    branch: isSafeGitRef(candidate.branch) ? candidate.branch : undefined,
    lastIndexedAt: readBoundedString(candidate.lastIndexedAt),
    lastIndexedBy: readBoundedString(candidate.lastIndexedBy),
    description,
    description_ja: readBoundedString(candidate.description_ja),
    includePaths: normalizePathList(candidate.includePaths),
    excludePaths: normalizePathList(candidate.excludePaths),
  };
  for (const [key, value] of Object.entries(validated)) {
    if (value !== undefined) {
      known[key] = value;
    }
  }

  // The sibling extension implements scanners we do not, and we implement one it
  // does not. A name we cannot run is another writer's configuration, so it is kept
  // on disk even though it never reaches our runtime.
  if (
    known.scanner === undefined &&
    typeof candidate.scanner === "string" &&
    FOREIGN_SCANNER_PATTERN.test(candidate.scanner)
  ) {
    known.scanner = candidate.scanner;
  }
  const foreignScanner =
    validated.scanner === undefined && typeof known.scanner === "string"
      ? known.scanner
      : undefined;

  if (!id || !name || !url || !type) {
    return { known, unknown };
  }

  // A branch or path prefix that steers a download is a reason to reject the entry:
  // it should never be used at runtime or written back to disk as a usable resource.
  if (
    (candidate.branch !== undefined && validated.branch === undefined) ||
    (candidate.includePaths !== undefined &&
      validated.includePaths === undefined) ||
    (candidate.excludePaths !== undefined &&
      validated.excludePaths === undefined)
  ) {
    return { known, unknown };
  }

  return {
    entry: {
      id,
      name,
      url,
      type,
      repoId: validated.repoId as number | undefined,
      scanner: validated.scanner as SourceScanner | undefined,
      foreignScanner,
      branch: validated.branch as string | undefined,
      lastIndexedAt: validated.lastIndexedAt as string | undefined,
      lastIndexedBy: validated.lastIndexedBy as string | undefined,
      description: description ?? "",
      description_ja: validated.description_ja as string | undefined,
      includePaths: validated.includePaths as string[] | undefined,
      excludePaths: validated.excludePaths as string[] | undefined,
    },
    known,
    unknown,
  };
}

export function normalizeSourceEntry(source: SourceEntry): SourceEntry {
  return {
    id: source.id,
    name: source.name,
    url: source.url,
    type: source.type,
    repoId: normalizeRepoId(source.repoId),
    scanner: source.foreignScanner
      ? undefined
      : normalizeScanner(source.scanner),
    foreignScanner: source.foreignScanner,
    // Held to the same rule the reader applies, so we never publish an entry that
    // we would then refuse to read back. Losing the branch falls back to the
    // repository default; keeping it would lose the whole source.
    branch: isSafeGitRef(source.branch) ? source.branch : undefined,
    lastIndexedAt: source.lastIndexedAt,
    lastIndexedBy: source.lastIndexedBy,
    description: source.description,
    description_ja: source.description_ja,
    includePaths: source.includePaths,
    excludePaths: source.excludePaths,
  };
}

function toDefinedFields(entry: SourceEntry): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(normalizeSourceEntry(entry))) {
    if (key !== "foreignScanner" && value !== undefined) {
      fields[key] = value;
    }
  }
  return fields;
}

/**
 * Rebuilds the entry list for a rewrite without losing anything the reader could
 * not interpret. Our validated values win on the fields we own, fields written by
 * someone else survive untouched, and an entry we could not validate is copied
 * through as-is.
 */
export function mergeSourceEntriesForRewrite(
  rawEntries: readonly unknown[],
  ownEntries: readonly SourceEntry[],
  options: { allowRemoval: boolean },
): Record<string, unknown>[] {
  const ownById = new Map(ownEntries.map((entry) => [entry.id, entry]));
  const emittedIds = new Set<string>();
  const merged: Record<string, unknown>[] = [];

  for (const rawEntry of rawEntries) {
    const inspected = inspectSourceEntry(rawEntry);
    const rawId = inspected.entry?.id;

    // An entry we cannot interpret is someone else's data: never used, never dropped.
    if (!rawId) {
      if (
        rawEntry &&
        typeof rawEntry === "object" &&
        !Array.isArray(rawEntry)
      ) {
        const preserved: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(
          rawEntry as Record<string, unknown>,
        )) {
          if (!UNSAFE_OBJECT_KEYS.has(key)) {
            preserved[key] = value;
          }
        }
        merged.push(preserved);
      }
      continue;
    }

    const own = ownById.get(rawId);
    if (!own) {
      // Only a current view can tell a local removal apart from a source the
      // sibling added since we last read the file.
      if (!options.allowRemoval) {
        merged.push({ ...inspected.unknown, ...inspected.known });
      }
      continue;
    }

    if (own.foreignScanner) {
      // This scanner belongs to another writer. Preserve its complete entry;
      // our stale cache must not overwrite scanner, freshness or path curation.
      merged.push({ ...inspected.unknown, ...inspected.known });
      emittedIds.add(rawId);
      continue;
    }

    merged.push({
      ...inspected.unknown,
      ...inspected.known,
      ...toDefinedFields(own),
    });
    emittedIds.add(rawId);
  }

  for (const own of ownEntries) {
    if (!emittedIds.has(own.id)) {
      if (own.foreignScanner) {
        // The sibling removed this foreign-owned source after our last read.
        // A stale runtime marker must not recreate it without its scanner.
        continue;
      }
      merged.push(toDefinedFields(own));
    }
  }

  return merged;
}

type ManifestFileRead =
  | { status: "missing" }
  | { status: "rejected"; reason: string }
  | { status: "read"; content: string };

async function readManifestFile(filePath: string): Promise<ManifestFileRead> {
  let handle;
  try {
    handle = await fs.open(filePath, "r");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      /ENOENT|FileNotFound/i.test(message) ||
      (error as { code?: string })?.code === "ENOENT"
    ) {
      return { status: "missing" };
    }
    return { status: "rejected", reason: `unreadable: ${message}` };
  }

  try {
    // Sized through the open handle so the check cannot be raced by a rewrite
    // between the stat and the read.
    const stats = await handle.stat();
    const oversized = describeOversizedManifest(0, stats.size);
    if (oversized) {
      return { status: "rejected", reason: oversized };
    }
    return { status: "read", content: await handle.readFile("utf8") };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "rejected", reason: `unreadable: ${message}` };
  } finally {
    await handle.close();
  }
}

function parseManifestRoot(content: string):
  | { status: "rejected"; reason: string }
  | {
      status: "parsed";
      sources: unknown[];
      lastUpdated?: string;
      updatedBy?: string;
    } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { status: "rejected", reason: `invalid JSON: ${reason}` };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "rejected", reason: "manifest is not an object" };
  }

  const candidate = parsed as Partial<SharedSourcesManifest>;
  if (candidate.schemaVersion !== SHARED_MANIFEST_SCHEMA_VERSION) {
    return { status: "rejected", reason: "schema version mismatch" };
  }
  if (!Array.isArray(candidate.sources)) {
    return { status: "rejected", reason: "sources is not an array" };
  }
  const oversized = describeOversizedManifest(candidate.sources.length, 0);
  if (oversized) {
    return { status: "rejected", reason: oversized };
  }

  return {
    status: "parsed",
    sources: candidate.sources,
    lastUpdated:
      typeof candidate.lastUpdated === "string"
        ? candidate.lastUpdated
        : undefined,
    updatedBy:
      typeof candidate.updatedBy === "string" ? candidate.updatedBy : undefined,
  };
}

/**
 * Reads the shared manifest without ever modifying it. A file we cannot use is
 * reported as `rejected` and left exactly where it is, because a reader has no way
 * to tell a corrupt file apart from one another process is in the middle of
 * repairing.
 */
export async function readSharedSourcesManifest(): Promise<SharedSourcesManifestReadResult> {
  const filePath = getSharedSourcesManifestUri().fsPath;
  const file = await readManifestFile(filePath);

  if (file.status === "missing") {
    lastObservedManifestVersion = undefined;
    hasObservedManifest = true;
    return { status: "missing" };
  }

  if (file.status === "rejected") {
    logger.warn(
      `[Resource Ninja] Shared sources manifest rejected (${file.reason}). The file is left untouched.`,
    );
    return { status: "rejected", reason: file.reason };
  }

  const root = parseManifestRoot(file.content);
  if (root.status === "rejected") {
    logger.warn(
      `[Resource Ninja] Shared sources manifest rejected (${root.reason}). The file is left untouched.`,
    );
    return { status: "rejected", reason: root.reason };
  }

  const usableSources: SourceEntry[] = [];
  const seenIds = new Set<string>();
  let rejectedEntryCount = 0;
  for (const rawEntry of root.sources) {
    const inspected = inspectSourceEntry(rawEntry);
    if (!inspected.entry) {
      rejectedEntryCount += 1;
      continue;
    }
    // A repeated id is one source described twice, not two sources.
    if (seenIds.has(inspected.entry.id)) {
      continue;
    }
    seenIds.add(inspected.entry.id);
    usableSources.push(inspected.entry);
  }
  if (rejectedEntryCount > 0) {
    logger.warn(
      `[Resource Ninja] Ignoring ${rejectedEntryCount} shared source entries that failed validation. They stay on disk untouched.`,
    );
  }

  const lastUpdated = root.lastUpdated ?? new Date().toISOString();
  lastObservedManifestVersion = lastUpdated;
  hasObservedManifest = true;

  return {
    status: "valid",
    manifest: {
      schemaVersion: SHARED_MANIFEST_SCHEMA_VERSION,
      sources: usableSources,
      lastUpdated,
      updatedBy: root.updatedBy ?? SELF_EXTENSION_ID,
    },
    rawEntries: root.sources,
    rejectedEntryCount,
  };
}

/**
 * The single writer for `sources.json`. Re-reads the file under the lock and
 * merges into it, so a concurrent writer's entries are never replaced by our own
 * view of the world.
 */
export async function writeSharedSourcesManifest(
  manifest: SharedSourcesManifest,
): Promise<SharedSourcesManifestWriteResult> {
  const ownEntries = manifest.sources.map(normalizeSourceEntry);
  const sharedDir = getAgentNinjaSharedDirectoryPath();
  const filePath = getSharedSourcesManifestUri().fsPath;
  const tempPath = `${sharedDir}/${SHARED_SOURCES_MANIFEST_TEMP_FILE}`;

  try {
    return await withSharedStoreLock(SELF_EXTENSION_ID, async (lease) => {
      const current = await readManifestFile(filePath);
      if (current.status === "rejected") {
        logger.warn(
          `[Resource Ninja] Refusing to rewrite the shared sources manifest (${current.reason}).`,
        );
        return { status: "rejected", reason: current.reason };
      }

      let rawEntries: unknown[] = [];
      let onDiskLastUpdated: string | undefined;
      if (current.status === "read") {
        const root = parseManifestRoot(current.content);
        if (root.status === "rejected") {
          logger.warn(
            `[Resource Ninja] Refusing to rewrite the shared sources manifest (${root.reason}).`,
          );
          return { status: "rejected", reason: root.reason };
        }
        rawEntries = root.sources;
        onDiskLastUpdated = root.lastUpdated;
      }

      const allowRemoval =
        hasObservedManifest &&
        onDiskLastUpdated === lastObservedManifestVersion;
      const mergedSources = mergeSourceEntriesForRewrite(
        rawEntries,
        ownEntries,
        { allowRemoval },
      );
      const lastUpdated = manifest.lastUpdated || new Date().toISOString();

      // Serialized once: a second stringify would let the checked text and the
      // written text drift apart.
      const payload = JSON.stringify(
        {
          schemaVersion: SHARED_MANIFEST_SCHEMA_VERSION,
          sources: mergedSources,
          lastUpdated,
          updatedBy: manifest.updatedBy,
        },
        null,
        2,
      );

      // The merge adds our entries to whatever is already on disk, so the result can
      // exceed the limits our own reader enforces. Writing it would pause sharing
      // permanently for both extensions.
      const oversized = describeOversizedManifest(
        mergedSources.length,
        new TextEncoder().encode(payload).length,
      );
      if (oversized) {
        logger.warn(
          `[Resource Ninja] Refusing to write the shared sources manifest (${oversized}).`,
        );
        return { status: "rejected", reason: oversized };
      }

      await fs.mkdir(sharedDir, { recursive: true });
      lease.assertHeld();
      await fs.writeFile(tempPath, payload, "utf8");
      // Nothing may be awaited between this check and the rename.
      await lease.assertStillOwned();
      await fs.rename(tempPath, filePath);

      lastObservedManifestVersion = lastUpdated;
      hasObservedManifest = true;
      return { status: "written", lastUpdated };
    });
  } catch (error) {
    // Sharing the store means another writer can take the lock away from us. That
    // is a paused sync the caller has to surface, not an exception.
    const reason = describeSharedStoreLockFailure(error);
    if (!reason) {
      throw error;
    }
    logger.warn(
      `[Resource Ninja] Did not write the shared sources manifest (${reason}).`,
    );
    return { status: "rejected", reason };
  }
}

/**
 * Only ever called when the manifest is genuinely absent. A file we merely failed
 * to read must not be replaced with our own source list, because that would drop
 * every source only the sibling extension knows about.
 */
export async function bootstrapSharedSourcesManifest(
  sources: SourceEntry[],
): Promise<SharedSourcesManifestWriteResult> {
  const manifest = createEmptySharedSourcesManifest(SELF_EXTENSION_ID);
  manifest.sources = sources.map(normalizeSourceEntry);
  manifest.lastUpdated = new Date().toISOString();
  return await writeSharedSourcesManifest(manifest);
}
