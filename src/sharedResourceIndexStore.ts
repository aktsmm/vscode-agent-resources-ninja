import * as fs from "fs/promises";
import * as vscode from "vscode";
import { getEffectiveOwner, SELF_EXTENSION_ID } from "./coexistence";
import {
  getConfiguredUseSharedResourceIndex,
  getConfiguredUseSharedSourcesManifest,
} from "./customizationPaths";
import { logger } from "./logger";
import { buildSelfBeacon, RESOURCE_NINJA_KINDS } from "./coexistence";
import {
  createEmptySharedResourceBuckets,
  createEmptySharedResourceIndex,
  createTranslationKey,
  getAgentNinjaSharedDirectoryPath,
  getSharedResourceIndexUri,
  ResourceEntry,
  SCAN_DEDUP_WINDOW_MS,
  SHARED_RATE_LIMIT_RESUME_FILE,
  SHARED_RESOURCE_INDEX_SCHEMA_VERSION,
  SHARED_RESOURCE_INDEX_TEMP_FILE,
  SharedResourceIndex,
  SourceEntry,
} from "./sharedManifest";
import { withSharedStoreLock } from "./sharedStoreLock";
import {
  Skill,
  SkillIndex,
  Source,
  getIndexResources,
  getResourceKind,
} from "./skillIndex";
import {
  bootstrapSharedSourcesManifest,
  readSharedSourcesManifest,
  writeSharedSourcesManifest,
} from "./sharedSourcesManifestStore";

async function renameBrokenFile(filePath: string): Promise<void> {
  const brokenPath = `${filePath}.broken-${Date.now()}`;
  await fs.rename(filePath, brokenPath);
}

function normalizeSharedResourceIndex(
  raw: unknown,
): SharedResourceIndex | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<SharedResourceIndex>;
  if (candidate.schemaVersion !== SHARED_RESOURCE_INDEX_SCHEMA_VERSION) {
    return undefined;
  }

  const normalizedByKind = createEmptySharedResourceBuckets();
  for (const kind of RESOURCE_NINJA_KINDS) {
    const entries = candidate.byKind?.[kind];
    normalizedByKind[kind] = Array.isArray(entries)
      ? entries.filter((entry): entry is ResourceEntry => !!entry)
      : [];
  }

  return {
    schemaVersion: SHARED_RESOURCE_INDEX_SCHEMA_VERSION,
    lastFullScan:
      typeof candidate.lastFullScan === "string"
        ? candidate.lastFullScan
        : new Date(0).toISOString(),
    lastScannedBy:
      typeof candidate.lastScannedBy === "string"
        ? candidate.lastScannedBy
        : SELF_EXTENSION_ID,
    byKind: normalizedByKind,
    translations: {
      ja:
        candidate.translations && typeof candidate.translations === "object"
          ? { ...(candidate.translations.ja || {}) }
          : {},
    },
    scanMeta:
      candidate.scanMeta && typeof candidate.scanMeta === "object"
        ? { ...candidate.scanMeta }
        : {},
  };
}

function flattenSharedResources(index: SharedResourceIndex): Skill[] {
  const resources: Skill[] = [];
  for (const kind of RESOURCE_NINJA_KINDS) {
    for (const resource of index.byKind[kind]) {
      resources.push({ ...resource, kind: resource.kind || kind });
    }
  }
  return resources;
}

export function applySharedResourceIndexToSkillIndex(
  currentIndex: SkillIndex,
  sharedIndex: SharedResourceIndex,
): SkillIndex {
  const translatedSkills = flattenSharedResources(sharedIndex).map(
    (resource) => {
      const translationKey = createTranslationKey(resource);
      const translatedDescription = sharedIndex.translations.ja[translationKey];
      if (!translatedDescription) {
        return resource;
      }
      return {
        ...resource,
        description_ja: translatedDescription,
      };
    },
  );

  return {
    ...currentIndex,
    skills: translatedSkills,
    lastUpdated:
      sharedIndex.lastFullScan &&
      sharedIndex.lastFullScan !== new Date(0).toISOString()
        ? sharedIndex.lastFullScan.split("T")[0]
        : currentIndex.lastUpdated,
  };
}

