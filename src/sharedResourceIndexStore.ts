import * as fs from "fs/promises";
import * as vscode from "vscode";
import { getEffectiveOwner, SELF_EXTENSION_ID } from "./coexistence";
import {
  getConfiguredUseSharedResourceIndex,
  getConfiguredUseSharedSourcesManifest,
} from "./customizationPaths";
import { logger } from "./logger";
import { messages } from "./i18n";
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
  SHARED_RESOURCE_INDEX_MAX_BYTES,
  SHARED_RESOURCE_INDEX_SCHEMA_VERSION,
  SHARED_RESOURCE_INDEX_TEMP_FILE,
  ScanMeta,
  SharedResourceIndex,
  SourceEntry,
} from "./sharedManifest";
import {
  describeSharedStoreLockFailure,
  withSharedStoreLock,
} from "./sharedStoreLock";
import {
  Skill,
  SkillIndex,
  Source,
  ResourceKind,
  getIndexResources,
  getResourceKind,
} from "./skillIndex";
import {
  bootstrapSharedSourcesManifest,
  readSharedSourcesManifest,
  writeSharedSourcesManifest,
} from "./sharedSourcesManifestStore";

export type SharedResourceIndexReadResult =
  | { status: "missing" }
  | { status: "rejected"; reason: string }
  | { status: "valid"; index: SharedResourceIndex };

/**
 * Set once this extension's own sources have reached `sources.json`. Before that,
 * the shared file cannot be read as a statement about sources it never saw.
 */
export const SHARED_SOURCES_MANIFEST_RECONCILED_KEY =
  "resourceNinja.sharedSourcesManifestReconciled";

/** The rejection reason the user was last told about, so the notice cannot nag. */
export const SHARED_STORE_REJECTION_NOTICE_KEYS = {
  sources: "resourceNinja.sharedStoreRejectionNotice.sources",
  index: "resourceNinja.sharedStoreRejectionNotice.index",
} as const;

export type SharedStoreKind = keyof typeof SHARED_STORE_REJECTION_NOTICE_KEYS;

export type SharedStoreRejectionNotice =
  | { action: "notify"; reason: string }
  | { action: "clear" }
  | { action: "skip" };

/**
 * Losing a race for the shared lock is resolved by the next sync, so it is not the
 * permanent pause this notice exists for and must not spend the user's attention.
 */
const TRANSIENT_WRITE_FAILURE_REASONS = new Set([
  "lease-lost",
  "lock-unavailable",
]);

/**
 * Refusing to write is the correct response to an unreadable shared file, but it
 * stops syncing for good, so the user has to be told once. A repeat of the same
 * reason stays silent; a new reason, or a break after a success, speaks again.
 */
export function planSharedStoreRejectionNotice(
  writeStatus: "written" | "rejected",
  reason: string | undefined,
  lastNotifiedReason: string | undefined,
): SharedStoreRejectionNotice {
  if (writeStatus === "written") {
    return lastNotifiedReason === undefined
      ? { action: "skip" }
      : { action: "clear" };
  }

  const currentReason = reason ?? "unknown";
  if (TRANSIENT_WRITE_FAILURE_REASONS.has(currentReason)) {
    // Leaves an existing notice alone: this run learned nothing about that reason.
    return { action: "skip" };
  }
  return currentReason === lastNotifiedReason
    ? { action: "skip" }
    : { action: "notify", reason: currentReason };
}

