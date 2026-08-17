// スキルインストール機能
// GitHub からスキルをダウンロードしてワークスペースに配置

import * as path from "path";
import * as vscode from "vscode";
import {
  Skill,
  getResourceKind,
  loadSkillIndex,
  Source,
  getSourceBranch,
} from "./skillIndex";
import { isJapanese, messages } from "./i18n";
import {
  getGitHubToken,
  hasClearableGitHubToken,
  resolveGitHubToken,
} from "./githubAuth";
import { fetchGitHubWithOptionalAuthRetry } from "./githubFetch";
import { resetGitHubCredentialBlocklist } from "./githubCredentialBlocklist";
import { createGitHubResponseError } from "./githubResponse";
import {
  GitHubDirectoryEntry,
  partitionGitHubDirectoryEntries,
  resolveSymlinkTargetPath,
} from "./githubDirectoryTraversal";
import {
  DEFAULT_GLOBAL_HOME_DIRECTORY,
  getConfiguredAdditionalSkillRoots,
  getConfiguredSkillsDirectory,
  getConfiguredGlobalHomeDirectory,
  getConfiguredUserAgentsDirectory,
  getConfiguredUserInstructionsDirectory,
  getConfiguredUserPromptsDirectory,
  getConfiguredWorkspaceAgentsDirectory,
  getConfiguredWorkspaceHooksDirectory,
  getConfiguredWorkspaceInstructionsDirectory,
  getConfiguredWorkspaceMcpDirectory,
  getConfiguredWorkspacePromptsDirectory,
  getRelativeSkillsPathForWorkspace,
  resolveConfiguredUri,
  resolveSkillsDirectoryUri,
} from "./customizationPaths";
import {
  detectResourceKindFromPath,
  getPluginRootFromManifestPath,
  getPluginOwnedHookInstallFileName,
  getPluginOwnedInstallFileName,
  getPluginRootFsPathFromManifestPath,
  getResourceMetadataPath,
  isHookConfigFilePath,
  isOwnMetadataSidecarFileName,
  sanitizeResourceInstallName,
} from "./resourceKinds";
import { getVsCodeUserDataPath } from "./userDataPaths";
import {
  isContainedPath,
  isDeletableWithin,
  isRealPathStrictlyInside,
  isSafePathSegment,
} from "./pathSafety";
import {
  collectPluginLocationKeysForRemoval,
  removePluginLocations,
  supportsPluginLocations,
} from "./pluginLocations";
import { logger } from "./logger";
import { openBugReport as openBugReportIssue } from "./bugReport";
import {
  HookConfigUpdateResult,
  restoreHookConfigFromBackup,
  updateHookConfigForInstall,
  updateHookConfigForUninstall,
} from "./hookConfigManager";
import {
  McpConfigUpdateResult,
  updateMcpConfigForInstall,
} from "./mcpConfigManager";

export type InstallTargetScope =
  | "workspace"
  | "userData"
  | "globalHome"
  | "custom";

export interface InstallSkillOptions {
  targetScope?: InstallTargetScope;
  customTargetUri?: vscode.Uri;
  suppressRecoveryPrompt?: boolean;
  mcpInstallMode?: "copyOnly" | "mergeIntoWorkspace";
  confirmMcpServerOverwrite?: (
    serverKeys: string[],
    configUri: vscode.Uri,
  ) => Promise<string[]>;
}

export interface InstallSkillResult {
  /**
   * Where the install actually wrote. Callers that register the destination read
   * it from here instead of recomputing it, because the configuration can change
   * while the install is in progress.
   */
  destinationUri: vscode.Uri;
  /**
   * The download failures the install already reported to the user, carried on
   * the result so a caller can tell a clean install from one that left content
   * missing. Absent when nothing failed.
   */
  errors?: string[];
  hookConfigUpdate?: HookConfigUpdateResult;
  mcpConfigUpdate?: McpConfigUpdateResult;
}

/**
 * SKILL.md の実体を取得できず、生成テンプレートだけが残った状態。
 * 呼び出し元の既存 try/catch がそのまま失敗として数えられるように例外で表す。
 */
export class SkillInstallIncompleteError extends Error {
  constructor(
    public readonly skillName: string,
    public readonly skillPath: string,
  ) {
    super(`Skill install incomplete: ${skillName}`);
    this.name = "SkillInstallIncompleteError";
  }
}

export class SkillNotFoundHandledError extends Error {
  constructor(skillName: string) {
    super(`Skill not found: ${skillName}`);
    this.name = "SkillNotFoundHandledError";
  }
}

export function isSkillNotFoundHandledError(
  error: unknown,
): error is SkillNotFoundHandledError {
  return error instanceof SkillNotFoundHandledError;
}

export function isSkillInstallIncompleteError(
  error: unknown,
): error is SkillInstallIncompleteError {
  return error instanceof SkillInstallIncompleteError;
}

export interface UninstallSkillResult {
  hookConfigUpdate?: HookConfigUpdateResult;
}

function getParentDirectoryUri(resourceUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.file(path.dirname(resourceUri.fsPath));
}

async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Deleting the wrong directory is worse than a failed cleanup, so a target that
 * escapes the root the caller is allowed to touch is refused instead of deleted.
 */
function isDeleteTargetAllowed(
  targetUri: vscode.Uri,
  allowedRootUri: vscode.Uri,
  operation: string,
): boolean {
  if (
    isDeletableWithin(allowedRootUri.fsPath, targetUri.fsPath) &&
    isRealPathStrictlyInside(allowedRootUri.fsPath, targetUri.fsPath)
  ) {
    return true;
  }
  logger.error(
    `[Resource Ninja] Refused ${operation}: ${targetUri.fsPath} resolves outside ${allowedRootUri.fsPath}`,
  );
  return false;
}

function assertRealPathStrictlyInside(
  targetUri: vscode.Uri,
  allowedRootUri: vscode.Uri,
  operation: string,
): void {
  if (
    isContainedPath(allowedRootUri.fsPath, targetUri.fsPath) &&
    isRealPathStrictlyInside(allowedRootUri.fsPath, targetUri.fsPath)
  ) {
    return;
  }
  throw new Error(
    `Refused ${operation}: ${targetUri.fsPath} resolves outside ${allowedRootUri.fsPath}`,
  );
}

async function deleteUriIfCreated(
  uri: vscode.Uri,
  existedBeforeInstall: boolean,
  recursive: boolean,
  allowedRootUri: vscode.Uri,
): Promise<void> {
  if (existedBeforeInstall) {
    return;
  }
  if (!isDeleteTargetAllowed(uri, allowedRootUri, "install rollback delete")) {
    return;
  }
  try {
    await vscode.workspace.fs.delete(uri, { recursive });
  } catch {
    // Cleanup failure should not hide the install error.
  }
}

async function deleteDirectoryIfCreatedAndEmpty(
  uri: vscode.Uri,
  existedBeforeInstall: boolean,
): Promise<void> {
  if (existedBeforeInstall) {
    return;
  }
  try {
    const entries = await vscode.workspace.fs.readDirectory(uri);
    if (entries.length === 0) {
      await vscode.workspace.fs.delete(uri);
    }
  } catch {
    // Cleanup failure should not hide the install error.
  }
}

function getHookConfigRootUri(
  workspaceUri: vscode.Uri,
  config: vscode.WorkspaceConfiguration,
  hookReadmeUri: vscode.Uri,
  options: InstallSkillOptions = {},
): vscode.Uri {
  if (
    options.targetScope === "globalHome" ||
    options.targetScope === "userData"
  ) {
    return resolveConfiguredUri(
      workspaceUri,
      getConfiguredGlobalHomeDirectory(config),
      DEFAULT_GLOBAL_HOME_DIRECTORY,
    );
  }

  if (options.targetScope === "custom" && options.customTargetUri) {
    return options.customTargetUri;
  }

  if (hookReadmeUri.fsPath.startsWith(workspaceUri.fsPath)) {
    return workspaceUri;
  }

  return getParentDirectoryUri(getParentDirectoryUri(hookReadmeUri));
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

interface GitHubRepositoryRef {
  owner: string;
  repo: string;
  repoUrl: string;
}

interface GitHubContentRef extends GitHubRepositoryRef {
  branch: string;
  remotePath: string;
}

function normalizeOwnerRepo(value: string): string {
  return value
    .trim()
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");
}

function extractRepositoryRefFromGitHubUrl(
  url: string | undefined,
): GitHubRepositoryRef | undefined {
  if (!url) {
    return undefined;
  }

  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/i);
  if (!match) {
    return undefined;
  }

  const owner = match[1];
  const repo = match[2].replace(/\.git$/i, "");
  return {
    owner,
    repo,
    repoUrl: `https://github.com/${owner}/${repo}`,
  };
}

function extractContentRefFromRawUrl(
  rawUrl: string | undefined,
): GitHubContentRef | undefined {
  if (!rawUrl) {
    return undefined;
  }

  const match = rawUrl.match(
    /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/i,
  );
  if (!match) {
    return undefined;
  }

  const [, owner, repo, branch, remotePath] = match;
  return {
    owner,
    repo,
    branch,
    remotePath,
    repoUrl: `https://github.com/${owner}/${repo}`,
  };
}

function extractContentRefFromGitHubUrl(
  url: string | undefined,
): GitHubContentRef | undefined {
  if (!url) {
    return undefined;
  }

  const match = url.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(blob|tree)\/([^/]+)\/(.+)$/i,
  );
  if (!match) {
    return undefined;
  }

  const [, owner, rawRepo, , branch, remotePath] = match;
  const repo = rawRepo.replace(/\.git$/i, "");
  return {
    owner,
    repo,
    branch,
    remotePath,
    repoUrl: `https://github.com/${owner}/${repo}`,
  };
}

function findSourceByRepository(
  skill: Skill,
  sources: Source[],
): Source | undefined {
  const directSource = sources.find(
    (candidate) => candidate.id === skill.source,
  );
  if (directSource) {
    return directSource;
  }

  if (!skill.source.includes("/")) {
    return undefined;
  }

  const ownerRepo = normalizeOwnerRepo(skill.source).toLowerCase();
  return sources.find((candidate) => {
    const repoRef = extractRepositoryRefFromGitHubUrl(candidate.url);
    if (!repoRef) {
      return false;
    }
    return `${repoRef.owner}/${repoRef.repo}`.toLowerCase() === ownerRepo;
  });
}

function buildSkillNotFoundMessage(skillName: string, token?: string): string {
  return token
    ? messages.skillDownloadNotFoundWithAuth(skillName)
    : messages.skillDownloadNotFoundNoAuth(skillName);
}

function buildSkillNotFoundPossibleCause(hasToken: boolean): string {
  return hasToken
    ? "The resource index path may be outdated, or the configured GitHub authentication may not have Contents: read access to the repository."
    : "The resource index path may be outdated. If the repository is private, GitHub authentication with Contents: read access is required.";
}

