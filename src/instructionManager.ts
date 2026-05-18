// インストラクションファイル管理
// agents.md などにインストール済みスキルを登録

import * as vscode from "vscode";
import {
  getInstalledSkillsWithMeta,
  getInstalledSkillsWithMetaFromRoot,
  SkillMeta,
} from "./skillInstaller";
import { scanLocalSkills, LocalSkill } from "./localSkillScanner";
import { scanUserResources, UserResource } from "./userResourceScanner";
import {
  OutputFormat,
  normalizeOutputFormat,
  resolveOutputFormat,
} from "./toolDetector";
import * as path from "path";
import { SKILL_DESCRIPTION_LIMITS } from "./constants";
import {
  DISABLED_INSTRUCTION_FILE,
  DEFAULT_GLOBAL_HOME_DIRECTORY,
  getConfiguredCoexistenceMode,
  getConfiguredGlobalHomeDirectory,
  getConfiguredInstructionFilePath,
  getConfiguredIncludeLocalResources,
  getInstructionBlockKinds,
  InstructionBlockScope,
  getConfiguredSkillsDirectory,
  isAbsoluteConfiguredPath,
  isHomeRelativePath,
  getRelativeSkillsPathForWorkspace,
  resolveInstructionFileUri,
  resolveConfiguredUri,
  resolveSkillsDirectoryUri,
} from "./customizationPaths";
import { getEffectiveOwner, isSiblingActive } from "./coexistence";
import {
  loadSkillIndex,
  ResourceKind,
  Skill,
  SkillIndex,
  Source,
  getResourceKindLabel,
} from "./skillIndex";
import { logger } from "./logger";

interface MarkerPair {
  start: string;
  end: string;
}

interface SyncResourceItem {
  kind: ResourceKind;
  name: string;
  description: string;
  source: string;
  relativePath: string;
  linkPath: string;
  fullPath: string;
  remotePath?: string;
  repositoryUrl?: string;
  remoteUrl?: string;
}

interface RefCatalogDescriptor {
  sectionTitle: string;
  catalogTitle: string;
  fileName: string;
}

type RefCatalogFormat = Exclude<OutputFormat, "ref">;

const SHARED_MARKERS: MarkerPair = {
  start: "<!-- agent-ninja-START -->",
  end: "<!-- agent-ninja-END -->",
};

const RESOURCE_MARKERS: MarkerPair = {
  start: "<!-- resource-ninja-START -->",
  end: "<!-- resource-ninja-END -->",
};

const LEGACY_MARKERS: MarkerPair[] = [
  RESOURCE_MARKERS,
  {
    start: "<!-- skill-ninja-START -->",
    end: "<!-- skill-ninja-END -->",
  },
  {
    start: "<!-- SKILL-FINDER-START -->",
    end: "<!-- SKILL-FINDER-END -->",
  },
];

const ALL_MARKERS: MarkerPair[] = [SHARED_MARKERS, ...LEGACY_MARKERS];

const DEFAULT_WORKSPACE_REF_CATALOG_DIRECTORY = ".github/resource-catalog";
const DEFAULT_GLOBAL_REF_CATALOG_DIRECTORY = ".catalog/resources";
const REF_CATALOG_MARKER_PREFIX = "<!-- resource-ninja-catalog:";

const RESOURCE_KIND_ORDER: ResourceKind[] = [
  "skill",
  "agent",
  "instruction",
  "prompt",
  "hook",
  "mcp",
  "plugin",
  "cursor-rule",
];

const REF_CATALOG_DESCRIPTORS: Record<ResourceKind, RefCatalogDescriptor> = {
  skill: {
    sectionTitle: "Skills",
    catalogTitle: "Agent Skills",
    fileName: "skills.md",
  },
  agent: {
    sectionTitle: "Agents",
    catalogTitle: "Agents",
    fileName: "agents.md",
  },
  instruction: {
    sectionTitle: "Instructions",
    catalogTitle: "Instructions",
    fileName: "instructions.md",
  },
  prompt: {
    sectionTitle: "Prompts",
    catalogTitle: "Prompts",
    fileName: "prompts.md",
  },
  hook: {
    sectionTitle: "Hooks",
    catalogTitle: "Hooks",
    fileName: "hooks.md",
  },
  mcp: {
    sectionTitle: "MCP Configs",
    catalogTitle: "MCP Configs",
    fileName: "mcp.md",
  },
  plugin: {
    sectionTitle: "Plugins",
    catalogTitle: "Plugins",
    fileName: "plugins.md",
  },
  "cursor-rule": {
    sectionTitle: "Cursor Rules",
    catalogTitle: "Cursor Rules",
    fileName: "cursor-rules.md",
  },
};

/**
 * Description + When to Use を連結する関数（合計最大200文字）
 * - 片方だけの場合: 最大200文字
 * - 両方ある場合: 合計200文字を分配（片方が短ければもう片方に回す）
 */
function buildDescription(description?: string, whenToUse?: string): string {
  const { MAX_TOTAL, MAX_EACH } = SKILL_DESCRIPTION_LIMITS;

  const desc = description?.trim() || "";
  const when = whenToUse?.trim() || "";

  if (!desc && !when) return "";
  if (!desc)
    return when.length > MAX_TOTAL
      ? when.substring(0, MAX_TOTAL - 3) + "..."
      : when;
  if (!when)
    return desc.length > MAX_TOTAL
      ? desc.substring(0, MAX_TOTAL - 3) + "..."
      : desc;

  // 両方ある場合は連結（片方が短ければもう片方に回す）
  const descLen = desc.length;
  const whenLen = when.length;

  let shortDesc: string;
  let shortWhen: string;

  if (descLen <= MAX_EACH && whenLen <= MAX_EACH) {
    // 両方100文字以内
    shortDesc = desc;
    shortWhen = when;
  } else if (descLen <= MAX_EACH) {
    // desc が短いので when に余りを回す
    const whenMax = MAX_TOTAL - descLen - 3; // " | " の分
    shortDesc = desc;
    shortWhen =
      when.length > whenMax ? when.substring(0, whenMax - 3) + "..." : when;
  } else if (whenLen <= MAX_EACH) {
    // when が短いので desc に余りを回す
    const descMax = MAX_TOTAL - whenLen - 3; // " | " の分
    shortDesc =
      desc.length > descMax ? desc.substring(0, descMax - 3) + "..." : desc;
    shortWhen = when;
  } else {
    // 両方100文字超え: 各97文字 + "..."
    shortDesc = desc.substring(0, MAX_EACH - 3) + "...";
    shortWhen = when.substring(0, MAX_EACH - 3) + "...";
  }

  return `${shortDesc} | ${shortWhen}`;
}

