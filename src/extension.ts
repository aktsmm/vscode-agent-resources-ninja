// Agent Resources Ninja - VS Code Extension

import * as vscode from "vscode";
import * as path from "path";
import {
  SkillIndex,
  Skill,
  Source,
  ResourceKind,
  buildGitHubRawUrl,
  buildGitHubResourceUrl,
  loadSkillIndex,
  getSkillGitHubUrlAsync,
  getResourceKind,
  getResourceKindIcon,
  getResourceKindLabel,
} from "./skillIndex";
import { searchSkills, SkillQuickPickItem } from "./skillSearch";
import {
  installSkill,
  InstallTargetScope,
  getResourceTargetUri,
  SkillMeta,
  uninstallSkill,
  uninstallSkillByPath,
  getInstalledSkills,
  getInstalledSkillsWithMeta,
  normalizeSkillMetaSource,
  refreshSkillMetadata,
  refreshSingleSkillMetadata,
} from "./skillInstaller";
import {
  formatHookConfigUpdateSummary,
  restoreHookConfigFromBackup,
  updateHookConfigForUninstall,
} from "./hookConfigManager";
import {
  formatMcpConfigUpdateSummary,
  getMcpConfigLifecycleStatus,
  updateMcpConfigForUninstall,
} from "./mcpConfigManager";
import {
  resolvePrimaryRefCatalogUri,
  updateInstructionFile,
  updateInstructionFileAtUri,
  removeSkillSectionFromFile,
} from "./instructionManager";
import {
  BrowseSkillsProvider,
  SkillTreeItem,
  WorkspaceSkillsProvider,
} from "./treeProvider";
import {
  UserResourceTreeItem,
  UserResourcesProvider,
} from "./userResourcesProvider";
import {
  updateIndexFromSources,
  updateIndexFromSingleSource,
  addSource,
  removeSource,
  searchGitHub,
  showAuthHelp,
} from "./indexUpdater";
import { messages, isJapanese } from "./i18n";
import { showSkillPreview, getSkillId } from "./skillPreview";
import {
  LocalSkill,
  registerLocalSkill,
  unregisterLocalSkill,
} from "./localSkillScanner";
import { createChatParticipant } from "./chatParticipant";
import { registerMcpTools } from "./mcpTools";
import { logger, registerLogger } from "./logger";
import { openBugReport } from "./bugReport";
import {
  AgentNinjaExtensionApi,
  clearBeacon,
  getEffectiveOwner,
  getPublishedSelfBeacon,
  isSiblingActive,
  publishBeacon,
  readSiblingBeacon,
  subscribeOwnershipChanges,
} from "./coexistence";
import {
  detectResourceKindFromPath,
  getPluginIdFromPath,
  getResourceIdentityKeys,
  getResourceMetadataPath,
  isHookConfigFilePath,
} from "./resourceKinds";
import { scanUserResources, UserResource } from "./userResourceScanner";
import {
  DEFAULT_GLOBAL_HOME_DIRECTORY,
  DEFAULT_WORKSPACE_AGENTS_DIRECTORY,
  DEFAULT_WORKSPACE_HOOKS_DIRECTORY,
  DEFAULT_WORKSPACE_INSTRUCTIONS_DIRECTORY,
  DEFAULT_WORKSPACE_MCP_DIRECTORY,
  DEFAULT_WORKSPACE_PROMPTS_DIRECTORY,
  DISABLED_INSTRUCTION_FILE,
  getConfiguredAutoUpdateResourcesOnUpgrade,
  getConfiguredGlobalHomeDirectory,
  getConfiguredInstructionFilePath,
  getInstructionBlockKinds,
  getConfiguredStaleSourceIndexUpdateMode,
  getConfiguredSkillsDirectory,
  getConfiguredUserAgentsDirectory,
  getConfiguredUserInstructionsDirectory,
  getConfiguredUserPromptsDirectory,
  getConfiguredWorkspaceAgentsDirectory,
  getConfiguredWorkspaceHooksDirectory,
  getConfiguredWorkspaceInstructionsDirectory,
  getConfiguredWorkspaceMcpDirectory,
  getConfiguredWorkspacePromptsDirectory,
  resolveConfiguredUri,
  resolveGlobalInstructionFileUri,
  resolveSkillsDirectoryUri,
  resolveInstructionFileUri,
} from "./customizationPaths";
import { getVsCodeUserDataPath } from "./userDataPaths";
import {
  normalizeInlineOutputFormat,
  resolveOutputFormat,
} from "./toolDetector";
import {
  getStandaloneSharedModeSummary,
  readSharedResourceIndex,
} from "./sharedResourceIndexStore";
import { readSharedSourcesManifest } from "./sharedSourcesManifestStore";
import { collectStaleSources } from "./sourceFreshness";

// 現在の拡張機能バージョン
const EXTENSION_VERSION =
  vscode.extensions.getExtension("yamapan.agent-resources-ninja")?.packageJSON
    ?.version || "0.0.0";
const STALE_SOURCE_PROMPT_DATE_KEY = "resourceNinja.staleSourceLastPromptDate";

let activeExtensionContext: vscode.ExtensionContext | undefined;

function normalizeInstalledRemotePath(
  remotePath: string | undefined,
): string | undefined {
  const normalized = remotePath?.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return normalized || undefined;
}

function isIndexTrackedInstalledSkill(
  meta: Pick<SkillMeta, "remotePath">,
): boolean {
  return !!normalizeInstalledRemotePath(meta.remotePath);
}

function isRemoteInstalledSkillMeta(
  meta: Pick<SkillMeta, "source" | "remotePath">,
): boolean {
  return (
    !!normalizeInstalledRemotePath(meta.remotePath) &&
    !!meta.source &&
    meta.source !== "unknown" &&
    meta.source !== "local"
  );
}

function findIndexedSkillForInstalledMeta(
  index: SkillIndex,
  meta: Pick<SkillMeta, "name" | "source" | "remotePath">,
): Skill | undefined {
  const normalizedRemotePath = normalizeInstalledRemotePath(meta.remotePath);

  if (normalizedRemotePath && meta.source && meta.source !== "local") {
    const matchedByRemotePath = index.skills.find(
      (skill: Skill) =>
        getResourceKind(skill) === "skill" &&
        skill.source === meta.source &&
        normalizeInstalledRemotePath(skill.path) === normalizedRemotePath,
    );
    if (matchedByRemotePath) {
      return matchedByRemotePath;
    }
  }

  let skill = index.skills.find(
    (candidate: Skill) =>
      getResourceKind(candidate) === "skill" &&
      candidate.name === meta.name &&
      candidate.source === meta.source,
  );
  if (!skill && meta.source === "unknown") {
    skill = index.skills.find(
      (candidate: Skill) =>
        getResourceKind(candidate) === "skill" && candidate.name === meta.name,
    );
  }

  return skill;
}

function collectMissingIndexedInstalledSkills(
  index: SkillIndex,
  installedMeta: SkillMeta[],
): string[] {
  return installedMeta
    .filter((meta) => isIndexTrackedInstalledSkill(meta))
    .filter((meta) => !findIndexedSkillForInstalledMeta(index, meta))
    .map((meta) => meta.name);
}

function isKnownIndexedSourceId(
  sourceId: string | undefined,
): sourceId is string {
  return !!sourceId && sourceId !== "unknown" && sourceId !== "local";
}

function getLocalDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function collectMissingIndexedInstalledSkillSources(
  index: SkillIndex,
  installedMeta: SkillMeta[],
): string[] {
  return Array.from(
    new Set(
      installedMeta
        .filter((meta) => isIndexTrackedInstalledSkill(meta))
        .filter((meta) => !findIndexedSkillForInstalledMeta(index, meta))
        .map((meta) => meta.source)
        .filter(isKnownIndexedSourceId),
    ),
  );
}

async function deleteInstalledResourceByPath(
  kind: ResourceKind,
  fullPath: string,
): Promise<void> {
  const isDirectoryBackedHook =
    kind === "hook" && !isHookConfigFilePath(fullPath);
  const targetUri = vscode.Uri.file(
    kind === "skill" || isDirectoryBackedHook
      ? path.dirname(fullPath)
      : fullPath,
  );
  await vscode.workspace.fs.delete(targetUri, {
    recursive: kind === "skill" || isDirectoryBackedHook,
    useTrash: true,
  });

  if (kind !== "skill" && !isDirectoryBackedHook) {
    try {
      await vscode.workspace.fs.delete(
        vscode.Uri.file(getResourceMetadataPath(fullPath, kind)),
        { useTrash: true },
      );
    } catch {
      // Sidecar metadata may not exist for older installs.
    }
  }
}

type CreateResourceScope = "workspace" | "userData" | "globalHome" | "custom";
type DefaultInstallTargetScope = Exclude<InstallTargetScope, "custom"> | "ask";
const MAX_CREATE_RESOURCE_SLUG_LENGTH = 80;
const MAX_CREATE_RESOURCE_DESCRIPTION_LENGTH = 1000;
const MAX_CREATE_RESOURCE_PATH_LENGTH = 240;
const RESETTABLE_RESOURCE_NINJA_SETTINGS = [
  "autoUpdateInstruction",
  "autoUpdateResourcesOnUpgrade",
  "coexistenceMode",
  "instructionFile",
  "customInstructionPath",
  "includeLocalResources",
  "instructionBlock.includeAgents",
  "instructionBlock.includeInstructions",
  "instructionBlock.globalHome.includeAgents",
  "instructionBlock.globalHome.includeInstructions",
  "kindsExcluded",
  "resourcesDirectory",
  "additionalSkillRoots",
  "workspaceAgentsDirectory",
  "workspaceInstructionsDirectory",
  "workspacePromptsDirectory",
  "workspaceHooksDirectory",
  "workspaceMcpDirectory",
  "userAgentsDirectory",
  "userInstructionsDirectory",
  "userPromptsDirectory",
  "globalResourceHomePreset",
  "globalHomeDirectory",
  "language",
  "useRefOutput",
  "outputFormat",
  "refCatalogFormat",
  "singleClickInstall",
  "defaultInstallTarget",
  "showBuiltInResources",
  "remoteResourceViewMode",
  "useSharedSourcesManifest",
  "useSharedResourceIndex",
  "staleSourceIndexUpdateMode",
] as const;

function getInstructionTargetLabel(
  config: vscode.WorkspaceConfiguration,
  isJa: boolean,
): string {
  const instructionTarget = getConfiguredInstructionFilePath(config);
  if (instructionTarget === DISABLED_INSTRUCTION_FILE) {
    return isJa ? "無効" : "disabled";
  }
  return instructionTarget;
}

function isInstructionTargetEnabled(
  config: vscode.WorkspaceConfiguration,
): boolean {
  return getConfiguredInstructionFilePath(config) !== DISABLED_INSTRUCTION_FILE;
}

function getGlobalInstructionTargetLabel(
  workspaceUri: vscode.Uri,
  config: vscode.WorkspaceConfiguration,
): string {
  return (
    resolveGlobalInstructionFileUri(workspaceUri, config)?.fsPath ||
    getConfiguredInstructionFilePath(config)
  );
}

function sanitizeResourceName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function getResourceFileName(kind: ResourceKind, slug: string): string {
  switch (kind) {
    case "agent":
      return `${slug}.agent.md`;
    case "instruction":
      return `${slug}.instructions.md`;
    case "prompt":
      return `${slug}.prompt.md`;
    case "hook":
      return "README.md";
    case "mcp":
      return `${slug}.mcp.json`;
    case "skill":
    default:
      return "SKILL.md";
  }
}

function normalizeTemplateText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split(String.fromCharCode(0))
    .join("")
    .trim();
}

function yamlString(value: string): string {
  return JSON.stringify(normalizeTemplateText(value).replace(/\s+/g, " "));
}

function markdownText(value: string): string {
  return normalizeTemplateText(value) || "TODO: Describe this resource.";
}

function getMcpServerKey(name: string): string {
  return sanitizeResourceName(name) || "server";
}

function getCreateResourceNameValidationMessage(
  value: string,
  isJa: boolean,
): string | null {
  const slug = sanitizeResourceName(value || "");
  if (!slug) {
    return isJa ? "リソース名は必須です" : "Resource name is required";
  }
  if (slug.length > MAX_CREATE_RESOURCE_SLUG_LENGTH) {
    return isJa
      ? `リソース名は ${MAX_CREATE_RESOURCE_SLUG_LENGTH} 文字以内の slug にしてください`
      : `Resource name slug must be ${MAX_CREATE_RESOURCE_SLUG_LENGTH} characters or fewer`;
  }
  return null;
}

function getCreateResourcePathValidationMessage(
  resourceUri: vscode.Uri,
  isJa: boolean,
): string | null {
  if (resourceUri.fsPath.length <= MAX_CREATE_RESOURCE_PATH_LENGTH) {
    return null;
  }
  return isJa
    ? `作成先パスが長すぎます。リソース名または保存先を短くしてください（最大 ${MAX_CREATE_RESOURCE_PATH_LENGTH} 文字）`
    : `Destination path is too long. Shorten the resource name or destination (max ${MAX_CREATE_RESOURCE_PATH_LENGTH} characters)`;
}

function getCreateResourceDescriptionValidationMessage(
  value: string,
  isJa: boolean,
): string | null {
  if (value.length <= MAX_CREATE_RESOURCE_DESCRIPTION_LENGTH) {
    return null;
  }
  return isJa
    ? `説明は ${MAX_CREATE_RESOURCE_DESCRIPTION_LENGTH} 文字以内にしてください`
    : `Description must be ${MAX_CREATE_RESOURCE_DESCRIPTION_LENGTH} characters or fewer`;
}

function getResourceRootUri(
  workspaceUri: vscode.Uri,
  config: vscode.WorkspaceConfiguration,
  kind: ResourceKind,
  scope: CreateResourceScope,
  customRoot?: vscode.Uri,
): vscode.Uri {
  if (scope === "custom" && customRoot) {
    return customRoot;
  }

  if (scope === "globalHome") {
    const root = resolveConfiguredUri(
      workspaceUri,
      getConfiguredGlobalHomeDirectory(config),
      DEFAULT_GLOBAL_HOME_DIRECTORY,
    );
    const folder =
      kind === "skill" ? "skills" : kind === "mcp" ? "mcp" : `${kind}s`;
    return vscode.Uri.joinPath(root, folder);
  }

  if (scope === "userData") {
    const userDataRoot = vscode.Uri.file(
      getVsCodeUserDataPath({ appName: vscode.env.appName }),
    );
    const globalHomeRoot = resolveConfiguredUri(
      workspaceUri,
      getConfiguredGlobalHomeDirectory(config),
      DEFAULT_GLOBAL_HOME_DIRECTORY,
    );

    if (kind === "skill" || kind === "hook" || kind === "mcp") {
      return vscode.Uri.joinPath(
        globalHomeRoot,
        kind === "skill" ? "skills" : kind === "hook" ? "hooks" : "mcp",
      );
    }
    if (kind === "agent") {
      return resolveConfiguredUri(
        workspaceUri,
        getConfiguredUserAgentsDirectory(config) ||
          getConfiguredUserPromptsDirectory(config),
        path.join(userDataRoot.fsPath, "prompts"),
      );
    }
    if (kind === "instruction") {
      return resolveConfiguredUri(
        workspaceUri,
        getConfiguredUserInstructionsDirectory(config),
        path.join(userDataRoot.fsPath, "instructions"),
      );
    }
    return resolveConfiguredUri(
      workspaceUri,
      getConfiguredUserPromptsDirectory(config),
      path.join(userDataRoot.fsPath, "prompts"),
    );
  }

  if (kind === "skill") {
    return resolveSkillsDirectoryUri(workspaceUri, config);
  }
  if (kind === "agent") {
    return resolveConfiguredUri(
      workspaceUri,
      getConfiguredWorkspaceAgentsDirectory(config),
      DEFAULT_WORKSPACE_AGENTS_DIRECTORY,
    );
  }
  if (kind === "instruction") {
    return resolveConfiguredUri(
      workspaceUri,
      getConfiguredWorkspaceInstructionsDirectory(config),
      DEFAULT_WORKSPACE_INSTRUCTIONS_DIRECTORY,
    );
  }
  if (kind === "prompt") {
    return resolveConfiguredUri(
      workspaceUri,
      getConfiguredWorkspacePromptsDirectory(config),
      DEFAULT_WORKSPACE_PROMPTS_DIRECTORY,
    );
  }
  if (kind === "hook") {
    return resolveConfiguredUri(
      workspaceUri,
      getConfiguredWorkspaceHooksDirectory(config),
      DEFAULT_WORKSPACE_HOOKS_DIRECTORY,
    );
  }
  if (kind === "mcp") {
    return resolveConfiguredUri(
      workspaceUri,
      getConfiguredWorkspaceMcpDirectory(config),
      DEFAULT_WORKSPACE_MCP_DIRECTORY,
    );
  }
  return vscode.Uri.joinPath(workspaceUri, ".github", `${kind}s`);
}

function getCreateResourceUri(
  workspaceUri: vscode.Uri,
  config: vscode.WorkspaceConfiguration,
  kind: ResourceKind,
  scope: CreateResourceScope,
  slug: string,
  customRoot?: vscode.Uri,
): vscode.Uri {
  const root = getResourceRootUri(
    workspaceUri,
    config,
    kind,
    scope,
    customRoot,
  );
  if (kind === "skill" || kind === "hook") {
    return vscode.Uri.joinPath(root, slug, getResourceFileName(kind, slug));
  }
  return vscode.Uri.joinPath(root, getResourceFileName(kind, slug));
}

function getCreateResourceTemplate(
  kind: ResourceKind,
  name: string,
  description: string,
): string {
  const frontmatterName = yamlString(name);
  const frontmatterDescription = yamlString(description);
  const bodyDescription = markdownText(description);

  switch (kind) {
    case "agent":
      return `---\ndescription: ${frontmatterDescription}\ntools: []\n---\n\n# ${name}\n\n## Role\n\nDescribe what this agent does.\n\n## Instructions\n\n- Keep responses focused on the requested task.\n- Ask for clarification only when the requirement cannot be inferred.\n`;
    case "instruction":
      return `---\napplyTo: "**"\n---\n\n# ${name}\n\n${bodyDescription}\n\n## Guidance\n\n- Add project or workflow-specific instructions here.\n`;
    case "prompt":
      return `---\ndescription: ${frontmatterDescription}\n---\n\n# ${name}\n\nDescribe the repeatable prompt workflow here.\n\n## Input\n\n- Define the expected input.\n\n## Output\n\n- Define the expected output.\n`;
    case "hook":
      return `# ${name}\n\n${bodyDescription}\n\n## When to use\n\nUse this hook when a repeatable automation should run around a workflow event.\n\n## Behavior\n\n- Describe the trigger.\n- Describe the action.\n- Describe expected success and failure handling.\n`;
    case "mcp":
      return `{
  "servers": {
    ${JSON.stringify(getMcpServerKey(name))}: {
      "type": "stdio",
      "command": "replace-with-command",
      "args": []
    }
  }
}
`;
    case "skill":
    default:
      return `---\nname: ${frontmatterName}\ndescription: ${frontmatterDescription}\nlicense: YOUR-LICENSE\nmetadata:\n  author: your-name\n  version: "1.0"\n---\n\n# ${name}\n\n## When to use this skill\n\nUse this skill when:\n- The user needs to...\n- Working with...\n- The task involves...\n\n## Instructions\n\n1. Step one\n2. Step two\n3. Step three\n\n## Examples\n\n\`\`\`\nAdd examples here\n\`\`\`\n`;
  }
}