async function handleSkillNotFound(
  skillPath: vscode.Uri,
  allowedRootUri: vscode.Uri,
  skill: Skill,
  source: Source | undefined,
  failedUrl: string,
  token: string | undefined,
  suppressRecoveryPrompt: boolean,
): Promise<never> {
  if (isDeleteTargetAllowed(skillPath, allowedRootUri, "install cleanup")) {
    try {
      await vscode.workspace.fs.delete(skillPath, { recursive: true });
    } catch {
      // Cleanup failure should not hide the original download error.
    }
  }

  if (!suppressRecoveryPrompt) {
    const openSettings = messages.openSettings();
    const updateIndex = messages.actionUpdateIndex();
    const reportBug = messages.actionReportBug();
    const clearStoredToken = messages.actionClearStoredGitHubToken();
    const hasStoredToken = await hasClearableGitHubToken();
    const choice = await vscode.window.showErrorMessage(
      buildSkillNotFoundMessage(skill.name, token),
      openSettings,
      updateIndex,
      reportBug,
      ...(hasStoredToken ? [clearStoredToken] : []),
    );

    if (choice === openSettings) {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "resourceNinja.githubToken",
      );
    } else if (choice === updateIndex) {
      await vscode.commands.executeCommand("resourceNinja.updateIndex");
    } else if (choice === reportBug) {
      await openBugReport(
        skill,
        source,
        failedUrl,
        "404 Not Found",
        Boolean(token),
      );
    } else if (choice === clearStoredToken) {
      await vscode.commands.executeCommand("resourceNinja.clearGitHubToken");
    }
  }

  throw new SkillNotFoundHandledError(skill.name);
}

function createSyntheticSource(
  skill: Skill,
  repoRef: GitHubRepositoryRef,
  branch?: string,
): Source {
  return {
    id: skill.source,
    name: repoRef.repo,
    url: repoRef.repoUrl,
    type: "github",
    branch,
    description: skill.description || skill.name,
    description_ja: skill.description_ja,
  };
}