/**
 * instructionFile から skillsDir への相対パスを計算
 * 例: instructionFile = ".github/instructions/SkillList.instructions.md"
 *     skillsDir = ".github/skills"
 *     → 結果: "../skills"
 */
function calculateRelativePath(
  instructionFilePath: string,
  resourcesDirectoryPath: string,
): string {
  const instructionDir = path.dirname(instructionFilePath);
  const relativePath = path.relative(instructionDir, resourcesDirectoryPath);

  // Windows パス区切りを / に変換
  return relativePath.replace(/\\/g, "/");
}

function normalizePathSeparators(value: string): string {
  return value.replace(/\\/g, "/");
}

function normalizeMarkdownRelativePath(relativePath: string): string {
  const normalized = normalizePathSeparators(relativePath);
  return normalized === "" ? "." : normalized;
}

function getResourceLinkPath(
  instructionFilePath: string,
  resourceFilePath: string,
): string {
  return normalizeMarkdownRelativePath(
    path.relative(path.dirname(instructionFilePath), resourceFilePath),
  );
}

function getRelativeFileLinkPath(
  fromFilePath: string,
  targetFilePath: string,
): string {
  return normalizeMarkdownRelativePath(
    path.relative(path.dirname(fromFilePath), targetFilePath),
  );
}

function normalizeRemotePath(
  remotePath: string | undefined,
): string | undefined {
  const normalized = remotePath?.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return normalized || undefined;
}

function getConfiguredRefCatalogDirectory(
  config: vscode.WorkspaceConfiguration,
): string | undefined {
  const configured = config.get<string>("refCatalogDirectory")?.trim();
  return configured || undefined;
}