export async function activate(
  context: vscode.ExtensionContext,
): Promise<AgentNinjaExtensionApi> {
  activeExtensionContext = context;
  registerLogger(context);
  logger.info("Agent Resources Ninja is now active!");
  await publishBeacon(context);
  context.subscriptions.push(
    new vscode.Disposable(() => {
      activeExtensionContext = undefined;
      void clearBeacon(context);
    }),
  );

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

  // 設定値のマイグレーション（旧フォーマット名 → 新フォーマット名）
  const formatMigrated = await migrateOutputFormatSetting(workspaceFolder?.uri);

  let skillIndex: SkillIndex | undefined;

  // 最近インストールしたスキル（🆕 表示用）
  const recentlyInstalled = new Set<string>();
  const recentlyInstalledResources = new Map<string, Skill>();
  const recentInstallTimeouts = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  // ステータスバーアイテム
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  context.subscriptions.push(statusBarItem);
  context.subscriptions.push(
    new vscode.Disposable(() => {
      for (const timeout of recentInstallTimeouts.values()) {
        clearTimeout(timeout);
      }
      recentInstallTimeouts.clear();
      recentlyInstalled.clear();
      recentlyInstalledResources.clear();
    }),
  );

  // バージョンアップ時のメタデータ再抽出
  checkVersionAndRefreshMetadata(context, workspaceFolder?.uri, formatMigrated);

  // 統合ワークスペーススキルビュー
  const workspaceProvider = new WorkspaceSkillsProvider(
    workspaceFolder?.uri,
    recentlyInstalled,
  );
  const browseProvider = new BrowseSkillsProvider(context, recentlyInstalled);
  const userResourcesProvider = new UserResourcesProvider(
    workspaceFolder?.uri,
    recentlyInstalled,
  );

  const refreshInstructionSync = async (): Promise<void> => {
    workspaceProvider.refresh();
    userResourcesProvider.refresh();
    browseProvider.refresh();

    if (!workspaceFolder) {
      return;
    }

    const config = vscode.workspace.getConfiguration("resourceNinja");
    if (
      (config.get<boolean>("autoUpdateInstruction") ?? true) &&
      isInstructionTargetEnabled(config)
    ) {
      await updateInstructionFile(workspaceFolder.uri, context);
    }
  };

  subscribeOwnershipChanges(context, refreshInstructionSync);

  function markRecentlyInstalled(skill: Skill): void {
    const keys = getResourceIdentityKeys(skill);
    for (const key of keys) {
      const existingTimeout = recentInstallTimeouts.get(key);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      recentlyInstalled.add(key);
      recentlyInstalledResources.set(key, skill);
    }

    const timeout = setTimeout(() => {
      let changed = false;
      for (const key of keys) {
        recentInstallTimeouts.delete(key);
        recentlyInstalledResources.delete(key);
        changed = recentlyInstalled.delete(key) || changed;
      }
      if (changed) {
        workspaceProvider.refresh();
        browseProvider.refresh();
        userResourcesProvider.refresh();
      }
    }, 15000);

    for (const key of keys) {
      recentInstallTimeouts.set(key, timeout);
    }

    workspaceProvider.refresh();
    browseProvider.refresh();
    userResourcesProvider.refresh();
  }

  function shouldAutoUpdateInstructionForSkill(
    skill: Skill,
    installTarget: { targetScope: InstallTargetScope },
  ): boolean {
    if (getResourceKind(skill) !== "skill") {
      return false;
    }
    return canInstructionSyncForTarget(installTarget);
  }

  function canInstructionSyncForTarget(installTarget: {
    targetScope: InstallTargetScope;
  }): boolean {
    return (
      installTarget.targetScope === "workspace" ||
      installTarget.targetScope === "userData" ||
      installTarget.targetScope === "globalHome"
    );
  }

  function getInstalledPluginId(resource: {
    remotePath?: string;
    relativePath?: string;
    fullPath?: string;
  }): string | undefined {
    return (
      getPluginIdFromPath(resource.remotePath) ||
      getPluginIdFromPath(resource.relativePath) ||
      getPluginIdFromPath(resource.fullPath)
    );
  }

  function getSourceDisplayName(index: SkillIndex, sourceId: string): string {
    return (
      index.sources.find((source: Source) => source.id === sourceId)?.name ||
      sourceId
    );
  }

  function getSourceRefreshSummary(
    index: SkillIndex,
    sourceIds: Array<string | undefined>,
  ): string {
    const knownSourceIds = Array.from(
      new Set(sourceIds.filter(isKnownIndexedSourceId)),
    );
    if (knownSourceIds.length === 0) {
      return isJapanese() ? "全インデックス" : "the full index";
    }
    if (knownSourceIds.length === 1) {
      return getSourceDisplayName(index, knownSourceIds[0]);
    }
    return isJapanese()
      ? `${knownSourceIds.length} 個の該当ソース`
      : `${knownSourceIds.length} affected sources`;
  }

  async function refreshIndexForKnownSources(
    index: SkillIndex,
    sourceIds: Array<string | undefined>,
    reasonLabel?: string,
  ): Promise<SkillIndex> {
    const knownSourceIds = Array.from(
      new Set(sourceIds.filter(isKnownIndexedSourceId)),
    );

    if (knownSourceIds.length === 0) {
      return vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: isJapanese() ? "インデックスを更新中..." : "Updating index...",
          cancellable: false,
        },
        async (progress) => updateIndexFromSources(context, index, progress),
      );
    }

    if (knownSourceIds.length === 1) {
      const sourceId = knownSourceIds[0];
      const sourceLabel = getSourceDisplayName(index, sourceId);
      return vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: reasonLabel
            ? isJapanese()
              ? `${reasonLabel} のため ${sourceLabel} を更新中...`
              : `Updating ${sourceLabel} for ${reasonLabel}...`
            : messages.updatingSource(sourceLabel),
          cancellable: false,
        },
        async (progress) =>
          updateIndexFromSingleSource(context, index, sourceId, progress, {
            forceScan: true,
          }),
      );
    }

    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: isJapanese()
          ? "該当ソースのインデックスを更新中..."
          : "Updating affected source indexes...",
        cancellable: false,
      },
      async (progress) => {
        let nextIndex = index;
        let completed = 0;
        for (const sourceId of knownSourceIds) {
          progress.report({
            message: `${getSourceDisplayName(nextIndex, sourceId)} (${completed + 1}/${knownSourceIds.length})`,
            increment: 100 / knownSourceIds.length,
          });
          nextIndex = await updateIndexFromSingleSource(
            context,
            nextIndex,
            sourceId,
            progress,
            { forceScan: true },
          );
          completed++;
        }
        return nextIndex;
      },
    );
  }

  let startupIndexMaintenanceStarted = false;

  async function runStartupIndexMaintenance(): Promise<void> {
    if (startupIndexMaintenanceStarted) {
      return;
    }
    startupIndexMaintenanceStarted = true;

    try {
      let index = skillIndex || (await loadSkillIndex(context));
      skillIndex = index;
      logger.info(`Loaded ${index.skills.length} resources from index`);

      if (workspaceFolder) {
        const installedMeta = await getInstalledSkillsWithMeta(
          workspaceFolder.uri,
        );
        const missingSkills = collectMissingIndexedInstalledSkills(
          index,
          installedMeta,
        );

        if (missingSkills.length > 0) {
          const message = isJapanese()
            ? `⚠️ ${
                missingSkills.length
              } 個のスキルがインデックスに見つかりません: ${missingSkills
                .slice(0, 3)
                .join(", ")}${missingSkills.length > 3 ? "..." : ""}`
            : `⚠️ ${
                missingSkills.length
              } skill(s) not found in index: ${missingSkills
                .slice(0, 3)
                .join(", ")}${missingSkills.length > 3 ? "..." : ""}`;

          const updateIndexAction = isJapanese()
            ? "インデックスを更新"
            : "Update Index";
          const action = await vscode.window.showWarningMessage(
            message,
            updateIndexAction,
            isJapanese() ? "無視" : "Ignore",
          );

          if (action === updateIndexAction) {
            const sourceIds = collectMissingIndexedInstalledSkillSources(
              index,
              installedMeta,
            );
            skillIndex = await refreshIndexForKnownSources(
              index,
              sourceIds,
              isJapanese()
                ? "見つからないインストール済みリソース"
                : "missing installed resources",
            );
            browseProvider.refresh();
          }
          return;
        }
      }

      const config = vscode.workspace.getConfiguration("resourceNinja");
      const staleUpdateMode = getConfiguredStaleSourceIndexUpdateMode(config);
      if (staleUpdateMode === "never") {
        return;
      }

      const sharedIndex = await readSharedResourceIndex();
      const staleSources = collectStaleSources(
        index,
        sharedIndex?.scanMeta,
      ).map((entry) => entry.source);
      if (staleSources.length === 0) {
        return;
      }

      if (staleUpdateMode === "prompt") {
        const today = getLocalDateString();
        if (
          context.globalState.get<string>(STALE_SOURCE_PROMPT_DATE_KEY) ===
          today
        ) {
          return;
        }
        const examples = staleSources
          .slice(0, 3)
          .map((source) => source.name || source.id)
          .join(", ");
        const updateAction = isJapanese()
          ? "古いソースを更新"
          : "Update Stale Sources";
        const neverAction = isJapanese() ? "今後確認しない" : "Never Ask";
        const choice = await vscode.window.showWarningMessage(
          isJapanese()
            ? `${staleSources.length} 件のソースインデックスが30日以上更新されていません: ${examples}${staleSources.length > 3 ? "..." : ""}`
            : `${staleSources.length} source index(es) have not been updated in over 30 days: ${examples}${staleSources.length > 3 ? "..." : ""}`,
          updateAction,
          isJapanese() ? "今日はしない" : "Not Today",
          neverAction,
        );

        if (choice === neverAction) {
          await config.update(
            "staleSourceIndexUpdateMode",
            "never",
            vscode.ConfigurationTarget.Global,
          );
          return;
        }
        if (choice !== updateAction) {
          await context.globalState.update(STALE_SOURCE_PROMPT_DATE_KEY, today);
          return;
        }
      }

      const failedSources: string[] = [];
      index = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: isJapanese()
            ? "古いソースインデックスを更新中..."
            : "Updating stale source indexes...",
          cancellable: false,
        },
        async (progress) => {
          let nextIndex = index;
          let completed = 0;
          for (const source of staleSources) {
            progress.report({
              message: `${source.name || source.id} (${completed + 1}/${staleSources.length})`,
              increment: 100 / staleSources.length,
            });
            try {
              nextIndex = await updateIndexFromSingleSource(
                context,
                nextIndex,
                source.id,
                progress,
                { forceScan: true },
              );
            } catch (error) {
              failedSources.push(source.name || source.id);
              logger.warn(
                `[Resource Ninja] Failed to update stale source ${source.id}:`,
                error,
              );
            }
            completed++;
          }
          return nextIndex;
        },
      );
      skillIndex = index;
      browseProvider.refresh();

      if (failedSources.length > 0) {
        vscode.window.showWarningMessage(
          isJapanese()
            ? `古いソースインデックスの一部を更新できませんでした: ${failedSources.slice(0, 3).join(", ")}${failedSources.length > 3 ? "..." : ""}`
            : `Some stale source indexes could not be updated: ${failedSources.slice(0, 3).join(", ")}${failedSources.length > 3 ? "..." : ""}`,
        );
      } else if (staleUpdateMode === "always") {
        logger.info("[Resource Ninja] Stale source indexes updated.");
      } else {
        await context.globalState.update(
          STALE_SOURCE_PROMPT_DATE_KEY,
          getLocalDateString(),
        );
      }
    } catch (error) {
      logger.warn(
        "[Resource Ninja] Startup source index maintenance failed:",
        error,
      );
    }
  }

  void runStartupIndexMaintenance();

  type ReinstallCommandOptions = {
    suppressSuccessMessage?: boolean;
    suppressRecoveryPrompt?: boolean;
  };

  function normalizeReinstallCommandOptions(
    value?: boolean | ReinstallCommandOptions,
  ): ReinstallCommandOptions {
    if (typeof value === "boolean") {
      return { suppressSuccessMessage: value };
    }
    return value ?? {};
  }

  function getBatchFailureMessage(
    scopeLabel: string,
    success: number,
    total: number,
    failedNames: string[],
  ): string {
    const failed = total - success;
    const summary = failedNames.slice(0, 3).join(", ");
    return isJapanese()
      ? `${scopeLabel}: ${success}/${total} 件成功、${failed} 件失敗${summary ? ` (${summary}${failedNames.length > 3 ? "..." : ""})` : ""}`
      : `${scopeLabel}: ${success}/${total} succeeded, ${failed} failed${summary ? ` (${summary}${failedNames.length > 3 ? "..." : ""})` : ""}`;
  }

  function isRemoteInstalledUserResource(resource: UserResource): boolean {
    return (
      !resource.isBuiltIn &&
      !!resource.remotePath &&
      !!resource.source &&
      resource.source !== "local"
    );
  }

  // 後方互換のためのエイリアス
  const installedProvider = workspaceProvider;

  const updateBuiltInResourcesContext = async (): Promise<void> => {
    const visible = vscode.workspace
      .getConfiguration("resourceNinja")
      .get<boolean>("showBuiltInResources", true);
    await vscode.commands.executeCommand(
      "setContext",
      "resourceNinja.builtInResourcesVisible",
      visible,
    );
  };
  void updateBuiltInResourcesContext();

  const installedTreeView = vscode.window.createTreeView(
    "resourceNinja.installedView",
    {
      treeDataProvider: workspaceProvider,
      showCollapseAll: false,
    },
  );

  const browseTreeView = vscode.window.createTreeView(
    "resourceNinja.browseView",
    {
      treeDataProvider: browseProvider,
      showCollapseAll: true,
    },
  );

  const userResourcesTreeView = vscode.window.createTreeView(
    "resourceNinja.userResourcesView",
    {
      treeDataProvider: userResourcesProvider,
      showCollapseAll: true,
    },
  );

  // ダブルクリックでインストール機能
  let lastClickTime = 0;
  let lastClickedItem: string | undefined;

  // ダブルクリック検出用コマンド
  const doubleClickCmd = vscode.commands.registerCommand(
    "resourceNinja.onSkillClick",
    async (skill: Skill) => {
      if (!skill) return;

      const now = Date.now();
      const itemId = `${getResourceKind(skill)}:${skill.source}:${skill.path || skill.name}`;
      const isInstalled = browseProvider.isSkillInstalled(skill);

      // 同じアイテムを500ms以内にクリック → ダブルクリック
      if (lastClickedItem === itemId && now - lastClickTime < 500) {
        await vscode.commands.executeCommand(
          isInstalled
            ? "resourceNinja.reinstall"
            : "resourceNinja.installDefault",
          skill,
        );
        lastClickTime = 0;
        lastClickedItem = undefined;
      } else {
        lastClickTime = now;
        lastClickedItem = itemId;
      }
    },
  );

  // 設定変更を監視してビューをリフレッシュ
  const configWatcher = vscode.workspace.onDidChangeConfiguration(async (e) => {
    if (e.affectsConfiguration("resourceNinja.language")) {
      // 言語設定が変わったらインデックスを再読み込みしてツリービューをリフレッシュ
      // バンドル版の description_ja を反映させるため
      skillIndex = await loadSkillIndex(context);
      workspaceProvider.refresh();
      userResourcesProvider.refresh();
      browseProvider.refresh();
    }

    if (e.affectsConfiguration("resourceNinja.showBuiltInResources")) {
      await updateBuiltInResourcesContext();
      userResourcesProvider.refresh();
    }

    if (e.affectsConfiguration("resourceNinja.remoteResourceViewMode")) {
      browseProvider.refresh();
    }

    if (
      e.affectsConfiguration("resourceNinja.useSharedSourcesManifest") ||
      e.affectsConfiguration("resourceNinja.useSharedResourceIndex")
    ) {
      skillIndex = await loadSkillIndex(context);
      workspaceProvider.refresh();
      userResourcesProvider.refresh();
      browseProvider.refresh();
    }

    const resourcePathSettings = [
      "resourceNinja.resourcesDirectory",
      "resourceNinja.additionalSkillRoots",
      "resourceNinja.workspaceAgentsDirectory",
      "resourceNinja.workspaceInstructionsDirectory",
      "resourceNinja.workspacePromptsDirectory",
      "resourceNinja.workspaceHooksDirectory",
      "resourceNinja.workspaceMcpDirectory",
      "resourceNinja.userAgentsDirectory",
      "resourceNinja.userInstructionsDirectory",
      "resourceNinja.userPromptsDirectory",
      "resourceNinja.globalResourceHomePreset",
      "resourceNinja.globalHomeDirectory",
    ];
    if (
      resourcePathSettings.some((setting) => e.affectsConfiguration(setting))
    ) {
      workspaceProvider.refresh();
      userResourcesProvider.refresh();
      browseProvider.refresh();
    }

    // インストラクションファイルまたは出力フォーマットが変更されたら自動更新
    if (
      e.affectsConfiguration("resourceNinja.instructionFile") ||
      e.affectsConfiguration("resourceNinja.customInstructionPath") ||
      e.affectsConfiguration("resourceNinja.globalResourceHomePreset") ||
      e.affectsConfiguration("resourceNinja.globalHomeDirectory") ||
      e.affectsConfiguration("resourceNinja.useRefOutput") ||
      e.affectsConfiguration("resourceNinja.outputFormat") ||
      e.affectsConfiguration("resourceNinja.refCatalogFormat") ||
      e.affectsConfiguration("resourceNinja.coexistenceMode") ||
      e.affectsConfiguration("resourceNinja.instructionBlock.includeAgents") ||
      e.affectsConfiguration(
        "resourceNinja.instructionBlock.includeInstructions",
      ) ||
      e.affectsConfiguration(
        "resourceNinja.instructionBlock.globalHome.includeAgents",
      ) ||
      e.affectsConfiguration(
        "resourceNinja.instructionBlock.globalHome.includeInstructions",
      ) ||
      e.affectsConfiguration("resourceNinja.kindsExcluded")
    ) {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (workspaceFolders && workspaceFolders.length > 0) {
        // インストラクションファイルが変更された場合は古いファイルから削除
        if (
          e.affectsConfiguration("resourceNinja.instructionFile") ||
          e.affectsConfiguration("resourceNinja.customInstructionPath")
        ) {
          // （変更前の値は取得できないので、全ての候補ファイルから削除を試みる）
          const candidateFiles = [
            "AGENTS.md",
            "~/.copilot/copilot-instructions.md",
            ".github/copilot-instructions.md",
            ".github/instructions/SkillList.instructions.md",
            "CLAUDE.md",
            ".claude/CLAUDE.md",
            ".claude/CLAUDE.local.md",
            ".cursor/rules/skills.mdc",
            ".windsurfrules",
            ".clinerules",
          ];
          for (const file of candidateFiles) {
            try {
              await removeSkillSectionFromFile(
                resolveConfiguredUri(workspaceFolders[0].uri, file, file),
              );
            } catch {
              // ファイルが存在しない場合は無視
            }
          }
        }

        // 少し待ってから更新（設定が完全に反映されるのを待つ）
        setTimeout(async () => {
          try {
            await updateInstructionFile(workspaceFolders[0].uri, context);
            vscode.window.showInformationMessage(
              messages.instructionFileUpdatedOnSettingChange(),
            );
          } catch (err) {
            logger.error(
              "Failed to update resource output on setting change:",
              err,
            );
          }
        }, 500);
      }
    }
  });

  // GitHub Copilot Chat Participant
  createChatParticipant(context);

  // MCP Tools for Language Model API
  registerMcpTools(context);

  // Command: Refresh
  const refreshCmd = vscode.commands.registerCommand(
    "resourceNinja.refresh",
    () => {
      installedProvider.refresh();
      browseProvider.refresh();
      userResourcesProvider.refresh();
    },
  );

  const setBuiltInResourcesVisibility = async (
    nextValue: boolean,
  ): Promise<void> => {
    const config = vscode.workspace.getConfiguration("resourceNinja");
    const currentValue = config.get<boolean>("showBuiltInResources", true);
    if (currentValue !== nextValue) {
      await config.update(
        "showBuiltInResources",
        nextValue,
        vscode.ConfigurationTarget.Global,
      );
    }
    await updateBuiltInResourcesContext();
    workspaceProvider.refresh();
    userResourcesProvider.refresh();
    vscode.window.showInformationMessage(
      nextValue
        ? isJapanese()
          ? "組み込みリソースを表示します"
          : "Built-in resources are now visible"
        : isJapanese()
          ? "組み込みリソースを非表示にしました"
          : "Built-in resources are now hidden",
    );
  };

  const toggleBuiltInResourcesCmd = vscode.commands.registerCommand(
    "resourceNinja.toggleBuiltInResources",
    async () => {
      const currentValue = vscode.workspace
        .getConfiguration("resourceNinja")
        .get<boolean>("showBuiltInResources", true);
      await setBuiltInResourcesVisibility(!currentValue);
    },
  );

  const showBuiltInResourcesCmd = vscode.commands.registerCommand(
    "resourceNinja.showBuiltInResources",
    async () => {
      await setBuiltInResourcesVisibility(true);
    },
  );

  const hideBuiltInResourcesCmd = vscode.commands.registerCommand(
    "resourceNinja.hideBuiltInResources",
    async () => {
      await setBuiltInResourcesVisibility(false);
    },
  );

  const refreshUserResourcesCmd = vscode.commands.registerCommand(
    "resourceNinja.refreshUserResources",
    () => {
      userResourcesProvider.refresh();
    },
  );

  const toggleRemoteResourceViewModeCmd = vscode.commands.registerCommand(
    "resourceNinja.toggleRemoteResourceViewMode",
    async () => {
      const config = vscode.workspace.getConfiguration(
        "resourceNinja",
        workspaceFolder?.uri,
      );
      const current = config.get<string>(
        "remoteResourceViewMode",
        "repositoryFirst",
      );
      const next =
        current === "resourceTypeFirst"
          ? "repositoryFirst"
          : "resourceTypeFirst";
      await config.update(
        "remoteResourceViewMode",
        next,
        vscode.ConfigurationTarget.Global,
      );
      browseProvider.refresh();
      vscode.window.showInformationMessage(
        next === "resourceTypeFirst"
          ? isJapanese()
            ? "リモートリソースを種類別に表示します"
            : "Remote Resources now use resource-type-first layout"
          : isJapanese()
            ? "リモートリソースをリポジトリ別に表示します"
            : "Remote Resources now use repository-first layout",
      );
    },
  );

  const openUserResourceCmd = vscode.commands.registerCommand(
    "resourceNinja.openUserResource",
    async (item: UserResourceTreeItem) => {
      if (!item?.resource) {
        return;
      }
      await vscode.window.showTextDocument(
        vscode.Uri.file(item.resource.fullPath),
      );
    },
  );

  const revealUserResourceCmd = vscode.commands.registerCommand(
    "resourceNinja.revealUserResource",
    async (item: UserResourceTreeItem) => {
      const uri = item?.folderUri || item?.resourceUri;
      if (!uri) {
        return;
      }
      await vscode.commands.executeCommand("revealFileInOS", uri);
    },
  );

  const copyUserResourcePathCmd = vscode.commands.registerCommand(
    "resourceNinja.copyUserResourcePath",
    async (item: UserResourceTreeItem) => {
      if (!item?.resource) {
        return;
      }
      await vscode.env.clipboard.writeText(item.resource.fullPath);
      vscode.window.showInformationMessage(
        isJapanese()
          ? "リソースのパスをコピーしました"
          : "Copied resource path",
      );
    },
  );

  const deleteUserResourceCmd = vscode.commands.registerCommand(
    "resourceNinja.deleteUserResource",
    async (item: UserResourceTreeItem) => {
      const resource = item?.resource;
      if (!resource || resource.isBuiltIn || resource.isReadOnly) {
        return;
      }
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        isJapanese()
          ? `「${resource.name}」を削除しますか？ファイルはごみ箱へ移動されます。`
          : `Delete "${resource.name}"? Files will be moved to the trash.`,
        { modal: true },
        isJapanese() ? "削除" : "Delete",
      );
      if (confirm !== (isJapanese() ? "削除" : "Delete")) {
        return;
      }

      const resourceUri = vscode.Uri.file(resource.fullPath);
      const isDirectoryBackedHook =
        resource.kind === "hook" && !isHookConfigFilePath(resource.fullPath);
      const targetUri =
        resource.kind === "skill" || isDirectoryBackedHook
          ? vscode.Uri.file(path.dirname(resource.fullPath))
          : resourceUri;

      let hookConfigUpdate:
        | import("./hookConfigManager").HookConfigUpdateResult
        | undefined;
      let hookConfigSummary: string | undefined;
      try {
        if (isDirectoryBackedHook) {
          hookConfigUpdate = await updateHookConfigForUninstall(
            wsFolder.uri,
            resourceUri,
          );
          hookConfigSummary = formatHookConfigUpdateSummary(hookConfigUpdate);
        }

        await vscode.workspace.fs.delete(targetUri, {
          recursive: resource.kind === "skill" || isDirectoryBackedHook,
          useTrash: true,
        });

        if (resource.kind !== "skill" && !isDirectoryBackedHook) {
          try {
            await vscode.workspace.fs.delete(
              vscode.Uri.file(
                path.normalize(
                  getResourceMetadataPath(resource.fullPath, resource.kind),
                ),
              ),
              { useTrash: true },
            );
          } catch {
            // Sidecar metadata is optional.
          }
        }

        userResourcesProvider.refresh();
        const config = vscode.workspace.getConfiguration(
          "resourceNinja",
          wsFolder.uri,
        );
        if (
          resource.kind === "skill" &&
          config.get<boolean>("autoUpdateInstruction")
        ) {
          await updateInstructionFile(wsFolder.uri, context);
        }
        vscode.window.showInformationMessage(
          isJapanese()
            ? `「${resource.name}」を削除しました${hookConfigSummary ? ` (${hookConfigSummary})` : ""}`
            : `Deleted "${resource.name}"${hookConfigSummary ? ` (${hookConfigSummary})` : ""}`,
        );
      } catch (error) {
        let errorMessage = String(error);
        if (isDirectoryBackedHook && hookConfigUpdate?.changed) {
          const restored = await restoreHookConfigFromBackup(hookConfigUpdate);
          if (restored) {
            errorMessage = isJapanese()
              ? `${errorMessage} hooks.json はバックアップから復元しました。`
              : `${errorMessage} hooks.json was restored from backup.`;
          }
        }
        vscode.window.showErrorMessage(
          isJapanese()
            ? `削除に失敗しました: ${errorMessage}`
            : `Failed to delete resource: ${errorMessage}`,
        );
      }
    },
  );

  const reinstallUserResourceCmd = vscode.commands.registerCommand(
    "resourceNinja.reinstallUserResource",
    async (
      item: UserResourceTreeItem,
      optionsOrSuppressSuccessMessage?: boolean | ReinstallCommandOptions,
    ) => {
      const { suppressSuccessMessage = false, suppressRecoveryPrompt = false } =
        normalizeReinstallCommandOptions(optionsOrSuppressSuccessMessage);
      const resource = item?.resource;
      if (!resource || resource.isBuiltIn || resource.isReadOnly) {
        return false;
      }
      if (!isRemoteInstalledUserResource(resource)) {
        if (!suppressSuccessMessage) {
          vscode.window.showWarningMessage(
            isJapanese()
              ? `${resource.name} はリモートインストール元のメタデータがないため再インストールできません`
              : `${resource.name} cannot be reinstalled because remote install metadata is missing`,
          );
        }
        return false;
      }

      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return false;
      }

      const targetScope: InstallTargetScope =
        resource.scope === "userData" ? "userData" : "globalHome";

      let index = await loadSkillIndex(context);
      let fullSkill = index.skills.find(
        (s: Skill) =>
          getResourceKind(s) === resource.kind &&
          s.source === resource.source &&
          s.path === resource.remotePath,
      );
      if (!fullSkill) {
        fullSkill = index.skills.find(
          (s: Skill) =>
            getResourceKind(s) === resource.kind &&
            s.path === resource.remotePath,
        );
      }
      if (!fullSkill) {
        const sourceSummary = getSourceRefreshSummary(index, [resource.source]);
        const tryUpdate = await vscode.window.showWarningMessage(
          isJapanese()
            ? `${resource.name} がインデックスに見つかりません。${sourceSummary} を更新しますか？`
            : `${resource.name} not found in index. Update ${sourceSummary} now?`,
          isJapanese() ? "更新する" : "Update",
          isJapanese() ? "キャンセル" : "Cancel",
        );

        if (tryUpdate === (isJapanese() ? "更新する" : "Update")) {
          index = await refreshIndexForKnownSources(
            index,
            [resource.source],
            resource.name,
          );

          fullSkill = index.skills.find(
            (s: Skill) =>
              getResourceKind(s) === resource.kind &&
              s.source === resource.source &&
              s.path === resource.remotePath,
          );
          if (!fullSkill) {
            fullSkill = index.skills.find(
              (s: Skill) =>
                getResourceKind(s) === resource.kind &&
                s.path === resource.remotePath,
            );
          }
        }

        if (!fullSkill) {
          if (!suppressSuccessMessage) {
            vscode.window.showErrorMessage(
              isJapanese()
                ? `${resource.name} がインデックスに見つかりません。ソースリポジトリを確認してください。`
                : `${resource.name} not found in index. Please check source repositories.`,
            );
          }
          return false;
        }
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: isJapanese()
              ? `${resource.name} を再インストール中...`
              : `Reinstalling ${resource.name}...`,
            cancellable: false,
          },
          async () => {
            await deleteInstalledResourceByPath(
              resource.kind,
              resource.fullPath,
            );
            await installSkill(fullSkill, wsFolder.uri, context, {
              targetScope,
              suppressRecoveryPrompt,
            });

            const config = vscode.workspace.getConfiguration("resourceNinja");
            if (
              resource.kind === "skill" &&
              config.get<boolean>("autoUpdateInstruction")
            ) {
              const targetUri = resolveGlobalInstructionFileUri(
                wsFolder.uri,
                config,
              );
              if (targetUri) {
                await updateInstructionFileAtUri(
                  wsFolder.uri,
                  context,
                  targetUri,
                  getGlobalInstructionTargetLabel(wsFolder.uri, config),
                );
              }
            }
          },
        );

        markRecentlyInstalled(fullSkill);
        userResourcesProvider.refresh();
        browseProvider.refresh();
        workspaceProvider.refresh();

        if (!suppressSuccessMessage) {
          vscode.window.showInformationMessage(
            isJapanese()
              ? `${resource.name} を再インストールしました`
              : `Reinstalled ${resource.name}`,
          );
        }
        return true;
      } catch (error) {
        if (!suppressSuccessMessage) {
          vscode.window.showErrorMessage(
            isJapanese()
              ? `再インストール失敗: ${String(error)}`
              : `Reinstall failed: ${String(error)}`,
          );
        }
        return false;
      }
    },
  );

  const reinstallUserResourceGroupCmd = vscode.commands.registerCommand(
    "resourceNinja.reinstallUserResourceGroup",
    async (item?: UserResourceTreeItem) => {
      if (!item) {
        return;
      }

      const allResources = userResourcesProvider
        .getResources()
        .filter((resource) => !resource.isBuiltIn && !resource.isReadOnly);

      let targets: UserResource[] = [];
      if (item.nodeType === "kind" && item.scope && item.kind) {
        targets = allResources.filter(
          (resource) =>
            resource.scope === item.scope &&
            resource.scopeLabel === item.scopeLabel &&
            resource.kind === item.kind,
        );
      } else if (item.nodeType === "plugin" && item.scope && item.pluginId) {
        targets = allResources.filter(
          (resource) =>
            resource.scope === item.scope &&
            resource.scopeLabel === item.scopeLabel &&
            getInstalledPluginId(resource) === item.pluginId,
        );
      } else {
        return;
      }

      const remoteTargets = targets.filter(isRemoteInstalledUserResource);
      if (remoteTargets.length === 0) {
        vscode.window.showInformationMessage(
          isJapanese()
            ? "このグループにリモート由来の再インストール可能なリソースはありません"
            : "This group has no remote-installed resources to reinstall",
        );
        return;
      }

      const groupLabel =
        item.label?.toString() ||
        (isJapanese() ? "リソースグループ" : "Resource group");
      const confirmLabel = isJapanese() ? "再インストール" : "Reinstall";
      const confirm = await vscode.window.showWarningMessage(
        isJapanese()
          ? `${groupLabel} の ${remoteTargets.length} 個のリモートリソースを再インストールしますか？`
          : `Reinstall ${remoteTargets.length} remote-installed resource(s) in ${groupLabel}?`,
        { modal: true },
        confirmLabel,
      );
      if (confirm !== confirmLabel) {
        return;
      }

      let success = 0;
      const failedResources: string[] = [];
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: isJapanese()
            ? `${groupLabel} を再インストール中...`
            : `Reinstalling ${groupLabel}...`,
          cancellable: false,
        },
        async (progress) => {
          let completed = 0;
          for (const resource of remoteTargets) {
            progress.report({
              message: `${resource.name} (${completed + 1}/${remoteTargets.length})`,
              increment: 100 / remoteTargets.length,
            });
            const ok = await vscode.commands.executeCommand<boolean>(
              "resourceNinja.reinstallUserResource",
              new UserResourceTreeItem(
                resource.name,
                resource.description || "",
                vscode.TreeItemCollapsibleState.None,
                "remoteResource",
                resource,
                resource.scope,
                resource.kind,
                resource.scopeLabel,
              ),
              {
                suppressSuccessMessage: true,
                suppressRecoveryPrompt: true,
              },
            );
            if (ok) {
              success++;
            } else {
              failedResources.push(resource.name);
            }
            completed++;
          }
        },
      );

      userResourcesProvider.refresh();
      browseProvider.refresh();
      workspaceProvider.refresh();
      if (failedResources.length > 0) {
        vscode.window.showWarningMessage(
          getBatchFailureMessage(
            groupLabel,
            success,
            remoteTargets.length,
            failedResources,
          ),
        );
      } else {
        vscode.window.showInformationMessage(
          isJapanese()
            ? `${groupLabel} の ${success}/${remoteTargets.length} 個を再インストールしました`
            : `Reinstalled ${success}/${remoteTargets.length} resources in ${groupLabel}`,
        );
      }
    },
  );

  // Command: Refresh Local
  const refreshLocalCmd = vscode.commands.registerCommand(
    "resourceNinja.refreshLocal",
    () => {
      workspaceProvider.refresh();
    },
  );

  // Command: Open resource file
  const openSkillFileCmd = vscode.commands.registerCommand(
    "resourceNinja.openResourceFile",
    async (item: SkillTreeItem) => {
      if (!workspaceFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      // ローカルスキルの場合は fullPath を使用
      const skill = item.skill as Skill & {
        fullPath?: string;
        isLocal?: boolean;
      };
      if (skill?.fullPath) {
        try {
          await vscode.window.showTextDocument(vscode.Uri.file(skill.fullPath));
          return;
        } catch {
          // フォールバック
        }
      }

      // インストール済みスキル（.github/skills 配下）の場合
      const config = vscode.workspace.getConfiguration(
        "resourceNinja",
        workspaceFolder.uri,
      );
      const skillsDir = getConfiguredSkillsDirectory(config);

      // ラベルからステータスアイコンを削除してスキル名を取得
      const skillName = (item.label as string).replace(/^[✓○]\s*/, "");

      const skillPath = vscode.Uri.joinPath(
        workspaceFolder.uri,
        skillsDir,
        skillName,
        "SKILL.md",
      );
      try {
        await vscode.window.showTextDocument(skillPath);
      } catch {
        vscode.window.showWarningMessage(messages.skillNotFound(skillName));
      }
    },
  );

  const deletePluginResourcesCmd = vscode.commands.registerCommand(
    "resourceNinja.deletePluginResources",
    async (item?: SkillTreeItem | UserResourceTreeItem) => {
      const pluginId = item?.pluginId;
      if (!pluginId) {
        vscode.window.showErrorMessage(
          isJapanese() ? "プラグイン情報がありません" : "No plugin information",
        );
        return;
      }

      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      const workspaceResources = wsFolder
        ? workspaceProvider
            .getWorkspaceSkills()
            .filter(
              (resource) =>
                !resource.isBuiltIn &&
                getInstalledPluginId(resource) === pluginId,
            )
        : [];
      const userResources = await scanUserResources(wsFolder?.uri, false);
      const userPluginResources = userResources.filter(
        (resource) =>
          !resource.isReadOnly && getInstalledPluginId(resource) === pluginId,
      );
      const resources = [
        ...workspaceResources.map((resource) => ({
          kind: resource.kind || ("skill" as ResourceKind),
          name: resource.name,
          fullPath: resource.fullPath,
        })),
        ...userPluginResources.map((resource) => ({
          kind: resource.kind,
          name: resource.name,
          fullPath: resource.fullPath,
        })),
      ];

      if (resources.length === 0) {
        vscode.window.showInformationMessage(
          isJapanese()
            ? `プラグイン "${pluginId}" のインストール済みリソースは見つかりません`
            : `No installed resources found for plugin "${pluginId}"`,
        );
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        isJapanese()
          ? `プラグイン "${pluginId}" の ${resources.length} 個のリソースを削除しますか？ファイルはごみ箱に移動します。`
          : `Delete ${resources.length} resources from plugin "${pluginId}"? Files will be moved to the trash.`,
        { modal: true },
        isJapanese() ? "削除" : "Delete",
      );
      if (confirm !== (isJapanese() ? "削除" : "Delete")) {
        return;
      }

      let failed = 0;
      let deletedSkills = 0;
      for (const resource of resources) {
        try {
          await deleteInstalledResourceByPath(resource.kind, resource.fullPath);
          if (resource.kind === "skill") {
            deletedSkills++;
          }
        } catch (error) {
          failed++;
          logger.error(
            `[Resource Ninja] Failed to delete plugin resource ${resource.name}:`,
            error,
          );
        }
      }

      workspaceProvider.refresh();
      userResourcesProvider.refresh();
      browseProvider.refresh();
      const config = vscode.workspace.getConfiguration(
        "resourceNinja",
        wsFolder?.uri,
      );
      if (
        wsFolder &&
        deletedSkills > 0 &&
        config.get<boolean>("autoUpdateInstruction")
      ) {
        await updateInstructionFile(wsFolder.uri, context);
      }
      vscode.window.showInformationMessage(
        isJapanese()
          ? `プラグイン "${pluginId}" の ${resources.length - failed}/${resources.length} 個のリソースを削除しました`
          : `Deleted ${resources.length - failed}/${resources.length} resources from plugin "${pluginId}"`,
      );
    },
  );

  // Command: Open skill folder
  const openSkillFolderCmd = vscode.commands.registerCommand(
    "resourceNinja.openResourceFolder",
    async (item: SkillTreeItem) => {
      if (!workspaceFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      // ローカルスキルの場合は fullPath からフォルダパスを取得
      const skill = item.skill as Skill & {
        fullPath?: string;
        isLocal?: boolean;
      };
      if (skill?.fullPath) {
        const folderPath = path.dirname(skill.fullPath);
        await vscode.commands.executeCommand(
          "revealFileInOS",
          vscode.Uri.file(folderPath),
        );
        return;
      }

      // インストール済みスキル（.github/skills 配下）の場合
      const config = vscode.workspace.getConfiguration(
        "resourceNinja",
        workspaceFolder.uri,
      );
      const skillsDir = getConfiguredSkillsDirectory(config);

      // ラベルからステータスアイコンを削除してスキル名を取得
      const skillName = (item.label as string).replace(/^[✓○]\s*/, "");

      const folderPath = vscode.Uri.joinPath(
        workspaceFolder.uri,
        skillsDir,
        skillName,
      );

      await vscode.commands.executeCommand("revealFileInOS", folderPath);
    },
  );

  // Command: Edit "When to Use" description
  const editWhenToUseCmd = vscode.commands.registerCommand(
    "resourceNinja.editWhenToUse",
    async (item: SkillTreeItem) => {
      if (!workspaceFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      const skill = item.skill;
      if (!skill?.name) {
        return;
      }
      if (getResourceKind(skill) !== "skill") {
        vscode.window.showWarningMessage(
          isJapanese()
            ? "When To Use の編集は skill entry のみ対応しています"
            : "When To Use editing is only available for skill entries",
        );
        return;
      }

      const config = vscode.workspace.getConfiguration(
        "resourceNinja",
        workspaceFolder.uri,
      );
      const skillsDir = getConfiguredSkillsDirectory(config);

      // メタデータファイルのパス
      const metaPath = vscode.Uri.joinPath(
        workspaceFolder.uri,
        skillsDir,
        skill.name,
        ".skill-meta.json",
      );

      // SKILL.md のパス
      const skillMdPath = vscode.Uri.joinPath(
        workspaceFolder.uri,
        skillsDir,
        skill.name,
        "SKILL.md",
      );

      // 既存のメタデータを読み込む（なければ生成）
      let meta: {
        name: string;
        source: string;
        description: string;
        description_ja?: string;
        whenToUse?: string;
        customWhenToUse?: string;
        categories: string[];
        installedAt: string;
      };
      try {
        const content = await vscode.workspace.fs.readFile(metaPath);
        meta = JSON.parse(Buffer.from(content).toString("utf-8"));
      } catch {
        // メタデータがない場合は SKILL.md から生成
        try {
          const skillMdContent =
            await vscode.workspace.fs.readFile(skillMdPath);
          const text = Buffer.from(skillMdContent).toString("utf-8");

          // frontmatter から description を抽出
          let description = "";
          const frontmatterMatch = text.match(/^---\n([\s\S]*?)\n---/);
          if (frontmatterMatch) {
            const descMatch = frontmatterMatch[1].match(
              /^description:\s*["']?([^"'\n]+)["']?/m,
            );
            if (descMatch) {
              description = descMatch[1].trim();
            }
          }

          meta = {
            name: skill.name,
            source: normalizeSkillMetaSource({}),
            description: description,
            categories: [],
            installedAt: new Date().toISOString(),
          };
        } catch {
          vscode.window.showErrorMessage(
            isJapanese()
              ? "スキルファイルが見つかりません"
              : "Skill file not found",
          );
          return;
        }
      }

      // 現在の値を取得（カスタム > whenToUse > description）
      const currentValue =
        meta.customWhenToUse || meta.whenToUse || meta.description || "";

      // 入力ダイアログを表示
      const instructionTarget = getInstructionTargetLabel(config, isJapanese());
      const instructionTargetEnabled = isInstructionTargetEnabled(config);
      const autoUpdateInstruction =
        config.get<boolean>("autoUpdateInstruction") !== false;
      const newValue = await vscode.window.showInputBox({
        title: isJapanese()
          ? `${skill.name} の When To Use を編集`
          : `Edit When To Use for ${skill.name}`,
        prompt: isJapanese()
          ? !instructionTargetEnabled
            ? "説明文メタデータを保存します。インストラクションファイル同期先は無効です（空にするとデフォルトに戻ります）"
            : autoUpdateInstruction
              ? `生成される instruction block に表示する説明文を入力してください（同期先: ${instructionTarget}、空にするとデフォルトに戻ります）`
              : `説明文メタデータを保存します。自動更新は無効です。必要に応じて Update Resource Output で ${instructionTarget} を更新してください（空にするとデフォルトに戻ります）`
          : !instructionTargetEnabled
            ? "Save the description metadata. Instruction file sync target is disabled (leave empty to reset to default)"
            : autoUpdateInstruction
              ? `Enter the description shown in the generated instruction block (target: ${instructionTarget}; leave empty to reset to default)`
              : `Save the description metadata. Automatic instruction updates are disabled; run Update Resource Output to refresh ${instructionTarget} when needed (leave empty to reset to default)`,
        value: currentValue,
        placeHolder: isJapanese()
          ? "例: エージェントワークフローの設計・レビュー・改善"
          : "e.g., Design, review, and improve agent workflows",
      });

      // キャンセルされた場合
      if (newValue === undefined) {
        return;
      }

      // メタデータを更新
      if (newValue.trim() === "") {
        // 空の場合はカスタム値を削除
        delete meta.customWhenToUse;
      } else {
        meta.customWhenToUse = newValue.trim();
      }

      // 保存
      await vscode.workspace.fs.writeFile(
        metaPath,
        Buffer.from(JSON.stringify(meta, null, 2), "utf-8"),
      );

      // 設定された instruction file を更新
      const shouldUpdateInstructionIndex =
        instructionTargetEnabled && autoUpdateInstruction;
      if (shouldUpdateInstructionIndex) {
        await updateInstructionFile(workspaceFolder.uri, context);
      }

      vscode.window.showInformationMessage(
        isJapanese()
          ? shouldUpdateInstructionIndex
            ? `${skill.name} の説明を更新し、${instructionTarget} を更新しました`
            : instructionTargetEnabled
              ? `${skill.name} の説明メタデータを保存しました。自動更新は無効です。必要に応じて Update Resource Output を実行してください。`
              : `${skill.name} の説明メタデータを保存しました。インストラクションファイル同期先は無効です。`
          : shouldUpdateInstructionIndex
            ? `Updated description for ${skill.name} and refreshed ${instructionTarget}`
            : instructionTargetEnabled
              ? `Saved description metadata for ${skill.name}. Automatic instruction updates are disabled; run Update Resource Output when needed.`
              : `Saved description metadata for ${skill.name}. Instruction file sync target is disabled.`,
      );

      workspaceProvider.refresh();
    },
  );

  async function pickInstallTarget(skill: Skill): Promise<
    | {
        targetScope: InstallTargetScope;
        customTargetUri?: vscode.Uri;
      }
    | undefined
  > {
    const activeWorkspaceFolder = workspaceFolder;
    if (!activeWorkspaceFolder) {
      vscode.window.showErrorMessage(messages.noWorkspace());
      return undefined;
    }

    const previewTargetPath = (
      skill: Skill,
      targetScope: InstallTargetScope,
    ): string => {
      if (targetScope === "custom") {
        return isJapanese() ? "選択したフォルダー" : "Selected folder";
      }

      const config = vscode.workspace.getConfiguration("resourceNinja");
      const targetUri = getResourceTargetUri(
        activeWorkspaceFolder.uri,
        config,
        skill,
        {
          targetScope,
        },
      );
      const relative = path.relative(
        activeWorkspaceFolder.uri.fsPath,
        targetUri.fsPath,
      );
      if (
        relative &&
        !relative.startsWith("..") &&
        !path.isAbsolute(relative)
      ) {
        return relative.replace(/\\/g, "/");
      }
      return targetUri.fsPath;
    };

    const selected = await vscode.window.showQuickPick(
      [
        {
          label: `$(repo) ${messages.installTargetWorkspaceLabel()}`,
          description: messages.installTargetWorkspaceDescription(
            previewTargetPath(skill, "workspace"),
          ),
          targetScope: "workspace" as InstallTargetScope,
        },
        {
          label: `$(account) ${messages.installTargetUserProfileLabel()}`,
          description: messages.installTargetUserProfileDescription(
            previewTargetPath(skill, "userData"),
          ),
          targetScope: "userData" as InstallTargetScope,
        },
        {
          label: `$(home) ${messages.installTargetCopilotHomeLabel()}`,
          description: messages.installTargetCopilotHomeDescription(
            previewTargetPath(skill, "globalHome"),
          ),
          targetScope: "globalHome" as InstallTargetScope,
        },
        {
          label: `$(folder) ${messages.installTargetCustomLabel()}`,
          description: messages.installTargetCustomDescription(),
          targetScope: "custom" as InstallTargetScope,
        },
      ],
      {
        placeHolder: messages.installTargetPlaceholder(skill.name),
      },
    );

    if (!selected) {
      return undefined;
    }

    if (selected.targetScope !== "custom") {
      return { targetScope: selected.targetScope };
    }

    const folders = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: messages.installTargetOpenLabel(),
    });

    const customTargetUri = folders?.[0];
    if (!customTargetUri) {
      return undefined;
    }

    return { targetScope: "custom", customTargetUri };
  }

  function getDefaultInstallTarget(): DefaultInstallTargetScope {
    const configured = vscode.workspace
      .getConfiguration("resourceNinja")
      .get<string>("defaultInstallTarget", "workspace");
    if (
      configured === "ask" ||
      configured === "workspace" ||
      configured === "userData" ||
      configured === "globalHome"
    ) {
      return configured;
    }
    return "workspace";
  }

  async function resolveDefaultInstallTarget(skill: Skill): Promise<
    | {
        targetScope: InstallTargetScope;
        customTargetUri?: vscode.Uri;
      }
    | undefined
  > {
    const defaultTarget = getDefaultInstallTarget();
    if (defaultTarget === "ask") {
      return pickInstallTarget(skill);
    }
    return { targetScope: defaultTarget };
  }

  type McpInstallMode = "copyOnly" | "mergeIntoWorkspace";

  async function confirmMcpServerOverwrite(
    serverKeys: string[],
    configUri: vscode.Uri,
  ): Promise<string[]> {
    const overwrite = isJapanese() ? "上書きする" : "Overwrite";
    const skip = isJapanese() ? "既存を保持" : "Keep Existing";
    const message = isJapanese()
      ? `${configUri.fsPath} には同じ MCP server key が既にあります: ${serverKeys.join(
          ", ",
        )}\n上書きしますか？`
      : `${configUri.fsPath} already contains these MCP server keys: ${serverKeys.join(
          ", ",
        )}\nOverwrite them?`;
    const choice = await vscode.window.showWarningMessage(
      message,
      { modal: true },
      overwrite,
      skip,
    );
    return choice === overwrite ? serverKeys : [];
  }

  async function pickMcpInstallMode(mcpResourceCount: number): Promise<
    | {
        mcpInstallMode: McpInstallMode;
        confirmMcpServerOverwrite?: (
          serverKeys: string[],
          configUri: vscode.Uri,
        ) => Promise<string[]>;
      }
    | undefined
  > {
    const selected = await vscode.window.showQuickPick(
      [
        {
          label: isJapanese()
            ? "$(file) コピーのみ（レビューして手動で有効化）"
            : "$(file) Copy only (review and enable manually)",
          description: isJapanese()
            ? "Workspace MCP Directory に保存"
            : "Save under the Workspace MCP Directory",
          detail: isJapanese()
            ? ".vscode/mcp.json は変更しません。既存設定を最も安全に保てます。"
            : ".vscode/mcp.json is not modified. This keeps existing configuration safest.",
          mode: "copyOnly" as McpInstallMode,
          picked: true,
        },
        {
          label: isJapanese()
            ? "$(merge) コピーして .vscode/mcp.json にマージ"
            : "$(merge) Copy and merge into .vscode/mcp.json",
          description: isJapanese()
            ? "MCP server をこのワークスペースで有効化"
            : "Enable MCP servers in this workspace",
          detail: isJapanese()
            ? "既存 server key がある場合は上書き確認を表示し、書き込み前に backup を作成します。"
            : "Existing server keys require overwrite confirmation, and a backup is created before writing.",
          mode: "mergeIntoWorkspace" as McpInstallMode,
        },
      ],
      {
        placeHolder: isJapanese()
          ? `${mcpResourceCount} 個の MCP config の扱いを選択`
          : `Choose how to handle ${mcpResourceCount} MCP config resource(s)`,
        title: isJapanese()
          ? "MCP config の有効化方法"
          : "MCP Config Activation",
      },
    );

    if (!selected) {
      return undefined;
    }
    return selected.mode === "mergeIntoWorkspace"
      ? {
          mcpInstallMode: "mergeIntoWorkspace",
          confirmMcpServerOverwrite,
        }
      : { mcpInstallMode: "copyOnly" };
  }

  async function maybeRemoveMergedMcpConfig(
    workspaceUri: vscode.Uri,
    mcpConfigUri: vscode.Uri,
  ): Promise<
    Awaited<ReturnType<typeof updateMcpConfigForUninstall>> | undefined
  > {
    const status = await getMcpConfigLifecycleStatus(
      workspaceUri,
      mcpConfigUri,
    );
    const mergedServerKeys = status.serverKeys.filter(
      (serverKey) => !status.missingServerKeys.includes(serverKey),
    );
    if (mergedServerKeys.length === 0) {
      return undefined;
    }

    const removeLabel = isJapanese()
      ? ".vscode/mcp.json から削除"
      : "Remove from .vscode/mcp.json";
    const keepLabel = isJapanese()
      ? "MCP config ファイルのみ削除"
      : "Delete staged file only";
    const choice = await vscode.window.showWarningMessage(
      isJapanese()
        ? `この MCP config は .vscode/mcp.json にマージ済みです。server (${mergedServerKeys.join(", ")}) も削除しますか？`
        : `This MCP config is merged into .vscode/mcp.json. Remove server(s) (${mergedServerKeys.join(", ")}) as well?`,
      { modal: true },
      removeLabel,
      keepLabel,
    );
    if (choice !== removeLabel) {
      return undefined;
    }

    return updateMcpConfigForUninstall(
      workspaceUri,
      mcpConfigUri,
      mergedServerKeys,
    );
  }

  async function installResource(
    skillOrItem: any,
    mode: "ask" | "default",
  ): Promise<boolean> {
    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    if (!wsFolder) {
      vscode.window.showErrorMessage(messages.noWorkspace());
      return false;
    }

    const skill = skillOrItem?.skill || skillOrItem;

    if (!skill && skillIndex) {
      await vscode.commands.executeCommand("resourceNinja.search");
      return false;
    }

    if (!skill?.name) {
      vscode.window.showErrorMessage(messages.invalidSkillInfo());
      return false;
    }

    const installTarget =
      mode === "default"
        ? await resolveDefaultInstallTarget(skill)
        : await pickInstallTarget(skill);
    if (!installTarget) {
      return false;
    }

    const resourceKind = getResourceKind(skill);
    const mcpInstallOptions =
      resourceKind === "mcp"
        ? mode === "default"
          ? { mcpInstallMode: "copyOnly" as const }
          : await pickMcpInstallMode(1)
        : {};
    if (!mcpInstallOptions) {
      return false;
    }

    try {
      let installResult: Awaited<ReturnType<typeof installSkill>> | undefined;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: messages.installing(skill.name),
        },
        async () => {
          installResult = await installSkill(skill, wsFolder.uri, context, {
            ...installTarget,
            ...mcpInstallOptions,
          });

          const config = vscode.workspace.getConfiguration("resourceNinja");
          if (
            shouldAutoUpdateInstructionForSkill(skill, installTarget) &&
            config.get<boolean>("autoUpdateInstruction")
          ) {
            await updateInstructionFile(wsFolder.uri, context);
          }
        },
      );

      markRecentlyInstalled(skill);

      statusBarItem.text = `$(check) ${skill.name} ${
        isJapanese() ? "インストール完了" : "installed"
      }`;
      statusBarItem.show();
      setTimeout(() => statusBarItem.hide(), 4000);

      vscode.window.showInformationMessage(messages.installSuccess(skill.name));
      const hookConfigSummary = formatHookConfigUpdateSummary(
        installResult?.hookConfigUpdate,
      );
      if (hookConfigSummary) {
        logger.info(`[Resource Ninja] Hook config: ${hookConfigSummary}`);
        vscode.window.showInformationMessage(hookConfigSummary);
      }
      const mcpConfigSummary = formatMcpConfigUpdateSummary(
        installResult?.mcpConfigUpdate,
      );
      if (mcpConfigSummary) {
        logger.info(`[Resource Ninja] MCP config: ${mcpConfigSummary}`);
        vscode.window.showInformationMessage(mcpConfigSummary);
      } else if (resourceKind === "mcp") {
        const message = isJapanese()
          ? "MCP config を確認用にコピーしました。.vscode/mcp.json へのマージは明示操作が必要です。"
          : "Copied MCP config for review. Merge into .vscode/mcp.json remains an explicit choice.";
        logger.info(`[Resource Ninja] ${message}`);
        vscode.window.showInformationMessage(message);
      }
      workspaceProvider.refresh();
      browseProvider.refresh();
      userResourcesProvider.refresh();

      const rootItems = await workspaceProvider.getChildren();
      let installedItem: SkillTreeItem | undefined;
      for (const rootItem of rootItems) {
        if (rootItem.skill?.name === skill.name) {
          installedItem = rootItem;
          break;
        }
        const childItems = await workspaceProvider.getChildren(rootItem);
        installedItem = childItems.find(
          (item) => item.skill?.name === skill.name,
        );
        if (installedItem) {
          break;
        }
      }
      if (installedItem) {
        installedTreeView.reveal(installedItem, {
          select: true,
          focus: true,
        });
      }
      return true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes("rate limit") ||
        errorMessage.includes("403") ||
        errorMessage.includes("authentication")
      ) {
        await showAuthHelp();
      } else {
        vscode.window.showErrorMessage(messages.installFailed(errorMessage));
      }
      return false;
    }
  }

  // Command: Search resources
  const searchCmd = vscode.commands.registerCommand(
    "resourceNinja.search",
    async () => {
      if (!skillIndex) {
        skillIndex = await loadSkillIndex(context);
      }

      const quickPick = vscode.window.createQuickPick<SkillQuickPickItem>();
      quickPick.placeholder = messages.searchPlaceholder();
      quickPick.matchOnDescription = true;
      quickPick.matchOnDetail = true;
      quickPick.buttons = [
        {
          iconPath: new vscode.ThemeIcon("filter"),
          tooltip: isJapanese()
            ? "リソース種別で絞り込み"
            : "Filter by resource kind",
        },
      ];

      const kindFilterOrder: Array<ResourceKind | undefined> = [
        undefined,
        "skill",
        "agent",
        "instruction",
        "prompt",
        "hook",
        "mcp",
        "plugin",
        "cursor-rule",
      ];
      let kindFilter: ResourceKind | undefined;

      const getFilterLabel = (): string => {
        if (!kindFilter) {
          return isJapanese() ? "すべてのリソース" : "All resources";
        }
        return getResourceKindLabel(kindFilter, isJapanese());
      };

      const refreshSearchResults = (): void => {
        quickPick.title = `${isJapanese() ? "検索対象" : "Filter"}: ${getFilterLabel()}`;
        quickPick.items = searchSkills(
          skillIndex!,
          quickPick.value,
          kindFilter,
        );
      };

      refreshSearchResults();

      quickPick.onDidChangeValue((value) => {
        quickPick.items = searchSkills(skillIndex!, value, kindFilter);
      });

      quickPick.onDidTriggerButton(() => {
        const currentIndex = kindFilterOrder.indexOf(kindFilter);
        kindFilter =
          kindFilterOrder[(currentIndex + 1) % kindFilterOrder.length];
        refreshSearchResults();
      });

      quickPick.onDidAccept(async () => {
        const selected = quickPick.selectedItems[0];
        if (selected) {
          quickPick.hide();

          // アクションメニューを表示
          const action = await vscode.window.showQuickPick(
            [
              { label: `$(add) ${messages.actionInstall()}`, value: "install" },
              { label: `$(eye) ${messages.actionPreview()}`, value: "preview" },
              {
                label: `$(star) ${messages.addToFavorites()}`,
                value: "favorite",
              },
              {
                label: `$(link-external) ${messages.openOnGitHub()}`,
                value: "github",
              },
              { label: `$(close) ${messages.actionCancel()}`, value: "cancel" },
            ],
            {
              placeHolder: `${selected.skill.name}: ${
                selected.skill.description || ""
              }`,
            },
          );

          if (action?.value === "install") {
            await vscode.commands.executeCommand(
              "resourceNinja.install",
              selected.skill,
            );
          } else if (action?.value === "preview") {
            await showSkillPreview(selected.skill, context);
          } else if (action?.value === "favorite") {
            await vscode.commands.executeCommand(
              "resourceNinja.toggleFavorite",
              selected.skill,
            );
          } else if (action?.value === "github") {
            const url = await getSkillGitHubUrlAsync(
              selected.skill,
              skillIndex?.sources || [],
            );
            if (url) {
              await vscode.env.openExternal(vscode.Uri.parse(url));
            }
          }
        }
      });

      quickPick.onDidHide(() => quickPick.dispose());
      quickPick.show();
    },
  );

  // Command: Install skill
  const installCmd = vscode.commands.registerCommand(
    "resourceNinja.install",
    async (skillOrItem?: any) => {
      return installResource(skillOrItem, "ask");
    },
  );

  const installDefaultCmd = vscode.commands.registerCommand(
    "resourceNinja.installDefault",
    async (skillOrItem?: any) => {
      return installResource(skillOrItem, "default");
    },
  );

  // Command: Uninstall skill
  const uninstallCmd = vscode.commands.registerCommand(
    "resourceNinja.uninstall",
    async (item?: SkillTreeItem) => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      let skillName: string | undefined;
      let relativePath: string | undefined;

      if (item && item.skill) {
        // ツリーアイテムからスキル情報を取得
        skillName = item.skill.name;
        const skillAny = item.skill as unknown as Record<string, unknown>;
        relativePath = (skillAny.relativePath || skillAny.path) as
          | string
          | undefined;
      } else if (item && item.label) {
        // ラベルからステータスアイコンを除去してスキル名を取得
        skillName = (item.label as string).replace(/^(?:🆕\s*)?[✓○]\s*/, "");
      } else {
        const installed = await getInstalledSkills(wsFolder.uri);
        if (installed.length === 0) {
          vscode.window.showInformationMessage(messages.noInstalledSkills());
          return;
        }

        const selected =
          await vscode.window.showQuickPick<vscode.QuickPickItem>(
            installed.map((name: string) => ({ label: name })),
            { placeHolder: messages.selectSkillToUninstall() },
          );
        skillName = selected?.label;
      }

      if (skillName) {
        try {
          let uninstallResult:
            | Awaited<ReturnType<typeof uninstallSkillByPath>>
            | Awaited<ReturnType<typeof uninstallSkill>>
            | undefined;
          let mcpUninstallSummary: string | undefined;
          let mcpConfigUri: vscode.Uri | undefined;
          let detectedKind: ResourceKind | undefined;
          if (relativePath) {
            const normalizedRelativePath = relativePath.replace(/\\/g, "/");
            detectedKind = detectResourceKindFromPath(normalizedRelativePath);
            if (detectedKind === "mcp") {
              mcpConfigUri = path.isAbsolute(relativePath)
                ? vscode.Uri.file(path.normalize(relativePath))
                : vscode.Uri.joinPath(
                    wsFolder.uri,
                    ...normalizedRelativePath.split("/").filter(Boolean),
                  );
            }
          }
          // relativePath がある場合はそれを使って削除（より確実）
          if (relativePath) {
            uninstallResult = await uninstallSkillByPath(
              relativePath,
              wsFolder.uri,
            );
          } else {
            uninstallResult = await uninstallSkill(skillName, wsFolder.uri);
          }

          if (detectedKind === "mcp" && mcpConfigUri) {
            const mcpUninstallResult = await maybeRemoveMergedMcpConfig(
              wsFolder.uri,
              mcpConfigUri,
            );
            mcpUninstallSummary =
              formatMcpConfigUpdateSummary(mcpUninstallResult);
          }

          const config = vscode.workspace.getConfiguration("resourceNinja");
          if (config.get<boolean>("autoUpdateInstruction")) {
            await updateInstructionFile(wsFolder.uri, context);
          }

          vscode.window.showInformationMessage(
            messages.uninstallSuccess(skillName),
          );
          const hookConfigSummary = formatHookConfigUpdateSummary(
            uninstallResult?.hookConfigUpdate,
          );
          if (hookConfigSummary) {
            logger.info(`[Resource Ninja] Hook config: ${hookConfigSummary}`);
            vscode.window.showInformationMessage(hookConfigSummary);
          }
          if (mcpUninstallSummary) {
            logger.info(`[Resource Ninja] MCP config: ${mcpUninstallSummary}`);
            vscode.window.showInformationMessage(mcpUninstallSummary);
          }
          workspaceProvider.refresh();
          browseProvider.refresh();
        } catch (error) {
          vscode.window.showErrorMessage(
            messages.uninstallFailed(String(error)),
          );
        }
      }
    },
  );

  // Command: Reinstall all skills
  const reinstallAllCmd = vscode.commands.registerCommand(
    "resourceNinja.reinstallAll",
    async () => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      const installedMeta = await getInstalledSkillsWithMeta(wsFolder.uri);
      if (installedMeta.length === 0) {
        vscode.window.showInformationMessage(messages.noInstalledSkills());
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        isJapanese()
          ? `${installedMeta.length} 個のスキルを再インストールしますか？`
          : `Reinstall ${installedMeta.length} skills?`,
        { modal: true },
        isJapanese() ? "再インストール" : "Reinstall",
      );

      if (!confirm) {
        return;
      }

      let index = await loadSkillIndex(context);

      // インデックスに見つからないスキルがあるかチェック
      const missingSkills = collectMissingIndexedInstalledSkills(
        index,
        installedMeta,
      );
      const missingSources = collectMissingIndexedInstalledSkillSources(
        index,
        installedMeta,
      );

      // 見つからないスキルがある場合、インデックス更新を提案
      if (missingSkills.length > 0) {
        const sourceSummary = getSourceRefreshSummary(index, missingSources);
        const tryUpdate = await vscode.window.showWarningMessage(
          isJapanese()
            ? `${
                missingSkills.length
              } 個のスキルがインデックスに見つかりません（${missingSkills
                .slice(0, 3)
                .join(", ")}${
                missingSkills.length > 3 ? "..." : ""
              }）。${sourceSummary} を更新しますか？`
            : `${
                missingSkills.length
              } skill(s) not found in index (${missingSkills
                .slice(0, 3)
                .join(", ")}${
                missingSkills.length > 3 ? "..." : ""
              }). Update ${sourceSummary} now?`,
          isJapanese() ? "更新する" : "Update",
          isJapanese() ? "スキップ" : "Skip",
        );

        if (tryUpdate === (isJapanese() ? "更新する" : "Update")) {
          index = await refreshIndexForKnownSources(index, missingSources);
        }
      }

      let success = 0;
      const failedSkills: string[] = [];

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: isJapanese()
            ? "スキルを再インストール中..."
            : "Reinstalling skills...",
          cancellable: false,
        },
        async (progress) => {
          let completed = 0;
          for (const meta of installedMeta) {
            progress.report({
              message: `${meta.name} (${completed + 1}/${
                installedMeta.length
              })`,
              increment: 100 / installedMeta.length,
            });

            // スキル情報を取得
            const skill = findIndexedSkillForInstalledMeta(index, meta);

            if (skill) {
              try {
                // 既存を削除して再インストール
                await uninstallSkill(meta.name, wsFolder.uri);
                await installSkill(skill, wsFolder.uri, context, {
                  suppressRecoveryPrompt: true,
                });
                markRecentlyInstalled(skill);
                success++;
              } catch (error) {
                logger.error(`Failed to reinstall ${meta.name}:`, error);
                failedSkills.push(meta.name);
              }
            } else {
              failedSkills.push(meta.name);
            }
            completed++;
          }
        },
      );

      // Instruction ファイルを更新
      const config = vscode.workspace.getConfiguration("resourceNinja");
      if (config.get<boolean>("autoUpdateInstruction")) {
        await updateInstructionFile(wsFolder.uri, context);
      }

      installedProvider.refresh();
      browseProvider.refresh();
      if (failedSkills.length > 0) {
        vscode.window.showWarningMessage(
          getBatchFailureMessage(
            isJapanese() ? "スキル再インストール" : "Skill reinstall",
            success,
            installedMeta.length,
            failedSkills,
          ),
        );
      } else {
        vscode.window.showInformationMessage(
          isJapanese()
            ? `${installedMeta.length} 個のスキルを再インストールしました`
            : `Reinstalled ${installedMeta.length} skills`,
        );
      }
    },
  );

  // Command: Reinstall single remote-installed resource
  const reinstallCmd = vscode.commands.registerCommand(
    "resourceNinja.reinstall",
    async (
      item?: SkillTreeItem,
      optionsOrSuppressSuccessMessage?: boolean | ReinstallCommandOptions,
    ) => {
      const { suppressSuccessMessage = false, suppressRecoveryPrompt = false } =
        normalizeReinstallCommandOptions(optionsOrSuppressSuccessMessage);
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return false;
      }

      const skill = item?.skill as (Skill & Partial<LocalSkill>) | undefined;
      if (!skill?.name) {
        if (!suppressSuccessMessage) {
          vscode.window.showErrorMessage(messages.invalidSkillInfo());
        }
        return false;
      }

      const resourceKind = getResourceKind(skill);
      let source = skill.source;
      let remotePath = skill.remotePath || skill.path;
      let resourceName = skill.name;
      let relativePath = skill.relativePath || skill.path;
      const normalizedRemotePath = normalizeInstalledRemotePath(remotePath);
      const installedWorkspaceResource = workspaceProvider
        .getWorkspaceSkills()
        .find((resource) => {
          if (resource.kind !== resourceKind || !resource.isInstalled) {
            return false;
          }
          const candidateRemotePath = normalizeInstalledRemotePath(
            resource.remotePath,
          );
          if (
            normalizedRemotePath &&
            candidateRemotePath &&
            normalizedRemotePath === candidateRemotePath
          ) {
            return (
              !source || source === "unknown" || resource.source === source
            );
          }
          return (
            resource.name === skill.name &&
            (!source || source === "unknown" || resource.source === source)
          );
        });

      if (resourceKind === "skill") {
        const installedMeta = await getInstalledSkillsWithMeta(wsFolder.uri);
        const meta =
          installedMeta.find(
            (m) =>
              !!normalizedRemotePath &&
              normalizeInstalledRemotePath(m.remotePath) ===
                normalizedRemotePath &&
              (!source || source === "unknown" || m.source === source),
          ) ||
          installedMeta.find(
            (m) =>
              m.name === skill.name ||
              (!!skill.relativePath && m.relativePath === skill.relativePath),
          );
        if (!meta && !installedWorkspaceResource) {
          if (!suppressSuccessMessage) {
            vscode.window.showErrorMessage(
              isJapanese()
                ? `${skill.name} のメタデータが見つかりません`
                : `Metadata not found for ${skill.name}`,
            );
          }
          return false;
        }
        if (meta) {
          source = meta.source;
          remotePath = meta.remotePath || remotePath;
          resourceName = meta.name;
          relativePath =
            meta.skillFilePath || meta.relativePath || relativePath;
        } else if (installedWorkspaceResource) {
          source = installedWorkspaceResource.source || source;
          remotePath = installedWorkspaceResource.remotePath || remotePath;
          resourceName = installedWorkspaceResource.name || resourceName;
          relativePath =
            installedWorkspaceResource.fullPath ||
            installedWorkspaceResource.relativePath ||
            relativePath;
        }
      } else if (installedWorkspaceResource) {
        source = installedWorkspaceResource.source || source;
        remotePath = installedWorkspaceResource.remotePath || remotePath;
        resourceName = installedWorkspaceResource.name || resourceName;
        relativePath =
          installedWorkspaceResource.fullPath ||
          installedWorkspaceResource.relativePath ||
          relativePath;
      }

      if (!source || source === "local" || !remotePath) {
        if (!suppressSuccessMessage) {
          vscode.window.showWarningMessage(
            isJapanese()
              ? `${skill.name} はリモートインストール元のメタデータがないため再インストールできません`
              : `${skill.name} cannot be reinstalled because remote install metadata is missing`,
          );
        }
        return false;
      }

      let index = await loadSkillIndex(context);
      let fullSkill = index.skills.find(
        (s: Skill) =>
          getResourceKind(s) === resourceKind &&
          s.source === source &&
          s.path === remotePath,
      );
      if (!fullSkill && source === "unknown") {
        fullSkill = index.skills.find(
          (s: Skill) =>
            getResourceKind(s) === resourceKind && s.name === resourceName,
        );
      }
      if (!fullSkill) {
        fullSkill = index.skills.find(
          (s: Skill) =>
            getResourceKind(s) === resourceKind &&
            s.name === resourceName &&
            s.source === source,
        );
      }

      // インデックスに見つからない場合は自動で更新を試みる
      if (!fullSkill) {
        const sourceSummary = getSourceRefreshSummary(index, [source]);
        const tryUpdate = await vscode.window.showWarningMessage(
          isJapanese()
            ? `${skill.name} がインデックスに見つかりません。${sourceSummary} を更新しますか？`
            : `${skill.name} not found in index. Update ${sourceSummary} now?`,
          isJapanese() ? "更新する" : "Update",
          isJapanese() ? "キャンセル" : "Cancel",
        );

        if (tryUpdate === (isJapanese() ? "更新する" : "Update")) {
          index = await refreshIndexForKnownSources(
            index,
            [source],
            skill.name,
          );

          fullSkill = index.skills.find(
            (s: Skill) =>
              getResourceKind(s) === resourceKind &&
              s.source === source &&
              s.path === remotePath,
          );
          if (!fullSkill && source === "unknown") {
            fullSkill = index.skills.find(
              (s: Skill) =>
                getResourceKind(s) === resourceKind && s.name === resourceName,
            );
          }
        }

        if (!fullSkill) {
          if (!suppressSuccessMessage) {
            vscode.window.showErrorMessage(
              isJapanese()
                ? `${skill.name} がインデックスに見つかりません。ソースリポジトリを確認してください。`
                : `${skill.name} not found in index. Please check source repositories.`,
            );
          }
          return false;
        }
      }

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: isJapanese()
              ? `${skill.name} を再インストール中...`
              : `Reinstalling ${skill.name}...`,
          },
          async () => {
            let uninstallResult:
              | Awaited<ReturnType<typeof uninstallSkillByPath>>
              | Awaited<ReturnType<typeof uninstallSkill>>
              | undefined;
            if (relativePath) {
              uninstallResult = await uninstallSkillByPath(
                relativePath,
                wsFolder.uri,
              );
            } else {
              uninstallResult = await uninstallSkill(skill.name, wsFolder.uri);
            }
            await installSkill(fullSkill, wsFolder.uri, context, {
              suppressRecoveryPrompt,
            });

            const config = vscode.workspace.getConfiguration("resourceNinja");
            if (
              resourceKind === "skill" &&
              config.get<boolean>("autoUpdateInstruction")
            ) {
              await updateInstructionFile(wsFolder.uri, context);
            }
            const hookConfigSummary = formatHookConfigUpdateSummary(
              uninstallResult?.hookConfigUpdate,
            );
            if (hookConfigSummary && !suppressSuccessMessage) {
              vscode.window.showInformationMessage(hookConfigSummary);
            }
          },
        );

        markRecentlyInstalled(fullSkill);

        // ステータスバーに表示
        statusBarItem.text = `$(sync) ${skill.name} ${
          isJapanese() ? "再インストール完了" : "reinstalled"
        }`;
        statusBarItem.show();
        setTimeout(() => statusBarItem.hide(), 4000);

        if (!suppressSuccessMessage) {
          vscode.window.showInformationMessage(
            isJapanese()
              ? `${skill.name} を再インストールしました`
              : `Reinstalled ${skill.name}`,
          );
        }
        workspaceProvider.refresh();
        browseProvider.refresh();
        return true;
      } catch (error) {
        if (!suppressSuccessMessage) {
          vscode.window.showErrorMessage(
            isJapanese()
              ? `再インストール失敗: ${String(error)}`
              : `Reinstall failed: ${String(error)}`,
          );
        }
        return false;
      }
    },
  );

  // Command: Reinstall remote-installed resources in a workspace resource-kind group
  const reinstallResourceGroupCmd = vscode.commands.registerCommand(
    "resourceNinja.reinstallResourceGroup",
    async (item?: SkillTreeItem) => {
      if (!item || item.contextValue !== "workspaceResourceType") {
        return;
      }

      const children = await workspaceProvider.getChildren(item);
      const remoteInstalledItems = children.filter(
        (child) =>
          child.contextValue === "installedRemoteSkill" ||
          child.contextValue === "installedRemoteResource",
      );

      if (remoteInstalledItems.length === 0) {
        vscode.window.showInformationMessage(
          isJapanese()
            ? "このグループにリモート由来の再インストール可能なリソースはありません"
            : "This group has no remote-installed resources to reinstall",
        );
        return;
      }

      const kindLabel = item.resourceKind
        ? getResourceKindLabel(item.resourceKind, isJapanese())
        : isJapanese()
          ? "リソース"
          : "Resources";
      const confirmLabel = isJapanese() ? "再インストール" : "Reinstall";
      const confirm = await vscode.window.showWarningMessage(
        isJapanese()
          ? `${kindLabel} グループの ${remoteInstalledItems.length} 個のリモートリソースを再インストールしますか？`
          : `Reinstall ${remoteInstalledItems.length} remote-installed resource(s) in ${kindLabel}?`,
        { modal: true },
        confirmLabel,
      );
      if (confirm !== confirmLabel) {
        return;
      }

      let success = 0;
      const failedResources: string[] = [];

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: isJapanese()
            ? `${kindLabel} グループを再インストール中...`
            : `Reinstalling ${kindLabel} group...`,
          cancellable: false,
        },
        async (progress) => {
          let completed = 0;
          for (const child of remoteInstalledItems) {
            progress.report({
              message: `${child.skill?.name || child.label} (${completed + 1}/${remoteInstalledItems.length})`,
              increment: 100 / remoteInstalledItems.length,
            });
            const ok = await vscode.commands.executeCommand<boolean>(
              "resourceNinja.reinstall",
              child,
              {
                suppressSuccessMessage: true,
                suppressRecoveryPrompt: true,
              },
            );
            if (ok) {
              success++;
            } else {
              failedResources.push(String(child.skill?.name || child.label));
            }
            completed++;
          }
        },
      );

      workspaceProvider.refresh();
      browseProvider.refresh();
      if (failedResources.length > 0) {
        vscode.window.showWarningMessage(
          getBatchFailureMessage(
            kindLabel,
            success,
            remoteInstalledItems.length,
            failedResources,
          ),
        );
      } else {
        vscode.window.showInformationMessage(
          isJapanese()
            ? `${kindLabel} グループの ${remoteInstalledItems.length} 個のリソースを再インストールしました`
            : `Reinstalled ${remoteInstalledItems.length} resource(s) in ${kindLabel}`,
        );
      }
    },
  );

  // Command: Uninstall all skills (with warning)
  const uninstallAllCmd = vscode.commands.registerCommand(
    "resourceNinja.uninstallAll",
    async () => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      const installed = await getInstalledSkills(wsFolder.uri);
      if (installed.length === 0) {
        vscode.window.showInformationMessage(messages.noInstalledSkills());
        return;
      }

      // 2段階確認
      const confirm1 = await vscode.window.showWarningMessage(
        isJapanese()
          ? `⚠️ ${installed.length} 個のスキルを全て削除しますか？`
          : `⚠️ Delete all ${installed.length} skills?`,
        { modal: true },
        isJapanese() ? "続ける" : "Continue",
      );

      if (!confirm1) {
        return;
      }

      const confirm2 = await vscode.window.showWarningMessage(
        isJapanese()
          ? `本当に全てのスキルを削除しますか？この操作は元に戻せません。`
          : `Are you sure you want to delete ALL skills? This cannot be undone.`,
        { modal: true },
        isJapanese() ? "全て削除" : "Delete All",
      );

      if (!confirm2) {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: isJapanese()
            ? "全スキルを削除中..."
            : "Deleting all skills...",
          cancellable: false,
        },
        async (progress) => {
          let completed = 0;
          for (const skillName of installed) {
            progress.report({
              message: `${skillName} (${completed + 1}/${installed.length})`,
              increment: 100 / installed.length,
            });
            try {
              await uninstallSkill(skillName, wsFolder.uri);
            } catch (error) {
              logger.error(`Failed to uninstall ${skillName}:`, error);
            }
            completed++;
          }
        },
      );

      const config = vscode.workspace.getConfiguration("resourceNinja");
      if (config.get<boolean>("autoUpdateInstruction")) {
        await updateInstructionFile(wsFolder.uri, context);
      }

      workspaceProvider.refresh();
      browseProvider.refresh();
      vscode.window.showInformationMessage(
        isJapanese()
          ? `${installed.length} 個のスキルを削除しました`
          : `Deleted ${installed.length} skills`,
      );
    },
  );

  // Command: Install Curated Set / plugin contents checklist
  const installBundleCmd = vscode.commands.registerCommand(
    "resourceNinja.installBundle",
    async (item?: SkillTreeItem) => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      const bundle = item?.bundle;
      if (!bundle) {
        vscode.window.showErrorMessage(
          isJapanese()
            ? "選択インストール情報がありません"
            : "No grouped install information",
        );
        return;
      }
      const isPluginPick = bundle.id.startsWith("plugin:");

      const index = await loadSkillIndex(context);

      // インストール順序を決定（installOrderがあればそれを使用、なければskills配列）
      const installOrder = bundle.installOrder || bundle.skills;
      const bundleResources = installOrder
        .map((skillName) => {
          const skill =
            index.skills.find(
              (s: Skill) => s.name === skillName && s.source === bundle.source,
            ) ||
            index.skills.find(
              (s: Skill) => s.path === skillName && s.source === bundle.source,
            );
          return { skillName, skill };
        })
        .filter(
          (entry): entry is { skillName: string; skill: Skill } =>
            !!entry.skill,
        );
      const missingResources = installOrder.filter(
        (skillName) =>
          !bundleResources.some((entry) => entry.skillName === skillName),
      );

      if (bundleResources.length === 0) {
        vscode.window.showErrorMessage(
          isJapanese()
            ? `${bundle.name} にインストール可能なリソースが見つかりません`
            : `No installable resources found in ${bundle.name}`,
        );
        return;
      }

      if (missingResources.length > 0) {
        logger.warn(
          `[Resource Ninja] Install set ${bundle.id} has missing resources:`,
          missingResources,
        );
      }

      const selectableItems = bundleResources.map(({ skill }) => {
        const kind = getResourceKind(skill);
        const description = getResourceKindLabel(kind, isJapanese());
        const detail =
          isJapanese() && skill.description_ja
            ? skill.description_ja
            : skill.description ||
              (isJapanese() ? "説明なし" : "No description");
        return {
          label: `$(${getResourceKindIcon(kind)}) ${skill.name}`,
          description,
          detail:
            kind === "mcp"
              ? isJapanese()
                ? `${detail} / MCP config はコピーのみ、または .vscode/mcp.json へのマージを選べます`
                : `${detail} / MCP config can be copied only or merged into .vscode/mcp.json`
              : detail,
          picked: true,
          skill,
        };
      });

      const selectedItems = await vscode.window.showQuickPick(selectableItems, {
        canPickMany: true,
        placeHolder: isJapanese()
          ? isPluginPick
            ? `${bundle.name} からインストールする中身を選択（すべて選択済み、不要なら解除）`
            : `${bundle.name} からインストールするリソースを選択（すべて選択済み、不要なら解除）`
          : isPluginPick
            ? `Select indexed contents to install from ${bundle.name} (everything is preselected)`
            : `Select resources to install from ${bundle.name} (everything is preselected)`,
        title: isJapanese()
          ? isPluginPick
            ? "プラグイン中身の選択"
            : "おすすめセット対象の選択"
          : isPluginPick
            ? "Select Plugin Contents"
            : "Select Curated Set Resources",
      });

      if (!selectedItems || selectedItems.length === 0) {
        return;
      }

      const installTarget = await pickInstallTarget(selectedItems[0].skill);
      if (!installTarget) {
        return;
      }

      if (missingResources.length > 0) {
        vscode.window.showWarningMessage(
          isJapanese()
            ? `${bundle.name}: ${missingResources.length} 個のリソースがインデックス内で見つからなかったためスキップします`
            : `${bundle.name}: ${missingResources.length} resources were not found in the index and will be skipped`,
        );
      }

      const selectedKindCounts = selectedItems.reduce(
        (counts, selectedItem) => {
          const kind = getResourceKind(selectedItem.skill);
          counts.set(kind, (counts.get(kind) || 0) + 1);
          return counts;
        },
        new Map<ResourceKind, number>(),
      );
      const selectedKindSummary = Array.from(selectedKindCounts.entries())
        .map(
          ([kind, count]) =>
            `${getResourceKindLabel(kind, isJapanese())}: ${count}`,
        )
        .join(", ");
      const hasMcpConfig = selectedKindCounts.has("mcp");
      const mcpInstallOptions = hasMcpConfig
        ? await pickMcpInstallMode(selectedKindCounts.get("mcp") || 0)
        : {};
      if (!mcpInstallOptions) {
        return;
      }

      // 確認ダイアログ
      const confirm = await vscode.window.showInformationMessage(
        isJapanese()
          ? isPluginPick
            ? `「${bundle.name}」から選択した ${selectedItems.length} 個の中身をインストールしますか？\n${selectedKindSummary}\nこれはプラグイン本体ではなく、インデックス済み中身の選択 install です。${hasMcpConfig ? "\nMCP config は選択した方法で処理します。" : ""}`
            : `おすすめセット「${bundle.name}」から選択した ${selectedItems.length} 個のリソースをインストールしますか？\n${selectedKindSummary}\nこれは curated なおすすめまとめ install ショートカットです。${hasMcpConfig ? "\nMCP config は選択した方法で処理します。" : ""}`
          : isPluginPick
            ? `Install ${selectedItems.length} selected contents from "${bundle.name}"?\n${selectedKindSummary}\nThis installs indexed contents only, not the plugin package itself.${hasMcpConfig ? "\nMCP config files will use the selected activation mode." : ""}`
            : `Install ${selectedItems.length} selected resources from curated set "${bundle.name}"?\n${selectedKindSummary}\nThis is a curated install shortcut.${hasMcpConfig ? "\nMCP config files will use the selected activation mode." : ""}`,
        { modal: true },
        isJapanese() ? "インストール" : "Install",
      );

      if (!confirm) {
        return;
      }

      let completed = 0;
      let failed = 0;
      let installedSkills = 0;
      const failedResources: string[] = [];
      const mcpConfigSummaries: string[] = [];

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: isJapanese()
            ? isPluginPick
              ? `${bundle.name} の中身をインストール中...`
              : `${bundle.name} をインストール中...`
            : isPluginPick
              ? `Installing selected contents from ${bundle.name}...`
              : `Installing ${bundle.name}...`,
          cancellable: false,
        },
        async (progress) => {
          for (const selectedItem of selectedItems) {
            const skill = selectedItem.skill;
            progress.report({
              message: `${skill.name} (${completed + 1}/${selectedItems.length})`,
              increment: 100 / selectedItems.length,
            });

            try {
              const installResult = await installSkill(
                skill,
                wsFolder.uri,
                context,
                {
                  ...installTarget,
                  ...mcpInstallOptions,
                  suppressRecoveryPrompt: true,
                },
              );
              const mcpConfigSummary = formatMcpConfigUpdateSummary(
                installResult.mcpConfigUpdate,
              );
              if (mcpConfigSummary) {
                mcpConfigSummaries.push(`${skill.name}: ${mcpConfigSummary}`);
              }
              markRecentlyInstalled(skill);
              if (getResourceKind(skill) === "skill") {
                installedSkills++;
              }
            } catch (error) {
              logger.error(`Failed to install ${skill.name}:`, error);
              failed++;
              failedResources.push(skill.name);
            }
            completed++;
          }
        },
      );

      // 結果を表示
      if (failed > 0) {
        const updateSource = isJapanese()
          ? "このソースのインデックスを更新"
          : "Update This Source Index";
        const failedSummary = failedResources.slice(0, 3).join(", ");
        const choice = await vscode.window.showWarningMessage(
          isJapanese()
            ? `${bundle.name}: ${completed - failed}/${
                selectedItems.length
              } 個インストール完了（${failed} 個失敗: ${failedSummary}${
                failedResources.length > 3 ? "..." : ""
              }）。上流の plugin/resource path が変わっている可能性があります。`
            : `${bundle.name}: ${completed - failed}/${
                selectedItems.length
              } installed (${failed} failed: ${failedSummary}${
                failedResources.length > 3 ? "..." : ""
              }). Upstream plugin/resource paths may have changed.`,
          updateSource,
        );
        if (choice === updateSource) {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: isJapanese()
                ? `${bundle.name} のソースインデックスを更新中...`
                : `Updating source index for ${bundle.name}...`,
              cancellable: false,
            },
            async (progress) => {
              const currentIndex = await loadSkillIndex(context);
              await updateIndexFromSingleSource(
                context,
                currentIndex,
                bundle.source,
                progress,
                { forceScan: true },
              );
            },
          );
          browseProvider.refresh();
        }
      } else {
        const skippedSummary = missingResources.length
          ? isJapanese()
            ? `、${missingResources.length} 個スキップ`
            : `, ${missingResources.length} skipped`
          : "";
        vscode.window.showInformationMessage(
          isJapanese()
            ? isPluginPick
              ? `${bundle.name} の中身インストール完了（${selectedItems.length} 個のリソース${skippedSummary}）`
              : `${bundle.name} のインストール完了（${selectedItems.length} 個のリソース${skippedSummary}）`
            : isPluginPick
              ? `${bundle.name} contents installed (${selectedItems.length} resources${skippedSummary})`
              : `${bundle.name} installed (${selectedItems.length} resources${skippedSummary})`,
        );
      }

      if (mcpConfigSummaries.length > 0) {
        vscode.window.showInformationMessage(mcpConfigSummaries.join("\n"));
      }

      // Instruction ファイルを更新
      const config = vscode.workspace.getConfiguration("resourceNinja");
      if (
        installedSkills > 0 &&
        canInstructionSyncForTarget(installTarget) &&
        config.get<boolean>("autoUpdateInstruction")
      ) {
        await updateInstructionFile(wsFolder.uri, context);
      }

      workspaceProvider.refresh();
      browseProvider.refresh();
    },
  );

  const installPluginResourcesCmd = vscode.commands.registerCommand(
    "resourceNinja.installPluginResources",
    async (item?: SkillTreeItem) => {
      if (!item?.bundle) {
        vscode.window.showErrorMessage(
          isJapanese()
            ? "プラグイン中身のグループ情報がありません"
            : "No grouped plugin contents information",
        );
        return;
      }
      await vscode.commands.executeCommand("resourceNinja.installBundle", item);
    },
  );

  // Command: Uninstall multiple skills (QuickPick)
  const uninstallMultipleCmd = vscode.commands.registerCommand(
    "resourceNinja.uninstallMultiple",
    async () => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      const installed = await getInstalledSkills(wsFolder.uri);
      if (installed.length === 0) {
        vscode.window.showInformationMessage(messages.noInstalledSkills());
        return;
      }

      const selected = await vscode.window.showQuickPick(
        installed.map((name: string) => ({
          label: name,
          picked: false,
        })),
        {
          canPickMany: true,
          placeHolder: isJapanese()
            ? "削除するスキルを選択（複数選択可）"
            : "Select skills to uninstall (multiple selection)",
        },
      );

      if (!selected || selected.length === 0) {
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        isJapanese()
          ? `${selected.length} 個のスキルを削除しますか？`
          : `Delete ${selected.length} skills?`,
        { modal: true },
        isJapanese() ? "削除" : "Delete",
      );

      if (!confirm) {
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: isJapanese() ? "スキルを削除中..." : "Deleting skills...",
          cancellable: false,
        },
        async (progress) => {
          let completed = 0;
          for (const item of selected) {
            progress.report({
              message: `${item.label} (${completed + 1}/${selected.length})`,
              increment: 100 / selected.length,
            });
            try {
              await uninstallSkill(item.label, wsFolder.uri);
            } catch (error) {
              logger.error(`Failed to uninstall ${item.label}:`, error);
            }
            completed++;
          }
        },
      );

      const config = vscode.workspace.getConfiguration("resourceNinja");
      if (config.get<boolean>("autoUpdateInstruction")) {
        await updateInstructionFile(wsFolder.uri, context);
      }

      workspaceProvider.refresh();
      browseProvider.refresh();
      vscode.window.showInformationMessage(
        isJapanese()
          ? `${selected.length} 個のスキルを削除しました`
          : `Deleted ${selected.length} skills`,
      );
    },
  );

  // Command: Reinstall multiple skills (QuickPick)
  const reinstallMultipleCmd = vscode.commands.registerCommand(
    "resourceNinja.reinstallMultiple",
    async () => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      const installedMeta = await getInstalledSkillsWithMeta(wsFolder.uri);
      if (installedMeta.length === 0) {
        vscode.window.showInformationMessage(messages.noInstalledSkills());
        return;
      }

      const selected = await vscode.window.showQuickPick(
        installedMeta.map((meta) => ({
          label: meta.name,
          description: meta.source,
          picked: false,
          meta,
        })),
        {
          canPickMany: true,
          placeHolder: isJapanese()
            ? "再インストールするスキルを選択（複数選択可）"
            : "Select skills to reinstall (multiple selection)",
        },
      );

      if (!selected || selected.length === 0) {
        return;
      }

      const index = await loadSkillIndex(context);
      let success = 0;
      const failedSkills: string[] = [];

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: isJapanese()
            ? "スキルを再インストール中..."
            : "Reinstalling skills...",
          cancellable: false,
        },
        async (progress) => {
          let completed = 0;
          for (const item of selected) {
            progress.report({
              message: `${item.label} (${completed + 1}/${selected.length})`,
              increment: 100 / selected.length,
            });

            let skill = index.skills.find(
              (s: Skill) =>
                s.name === item.meta.name && s.source === item.meta.source,
            );
            // source が "unknown" の場合は name だけで検索
            if (!skill && item.meta.source === "unknown") {
              skill = index.skills.find(
                (s: Skill) => s.name === item.meta.name,
              );
            }

            if (skill) {
              try {
                await uninstallSkill(item.meta.name, wsFolder.uri);
                await installSkill(skill, wsFolder.uri, context, {
                  suppressRecoveryPrompt: true,
                });
                markRecentlyInstalled(skill);
                success++;
              } catch (error) {
                logger.error(`Failed to reinstall ${item.meta.name}:`, error);
                failedSkills.push(item.meta.name);
              }
            } else {
              failedSkills.push(item.meta.name);
            }
            completed++;
          }
        },
      );

      const config = vscode.workspace.getConfiguration("resourceNinja");
      if (config.get<boolean>("autoUpdateInstruction")) {
        await updateInstructionFile(wsFolder.uri, context);
      }

      workspaceProvider.refresh();
      browseProvider.refresh();
      if (failedSkills.length > 0) {
        vscode.window.showWarningMessage(
          getBatchFailureMessage(
            isJapanese() ? "スキル再インストール" : "Skill reinstall",
            success,
            selected.length,
            failedSkills,
          ),
        );
      } else {
        vscode.window.showInformationMessage(
          isJapanese()
            ? `${selected.length} 個のスキルを再インストールしました`
            : `Reinstalled ${selected.length} skills`,
        );
      }
    },
  );

  // Command: Show installed skills
  const showInstalledCmd = vscode.commands.registerCommand(
    "resourceNinja.showInstalled",
    async () => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      const installed = await getInstalledSkills(wsFolder.uri);
      if (installed.length === 0) {
        vscode.window.showInformationMessage(messages.noInstalledSkills());
        return;
      }

      const selected = await vscode.window.showQuickPick<vscode.QuickPickItem>(
        installed.map((name: string) => ({
          label: name,
          description: `$(folder) ${messages.installedFolder()}`,
        })),
        {
          placeHolder: messages.installedSkillsPlaceholder(),
          canPickMany: false,
        },
      );

      if (selected) {
        const config = vscode.workspace.getConfiguration(
          "resourceNinja",
          wsFolder.uri,
        );
        const skillsDir = getConfiguredSkillsDirectory(config);
        const skillPath = vscode.Uri.joinPath(
          wsFolder.uri,
          skillsDir,
          selected.label,
          "SKILL.md",
        );

        try {
          await vscode.window.showTextDocument(skillPath);
        } catch {
          vscode.window.showWarningMessage(
            messages.skillNotFound(selected.label),
          );
        }
      }
    },
  );

  // Command: Update index
  const updateIndexCmd = vscode.commands.registerCommand(
    "resourceNinja.updateIndex",
    async () => {
      if (!skillIndex) {
        skillIndex = await loadSkillIndex(context);
      }

      const oldCount = skillIndex.skills.length;

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: messages.updatingIndex(),
            cancellable: false,
          },
          async (progress) => {
            skillIndex = await updateIndexFromSources(
              context,
              skillIndex!,
              progress,
            );
          },
        );
        const newCount = skillIndex.skills.length;
        const diff = newCount - oldCount;
        const diffText = diff > 0 ? `+${diff}` : diff === 0 ? "±0" : `${diff}`;
        vscode.window.showInformationMessage(
          messages.indexUpdated(oldCount, newCount, diffText),
        );
        browseProvider.refresh();
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (
          errorMessage.includes("rate limit") ||
          errorMessage.includes("authentication")
        ) {
          await showAuthHelp();
        } else {
          vscode.window.showErrorMessage(messages.updateFailed(errorMessage));
        }
      }
    },
  );

  // Command: Update single source
  const updateSourceIndexCmd = vscode.commands.registerCommand(
    "resourceNinja.updateSourceIndex",
    async (item?: SkillTreeItem) => {
      const isSourceItem =
        item?.contextValue === "source" ||
        item?.contextValue === "remoteKindSource";
      if (!isSourceItem) {
        vscode.window.showErrorMessage(messages.updateSourceSelectRequired());
        return;
      }

      const sourceId = item.source?.id;
      if (!sourceId) {
        vscode.window.showErrorMessage(messages.sourceIdNotFound());
        return;
      }

      if (!skillIndex) {
        skillIndex = await loadSkillIndex(context);
      }

      const oldCount = skillIndex.skills.filter(
        (s) => s.source === sourceId,
      ).length;

      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: messages.updatingSource(item.source?.name || sourceId),
            cancellable: false,
          },
          async (progress) => {
            skillIndex = await updateIndexFromSingleSource(
              context,
              skillIndex!,
              sourceId,
              progress,
              { forceScan: true },
            );
          },
        );
        const newCount = skillIndex.skills.filter(
          (s) => s.source === sourceId,
        ).length;
        const diff = newCount - oldCount;
        const diffText = diff > 0 ? `+${diff}` : diff === 0 ? "±0" : `${diff}`;
        vscode.window.showInformationMessage(
          `Updated ${item.source?.name || sourceId}: ${oldCount} → ${newCount} skills (${diffText})`,
        );
        browseProvider.refresh();
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (
          errorMessage.includes("rate limit") ||
          errorMessage.includes("authentication")
        ) {
          await showAuthHelp();
        } else {
          vscode.window.showErrorMessage(messages.updateFailed(errorMessage));
        }
      }
    },
  );

  // Command: Add source
  const addSourceCmd = vscode.commands.registerCommand(
    "resourceNinja.addSource",
    async (urlArg?: string | unknown) => {
      const normalizeRepoUrl = (value: string): string | undefined => {
        const trimmed = value.trim();
        if (!trimmed) return undefined;

        if (trimmed.startsWith("http")) {
          const match = trimmed.match(
            /^(https:\/\/github\.com\/[^/]+\/[^/]+)(?:\/(?:tree|blob)\/.*)?\/?$/i,
          );
          return match ? match[1] : undefined;
        }

        return trimmed.match(/^[^/]+\/[^/]+$/)
          ? `https://github.com/${trimmed}`
          : undefined;
      };

      // 引数で URL が渡された場合はそれを使用、なければ入力を求める
      // TreeViewから呼ばれた場合、urlArgがオブジェクトになる可能性があるため型チェック
      let repoUrl: string | undefined =
        typeof urlArg === "string" ? normalizeRepoUrl(urlArg) : undefined;

      // 渡された URL のバリデーション
      if (typeof urlArg === "string" && !repoUrl) {
        vscode.window.showErrorMessage(messages.invalidRepoUrl());
        return;
      }

      if (!repoUrl) {
        repoUrl = await vscode.window.showInputBox({
          prompt: messages.enterRepoUrl(),
          placeHolder: messages.repoUrlPlaceholder(),
          validateInput: (value) => {
            if (!normalizeRepoUrl(value)) {
              return messages.invalidRepoUrl();
            }
            return null;
          },
        });
        if (repoUrl) {
          repoUrl = normalizeRepoUrl(repoUrl);
        }
      }

      if (!repoUrl) {
        return;
      }

      if (!skillIndex) {
        skillIndex = await loadSkillIndex(context);
      }

      try {
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: messages.scanningRepo(),
            cancellable: false,
          },
          async () => {
            return await addSource(context, skillIndex!, repoUrl);
          },
        );

        skillIndex = result.index;
        vscode.window.showInformationMessage(
          messages.sourceAdded(result.addedSkills),
        );
        // 更新されたインデックスを直接設定
        browseProvider.setIndex(skillIndex);
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (
          errorMessage.includes("rate limit") ||
          errorMessage.includes("authentication")
        ) {
          await showAuthHelp();
        } else if (errorMessage.includes("No resources found")) {
          vscode.window.showWarningMessage(messages.noSkillsInRepo());
        } else {
          vscode.window.showErrorMessage(
            messages.addSourceFailed(errorMessage),
          );
        }
      }
    },
  );

  // Command: Web search (improved with continuous search and preview)
  const webSearchCmd = vscode.commands.registerCommand(
    "resourceNinja.webSearch",
    async () => {
      const config = vscode.workspace.getConfiguration("resourceNinja");
      const token = config.get<string>("githubToken");

      // 連続検索のためのループ
      let continueSearch = true;
      while (continueSearch) {
        const query = await vscode.window.showInputBox({
          prompt: messages.webSearchPrompt(),
          placeHolder: messages.webSearchPlaceholder(),
        });

        if (!query) {
          return;
        }

        try {
          const results = await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: messages.searchingGitHub(),
              cancellable: false,
            },
            async () => {
              return await searchGitHub(query, token);
            },
          );

          if (results.length === 0) {
            const retry = await vscode.window.showInformationMessage(
              messages.noSearchResults(query),
              messages.actionNewSearch(),
              messages.actionCancel(),
            );
            if (retry !== messages.actionNewSearch()) {
              continueSearch = false;
            }
            continue;
          }

          interface WebSearchQuickPickItem extends vscode.QuickPickItem {
            result: (typeof results)[0];
            action?: string;
            buttons?: vscode.QuickInputButton[];
          }

          // アイテムボタンの定義
          const openGitHubButton: vscode.QuickInputButton = {
            iconPath: new vscode.ThemeIcon("link-external"),
            tooltip: messages.actionOpenGitHub(),
          };
          const copyUrlButton: vscode.QuickInputButton = {
            iconPath: new vscode.ThemeIcon("copy"),
            tooltip: isJapanese() ? "URLをコピー" : "Copy URL",
          };

          // スター数でソート（人気順）
          const sortedResults = [...results].sort((a, b) => {
            const starsA = a.stars ?? 0;
            const starsB = b.stars ?? 0;
            return starsB - starsA;
          });

          // 結果選択ループ
          let selectMore = true;
          while (selectMore) {
            const items: WebSearchQuickPickItem[] = [
              // 新しい検索オプションを先頭に
              {
                label: `$(search) ${messages.actionNewSearch()}`,
                description: "",
                detail: "",
                result: sortedResults[0],
                action: "new-search",
              },
              // 検索結果（スター数・組織情報でハイライト）
              ...sortedResults.map((r) => {
                // ラベルにバッジを追加
                let label = `$(package) ${r.name}`;
                const badges: string[] = [];
                if (r.kind) {
                  badges.push(getResourceKindLabel(r.kind, isJapanese()));
                }

                if (r.stars && r.stars >= 100) {
                  badges.push(`⭐${r.stars}`);
                }
                if (r.isOrg) {
                  badges.push("🏢");
                }

                if (badges.length > 0) {
                  label = `${badges.join(" ")} ${label}`;
                }

                return {
                  label,
                  description: r.repo,
                  detail:
                    r.description + (r.stars ? ` (${r.stars} stars)` : ""),
                  result: r,
                  buttons: [openGitHubButton, copyUrlButton],
                };
              }),
            ];

            // createQuickPick API でボタン対応
            const quickPick =
              vscode.window.createQuickPick<WebSearchQuickPickItem>();
            quickPick.items = items;
            quickPick.placeholder = messages.searchResultsCount(results.length);
            quickPick.matchOnDescription = true;
            quickPick.matchOnDetail = true;

            const selected = await new Promise<
              WebSearchQuickPickItem | undefined
            >((resolve) => {
              quickPick.onDidAccept(() => {
                resolve(quickPick.selectedItems[0]);
                quickPick.hide();
              });
              quickPick.onDidHide(() => {
                resolve(undefined);
                quickPick.dispose();
              });
              quickPick.onDidTriggerItemButton(async (e) => {
                const item = e.item;
                const branch = item.result.defaultBranch || "main";
                const url = buildGitHubResourceUrl(
                  item.result.repoUrl,
                  branch,
                  {
                    kind: item.result.kind,
                    path: item.result.path,
                  },
                );

                if (e.button === openGitHubButton) {
                  // GitHub を開く（QuickPick は閉じない）
                  await vscode.env.openExternal(vscode.Uri.parse(url));
                } else if (e.button === copyUrlButton) {
                  // URL をクリップボードにコピー
                  await vscode.env.clipboard.writeText(url);
                  vscode.window.showInformationMessage(
                    isJapanese()
                      ? `URLをコピーしました: ${item.result.name}`
                      : `URL copied: ${item.result.name}`,
                  );
                }
              });
              quickPick.show();
            });

            if (!selected) {
              selectMore = false;
              continueSearch = false;
              break;
            }

            if (selected.action === "new-search") {
              selectMore = false;
              break;
            }

            // アクション選択
            const action = await vscode.window.showQuickPick(
              [
                {
                  label: `$(eye) ${messages.actionPreview()}`,
                  value: "preview",
                },
                {
                  label: `$(add) ${messages.actionAddSourceRepo()}`,
                  value: "add-source",
                },
                {
                  label: `$(link-external) ${messages.actionOpenGitHub()}`,
                  value: "open",
                },
                {
                  label: `$(copy) ${isJapanese() ? "URLをコピー" : "Copy URL"}`,
                  value: "copy-url",
                },
                {
                  label: `$(arrow-left) ${messages.actionBack()}`,
                  value: "back",
                },
              ],
              {
                placeHolder: `${selected.result.name} (${selected.result.repo})`,
              },
            );

            if (!action || action.value === "back") {
              // 結果一覧に戻る
              continue;
            }

            if (action.value === "preview") {
              // プレビュー表示
              const branch = selected.result.defaultBranch || "main";
              const githubUrl = buildGitHubResourceUrl(
                selected.result.repoUrl,
                branch,
                {
                  kind: selected.result.kind,
                  path: selected.result.path,
                },
              );
              const rawUrl = buildGitHubRawUrl(
                selected.result.repoUrl,
                branch,
                {
                  kind: selected.result.kind,
                  path: selected.result.path,
                },
              );
              const skill: Skill = {
                kind: selected.result.kind,
                name: selected.result.name,
                description: selected.result.description || "",
                source: selected.result.repo,
                url: githubUrl,
                rawUrl: rawUrl,
                path: selected.result.path,
                categories: [],
                stars: selected.result.stars,
                owner: selected.result.repo.split("/")[0],
                isOrg: selected.result.isOrg,
              };
              await showSkillPreview(skill, context);
              // 結果一覧に戻る
              continue;
            } else if (action.value === "add-source") {
              await vscode.commands.executeCommand(
                "resourceNinja.addSource",
                selected.result.repoUrl,
              );
              selectMore = false;
              continueSearch = false;
            } else if (action.value === "open") {
              const branch = selected.result.defaultBranch || "main";
              const url = buildGitHubResourceUrl(
                selected.result.repoUrl,
                branch,
                {
                  kind: selected.result.kind,
                  path: selected.result.path,
                },
              );
              await vscode.env.openExternal(vscode.Uri.parse(url));
              // 結果一覧に戻る
              continue;
            } else if (action.value === "copy-url") {
              const branch = selected.result.defaultBranch || "main";
              const url = buildGitHubResourceUrl(
                selected.result.repoUrl,
                branch,
                {
                  kind: selected.result.kind,
                  path: selected.result.path,
                },
              );
              await vscode.env.clipboard.writeText(url);
              vscode.window.showInformationMessage(
                isJapanese()
                  ? `URLをコピーしました: ${selected.result.name}`
                  : `URL copied: ${selected.result.name}`,
              );
              // 結果一覧に戻る
              continue;
            }
          }
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          if (
            errorMessage.includes("rate limit") ||
            errorMessage.includes("authentication")
          ) {
            await showAuthHelp();
          } else {
            vscode.window.showErrorMessage(messages.searchFailed(errorMessage));
          }
          continueSearch = false;
        }
      }
    },
  );

  // Command: Remove source
  const removeSourceCmd = vscode.commands.registerCommand(
    "resourceNinja.removeSource",
    async (item?: SkillTreeItem) => {
      if (!skillIndex) {
        skillIndex = await loadSkillIndex(context);
      }

      let sourceId: string | undefined;
      let sourceName: string | undefined;

      if (item && item.source) {
        sourceId = item.source.id;
        sourceName = item.source.name;
      } else {
        interface SourceQuickPickItem extends vscode.QuickPickItem {
          sourceId: string;
        }

        const sources: SourceQuickPickItem[] = skillIndex.sources.map(
          (s: Source) => ({
            label: s.name,
            description: s.url,
            detail: `${
              skillIndex!.skills.filter((sk: Skill) => sk.source === s.id)
                .length
            } skills`,
            sourceId: s.id,
          }),
        );

        const selected = await vscode.window.showQuickPick(sources, {
          placeHolder: messages.selectSourceToRemove(),
        });

        if (!selected) {
          return;
        }

        sourceId = selected.sourceId;
        sourceName = selected.label;
      }

      const confirm = await vscode.window.showWarningMessage(
        messages.confirmRemoveSource(sourceName!),
        { modal: true },
        messages.actionRemove(),
      );

      if (confirm !== messages.actionRemove()) {
        return;
      }

      try {
        const result = await removeSource(context, skillIndex, sourceId!);
        skillIndex = result.index;
        vscode.window.showInformationMessage(
          messages.sourceRemoved(result.removedSkills),
        );
        browseProvider.refresh();
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(
          messages.removeSourceFailed(errorMessage),
        );
      }
    },
  );

  // Command: Preview skill
  const previewCmd = vscode.commands.registerCommand(
    "resourceNinja.preview",
    async (skillOrItem?: Skill | SkillTreeItem) => {
      let skill: Skill | undefined;

      if (skillOrItem && "skill" in skillOrItem) {
        skill = skillOrItem.skill;
      } else if (skillOrItem && "name" in skillOrItem) {
        skill = skillOrItem as Skill;
      } else {
        // QuickPick で選択
        if (!skillIndex) {
          skillIndex = await loadSkillIndex(context);
        }

        const items: SkillQuickPickItem[] = searchSkills(skillIndex, "");
        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: messages.searchPlaceholder(),
          matchOnDescription: true,
          matchOnDetail: true,
        });

        skill = selected?.skill;
      }

      if (skill) {
        await showSkillPreview(skill, context);
      }
    },
  );

  // Command: Toggle favorite
  const toggleFavoriteCmd = vscode.commands.registerCommand(
    "resourceNinja.toggleFavorite",
    async (skillOrItem?: Skill | SkillTreeItem) => {
      let skill: Skill | undefined;

      if (skillOrItem && "skill" in skillOrItem) {
        skill = skillOrItem.skill;
      } else if (skillOrItem && "name" in skillOrItem) {
        skill = skillOrItem as Skill;
      }

      if (!skill) {
        return;
      }

      const skillId = getSkillId(skill);
      const favorites = context.globalState.get<string[]>("favorites", []);
      const isFavorite = favorites.includes(skillId);

      if (isFavorite) {
        // 削除
        const newFavorites = favorites.filter((f) => f !== skillId);
        await context.globalState.update("favorites", newFavorites);
        vscode.window.showInformationMessage(messages.removeFromFavorites());
      } else {
        // 追加
        favorites.push(skillId);
        await context.globalState.update("favorites", favorites);
        vscode.window.showInformationMessage(messages.addToFavorites());
      }

      browseProvider.refresh();
    },
  );

  // Command: Show favorites
  const showFavoritesCmd = vscode.commands.registerCommand(
    "resourceNinja.showFavorites",
    async () => {
      if (!skillIndex) {
        skillIndex = await loadSkillIndex(context);
      }

      const favorites = context.globalState.get<string[]>("favorites", []);

      if (favorites.length === 0) {
        vscode.window.showInformationMessage(messages.noFavorites());
        return;
      }

      const favoriteSkills = skillIndex.skills.filter((s) =>
        favorites.includes(getSkillId(s)),
      );

      if (favoriteSkills.length === 0) {
        vscode.window.showInformationMessage(messages.noFavorites());
        return;
      }

      interface FavoriteQuickPickItem extends vscode.QuickPickItem {
        skill: Skill;
      }

      const items: FavoriteQuickPickItem[] = favoriteSkills.map((s) => ({
        label: `$(star-full) ${s.name}`,
        description: s.source,
        detail: s.description,
        skill: s,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: messages.favorites(),
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (selected) {
        const action = await vscode.window.showQuickPick(
          [
            { label: `$(eye) ${messages.actionPreview()}`, value: "preview" },
            { label: `$(add) ${messages.actionInstall()}`, value: "install" },
            {
              label: `$(star) ${messages.removeFromFavorites()}`,
              value: "unfavorite",
            },
          ],
          { placeHolder: selected.skill.name },
        );

        if (action?.value === "preview") {
          await showSkillPreview(selected.skill, context);
        } else if (action?.value === "install") {
          await vscode.commands.executeCommand(
            "resourceNinja.install",
            selected.skill,
          );
        } else if (action?.value === "unfavorite") {
          await vscode.commands.executeCommand(
            "resourceNinja.toggleFavorite",
            selected.skill,
          );
        }
      }
    },
  );

  // Command: Browse by category
  const browseByCategoryCmd = vscode.commands.registerCommand(
    "resourceNinja.browseByCategory",
    async () => {
      if (!skillIndex) {
        skillIndex = await loadSkillIndex(context);
      }

      const categoryCounts = new Map<string, number>();
      for (const skill of skillIndex.skills) {
        for (const category of skill.categories || []) {
          categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
        }
      }

      const categories = Array.from(categoryCounts.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([category, count]) => ({
          label: category,
          description: `${count}`,
          category,
        }));

      const selectedCategory = await vscode.window.showQuickPick(
        [
          {
            label: messages.allCategories(),
            description: `${skillIndex.skills.length}`,
            category: "",
          },
          ...categories,
        ],
        { placeHolder: messages.selectCategory() },
      );

      if (!selectedCategory) {
        return;
      }

      const resources = selectedCategory.category
        ? skillIndex.skills.filter((skill) =>
            skill.categories?.includes(selectedCategory.category),
          )
        : skillIndex.skills;
      const items: SkillQuickPickItem[] = resources.map((skill) => ({
        label: `$(package) ${skill.name}`,
        description: skill.source,
        detail: skill.description,
        skill,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: messages.skillsInCategory(
          selectedCategory.label,
          resources.length,
        ),
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (selected) {
        await showSkillPreview(selected.skill, context);
      }
    },
  );

  // Command: Show recent resources
  const showRecentCmd = vscode.commands.registerCommand(
    "resourceNinja.showRecent",
    async () => {
      if (recentlyInstalled.size === 0) {
        vscode.window.showInformationMessage(messages.noRecentSkills());
        return;
      }

      if (!skillIndex) {
        skillIndex = await loadSkillIndex(context);
      }

      const recentResources = Array.from(
        new Map(
          Array.from(recentlyInstalledResources.values()).map((skill) => [
            getSkillId(skill),
            skill,
          ]),
        ).values(),
      );

      if (recentResources.length === 0) {
        vscode.window.showInformationMessage(messages.noRecentSkills());
        return;
      }

      const items: SkillQuickPickItem[] = recentResources.map((skill) => ({
        label: `$(history) ${skill.name}`,
        description: skill.source,
        detail: skill.description,
        skill,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: messages.recentlyInstalled(),
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (selected) {
        await showSkillPreview(selected.skill, context);
      }
    },
  );

  // Command: Open on GitHub
  const openOnGitHubCmd = vscode.commands.registerCommand(
    "resourceNinja.openOnGitHub",
    async (skillOrItem?: SkillTreeItem | Skill) => {
      let url: string | undefined;

      if (skillOrItem instanceof SkillTreeItem) {
        if (skillOrItem.skill) {
          url = await getSkillGitHubUrlAsync(
            skillOrItem.skill,
            skillIndex?.sources || [],
          );
        } else if (skillOrItem.source) {
          url = skillOrItem.source.url;
        }
      } else if (skillOrItem && "name" in skillOrItem) {
        const skill = skillOrItem as Skill;
        url = await getSkillGitHubUrlAsync(skill, skillIndex?.sources || []);
      }

      if (url) {
        await vscode.env.openExternal(vscode.Uri.parse(url));
      }
    },
  );

  // Command: Register local skill in AGENTS.md
  const registerLocalSkillCmd = vscode.commands.registerCommand(
    "resourceNinja.registerLocalResource",
    async (item?: SkillTreeItem) => {
      if (!workspaceFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      if (!item?.skill || !("isLocal" in item.skill)) {
        return;
      }

      const localSkill = item.skill as LocalSkill;

      if (localSkill.isRegistered) {
        vscode.window.showInformationMessage(
          messages.localSkillAlreadyRegistered(localSkill.name),
        );
        return;
      }

      const success = await registerLocalSkill(
        localSkill,
        workspaceFolder.uri,
        context,
      );
      if (success) {
        vscode.window.showInformationMessage(
          messages.localSkillRegistered(localSkill.name),
        );
        workspaceProvider.refresh();
      }
    },
  );

  // Command: Unregister local skill from AGENTS.md
  const unregisterLocalSkillCmd = vscode.commands.registerCommand(
    "resourceNinja.unregisterLocalResource",
    async (item?: SkillTreeItem) => {
      if (!workspaceFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      if (!item?.skill || !("isLocal" in item.skill)) {
        return;
      }

      const localSkill = item.skill as LocalSkill;

      const success = await unregisterLocalSkill(
        localSkill,
        workspaceFolder.uri,
        context,
      );
      if (success) {
        vscode.window.showInformationMessage(
          messages.localSkillUnregistered(localSkill.name),
        );
        workspaceProvider.refresh();
      }
    },
  );

  const createResourceHandler = async () => {
    if (!workspaceFolder) {
      vscode.window.showErrorMessage(messages.noWorkspace());
      return;
    }

    const isJa = isJapanese();
    const config = vscode.workspace.getConfiguration("resourceNinja");
    const kindPick = await vscode.window.showQuickPick(
      (
        [
          "skill",
          "agent",
          "instruction",
          "prompt",
          "hook",
          "mcp",
        ] as ResourceKind[]
      ).map((kind) => ({
        label: getResourceKindLabel(kind, isJa),
        description: kind,
        detail:
          kind === "skill"
            ? isJa
              ? "手順・判断基準をまとめた SKILL.md"
              : "A SKILL.md with reusable instructions and examples"
            : kind === "hook"
              ? isJa
                ? "workflow event 用の README.md"
                : "A README.md for workflow event automation"
              : kind === "mcp"
                ? isJa
                  ? "確認後に有効化する MCP server 設定 JSON"
                  : "An MCP server config JSON to review before activation"
                : isJa
                  ? `${kind} 用 Markdown ファイル`
                  : `A ${kind} Markdown file`,
        resourceKind: kind,
      })),
      {
        placeHolder: isJa
          ? "作成するリソース種別を選択"
          : "Select resource type to create",
      },
    );
    if (!kindPick) {
      return;
    }
    const kind = kindPick.resourceKind;

    const targetOptions: Array<{
      label: string;
      description: string;
      detail: string;
      scope: CreateResourceScope;
    }> = [
      {
        label: isJa ? "Workspace" : "Workspace",
        description: isJa ? "このリポジトリ" : "This repository",
        detail: getResourceRootUri(
          workspaceFolder.uri,
          config,
          kind,
          "workspace",
        ).fsPath,
        scope: "workspace",
      },
    ];

    if (kind !== "skill" && kind !== "hook") {
      targetOptions.push({
        label: isJa ? "User Profile" : "User Profile",
        description: isJa ? "VS Code User Data" : "VS Code User Data",
        detail: getResourceRootUri(
          workspaceFolder.uri,
          config,
          kind,
          "userData",
        ).fsPath,
        scope: "userData",
      });
    }

    targetOptions.push(
      {
        label: isJa ? "グローバル リソース" : "Global Resource Home",
        description: isJa
          ? "選択中の共有リソースルート"
          : "Selected global resource home",
        detail: getResourceRootUri(
          workspaceFolder.uri,
          config,
          kind,
          "globalHome",
        ).fsPath,
        scope: "globalHome",
      },
      {
        label: isJa ? "Custom Folder" : "Custom Folder",
        description: isJa ? "フォルダを選択" : "Choose a folder",
        detail: isJa
          ? "選択したフォルダ配下に作成"
          : "Create under the selected folder",
        scope: "custom",
      },
    );

    const targetPick = await vscode.window.showQuickPick(targetOptions, {
      placeHolder: isJa ? "保存先を選択" : "Select destination",
    });
    if (!targetPick) {
      return;
    }

    let customRoot: vscode.Uri | undefined;
    if (targetPick.scope === "custom") {
      const selected = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: isJa ? "保存先にする" : "Use as Destination",
      });
      customRoot = selected?.[0];
      if (!customRoot) {
        return;
      }
    }

    const resourceName = await vscode.window.showInputBox({
      prompt: isJa ? "リソース名を入力してください" : "Enter resource name",
      placeHolder:
        kind === "agent"
          ? "reviewer-agent"
          : kind === "instruction"
            ? "typescript-guidelines"
            : kind === "prompt"
              ? "release-notes"
              : kind === "hook"
                ? "pre-review"
                : kind === "mcp"
                  ? "local-mcp-server"
                  : messages.createSkillPlaceholder(),
      validateInput: (value) => {
        const nameValidation = getCreateResourceNameValidationMessage(
          value || "",
          isJa,
        );
        if (nameValidation) {
          return nameValidation;
        }
        const slug = sanitizeResourceName(value || "");
        const pathValidation = getCreateResourcePathValidationMessage(
          getCreateResourceUri(
            workspaceFolder.uri,
            config,
            kind,
            targetPick.scope,
            slug,
            customRoot,
          ),
          isJa,
        );
        if (pathValidation) {
          return pathValidation;
        }
        return null;
      },
    });

    if (!resourceName) {
      return;
    }

    const slug = sanitizeResourceName(resourceName);
    const descriptionInput = await vscode.window.showInputBox({
      prompt: isJa ? "説明を入力してください" : "Enter description",
      placeHolder: isJa
        ? `このリソースの用途を短く説明（${MAX_CREATE_RESOURCE_DESCRIPTION_LENGTH} 文字以内）`
        : `Briefly describe what this resource is for (${MAX_CREATE_RESOURCE_DESCRIPTION_LENGTH} chars max)`,
      validateInput: (value) =>
        getCreateResourceDescriptionValidationMessage(value || "", isJa),
    });
    if (descriptionInput === undefined) {
      return;
    }
    const description =
      descriptionInput.trim() ||
      (isJa
        ? `${resourceName} の用途を記述してください。`
        : `Describe what ${resourceName} is for.`);

    const resourceUri = getCreateResourceUri(
      workspaceFolder.uri,
      config,
      kind,
      targetPick.scope,
      slug,
      customRoot,
    );

    try {
      await vscode.workspace.fs.stat(resourceUri);
      const openExisting = await vscode.window.showWarningMessage(
        isJa
          ? `${resourceUri.fsPath} は既に存在します。開きますか？`
          : `${resourceUri.fsPath} already exists. Open it?`,
        isJa ? "開く" : "Open",
        isJa ? "キャンセル" : "Cancel",
      );
      if (openExisting === (isJa ? "開く" : "Open")) {
        const doc = await vscode.workspace.openTextDocument(resourceUri);
        await vscode.window.showTextDocument(doc);
      }
      return;
    } catch {
      // File does not exist; continue creating it.
    }

    try {
      await vscode.workspace.fs.createDirectory(
        vscode.Uri.file(path.dirname(resourceUri.fsPath)),
      );
      const content = getCreateResourceTemplate(kind, slug, description);
      await vscode.workspace.fs.writeFile(
        resourceUri,
        Buffer.from(content, "utf8"),
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(
        isJa
          ? `リソースを作成できませんでした: ${errorMessage}`
          : `Failed to create resource: ${errorMessage}`,
      );
      return;
    }

    vscode.window.showInformationMessage(
      isJa
        ? `${getResourceKindLabel(kind, true)} '${slug}' を作成しました`
        : `Created ${getResourceKindLabel(kind, false)} '${slug}'`,
    );
    workspaceProvider.refresh();
    userResourcesProvider.refresh();

    const doc = await vscode.workspace.openTextDocument(resourceUri);
    await vscode.window.showTextDocument(doc);
  };

  const createResourceCmd = vscode.commands.registerCommand(
    "resourceNinja.createResource",
    createResourceHandler,
  );

  const createSkillCmd = vscode.commands.registerCommand(
    "resourceNinja.createSkill",
    createResourceHandler,
  );

  // Command: Update resource output manually
  const updateInstructionCmd = vscode.commands.registerCommand(
    "resourceNinja.updateInstruction",
    async () => {
      if (!workspaceFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      try {
        const config = vscode.workspace.getConfiguration(
          "resourceNinja",
          workspaceFolder.uri,
        );
        if (!isInstructionTargetEnabled(config)) {
          const openSettings = await vscode.window.showInformationMessage(
            isJapanese()
              ? "インストラクションファイル同期は設定で無効です。"
              : "Instruction file sync is disabled in settings.",
            messages.openSettings(),
          );
          if (openSettings === messages.openSettings()) {
            await vscode.commands.executeCommand("resourceNinja.openSettings");
          }
          return;
        }
        const instructionTarget = getInstructionTargetLabel(
          config,
          isJapanese(),
        );
        await updateInstructionFile(workspaceFolder.uri, context);
        vscode.window.showInformationMessage(
          isJapanese()
            ? `リソース出力を更新しました: ${instructionTarget}`
            : `Resource output updated: ${instructionTarget}`,
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          isJapanese()
            ? `リソース出力の更新に失敗しました: ${error}`
            : `Failed to update resource output: ${error}`,
        );
      }
    },
  );

  const updateGlobalInstructionCmd = vscode.commands.registerCommand(
    "resourceNinja.updateGlobalInstruction",
    async () => {
      if (!workspaceFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      try {
        const config = vscode.workspace.getConfiguration(
          "resourceNinja",
          workspaceFolder.uri,
        );
        if (!isInstructionTargetEnabled(config)) {
          const openSettings = await vscode.window.showInformationMessage(
            isJapanese()
              ? "インストラクションファイル同期は設定で無効です。"
              : "Instruction file sync is disabled in settings.",
            messages.openSettings(),
          );
          if (openSettings === messages.openSettings()) {
            await vscode.commands.executeCommand("resourceNinja.openSettings");
          }
          return;
        }
        const fileUri = resolveGlobalInstructionFileUri(
          workspaceFolder.uri,
          config,
        );
        if (!fileUri) {
          return;
        }
        const instructionTarget = getGlobalInstructionTargetLabel(
          workspaceFolder.uri,
          config,
        );
        await updateInstructionFileAtUri(
          workspaceFolder.uri,
          context,
          fileUri,
          instructionTarget,
        );
        vscode.window.showInformationMessage(
          isJapanese()
            ? `グローバル リソース出力を更新しました: ${instructionTarget}`
            : `Global resource output updated: ${instructionTarget}`,
        );
      } catch (error) {
        vscode.window.showErrorMessage(
          isJapanese()
            ? `グローバル リソース出力の更新に失敗しました: ${error}`
            : `Failed to update global resource output: ${error}`,
        );
      }
    },
  );

  const showCoexistenceStatusCmd = vscode.commands.registerCommand(
    "resourceNinja.showCoexistenceStatus",
    async () => {
      const config = vscode.workspace.getConfiguration("resourceNinja");
      const selfBeacon = getPublishedSelfBeacon(context);
      const siblingBeacon = await readSiblingBeacon(context);
      const siblingDetected = await isSiblingActive(context);
      const owner = await getEffectiveOwner(context);
      const sourcesManifest = await readSharedSourcesManifest();
      const sharedIndex = await readSharedResourceIndex();
      const sharedSummary = getStandaloneSharedModeSummary(context);
      const excludedKinds = config.get<string[]>("kindsExcluded", []);
      const standaloneExcludedKinds = siblingDetected ? [] : excludedKinds;
      const workspaceInstructionKinds = getInstructionBlockKinds(
        config,
        "workspace",
        {
          ignoreLegacyKindsExcluded: siblingDetected,
        },
      );
      const globalInstructionKinds = getInstructionBlockKinds(
        config,
        "globalHome",
        {
          ignoreLegacyKindsExcluded: siblingDetected,
        },
      );
      const markdown = [
        "# Resource Ninja Coexistence Status",
        "",
        `- Mode: ${config.get<string>("coexistenceMode", "auto")}`,
        `- Owner: ${owner}`,
        `- Sibling active: ${siblingDetected ? "yes" : "no"}`,
        `- Shared dir: ${sharedSummary.sharedDir}`,
        `- Shared sources manifest: ${sourcesManifest ? `${sourcesManifest.sources.length} sources` : "not initialized"}`,
        `- Shared resource index: ${sharedIndex ? `${sharedIndex.lastFullScan}` : "not initialized"}`,
        `- Instruction block kinds (workspace): ${workspaceInstructionKinds.join(", ")}`,
        `- Instruction block kinds (global home): ${globalInstructionKinds.join(", ")}`,
        ...(standaloneExcludedKinds.length > 0
          ? [
              `- Legacy standalone exclusions: ${standaloneExcludedKinds.join(", ")}`,
              "- Hint: Run Resource NINJA: Recompute Coexistence Ownership after uninstalling the skill-only sibling extension. Legacy `resourceNinja.kindsExcluded` exclusions apply only in standalone mode and never remove `skill`.",
            ]
          : siblingDetected && excludedKinds.length > 0
            ? [
                `- Legacy standalone exclusions configured: ${excludedKinds.join(", ")} (ignored while the skill-only sibling extension is active)`,
              ]
            : []),
        "",
        "## Self Beacon",
        "",
        "```json",
        JSON.stringify(selfBeacon || sharedSummary.beacon, null, 2),
        "```",
        "",
        "## Sibling Beacon",
        "",
        "```json",
        JSON.stringify(siblingBeacon || null, null, 2),
        "```",
      ].join("\n");

      const doc = await vscode.workspace.openTextDocument({
        content: markdown,
        language: "markdown",
      });
      await vscode.window.showTextDocument(doc, { preview: false });
    },
  );

  const recomputeOwnershipCmd = vscode.commands.registerCommand(
    "resourceNinja.recomputeOwnership",
    async () => {
      await publishBeacon(context);
      if (workspaceFolder) {
        await refreshInstructionSync();
      }
      const owner = await getEffectiveOwner(context);
      vscode.window.showInformationMessage(
        isJapanese()
          ? `共存状態を再評価しました。現在の owner は ${owner} です。`
          : `Recomputed coexistence state. Current owner: ${owner}.`,
      );
    },
  );

  const cleanupOrphanBlockCmd = vscode.commands.registerCommand(
    "resourceNinja.cleanupOrphanBlock",
    async () => {
      if (!workspaceFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      const config = vscode.workspace.getConfiguration("resourceNinja");
      const instructionUri = resolveInstructionFileUri(
        workspaceFolder.uri,
        config,
      );
      if (!instructionUri) {
        vscode.window.showInformationMessage(
          isJapanese()
            ? "クリーンアップ対象の instruction file が設定されていません。"
            : "No instruction file is configured for cleanup.",
        );
        return;
      }

      await removeSkillSectionFromFile(instructionUri);
      vscode.window.showInformationMessage(
        isJapanese()
          ? `管理マーカーブロックを削除しました: ${instructionUri.fsPath}`
          : `Removed managed marker block from ${instructionUri.fsPath}`,
      );
    },
  );

  async function openInstructionFileForScope(
    scope: "workspace" | "globalHome",
  ): Promise<void> {
    if (!workspaceFolder) {
      vscode.window.showErrorMessage(messages.noWorkspace());
      return;
    }

    const config = vscode.workspace.getConfiguration(
      "resourceNinja",
      workspaceFolder.uri,
    );
    const filePath = getConfiguredInstructionFilePath(config);
    if (filePath === DISABLED_INSTRUCTION_FILE) {
      const openSettings = await vscode.window.showInformationMessage(
        isJapanese()
          ? "インストラクションファイル同期は設定で無効です。"
          : "Instruction file sync is disabled in settings.",
        messages.openSettings(),
      );
      if (openSettings === messages.openSettings()) {
        await vscode.commands.executeCommand("resourceNinja.openSettings");
      }
      return;
    }

    const fileUri =
      scope === "globalHome"
        ? resolveGlobalInstructionFileUri(workspaceFolder.uri, config)
        : resolveInstructionFileUri(workspaceFolder.uri, config);
    if (!fileUri) {
      return;
    }
    const targetLabel =
      scope === "globalHome"
        ? getGlobalInstructionTargetLabel(workspaceFolder.uri, config)
        : filePath;

    const { format } = await resolveOutputFormat(workspaceFolder.uri);
    const preferredOutputUri =
      format === "ref"
        ? resolvePrimaryRefCatalogUri(workspaceFolder.uri, scope, config)
        : fileUri;

    const tryOpenDocument = async (uri: vscode.Uri): Promise<boolean> => {
      try {
        await vscode.workspace.fs.stat(uri);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc);
        return true;
      } catch {
        return false;
      }
    };

    const regenerateManagedOutput = async (): Promise<void> => {
      if (scope === "globalHome") {
        await updateInstructionFileAtUri(
          workspaceFolder.uri,
          context,
          fileUri,
          targetLabel,
        );
        return;
      }
      await updateInstructionFile(workspaceFolder.uri, context);
    };

    try {
      if (await tryOpenDocument(preferredOutputUri)) {
        return;
      }

      if (format === "ref") {
        try {
          await regenerateManagedOutput();
        } catch (error) {
          logger.warn(
            "[Resource Ninja] Failed to regenerate managed output before opening fallback:",
            error,
          );
        }

        if (await tryOpenDocument(preferredOutputUri)) {
          return;
        }

        if (await tryOpenDocument(fileUri)) {
          return;
        }
      } else if (await tryOpenDocument(fileUri)) {
        return;
      }

      throw new Error("output-not-found");
    } catch {
      // 出力先がなければ同期先ファイルの作成を提案
      const isJa = isJapanese();
      const createLabel = isJa ? "作成" : "Create";
      const settingsLabel = messages.openSettings();
      const cancelLabel = isJa ? "キャンセル" : "Cancel";
      const create = await vscode.window.showInformationMessage(
        isJa
          ? `${targetLabel} の出力が見つかりません。生成リソース出力を再生成しても開けなかったため、同期先ファイルを作成しますか？
${fileUri.fsPath}`
          : `${targetLabel} output was not found. Managed output regeneration did not create an openable target. Create the sync target file?
${fileUri.fsPath}`,
        createLabel,
        settingsLabel,
        cancelLabel,
      );
      if (create === createLabel) {
        try {
          // 空の同期先ファイルを作成
          await vscode.workspace.fs.createDirectory(
            vscode.Uri.file(path.dirname(fileUri.fsPath)),
          );
          await vscode.workspace.fs.writeFile(
            fileUri,
            Buffer.from("# Agent Resources\n\n"),
          );
          const doc = await vscode.workspace.openTextDocument(fileUri);
          await vscode.window.showTextDocument(doc);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(
            isJa
              ? `出力先ファイルを作成できませんでした: ${errorMessage}`
              : `Failed to create output file: ${errorMessage}`,
          );
        }
      } else if (create === settingsLabel) {
        await vscode.commands.executeCommand("resourceNinja.openSettings");
      }
    }
  }

  async function openInstructionFileWithScopePicker(): Promise<void> {
    if (!workspaceFolder) {
      vscode.window.showErrorMessage(messages.noWorkspace());
      return;
    }

    const config = vscode.workspace.getConfiguration(
      "resourceNinja",
      workspaceFolder.uri,
    );
    const scopeChoice = await vscode.window.showQuickPick(
      [
        {
          label: isJapanese()
            ? "ワークスペースのリソース出力"
            : "Workspace Resource Output",
          description: getInstructionTargetLabel(config, isJapanese()),
          scope: "workspace" as const,
        },
        {
          label: isJapanese()
            ? "Global のリソース出力"
            : "Global Resource Output",
          description: getGlobalInstructionTargetLabel(
            workspaceFolder.uri,
            config,
          ),
          scope: "globalHome" as const,
        },
      ],
      {
        placeHolder: isJapanese()
          ? "開くリソース出力のスコープを選択"
          : "Select the resource output scope to open",
      },
    );

    if (!scopeChoice) {
      return;
    }

    await openInstructionFileForScope(scopeChoice.scope);
  }

  const openResourceOutputCmd = vscode.commands.registerCommand(
    "resourceNinja.openResourceOutput",
    async () => openInstructionFileWithScopePicker(),
  );

  // Command: Open workspace output (instruction file or ref catalog)
  const openInstructionFileCmd = vscode.commands.registerCommand(
    "resourceNinja.openInstructionFile",
    async () => openInstructionFileForScope("workspace"),
  );

  // Command: Open Global Resource Home output (instruction file or ref catalog)
  const openGlobalInstructionFileCmd = vscode.commands.registerCommand(
    "resourceNinja.openGlobalInstructionFile",
    async () => openInstructionFileForScope("globalHome"),
  );

  // Command: Open settings
  const openSettingsCmd = vscode.commands.registerCommand(
    "resourceNinja.openSettings",
    async () => {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "@ext:yamapan.agent-resources-ninja",
      );
    },
  );

  // Command: Reset settings
  const resetSettingsCmd = vscode.commands.registerCommand(
    "resourceNinja.resetSettings",
    async () => {
      const options = [
        { label: messages.resetCache(), value: "cache" },
        { label: messages.resetAllSettings(), value: "settings" },
        { label: messages.resetAllIncludingToken(), value: "all" },
      ];

      const selected = await vscode.window.showQuickPick(options, {
        placeHolder: messages.resetSettingsPrompt(),
        title: messages.resetSettingsTitle(),
      });

      if (!selected) {
        return;
      }

      if (selected.value === "settings" || selected.value === "all") {
        const confirmation = await vscode.window.showWarningMessage(
          selected.value === "all"
            ? messages.resetConfirmAll()
            : messages.resetConfirmSettings(),
          { modal: true },
          messages.resetConfirmAction(),
        );
        if (confirmation !== messages.resetConfirmAction()) {
          return;
        }
      }

      const config = vscode.workspace.getConfiguration("resourceNinja");

      // キャッシュをクリア（GlobalStorage内のファイル削除）
      if (
        selected.value === "cache" ||
        selected.value === "settings" ||
        selected.value === "all"
      ) {
        const globalStoragePath = context.globalStorageUri.fsPath;
        try {
          await vscode.workspace.fs.delete(vscode.Uri.file(globalStoragePath), {
            recursive: true,
          });
        } catch {
          // フォルダが存在しない場合は無視
        }
      }

      // 設定をリセット（トークン以外）
      if (selected.value === "settings" || selected.value === "all") {
        for (const setting of RESETTABLE_RESOURCE_NINJA_SETTINGS) {
          await config.update(
            setting,
            undefined,
            vscode.ConfigurationTarget.Global,
          );
        }
      }

      // トークンもリセット
      if (selected.value === "all") {
        await config.update(
          "githubToken",
          undefined,
          vscode.ConfigurationTarget.Global,
        );
      }

      const restart = await vscode.window.showInformationMessage(
        messages.resetComplete(),
        "Reload Window",
      );
      if (restart === "Reload Window") {
        await vscode.commands.executeCommand("workbench.action.reloadWindow");
      }
    },
  );

  // Command: Copy URL (for Browse view)
  const copyUrlCmd = vscode.commands.registerCommand(
    "resourceNinja.copyUrl",
    async (item: SkillTreeItem) => {
      if (!item.skill) {
        return;
      }

      const currentIndex = await loadSkillIndex(context);
      const url = await getSkillGitHubUrlAsync(
        item.skill,
        currentIndex.sources,
      );
      if (url) {
        await vscode.env.clipboard.writeText(url);
        vscode.window.showInformationMessage(
          messages.copiedToClipboardWithValue(url),
        );
      }
    },
  );

  // Command: Copy Path (for Installed/Local skills)
  const copyPathCmd = vscode.commands.registerCommand(
    "resourceNinja.copyPath",
    async (item: SkillTreeItem) => {
      if (item.resourceUri) {
        const path = item.resourceUri.fsPath;
        await vscode.env.clipboard.writeText(path);
        vscode.window.showInformationMessage(
          messages.copiedToClipboardWithValue(path),
        );
      }
    },
  );

  // Command: Open in Terminal (for Installed/Local skills)
  const openInTerminalCmd = vscode.commands.registerCommand(
    "resourceNinja.openInTerminal",
    async (item: SkillTreeItem) => {
      if (item.resourceUri) {
        const folderPath = item.resourceUri.fsPath;
        const terminal = vscode.window.createTerminal({
          name: `Skill: ${item.label}`,
          cwd: folderPath,
        });
        terminal.show();
      }
    },
  );

  // Command: Report Bug
  const reportBugCmd = vscode.commands.registerCommand(
    "resourceNinja.reportBug",
    async () => {
      const extensionVersion =
        vscode.extensions.getExtension("yamapan.agent-resources-ninja")
          ?.packageJSON?.version || "unknown";

      const isJa = isJapanese();

      const issueTitle = isJa ? "[バグ報告] " : "[Bug] ";
      const issueBody = isJa
        ? `**問題の説明**\n` +
          `<!-- 発生したバグについて説明してください -->\n\n` +
          `**再現手順**\n` +
          `1. \n2. \n3. \n\n` +
          `**期待される動作**\n` +
          `<!-- どのような動作を期待していましたか？ -->\n\n` +
          `**実際の動作**\n` +
          `<!-- 実際に何が起こりましたか？ -->\n\n` +
          `**スクリーンショット**\n` +
          `<!-- 可能であれば、問題がわかるスクリーンショットを添付してください -->\n\n` +
          `**環境**\n` +
          `- 拡張機能バージョン: ${extensionVersion}\n` +
          `- VS Code: ${vscode.version}\n` +
          `- OS: ${process.platform}\n`
        : `**Issue Description**\n` +
          `<!-- Please describe the bug you encountered -->\n\n` +
          `**Steps to Reproduce**\n` +
          `1. \n2. \n3. \n\n` +
          `**Expected Behavior**\n` +
          `<!-- What did you expect to happen? -->\n\n` +
          `**Actual Behavior**\n` +
          `<!-- What actually happened? -->\n\n` +
          `**Screenshots**\n` +
          `<!-- If possible, please attach screenshots that show the issue -->\n\n` +
          `**Environment**\n` +
          `- Extension Version: ${extensionVersion}\n` +
          `- VS Code: ${vscode.version}\n` +
          `- OS: ${process.platform}\n`;

      await openBugReport(issueTitle, issueBody);
    },
  );

  context.subscriptions.push(
    searchCmd,
    installCmd,
    installDefaultCmd,
    uninstallCmd,
    reinstallAllCmd,
    reinstallCmd,
    reinstallResourceGroupCmd,
    uninstallAllCmd,
    installBundleCmd,
    installPluginResourcesCmd,
    uninstallMultipleCmd,
    reinstallMultipleCmd,
    showInstalledCmd,
    refreshCmd,
    toggleBuiltInResourcesCmd,
    showBuiltInResourcesCmd,
    hideBuiltInResourcesCmd,
    toggleRemoteResourceViewModeCmd,
    refreshLocalCmd,
    refreshUserResourcesCmd,
    openUserResourceCmd,
    revealUserResourceCmd,
    copyUserResourcePathCmd,
    reinstallUserResourceCmd,
    reinstallUserResourceGroupCmd,
    deleteUserResourceCmd,
    deletePluginResourcesCmd,
    openSkillFileCmd,
    updateIndexCmd,
    updateSourceIndexCmd,
    addSourceCmd,
    webSearchCmd,
    removeSourceCmd,
    previewCmd,
    toggleFavoriteCmd,
    showFavoritesCmd,
    browseByCategoryCmd,
    showRecentCmd,
    openOnGitHubCmd,
    registerLocalSkillCmd,
    unregisterLocalSkillCmd,
    createResourceCmd,
    createSkillCmd,
    updateInstructionCmd,
    updateGlobalInstructionCmd,
    showCoexistenceStatusCmd,
    recomputeOwnershipCmd,
    cleanupOrphanBlockCmd,
    openResourceOutputCmd,
    openInstructionFileCmd,
    openGlobalInstructionFileCmd,
    openSettingsCmd,
    resetSettingsCmd,
    copyUrlCmd,
    copyPathCmd,
    openInTerminalCmd,
    reportBugCmd,
    openSkillFolderCmd,
    editWhenToUseCmd,
    doubleClickCmd,
    configWatcher,
    installedTreeView,
    browseTreeView,
    userResourcesTreeView,
  );

  const refreshViews = () => {
    workspaceProvider.refresh();
    userResourcesProvider.refresh();
  };

  context.subscriptions.push(
    vscode.workspace.onDidCreateFiles(() => refreshViews()),
    vscode.workspace.onDidDeleteFiles(() => refreshViews()),
  );

  // SKILL.md の変更を監視してメタデータを自動更新
  const config = vscode.workspace.getConfiguration("resourceNinja");
  const skillsDir = getConfiguredSkillsDirectory(config);
  const skillMdWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(
      vscode.workspace.workspaceFolders?.[0] || "",
      `${skillsDir}/**/SKILL.md`,
    ),
  );

  // デバウンス用の Map（同じファイルへの連続保存を1回にまとめる）
  const pendingUpdates = new Map<string, NodeJS.Timeout>();

  const handleSkillMdChange = async (uri: vscode.Uri) => {
    const key = uri.fsPath;

    // 既存のタイマーをクリア
    if (pendingUpdates.has(key)) {
      clearTimeout(pendingUpdates.get(key));
    }

    // 500ms のデバウンス
    pendingUpdates.set(
      key,
      setTimeout(async () => {
        pendingUpdates.delete(key);

        const updated = await refreshSingleSkillMetadata(uri);
        if (updated) {
          // ビューを更新
          workspaceProvider.refresh();
          browseProvider.refresh();

          // 自動更新が有効な場合は instruction file も更新
          const autoUpdate = vscode.workspace
            .getConfiguration("resourceNinja")
            .get<boolean>("autoUpdateInstruction", true);
          if (autoUpdate && workspaceFolder) {
            await updateInstructionFile(workspaceFolder.uri, context);
          }
        }
      }, 500),
    );
  };

  skillMdWatcher.onDidChange(handleSkillMdChange);
  context.subscriptions.push(skillMdWatcher);
  return {
    getAgentNinjaBeacon: () => getPublishedSelfBeacon(context),
  };
}

/**
 * バージョンアップ時にメタデータを再抽出 & スキル自動更新
 * 拡張機能のバージョンが変わった場合、インストール済みスキルの whenToUse を再抽出
 * オプションでスキルを自動再インストール
 */
async function checkVersionAndRefreshMetadata(
  context: vscode.ExtensionContext,
  workspaceUri: vscode.Uri | undefined,
  formatMigrated: boolean = false,
): Promise<void> {
  if (!workspaceUri) return;

  const LAST_VERSION_KEY = "resourceNinja.lastVersion";
  const lastVersion = context.globalState.get<string>(LAST_VERSION_KEY);

  // フォーマットがマイグレーションされた場合は、インストラクションファイルを更新
  if (formatMigrated) {
    logger.info(
      "[Resource Ninja] Format migrated, updating instruction file...",
    );
    try {
      await updateInstructionFile(workspaceUri, context);
      vscode.window.showInformationMessage(
        isJapanese()
          ? "🥷 出力フォーマット設定が更新されました。リソース出力を新フォーマットで再生成しました。"
          : "🥷 Output format setting migrated. Regenerated resource output with the new format.",
      );
    } catch (error) {
      logger.error(
        "[Resource Ninja] Failed to update resource output after format migration:",
        error,
      );
    }
  }

  if (lastVersion === EXTENSION_VERSION) {
    // バージョンが同じなら何もしない
    return;
  }

  logger.info(
    `[Resource Ninja] Version changed: ${lastVersion || "none"} → ${EXTENSION_VERSION}`,
  );

  // バージョンを更新
  await context.globalState.update(LAST_VERSION_KEY, EXTENSION_VERSION);

  // 初回起動（lastVersion がない）の場合はスキップ
  if (!lastVersion) {
    logger.info("[Resource Ninja] First activation, skipping metadata refresh");
    return;
  }

  // インストール済みスキルを取得
  const installedSkills = await getInstalledSkillsWithMeta(workspaceUri);
  const remoteSkillCount = installedSkills.filter((s) =>
    isRemoteInstalledSkillMeta(s),
  ).length;

  // スキル自動更新設定を確認
  const config = vscode.workspace.getConfiguration("resourceNinja");
  const autoUpdateSkills = getConfiguredAutoUpdateResourcesOnUpgrade(config);

  if (remoteSkillCount > 0 && autoUpdateSkills !== "never") {
    const shouldUpdate =
      autoUpdateSkills === "always" ||
      (await promptForSkillUpdate(remoteSkillCount));

    if (shouldUpdate) {
      try {
        // 全スキルを再インストール
        await vscode.commands.executeCommand("resourceNinja.reinstallAll");
        vscode.window.showInformationMessage(
          isJapanese()
            ? `🥷 v${EXTENSION_VERSION} にアップデートしました。${remoteSkillCount} 個のスキルを最新版に更新しました。`
            : `🥷 Updated to v${EXTENSION_VERSION}. Updated ${remoteSkillCount} skill(s) to latest version.`,
        );
        return; // 再インストールしたのでメタデータ更新はスキップ
      } catch (error) {
        logger.error("[Resource Ninja] Failed to reinstall skills:", error);
      }
    }
  }

  // メタデータを再抽出（再インストールしなかった場合）
  try {
    const updatedCount = await refreshSkillMetadata(workspaceUri);

    if (updatedCount > 0) {
      logger.info(
        `[Resource Ninja] Refreshed metadata for ${updatedCount} skills`,
      );

      // instruction ファイルを更新
      const autoUpdate = config.get<boolean>("autoUpdateInstruction") ?? true;

      if (autoUpdate) {
        await updateInstructionFile(workspaceUri, context);
        logger.info("[Resource Ninja] Instruction file updated");
      }

      // 通知
      vscode.window.showInformationMessage(
        isJapanese()
          ? `🥷 v${EXTENSION_VERSION} にアップデートしました。${updatedCount} 個のスキルのメタデータを更新しました。`
          : `🥷 Updated to v${EXTENSION_VERSION}. Refreshed metadata for ${updatedCount} skill(s).`,
      );
    }
  } catch (error) {
    logger.error("[Resource Ninja] Failed to refresh metadata:", error);
  }
}

/**
 * スキル更新の確認ダイアログを表示
 */
async function promptForSkillUpdate(skillCount: number): Promise<boolean> {
  const message = isJapanese()
    ? `🥷 拡張機能がアップデートされました。${skillCount} 個のリモートスキルを最新版に更新しますか？`
    : `🥷 Extension updated. Update ${skillCount} remote skill(s) to latest version?`;

  const result = await vscode.window.showInformationMessage(
    message,
    { modal: false },
    isJapanese() ? "更新する" : "Update",
    isJapanese() ? "スキップ" : "Skip",
  );

  return result === (isJapanese() ? "更新する" : "Update");
}

/**
 * 出力設定のマイグレーション
 * v0.8.3 で命名を変更:
 *   - markdown → legacy
 *   - compressed-index → compact
 *   - markdown-with-index → full
 * v0.2.20 で Ref 切り替えを分離:
 *   - outputFormat = ref → useRefOutput = true + outputFormat = full
 * @returns マイグレーションが行われた場合は true
 */
async function migrateOutputFormatSetting(
  workspaceUri: vscode.Uri | undefined,
): Promise<boolean> {
  const config = vscode.workspace.getConfiguration("resourceNinja");
  const inspected = config.inspect<string>("outputFormat");
  const useRefInspected = config.inspect<boolean>("useRefOutput");

  // マイグレーションマップ（旧値 → 新値）
  const migrationMap: Record<string, string> = {
    markdown: "legacy",
    "compressed-index": "compact",
    "markdown-with-index": "full",
  };

  let migrated = false;
  const targets: Array<{
    outputFormatValue: string | undefined;
    useRefOutputValue: boolean | undefined;
    target: vscode.ConfigurationTarget;
    targetConfig: vscode.WorkspaceConfiguration;
  }> = [
    {
      outputFormatValue: inspected?.globalValue,
      useRefOutputValue: useRefInspected?.globalValue,
      target: vscode.ConfigurationTarget.Global,
      targetConfig: config,
    },
    {
      outputFormatValue: inspected?.workspaceValue,
      useRefOutputValue: useRefInspected?.workspaceValue,
      target: vscode.ConfigurationTarget.Workspace,
      targetConfig: config,
    },
  ];

  if (workspaceUri) {
    targets.push({
      outputFormatValue: inspected?.workspaceFolderValue,
      useRefOutputValue: useRefInspected?.workspaceFolderValue,
      target: vscode.ConfigurationTarget.WorkspaceFolder,
      targetConfig: vscode.workspace.getConfiguration(
        "resourceNinja",
        workspaceUri,
      ),
    });
  }

  for (const {
    outputFormatValue,
    useRefOutputValue,
    target,
    targetConfig,
  } of targets) {
    if (!outputFormatValue) {
      continue;
    }

    if (outputFormatValue === "ref") {
      if (useRefOutputValue !== true) {
        await targetConfig.update("useRefOutput", true, target);
      }
      await targetConfig.update("outputFormat", "full", target);
      logger.info(
        `[Resource Ninja] Migrated output settings (${vscode.ConfigurationTarget[target]}): outputFormat ref → useRefOutput true + outputFormat full`,
      );
      migrated = true;
      continue;
    }

    if (!migrationMap[outputFormatValue]) {
      continue;
    }

    const newValue = normalizeInlineOutputFormat(outputFormatValue);
    if (newValue === outputFormatValue) {
      continue;
    }
    await targetConfig.update("outputFormat", newValue, target);
    logger.info(
      `[Resource Ninja] Migrated outputFormat (${vscode.ConfigurationTarget[target]}): ${outputFormatValue} → ${newValue}`,
    );
    migrated = true;
  }

  return migrated;
}

export async function deactivate(): Promise<void> {
  if (activeExtensionContext) {
    await clearBeacon(activeExtensionContext);
  }
}