async function readSkillMetaIfExists(
  metaPath: vscode.Uri,
): Promise<Partial<SkillMeta> | undefined> {
  try {
    const existingContent = await vscode.workspace.fs.readFile(metaPath);
    const parsed = JSON.parse(
      Buffer.from(existingContent).toString("utf-8"),
    ) as Partial<SkillMeta>;
    stripSkillMetaLocalPaths(parsed);
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * `.skill-meta.json` fields that name a location on this machine. They are
 * recomputed on every scan, so a value read back from the file is never merged:
 * the file itself can arrive from a third-party repository.
 */
export const SKILL_META_LOCAL_PATH_FIELDS = [
  "skillFilePath",
  "relativePath",
] as const;

/**
 * Drops every field listed above from a sidecar that was just read. A path only
 * ever comes from where the scan actually found the file, never from content.
 * Returns whether anything had to be removed.
 */
export function stripSkillMetaLocalPaths(
  meta: Record<string, unknown> | undefined,
): boolean {
  if (!meta) {
    return false;
  }
  let removed = false;
  for (const field of SKILL_META_LOCAL_PATH_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(meta, field)) {
      delete meta[field];
      removed = true;
    }
  }
  return removed;
}

function mergeSkillMeta(
  existingMeta: Partial<SkillMeta> | undefined,
  nextMeta: SkillMeta,
): SkillMeta {
  const carriedOverMeta: Partial<SkillMeta> = { ...(existingMeta ?? {}) };
  for (const field of SKILL_META_LOCAL_PATH_FIELDS) {
    delete carriedOverMeta[field];
  }

  return {
    ...carriedOverMeta,
    ...nextMeta,
  };
}

interface ResourceInstallMeta {
  kind: string;
  name: string;
  source: string;
  description: string;
  description_ja?: string;
  categories?: string[];
  remotePath: string;
  installedAt: string;
  incomplete?: boolean;
  pluginRoot?: string;
  pluginManifestPath?: string;
  pluginManifestKind?: string;
}

function getResourceMetadataUri(
  resourceUri: vscode.Uri,
  kind: ReturnType<typeof getResourceKind>,
): vscode.Uri {
  return vscode.Uri.file(
    path.normalize(getResourceMetadataPath(resourceUri.fsPath, kind)),
  );
}

async function writeResourceInstallMetadata(
  resourceUri: vscode.Uri,
  skill: Skill,
): Promise<void> {
  const kind = getResourceKind(skill);
  if (kind === "skill") {
    return;
  }

  const meta: ResourceInstallMeta = {
    kind,
    name: skill.name,
    source: normalizeSkillMetaSource({
      source: skill.source,
      remotePath: skill.path,
    }),
    description: skill.description,
    description_ja: skill.description_ja,
    categories: skill.categories,
    remotePath: skill.path,
    installedAt: new Date().toISOString(),
    pluginRoot: skill.pluginRoot,
    pluginManifestPath: skill.pluginManifestPath,
    pluginManifestKind: skill.pluginManifestKind,
  };
  await vscode.workspace.fs.writeFile(
    getResourceMetadataUri(resourceUri, kind),
    Buffer.from(JSON.stringify(meta, null, 2), "utf-8"),
  );
}

async function deleteResourceInstallMetadata(
  resourceUri: vscode.Uri,
  kind: ReturnType<typeof getResourceKind>,
): Promise<void> {
  try {
    await vscode.workspace.fs.delete(getResourceMetadataUri(resourceUri, kind));
  } catch {
    // Older installs may not have sidecar metadata.
  }
}

export async function removeOwnedLegacyPluginResource(
  targetUri: vscode.Uri,
  skill: Skill,
): Promise<void> {
  const kind = getResourceKind(skill);
  if (
    !skill.pluginRoot ||
    (kind !== "hook" &&
      kind !== "agent" &&
      kind !== "instruction" &&
      kind !== "prompt")
  ) {
    return;
  }
  const originalFileName = path.posix.basename(skill.path.replace(/\\/g, "/"));
  if (path.basename(targetUri.fsPath) === originalFileName) {
    return;
  }
  const legacyUri = vscode.Uri.joinPath(
    getParentDirectoryUri(targetUri),
    originalFileName,
  );
  try {
    const metadataUri = getResourceMetadataUri(legacyUri, kind);
    const metadata = JSON.parse(
      Buffer.from(await vscode.workspace.fs.readFile(metadataUri)).toString(
        "utf8",
      ),
    ) as Partial<ResourceInstallMeta>;
    if (
      metadata.kind !== kind ||
      metadata.source !==
        normalizeSkillMetaSource({
          source: skill.source,
          remotePath: skill.path,
        }) ||
      metadata.remotePath !== skill.path ||
      metadata.pluginRoot !== skill.pluginRoot
    ) {
      return;
    }
    await vscode.workspace.fs.delete(legacyUri, { useTrash: true });
    await vscode.workspace.fs.delete(metadataUri, { useTrash: true });
    logger.info(
      `[Resource Ninja] Migrated owned plugin resource from ${legacyUri.fsPath} to ${targetUri.fsPath}`,
    );
  } catch {
    // Missing or unowned legacy files are never removed.
  }
}

function getInstallFileName(skill: Skill, fileName: string): string {
  const pluginHookFileName = getPluginOwnedHookInstallFileName({
    kind: getResourceKind(skill),
    source: skill.source,
    pluginRoot: skill.pluginRoot,
    resourcePath: skill.path,
    fileName,
  });
  if (pluginHookFileName !== fileName) {
    return pluginHookFileName;
  }
  const pluginOwnedFileName = getPluginOwnedInstallFileName({
    kind: getResourceKind(skill),
    pluginRoot: skill.pluginRoot,
    fileName,
  });
  if (pluginOwnedFileName !== fileName) {
    return pluginOwnedFileName;
  }
  if (getResourceKind(skill) !== "mcp") {
    return fileName;
  }

  const normalizedFileName = fileName.replace(/^\./, "");
  if (normalizedFileName.toLowerCase() !== "mcp.json") {
    return fileName;
  }

  return `${sanitizeResourceInstallName(skill.source)}-${normalizedFileName}`;
}

function getPluginInstallRootName(skill: Skill): string {
  return sanitizeResourceInstallName(
    skill.name || skill.pluginRoot || "plugin",
  );
}

export function getResourceTargetUri(
  workspaceUri: vscode.Uri,
  config: vscode.WorkspaceConfiguration,
  skill: Skill,
  options: InstallSkillOptions = {},
): vscode.Uri {
  const kind = getResourceKind(skill);
  const targetScope = options.targetScope || "workspace";
  const normalizedRemotePath = skill.path.replace(/\\/g, "/");
  const fileName = getInstallFileName(
    skill,
    path.posix.basename(normalizedRemotePath),
  );
  const isHookConfigFile =
    kind === "hook" && isHookConfigFilePath(normalizedRemotePath);
  const resourceFolderName = sanitizeResourceInstallName(
    kind === "skill"
      ? skill.name
      : path.posix.basename(path.posix.dirname(normalizedRemotePath)) ||
          skill.name,
  );

  if (kind === "plugin") {
    const pluginFolderName = getPluginInstallRootName(skill);
    if (targetScope === "custom" && options.customTargetUri) {
      return vscode.Uri.joinPath(options.customTargetUri, pluginFolderName);
    }
    if (targetScope === "globalHome" || targetScope === "userData") {
      const root = resolveConfiguredUri(
        workspaceUri,
        getConfiguredGlobalHomeDirectory(config),
        DEFAULT_GLOBAL_HOME_DIRECTORY,
      );
      return vscode.Uri.joinPath(root, "plugins", pluginFolderName);
    }
    return vscode.Uri.joinPath(
      workspaceUri,
      ".github",
      "plugins",
      pluginFolderName,
    );
  }

  if (kind === "cursor-rule") {
    if (targetScope === "custom" && options.customTargetUri) {
      return vscode.Uri.joinPath(options.customTargetUri, fileName);
    }
    if (targetScope === "globalHome" || targetScope === "userData") {
      const root = resolveConfiguredUri(
        workspaceUri,
        getConfiguredGlobalHomeDirectory(config),
        DEFAULT_GLOBAL_HOME_DIRECTORY,
      );
      return vscode.Uri.joinPath(root, "rules", fileName);
    }
    return vscode.Uri.joinPath(workspaceUri, ".cursor", "rules", fileName);
  }

  if (targetScope === "custom" && options.customTargetUri) {
    if (kind === "skill") {
      return vscode.Uri.joinPath(
        options.customTargetUri,
        sanitizeResourceInstallName(skill.name),
      );
    }
    if (kind === "hook") {
      if (isHookConfigFile) {
        return vscode.Uri.joinPath(options.customTargetUri, fileName);
      }
      return vscode.Uri.joinPath(
        options.customTargetUri,
        resourceFolderName,
        "README.md",
      );
    }
    return vscode.Uri.joinPath(options.customTargetUri, fileName);
  }

  if (targetScope === "globalHome") {
    const root = resolveConfiguredUri(
      workspaceUri,
      getConfiguredGlobalHomeDirectory(config),
      DEFAULT_GLOBAL_HOME_DIRECTORY,
    );
    switch (kind) {
      case "skill":
        return vscode.Uri.joinPath(
          root,
          "skills",
          sanitizeResourceInstallName(skill.name),
        );
      case "agent":
        return vscode.Uri.joinPath(root, "agents", fileName);
      case "instruction":
        return vscode.Uri.joinPath(root, "instructions", fileName);
      case "prompt":
        return vscode.Uri.joinPath(root, "prompts", fileName);
      case "hook":
        if (isHookConfigFile) {
          return vscode.Uri.joinPath(root, "hooks", fileName);
        }
        return vscode.Uri.joinPath(
          root,
          "hooks",
          resourceFolderName,
          "README.md",
        );
      case "mcp":
        return vscode.Uri.joinPath(root, "mcp", fileName);
      default:
        return vscode.Uri.joinPath(
          root,
          "hooks",
          resourceFolderName,
          "README.md",
        );
    }
  }

  if (targetScope === "userData") {
    const userDataRoot = vscode.Uri.file(
      getVsCodeUserDataPath({ appName: vscode.env.appName }),
    );
    const globalHomeRoot = resolveConfiguredUri(
      workspaceUri,
      getConfiguredGlobalHomeDirectory(config),
      DEFAULT_GLOBAL_HOME_DIRECTORY,
    );

    if (kind === "skill") {
      return vscode.Uri.joinPath(
        vscode.Uri.joinPath(globalHomeRoot, "skills"),
        sanitizeResourceInstallName(skill.name),
      );
    }
    if (kind === "hook") {
      if (isHookConfigFile) {
        return vscode.Uri.joinPath(globalHomeRoot, "hooks", fileName);
      }
      return vscode.Uri.joinPath(
        vscode.Uri.joinPath(globalHomeRoot, "hooks"),
        resourceFolderName,
        "README.md",
      );
    }
    if (kind === "mcp") {
      return vscode.Uri.joinPath(globalHomeRoot, "mcp", fileName);
    }
    switch (kind) {
      case "agent":
        return vscode.Uri.joinPath(
          resolveConfiguredUri(
            workspaceUri,
            getConfiguredUserAgentsDirectory(config) ||
              getConfiguredUserPromptsDirectory(config),
            path.join(userDataRoot.fsPath, "prompts"),
          ),
          fileName,
        );
      case "instruction":
        return vscode.Uri.joinPath(
          resolveConfiguredUri(
            workspaceUri,
            getConfiguredUserInstructionsDirectory(config),
            path.join(userDataRoot.fsPath, "instructions"),
          ),
          fileName,
        );
      case "prompt":
      default:
        return vscode.Uri.joinPath(
          resolveConfiguredUri(
            workspaceUri,
            getConfiguredUserPromptsDirectory(config),
            path.join(userDataRoot.fsPath, "prompts"),
          ),
          fileName,
        );
    }
  }

  if (kind === "skill") {
    const targetRoot = resolveSkillsDirectoryUri(workspaceUri, config);
    return vscode.Uri.joinPath(
      targetRoot,
      sanitizeResourceInstallName(skill.name),
    );
  }

  switch (kind) {
    case "agent":
      return vscode.Uri.joinPath(
        resolveConfiguredUri(
          workspaceUri,
          getConfiguredWorkspaceAgentsDirectory(config),
          ".github/agents",
        ),
        fileName,
      );
    case "instruction":
      return vscode.Uri.joinPath(
        resolveConfiguredUri(
          workspaceUri,
          getConfiguredWorkspaceInstructionsDirectory(config),
          ".github/instructions",
        ),
        fileName,
      );
    case "prompt":
      return vscode.Uri.joinPath(
        resolveConfiguredUri(
          workspaceUri,
          getConfiguredWorkspacePromptsDirectory(config),
          ".github/prompts",
        ),
        fileName,
      );
    case "hook":
      if (isHookConfigFile) {
        return vscode.Uri.joinPath(
          resolveConfiguredUri(
            workspaceUri,
            getConfiguredWorkspaceHooksDirectory(config),
            ".github/hooks",
          ),
          fileName,
        );
      }
      return vscode.Uri.joinPath(
        resolveConfiguredUri(
          workspaceUri,
          getConfiguredWorkspaceHooksDirectory(config),
          ".github/hooks",
        ),
        resourceFolderName,
        "README.md",
      );
    case "mcp":
      return vscode.Uri.joinPath(
        resolveConfiguredUri(
          workspaceUri,
          getConfiguredWorkspaceMcpDirectory(config),
          ".github/mcp",
        ),
        fileName,
      );
    default: {
      const segments = normalizedRemotePath.split("/").filter(Boolean);
      return vscode.Uri.joinPath(workspaceUri, ...segments);
    }
  }
}

/** Keep safety checks bound to the destination selected by the target resolver. */
function getResourceInstallRootUri(targetUri: vscode.Uri): vscode.Uri {
  return getParentDirectoryUri(targetUri);
}

/**
 * 絶対パス指定のアンインストールが触れてよい root。`getResourceTargetUri` が
 * 書き込み先に使う root と、scanner が列挙する root を同じ設定解決で並べる。
 * ここに含まれない絶対パスは、削除対象の親を root にすると必ず通ってしまうため
 * 拒否する。
 */
function getUninstallAllowedRootUris(
  workspaceUri: vscode.Uri,
  config: vscode.WorkspaceConfiguration,
): vscode.Uri[] {
  const userDataUri = vscode.Uri.file(
    getVsCodeUserDataPath({ appName: vscode.env.appName }),
  );

  const roots: vscode.Uri[] = [
    workspaceUri,
    resolveSkillsDirectoryUri(workspaceUri, config),
    resolveConfiguredUri(
      workspaceUri,
      getConfiguredGlobalHomeDirectory(config),
      DEFAULT_GLOBAL_HOME_DIRECTORY,
    ),
    userDataUri,
  ];

  for (const additionalRoot of getConfiguredAdditionalSkillRoots(config)) {
    roots.push(resolveConfiguredUri(workspaceUri, additionalRoot, ""));
  }

  const configuredDirectories: Array<[string | undefined, string]> = [
    [
      getConfiguredUserAgentsDirectory(config),
      path.join(userDataUri.fsPath, "prompts"),
    ],
    [
      getConfiguredUserInstructionsDirectory(config),
      path.join(userDataUri.fsPath, "instructions"),
    ],
    [
      getConfiguredUserPromptsDirectory(config),
      path.join(userDataUri.fsPath, "prompts"),
    ],
    [getConfiguredWorkspaceAgentsDirectory(config), ".github/agents"],
    [getConfiguredWorkspaceHooksDirectory(config), ".github/hooks"],
    [
      getConfiguredWorkspaceInstructionsDirectory(config),
      ".github/instructions",
    ],
    [getConfiguredWorkspaceMcpDirectory(config), ".github/mcp"],
    [getConfiguredWorkspacePromptsDirectory(config), ".github/prompts"],
  ];
  for (const [configuredPath, fallbackPath] of configuredDirectories) {
    roots.push(
      resolveConfiguredUri(workspaceUri, configuredPath, fallbackPath),
    );
  }

  return roots.filter((root) => root.fsPath.length > 0);
}

/**
 * GitHub API でフォルダ内のファイル一覧を取得
 */
async function listGitHubDirectoryInternal(
  owner: string,
  repo: string,
  path: string,
  branch: string = "main",
  token?: string,
  visitedPaths: Set<string> = new Set(),
): Promise<GitHubDirectoryEntry[]> {
  const normalizedPath = path.replace(/^\/+|\/+$/g, "");
  const apiPath = normalizedPath === "." ? "" : normalizedPath;
  if (visitedPaths.has(apiPath)) {
    throw new Error(`Symlink loop detected: ${apiPath}`);
  }
  visitedPaths.add(apiPath);

  const encodedPath = apiPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${branch}`;
  const response = await fetchGitHubWithOptionalAuthRetry(url, {
    accept: "application/vnd.github.v3+json",
    token,
  });
  if (!response.ok) {
    if (
      response.status === 401 ||
      response.status === 403 ||
      response.status === 429
    ) {
      const bodyText = await response
        .clone()
        .text()
        .catch(() => "");
      throw createGitHubResponseError(
        response,
        bodyText,
        `Failed to list directory ${owner}/${repo}/${normalizedPath}`,
      );
    }
    throw new Error(`Failed to list directory: ${response.status}`);
  }
  const data = (await response.json()) as
    | GitHubDirectoryEntry[]
    | GitHubDirectoryEntry;

  if (Array.isArray(data)) {
    return data;
  }

  if (data.type === "symlink" && data.target) {
    const resolvedTarget = resolveSymlinkTargetPath(apiPath, data.target);
    return listGitHubDirectory(
      owner,
      repo,
      resolvedTarget,
      branch,
      token,
      visitedPaths,
    );
  }

  throw new Error(`Path is not a directory: ${apiPath}`);
}

export async function listGitHubDirectory(
  owner: string,
  repo: string,
  path: string,
  branch: string = "main",
  token?: string,
  visitedPaths: Set<string> = new Set(),
): Promise<GitHubDirectoryEntry[]> {
  return await listGitHubDirectoryInternal(
    owner,
    repo,
    path,
    branch,
    token,
    visitedPaths,
  );
}

/**
 * サブディレクトリの最大ダウンロード数
 * 巨大なリポジトリ（例: Fabric の Patterns 240+ディレクトリ）で
 * GitHub API レート制限に当たるのを防止
 * 認証済み(5000回/時)なら余裕、未認証(60回/時)だと厳しいが
 * 未認証の場合はそもそも他の処理でも制限に当たるので300で許容
 */
const MAX_SUBDIRECTORY_DOWNLOADS = 300;

interface DownloadDirectoryResult {
  errors: string[];
  /** Entries the path guard refused; the resource is incomplete without them. */
  rejectedEntries: string[];
}

/**
 * フォルダを再帰的にダウンロード
 * ファイルをディレクトリより先にダウンロードし、
 * サブディレクトリのエラーは個別にキャッチして全体のクラッシュを防止
 */
async function downloadDirectory(
  owner: string,
  repo: string,
  remotePath: string,
  localPath: vscode.Uri,
  branch: string = "main",
  token?: string,
  depth: number = 0,
  downloadRootPath: vscode.Uri = localPath,
): Promise<DownloadDirectoryResult> {
  const errors: string[] = [];
  // A rejected entry means the resource is missing a file the repository ships,
  // so it has to reach the caller instead of looking like a clean install.
  const rejectedEntries: string[] = [];

  // Entry names come from a third-party repository, so one rejected name only
  // skips that entry and leaves the rest of the resource installable.
  const resolveSafeLocalPath = (
    entry: GitHubDirectoryEntry,
  ): vscode.Uri | undefined => {
    // Our own metadata sidecar decides where a later uninstall deletes, so a
    // remote copy is dropped rather than merged into the install. Only the two
    // exact names we write are skipped; other `*.resource-ninja.json` files a
    // repository ships are installed normally.
    if (isOwnMetadataSidecarFileName(entry.name)) {
      logger.warn(
        `[Resource Ninja] Skipped remote metadata sidecar "${entry.name}" from ${owner}/${repo}/${remotePath}`,
      );
      return undefined;
    }

    if (!isSafePathSegment(entry.name)) {
      const msg = `Rejected unsafe entry name "${entry.name}"`;
      logger.warn(
        `[Resource Ninja] Skipped unsafe entry name "${entry.name}" from ${owner}/${repo}/${remotePath}`,
      );
      rejectedEntries.push(msg);
      errors.push(msg);
      return undefined;
    }

    const localFilePath = vscode.Uri.joinPath(localPath, entry.name);
    if (
      !isContainedPath(downloadRootPath.fsPath, localFilePath.fsPath) ||
      !isRealPathStrictlyInside(downloadRootPath.fsPath, localFilePath.fsPath)
    ) {
      const msg = `Rejected entry "${entry.name}": resolves outside ${downloadRootPath.fsPath}`;
      logger.warn(
        `[Resource Ninja] Skipped entry "${entry.name}" from ${owner}/${repo}/${remotePath}: resolves outside ${downloadRootPath.fsPath}`,
      );
      rejectedEntries.push(msg);
      errors.push(msg);
      return undefined;
    }

    return localFilePath;
  };

  const downloadFileEntry = async (
    entry: GitHubDirectoryEntry,
  ): Promise<void> => {
    if (!entry.download_url) {
      return;
    }

    const localFilePath = resolveSafeLocalPath(entry);
    if (!localFilePath) {
      return;
    }

    logger.info(`[Resource Ninja] Downloading file: ${entry.name}`);
    const content = await fetchFileContent(entry.download_url, token);
    assertRealPathStrictlyInside(
      localFilePath,
      downloadRootPath,
      "download write",
    );
    await vscode.workspace.fs.writeFile(
      localFilePath,
      Buffer.from(content, "utf-8"),
    );
  };

  logger.info(
    `[Resource Ninja] Downloading directory: ${owner}/${repo}/${remotePath} (branch: ${branch}, depth: ${depth})`,
  );

  const entries = await listGitHubDirectory(
    owner,
    repo,
    remotePath,
    branch,
    token,
  );
  logger.info(`[Resource Ninja] Found ${entries.length} entries`);

  // ファイルとディレクトリを分離し、ファイルを先にダウンロード
  // （SKILL.md などの重要ファイルを確実に取得するため）
  const { files, directoriesToTraverse } =
    partitionGitHubDirectoryEntries(entries);

  // 1. ファイルを先にダウンロード
  for (const entry of files) {
    try {
      await downloadFileEntry(entry);
    } catch (error) {
      const msg = `Failed to download file ${entry.name}: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(`[Resource Ninja] ${msg}`);
      errors.push(msg);
    }
  }

  // 2. サブディレクトリを再帰的にダウンロード（数の制限あり）
  if (directoriesToTraverse.length > MAX_SUBDIRECTORY_DOWNLOADS) {
    logger.warn(
      `[Resource Ninja] Too many subdirectories (${directoriesToTraverse.length}), limiting to ${MAX_SUBDIRECTORY_DOWNLOADS}`,
    );
    errors.push(
      `Skipped ${directoriesToTraverse.length - MAX_SUBDIRECTORY_DOWNLOADS} of ${directoriesToTraverse.length} subdirectories (limit: ${MAX_SUBDIRECTORY_DOWNLOADS})`,
    );
  }

  const dirsToDownload = directoriesToTraverse.slice(
    0,
    MAX_SUBDIRECTORY_DOWNLOADS,
  );

  for (const entry of dirsToDownload) {
    const localFilePath = resolveSafeLocalPath(entry);
    if (!localFilePath) {
      continue;
    }
    try {
      assertRealPathStrictlyInside(
        localFilePath,
        downloadRootPath,
        "download directory creation",
      );
      await vscode.workspace.fs.createDirectory(localFilePath);
      const subResult = await downloadDirectory(
        owner,
        repo,
        `${remotePath}/${entry.name}`,
        localFilePath,
        branch,
        token,
        depth + 1,
        downloadRootPath,
      );
      errors.push(...subResult.errors);
      rejectedEntries.push(...subResult.rejectedEntries);
    } catch (error) {
      const msg = `Failed to download directory ${entry.name}: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(`[Resource Ninja] ${msg}`);
      errors.push(msg);
      // サブディレクトリのエラーは致命的ではない - 続行
    }
  }

  return { errors, rejectedEntries };
}

/**
 * スキル名をフォルダ名として安全な形式に変換
 */
/**
 * スキルをインストールする
 * GitHub からスキルファイルをダウンロードしてワークスペースに配置
 */
export async function installSkill(
  skill: Skill,
  workspaceUri: vscode.Uri,
  context: vscode.ExtensionContext,
  options: InstallSkillOptions = {},
): Promise<InstallSkillResult> {
  resetGitHubCredentialBlocklist();
  const config = vscode.workspace.getConfiguration("resourceNinja");
  const resourceKind = getResourceKind(skill);
  const skillPath = getResourceTargetUri(workspaceUri, config, skill, options);
  const installRootUri = getResourceInstallRootUri(skillPath);

  assertRealPathStrictlyInside(
    skillPath,
    installRootUri,
    "resource installation",
  );

  if (resourceKind === "skill") {
    await vscode.workspace.fs.createDirectory(skillPath);
  }

  // インデックスからソース情報を取得
  const index = await loadSkillIndex(context);
  const source = findSourceByRepository(skill, index.sources);
  const rawUrlRef = extractContentRefFromRawUrl(skill.rawUrl);
  const githubUrlRef = extractContentRefFromGitHubUrl(skill.url);
  const repositoryRef =
    (source && extractRepositoryRefFromGitHubUrl(source.url)) ||
    rawUrlRef ||
    githubUrlRef ||
    (skill.source.includes("/")
      ? (() => {
          const normalized = normalizeOwnerRepo(skill.source);
          const parts = normalized.split("/");
          if (parts.length !== 2 || !parts[0] || !parts[1]) {
            return undefined;
          }
          return {
            owner: parts[0],
            repo: parts[1],
            repoUrl: `https://github.com/${parts[0]}/${parts[1]}`,
          } satisfies GitHubRepositoryRef;
        })()
      : undefined);

  // GitHub Token を取得
  const token = await getGitHubToken();

  // テンプレートで代替した時点を記録する。後段で frontmatter から再推定しない。
  let usedFallbackTemplate = false;
  // 経路ガードが弾いた entry。SKILL.md が取れていても実体は欠けている。
  const rejectedRemoteEntries: string[] = [];

  if (!repositoryRef) {
    if (resourceKind === "skill") {
      await createFallbackSkillMd(skillPath, skill);
      usedFallbackTemplate = true;
    } else {
      throw new Error(`Source not found for ${resourceKind}: ${skill.source}`);
    }
  } else {
    const owner = repositoryRef.owner;
    const repo = repositoryRef.repo;
    const sourceForBranch =
      source ||
      createSyntheticSource(
        skill,
        repositoryRef,
        rawUrlRef?.branch || githubUrlRef?.branch,
      );
    const branch =
      rawUrlRef?.branch ||
      githubUrlRef?.branch ||
      (await getSourceBranch(
        sourceForBranch,
        token,
        resourceKind === "plugin"
          ? skill.pluginManifestPath || skill.path
          : skill.path,
      ));
    const remotePath =
      resourceKind === "plugin"
        ? skill.pluginRoot ||
          getPluginRootFromManifestPath(
            skill.pluginManifestPath || skill.path,
          ) ||
          skill.path
        : skill.path;

    logger.info(`[Resource Ninja] Installing ${resourceKind}: ${skill.name}`);
    logger.info(
      `[Resource Ninja] Owner: ${owner}, Repo: ${repo}, Branch: ${branch}`,
    );
    if (!source) {
      logger.info(
        `[Resource Ninja] Resolved temporary install source from runtime URL metadata`,
      );
    }
    logger.info(`[Resource Ninja] Remote path: ${remotePath}`);

    if (resourceKind === "plugin") {
      const pluginParentUri = getParentDirectoryUri(skillPath);
      const pluginParentExisted = await uriExists(pluginParentUri);
      const pluginPathExisted = await uriExists(skillPath);
      await vscode.workspace.fs.createDirectory(pluginParentUri);
      await vscode.workspace.fs.createDirectory(skillPath);
      let result: DownloadDirectoryResult;
      try {
        result = await downloadDirectory(
          owner,
          repo,
          remotePath,
          skillPath,
          branch,
          token,
        );
        await writeResourceInstallMetadata(skillPath, skill);
      } catch (error) {
        if (!pluginPathExisted) {
          await deleteResourceInstallMetadata(skillPath, resourceKind);
        }
        await deleteUriIfCreated(
          skillPath,
          pluginPathExisted,
          true,
          installRootUri,
        );
        await deleteDirectoryIfCreatedAndEmpty(
          pluginParentUri,
          pluginParentExisted,
        );
        throw error;
      }
      if (result.errors.length > 0) {
        if (!options.suppressRecoveryPrompt) {
          vscode.window.showWarningMessage(
            isJapanese()
              ? `プラグイン "${skill.name}" の一部のファイルがダウンロードできませんでした。コピーされた内容を確認してください。`
              : `Some files for plugin "${skill.name}" could not be downloaded. Review the copied contents before activation.`,
          );
        }
        return { destinationUri: skillPath, errors: result.errors };
      }
      return { destinationUri: skillPath };
    }

    if (resourceKind !== "skill") {
      const resourceParentUri = getParentDirectoryUri(skillPath);
      const resourceParentExisted = await uriExists(resourceParentUri);
      const resourcePathExisted = await uriExists(skillPath);
      await vscode.workspace.fs.createDirectory(resourceParentUri);
      try {
        const isHookConfigFile =
          resourceKind === "hook" && isHookConfigFilePath(remotePath);
        if (resourceKind === "hook" && !isHookConfigFile) {
          const remoteDir = remotePath.split("/").slice(0, -1).join("/");
          await downloadDirectory(
            owner,
            repo,
            remoteDir,
            resourceParentUri,
            branch,
            token,
          );
        } else {
          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${remotePath}`;
          const content = await fetchFileContent(rawUrl, token);
          assertRealPathStrictlyInside(
            skillPath,
            installRootUri,
            "resource write",
          );
          await vscode.workspace.fs.writeFile(
            skillPath,
            Buffer.from(content, "utf-8"),
          );
        }
        await writeResourceInstallMetadata(skillPath, skill);
        await removeOwnedLegacyPluginResource(skillPath, skill);
      } catch (error) {
        if (!resourcePathExisted) {
          await deleteResourceInstallMetadata(skillPath, resourceKind);
        }
        await deleteUriIfCreated(
          skillPath,
          resourcePathExisted,
          false,
          resourceParentUri,
        );
        await deleteDirectoryIfCreatedAndEmpty(
          resourceParentUri,
          resourceParentExisted,
        );
        throw error;
      }
      if (resourceKind === "hook" && !isHookConfigFilePath(remotePath)) {
        const hookConfigRootUri = getHookConfigRootUri(
          workspaceUri,
          config,
          skillPath,
          options,
        );
        const hookConfigUpdate = await updateHookConfigForInstall(
          hookConfigRootUri,
          skillPath,
        );
        return { destinationUri: skillPath, hookConfigUpdate };
      }
      if (
        resourceKind === "mcp" &&
        options.mcpInstallMode === "mergeIntoWorkspace"
      ) {
        const mcpConfigUpdate = await updateMcpConfigForInstall(
          workspaceUri,
          skillPath,
          {
            confirmOverwrite: options.confirmMcpServerOverwrite,
          },
        );
        return { destinationUri: skillPath, mcpConfigUpdate };
      }
      return { destinationUri: skillPath };
    }

    // パスが .md で終わる場合は単独ファイル
    if (remotePath.endsWith(".md")) {
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${remotePath}`;
      logger.info(`[Resource Ninja] Downloading single file: ${rawUrl}`);
      try {
        const content = await fetchFileContent(rawUrl, token);
        logger.info(`[Resource Ninja] Downloaded ${content.length} bytes`);

        // SKILL.md として保存（メインファイル）
        const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");
        await vscode.workspace.fs.writeFile(
          skillMdPath,
          Buffer.from(content, "utf-8"),
        );
        logger.info(`[Resource Ninja] Saved as SKILL.md`);
      } catch (error) {
        logger.error(`[Resource Ninja] Failed to download ${rawUrl}:`, error);
        const errorMsg = error instanceof Error ? error.message : String(error);

        // 404エラーの場合はインストールをキャンセル（フォールバック作らない）
        if (errorMsg.includes("404")) {
          await handleSkillNotFound(
            skillPath,
            installRootUri,
            skill,
            sourceForBranch,
            rawUrl,
            token,
            Boolean(options.suppressRecoveryPrompt),
          );
        }

        // その他のエラーはフォールバック版を作成
        if (!options.suppressRecoveryPrompt) {
          vscode.window.showWarningMessage(
            isJapanese()
              ? `スキル "${skill.name}" のダウンロードに失敗しました。フォールバック版を作成します。\nエラー: ${errorMsg}`
              : `Failed to download skill "${skill.name}". Creating fallback version.\nError: ${errorMsg}`,
          );
        }
        await createFallbackSkillMd(skillPath, skill);
        usedFallbackTemplate = true;
      }
    } else {
      // フォルダ全体をダウンロード
      try {
        const result = await downloadDirectory(
          owner,
          repo,
          remotePath,
          skillPath,
          branch,
          token,
        );
        rejectedRemoteEntries.push(...result.rejectedEntries);

        // SKILL.md がなければ作成
        try {
          await vscode.workspace.fs.stat(
            vscode.Uri.joinPath(skillPath, "SKILL.md"),
          );
        } catch {
          // directory listing は成功したが SKILL.md が取れていない場合、
          // template で上書きする前に raw URL から実体の復旧を試みる。
          const recovered = await recoverPrimarySkillMdFromRaw(
            skillPath,
            owner,
            repo,
            branch,
            remotePath,
            token,
          );
          if (!recovered) {
            await createFallbackSkillMd(skillPath, skill);
            usedFallbackTemplate = true;
          }
        }

        // サブディレクトリで部分的なエラーがあった場合は通知
        if (result.errors.length > 0) {
          logger.warn(
            `[Resource Ninja] Partial errors during download:`,
            result.errors,
          );
          // SKILL.md が正常にダウンロードされていれば警告のみ
          const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");
          try {
            const stat = await vscode.workspace.fs.stat(skillMdPath);
            if (stat.size > 100) {
              if (!options.suppressRecoveryPrompt) {
                vscode.window.showWarningMessage(
                  isJapanese()
                    ? `スキル "${skill.name}" の一部のファイルがダウンロードできませんでした。SKILL.md は正常にインストールされています。`
                    : `Some files for skill "${skill.name}" could not be downloaded. SKILL.md was installed successfully.`,
                );
              }
            }
          } catch {
            // SKILL.md 自体がない場合はフォールバック（上で処理済み）
          }
        }
      } catch (error) {
        logger.error(`[Resource Ninja] Failed to download directory:`, error);
        const errorMsg = error instanceof Error ? error.message : String(error);

        // 404エラーの場合はインストールをキャンセル（フォールバック作らない）
        if (errorMsg.includes("404")) {
          const repoTreeUrl = `https://github.com/${owner}/${repo}/tree/${branch}/${remotePath}`;
          await handleSkillNotFound(
            skillPath,
            installRootUri,
            skill,
            sourceForBranch,
            repoTreeUrl,
            token,
            Boolean(options.suppressRecoveryPrompt),
          );
        }

        // Don't overwrite SKILL.md with fallback if it was already downloaded
        const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");
        let skillMdExists = false;
        try {
          const stat = await vscode.workspace.fs.stat(skillMdPath);
          // Consider valid if > 100 bytes
          skillMdExists = stat.size > 100;
        } catch {
          // File does not exist
        }
        if (!skillMdExists) {
          // listing が失敗（403 等の非 404）で SKILL.md が無い場合、
          // template で上書きする前に raw URL から実体の復旧を試みる。
          const recovered = await recoverPrimarySkillMdFromRaw(
            skillPath,
            owner,
            repo,
            branch,
            remotePath,
            token,
          );
          if (!recovered) {
            await createFallbackSkillMd(skillPath, skill);
            usedFallbackTemplate = true;
          }
        } else {
          logger.info(
            `[Resource Ninja] SKILL.md already exists, skipping fallback creation`,
          );
          // Notify user that some subdirectory files may be missing
          if (!options.suppressRecoveryPrompt) {
            vscode.window.showWarningMessage(
              isJapanese()
                ? `スキル "${skill.name}" の一部のファイルがダウンロードできませんでした。SKILL.md は正常にインストールされています。`
                : `Some files for skill "${skill.name}" could not be downloaded. SKILL.md was installed successfully.`,
            );
          }
        }
      }
    }
  }

  // メタデータを保存（description などを後で取得できるように）
  // 英語環境の場合はSKILL.mdからdescriptionを抽出（インデックスは日本語のため）
  let description = skill.description;
  if (!isJapanese()) {
    const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");
    const extractedDesc = await extractDescriptionFromSkillMd(skillMdPath);
    if (extractedDesc) {
      description = extractedDesc;
    }
  }

  // "When to Use" セクションを抽出
  const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");
  const whenToUse = await extractWhenToUseFromSkillMd(skillMdPath);

  // ここへ到達するのは resourceKind === "skill" だけ。
  // hook / mcp / plugin は上で早期 return しており、その戻り値は失われない。
  const incomplete =
    usedFallbackTemplate ||
    rejectedRemoteEntries.length > 0 ||
    (await isSkillContentIncomplete(skillMdPath));

  const metaPath = vscode.Uri.joinPath(skillPath, ".skill-meta.json");
  const existingMeta = await readSkillMetaIfExists(metaPath);
  const meta: SkillMeta = mergeSkillMeta(existingMeta, {
    name: skill.name,
    source: normalizeSkillMetaSource({
      source: skill.source,
      remotePath: skill.path,
    }),
    description: description,
    description_ja: skill.description_ja,
    whenToUse: whenToUse || undefined,
    customWhenToUse: existingMeta?.customWhenToUse,
    categories: skill.categories,
    remotePath: skill.path,
    installedAt: new Date().toISOString(),
    // 正常に入れ直せたら undefined になり、JSON からフラグごと消える。
    incomplete: incomplete ? true : undefined,
  });
  await vscode.workspace.fs.writeFile(
    metaPath,
    Buffer.from(JSON.stringify(meta, null, 2), "utf-8"),
  );

  if (!incomplete) {
    return { destinationUri: skillPath };
  }

  if (!options.suppressRecoveryPrompt) {
    const choice = await promptIncompleteSkillInstall(skillPath, skill, source);
    if (choice === "reinstall") {
      // 部分ダウンロードの残骸を持ち越さないよう、Reinstall コマンドと同じく消してから入れ直す。
      // 削除に失敗したら半削除の上へ書かず、不完全のまま失敗を返す。
      if (await deleteIncompleteSkillDirectory(skillPath, installRootUri)) {
        // 再試行では prompt を抑制するので、失敗しても再帰的にダイアログが出ない。
        return await installSkill(skill, workspaceUri, context, {
          ...options,
          suppressRecoveryPrompt: true,
        });
      }
    }
    if (choice === "delete") {
      await deleteIncompleteSkillDirectory(skillPath, installRootUri);
    }
  }

  throw new SkillInstallIncompleteError(skill.name, skillPath.fsPath);
}

/** SKILL.md が無い、または実体と呼べない小ささなら不完全とみなす。 */
async function isSkillContentIncomplete(
  skillMdPath: vscode.Uri,
): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(skillMdPath);
    return stat.size < 50;
  } catch {
    return true;
  }
}