export function buildSharedResourceIndexFromSkillIndex(
  currentIndex: SkillIndex,
  previousIndex?: SharedResourceIndex,
): SharedResourceIndex {
  const nextIndex = previousIndex
    ? {
        ...previousIndex,
        byKind: createEmptySharedResourceBuckets(),
        translations: { ja: { ...previousIndex.translations.ja } },
        scanMeta: { ...previousIndex.scanMeta },
      }
    : createEmptySharedResourceIndex(SELF_EXTENSION_ID);

  for (const resource of getIndexResources(currentIndex)) {
    const kind = getResourceKind(resource);
    nextIndex.byKind[kind].push({ ...resource, kind });
    if (resource.description_ja) {
      nextIndex.translations.ja[createTranslationKey(resource)] =
        resource.description_ja;
    }
  }

  const currentSourceIds = new Set(
    currentIndex.sources.map((source) => source.id),
  );
  for (const sourceId of Object.keys(nextIndex.scanMeta)) {
    if (!currentSourceIds.has(sourceId)) {
      delete nextIndex.scanMeta[sourceId];
    }
  }

  nextIndex.lastScannedBy = SELF_EXTENSION_ID;
  return nextIndex;
}

export async function readSharedResourceIndex(): Promise<
  SharedResourceIndex | undefined
> {
  const fileUri = getSharedResourceIndexUri();
  try {
    const content = await vscode.workspace.fs.readFile(fileUri);
    const parsed = normalizeSharedResourceIndex(
      JSON.parse(Buffer.from(content).toString("utf8")),
    );
    if (!parsed) {
      logger.warn("[Resource Ninja] Shared resource index schema mismatch.");
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ENOENT|FileNotFound/i.test(message)) {
      return undefined;
    }

    try {
      await renameBrokenFile(fileUri.fsPath);
    } catch {
      // Ignore rename failures and fall back to bundled/local data.
    }
    logger.warn(
      "[Resource Ninja] Failed to parse shared resource index:",
      error,
    );
    return undefined;
  }
}

export async function writeSharedResourceIndex(
  sharedIndex: SharedResourceIndex,
): Promise<void> {
  const normalizedIndex = normalizeSharedResourceIndex(sharedIndex);
  if (!normalizedIndex) {
    throw new Error("Invalid shared resource index payload");
  }

  const sharedDir = getAgentNinjaSharedDirectoryPath();
  const fileUri = getSharedResourceIndexUri();
  const tempPath = `${sharedDir}/${SHARED_RESOURCE_INDEX_TEMP_FILE}`;

  await withSharedStoreLock(SELF_EXTENSION_ID, async () => {
    await fs.mkdir(sharedDir, { recursive: true });
    await fs.writeFile(
      tempPath,
      JSON.stringify(normalizedIndex, null, 2),
      "utf8",
    );
    await fs.rename(tempPath, fileUri.fsPath);
  });
}

export async function bootstrapSharedResourceIndex(
  currentIndex: SkillIndex,
): Promise<SharedResourceIndex> {
  const sharedIndex = buildSharedResourceIndexFromSkillIndex(currentIndex);
  sharedIndex.lastFullScan = new Date().toISOString();
  await writeSharedResourceIndex(sharedIndex);
  return sharedIndex;
}

export async function syncSharedStoresFromSkillIndex(
  context: vscode.ExtensionContext,
  currentIndex: SkillIndex,
): Promise<void> {
  const config = vscode.workspace.getConfiguration("resourceNinja");
  const useSharedSourcesManifest =
    getConfiguredUseSharedSourcesManifest(config);
  const useSharedResourceIndex = getConfiguredUseSharedResourceIndex(config);

  if (!useSharedSourcesManifest && !useSharedResourceIndex) {
    return;
  }

  try {
    if (useSharedSourcesManifest) {
      const manifest = {
        schemaVersion: 1 as const,
        sources: currentIndex.sources.map(
          (source) => ({ ...source }) as SourceEntry,
        ),
        lastUpdated: new Date().toISOString(),
        updatedBy: SELF_EXTENSION_ID,
      };
      await writeSharedSourcesManifest(manifest);
    }

    if (useSharedResourceIndex) {
      const previousSharedIndex = await readSharedResourceIndex();
      const nextSharedIndex = buildSharedResourceIndexFromSkillIndex(
        currentIndex,
        previousSharedIndex,
      );
      if (
        !previousSharedIndex?.lastFullScan ||
        previousSharedIndex.lastFullScan === new Date(0).toISOString()
      ) {
        nextSharedIndex.lastFullScan = new Date().toISOString();
      }
      await writeSharedResourceIndex(nextSharedIndex);
    }
  } catch (error) {
    logger.warn(
      "[Resource Ninja] Failed to sync shared stores. Falling back to local cache.",
      error,
    );
  }
}

