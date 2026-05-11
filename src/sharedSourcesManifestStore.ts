import * as fs from "fs/promises";
import * as vscode from "vscode";
import { SELF_EXTENSION_ID } from "./coexistence";
import {
  createEmptySharedSourcesManifest,
  getAgentNinjaSharedDirectoryPath,
  getSharedSourcesManifestUri,
  SHARED_MANIFEST_SCHEMA_VERSION,
  SHARED_SOURCES_MANIFEST_TEMP_FILE,
  SharedSourcesManifest,
  SourceEntry,
} from "./sharedManifest";
import { logger } from "./logger";
import { withSharedStoreLock } from "./sharedStoreLock";

async function renameBrokenFile(filePath: string): Promise<void> {
  const brokenPath = `${filePath}.broken-${Date.now()}`;
  await fs.rename(filePath, brokenPath);
}

function normalizeSourceEntry(source: SourceEntry): SourceEntry {
  return {
    id: source.id,
    name: source.name,
    url: source.url,
    type: source.type,
    branch: source.branch,
    description: source.description,
    description_ja: source.description_ja,
    includePaths: source.includePaths,
    excludePaths: source.excludePaths,
  };
}

function normalizeSharedSourcesManifest(
  raw: unknown,
): SharedSourcesManifest | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const candidate = raw as Partial<SharedSourcesManifest>;
  if (candidate.schemaVersion !== SHARED_MANIFEST_SCHEMA_VERSION) {
    return undefined;
  }
  if (!Array.isArray(candidate.sources)) {
    return undefined;
  }

  return {
    schemaVersion: SHARED_MANIFEST_SCHEMA_VERSION,
    sources: candidate.sources.map((source) =>
      normalizeSourceEntry(source as SourceEntry),
    ),
    lastUpdated:
      typeof candidate.lastUpdated === "string"
        ? candidate.lastUpdated
        : new Date().toISOString(),
    updatedBy:
      typeof candidate.updatedBy === "string"
        ? candidate.updatedBy
        : SELF_EXTENSION_ID,
  };
}

export async function readSharedSourcesManifest(): Promise<
  SharedSourcesManifest | undefined
> {
  const fileUri = getSharedSourcesManifestUri();
  try {
    const content = await vscode.workspace.fs.readFile(fileUri);
    const parsed = normalizeSharedSourcesManifest(
      JSON.parse(Buffer.from(content).toString("utf8")),
    );
    if (!parsed) {
      logger.warn("[Resource Ninja] Shared sources manifest schema mismatch.");
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
      "[Resource Ninja] Failed to parse shared sources manifest:",
      error,
    );
    return undefined;
  }
}

export async function writeSharedSourcesManifest(
  manifest: SharedSourcesManifest,
): Promise<void> {
  const normalizedManifest: SharedSourcesManifest = {
    schemaVersion: SHARED_MANIFEST_SCHEMA_VERSION,
    sources: manifest.sources.map(normalizeSourceEntry),
    lastUpdated: manifest.lastUpdated,
    updatedBy: manifest.updatedBy,
  };
  const sharedDir = getAgentNinjaSharedDirectoryPath();
  const fileUri = getSharedSourcesManifestUri();
  const tempPath = `${sharedDir}/${SHARED_SOURCES_MANIFEST_TEMP_FILE}`;

  await withSharedStoreLock(SELF_EXTENSION_ID, async () => {
    await fs.mkdir(sharedDir, { recursive: true });
    await fs.writeFile(
      tempPath,
      JSON.stringify(normalizedManifest, null, 2),
      "utf8",
    );
    await fs.rename(tempPath, fileUri.fsPath);
  });
}

export async function bootstrapSharedSourcesManifest(
  sources: SourceEntry[],
): Promise<SharedSourcesManifest> {
  const manifest = createEmptySharedSourcesManifest(SELF_EXTENSION_ID);
  manifest.sources = sources.map(normalizeSourceEntry);
  manifest.lastUpdated = new Date().toISOString();
  await writeSharedSourcesManifest(manifest);
  return manifest;
}