async function deleteIncompleteSkillDirectory(
  skillPath: vscode.Uri,
  allowedRootUri: vscode.Uri,
): Promise<boolean> {
  if (
    !isDeleteTargetAllowed(skillPath, allowedRootUri, "incomplete skill delete")
  ) {
    return false;
  }
  try {
    await vscode.workspace.fs.delete(skillPath, { recursive: true });
    return true;
  } catch (error) {
    logger.error(
      `[Resource Ninja] Failed to delete incomplete skill at ${skillPath.fsPath}:`,
      error,
    );
    return false;
  }
}

/**
 * 不完全なインストールをユーザーへ提示し、選んだ復旧手段を返す。
 */
async function promptIncompleteSkillInstall(
  skillPath: vscode.Uri,
  skill: Skill,
  source?: Source,
): Promise<"reinstall" | "delete" | undefined> {
  logger.warn(
    `[Resource Ninja] Resource "${skill.name}" appears to be a fallback or empty`,
  );

  const reinstall = isJapanese() ? "再インストール" : "Reinstall";
  const updateIndex = isJapanese() ? "インデックス更新" : "Update Index";
  const reportBug = isJapanese() ? "バグ報告" : "Report Bug";
  const remove = isJapanese() ? "削除" : "Delete";

  const choice = await vscode.window.showWarningMessage(
    isJapanese()
      ? `スキル "${skill.name}" のインストールに失敗しました。\nSKILL.md の内容が不完全です。`
      : `Skill "${skill.name}" was not installed correctly.\nSKILL.md content is incomplete.`,
    reinstall,
    updateIndex,
    reportBug,
    remove,
  );

  if (choice === reinstall) {
    return "reinstall";
  }
  if (choice === remove) {
    return "delete";
  }
  if (choice === updateIndex) {
    await vscode.commands.executeCommand("resourceNinja.updateSourceIndex", {
      source: source,
    });
    return undefined;
  }
  if (choice === reportBug) {
    await reportIncompleteSkillInstall(skillPath, skill, source);
  }
  return undefined;
}