/**
 * The manifest decides which sources exist, but a field the writer did not know
 * about must not clear the locally known value. Keeps repo identity intact when an
 * older extension shares the same store.
 */
function mergeSharedManifestSources(
  localSources: Source[],
  manifestSources: SourceEntry[],
): Source[] {
  const localSourcesById = new Map(
    localSources.map((source) => [source.id, source]),
  );

  return manifestSources.map((incoming) => {
    const local = localSourcesById.get(incoming.id);
    if (!local) {
      return { ...incoming } as Source;
    }

    const merged: Source = { ...local };
    for (const [key, value] of Object.entries(incoming)) {
      if (value !== undefined) {
        (merged as unknown as Record<string, unknown>)[key] = value;
      }
    }
    return merged;
  });
}

export async function loadSharedStoresIntoSkillIndex(
  context: vscode.ExtensionContext,
  currentIndex: SkillIndex,
): Promise<SkillIndex> {
  const config = vscode.workspace.getConfiguration("resourceNinja");
  const useSharedSourcesManifest =
    getConfiguredUseSharedSourcesManifest(config);
  const useSharedResourceIndex = getConfiguredUseSharedResourceIndex(config);
  let nextIndex = currentIndex;

  if (useSharedSourcesManifest) {
    const manifest = await readSharedSourcesManifest();
    if (manifest) {
      nextIndex = {
        ...nextIndex,
        sources: mergeSharedManifestSources(
          nextIndex.sources,
          manifest.sources,
        ),
      };
    } else {
      try {
        await bootstrapSharedSourcesManifest(
          currentIndex.sources.map((source) => ({ ...source })),
        );
      } catch (error) {
        logger.warn(
          "[Resource Ninja] Failed to bootstrap shared sources manifest:",
          error,
        );
      }
    }
  }

  if (useSharedResourceIndex) {
    const sharedIndex = await readSharedResourceIndex();
    if (sharedIndex) {
      nextIndex = applySharedResourceIndexToSkillIndex(nextIndex, sharedIndex);
    } else {
      try {
        await bootstrapSharedResourceIndex(nextIndex);
      } catch (error) {
        logger.warn(
          "[Resource Ninja] Failed to bootstrap shared resource index:",
          error,
        );
      }
    }
  }

  return nextIndex;
}

/**
 * A refresh cut short by a GitHub rate limit leaves this behind so the sources it
 * never reached can be picked up once the window resets.
 */
export interface RateLimitResumeRecord {
  version: 1;
  sourceIds: string[];
  retryNotBefore: string;
  createdAt: string;
  /** Automatic resumes already spent on this record. */
  attempts: number;
  claimedBy?: string;
  claimedAt?: string;
}

/** One primary window plus margin; anything further out is a corrupt record. */
export const RATE_LIMIT_RESUME_MAX_WAIT_MS = 75 * 60 * 1000;
/** A claimer that never finished must not strand the record forever. */
export const RATE_LIMIT_RESUME_CLAIM_STALE_MS = 10 * 60 * 1000;
/**
 * The record shares a directory with a sibling extension, so it is parsed as
 * untrusted input: a record for every bundled source is under 2 KB, and these
 * caps stop a malformed or hostile file from being parsed or replayed at all.
 */
export const RATE_LIMIT_RESUME_MAX_FILE_BYTES = 64 * 1024;
export const RATE_LIMIT_RESUME_MAX_SOURCE_IDS = 500;
const RATE_LIMIT_RESUME_MAX_FIELD_LENGTH = 256;

function getRateLimitResumePath(): string {
  return `${getAgentNinjaSharedDirectoryPath()}/${SHARED_RATE_LIMIT_RESUME_FILE}`;
}

