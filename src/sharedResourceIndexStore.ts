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
  SHARED_RESOURCE_INDEX_SCHEMA_VERSION,
  SHARED_RESOURCE_INDEX_TEMP_FILE,
  SharedResourceIndex,
  SourceEntry,
} from "./sharedManifest";
import { withSharedStoreLock } from "./sharedStoreLock";
import {
  Skill,
  SkillIndex,
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
        sources: manifest.sources.map((source) => ({ ...source })),
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