async function reportIncompleteSkillInstall(
  skillPath: vscode.Uri,
  skill: Skill,
  source?: Source,
): Promise<void> {
  const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");
  let text = "";
  try {
    const content = await vscode.workspace.fs.readFile(skillMdPath);
    text = Buffer.from(content).toString("utf-8");
  } catch {
    text = "(SKILL.md not found)";
  }

  const extensionVersion =
    vscode.extensions.getExtension("yamapan.agent-resources-ninja")?.packageJSON
      ?.version || "unknown";
  const repoUrl = source?.url || "unknown";
  const branch = source?.branch || "default";

  const issueTitle = `[Bug] Skill install incomplete: ${skill.name}`;
  const issueBody =
    `**Issue**\n` +
    `Skill "${skill.name}" from source "${skill.source}" was not installed correctly.\n\n` +
    `**Expected**\n` +
    `SKILL.md should contain the full skill content.\n\n` +
    `**Actual**\n` +
    `SKILL.md contains only fallback/template content (${text.length} bytes).\n\n` +
    `**Skill Details**\n` +
    `- Name: ${skill.name}\n` +
    `- Source ID: ${skill.source}\n` +
    `- Path: ${skill.path || "unknown"}\n` +
    `- Repository: ${repoUrl}\n` +
    `- Branch: ${branch}\n\n` +
    `**Environment**\n` +
    `- Extension Version: ${extensionVersion}\n` +
    `- VS Code: ${vscode.version}\n` +
    `- OS: ${process.platform}\n\n` +
    `**SKILL.md Content (first 200 chars)**\n` +
    `\`\`\`\n${text.substring(0, 200)}\n\`\`\``;

  await openBugReportIssue(issueTitle, issueBody);
}

/**
 * Drops the registered locations the deleted resource paths lived under. The
 * keys come from the real setting, so a `custom` install target is cleaned up
 * and an entry unrelated to the deletion is left alone.
 *
 * Lives here rather than in `extension.ts` so every path that removes a plugin
 * folder can call the same implementation.
 */
export async function unregisterPluginLocations(
  deletedFsPaths: string[],
  pluginFolderName: string,
): Promise<void> {
  if (deletedFsPaths.length === 0) {
    return;
  }
  // Same guard as registration: a build without the setting has nothing to
  // clean up, and writing it would only raise an error.
  if (!supportsPluginLocations(vscode.version)) {
    logger.info(
      `[Resource Ninja] ${messages.pluginLocationUnsupportedVersion(vscode.version)}`,
    );
    return;
  }
  try {
    const chatConfig = vscode.workspace.getConfiguration("chat");
    const existing = chatConfig.get<Record<string, boolean>>("pluginLocations");
    const keys = collectPluginLocationKeysForRemoval(
      existing,
      deletedFsPaths,
      pluginFolderName,
      isContainedPath,
    );
    if (keys.length === 0) {
      return;
    }
    await chatConfig.update(
      "pluginLocations",
      removePluginLocations(existing, keys),
      vscode.ConfigurationTarget.Global,
    );
    logger.info(
      `[Resource Ninja] Removed plugin locations: ${keys.join(", ")}`,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      `[Resource Ninja] Failed to remove plugin locations: ${errorMessage}`,
    );
    vscode.window.showErrorMessage(
      messages.pluginLocationRegisterFailed(errorMessage),
    );
  }
}