/** Each shared file is tracked on its own so one recovering cannot silence the other. */
async function applySharedStoreRejectionNotice(
  context: vscode.ExtensionContext,
  store: SharedStoreKind,
  writeStatus: "written" | "rejected",
  reason: string | undefined,
): Promise<void> {
  const stateKey = SHARED_STORE_REJECTION_NOTICE_KEYS[store];
  const notice = planSharedStoreRejectionNotice(
    writeStatus,
    reason,
    context.globalState.get<string>(stateKey),
  );

  if (notice.action === "skip") {
    return;
  }
  if (notice.action === "clear") {
    await context.globalState.update(stateKey, undefined);
    return;
  }

  await context.globalState.update(stateKey, notice.reason);
  const statusAction = messages.actionShowCoexistenceStatus();
  const detailAction = messages.actionShowDetails();
  void vscode.window
    .showWarningMessage(
      messages.sharedStoreSyncPaused(notice.reason),
      statusAction,
      detailAction,
    )
    .then((choice) => {
      if (choice === statusAction) {
        void vscode.commands.executeCommand(
          "resourceNinja.showCoexistenceStatus",
        );
      } else if (choice === detailAction) {
        logger.show(true);
      }
    });
}

/** Long enough for any curated entry; anything longer is not data we wrote. */
const SHARED_RESOURCE_MAX_FIELD_LENGTH = 2048;
export const SHARED_RESOURCE_INDEX_MAX_ENTRIES = 10_000;
export const SHARED_RESOURCE_MAX_FIELDS = 64;
export const SHARED_RESOURCE_INDEX_MAX_METADATA_ENTRIES = 10_000;
const SHARED_RESOURCE_SOURCE_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

function isBoundedString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= SHARED_RESOURCE_MAX_FIELD_LENGTH &&
    !value.includes("\0")
  );
}