export function normalizeRateLimitResumeRecord(
  candidate: unknown,
  nowMs: number = Date.now(),
): RateLimitResumeRecord | undefined {
  if (!candidate || typeof candidate !== "object") {
    return undefined;
  }

  const record = candidate as Partial<RateLimitResumeRecord>;
  if (record.version !== 1 || !Array.isArray(record.sourceIds)) {
    return undefined;
  }

  const sourceIds: string[] = [];
  for (const id of record.sourceIds) {
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      id.length > RATE_LIMIT_RESUME_MAX_FIELD_LENGTH ||
      sourceIds.includes(id)
    ) {
      continue;
    }
    if (sourceIds.length >= RATE_LIMIT_RESUME_MAX_SOURCE_IDS) {
      return undefined;
    }
    sourceIds.push(id);
  }
  if (sourceIds.length === 0) {
    return undefined;
  }

  const readBoundedField = (value: unknown): string | undefined =>
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= RATE_LIMIT_RESUME_MAX_FIELD_LENGTH
      ? value
      : undefined;

  const retryNotBeforeMs =
    typeof record.retryNotBefore === "string"
      ? Date.parse(record.retryNotBefore)
      : NaN;
  if (
    !Number.isFinite(retryNotBeforeMs) ||
    retryNotBeforeMs - nowMs > RATE_LIMIT_RESUME_MAX_WAIT_MS
  ) {
    return undefined;
  }

  return {
    version: 1,
    sourceIds,
    retryNotBefore: new Date(retryNotBeforeMs).toISOString(),
    createdAt:
      readBoundedField(record.createdAt) ?? new Date(nowMs).toISOString(),
    attempts:
      typeof record.attempts === "number" && Number.isFinite(record.attempts)
        ? Math.max(0, Math.floor(record.attempts))
        : 0,
    claimedBy: readBoundedField(record.claimedBy),
    claimedAt: readBoundedField(record.claimedAt),
  };
}

async function readRateLimitResumeFile(
  nowMs: number,
): Promise<RateLimitResumeRecord | undefined> {
  const filePath = getRateLimitResumePath();
  try {
    // Checked before reading: this runs during activation, so an oversized file
    // must never be pulled into memory or parsed.
    const stats = await fs.stat(filePath);
    if (stats.size > RATE_LIMIT_RESUME_MAX_FILE_BYTES) {
      logger.warn(
        `[Resource Ninja] Ignoring the rate-limit resume record: ${stats.size} bytes exceeds the ${RATE_LIMIT_RESUME_MAX_FILE_BYTES} byte limit.`,
      );
      return undefined;
    }

    const content = await fs.readFile(filePath, "utf8");
    return normalizeRateLimitResumeRecord(JSON.parse(content), nowMs);
  } catch {
    return undefined;
  }
}

export async function readRateLimitResumeRecord(
  nowMs: number = Date.now(),
): Promise<RateLimitResumeRecord | undefined> {
  return readRateLimitResumeFile(nowMs);
}

export async function saveRateLimitResumeRecord(
  record: RateLimitResumeRecord,
): Promise<void> {
  await withSharedStoreLock(SELF_EXTENSION_ID, async () => {
    await fs.mkdir(getAgentNinjaSharedDirectoryPath(), { recursive: true });
    await fs.writeFile(
      getRateLimitResumePath(),
      JSON.stringify(record, null, 2),
      "utf8",
    );
  });
}

/**
 * Owner- and generation-checked, so a host that lost its claim cannot delete the
 * record the new owner is working on.
 */
export async function clearRateLimitResumeRecord(owner?: {
  createdAt: string;
  claimedBy: string;
}): Promise<void> {
  await withSharedStoreLock(SELF_EXTENSION_ID, async () => {
    if (owner) {
      const current = await readRateLimitResumeFile(Date.now());
      if (
        current &&
        (current.createdAt !== owner.createdAt ||
          current.claimedBy !== owner.claimedBy)
      ) {
        return;
      }
    }
    await fs.rm(getRateLimitResumePath(), { force: true });
  });
}

/**
 * Read, validate and claim in a single cross-process transaction, so two windows
 * reaching the deadline together cannot both resume and double the request load
 * while GitHub still considers the client rate limited.
 */