/**
 * スキルをアンインストールする
 */
export async function uninstallSkill(
  skillName: string,
  workspaceUri: vscode.Uri,
): Promise<UninstallSkillResult> {
  const config = vscode.workspace.getConfiguration("resourceNinja");
  const skillsRootUri = resolveSkillsDirectoryUri(workspaceUri, config);

  // まずそのままの名前で試す（既存の互換性）
  let skillPath = vscode.Uri.joinPath(skillsRootUri, skillName);

  try {
    await vscode.workspace.fs.stat(skillPath);
  } catch {
    // 存在しない場合はサニタイズした名前で試す
    const safeName = sanitizeResourceInstallName(skillName);
    skillPath = vscode.Uri.joinPath(skillsRootUri, safeName);
  }

  try {
    if (!isDeleteTargetAllowed(skillPath, skillsRootUri, "skill uninstall")) {
      throw new Error(
        `Refused to delete ${skillPath.fsPath} outside ${skillsRootUri.fsPath}`,
      );
    }
    await vscode.workspace.fs.delete(skillPath, {
      recursive: true,
      useTrash: true,
    });
  } catch (error) {
    throw new Error(`Failed to delete skill directory: ${error}`);
  }
  // The skills root is a configurable path, so this recursive delete can take a
  // plugin folder with it. The helper only removes keys the setting actually
  // holds, so a plain skill delete removes nothing.
  await unregisterPluginLocations(
    [skillPath.fsPath],
    path.basename(skillPath.fsPath),
  );
  return {};
}

/**
 * 相対パスからスキルフォルダを削除
 * SKILL.md の相対パスから親フォルダを特定して削除
 */
export async function uninstallSkillByPath(
  relativePath: string,
  workspaceUri: vscode.Uri,
): Promise<UninstallSkillResult> {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  const kind = detectResourceKindFromPath(normalizedPath) || "skill";
  const isAbsoluteResourcePath = path.isAbsolute(relativePath);
  const isHookConfigFile =
    kind === "hook" && isHookConfigFilePath(normalizedPath);

  let skillPath: vscode.Uri;
  // The root each branch joined against; a `..` segment in relativePath would
  // otherwise let the join escape it.
  let deleteRootUri: vscode.Uri;
  // A plugin is scanned by its manifest, but the installed unit is the whole folder.
  let pluginRootFsPath: string | undefined;
  if (isAbsoluteResourcePath) {
    const absoluteUri = vscode.Uri.file(path.normalize(relativePath));
    pluginRootFsPath =
      kind === "plugin"
        ? getPluginRootFsPathFromManifestPath(absoluteUri.fsPath)
        : undefined;
    skillPath = pluginRootFsPath
      ? vscode.Uri.file(pluginRootFsPath)
      : kind === "skill" || (kind === "hook" && !isHookConfigFile)
        ? getParentDirectoryUri(absoluteUri)
        : absoluteUri;
    // The absolute path can come from `.skill-meta.json`, so it is bounded by
    // the roots this extension installs into, not by the target's own parent.
    const config = vscode.workspace.getConfiguration("resourceNinja");
    const allowedRoots = getUninstallAllowedRootUris(workspaceUri, config);
    deleteRootUri =
      allowedRoots.find((root) =>
        isContainedPath(root.fsPath, skillPath.fsPath),
      ) ?? workspaceUri;
  } else if (kind === "skill") {
    const folderPath = normalizedPath.replace(/\/SKILL\.md$/i, "");
    const config = vscode.workspace.getConfiguration("resourceNinja");
    const skillsRootRelative = String(
      getRelativeSkillsPathForWorkspace(getConfiguredSkillsDirectory(config)),
    )
      .replace(/\\/g, "/")
      .replace(/^\/+|\/+$/g, "");
    const skillsRootUri = resolveSkillsDirectoryUri(workspaceUri, config);
    if (
      folderPath === skillsRootRelative ||
      folderPath.startsWith(`${skillsRootRelative}/`)
    ) {
      skillPath = vscode.Uri.joinPath(
        workspaceUri,
        ...folderPath.split("/").filter(Boolean),
      );
      deleteRootUri = workspaceUri;
    } else {
      skillPath = vscode.Uri.joinPath(
        skillsRootUri,
        ...folderPath.split("/").filter(Boolean),
      );
      deleteRootUri = skillsRootUri;
    }
  } else if (kind === "hook") {
    const hookFile = vscode.Uri.joinPath(
      workspaceUri,
      ...normalizedPath.split("/").filter(Boolean),
    );
    skillPath = isHookConfigFile ? hookFile : getParentDirectoryUri(hookFile);
    deleteRootUri = workspaceUri;
  } else {
    const resourceUri = vscode.Uri.joinPath(
      workspaceUri,
      ...normalizedPath.split("/").filter(Boolean),
    );
    pluginRootFsPath =
      kind === "plugin"
        ? getPluginRootFsPathFromManifestPath(resourceUri.fsPath)
        : undefined;
    skillPath = pluginRootFsPath
      ? vscode.Uri.file(pluginRootFsPath)
      : resourceUri;
    deleteRootUri = workspaceUri;
  }

  let hookConfigUpdate: HookConfigUpdateResult | undefined;
  try {
    if (kind === "hook" && !isHookConfigFile) {
      const hookReadmeUri = isAbsoluteResourcePath
        ? vscode.Uri.file(path.normalize(relativePath))
        : vscode.Uri.joinPath(
            workspaceUri,
            ...normalizedPath.split("/").filter(Boolean),
          );
      hookConfigUpdate = await updateHookConfigForUninstall(
        workspaceUri,
        hookReadmeUri,
      );
    }

    if (
      !isDeleteTargetAllowed(skillPath, deleteRootUri, "resource uninstall")
    ) {
      throw new Error(
        `Refused to delete ${skillPath.fsPath} outside ${deleteRootUri.fsPath}`,
      );
    }
    await vscode.workspace.fs.delete(skillPath, {
      recursive: true,
      useTrash: true,
    });
    if (pluginRootFsPath) {
      await unregisterPluginLocations(
        [skillPath.fsPath],
        path.basename(pluginRootFsPath),
      );
    }
    if (kind !== "skill" && !pluginRootFsPath) {
      const resourceUri = isAbsoluteResourcePath
        ? vscode.Uri.file(path.normalize(relativePath))
        : vscode.Uri.joinPath(
            workspaceUri,
            ...normalizedPath.split("/").filter(Boolean),
          );
      await deleteResourceInstallMetadata(resourceUri, kind);
    }
    return { hookConfigUpdate };
  } catch (error) {
    let errorMessage = String(error);
    if (hookConfigUpdate?.changed) {
      const restored = await restoreHookConfigFromBackup(hookConfigUpdate);
      if (restored) {
        errorMessage = `${errorMessage} hooks.json was restored from backup.`;
      }
    }
    throw new Error(`Failed to delete installed resource: ${errorMessage}`);
  }
}

/**
 * インストール済みスキルの一覧を取得
 */
export async function getInstalledSkills(
  workspaceUri: vscode.Uri,
): Promise<string[]> {
  const config = vscode.workspace.getConfiguration("resourceNinja");
  const skillsPath = resolveSkillsDirectoryUri(workspaceUri, config);

  try {
    try {
      await vscode.workspace.fs.stat(skillsPath);
    } catch {
      return [];
    }

    const entries = await vscode.workspace.fs.readDirectory(skillsPath);
    // ディレクトリのみを返す
    return entries
      .filter(([, type]) => type === vscode.FileType.Directory)
      .map(([name]) => name);
  } catch {
    // ディレクトリが存在しない場合は空配列
    return [];
  }
}

/**
 * スキルのメタデータ
 */
export interface SkillMeta {
  name: string;
  source: string;
  description: string;
  description_ja?: string;
  whenToUse?: string; // SKILL.md の "When to Use" セクションから抽出
  customWhenToUse?: string; // ユーザーがカスタマイズした説明（最優先）
  registrationDisabled?: boolean; // skill-only sibling extension と共有する登録状態フラグ
  incomplete?: boolean; // SKILL.md がテンプレートのみ、または実体を欠いた状態
  categories: string[];
  installedAt: string;
  relativePath?: string; // ネストされたスキルのパス（例: "document-skills/docx"）
  remotePath?: string; // skill-only sibling extension と共有する配布元相対パス。cross-extension index matching の契約フィールド
  // 公式仕様に基づくメタデータ
  license?: string; // ライセンス（例: MIT, Apache-2.0）
  author?: string; // 作成者
  version?: string; // バージョン
  skillFilePath?: string; // SKILL.md の実パス
  [key: string]: unknown;
}

const RETIRED_SOURCE_ALIASES: Readonly<Record<string, string>> = {
  "microsoft-copilot-for-azure-plugin": "microsoft-azure-skills",
};

export function normalizeSkillMetaSource(
  meta: Pick<Partial<SkillMeta>, "source" | "remotePath">,
): string {
  const source = meta.source?.trim();
  const remotePath = meta.remotePath
    ?.replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");

  if (!remotePath && (!source || source === "unknown")) {
    return "local";
  }

  return (source && RETIRED_SOURCE_ALIASES[source]) || source || "unknown";
}

/**
 * ディレクトリ内のスキルを再帰的にスキャン
 * SKILL.md を持つフォルダをスキルとして検出
 * サブフォルダに SKILL.md がある場合は個別のスキルとして扱う
 */
async function scanSkillsRecursively(
  basePath: vscode.Uri,
  currentPath: vscode.Uri,
  relativePath: string,
  results: Array<{
    folderName: string;
    relativePath: string;
    metaPath: vscode.Uri;
    skillMdPath: vscode.Uri;
  }>,
  depth: number = 0,
): Promise<void> {
  // 最大深度を制限（無限ループ防止）
  if (depth > 3) return;

  try {
    try {
      await vscode.workspace.fs.stat(currentPath);
    } catch {
      return;
    }

    const entries = await vscode.workspace.fs.readDirectory(currentPath);
    const dirs = entries.filter(
      ([, type]) => type === vscode.FileType.Directory,
    );

    for (const [folderName] of dirs) {
      // 隠しフォルダはスキップ
      if (folderName.startsWith(".")) continue;

      const subPath = vscode.Uri.joinPath(currentPath, folderName);
      const skillMdPath = vscode.Uri.joinPath(subPath, "SKILL.md");
      const metaPath = vscode.Uri.joinPath(subPath, ".skill-meta.json");
      const subRelativePath = relativePath
        ? `${relativePath}/${folderName}`
        : folderName;

      // SKILL.md が存在するか確認
      let hasSkillMd = false;
      try {
        await vscode.workspace.fs.stat(skillMdPath);
        hasSkillMd = true;
      } catch {
        // SKILL.md がない
      }

      if (hasSkillMd) {
        // このフォルダはスキル
        results.push({
          folderName,
          relativePath: subRelativePath,
          metaPath,
          skillMdPath,
        });
      }

      // サブフォルダも再帰的にスキャン
      await scanSkillsRecursively(
        basePath,
        subPath,
        subRelativePath,
        results,
        depth + 1,
      );
    }
  } catch {
    // ディレクトリ読み取りエラー
  }
}

/**
 * インストール済みスキルのメタデータを再抽出（アップデート時用）
 * SKILL.md から description と whenToUse を再抽出してメタデータファイルを更新
 */