/** A path decides what gets downloaded and written, so it stays inside the repo. */
function isSafeResourcePath(value: unknown): value is string {
  if (!isBoundedString(value)) {
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

function isSafeResourceUrl(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (!isBoundedString(value)) {
    return false;
  }
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The shared index is writable by any tool on the machine and its entries are
 * re-served as runtime resources, so an entry is only usable when every field that
 * steers a download or a write survives validation.
 */
export function isUsableSharedResourceEntry(
  entry: unknown,
): entry is ResourceEntry {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return false;
  }
  const candidate = entry as Record<string, unknown>;
  return (
    Object.keys(candidate).length <= SHARED_RESOURCE_MAX_FIELDS &&
    isBoundedString(candidate.name) &&
    typeof candidate.source === "string" &&
    SHARED_RESOURCE_SOURCE_PATTERN.test(candidate.source) &&
    isSafeResourcePath(candidate.path) &&
    (candidate.remotePath === undefined ||
      isSafeResourcePath(candidate.remotePath)) &&
    (candidate.kind === undefined ||
      RESOURCE_NINJA_KINDS.includes(candidate.kind as ResourceKind)) &&
    isSafeResourceUrl(candidate.url) &&
    isSafeResourceUrl(candidate.rawUrl)
  );
}

function countSharedResourceEntries(raw: unknown): number | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<SharedResourceIndex>;
  let entryCount = 0;
  for (const kind of RESOURCE_NINJA_KINDS) {
    const entries = candidate.byKind?.[kind];
    if (Array.isArray(entries)) {
      entryCount += entries.length;
    }
  }
  return entryCount;
}

function getSharedResourceIndexLimitReason(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<SharedResourceIndex>;
  const entryCount = countSharedResourceEntries(candidate);
  if (
    entryCount !== undefined &&
    entryCount > SHARED_RESOURCE_INDEX_MAX_ENTRIES
  ) {
    return `${entryCount} resources exceeds the ${SHARED_RESOURCE_INDEX_MAX_ENTRIES} entry limit`;
  }

  const translationCount =
    candidate.translations?.ja && typeof candidate.translations.ja === "object"
      ? Object.keys(candidate.translations.ja).length
      : 0;
  if (translationCount > SHARED_RESOURCE_INDEX_MAX_METADATA_ENTRIES) {
    return `${translationCount} translations exceeds the ${SHARED_RESOURCE_INDEX_MAX_METADATA_ENTRIES} entry limit`;
  }

  const scanMetaCount =
    candidate.scanMeta && typeof candidate.scanMeta === "object"
      ? Object.keys(candidate.scanMeta).length
      : 0;
  if (scanMetaCount > SHARED_RESOURCE_INDEX_MAX_METADATA_ENTRIES) {
    return `${scanMetaCount} scan records exceeds the ${SHARED_RESOURCE_INDEX_MAX_METADATA_ENTRIES} entry limit`;
  }
  return undefined;
}

function normalizeTranslations(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const translations: Record<string, string> = {};
  for (const [key, translation] of Object.entries(value)) {
    if (isBoundedString(key) && isBoundedString(translation)) {
      translations[key] = translation;
    }
  }
  return translations;
}

function normalizeScanMeta(value: unknown): Record<string, ScanMeta> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const scanMeta: Record<string, ScanMeta> = {};
  for (const [sourceId, rawMeta] of Object.entries(value)) {
    if (
      !SHARED_RESOURCE_SOURCE_PATTERN.test(sourceId) ||
      !rawMeta ||
      typeof rawMeta !== "object" ||
      Array.isArray(rawMeta)
    ) {
      continue;
    }
    const meta = rawMeta as Record<string, unknown>;
    if (
      !isBoundedString(meta.lastScannedBy) ||
      (meta.etag !== undefined && !isBoundedString(meta.etag))
    ) {
      continue;
    }
    const lastScannedAt =
      isBoundedString(meta.lastScannedAt) &&
      Number.isFinite(Date.parse(meta.lastScannedAt))
        ? meta.lastScannedAt
        : new Date(0).toISOString();
    const skillCount =
      Number.isSafeInteger(meta.skillCount) && (meta.skillCount as number) >= 0
        ? (meta.skillCount as number)
        : 0;
    scanMeta[sourceId] = {
      lastScannedAt,
      lastScannedBy: meta.lastScannedBy,
      skillCount,
      ...(meta.etag === undefined ? {} : { etag: meta.etag }),
    };
  }
  return scanMeta;
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

  if (
    countSharedResourceEntries(candidate) === undefined ||
    getSharedResourceIndexLimitReason(candidate)
  ) {
    return undefined;
  }

  const normalizedByKind = createEmptySharedResourceBuckets();
  for (const kind of RESOURCE_NINJA_KINDS) {
    const entries = candidate.byKind?.[kind];
    normalizedByKind[kind] = Array.isArray(entries)
      ? entries.filter(isUsableSharedResourceEntry)
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
      ja: normalizeTranslations(candidate.translations?.ja),
    },
    scanMeta: normalizeScanMeta(candidate.scanMeta),
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

  const currentSourceIds = new Set(
    currentIndex.sources.map((source) => source.id),
  );

  // A resource carries no writer, so ownership is read from the scan record of its
  // source. Anything we do not own cannot be rebuilt from our index and is carried
  // over instead of dropped; the two shared settings are independent, so the shared
  // index is routinely enabled without the shared sources manifest.
  const ownsSource = (sourceId: string): boolean => {
    if (currentSourceIds.has(sourceId)) {
      return true;
    }
    const scannedBy = previousIndex?.scanMeta[sourceId]?.lastScannedBy;
    return !scannedBy || scannedBy === SELF_EXTENSION_ID;
  };

  // A previous load copies foreign resources into our runtime index, so rebuilding
  // every resource here and then carrying the foreign ones over would write each of
  // them twice, and again on every save.
  for (const resource of getIndexResources(currentIndex)) {
    if (!ownsSource(resource.source)) {
      continue;
    }
    const kind = getResourceKind(resource);
    nextIndex.byKind[kind].push({ ...resource, kind });
    if (resource.description_ja) {
      nextIndex.translations.ja[createTranslationKey(resource)] =
        resource.description_ja;
    }
  }

  if (previousIndex) {
    for (const [kind, resources] of Object.entries(previousIndex.byKind)) {
      const resourceKind = kind as ResourceKind;
      const bucket = nextIndex.byKind[resourceKind];
      if (!bucket || !Array.isArray(resources)) {
        continue;
      }
      for (const resource of resources) {
        if (!ownsSource(resource.source)) {
          bucket.push({ ...resource, kind: resource.kind || resourceKind });
        }
      }
    }
  }

  for (const sourceId of Object.keys(nextIndex.scanMeta)) {
    if (!currentSourceIds.has(sourceId) && ownsSource(sourceId)) {
      delete nextIndex.scanMeta[sourceId];
    }
  }

  nextIndex.lastScannedBy = SELF_EXTENSION_ID;
  return nextIndex;
}

