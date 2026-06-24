import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ResourceKind, Skill, Source } from "./skillIndex";

export type SourceEntry = Pick<
  Source,
  | "id"
  | "name"
  | "url"
  | "type"
  | "branch"
  | "lastIndexedAt"
  | "description"
  | "description_ja"
  | "includePaths"
  | "excludePaths"
>;

export type ResourceEntry = Skill;

export interface SharedSourcesManifest {
  schemaVersion: 1;
  sources: SourceEntry[];
  lastUpdated: string;
  updatedBy: string;
}

export interface ScanMeta {
  lastScannedAt: string;
  lastScannedBy: string;
  etag?: string;
  skillCount: number;
}

export interface SharedResourceIndex {
  schemaVersion: 1;
  lastFullScan: string;
  lastScannedBy: string;
  byKind: Record<ResourceKind, ResourceEntry[]>;
  translations: {
    ja: Record<string, string>;
  };
  scanMeta: Record<string, ScanMeta>;
}

export const SHARED_MANIFEST_SCHEMA_VERSION = 1;
export const SHARED_RESOURCE_INDEX_SCHEMA_VERSION = 1;
export const SHARED_AGENT_NINJA_DIR_WINDOWS = "agent-ninja";
export const SHARED_SOURCES_MANIFEST_FILE = "sources.json";
export const SHARED_RESOURCE_INDEX_FILE = "index.json";
export const SHARED_RESOURCE_INDEX_TEMP_FILE = "index.json.tmp";
export const SHARED_SOURCES_MANIFEST_TEMP_FILE = "sources.json.tmp";
export const SHARED_STORE_LOCK_FILE = "index.lock";
export const SHARED_STORE_RETRY_DELAY_MS = 100;
export const SHARED_STORE_LOCK_RETRY_COUNT = 5;
export const SHARED_STORE_LOCK_STALE_MS = 60 * 1000;
export const SCAN_DEDUP_WINDOW_MS = 5 * 60 * 1000;

export function getAgentNinjaSharedDirectoryPath(): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA?.trim();
    if (appData) {
      return path.join(appData, SHARED_AGENT_NINJA_DIR_WINDOWS);
    }
  }
  return path.join(os.homedir(), ".agent-ninja");
}

export function getAgentNinjaSharedDirectoryUri(): vscode.Uri {
  return vscode.Uri.file(getAgentNinjaSharedDirectoryPath());
}

export function getSharedSourcesManifestUri(): vscode.Uri {
  return vscode.Uri.joinPath(
    getAgentNinjaSharedDirectoryUri(),
    SHARED_SOURCES_MANIFEST_FILE,
  );
}

export function getSharedResourceIndexUri(): vscode.Uri {
  return vscode.Uri.joinPath(
    getAgentNinjaSharedDirectoryUri(),
    SHARED_RESOURCE_INDEX_FILE,
  );
}

export function createEmptySharedResourceBuckets(): Record<
  ResourceKind,
  ResourceEntry[]
> {
  return {
    skill: [],
    agent: [],
    instruction: [],
    prompt: [],
    hook: [],
    mcp: [],
    plugin: [],
    "cursor-rule": [],
  };
}

export function createEmptySharedSourcesManifest(
  updatedBy: string,
): SharedSourcesManifest {
  return {
    schemaVersion: SHARED_MANIFEST_SCHEMA_VERSION,
    sources: [],
    lastUpdated: new Date().toISOString(),
    updatedBy,
  };
}

export function createEmptySharedResourceIndex(
  updatedBy: string,
): SharedResourceIndex {
  return {
    schemaVersion: SHARED_RESOURCE_INDEX_SCHEMA_VERSION,
    lastFullScan: new Date(0).toISOString(),
    lastScannedBy: updatedBy,
    byKind: createEmptySharedResourceBuckets(),
    translations: { ja: {} },
    scanMeta: {},
  };
}

export function createTranslationKey(
  resource: Pick<Skill, "source" | "path">,
): string {
  return `${resource.source}:${resource.path}`;
}