export async function refreshSkillMetadata(
  workspaceUri: vscode.Uri,
): Promise<number> {
  const config = vscode.workspace.getConfiguration("resourceNinja");
  const skillsPath = resolveSkillsDirectoryUri(workspaceUri, config);

  let updatedCount = 0;

  try {
    try {
      await vscode.workspace.fs.stat(skillsPath);
    } catch {
      return 0;
    }

    const entries = await vscode.workspace.fs.readDirectory(skillsPath);
    const dirs = entries.filter(
      ([, type]) => type === vscode.FileType.Directory,
    );

    for (const [folderName] of dirs) {
      const metaPath = vscode.Uri.joinPath(
        skillsPath,
        folderName,
        ".skill-meta.json",
      );
      const skillMdPath = vscode.Uri.joinPath(
        skillsPath,
        folderName,
        "SKILL.md",
      );

      try {
        // 既存のメタデータを読み込む
        const content = await vscode.workspace.fs.readFile(metaPath);
        const meta = JSON.parse(Buffer.from(content).toString("utf-8"));
        const normalizedSource = normalizeSkillMetaSource(meta);

        // The sidecar can arrive from a third-party repository, so a path found
        // inside it is dropped instead of being written back.
        let updated = stripSkillMetaLocalPaths(meta);

        // SKILL.md から description と whenToUse を再抽出
        const newDescription = await extractDescriptionFromSkillMd(skillMdPath);
        const newWhenToUse = await extractWhenToUseFromSkillMd(skillMdPath);

        // description が変更された場合
        if (newDescription && meta.description !== newDescription) {
          meta.description = newDescription;
          updated = true;
        }

        // whenToUse が変更された場合
        // （customWhenToUse がある場合は whenToUse のみ更新、ユーザーのカスタム値は保持）
        if (meta.whenToUse !== newWhenToUse) {
          meta.whenToUse = newWhenToUse || undefined;
          updated = true;
        }

        if (meta.source !== normalizedSource) {
          meta.source = normalizedSource;
          updated = true;
        }

        if (updated) {
          // メタデータを保存
          await vscode.workspace.fs.writeFile(
            metaPath,
            Buffer.from(JSON.stringify(meta, null, 2), "utf-8"),
          );
          updatedCount++;
          logger.info(`[Resource Ninja] Refreshed metadata for ${folderName}`);
        }
      } catch {
        // メタデータがない場合は新規作成
        try {
          const { name, description } =
            await extractNameAndDescriptionFromSkillMd(skillMdPath, folderName);
          const whenToUse = await extractWhenToUseFromSkillMd(skillMdPath);

          const newMeta: SkillMeta = {
            name,
            source: normalizeSkillMetaSource({}),
            description,
            whenToUse: whenToUse || undefined,
            categories: [],
            installedAt: new Date().toISOString(),
          };

          await vscode.workspace.fs.writeFile(
            metaPath,
            Buffer.from(JSON.stringify(newMeta, null, 2), "utf-8"),
          );
          updatedCount++;
          logger.info(
            `[Resource Ninja] Created metadata for ${folderName}: ${whenToUse}`,
          );
        } catch {
          // SKILL.md もない場合はスキップ
        }
      }
    }
  } catch {
    // skills ディレクトリがない場合は何もしない
  }

  return updatedCount;
}

/**
 * 単一スキルのメタデータを SKILL.md から再抽出して更新
 * @param skillMdUri SKILL.md ファイルの URI
 * @returns 更新されたかどうか
 */
export async function refreshSingleSkillMetadata(
  skillMdUri: vscode.Uri,
): Promise<boolean> {
  // SKILL.md の親ディレクトリ（スキルフォルダ）を取得
  const skillPath = vscode.Uri.joinPath(skillMdUri, "..");
  const metaPath = vscode.Uri.joinPath(skillPath, ".skill-meta.json");

  try {
    // 既存のメタデータを読み込む
    const content = await vscode.workspace.fs.readFile(metaPath);
    const meta = JSON.parse(Buffer.from(content).toString("utf-8"));

    // The sidecar can arrive from a third-party repository, so a path found
    // inside it is dropped instead of being written back.
    let updated = stripSkillMetaLocalPaths(meta);

    // SKILL.md から description と whenToUse を再抽出
    const newDescription = await extractDescriptionFromSkillMd(skillMdUri);
    const newWhenToUse = await extractWhenToUseFromSkillMd(skillMdUri);
    const normalizedSource = normalizeSkillMetaSource(meta);

    // description が変更された場合
    if (newDescription && meta.description !== newDescription) {
      meta.description = newDescription;
      updated = true;
    }

    // whenToUse が変更された場合
    if (meta.whenToUse !== newWhenToUse) {
      meta.whenToUse = newWhenToUse || undefined;
      updated = true;
    }

    if (meta.source !== normalizedSource) {
      meta.source = normalizedSource;
      updated = true;
    }

    if (updated) {
      await vscode.workspace.fs.writeFile(
        metaPath,
        Buffer.from(JSON.stringify(meta, null, 2), "utf-8"),
      );
      logger.info(
        `[Resource Ninja] Updated metadata from SKILL.md: ${skillMdUri.fsPath}`,
      );
      return true;
    }

    return false;
  } catch {
    // メタデータがない場合は何もしない（インストールされていないスキル）
    return false;
  }
}

/**
 * インストール済みスキルのメタデータを取得
 * サブフォルダも再帰的にスキャンしてネストされたスキルも検出
 */
export async function getInstalledSkillsWithMeta(
  workspaceUri: vscode.Uri,
): Promise<SkillMeta[]> {
  const config = vscode.workspace.getConfiguration("resourceNinja");
  const skillsPath = resolveSkillsDirectoryUri(workspaceUri, config);

  return getInstalledSkillsWithMetaFromRoot(skillsPath);
}

export async function getInstalledSkillsWithMetaFromRoot(
  skillsPath: vscode.Uri,
): Promise<SkillMeta[]> {
  try {
    try {
      await vscode.workspace.fs.stat(skillsPath);
    } catch {
      return [];
    }

    // 再帰的にスキルをスキャン
    const skillEntries: Array<{
      folderName: string;
      relativePath: string;
      metaPath: vscode.Uri;
      skillMdPath: vscode.Uri;
    }> = [];
    await scanSkillsRecursively(skillsPath, skillsPath, "", skillEntries);

    const metas: SkillMeta[] = [];
    for (const entry of skillEntries) {
      try {
        const content = await vscode.workspace.fs.readFile(entry.metaPath);
        const meta = JSON.parse(Buffer.from(content).toString("utf-8"));
        meta.source = normalizeSkillMetaSource(meta);
        // The sidecar can arrive from a third-party repository, so its path
        // fields are replaced by where this scan actually found the resource.
        stripSkillMetaLocalPaths(meta);
        meta.relativePath = entry.relativePath;
        meta.skillFilePath = entry.skillMdPath.fsPath;
        metas.push(meta);
      } catch {
        // メタデータがない場合は SKILL.md から name と description を読み取る
        const { name, description, license, author, version } =
          await extractMetadataFromSkillMd(entry.skillMdPath, entry.folderName);
        // When to Use セクションも抽出
        const whenToUse = await extractWhenToUseFromSkillMd(entry.skillMdPath);
        metas.push({
          name,
          source: normalizeSkillMetaSource({}),
          description,
          whenToUse: whenToUse || undefined,
          categories: [],
          installedAt: "",
          relativePath: entry.relativePath,
          license,
          author,
          version,
          skillFilePath: entry.skillMdPath.fsPath,
        });
      }
    }
    return metas;
  } catch {
    return [];
  }
}

/**
 * SKILL.md ファイルから name と description を抽出する
 * frontmatter の name, description フィールドを読み取る
 * frontmatter がない場合は # ヘッダーから name を抽出
 */
async function extractNameAndDescriptionFromSkillMd(
  skillMdUri: vscode.Uri,
  fallbackName: string,
): Promise<{ name: string; description: string }> {
  try {
    const content = await vscode.workspace.fs.readFile(skillMdUri);
    const text = Buffer.from(content).toString("utf-8");
    const normalizedText = normalizeNewlines(text);

    // frontmatter を解析
    const frontmatterMatch = normalizedText.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];

      // name フィールドを抽出
      let name = fallbackName;
      const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
      if (nameMatch) {
        name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
      }

      // description を抽出
      const description = extractDescriptionFromFrontmatter(frontmatter);

      return { name, description };
    }

    // frontmatter がない場合は # ヘッダーから name を抽出
    const headerMatch = normalizedText.match(/^#\s+(.+)$/m);
    if (headerMatch) {
      const name = headerMatch[1].trim();
      // 2行目以降で説明文を探す（空行を除く）
      const lines = normalizedText.split("\n").slice(1);
      let description = "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (
          trimmed &&
          !trimmed.startsWith("#") &&
          !trimmed.startsWith("Source:")
        ) {
          description = trimmed;
          break;
        }
      }
      return { name, description };
    }

    return { name: fallbackName, description: "" };
  } catch {
    return { name: fallbackName, description: "" };
  }
}

/**
 * SKILL.md ファイルからメタデータを抽出する
 * frontmatter の name, description, license, metadata.author, metadata.version を読み取る
 */