/**
 * Reads the shared resource index without ever modifying it. A file that cannot be
 * used is reported as `rejected` and left where it is, so a reader can never evict
 * a file another process is repairing.
 */
export async function readSharedResourceIndexResult(): Promise<SharedResourceIndexReadResult> {
  const filePath = getSharedResourceIndexUri().fsPath;
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
    // Sized through the open handle so an oversized file is never pulled into
    // memory or parsed during activation.
    const stats = await handle.stat();
    if (stats.size > SHARED_RESOURCE_INDEX_MAX_BYTES) {
      const reason = `${stats.size} bytes exceeds the ${SHARED_RESOURCE_INDEX_MAX_BYTES} byte limit`;
      logger.warn(
        `[Resource Ninja] Shared resource index rejected (${reason}).`,
      );
      return { status: "rejected", reason };
    }

    const raw = JSON.parse(await handle.readFile("utf8"));
    const limitReason = getSharedResourceIndexLimitReason(raw);
    if (limitReason) {
      logger.warn(
        `[Resource Ninja] Shared resource index rejected (${limitReason}).`,
      );
      return { status: "rejected", reason: limitReason };
    }
    const parsed = normalizeSharedResourceIndex(raw);
    if (!parsed) {
      logger.warn("[Resource Ninja] Shared resource index schema mismatch.");
      return { status: "rejected", reason: "schema mismatch" };
    }
    return { status: "valid", index: parsed };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn(
      `[Resource Ninja] Shared resource index rejected (${reason}). The file is left untouched.`,
    );
    return { status: "rejected", reason };
  } finally {
    await handle.close();
  }
}

export async function readSharedResourceIndex(): Promise<
  SharedResourceIndex | undefined
> {
  const result = await readSharedResourceIndexResult();
  return result.status === "valid" ? result.index : undefined;
}

export type SharedResourceIndexWriteResult =
  | { status: "written" }
  | { status: "rejected"; reason: string };

export async function writeSharedResourceIndex(
  sharedIndex: SharedResourceIndex,
): Promise<SharedResourceIndexWriteResult> {
  const limitReason = getSharedResourceIndexLimitReason(sharedIndex);
  if (limitReason) {
    logger.warn(
      `[Resource Ninja] Did not write the shared resource index (${limitReason}).`,
    );
    return { status: "rejected", reason: limitReason };
  }
  const normalizedIndex = normalizeSharedResourceIndex(sharedIndex);
  if (!normalizedIndex) {
    throw new Error("Invalid shared resource index payload");
  }

  const sharedDir = getAgentNinjaSharedDirectoryPath();
  const fileUri = getSharedResourceIndexUri();
  const tempPath = `${sharedDir}/${SHARED_RESOURCE_INDEX_TEMP_FILE}`;

  try {
    await withSharedStoreLock(SELF_EXTENSION_ID, async (lease) => {
      await fs.mkdir(sharedDir, { recursive: true });
      lease.assertHeld();
      await fs.writeFile(
        tempPath,
        JSON.stringify(normalizedIndex, null, 2),
        "utf8",
      );
      // Nothing may be awaited between this check and the rename.
      await lease.assertStillOwned();
      await fs.rename(tempPath, fileUri.fsPath);
    });
    return { status: "written" };
  } catch (error) {
    const reason = describeSharedStoreLockFailure(error);
    if (!reason) {
      throw error;
    }
    logger.warn(
      `[Resource Ninja] Did not write the shared resource index (${reason}).`,
    );
    return { status: "rejected", reason };
  }
}