function resolveRefCatalogDirectoryUri(
  workspaceUri: vscode.Uri,
  instructionUri: vscode.Uri,
  scope: "workspace" | "globalHome",
  config: vscode.WorkspaceConfiguration,
): vscode.Uri {
  const configuredDirectory = getConfiguredRefCatalogDirectory(config);
  const fallbackDirectory =
    scope === "workspace"
      ? DEFAULT_WORKSPACE_REF_CATALOG_DIRECTORY
      : DEFAULT_GLOBAL_REF_CATALOG_DIRECTORY;
  const effectiveDirectory = configuredDirectory || fallbackDirectory;

  if (
    isHomeRelativePath(effectiveDirectory) ||
    isAbsoluteConfiguredPath(effectiveDirectory)
  ) {
    return resolveConfiguredUri(
      workspaceUri,
      effectiveDirectory,
      fallbackDirectory,
    );
  }

  if (scope === "workspace") {
    return resolveConfiguredUri(
      workspaceUri,
      effectiveDirectory,
      DEFAULT_WORKSPACE_REF_CATALOG_DIRECTORY,
    );
  }

  const instructionDirectoryUri = vscode.Uri.file(
    path.dirname(instructionUri.fsPath),
  );
  const segments = normalizePathSeparators(effectiveDirectory)
    .replace(/^\.\//, "")
    .split("/")
    .filter(Boolean);

  return segments.length > 0
    ? vscode.Uri.joinPath(instructionDirectoryUri, ...segments)
    : instructionDirectoryUri;
}

function getRefCatalogFileUri(
  catalogRootUri: vscode.Uri,
  kind: ResourceKind,
): vscode.Uri {
  return vscode.Uri.joinPath(
    catalogRootUri,
    REF_CATALOG_DESCRIPTORS[kind].fileName,
  );
}

function getConfiguredRefCatalogFormat(
  config: vscode.WorkspaceConfiguration,
): RefCatalogFormat {
  const normalized = normalizeOutputFormat(config.get<string>("refCatalogFormat"));
  return normalized === "compact" || normalized === "legacy"
    ? normalized
    : "full";
}

function escapeMarkdownTableText(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function formatCatalogLinkCell(url: string | undefined, label: string): string {
  if (!url) {
    return "";
  }
  if (url === "local") {
    return "local";
  }
  return `[${label}](${url})`;
}

function buildRepositoryFileUrl(
  repositoryUrl: string | undefined,
  branch: string | undefined,
  resourcePath: string | undefined,
): string | undefined {
  if (!repositoryUrl || !branch || !resourcePath) {
    return undefined;
  }

  const trimmedRepositoryUrl = repositoryUrl.replace(/\/+$/, "");
  if (!/^https:\/\/github\.com\//i.test(trimmedRepositoryUrl)) {
    return undefined;
  }

  return `${trimmedRepositoryUrl}/blob/${branch}/${normalizeRemotePath(resourcePath)}`;
}

function findIndexedResourceForSyncItem(
  index: SkillIndex,
  resource: SyncResourceItem,
): Skill | undefined {
  const normalizedRemotePath = normalizeRemotePath(resource.remotePath);

  if (normalizedRemotePath && resource.source && resource.source !== "local") {
    const byRemotePath = index.skills.find(
      (candidate) =>
        candidate.source === resource.source &&
        (candidate.kind || "skill") === resource.kind &&
        normalizeRemotePath(candidate.path) === normalizedRemotePath,
    );
    if (byRemotePath) {
      return byRemotePath;
    }
  }

  let byName = index.skills.find(
    (candidate) =>
      candidate.name === resource.name &&
      candidate.source === resource.source &&
      (candidate.kind || "skill") === resource.kind,
  );

  if (!byName && resource.source === "unknown") {
    byName = index.skills.find(
      (candidate) =>
        candidate.name === resource.name &&
        (candidate.kind || "skill") === resource.kind,
    );
  }

  return byName;
}

function enrichSyncResourcesWithRemoteMetadata(
  resources: SyncResourceItem[],
  index: SkillIndex,
): SyncResourceItem[] {
  const sourceById = new Map<string, Source>(
    index.sources.map((source) => [source.id, source]),
  );

  return resources.map((resource) => {
    if (!resource.source || resource.source === "local") {
      return {
        ...resource,
        repositoryUrl: "local",
      };
    }

    const source = sourceById.get(resource.source);
    const indexedResource = findIndexedResourceForSyncItem(index, resource);
    const repositoryUrl = source?.url;
    const remoteUrl =
      indexedResource?.url ||
      indexedResource?.rawUrl ||
      buildRepositoryFileUrl(
        repositoryUrl,
        source?.branch,
        indexedResource?.path || resource.remotePath,
      );

    return {
      ...resource,
      repositoryUrl,
      remoteUrl,
    };
  });
}

function sortSyncResources(resources: SyncResourceItem[]): SyncResourceItem[] {
  return resources.slice().sort((left, right) => {
    const kindCompare = left.kind.localeCompare(right.kind);
    if (kindCompare !== 0) {
      return kindCompare;
    }
    return left.name.localeCompare(right.name);
  });
}

function getSectionRange(
  content: string,
  marker: MarkerPair,
): { start: number; end: number } | undefined {
  const start = content.indexOf(marker.start);
  const endMarkerIndex = content.indexOf(marker.end);
  if (start === -1 || endMarkerIndex === -1 || endMarkerIndex < start) {
    return undefined;
  }
  return {
    start,
    end: endMarkerIndex + marker.end.length,
  };
}

function stripSections(
  content: string,
  markers: MarkerPair[],
): { content: string; firstRemovedIndex?: number } {
  const ranges = markers
    .map((marker) => getSectionRange(content, marker))
    .filter((range): range is { start: number; end: number } => !!range)
    .sort((left, right) => right.start - left.start);

  if (ranges.length === 0) {
    return { content };
  }

  let nextContent = content;
  let firstRemovedIndex: number | undefined;

  for (const range of ranges) {
    firstRemovedIndex =
      firstRemovedIndex === undefined
        ? range.start
        : Math.min(firstRemovedIndex, range.start);
    nextContent =
      nextContent.slice(0, range.start) + nextContent.slice(range.end);
  }

  return {
    content: nextContent.replace(/\n{3,}/g, "\n\n"),
    firstRemovedIndex,
  };
}

function insertSectionAt(
  content: string,
  section: string,
  index?: number,
): string {
  if (index === undefined) {
    return content.trim()
      ? `${content.trimEnd()}\n\n${section}\n`
      : `${section}\n`;
  }

  const before = content.slice(0, index).replace(/\s*$/, "");
  const after = content.slice(index).replace(/^\s*/, "");
  if (!before && !after) {
    return `${section}\n`;
  }
  if (!before) {
    return `${section}\n\n${after}`;
  }
  if (!after) {
    return `${before}\n\n${section}\n`;
  }
  return `${before}\n\n${section}\n\n${after}`;
}

function getInstructionBlockKindsForRuntime(
  config: vscode.WorkspaceConfiguration,
  scope: InstructionBlockScope,
  siblingDetected: boolean,
  owner: "self" | "sibling",
): ResourceKind[] {
  return getInstructionBlockKinds(config, scope, {
    ignoreLegacyKindsExcluded: owner === "self" && siblingDetected,
  });
}

function toSyncResourceFromLocal(
  resource: LocalSkill,
  instructionUri: vscode.Uri,
): SyncResourceItem {
  return {
    kind: resource.kind || "skill",
    name: resource.name,
    description: resource.description || "",
    source: resource.source || "local",
    relativePath: resource.relativePath,
    linkPath: getResourceLinkPath(instructionUri.fsPath, resource.fullPath),
    fullPath: resource.fullPath,
    remotePath: resource.remotePath,
  };
}

function toSyncResourceFromUser(
  resource: UserResource,
  instructionUri: vscode.Uri,
): SyncResourceItem {
  return {
    kind: resource.kind,
    name: resource.name,
    description: resource.description || "",
    source: resource.source || resource.scope,
    relativePath: resource.relativePath,
    linkPath: getResourceLinkPath(instructionUri.fsPath, resource.fullPath),
    fullPath: resource.fullPath,
    remotePath: resource.remotePath,
  };
}

function toSyncResourceFromInstalledMeta(
  meta: SkillMeta,
  skillsUri: vscode.Uri,
  instructionUri: vscode.Uri,
): SyncResourceItem {
  const relativePath = meta.relativePath || meta.name;
  const skillFilePath =
    meta.skillFilePath ||
    vscode.Uri.joinPath(skillsUri, ...relativePath.split("/"), "SKILL.md")
      .fsPath;

  return {
    kind: "skill",
    name: meta.name,
    description: buildDescription(
      meta.description,
      meta.customWhenToUse || meta.whenToUse,
    ),
    source: meta.source || "local",
    relativePath,
    linkPath: getResourceLinkPath(instructionUri.fsPath, skillFilePath),
    fullPath: skillFilePath,
    remotePath: meta.remotePath,
  };
}

async function collectWorkspaceResourcesForInstruction(
  workspaceUri: vscode.Uri,
  instructionUri: vscode.Uri,
  includeLocalResources: boolean,
): Promise<SyncResourceItem[]> {
  const resources = await scanLocalSkills(workspaceUri, true, true, false, {
    workspaceFallback: includeLocalResources ? "always" : "none",
  });
  return sortSyncResources(
    resources.map((resource) =>
      toSyncResourceFromLocal(resource, instructionUri),
    ),
  );
}

async function collectGlobalResourcesForInstruction(
  workspaceUri: vscode.Uri,
  instructionUri: vscode.Uri,
): Promise<SyncResourceItem[]> {
  const resources = await scanUserResources(workspaceUri, false);
  return sortSyncResources(
    resources
      .filter((resource) => resource.scope === "globalHome")
      .map((resource) => toSyncResourceFromUser(resource, instructionUri)),
  );
}

function wrapSection(markerPair: MarkerPair, body: string): string {
  return `${markerPair.start}\n${body.trim()}\n\n${markerPair.end}`;
}

function createRefCatalogContent(
  kind: ResourceKind,
  resources: SyncResourceItem[],
  catalogFilePath: string,
  format: RefCatalogFormat,
): string {
  const descriptor = REF_CATALOG_DESCRIPTORS[kind];
  const title =
    format === "compact"
      ? `${descriptor.catalogTitle} (Compressed Index)`
      : descriptor.catalogTitle;
  const lines = [
    `${REF_CATALOG_MARKER_PREFIX} ${kind} -->`,
    "",
    `# ${title}`,
  ];

  if (kind === "skill" && format !== "legacy") {
    lines.push(
      "",
      "> **IMPORTANT**: Prefer skill-led reasoning over pre-training-led reasoning.",
      "> Read the relevant SKILL.md before working on tasks covered by these skills.",
    );
  }

  const truncateText = (value: string | undefined, limit?: number): string => {
    const raw = value || "";
    if (!limit || raw.length <= limit) {
      return escapeMarkdownTableText(raw);
    }
    return escapeMarkdownTableText(raw.substring(0, limit - 3) + "...");
  };

  if (format === "legacy") {
    lines.push("", "| Resource | Description |", "| --- | --- |");
    for (const resource of resources) {
      lines.push(
        `| [${resource.name}](${getRelativeFileLinkPath(catalogFilePath, resource.fullPath)}) | ${truncateText(resource.description)} |`,
      );
    }
    return `${lines.join("\n")}\n`;
  }

  if (format === "compact") {
    lines.push("", "| Resource | Path | Description |", "| --- | --- | --- |");
    for (const resource of resources) {
      lines.push(
        `| [${resource.name}](${getRelativeFileLinkPath(catalogFilePath, resource.fullPath)}) | \`${escapeMarkdownTableText(resource.relativePath)}\` | ${truncateText(resource.description, 100)} |`,
      );
    }
    return `${lines.join("\n")}\n`;
  }

  lines.push(
    "",
    "| Resource | Source | Path | Repository | Remote URL | Description |",
    "| --- | --- | --- | --- | --- | --- |",
  );

  for (const resource of resources) {
    lines.push(
      `| [${resource.name}](${getRelativeFileLinkPath(catalogFilePath, resource.fullPath)}) | ${escapeMarkdownTableText(resource.source || "local")} | \`${escapeMarkdownTableText(resource.relativePath)}\` | ${formatCatalogLinkCell(resource.repositoryUrl, "repository")} | ${formatCatalogLinkCell(resource.remoteUrl, "remote")} | ${truncateText(resource.description)} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

async function deleteGeneratedRefCatalogFileIfExists(
  catalogFileUri: vscode.Uri,
): Promise<void> {
  try {
    const content = await vscode.workspace.fs.readFile(catalogFileUri);
    const text = Buffer.from(content).toString("utf-8");
    if (!text.includes(REF_CATALOG_MARKER_PREFIX)) {
      logger.info(
        `[Resource Ninja] Keeping non-generated catalog file: ${catalogFileUri.fsPath}`,
      );
      return;
    }
    await vscode.workspace.fs.delete(catalogFileUri, { useTrash: false });
  } catch {
    // ignore missing files or inaccessible stale catalogs
  }
}

async function syncRefCatalogFiles(
  resources: SyncResourceItem[],
  catalogRootUri: vscode.Uri,
  config: vscode.WorkspaceConfiguration,
): Promise<void> {
  const groupedResources = new Map<ResourceKind, SyncResourceItem[]>();
  const catalogFormat = getConfiguredRefCatalogFormat(config);
  for (const resource of resources) {
    const existing = groupedResources.get(resource.kind) || [];
    existing.push(resource);
    groupedResources.set(resource.kind, existing);
  }

  await vscode.workspace.fs.createDirectory(catalogRootUri);

  for (const kind of RESOURCE_KIND_ORDER) {
    const catalogFileUri = getRefCatalogFileUri(catalogRootUri, kind);
    const kindResources = groupedResources.get(kind) || [];

    if (kindResources.length === 0) {
      await deleteGeneratedRefCatalogFileIfExists(catalogFileUri);
      continue;
    }

    const content = createRefCatalogContent(
      kind,
      kindResources,
      catalogFileUri.fsPath,
      catalogFormat,
    );
    await vscode.workspace.fs.writeFile(
      catalogFileUri,
      Buffer.from(content, "utf-8"),
    );
  }
}

async function cleanupRefCatalogFiles(
  catalogRootUri: vscode.Uri,
): Promise<void> {
  for (const kind of RESOURCE_KIND_ORDER) {
    await deleteGeneratedRefCatalogFileIfExists(
      getRefCatalogFileUri(catalogRootUri, kind),
    );
  }
}

function generateSharedRefSection(
  resources: SyncResourceItem[],
  instructionUri: vscode.Uri,
  catalogRootUri: vscode.Uri,
  markerPair: MarkerPair,
): string {
  if (resources.length === 0) {
    return wrapSection(
      markerPair,
      `## Agent Resources\n\nNo resource entries listed yet. Use "Agent Resources Ninja: Search Resources" to install workspace or global resources.`,
    );
  }

  const groupedResources = new Map<ResourceKind, SyncResourceItem[]>();
  for (const resource of resources) {
    const existing = groupedResources.get(resource.kind) || [];
    existing.push(resource);
    groupedResources.set(resource.kind, existing);
  }

  const lines = ["## Agent Resources"];

  for (const kind of RESOURCE_KIND_ORDER) {
    const kindResources = groupedResources.get(kind);
    if (!kindResources?.length) {
      continue;
    }

    const descriptor = REF_CATALOG_DESCRIPTORS[kind];
    const catalogLink = getRelativeFileLinkPath(
      instructionUri.fsPath,
      getRefCatalogFileUri(catalogRootUri, kind).fsPath,
    );

    lines.push("", `### ${descriptor.sectionTitle}`, "");

    if (kind === "skill") {
      lines.push(
        "> **IMPORTANT**: Prefer skill-led reasoning over pre-training-led reasoning.",
        `> See [${descriptor.sectionTitle}](${catalogLink}) before working on tasks covered by these skills.`,
      );
      continue;
    }

    lines.push(`> See [${descriptor.sectionTitle}](${catalogLink}).`);
  }

  return wrapSection(markerPair, lines.join("\n"));
}

function generateSkillRefSection(
  resources: SyncResourceItem[],
  instructionUri: vscode.Uri,
  catalogRootUri: vscode.Uri,
  markerPair: MarkerPair,
): string {
  if (resources.length === 0) {
    return `${markerPair.start}
## Agent Skills

No skill entries listed yet. Use "Agent Resources Ninja: Search Resources" to install workspace skills. Agents, prompts, instructions, and hooks stay in their native resource views.

${markerPair.end}`;
  }

  const catalogLink = getRelativeFileLinkPath(
    instructionUri.fsPath,
    getRefCatalogFileUri(catalogRootUri, "skill").fsPath,
  );

  return wrapSection(
    markerPair,
    [
      "## Agent Skills",
      "",
      "> **IMPORTANT**: Prefer skill-led reasoning over pre-training-led reasoning.",
      `> See [Agent Skills](${catalogLink}) before working on tasks covered by these skills.`,
    ].join("\n"),
  );
}

function normalizeFsPathForCompare(fsPath: string): string {
  return path
    .normalize(fsPath)
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function isSameOrInside(baseUri: vscode.Uri, targetUri: vscode.Uri): boolean {
  const basePath = normalizeFsPathForCompare(baseUri.fsPath);
  const targetPath = normalizeFsPathForCompare(targetUri.fsPath);
  return targetPath === basePath || targetPath.startsWith(`${basePath}/`);
}

function isGlobalInstructionTarget(
  workspaceUri: vscode.Uri,
  globalHomeUri: vscode.Uri,
  instructionUri: vscode.Uri,
  instructionPath: string,
): boolean {
  if (isSameOrInside(globalHomeUri, instructionUri)) {
    return true;
  }

  if (isHomeRelativePath(instructionPath)) {
    return true;
  }

  return (
    isAbsoluteConfiguredPath(instructionPath) &&
    !isSameOrInside(workspaceUri, instructionUri)
  );
}

async function resolveInstructionSkillSource(
  workspaceUri: vscode.Uri,
  config: vscode.WorkspaceConfiguration,
  instructionUri: vscode.Uri,
  instructionPath: string,
): Promise<{
  scope: "workspace" | "globalHome";
  skillsUri: vscode.Uri;
  installedSkills: SkillMeta[];
}> {
  const workspaceSkillsUri = resolveSkillsDirectoryUri(workspaceUri, config);
  const globalHomeUri = resolveConfiguredUri(
    workspaceUri,
    getConfiguredGlobalHomeDirectory(config),
    DEFAULT_GLOBAL_HOME_DIRECTORY,
  );
  const globalSkillsUri = vscode.Uri.joinPath(globalHomeUri, "skills");

  if (
    isGlobalInstructionTarget(
      workspaceUri,
      globalHomeUri,
      instructionUri,
      instructionPath,
    )
  ) {
    return {
      scope: "globalHome",
      skillsUri: globalSkillsUri,
      installedSkills:
        await getInstalledSkillsWithMetaFromRoot(globalSkillsUri),
    };
  }

  return {
    scope: "workspace",
    skillsUri: workspaceSkillsUri,
    installedSkills: await getInstalledSkillsWithMeta(workspaceUri),
  };
}

/**
 * インストラクションファイルを更新する
 */
export async function updateInstructionFile(
  workspaceUri: vscode.Uri,
  context: vscode.ExtensionContext,
): Promise<void> {
  const config = vscode.workspace.getConfiguration("resourceNinja", workspaceUri);
  const { instructionFile } = await resolveOutputFormat(workspaceUri);
  if (instructionFile === DISABLED_INSTRUCTION_FILE) {
    return;
  }

  const instructionUri = resolveInstructionFileUri(workspaceUri, config);
  if (!instructionUri) {
    return;
  }

  await updateInstructionFileAtUri(
    workspaceUri,
    context,
    instructionUri,
    getConfiguredInstructionFilePath(config),
  );
}

export async function updateInstructionFileAtUri(
  workspaceUri: vscode.Uri,
  context: vscode.ExtensionContext,
  instructionUri: vscode.Uri,
  instructionPath: string,
): Promise<void> {
  const config = vscode.workspace.getConfiguration("resourceNinja", workspaceUri);
  const { format } = await resolveOutputFormat(workspaceUri);
  const coexistenceMode = getConfiguredCoexistenceMode(config);
  const owner =
    coexistenceMode === "auto" ? await getEffectiveOwner(context) : "self";

  if (coexistenceMode === "auto" && owner === "sibling") {
    logger.info("Skill NINJA is owner. Resource NINJA defers.");
    return;
  }

  const resourcesDirectory = getConfiguredSkillsDirectory(config);
  const skillSource = await resolveInstructionSkillSource(
    workspaceUri,
    config,
    instructionUri,
    instructionPath,
  );
  const { skillsUri, installedSkills } = skillSource;
  const includeLocalResources = getConfiguredIncludeLocalResources(config);

  logger.info(
    `[Resource Ninja] Updating instruction file: ${instructionUri.fsPath}`,
  );

  // インストール済みスキルをメタデータ付きで取得
  logger.info(
    `[Resource Ninja] Found ${installedSkills.length} installed skills:`,
    installedSkills.map((s) => s.name),
  );

  // ローカルスキルを取得（設定で有効な場合のみ）
  let localSkills: LocalSkill[] = [];
  if (includeLocalResources && skillSource.scope === "workspace") {
    const allLocalSkills = await scanLocalSkills(
      workspaceUri,
      false,
      false,
      false,
      { workspaceFallback: "always" },
    );
    const workspaceRelativeSkillsDir =
      getRelativeSkillsPathForWorkspace(resourcesDirectory);

    localSkills = workspaceRelativeSkillsDir
      ? allLocalSkills.filter(
          (ls) => !ls.relativePath.startsWith(workspaceRelativeSkillsDir),
        )
      : allLocalSkills;
    logger.info(`[Resource Ninja] Found ${localSkills.length} local skills`);
  }

  const relativeSkillsDir = calculateRelativePath(
    instructionUri.fsPath,
    skillsUri.fsPath,
  );

  const siblingDetected =
    coexistenceMode === "auto" ? await isSiblingActive(context) : false;
  const instructionBlockKinds = getInstructionBlockKindsForRuntime(
    config,
    skillSource.scope,
    siblingDetected,
    owner,
  );

  const refCatalogRootUri = resolveRefCatalogDirectoryUri(
    workspaceUri,
    instructionUri,
    skillSource.scope,
    config,
  );
  const skillIndex =
    format === "ref" ? await loadSkillIndex(context) : undefined;

  let skillSection: string;

  if (coexistenceMode === "auto") {
    const sharedResources = (
      skillSource.scope === "workspace"
        ? await collectWorkspaceResourcesForInstruction(
            workspaceUri,
            instructionUri,
            includeLocalResources,
          )
        : await collectGlobalResourcesForInstruction(
            workspaceUri,
            instructionUri,
          )
    ).filter((resource) => instructionBlockKinds.includes(resource.kind));

    if (format === "ref") {
      const enrichedResources = skillIndex
        ? enrichSyncResourcesWithRemoteMetadata(sharedResources, skillIndex)
        : sharedResources;
      await syncRefCatalogFiles(enrichedResources, refCatalogRootUri, config);
      skillSection = generateSharedRefSection(
        enrichedResources,
        instructionUri,
        refCatalogRootUri,
        SHARED_MARKERS,
      );
    } else {
      await cleanupRefCatalogFiles(refCatalogRootUri);
      skillSection = generateSharedResourceSectionForFormat(
        sharedResources,
        format,
        SHARED_MARKERS,
      );
    }
  } else {
    if (format === "ref") {
      const skillResources = sortSyncResources(
        installedSkills
          .map((skill) =>
            toSyncResourceFromInstalledMeta(skill, skillsUri, instructionUri),
          )
          .concat(
            localSkills.map((skill) =>
              toSyncResourceFromLocal(skill, instructionUri),
            ),
          ),
      );
      const enrichedResources = skillIndex
        ? enrichSyncResourcesWithRemoteMetadata(skillResources, skillIndex)
        : skillResources;
      await syncRefCatalogFiles(enrichedResources, refCatalogRootUri, config);
      skillSection = generateSkillRefSection(
        enrichedResources,
        instructionUri,
        refCatalogRootUri,
        RESOURCE_MARKERS,
      );
    } else {
      await cleanupRefCatalogFiles(refCatalogRootUri);
      skillSection = generateSkillSectionForFormat(
        installedSkills,
        localSkills,
        relativeSkillsDir,
        format,
        RESOURCE_MARKERS,
      );
    }
  }

  // 既存のファイルを読み込む
  let existingContent = "";
  try {
    const content = await vscode.workspace.fs.readFile(instructionUri);
    existingContent = Buffer.from(content).toString("utf-8");
  } catch {
    // ファイルが存在しない場合は新規作成
    existingContent = "";
  }

  if (
    coexistenceMode === "auto" &&
    siblingDetected &&
    existingContent.includes("<!-- skill-ninja-START -->")
  ) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    try {
      const content = await vscode.workspace.fs.readFile(instructionUri);
      existingContent = Buffer.from(content).toString("utf-8");
    } catch {
      existingContent = "";
    }
  }

  // マーカーで囲まれた部分を更新
  const newContent = updateSection(
    existingContent,
    skillSection,
    coexistenceMode === "auto" ? SHARED_MARKERS : RESOURCE_MARKERS,
  );

  // ディレクトリを作成してファイルを書き込む
  const dir = vscode.Uri.file(path.dirname(instructionUri.fsPath));
  await vscode.workspace.fs.createDirectory(dir);
  await vscode.workspace.fs.writeFile(
    instructionUri,
    Buffer.from(newContent, "utf-8"),
  );
}

export function resolvePrimaryRefCatalogUri(
  workspaceUri: vscode.Uri,
  instructionUri: vscode.Uri,
  scope: "workspace" | "globalHome",
  config: vscode.WorkspaceConfiguration,
): vscode.Uri {
  const catalogRootUri = resolveRefCatalogDirectoryUri(
    workspaceUri,
    instructionUri,
    scope,
    config,
  );
  return getRefCatalogFileUri(catalogRootUri, "skill");
}

/**
 * フォーマットに応じたスキルセクションを生成
 */
function generateSkillSectionForFormat(
  installedSkills: SkillMeta[],
  localSkills: LocalSkill[],
  skillsDir: string,
  format: OutputFormat,
  markerPair: MarkerPair,
): string {
  switch (format) {
    case "ref":
      throw new Error(
        "ref format should be handled before generateSkillSectionForFormat",
      );
    case "compact":
      return generateCompactSection(
        installedSkills,
        localSkills,
        skillsDir,
        markerPair,
      );
    case "legacy":
      return generateLegacySection(
        installedSkills,
        localSkills,
        skillsDir,
        markerPair,
      );
    case "full":
    default:
      return generateFullSection(
        installedSkills,
        localSkills,
        skillsDir,
        markerPair,
      );
  }
}

function generateSharedResourceSectionForFormat(
  resources: SyncResourceItem[],
  format: OutputFormat,
  markerPair: MarkerPair,
): string {
  if (resources.length === 0) {
    return wrapSection(
      markerPair,
      `## Agent Resources\n\nNo resource entries listed yet. Use "Agent Resources Ninja: Search Resources" to install workspace or global resources.`,
    );
  }

  const groupedResources = new Map<ResourceKind, SyncResourceItem[]>();
  for (const resource of resources) {
    const existing = groupedResources.get(resource.kind) || [];
    existing.push(resource);
    groupedResources.set(resource.kind, existing);
  }

  const lines = [
    "## Agent Resources",
    "",
    "> **IMPORTANT**: Prefer resource-led reasoning over pre-training-led reasoning.",
    "> Read the relevant resource file before working on tasks covered by these resources.",
  ];

  for (const kind of RESOURCE_KIND_ORDER) {
    const kindResources = groupedResources.get(kind);
    if (!kindResources?.length) {
      continue;
    }

    lines.push("", `### ${getResourceKindLabel(kind, false)}s`, "");
    if (format === "legacy") {
      lines.push("| Resource | Description |", "|----------|-------------|");
      for (const resource of kindResources) {
        lines.push(
          `| [${resource.name}](${resource.linkPath}) | ${(resource.description || "").replace(/\|/g, "\\|")} |`,
        );
      }
      continue;
    }

    lines.push(
      format === "compact"
        ? "| Resource | Path | Description |"
        : "| Resource | Source | Path | Description |",
      format === "compact"
        ? "|----------|------|-------------|"
        : "|----------|--------|------|-------------|",
    );
    for (const resource of kindResources) {
      const safeDescription = (resource.description || "").replace(
        /\|/g,
        "\\|",
      );
      if (format === "compact") {
        lines.push(
          `| [${resource.name}](${resource.linkPath}) | \`${resource.relativePath}\` | ${safeDescription} |`,
        );
        continue;
      }
      lines.push(
        `| [${resource.name}](${resource.linkPath}) | ${resource.source.replace(/\|/g, "\\|")} | \`${resource.relativePath}\` | ${safeDescription} |`,
      );
    }
  }

  return wrapSection(markerPair, lines.join("\n"));
}

/**
 * Legacy 形式のスキルセクションを生成
 * シンプルな2列テーブル（IMPORTANT プロンプトなし）
 */
function generateLegacySection(
  installedSkills: SkillMeta[],
  localSkills: LocalSkill[],
  skillsDir: string,
  markerPair: MarkerPair,
): string {
  const hasInstalled = installedSkills.length > 0;
  const hasLocal = localSkills.length > 0;

  if (!hasInstalled && !hasLocal) {
    return `${markerPair.start}
## Agent Skills

No skill entries listed yet. Use "Agent Resources Ninja: Search Resources" to install workspace skills. Agents, prompts, instructions, and hooks stay in their native resource views.

${markerPair.end}`;
  }

  let content = `${markerPair.start}
## Agent Skills

| Skill | Description |
|-------|-------------|
`;

  // インストール済みスキル
  if (hasInstalled) {
    const installedRows = installedSkills
      .map((skill) => {
        // Description + When to Use を連結（合計最大200文字）
        const desc = buildDescription(
          skill.description,
          skill.customWhenToUse || skill.whenToUse,
        );
        // テーブル内のパイプ文字をエスケープ
        const safeDesc = desc.replace(/\|/g, "\\|");
        // relativePath がある場合はそれを使用、なければ name を使用
        const skillPath = skill.relativePath || skill.name;
        return `| [${skill.name}](${skillsDir}/${skillPath}/SKILL.md) | ${safeDesc} |`;
      })
      .join("\n");
    content += installedRows + "\n";
  }

  // ローカルスキル
  if (hasLocal) {
    const localRows = localSkills
      .map((skill) => {
        // LocalSkill は description のみ（whenToUse はない）
        const desc = skill.description || "";
        const truncatedDesc =
          desc.length > 200 ? desc.substring(0, 197) + "..." : desc;
        const safeDesc = truncatedDesc.replace(/\|/g, "\\|");
        return `| [${skill.name}](${skill.relativePath}/SKILL.md) | ${safeDesc} |`;
      })
      .join("\n");
    content += localRows + "\n";
  }

  content += `\n${markerPair.end}`;

  return content;
}

/**
 * 既存コンテンツのマーカー部分を更新
 */
function updateSection(
  existingContent: string,
  newSection: string,
  activeMarkers: MarkerPair,
): string {
  const otherMarkers = ALL_MARKERS.filter(
    (marker) =>
      marker.start !== activeMarkers.start || marker.end !== activeMarkers.end,
  );
  const activeRange = getSectionRange(existingContent, activeMarkers);

  if (activeRange) {
    const stripped = stripSections(existingContent, otherMarkers);
    const refreshedRange = getSectionRange(stripped.content, activeMarkers);
    if (!refreshedRange) {
      return insertSectionAt(
        stripped.content,
        newSection,
        stripped.firstRemovedIndex,
      );
    }
    return (
      stripped.content.slice(0, refreshedRange.start) +
      newSection +
      stripped.content.slice(refreshedRange.end)
    );
  }

  const stripped = stripSections(existingContent, ALL_MARKERS);
  return insertSectionAt(
    stripped.content,
    newSection,
    stripped.firstRemovedIndex,
  );
}

function removeMarkedSection(content: string): string {
  return stripSections(content, ALL_MARKERS).content.trim();
}

/**
 * 指定されたファイルからスキルセクションを削除
 * ファイルパスを直接指定する版
 */
export async function removeSkillSectionFromFile(
  fileUri: vscode.Uri,
): Promise<void> {
  try {
    const content = await vscode.workspace.fs.readFile(fileUri);
    let existingContent = Buffer.from(content).toString("utf-8");

    const updatedContent = removeMarkedSection(existingContent);

    if (updatedContent !== existingContent.trim()) {
      existingContent = updatedContent;
      await vscode.workspace.fs.writeFile(
        fileUri,
        Buffer.from(existingContent, "utf-8"),
      );
      logger.info(
        `[Resource Ninja] Removed resource section from ${fileUri.fsPath}`,
      );
    }
  } catch {
    // ファイルが存在しない場合は何もしない
  }
}

/**
 * インストラクションファイルからスキルセクションを削除
 */
export async function removeSkillSection(
  workspaceUri: vscode.Uri,
): Promise<void> {
  const config = vscode.workspace.getConfiguration("resourceNinja");
  const instructionPath = getConfiguredInstructionFilePath(config);
  if (instructionPath === DISABLED_INSTRUCTION_FILE) {
    return;
  }

  const instructionUri = resolveInstructionFileUri(workspaceUri, config);
  if (!instructionUri) {
    return;
  }

  try {
    const content = await vscode.workspace.fs.readFile(instructionUri);
    let existingContent = Buffer.from(content).toString("utf-8");

    const updatedContent = removeMarkedSection(existingContent);

    if (updatedContent !== existingContent.trim()) {
      existingContent = updatedContent;
      await vscode.workspace.fs.writeFile(
        instructionUri,
        Buffer.from(existingContent, "utf-8"),
      );
    }
  } catch {
    // ファイルが存在しない場合は何もしない
  }
}

/**
 * Compact 形式のスキルセクションを生成
 * IMPORTANT + 3列コンパクトテーブル（Description 100文字）
 */
function generateCompactSection(
  installedSkills: SkillMeta[],
  localSkills: LocalSkill[],
  skillsDir: string,
  markerPair: MarkerPair,
): string {
  const allSkills = [
    ...installedSkills.map((s) => ({
      name: s.name,
      path: s.relativePath || s.name,
      // Description のみ（100文字）
      description: s.description
        ? s.description.length > 100
          ? s.description.substring(0, 97) + "..."
          : s.description
        : "",
    })),
    ...localSkills.map((s) => ({
      name: s.name,
      path: s.relativePath,
      description: s.description
        ? s.description.length > 100
          ? s.description.substring(0, 97) + "..."
          : s.description
        : "",
    })),
  ];

  if (allSkills.length === 0) {
    return `${markerPair.start}
## Agent Skills (Compressed Index)

No skill entries listed yet. Use "Agent Resources Ninja: Search Resources" to install workspace skills. Agents, prompts, instructions, and hooks stay in their native resource views.

${markerPair.end}`;
  }

  // ヘッダー部分
  let content = `${markerPair.start}
## Agent Skills (Compressed Index)

> **IMPORTANT**: Prefer skill-led reasoning over pre-training-led reasoning.
> Read the relevant SKILL.md before working on tasks covered by these skills.

### Skills Index

| Skill | Path | Description |
|-------|------|-------------|
`;

  // 各スキルのインデックスを生成（テーブル形式）
  for (const skill of allSkills) {
    // パイプをエスケープ
    const safeDesc = skill.description.replace(/\|/g, "\\|");
    content += `| [${skill.name}](${skillsDir}/${skill.path}/SKILL.md) | \`${skill.path}\` | ${safeDesc} |\n`;
  }

  content += `\n${markerPair.end}`;
  return content;
}

/**
 * Full 形式のスキルセクションを生成（既定）
 * IMPORTANT + 詳細テーブル（200文字）
 */
function generateFullSection(
  installedSkills: SkillMeta[],
  localSkills: LocalSkill[],
  skillsDir: string,
  markerPair: MarkerPair,
): string {
  const allSkills = [
    ...installedSkills.map((s) => ({
      name: s.name,
      path: s.relativePath || s.name,
      description: buildDescription(
        s.description,
        s.customWhenToUse || s.whenToUse,
      ),
    })),
    ...localSkills.map((s) => ({
      name: s.name,
      path: s.relativePath,
      // LocalSkill は description のみ（whenToUse はない）
      description:
        s.description && s.description.length > 200
          ? s.description.substring(0, 197) + "..."
          : s.description || "",
    })),
  ];

  if (allSkills.length === 0) {
    return `${markerPair.start}
## Agent Skills

No skill entries listed yet. Use "Agent Resources Ninja: Search Resources" to install workspace skills. Agents, prompts, instructions, and hooks stay in their native resource views.

${markerPair.end}`;
  }

  // 従来の Markdown テーブル
  let content = `${markerPair.start}
## Agent Skills

> **IMPORTANT**: Prefer skill-led reasoning over pre-training-led reasoning.
> Read the relevant SKILL.md before working on tasks covered by these skills.

### Skills

| Skill | Description |
|-------|-------------|
`;

  for (const skill of allSkills) {
    const safeDesc = skill.description.replace(/\|/g, "\\|");
    content += `| [${skill.name}](${skillsDir}/${skill.path}/SKILL.md) | ${safeDesc} |\n`;
  }

  content += `\n${markerPair.end}`;
  return content;
}