async function extractMetadataFromSkillMd(
  skillMdUri: vscode.Uri,
  fallbackName: string,
): Promise<{
  name: string;
  description: string;
  license?: string;
  author?: string;
  version?: string;
}> {
  try {
    const content = await vscode.workspace.fs.readFile(skillMdUri);
    const text = Buffer.from(content).toString("utf-8");
    const normalizedText = normalizeNewlines(text);

    // frontmatter を解析
    const frontmatterMatch = normalizedText.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1];

      // name フィールドを抽出
      let name = fallbackName;
      const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
      if (nameMatch) {
        name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
      }

      // description を抽出
      const description = extractDescriptionFromFrontmatter(frontmatter);

      // license を抽出
      let license: string | undefined;
      const licenseMatch = frontmatter.match(/^license:\s*(.+)$/m);
      if (licenseMatch) {
        license = licenseMatch[1].trim().replace(/^["']|["']$/g, "");
      }

      // metadata セクションから author と version を抽出
      let author: string | undefined;
      let version: string | undefined;

      // metadata.author または author を抽出
      const authorMatch = frontmatter.match(/^\s*author:\s*(.+)$/m);
      if (authorMatch) {
        author = authorMatch[1].trim().replace(/^["']|["']$/g, "");
      }

      // metadata.version または version を抽出
      const versionMatch = frontmatter.match(/^\s*version:\s*(.+)$/m);
      if (versionMatch) {
        version = versionMatch[1].trim().replace(/^["']|["']$/g, "");
      }

      return { name, description, license, author, version };
    }

    return { name: fallbackName, description: "" };
  } catch {
    return { name: fallbackName, description: "" };
  }
}

/**
 * frontmatter から description を抽出
 */
function extractDescriptionFromFrontmatter(frontmatter: string): string {
  let description = "";

  // ダブルクォート対応
  const doubleQuoteMatch = frontmatter.match(
    /^description:\s*"([^"]*(?:""[^"]*)*)"/m,
  );
  if (doubleQuoteMatch) {
    description = doubleQuoteMatch[1].replace(/""/g, '"');
  }

  // シングルクォート対応
  if (!description) {
    const singleQuoteMatch = frontmatter.match(
      /^description:\s*'([^']*(?:''[^']*)*)'/m,
    );
    if (singleQuoteMatch) {
      description = singleQuoteMatch[1].replace(/''/g, "'");
    }
  }

  // クォートなし（1行）
  if (!description) {
    const plainMatch = frontmatter.match(/^description:\s*(.+)$/m);
    if (plainMatch) {
      description = plainMatch[1].trim();
    }
  }

  // 長い説明は切り詰める（AGENTS.md 用に短くする）
  const maxLength = 200;
  if (description.length > maxLength) {
    const periodIndex = description.indexOf("。");
    const dotIndex = description.indexOf(". ");
    const cutIndex =
      periodIndex !== -1 && periodIndex < maxLength
        ? periodIndex + 1
        : dotIndex !== -1 && dotIndex < maxLength
          ? dotIndex + 1
          : maxLength;

    description = description.substring(0, cutIndex).trim();
    if (description.length === maxLength) {
      description += "...";
    }
  }

  return description;
}

/**
 * SKILL.md ファイルから description を抽出する
 * frontmatter の description フィールドを読み取り、長い場合は切り詰める
 */
async function extractDescriptionFromSkillMd(
  skillMdUri: vscode.Uri,
): Promise<string> {
  try {
    const content = await vscode.workspace.fs.readFile(skillMdUri);
    const text = Buffer.from(content).toString("utf-8");
    const normalizedText = normalizeNewlines(text);

    // frontmatter を解析
    const frontmatterMatch = normalizedText.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      return "";
    }

    return extractDescriptionFromFrontmatter(frontmatterMatch[1]);
  } catch {
    return "";
  }
}

/**
 * SKILL.md ファイルから "When to Use" セクションを抽出する
 * ## When to Use または ## いつ使うか などのセクションを検出し、内容を返す
 * セクションがない場合は、# タイトルの次の段落を使用
 */
/**
 * SKILL.md ファイルから "When to Use" セクションを抽出する
 * 箇条書き・テーブル・段落形式に対応
 */
async function extractWhenToUseFromSkillMd(
  skillMdUri: vscode.Uri,
): Promise<string> {
  try {
    const content = await vscode.workspace.fs.readFile(skillMdUri);
    const text = Buffer.from(content).toString("utf-8");
    return parseWhenToUseFromText(text);
  } catch {
    return "";
  }
}

/**
 * テキストから "When to Use" セクションを抽出する（純粋関数・テスト可能）
 * @param text SKILL.md のテキスト内容
 * @returns 抽出された When to Use 文字列（最大200文字）
 */
export function parseWhenToUseFromText(text: string): string {
  const normalizedText = normalizeNewlines(text);
  // "When to Use" セクションを検出（英語・日本語対応）
  // 終了条件: 次の ## セクション、--- 区切り、または EOF
  // m フラグを使わず \n## で行頭をマッチさせる（$ がマルチラインで各行末にマッチするのを防ぐ）
  const sectionMatch = normalizedText.match(
    /\n##\s*(When to Use|When To Use|いつ使うか|使用タイミング|Usage|使い方)\s*\n([\s\S]*?)(?=\n##\s|\n---\n|\n*$)/i,
  );

  let sectionContent = "";

  if (sectionMatch) {
    sectionContent = sectionMatch[2].trim();
  } else {
    // フォールバック: # タイトルの次の段落を抽出
    // frontmatter をスキップ
    let bodyText = normalizedText;
    const frontmatterMatch = normalizedText.match(/^---\n[\s\S]*?\n---\n*/);
    if (frontmatterMatch) {
      bodyText = normalizedText.substring(frontmatterMatch[0].length);
    }

    // # タイトル行を見つけて、その後の最初の段落を取得
    const lines = bodyText.split("\n");
    let foundTitle = false;
    const paragraphLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();

      if (!foundTitle) {
        // # で始まるタイトル行を探す
        if (/^#\s+/.test(trimmed)) {
          foundTitle = true;
        }
        continue;
      }

      // タイトル後の空行をスキップ
      if (!trimmed) {
        if (paragraphLines.length > 0) {
          // 段落が終わった
          break;
        }
        continue;
      }

      // 次のセクション（## など）に到達したら終了
      if (/^#/.test(trimmed)) {
        break;
      }

      // コードブロック、リスト等はスキップ
      if (/^```/.test(trimmed) || /^[-*]\s+\*\*/.test(trimmed)) {
        break;
      }

      paragraphLines.push(trimmed);

      // 最大2行まで
      if (paragraphLines.length >= 2) {
        break;
      }
    }

    sectionContent = paragraphLines.join(" ");
  }

  if (!sectionContent) {
    return "";
  }

  const lines = sectionContent.split("\n");
  const extractedItems: string[] = [];

  // テーブル形式かどうかを検出（| で始まる行があるか）
  const hasTableLines = lines.some((line) => line.trim().startsWith("|"));

  if (hasTableLines) {
    // テーブル形式の場合：各行の全セルを結合（"キー: 値" 形式）
    for (const line of lines) {
      const trimmed = line.trim();

      // テーブル行でない場合はスキップ
      if (!trimmed.startsWith("|")) {
        continue;
      }

      // セパレータ行をスキップ（|---|---| のパターン）
      if (/^\|[\s\-:]+\|/.test(trimmed) && !trimmed.match(/[a-zA-Z0-9]/)) {
        continue;
      }

      // セルを抽出
      const cells = trimmed
        .split("|")
        .map(
          (c) =>
            c
              .trim()
              .replace(/\*\*/g, "") // bold マーカーを除去
              .replace(/`([^`]+)`/g, "$1"), // インラインコードを除去
        )
        .filter((c) => c.length > 0);

      if (cells.length > 0) {
        const firstCell = cells[0];

        // ヘッダーっぽい行はスキップ（Action, Triggers, Pattern 等）
        if (
          /^(action|trigger|pattern|use case|when|scenario|situation)s?$/i.test(
            firstCell,
          )
        ) {
          continue;
        }

        // 全セルを結合（2列以上の場合は "キー: 値" 形式）
        let rowContent = "";
        if (cells.length >= 2) {
          // 最初のセルが短い場合はキーとして使用（例: "Create: New .agent.md, ..."）
          if (firstCell.length <= 20) {
            rowContent = `${firstCell}: ${cells.slice(1).join(", ")}`;
          } else {
            // 全セルをカンマで結合
            rowContent = cells.join(", ");
          }
        } else {
          rowContent = firstCell;
        }

        if (rowContent) {
          extractedItems.push(rowContent);
        }
      }
    }
  } else {
    // リスト形式または段落形式の場合
    for (const line of lines) {
      const trimmed = line.trim();

      // リスト項目を検出（- や * や 数字. で始まる行）
      if (/^[-*•]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
        // マーカーを除去して内容のみ取得
        const itemContent = trimmed
          .replace(/^[-*•]\s+/, "")
          .replace(/^\d+\.\s+/, "")
          .replace(/\*\*([^*]+)\*\*/g, "$1"); // bold を除去
        extractedItems.push(itemContent);
      } else if (
        trimmed &&
        !trimmed.startsWith("#") &&
        extractedItems.length === 0
      ) {
        // 段落テキストの場合（リストがまだない場合）
        extractedItems.push(trimmed);
      }
    }
  }

  if (extractedItems.length === 0) {
    return "";
  }

  // 200文字以内で可能な限り多くの項目を結合
  const maxLength = 200;
  let result = "";
  let itemCount = 0;

  for (const item of extractedItems) {
    const separator = itemCount > 0 ? "; " : "";
    const candidate = result + separator + item;

    if (candidate.length <= maxLength) {
      result = candidate;
      itemCount++;
    } else if (itemCount === 0) {
      // 最初の項目すら入らない場合は切り詰め
      result = item.substring(0, maxLength - 3) + "...";
      break;
    } else {
      // これ以上入らないので終了
      break;
    }
  }

  return result;
}

/**
 * フォールバック SKILL.md を作成
 */
async function createFallbackSkillMd(
  skillPath: vscode.Uri,
  skill: Skill,
): Promise<void> {
  const content = `# ${skill.name}

${skill.description}

Source: ${skill.source}
`;
  const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");
  await vscode.workspace.fs.writeFile(
    skillMdPath,
    Buffer.from(content, "utf-8"),
  );
}

/**
 * GitHub Contents API の directory listing が 403 などで失敗しても、
 * `<remotePath>/SKILL.md` を raw URL から直接取得して復旧を試みる。
 *
 * - raw.githubusercontent.com は匿名で取得し、404 の場合だけ token 付きで再試行する。
 * - 取得できた SKILL.md が実体（>100 bytes）のときだけ書き込み、true を返す。
 * - 失敗時は false を返し、呼び出し側で template fallback に委ねる。
 */
export async function recoverPrimarySkillMdFromRaw(
  skillPath: vscode.Uri,
  owner: string,
  repo: string,
  branch: string,
  remotePath: string,
  token?: string,
): Promise<boolean> {
  const cleanPath = (remotePath || "").replace(/^\/+|\/+$/g, "");
  const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`;
  const rawUrl = cleanPath
    ? `${rawBase}/${cleanPath}/SKILL.md`
    : `${rawBase}/SKILL.md`;
  try {
    const content = await fetchFileContent(rawUrl, token);
    if (!content || content.trim().length <= 100) {
      return false;
    }
    const skillMdPath = vscode.Uri.joinPath(skillPath, "SKILL.md");
    await vscode.workspace.fs.writeFile(
      skillMdPath,
      Buffer.from(content, "utf-8"),
    );
    logger.info(
      `Recovered SKILL.md from raw URL after directory listing failure: ${rawUrl}`,
    );
    return true;
  } catch (rawError) {
    logger.warn(
      `Raw SKILL.md recovery failed (${rawUrl}): ${
        rawError instanceof Error ? rawError.message : String(rawError)
      }`,
    );
    return false;
  }
}

/**
 * バグレポートを GitHub Issue として開く
 */
async function openBugReport(
  skill: Skill,
  source: Source | undefined,
  url: string,
  errorType: string,
  hasToken: boolean,
): Promise<void> {
  const extensionVersion =
    vscode.extensions.getExtension("yamapan.agent-resources-ninja")?.packageJSON
      ?.version || "unknown";

  const repoUrl = source?.url || "unknown";
  const branch = source?.branch || "default";
  const githubAuth = await resolveGitHubToken();

  const issueTitle = `[Bug] Skill not found: ${skill.name}`;
  const issueBody =
    `**Issue**\n` +
    `Skill "${skill.name}" from source "${skill.source}" could not be downloaded.\n\n` +
    `**Error**\n` +
    `${errorType}\n\n` +
    `**Skill Details**\n` +
    `- Name: ${skill.name}\n` +
    `- Source ID: ${skill.source}\n` +
    `- Path: ${skill.path || "unknown"}\n` +
    `- Repository: ${repoUrl}\n` +
    `- Branch: ${branch}\n` +
    `- Failed URL: ${url}\n\n` +
    `**Environment**\n` +
    `- Extension Version: ${extensionVersion}\n` +
    `- VS Code: ${vscode.version}\n` +
    `- OS: ${process.platform}\n` +
    `- GitHub Authentication: ${hasToken ? "configured" : "not configured"}\n\n` +
    `- GitHub Credential Source: ${githubAuth.source}\n\n` +
    `**Possible Cause**\n` +
    buildSkillNotFoundPossibleCause(hasToken);

  await openBugReportIssue(issueTitle, issueBody);
}

/**
 * URL からファイル内容を取得
 */
async function fetchFileContent(url: string, token?: string): Promise<string> {
  const response = await fetchGitHubWithOptionalAuthRetry(url, {
    accept: "text/plain",
    token,
  });
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${response.statusText} (URL: ${url})`,
    );
  }
  // 空ファイル（例: Python の __init__.py）も正常なので、
  // HTTP 200 が返れば内容が空でもエラーにしない
  const text = await response.text();
  return text;
}