export async function bootstrapSharedResourceIndex(
  currentIndex: SkillIndex,
): Promise<SharedResourceIndexWriteResult> {
  const sharedIndex = buildSharedResourceIndexFromSkillIndex(currentIndex);
  sharedIndex.lastFullScan = new Date().toISOString();
  return await writeSharedResourceIndex(sharedIndex);
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

  // Each store is guarded on its own: one of them pausing must not silently take
  // the other down with it, because they report their status independently.
  if (useSharedSourcesManifest) {
    try {
      const manifest = {
        schemaVersion: 1 as const,
        sources: currentIndex.sources.map(
          (source) => ({ ...source }) as SourceEntry,
        ),
        lastUpdated: new Date().toISOString(),
        updatedBy: SELF_EXTENSION_ID,
      };
      // Read before write to apply raw-preserving merge (A-6).
      // Without this, concurrent writes to the shared manifest are lost.
      const writeResult = await writeSharedSourcesManifest(manifest);
      if (writeResult?.status === "written") {
        await context.globalState.update(
          SHARED_SOURCES_MANIFEST_RECONCILED_KEY,
          true,
        );
      }

      await applySharedStoreRejectionNotice(
        context,
        "sources",
        writeResult?.status === "written" ? "written" : "rejected",
        writeResult?.status === "rejected" ? writeResult.reason : undefined,
      );
    } catch (error) {
      logger.warn(
        "[Resource Ninja] Failed to sync the shared sources manifest. Falling back to local cache.",
        error,
      );
    }
  }

  if (useSharedResourceIndex) {
    try {
      const previousResult = await readSharedResourceIndexResult();
      // Rebuilding from our own data would replace every resource and scan record
      // only the sibling extension holds, so an unreadable file is never overwritten.
      if (previousResult.status === "rejected") {
        logger.warn(
          `[Resource Ninja] Refusing to rewrite the shared resource index (${previousResult.reason}).`,
        );
        await applySharedStoreRejectionNotice(
          context,
          "index",
          "rejected",
          previousResult.reason,
        );
      } else {
        const previousSharedIndex =
          previousResult.status === "valid" ? previousResult.index : undefined;
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
        const writeResult = await writeSharedResourceIndex(nextSharedIndex);
        await applySharedStoreRejectionNotice(
          context,
          "index",
          writeResult.status === "written" ? "written" : "rejected",
          writeResult.status === "rejected" ? writeResult.reason : undefined,
        );
      }
    } catch (error) {
      logger.warn(
        "[Resource Ninja] Failed to sync the shared resource index. Falling back to local cache.",
        error,
      );
    }
  }
}

/** Ids present on disk, including entries this extension refused to use. */
export function collectManifestEntryIds(
  rawEntries: readonly unknown[],
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const rawEntry of rawEntries) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      continue;
    }
    const id = (rawEntry as Record<string, unknown>).id;
    if (typeof id === "string" && id.length > 0) {
      ids.add(id);
    }
  }
  return ids;
}

/**
 * The manifest decides which sources exist, but a field the writer did not know
 * about must not clear the locally known value. Keeps repo identity intact when an
 * older extension shares the same store.
 */