export async function claimRateLimitResumeRecord(
  claimedBy: string,
  nowMs: number = Date.now(),
): Promise<RateLimitResumeRecord | undefined> {
  return withSharedStoreLock(SELF_EXTENSION_ID, async () => {
    const record = await readRateLimitResumeFile(nowMs);
    // A resume that was itself rate-limited does not get another automatic try,
    // no matter which trigger asks or how often the host restarts.
    if (
      !record ||
      record.attempts > 0 ||
      Date.parse(record.retryNotBefore) > nowMs
    ) {
      return undefined;
    }

    const claimedAtMs = record.claimedAt ? Date.parse(record.claimedAt) : NaN;
    const claimIsLive =
      record.claimedBy !== undefined &&
      record.claimedBy !== claimedBy &&
      Number.isFinite(claimedAtMs) &&
      nowMs - claimedAtMs < RATE_LIMIT_RESUME_CLAIM_STALE_MS;
    if (claimIsLive) {
      return undefined;
    }

    const claimed: RateLimitResumeRecord = {
      ...record,
      claimedBy,
      claimedAt: new Date(nowMs).toISOString(),
    };
    await fs.mkdir(getAgentNinjaSharedDirectoryPath(), { recursive: true });
    await fs.writeFile(
      getRateLimitResumePath(),
      JSON.stringify(claimed, null, 2),
      "utf8",
    );
    return claimed;
  });
}

/**
 * A claim expires so a dead host cannot strand the record, so a resume that runs
 * longer than that window has to keep saying it is still alive.
 */
export async function renewRateLimitResumeClaim(
  claimedBy: string,
  createdAt: string,
  nowMs: number = Date.now(),
): Promise<boolean> {
  return withSharedStoreLock(SELF_EXTENSION_ID, async () => {
    const record = await readRateLimitResumeFile(nowMs);
    if (
      !record ||
      record.createdAt !== createdAt ||
      record.claimedBy !== claimedBy
    ) {
      return false;
    }

    await fs.writeFile(
      getRateLimitResumePath(),
      JSON.stringify(
        { ...record, claimedAt: new Date(nowMs).toISOString() },
        null,
        2,
      ),
      "utf8",
    );
    return true;
  });
}

export async function shouldRunSharedScan(
  context: vscode.ExtensionContext,
  sourceId: string,
): Promise<boolean> {
  const config = vscode.workspace.getConfiguration("resourceNinja");
  if (!getConfiguredUseSharedResourceIndex(config)) {
    return true;
  }

  if ((await getEffectiveOwner(context)) === "sibling") {
    return false;
  }

  const sharedIndex = await readSharedResourceIndex();
  const meta = sharedIndex?.scanMeta[sourceId];
  if (!meta?.lastScannedAt) {
    return true;
  }

  return Date.now() - Date.parse(meta.lastScannedAt) >= SCAN_DEDUP_WINDOW_MS;
}

export async function updateSharedScanMetadata(
  context: vscode.ExtensionContext,
  currentIndex: SkillIndex,
  sourceIds: string[],
  scannedAt = new Date().toISOString(),
): Promise<void> {
  const config = vscode.workspace.getConfiguration("resourceNinja");
  if (!getConfiguredUseSharedResourceIndex(config)) {
    return;
  }

  try {
    const existingIndex =
      (await readSharedResourceIndex()) ||
      buildSharedResourceIndexFromSkillIndex(currentIndex);
    const nextIndex = buildSharedResourceIndexFromSkillIndex(
      currentIndex,
      existingIndex,
    );
    for (const sourceId of sourceIds) {
      nextIndex.scanMeta[sourceId] = {
        ...(nextIndex.scanMeta[sourceId] || {}),
        lastScannedAt: scannedAt,
        lastScannedBy: SELF_EXTENSION_ID,
        skillCount: getIndexResources(currentIndex).filter(
          (skill) => skill.source === sourceId,
        ).length,
      };
    }
    nextIndex.lastFullScan = scannedAt;
    nextIndex.lastScannedBy = SELF_EXTENSION_ID;
    await writeSharedResourceIndex(nextIndex);
  } catch (error) {
    logger.warn(
      "[Resource Ninja] Failed to update shared scan metadata:",
      error,
    );
  }
}

export function getStandaloneSharedModeSummary(
  _context: vscode.ExtensionContext,
): {
  sharedDir: string;
  beacon: ReturnType<typeof buildSelfBeacon>;
} {
  return {
    sharedDir: getAgentNinjaSharedDirectoryPath(),
    beacon: buildSelfBeacon(),
  };
}