export function mergeSharedManifestSources(
  localSources: Source[],
  manifestSources: SourceEntry[],
  manifestEntryIds: ReadonlySet<string>,
  options?: { keepUnlistedLocalSources?: boolean },
): Source[] {
  const localSourcesById = new Map(
    localSources.map((source) => [source.id, source]),
  );

  const merged = manifestSources.map((incoming) => {
    const local = localSourcesById.get(incoming.id);
    if (!local) {
      return { ...incoming } as Source;
    }

    const mergedSource: Source = { ...local };
    // An absent marker means the shared scanner is now known or undeclared.
    mergedSource.foreignScanner = incoming.foreignScanner;
    if (incoming.foreignScanner) {
      // A stale scanner learned from an older manifest must not overwrite the
      // sibling's newer foreign declaration on the next shared rewrite.
      mergedSource.scanner = undefined;
    }
    for (const [key, value] of Object.entries(incoming)) {
      if (value !== undefined) {
        (mergedSource as unknown as Record<string, unknown>)[key] = value;
      }
    }
    return mergedSource;
  });

  // An entry that is on disk but failed validation is unusable, not deleted.
  // Dropping the local source here would also persist the loss into the local index.
  // Until our own sources have reached the shared file at least once, its silence
  // says nothing about them either, so absence cannot mean removal yet.
  const mergedIds = new Set(merged.map((source) => source.id));
  for (const local of localSources) {
    if (mergedIds.has(local.id)) {
      continue;
    }
    if (options?.keepUnlistedLocalSources || manifestEntryIds.has(local.id)) {
      merged.push(local);
    }
  }

  return merged;
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
    const reconciled =
      context.globalState.get<boolean>(
        SHARED_SOURCES_MANIFEST_RECONCILED_KEY,
      ) === true;
    const result = await readSharedSourcesManifest();
    if (result.status === "valid") {
      nextIndex = {
        ...nextIndex,
        sources: mergeSharedManifestSources(
          nextIndex.sources,
          result.manifest.sources,
          collectManifestEntryIds(result.rawEntries),
          { keepUnlistedLocalSources: !reconciled },
        ),
      };
    } else if (result.status === "missing") {
      try {
        const writeResult = await bootstrapSharedSourcesManifest(
          currentIndex.sources.map((source) => ({ ...source })),
        );
        if (writeResult.status === "written") {
          await context.globalState.update(
            SHARED_SOURCES_MANIFEST_RECONCILED_KEY,
            true,
          );
        }
        await applySharedStoreRejectionNotice(
          context,
          "sources",
          writeResult.status,
          writeResult.status === "rejected" ? writeResult.reason : undefined,
        );
      } catch (error) {
        logger.warn(
          "[Resource Ninja] Failed to bootstrap shared sources manifest:",
          error,
        );
      }
    } else {
      // Bootstrapping over a file we merely failed to read would replace every
      // source only the sibling extension knows about with our own list.
      logger.warn(
        `[Resource Ninja] Keeping local sources: the shared sources manifest was rejected (${result.reason}).`,
      );
    }
  }

  if (useSharedResourceIndex) {
    const result = await readSharedResourceIndexResult();
    if (result.status === "valid") {
      nextIndex = applySharedResourceIndexToSkillIndex(nextIndex, result.index);
    } else if (result.status === "missing") {
      try {
        const writeResult = await bootstrapSharedResourceIndex(nextIndex);
        await applySharedStoreRejectionNotice(
          context,
          "index",
          writeResult.status,
          writeResult.status === "rejected" ? writeResult.reason : undefined,
        );
      } catch (error) {
        logger.warn(
          "[Resource Ninja] Failed to bootstrap shared resource index:",
          error,
        );
      }
    } else {
      logger.warn(
        `[Resource Ninja] Keeping local resources: the shared resource index was rejected (${result.reason}).`,
      );
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
    const previousResult = await readSharedResourceIndexResult();
    if (previousResult.status === "rejected") {
      logger.warn(
        `[Resource Ninja] Refusing to update shared scan metadata (${previousResult.reason}).`,
      );
      return;
    }

    const existingIndex =
      previousResult.status === "valid"
        ? previousResult.index
        : buildSharedResourceIndexFromSkillIndex(currentIndex);
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
    const writeResult = await writeSharedResourceIndex(nextIndex);
    await applySharedStoreRejectionNotice(
      context,
      "index",
      writeResult.status,
      writeResult.status === "rejected" ? writeResult.reason : undefined,
    );
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
