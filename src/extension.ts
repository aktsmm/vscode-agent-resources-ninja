// Agent Resources Ninja - VS Code Extension

import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import { realpath } from "fs/promises";
import { createHash } from "crypto";
import {
  SkillIndex,
  Skill,
  Source,
  ResourceKind,
  buildGitHubRawUrl,
  buildGitHubResourceUrl,
  loadSkillIndex,
  getSkillGitHubUrlAsync,
  getIndexResources,
  getIndexSources,
  getResourceKind,
  getResourceKindIcon,
  getResourceKindLabel,
  getSourceBranch,
} from "./skillIndex";
import { searchSkills, SkillQuickPickItem } from "./skillSearch";
import {
  initializeGitHubAuth,
  migrateConfiguredGitHubTokenToSecretStorage,
  syncConfiguredGitHubToken,
  deleteConfiguredGitHubTokens,
  deleteStoredGitHubToken,
  clearStoredGitHubTokenWithFeedback,
  checkGitHubAuth,
  getGitHubToken,
  resolveGitHubToken,
} from "./githubAuth";
import {
  installSkill,
  InstallSkillResult,
  InstallTargetScope,
  getResourceTargetUri,
  isSkillNotFoundHandledError,
  SkillMeta,
  uninstallSkill,
  uninstallSkillByPath,
  unregisterPluginLocations,
  getInstalledSkills,
  getInstalledSkillsWithMeta,
  normalizeSkillMetaSource,
  refreshSkillMetadata,
  refreshSingleSkillMetadata,
  stripSkillMetaLocalPaths,
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
  updateIndexFromSourcesWithResult,
  updateIndexFromSingleSource,
  addSource,
  removeSource,
  searchGitHub,
  showAuthHelp,
  getGitHubAuthSourceLabel,
  fetchGitHubTextContent,
} from "./indexUpdater";
import { messages, isJapanese } from "./i18n";
import { showSkillPreview, getSkillId } from "./skillPreview";
import {
  LocalSkill,
  registerLocalSkill,
  scanLocalSkills,
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
  AGENT_PLUGINS_MANIFEST_SCHEMA,
  detectResourceKindFromPath,
  getPluginIdFromPath,
  getPluginRootFsPathFromManifestPath,
  getResourceIdentityKeys,
  getResourceMetadataPath,
  isFileBackedHookResourcePath,
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
import { isDeletableWithin, isRealPathStrictlyInside } from "./pathSafety";
import {
  formatBatchCancellationSuffix,
  formatBatchFailureMessage,
} from "./batchProgress";
import {
  getPluginLocationsToRegister,
  mergePluginLocations,
  supportsPluginLocations,
  toPluginLocationKey,
} from "./pluginLocations";
import {
  normalizeInlineOutputFormat,
  resolveOutputFormat,
} from "./toolDetector";
import {
  getStandaloneSharedModeSummary,
  readSharedResourceIndex,
} from "./sharedResourceIndexStore";
import { readSharedSourcesManifest } from "./sharedSourcesManifestStore";
import {
  collectStaleSources,
  selectStaleSourcesForStartup,
} from "./sourceFreshness";
import { GitHubResponseError, isGitHubResponseError } from "./githubResponse";
import { runSourceIndexUpdateBatch } from "./sourceIndexUpdateBatch";
import {
  isEmptySourceScanError,
  isSourceRepositoryChangedError,
} from "./sourceUpdateReconcile";
import {
  formatSourceIndexResetAt,
  getSourceIndexUpdateNotificationKind,
  scaleSourceIndexProgressIncrement,
} from "./sourceIndexUpdatePresentation";
import {
  COPILOT_MARKETPLACE_MANIFEST_PATHS,
  CopilotMarketplacePluginIdentity,
  MarketplaceCleanupResult,
  findCopilotCliExecutable,
  getCanonicalCopilotCliPluginRoot,
  installCopilotCliPlugin,
  normalizeGitHubOwnerRepo,
  parseCopilotCliPluginList,
  resolveMarketplacePluginIdentityFromCandidates,
  uninstallCopilotCliPlugin,
} from "./copilotCliPlugins";
import {
  DefaultPluginHost,
  formatPluginHostState,
  resolvePluginHostChoices,
} from "./pluginHosts/recommendation";
import {
  canExecuteWithoutShell,
  CodexExecutableProbe,
  findCodexExecutableProbe,
  findExecutableOnPath,
} from "./pluginHosts/executable";
import {
  getClaudeCodeAvailability,
  installClaudeCodePlugin,
  mutateClaudeCodePlugin,
  parseClaudePluginListJson,
} from "./pluginHosts/adapters/claudeCode";
import {
  getCodexAvailability,
  installCodexPlugin,
  parseCodexPluginListJson,
  uninstallCodexPlugin,
} from "./pluginHosts/adapters/codex";
import {
  getCursorLocalPluginPath,
  isCursorEditor,
} from "./pluginHosts/adapters/cursor";
import {
  ExecutionIntentAuthority,
  MutationExecutor,
  buildSanitizedEnvironment,
} from "./pluginHosts/executionGate";
import {
  PluginHostCommandResult,
  PluginHostCommandRunner,
  createApprovedCommandRunner,
  runPluginHostProcess,
} from "./pluginHosts/commandRunner";
import {
  PluginHostAction,
  PluginHostId,
  PluginHostState,
  PluginInstallScope,
} from "./pluginHosts/types";
import {
  collectPluginHostStates,
  withPluginStateTimeout,
} from "./pluginHosts/state";

// 現在の拡張機能バージョン
const EXTENSION_VERSION =
  vscode.extensions.getExtension("yamapan.agent-resources-ninja")?.packageJSON
    ?.version || "0.0.0";
const STALE_SOURCE_PROMPT_DATE_KEY = "resourceNinja.staleSourceLastPromptDate";
const STALE_SOURCE_CURSOR_KEY = "resourceNinja.staleSourceUpdateCursor";
const CURSOR_PLUGIN_RECEIPTS_KEY = "resourceNinja.cursorPluginReceipts";
const CODEX_REPAIR_COMMAND =
  "winget install --id OpenAI.Codex -e --source winget --force";

let activeExtensionContext: vscode.ExtensionContext | undefined;
const pluginExecutionAuthority = new ExecutionIntentAuthority();
const pluginMutationExecutor = new MutationExecutor(pluginExecutionAuthority);
const loggedCodexFallbacks = new Set<string>();

interface CursorPluginReceipt {
  rootPath: string;
  targetPath: string;
  pluginName: string;
  source: string;
  remotePath: string;
  fingerprint: string;
  installedAt: string;
}

function formatCodexExecutableReason(
  probe: CodexExecutableProbe,
  japanese: boolean,
): string {
  switch (probe.reason) {
    case "path":
      return japanese ? "Codex CLIをPATHで検出" : "Codex CLI detected on PATH";
    case "winget-link-not-on-path":
      return japanese
        ? "WinGet linkでNative実行（shell alias/PATH未反映）"
        : "Native via WinGet link (shell alias/PATH unavailable)";
    case "winget-package-no-link":
      return japanese
        ? "公式WinGet packageからNative実行（shell aliasなし）"
        : "Native via official WinGet package fallback (shell alias missing)";
    case "unsupported-winget-package":
      return japanese
        ? "WinGet packageはあるが対応実行ファイルなし"
        : "WinGet package found without a supported executable";
    case "not-found":
    default:
      return japanese ? "Codex CLI未検出" : "Codex CLI not found";
  }
}

function logCodexFallback(probe: CodexExecutableProbe): void {
  if (!probe.executablePath || !probe.source || probe.source === "path") {
    return;
  }
  const key = `${probe.reason}|${probe.executablePath}`;
  if (loggedCodexFallbacks.has(key)) {
    return;
  }
  loggedCodexFallbacks.add(key);
  logger.info(
    `[Resource Ninja] Codex CLI fallback: ${probe.reason} (${probe.executablePath})`,
  );
}

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
  const resources = getIndexResources(index);

  if (normalizedRemotePath && meta.source && meta.source !== "local") {
    const matchedByRemotePath = resources.find(
      (skill: Skill) =>
        getResourceKind(skill) === "skill" &&
        skill.source === meta.source &&
        normalizeInstalledRemotePath(skill.path) === normalizedRemotePath,
    );
    if (matchedByRemotePath) {
      return matchedByRemotePath;
    }
  }

  let skill = resources.find(
    (candidate: Skill) =>
      getResourceKind(candidate) === "skill" &&
      candidate.name === meta.name &&
      candidate.source === meta.source,
  );
  if (!skill && meta.source === "unknown") {
    skill = resources.find(
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

function getSourceUpdateDisplayName(source: Source): string {
  return source.name || source.id;
}

function formatSourceUpdateFailureReason(error: unknown): string {
  if (!isGitHubResponseError(error)) {
    return error instanceof Error ? error.message : String(error);
  }

  switch (error.kind) {
    case "rate-limit":
      return error.resetAt
        ? `${messages.githubRateLimitReason()} (${messages.githubRateLimitResetAt(
            formatSourceIndexResetAt(error.resetAt, isJapanese() ? "ja" : "en"),
          )})`
        : messages.githubRateLimitReason();
    case "sso-required":
      return messages.githubSsoRequiredReason();
    case "classic-pat-forbidden":
      return messages.githubClassicPatForbiddenReason();
    case "auth-required":
      return messages.githubAuthRequiredReason();
    default:
      return error.message;
  }
}

function shouldOfferGitHubAuth(error: unknown): error is GitHubResponseError {
  return (
    isGitHubResponseError(error) &&
    [
      "rate-limit",
      "sso-required",
      "classic-pat-forbidden",
      "auth-required",
    ].includes(error.kind)
  );
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
  allowedRootFsPath: string,
): Promise<void> {
  const isDirectoryBackedHook =
    kind === "hook" && !isFileBackedHookResourcePath(fullPath);
  // A plugin is scanned by its manifest, but the installed unit is the whole folder.
  const pluginRootFsPath =
    kind === "plugin"
      ? getPluginRootFsPathFromManifestPath(fullPath)
      : undefined;
  const isDirectoryTarget =
    kind === "skill" || isDirectoryBackedHook || pluginRootFsPath !== undefined;
  const targetUri = vscode.Uri.file(
    pluginRootFsPath ??
      (kind === "skill" || isDirectoryBackedHook
        ? path.dirname(fullPath)
        : fullPath),
  );
  if (
    !isDeletableWithin(allowedRootFsPath, targetUri.fsPath) ||
    !isRealPathStrictlyInside(allowedRootFsPath, targetUri.fsPath)
  ) {
    throw new Error(
      `Refused to delete ${targetUri.fsPath} outside ${allowedRootFsPath}`,
    );
  }
  await vscode.workspace.fs.delete(targetUri, {
    recursive: isDirectoryTarget,
    useTrash: true,
  });

  // Keyed off the folder that was actually removed, so a caller that reinstalls
  // elsewhere drops the entry for the location the plugin left.
  if (pluginRootFsPath) {
    await unregisterPluginLocations(
      [targetUri.fsPath],
      path.basename(pluginRootFsPath),
    );
  }

  if (!isDirectoryTarget) {
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

/**
 * Whether an install wrote everything it was asked to. An install that reported
 * download errors leaves a partial folder behind, and registering that folder in
 * `chat.pluginLocations` would activate a plugin whose files are missing. The
 * errors themselves were already reported to the user by the install.
 */
function installWasClean(
  installResult: InstallSkillResult | undefined,
): boolean {
  return !!installResult && !installResult.errors?.length;
}

/**
 * VS Code loads local Agent Plugins only from folders listed in
 * `chat.pluginLocations`, so an installed plugin stays inactive until its folder
 * is registered there.
 */
async function offerPluginLocationRegistration(
  pluginUris: vscode.Uri[],
): Promise<void> {
  if (pluginUris.length === 0) {
    return;
  }

  // Checked before any configuration read and before any prompt: on a build
  // without the setting the answer cannot be honored, so the question is never
  // worth asking. The user still has to be told, or the plugin silently never
  // loads and only a log they never read explains why.
  if (!supportsPluginLocations(vscode.version)) {
    const notice = messages.pluginLocationUnsupportedVersion(vscode.version);
    logger.info(`[Resource Ninja] ${notice}`);
    if (
      vscode.workspace
        .getConfiguration("resourceNinja")
        .get<string>("registerPluginLocation", "prompt") !== "never"
    ) {
      vscode.window.showWarningMessage(notice);
    }
    return;
  }

  const mode = vscode.workspace
    .getConfiguration("resourceNinja")
    .get<string>("registerPluginLocation", "prompt");
  if (mode === "never") {
    return;
  }

  const chatConfig = vscode.workspace.getConfiguration("chat");
  const pluginsDisabled =
    chatConfig.get<boolean>("plugins.enabled", true) === false;
  const disabledNote = pluginsDisabled
    ? ` ${messages.pluginsDisabledNote()}`
    : "";
  const compatibleUris: vscode.Uri[] = [];
  for (const uri of pluginUris) {
    try {
      const manifest = JSON.parse(
        Buffer.from(
          await vscode.workspace.fs.readFile(
            vscode.Uri.joinPath(uri, "plugin.json"),
          ),
        ).toString("utf8"),
      ) as Record<string, unknown>;
      if (manifest.$schema === AGENT_PLUGINS_MANIFEST_SCHEMA) {
        compatibleUris.push(uri);
      }
    } catch {
      logger.info(
        `[Resource Ninja] Skipped chat.pluginLocations for non-Agent-Plugin package: ${uri.fsPath}`,
      );
    }
  }
  if (compatibleUris.length === 0) {
    return;
  }
  const keys = Array.from(
    new Set(compatibleUris.map((uri) => toPluginLocationKey(uri.fsPath))),
  );

  // Nothing to offer when every folder is already registered and enabled.
  if (
    getPluginLocationsToRegister(
      chatConfig.get<Record<string, boolean>>("pluginLocations"),
      keys,
    ).length === 0
  ) {
    logger.info(
      `[Resource Ninja] Plugin locations already registered: ${keys.join(", ")}`,
    );
    return;
  }

  if (mode !== "always") {
    const registerAction = messages.pluginLocationRegisterAction();
    const prompt =
      keys.length === 1
        ? messages.pluginLocationRegisterPrompt(path.basename(keys[0]))
        : messages.pluginLocationRegisterPromptMultiple(keys.length);
    const choice = await vscode.window.showInformationMessage(
      `${prompt}${disabledNote}`,
      registerAction,
      messages.pluginLocationSkipAction(),
    );
    if (choice !== registerAction) {
      return;
    }
  }

  try {
    // Re-read here, never before the prompt: the user may have sat on the dialog
    // while another window or install changed the setting, and a stale snapshot
    // would silently discard that change.
    const writeConfig = vscode.workspace.getConfiguration("chat");
    const merged = mergePluginLocations(
      writeConfig.get<Record<string, boolean>>("pluginLocations"),
      keys,
    );
    // The key is a machine-specific absolute path, so it must never be written
    // into shared workspace settings.
    await writeConfig.update(
      "pluginLocations",
      merged,
      vscode.ConfigurationTarget.Global,
    );
    logger.info(
      `[Resource Ninja] Registered plugin locations: ${keys.join(", ")}`,
    );
    const openSettingAction = messages.pluginLocationOpenSettingAction();
    const choice = await vscode.window.showInformationMessage(
      `${messages.pluginLocationRegistered(keys.length)}${disabledNote}`,
      openSettingAction,
    );
    if (choice === openSettingAction) {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        "chat.pluginLocations",
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      `[Resource Ninja] Failed to register plugin locations: ${errorMessage}`,
    );
    vscode.window.showErrorMessage(
      messages.pluginLocationRegisterFailed(errorMessage),
    );
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
  "registerPluginLocation",
  "defaultPluginHost",
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

  // GitHub 認証を初期化し、旧設定のトークンを SecretStorage へ移行
  initializeGitHubAuth(context);
  try {
    const migrated = await migrateConfiguredGitHubTokenToSecretStorage();
    if (migrated) {
      logger.info(
        "Migrated legacy resourceNinja.githubToken setting into SecretStorage.",
      );
      const removeLegacySetting = messages.actionRemoveLegacyGitHubToken();
      const action = await vscode.window.showInformationMessage(
        messages.githubTokenMigrated(),
        removeLegacySetting,
      );
      if (action === removeLegacySetting) {
        await deleteConfiguredGitHubTokens();
      }
    }
  } catch (migrationError) {
    logger.warn(
      `Failed to migrate GitHub token into SecretStorage: ${
        migrationError instanceof Error
          ? migrationError.message
          : String(migrationError)
      }`,
    );
  }

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
      logger.info(
        `Loaded ${getIndexResources(index).length} resources from index`,
      );

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

      logger.info(
        `[Source Index] [${new Date().toISOString()}] Updating ${staleSources.length} stale source(s)`,
      );
      const { selected, deferred, nextCursorSourceId } =
        selectStaleSourcesForStartup(staleSources, {
          startAfterSourceId: context.globalState.get<string>(
            STALE_SOURCE_CURSOR_KEY,
          ),
        });
      for (const source of deferred) {
        logger.info(
          `[Source Index] [DEFERRED] ${getSourceUpdateDisplayName(source)}`,
        );
      }
      if (deferred.length > 0) {
        logger.info(
          `[Source Index] Deferred ${deferred.length} stale source(s) to a later startup.`,
        );
      }
      if (nextCursorSourceId) {
        await context.globalState.update(
          STALE_SOURCE_CURSOR_KEY,
          nextCursorSourceId,
        );
      }
      const batchResult = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: messages.staleSourceIndexUpdating(),
          cancellable: false,
        },
        async (progress) =>
          runSourceIndexUpdateBatch(
            selected,
            index,
            async (nextIndex, source) =>
              updateIndexFromSingleSource(
                context,
                nextIndex,
                source.id,
                {
                  report(value) {
                    progress.report({
                      ...value,
                      increment: scaleSourceIndexProgressIncrement(
                        selected.length,
                        value.increment,
                      ),
                    });
                  },
                },
                { forceScan: true },
              ),
          ),
      );
      const { value: nextIndex, succeeded, failures, skipped } = batchResult;
      index = nextIndex;
      skillIndex = index;
      browseProvider.refresh();

      for (const source of succeeded) {
        logger.info(
          `[Source Index] [OK] ${getSourceUpdateDisplayName(source)}`,
        );
      }
      for (const failure of failures) {
        logger.warn(
          `[Source Index] [FAILED] ${getSourceUpdateDisplayName(failure.entry)}: ${formatSourceUpdateFailureReason(failure.error)}`,
        );
      }
      for (const source of skipped) {
        logger.info(
          `[Source Index] [SKIPPED] ${getSourceUpdateDisplayName(source)}`,
        );
      }

      const notificationKind = getSourceIndexUpdateNotificationKind(
        failures.length,
      );
      if (notificationKind === "success") {
        await vscode.window.showInformationMessage(
          messages.staleSourceIndexUpdated(succeeded.length, selected.length),
        );
      } else {
        const firstFailure = failures[0];
        const detailAction = messages.actionShowDetails();
        const authAction = messages.actionConfigureGitHubAuth();
        const actions = shouldOfferGitHubAuth(firstFailure.error)
          ? [detailAction, authAction]
          : [detailAction];
        const action = await vscode.window.showWarningMessage(
          messages.staleSourceIndexPartialFailed(
            succeeded.length,
            failures.length,
            selected.length,
            failures
              .slice(0, 3)
              .map((failure) => getSourceUpdateDisplayName(failure.entry))
              .join(", "),
            formatSourceUpdateFailureReason(firstFailure.error),
            skipped.length,
          ),
          ...actions,
        );
        if (action === detailAction) {
          logger.show(true);
        } else if (action === authAction) {
          await showAuthHelp(firstFailure.error);
        }
      }

      if (failures.length === 0 && staleUpdateMode !== "always") {
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

  type ReinstallAllCommandOptions = {
    skipConfirmation?: boolean;
    suppressSuccessMessage?: boolean;
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
    return formatBatchFailureMessage(
      scopeLabel,
      success,
      total,
      failedNames,
      isJapanese(),
    );
  }

  function getReinstallTrashRecoverySuffix(failedCount: number): string {
    if (failedCount === 0) {
      return "";
    }
    return isJapanese()
      ? " 削除後に失敗したresourceはごみ箱から復元できます。"
      : " Resources that failed after removal can be restored from the trash.";
  }

  function getBatchCancellationSuffix(
    processed: number,
    requested: number,
  ): string {
    return formatBatchCancellationSuffix(processed, requested, isJapanese());
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
    if (e.affectsConfiguration("resourceNinja.githubToken")) {
      // 旧設定のトークンが変更されたら SecretStorage を同期（セッション中の編集を反映）
      try {
        await syncConfiguredGitHubToken();
      } catch (syncError) {
        logger.warn(
          `Failed to sync GitHub token to SecretStorage: ${
            syncError instanceof Error ? syncError.message : String(syncError)
          }`,
        );
      }
    }

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
            const showDetails = messages.actionShowDetails();
            const action = await vscode.window.showWarningMessage(
              isJapanese()
                ? "設定変更後のresource output更新に失敗しました。以前のmanaged blockは削除済みの可能性があります。"
                : "Failed to update resource output after the settings change. The previous managed block may already have been removed.",
              showDetails,
            );
            if (action === showDetails) {
              logger.show(true);
            }
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
        return false;
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
        resource.kind === "hook" &&
        !isFileBackedHookResourcePath(resource.fullPath);
      // A plugin is scanned by its manifest, but the installed unit is the whole folder.
      const pluginRootFsPath =
        resource.kind === "plugin"
          ? getPluginRootFsPathFromManifestPath(resource.fullPath)
          : undefined;
      const isDirectoryTarget =
        resource.kind === "skill" ||
        isDirectoryBackedHook ||
        pluginRootFsPath !== undefined;
      const targetUri = pluginRootFsPath
        ? vscode.Uri.file(pluginRootFsPath)
        : resource.kind === "skill" || isDirectoryBackedHook
          ? vscode.Uri.file(path.dirname(resource.fullPath))
          : resourceUri;

      let hookConfigUpdate:
        | import("./hookConfigManager").HookConfigUpdateResult
        | undefined;
      let hookConfigSummary: string | undefined;
      try {
        if (
          !isDeletableWithin(resource.rootFsPath, targetUri.fsPath) ||
          !isRealPathStrictlyInside(resource.rootFsPath, targetUri.fsPath)
        ) {
          throw new Error(
            `Refused to delete ${targetUri.fsPath} outside ${resource.rootFsPath}`,
          );
        }
        if (isDirectoryBackedHook) {
          hookConfigUpdate = await updateHookConfigForUninstall(
            wsFolder.uri,
            resourceUri,
          );
          hookConfigSummary = formatHookConfigUpdateSummary(hookConfigUpdate);
        }

        await vscode.workspace.fs.delete(targetUri, {
          recursive: isDirectoryTarget,
          useTrash: true,
        });

        if (pluginRootFsPath) {
          await unregisterPluginLocations(
            [targetUri.fsPath],
            path.basename(pluginRootFsPath),
          );
        }

        if (!isDirectoryTarget) {
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
      let resources = getIndexResources(index);
      let fullSkill = resources.find(
        (s: Skill) =>
          getResourceKind(s) === resource.kind &&
          s.source === resource.source &&
          s.path === resource.remotePath,
      );
      if (!fullSkill) {
        fullSkill = resources.find(
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
          resources = getIndexResources(index);

          fullSkill = resources.find(
            (s: Skill) =>
              getResourceKind(s) === resource.kind &&
              s.source === resource.source &&
              s.path === resource.remotePath,
          );
          if (!fullSkill) {
            fullSkill = resources.find(
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

      const installOptions = { targetScope, suppressRecoveryPrompt };

      try {
        // A plugin always installs into the fixed Global Home `plugins`
        // directory, so a plugin scanned from a configured user-data path is
        // recreated somewhere other than it was removed from. The destination is
        // taken from the install itself, because a setting that changes while the
        // progress notification is up would make a precomputed one name a folder
        // that was never created.
        let installResult: Awaited<ReturnType<typeof installSkill>> | undefined;
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
              resource.rootFsPath,
            );
            installResult = await installSkill(
              fullSkill,
              wsFolder.uri,
              context,
              installOptions,
            );

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

        // The delete above dropped the registration for the folder it removed, so
        // the destination the install reported goes back through the same path a
        // normal install uses and keeps honouring `registerPluginLocation` and the
        // version guard. A failed install leaves `installResult` unset, and an
        // install that could not download every file must not be registered
        // either, so nothing is put back for a folder with missing content.
        if (
          resource.kind === "plugin" &&
          installResult &&
          installWasClean(installResult)
        ) {
          await offerPluginLocationRegistration([installResult.destinationUri]);
        }

        markRecentlyInstalled(fullSkill);
        userResourcesProvider.refresh();
        browseProvider.refresh();
        workspaceProvider.refresh();

        if (!installWasClean(installResult)) {
          // The install already warned about the files it could not download;
          // reporting failure here is what the group reinstall aggregates.
          return false;
        }

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
              ? `再インストール失敗: ${String(error)}。元のファイルはごみ箱から復元できます。`
              : `Reinstall failed: ${String(error)}. You can restore the original files from the trash.`,
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
      let completed = 0;
      let cancelled = false;
      const failedResources: string[] = [];
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: isJapanese()
            ? `${groupLabel} を再インストール中...`
            : `Reinstalling ${groupLabel}...`,
          cancellable: true,
        },
        async (progress, token) => {
          for (const resource of remoteTargets) {
            if (token.isCancellationRequested) {
              cancelled = true;
              break;
            }
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
      if (failedResources.length > 0 || cancelled) {
        const total = cancelled ? completed : remoteTargets.length;
        vscode.window.showWarningMessage(
          `${getBatchFailureMessage(
            groupLabel,
            success,
            total,
            failedResources,
          )}${cancelled ? getBatchCancellationSuffix(completed, remoteTargets.length) : ""}`,
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
          rootFsPath: wsFolder?.uri.fsPath || path.dirname(resource.fullPath),
        })),
        ...userPluginResources.map((resource) => ({
          kind: resource.kind,
          name: resource.name,
          fullPath: resource.fullPath,
          rootFsPath: resource.rootFsPath,
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
      let completed = 0;
      let cancelled = false;
      let deletedSkills = 0;
      const failedResources: string[] = [];
      const deletedFsPaths: string[] = [];
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: isJapanese()
            ? `プラグイン "${pluginId}" のリソースを削除中...`
            : `Deleting resources from plugin "${pluginId}"...`,
          cancellable: true,
        },
        async (progress, token) => {
          for (const resource of resources) {
            if (token.isCancellationRequested) {
              cancelled = true;
              break;
            }
            progress.report({
              message: `${resource.name} (${completed + 1}/${resources.length})`,
              increment: 100 / resources.length,
            });
            try {
              await deleteInstalledResourceByPath(
                resource.kind,
                resource.fullPath,
                resource.rootFsPath,
              );
              deletedFsPaths.push(resource.fullPath);
              if (resource.kind === "skill") {
                deletedSkills++;
              }
            } catch (error) {
              failed++;
              failedResources.push(resource.name);
              logger.error(
                `[Resource Ninja] Failed to delete plugin resource ${resource.name}:`,
                error,
              );
            }
            completed++;
          }
        },
      );

      await unregisterPluginLocations(deletedFsPaths, pluginId);

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
      const success = completed - failed;
      if (failedResources.length > 0 || cancelled) {
        const total = cancelled ? completed : resources.length;
        vscode.window.showWarningMessage(
          `${getBatchFailureMessage(
            isJapanese()
              ? `プラグイン "${pluginId}" のリソース削除`
              : `Delete plugin "${pluginId}" resources`,
            success,
            total,
            failedResources,
          )}${cancelled ? getBatchCancellationSuffix(completed, resources.length) : ""}`,
        );
      } else {
        vscode.window.showInformationMessage(
          isJapanese()
            ? `プラグイン "${pluginId}" の ${success}/${resources.length} 個のリソースを削除しました`
            : `Deleted ${success}/${resources.length} resources from plugin "${pluginId}"`,
        );
      }
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
        // The sidecar can arrive from a third-party repository, so a path found
        // inside it is dropped instead of being written back.
        stripSkillMetaLocalPaths(meta as unknown as Record<string, unknown>);
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

  interface PluginHostExecutableProbe {
    executablePath: string;
    version: string;
    cwd: string;
    environment: Record<string, string>;
    targetPaths: string[];
  }

  function getPluginHostHome(hostId: PluginHostId): string {
    switch (hostId) {
      case "claude-code":
        return (
          process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude")
        );
      case "codex":
        return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
      case "copilot-cli":
      default:
        return process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot");
    }
  }

  function getPluginHostEnvironment(
    hostId: PluginHostId,
  ): Record<string, string> {
    const commonKeys = [
      "PATH",
      "PATHEXT",
      "SystemRoot",
      "COMSPEC",
      "TEMP",
      "TMP",
      "HOME",
      "USERPROFILE",
      "APPDATA",
      "LOCALAPPDATA",
      "LANG",
    ];
    const hostKeys =
      hostId === "claude-code"
        ? ["CLAUDE_CONFIG_DIR", "ANTHROPIC_API_KEY"]
        : hostId === "codex"
          ? ["CODEX_HOME", "OPENAI_API_KEY"]
          : ["COPILOT_HOME", "GH_TOKEN", "GITHUB_TOKEN"];
    return buildSanitizedEnvironment(process.env, [...commonKeys, ...hostKeys]);
  }

  async function probePluginHostExecutable(
    hostId: PluginHostId,
    executablePath: string,
    cwd: string,
  ): Promise<PluginHostExecutableProbe> {
    const resolvedExecutable = await realpath(executablePath);
    const environment = getPluginHostEnvironment(hostId);
    const versionResult = await runPluginHostProcess(
      resolvedExecutable,
      ["--version"],
      {
        cwd,
        environment,
        timeoutMs: 15_000,
        outputLimit: 8 * 1024,
      },
    );
    if (versionResult.exitCode !== 0 || versionResult.error) {
      throw new Error(
        versionResult.error ||
          versionResult.stderr.trim() ||
          "Could not read plugin host version.",
      );
    }
    const version = versionResult.stdout.trim().split(/\r?\n/, 1)[0];
    if (!version) {
      throw new Error("Plugin host returned an empty version.");
    }
    return {
      executablePath: resolvedExecutable,
      version,
      cwd,
      environment,
      targetPaths: [path.resolve(getPluginHostHome(hostId))],
    };
  }

  function createGatedPluginHostRunner(input: {
    probe: PluginHostExecutableProbe;
    hostId: PluginHostId;
    action: PluginHostAction;
    scope?: PluginInstallScope;
    resourceIdentity: string;
    sourceOrigin: string;
    readonlyCommands: readonly (readonly string[])[];
    mutationCommands: readonly (readonly string[])[];
  }): PluginHostCommandRunner {
    return createApprovedCommandRunner({
      authority: pluginExecutionAuthority,
      executor: pluginMutationExecutor,
      hostId: input.hostId,
      action: input.action,
      scope: input.scope,
      executablePath: input.probe.executablePath,
      executableVersion: input.probe.version,
      cwd: input.probe.cwd,
      environment: input.probe.environment,
      resourceIdentity: input.resourceIdentity,
      sourceOrigin: input.sourceOrigin,
      resolutionMode: "host-resolved",
      targetPaths: input.probe.targetPaths,
      readonlyCommands: input.readonlyCommands,
      mutationCommands: input.mutationCommands,
    });
  }

  function getGitHubOwnerRepo(source: Source): string | undefined {
    try {
      const url = new URL(source.url);
      if (url.hostname.toLowerCase() !== "github.com") {
        return undefined;
      }
      return normalizeGitHubOwnerRepo(url.pathname.replace(/^\/+|\/+$/g, ""));
    } catch {
      return undefined;
    }
  }

  const pluginMarketplaceCache = new Map<
    string,
    {
      expiresAt: number;
      value: Promise<{ ownerRepo: string; contents: string[] }>;
    }
  >();

  function getPluginMarketplaceData(
    source: Source,
    manifestPath?: string,
  ): Promise<{ ownerRepo: string; contents: string[] }> {
    const cached = pluginMarketplaceCache.get(source.id);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const pending = (async () => {
      const ownerRepo = getGitHubOwnerRepo(source);
      if (!ownerRepo) {
        throw new Error("The plugin source is not a GitHub repository.");
      }
      const { token } = await resolveGitHubToken();
      const branch = await getSourceBranch(source, token, manifestPath);
      const [owner, repo] = ownerRepo.split("/");
      const contents: string[] = [];
      for (const marketplacePath of COPILOT_MARKETPLACE_MANIFEST_PATHS) {
        const content = await fetchGitHubTextContent(
          owner,
          repo,
          branch,
          marketplacePath,
          token,
        );
        if (content !== undefined) {
          contents.push(content);
        }
      }
      return { ownerRepo, contents };
    })();
    pluginMarketplaceCache.set(source.id, {
      expiresAt: Date.now() + 30_000,
      value: pending,
    });
    pending.catch(() => {
      if (pluginMarketplaceCache.get(source.id)?.value === pending) {
        pluginMarketplaceCache.delete(source.id);
      }
    });
    return pending;
  }

  async function resolveCopilotCliPluginIdentity(
    skill: Skill,
  ): Promise<CopilotMarketplacePluginIdentity> {
    const pluginRoot = getCanonicalCopilotCliPluginRoot(skill);
    if (!pluginRoot) {
      throw new Error(
        isJapanese()
          ? "このリソースは Copilot CLI marketplace の実プラグインとして特定できません。"
          : "This resource cannot be identified as a concrete Copilot CLI marketplace plugin.",
      );
    }
    if (!skillIndex) {
      skillIndex = await loadSkillIndex(context);
    }
    const source = skillIndex.sources.find(
      (candidate) => candidate.id === skill.source,
    );
    if (!source) {
      throw new Error(
        isJapanese()
          ? "Copilot CLI marketplace の GitHub ソースを解決できません。"
          : "The GitHub source for the Copilot CLI marketplace could not be resolved.",
      );
    }
    const { ownerRepo, contents: marketplaceContents } =
      await getPluginMarketplaceData(source, skill.pluginManifestPath);
    const identity = resolveMarketplacePluginIdentityFromCandidates(
      marketplaceContents,
      pluginRoot,
      ownerRepo,
    );
    if (identity) {
      return identity;
    }
    throw new Error(
      isJapanese()
        ? "Copilot CLI が認識する marketplace.json に、このプラグインと一意に一致する entry がありません。VS Code 向けとしてインストールしてください。"
        : "No marketplace.json recognized by Copilot CLI has one unique entry for this plugin. Install it for VS Code instead.",
    );
  }

  async function probeVsCodePluginState(
    skill: Skill,
  ): Promise<PluginHostState> {
    if (!workspaceFolder) {
      return {
        hostId: "vscode-copilot",
        status: "unknown",
        reason: "No workspace is open.",
      };
    }
    const [workspaceResources, userResources] = await Promise.all([
      scanLocalSkills(workspaceFolder.uri, true, true),
      scanUserResources(workspaceFolder.uri, false),
    ]);
    const targetKeys = new Set(getResourceIdentityKeys(skill));
    const installed = [...workspaceResources, ...userResources].find(
      (resource) =>
        getResourceKind(resource) === "plugin" &&
        getResourceIdentityKeys(resource).some((key) => targetKeys.has(key)),
    );
    if (!installed) {
      return { hostId: "vscode-copilot", status: "not-installed" };
    }
    let enabled: boolean | undefined;
    if (
      supportsPluginLocations(vscode.version) &&
      installed.fullPath &&
      getPluginRootFsPathFromManifestPath(installed.fullPath)
    ) {
      const pluginRoot = getPluginRootFsPathFromManifestPath(
        installed.fullPath,
      )!;
      const chatConfig = vscode.workspace.getConfiguration("chat");
      const locations =
        chatConfig.get<Record<string, boolean>>("pluginLocations");
      const key = toPluginLocationKey(pluginRoot);
      const locationEnabled = locations?.[key] === true;
      const pluginsEnabled =
        chatConfig.get<boolean>("plugins.enabled", true) !== false;
      enabled = locationEnabled && pluginsEnabled;
    }
    return {
      hostId: "vscode-copilot",
      status: "installed",
      enabled,
      version:
        typeof (installed as { version?: unknown }).version === "string"
          ? (installed as { version: string }).version
          : undefined,
    };
  }

  async function runPluginHostReadOnly(input: {
    hostId: PluginHostId;
    executablePath: string;
    args: readonly string[];
  }): Promise<PluginHostCommandResult> {
    const executablePath = await realpath(input.executablePath);
    return runPluginHostProcess(executablePath, input.args, {
      cwd: workspaceFolder?.uri.fsPath ?? os.homedir(),
      environment: getPluginHostEnvironment(input.hostId),
      timeoutMs: 10_000,
      outputLimit: 64 * 1024,
    });
  }

  async function probeCliPluginState(input: {
    hostId: "copilot-cli" | "claude-code" | "codex";
    executablePath: string;
    pluginId: string;
  }): Promise<PluginHostState> {
    const args =
      input.hostId === "copilot-cli"
        ? ["--no-color", "plugin", "list"]
        : ["plugin", "list", "--json"];
    const result = await runPluginHostReadOnly({
      hostId: input.hostId,
      executablePath: input.executablePath,
      args,
    });
    if (result.exitCode !== 0 || result.error || result.timedOut) {
      return {
        hostId: input.hostId,
        status: "error",
        reason:
          result.error || result.stderr.trim() || "Plugin state probe failed.",
      };
    }
    if (input.hostId === "copilot-cli") {
      const states = parseCopilotCliPluginList(result.stdout);
      if (!states) {
        return {
          hostId: input.hostId,
          status: "unknown",
          reason: "Copilot CLI plugin list output was not recognized.",
        };
      }
      const state = states.find((candidate) => candidate.id === input.pluginId);
      return state
        ? {
            hostId: input.hostId,
            status: "installed",
            enabled: state.enabled,
            version: state.version,
          }
        : { hostId: input.hostId, status: "not-installed" };
    }
    if (input.hostId === "claude-code") {
      const states = parseClaudePluginListJson(result.stdout);
      if (!states) {
        return {
          hostId: input.hostId,
          status: "unknown",
          reason: "Claude Code plugin JSON was not recognized.",
        };
      }
      const state = states.find((candidate) => candidate.id === input.pluginId);
      return state
        ? {
            hostId: input.hostId,
            status: "installed",
            enabled: state.enabled,
            version: state.version,
          }
        : { hostId: input.hostId, status: "not-installed" };
    }
    const states = parseCodexPluginListJson(result.stdout);
    if (!states) {
      return {
        hostId: input.hostId,
        status: "unknown",
        reason: "Codex plugin JSON was not recognized.",
      };
    }
    const state = states.find(
      (candidate) => candidate.pluginId === input.pluginId,
    );
    return state
      ? {
          hostId: input.hostId,
          status: "installed",
          enabled: state.enabled,
          version: state.version,
        }
      : { hostId: input.hostId, status: "not-installed" };
  }

  async function probeCursorPluginState(
    skill: Skill,
  ): Promise<PluginHostState> {
    const targetPath = getCursorLocalPluginPath(os.homedir(), skill.name);
    const receipts = context.globalState.get<CursorPluginReceipt[]>(
      CURSOR_PLUGIN_RECEIPTS_KEY,
      [],
    );
    const receipt = receipts.find(
      (candidate) =>
        candidate.targetPath === targetPath &&
        candidate.source === skill.source &&
        candidate.remotePath === skill.path,
    );
    if (!receipt || !targetPath) {
      return { hostId: "cursor", status: "not-installed" };
    }
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(targetPath));
      return { hostId: "cursor", status: "installed" };
    } catch {
      return {
        hostId: "cursor",
        status: "error",
        reason: "The owned Cursor plugin path is missing.",
      };
    }
  }

  async function probePluginHostStates(input: {
    skill: Skill;
    identity?: CopilotMarketplacePluginIdentity;
    copilotCliExecutable?: string;
    claudeExecutable?: string;
    codexExecutable?: string;
    cursorDetected: boolean;
  }): Promise<Map<PluginHostId, PluginHostState>> {
    const probes: Array<{
      hostId: PluginHostId;
      operation: Promise<PluginHostState>;
    }> = [
      {
        hostId: "vscode-copilot",
        operation: probeVsCodePluginState(input.skill),
      },
    ];
    if (input.identity && input.copilotCliExecutable) {
      probes.push({
        hostId: "copilot-cli",
        operation: probeCliPluginState({
          hostId: "copilot-cli",
          executablePath: input.copilotCliExecutable,
          pluginId: `${input.identity.pluginName}@${input.identity.marketplaceName}`,
        }),
      });
    }
    if (input.identity && input.claudeExecutable) {
      probes.push({
        hostId: "claude-code",
        operation: probeCliPluginState({
          hostId: "claude-code",
          executablePath: input.claudeExecutable,
          pluginId: `${input.identity.pluginName}@${input.identity.marketplaceName}`,
        }),
      });
    }
    if (input.identity && input.codexExecutable) {
      probes.push({
        hostId: "codex",
        operation: probeCliPluginState({
          hostId: "codex",
          executablePath: input.codexExecutable,
          pluginId: `${input.identity.pluginName}@${input.identity.marketplaceName}`,
        }),
      });
    }
    if (input.cursorDetected) {
      probes.push({
        hostId: "cursor",
        operation: probeCursorPluginState(input.skill),
      });
    }
    return collectPluginHostStates(probes, 12_000);
  }

  function formatCliCleanup(cleanup: MarketplaceCleanupResult): string {
    if (cleanup.status === "not-needed") {
      return "";
    }
    if (cleanup.status === "removed") {
      return isJapanese()
        ? " 追加した marketplace は削除しました。"
        : " The marketplace added by this operation was removed.";
    }
    const label =
      cleanup.status === "skipped"
        ? isJapanese()
          ? "cleanup を安全に実行できませんでした"
          : "Cleanup was skipped because ownership could not be proven"
        : isJapanese()
          ? "cleanup に失敗しました"
          : "Cleanup failed";
    return ` ${label}: ${cleanup.reason}`;
  }

  async function installPluginInCopilotCli(skill: Skill): Promise<boolean> {
    try {
      const identity = await resolveCopilotCliPluginIdentity(skill);
      const executable = await findCopilotCliExecutable();
      if (!executable) {
        vscode.window.showErrorMessage(
          isJapanese()
            ? "Copilot CLI 実行ファイルが PATH に見つかりません。Copilot CLI をインストールしてから再実行してください。"
            : "No Copilot CLI executable was found on PATH. Install Copilot CLI and try again.",
        );
        return false;
      }
      const probe = await probePluginHostExecutable(
        "copilot-cli",
        executable,
        workspaceFolder?.uri.fsPath ?? os.homedir(),
      );

      const installAction = isJapanese()
        ? "Copilot CLI にインストール"
        : "Install in Copilot CLI";
      const choice = await vscode.window.showWarningMessage(
        isJapanese()
          ? `${identity.pluginName}@${identity.marketplaceName} を Copilot CLI にインストールします。必要に応じて marketplace (${identity.ownerRepo}) も登録します。プラグインには skills、agents、hooks、MCP/LSP servers が含まれ、Copilot CLI 実行時に読み込まれる可能性があります。\n\n実行: ${probe.executablePath}\nVersion: ${probe.version}`
          : `Install ${identity.pluginName}@${identity.marketplaceName} in Copilot CLI. Its marketplace (${identity.ownerRepo}) will also be registered if needed. Plugins can include skills, agents, hooks, and MCP/LSP servers that Copilot CLI may load at runtime.\n\nExecutable: ${probe.executablePath}\nVersion: ${probe.version}`,
        { modal: true },
        installAction,
      );
      if (choice !== installAction) {
        return false;
      }
      const pluginId = `${identity.pluginName}@${identity.marketplaceName}`;
      const runner = createGatedPluginHostRunner({
        probe,
        hostId: "copilot-cli",
        action: "install",
        scope: "user",
        resourceIdentity: pluginId,
        sourceOrigin: identity.ownerRepo,
        readonlyCommands: [["--no-color", "plugin", "marketplace", "list"]],
        mutationCommands: [
          ["--no-color", "plugin", "marketplace", "add", identity.ownerRepo],
          ["--no-color", "plugin", "install", pluginId],
          [
            "--no-color",
            "plugin",
            "marketplace",
            "remove",
            identity.marketplaceName,
          ],
        ],
      });

      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: isJapanese()
            ? `${identity.pluginName} を Copilot CLI にインストール中...`
            : `Installing ${identity.pluginName} in Copilot CLI...`,
          cancellable: false,
        },
        () => installCopilotCliPlugin(identity, runner),
      );
      if (!result.ok) {
        const message = `${result.reason}${formatCliCleanup(result.cleanup)}`;
        logger.error(
          `[Resource Ninja] Copilot CLI plugin install failed (${result.phase}): ${message}`,
        );
        vscode.window.showErrorMessage(
          isJapanese()
            ? `Copilot CLI へのインストールに失敗しました: ${message}`
            : `Copilot CLI plugin installation failed: ${message}`,
        );
        return false;
      }
      vscode.window.showInformationMessage(
        isJapanese()
          ? `${identity.pluginName}@${identity.marketplaceName} を Copilot CLI にインストールしました。`
          : `Installed ${identity.pluginName}@${identity.marketplaceName} in Copilot CLI.`,
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        `[Resource Ninja] Failed to resolve Copilot CLI plugin: ${message}`,
      );
      vscode.window.showErrorMessage(message);
      return false;
    }
  }

  async function pickRemotePlugin(
    manifestKinds?: readonly string[],
  ): Promise<Skill | undefined> {
    if (!skillIndex) {
      skillIndex = await loadSkillIndex(context);
    }
    const plugins = getIndexResources(skillIndex).filter(
      (resource) =>
        getResourceKind(resource) === "plugin" &&
        resource.pluginManifestKind !== "marketplace" &&
        (!manifestKinds ||
          manifestKinds.includes(resource.pluginManifestKind ?? "")),
    );
    const selected = await vscode.window.showQuickPick(
      plugins.map((plugin) => ({
        label: plugin.name,
        description: plugin.source,
        detail: plugin.pluginRoot || plugin.path,
        plugin,
      })),
      {
        placeHolder: isJapanese()
          ? "Copilot CLI で管理するプラグインを選択"
          : "Select a plugin to manage in Copilot CLI",
        matchOnDescription: true,
        matchOnDetail: true,
      },
    );
    return selected?.plugin;
  }

  async function pickInstalledRemotePlugin(input: {
    hostId: "claude-code" | "codex";
    executablePath: string;
    manifestKind: string;
  }): Promise<Skill | undefined> {
    const result = await runPluginHostReadOnly({
      hostId: input.hostId,
      executablePath: input.executablePath,
      args: ["plugin", "list", "--json"],
    });
    if (result.exitCode !== 0 || result.error || result.timedOut) {
      vscode.window.showWarningMessage(
        isJapanese()
          ? "Hostのインストール済み状態を取得できません。Unknownとしてカタログから選択します。"
          : "Installed host state could not be read. Select from the catalog with Unknown state.",
      );
      return pickRemotePlugin([input.manifestKind]);
    }
    const installedIds =
      input.hostId === "claude-code"
        ? parseClaudePluginListJson(result.stdout)?.map((state) => state.id)
        : parseCodexPluginListJson(result.stdout)
            ?.filter((state) => state.installed !== false)
            .map((state) => state.pluginId);
    if (!installedIds) {
      vscode.window.showWarningMessage(
        isJapanese()
          ? "Hostのplugin list形式を認識できません。Unknownとしてカタログから選択します。"
          : "The host plugin list format was not recognized. Select from the catalog with Unknown state.",
      );
      return pickRemotePlugin([input.manifestKind]);
    }
    if (installedIds.length === 0) {
      vscode.window.showInformationMessage(
        isJapanese()
          ? "このHostにインストール済みのpluginはありません。"
          : "No plugins are installed in this host.",
      );
      return undefined;
    }
    if (!skillIndex) {
      skillIndex = await loadSkillIndex(context);
    }
    const candidates = getIndexResources(skillIndex).filter(
      (resource) =>
        getResourceKind(resource) === "plugin" &&
        resource.pluginManifestKind === input.manifestKind,
    );
    const resolvedCandidates = await Promise.allSettled(
      candidates.map(async (plugin) => {
        const identity = await withPluginStateTimeout(
          resolveCopilotCliPluginIdentity(plugin),
          12_000,
          undefined,
        );
        if (!identity) {
          return undefined;
        }
        const pluginId = `${identity.pluginName}@${identity.marketplaceName}`;
        return installedIds.includes(pluginId)
          ? { plugin, pluginId }
          : undefined;
      }),
    );
    const matched = resolvedCandidates.flatMap((result) =>
      result.status === "fulfilled" && result.value ? [result.value] : [],
    );
    if (matched.length === 0) {
      vscode.window.showWarningMessage(
        isJapanese()
          ? "インストール済みpluginに対応するカタログentryが見つかりません。"
          : "No catalog entry matches the installed plugin identity.",
      );
      return undefined;
    }
    const selected = await vscode.window.showQuickPick(
      matched.map(({ plugin, pluginId }) => ({
        label: plugin.name,
        description: pluginId,
        detail: isJapanese() ? "インストール済み" : "Installed",
        plugin,
      })),
      {
        placeHolder: isJapanese()
          ? "管理するインストール済みpluginを選択"
          : "Select an installed plugin to manage",
      },
    );
    return selected?.plugin;
  }

  async function uninstallPluginFromCopilotCli(
    skillOrItem?: Skill | SkillTreeItem,
  ): Promise<boolean> {
    const skill =
      skillOrItem instanceof SkillTreeItem
        ? skillOrItem.skill
        : skillOrItem || (await pickRemotePlugin());
    if (!skill || getResourceKind(skill) !== "plugin") {
      return false;
    }
    try {
      const identity = await resolveCopilotCliPluginIdentity(skill);
      const executable = await findCopilotCliExecutable();
      if (!executable) {
        vscode.window.showErrorMessage(
          isJapanese()
            ? "Copilot CLI 実行ファイルが PATH に見つかりません。"
            : "No Copilot CLI executable was found on PATH.",
        );
        return false;
      }
      const probe = await probePluginHostExecutable(
        "copilot-cli",
        executable,
        workspaceFolder?.uri.fsPath ?? os.homedir(),
      );
      const uninstallAction = isJapanese()
        ? "Copilot CLI からアンインストール"
        : "Uninstall from Copilot CLI";
      const choice = await vscode.window.showWarningMessage(
        isJapanese()
          ? `${identity.pluginName}@${identity.marketplaceName} を Copilot CLI から削除します。marketplace 登録は残します。\n\n実行: ${probe.executablePath}\nVersion: ${probe.version}`
          : `Remove ${identity.pluginName}@${identity.marketplaceName} from Copilot CLI. The marketplace registration will be kept.\n\nExecutable: ${probe.executablePath}\nVersion: ${probe.version}`,
        { modal: true },
        uninstallAction,
      );
      if (choice !== uninstallAction) {
        return false;
      }
      const pluginId = `${identity.pluginName}@${identity.marketplaceName}`;
      const runner = createGatedPluginHostRunner({
        probe,
        hostId: "copilot-cli",
        action: "uninstall",
        scope: "user",
        resourceIdentity: pluginId,
        sourceOrigin: identity.ownerRepo,
        readonlyCommands: [["--no-color", "plugin", "marketplace", "list"]],
        mutationCommands: [["--no-color", "plugin", "uninstall", pluginId]],
      });
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: isJapanese()
            ? `${identity.pluginName} を Copilot CLI から削除中...`
            : `Removing ${identity.pluginName} from Copilot CLI...`,
          cancellable: false,
        },
        () => uninstallCopilotCliPlugin(identity, runner),
      );
      if (!result.ok) {
        vscode.window.showErrorMessage(
          isJapanese()
            ? `Copilot CLI からの削除に失敗しました: ${result.reason}`
            : `Copilot CLI plugin removal failed: ${result.reason}`,
        );
        return false;
      }
      vscode.window.showInformationMessage(
        isJapanese()
          ? `${identity.pluginName}@${identity.marketplaceName} を Copilot CLI から削除しました。`
          : `Removed ${identity.pluginName}@${identity.marketplaceName} from Copilot CLI.`,
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(message);
      return false;
    }
  }

  async function installPluginInClaudeCode(skill: Skill): Promise<boolean> {
    try {
      const claudeExecutable = await findExecutableOnPath("claude");
      const claudeNativeExecutable =
        claudeExecutable && canExecuteWithoutShell(claudeExecutable)
          ? claudeExecutable
          : undefined;
      const claudeExtensionDetected = !!vscode.extensions.getExtension(
        "anthropic.claude-code",
      );
      const availability = getClaudeCodeAvailability({
        extensionDetected: claudeExtensionDetected,
        executablePath: claudeNativeExecutable,
        nativeExecutionEnabled: true,
      });
      if (availability === "unavailable") {
        vscode.window.showErrorMessage(
          isJapanese()
            ? "Claude Code のVS Code拡張またはstandalone CLIが見つかりません。"
            : "Neither the Claude Code VS Code extension nor standalone CLI was found.",
        );
        return false;
      }
      let identity: CopilotMarketplacePluginIdentity | undefined;
      let identityError: string | undefined;
      try {
        identity = await resolveCopilotCliPluginIdentity(skill);
      } catch (error) {
        identityError = error instanceof Error ? error.message : String(error);
        logger.warn(
          `[Resource Ninja] Claude Code marketplace identity unavailable: ${identityError}`,
        );
      }
      const openAction = isJapanese()
        ? "Claude Codeを開く"
        : "Open Claude Code";
      if (!claudeNativeExecutable || !identity) {
        const choice = await vscode.window.showInformationMessage(
          isJapanese()
            ? `${skill.name} はClaude Codeの /plugins UIでインストールできます。${identityError ? ` 自動解決できない理由: ${identityError}` : ""}`
            : `${skill.name} can be installed from Claude Code's /plugins UI.${identityError ? ` Automatic resolution failed: ${identityError}` : ""}`,
          ...(claudeExtensionDetected ? [openAction] : []),
        );
        if (choice !== openAction) {
          return false;
        }
        const prompt = encodeURIComponent(
          identity
            ? `/plugins で ${identity.pluginName}@${identity.marketplaceName} を確認`
            : `/plugins で ${skill.name} を検索`,
        );
        await vscode.env.openExternal(
          vscode.Uri.parse(
            `vscode://anthropic.claude-code/open?prompt=${prompt}`,
          ),
        );
        return false;
      }

      const scopeItems = [
        {
          label: isJapanese()
            ? "User - すべてのproject"
            : "User - all projects",
          scope: "user" as PluginInstallScope,
        },
        ...(vscode.workspace.isTrusted
          ? [
              {
                label: isJapanese()
                  ? "Project - repositoryで共有"
                  : "Project - shared in the repository",
                scope: "project" as PluginInstallScope,
              },
              {
                label: isJapanese()
                  ? "Local - このrepositoryの自分だけ"
                  : "Local - only you in this repository",
                scope: "local" as PluginInstallScope,
              },
            ]
          : []),
      ];
      const selectedScope = await vscode.window.showQuickPick(scopeItems, {
        placeHolder: isJapanese()
          ? "Claude Code pluginのscopeを選択"
          : "Choose the Claude Code plugin scope",
      });
      if (!selectedScope) {
        return false;
      }
      const probe = await probePluginHostExecutable(
        "claude-code",
        claudeNativeExecutable,
        workspaceFolder?.uri.fsPath ?? os.homedir(),
      );
      const pluginId = `${identity.pluginName}@${identity.marketplaceName}`;
      const installAction = isJapanese()
        ? "Claude Codeにインストール"
        : "Install in Claude Code";
      const choice = await vscode.window.showWarningMessage(
        isJapanese()
          ? `${pluginId} をClaude Codeへ${selectedScope.scope} scopeでインストールします。pluginはskills、agents、hooks、MCP/LSP servers、monitorsを有効化し得ます。\n\n実行: ${probe.executablePath}\nVersion: ${probe.version}`
          : `Install ${pluginId} in Claude Code with ${selectedScope.scope} scope. The plugin can activate skills, agents, hooks, MCP/LSP servers, and monitors.\n\nExecutable: ${probe.executablePath}\nVersion: ${probe.version}`,
        { modal: true },
        installAction,
      );
      if (choice !== installAction) {
        return false;
      }
      const runner = createGatedPluginHostRunner({
        probe,
        hostId: "claude-code",
        action: "install",
        scope: selectedScope.scope,
        resourceIdentity: pluginId,
        sourceOrigin: identity.ownerRepo,
        readonlyCommands: [
          ["plugin", "marketplace", "list", "--json"],
          ["plugin", "list", "--json"],
        ],
        mutationCommands: [
          [
            "plugin",
            "marketplace",
            "add",
            identity.ownerRepo,
            "--scope",
            selectedScope.scope,
          ],
          ["plugin", "install", pluginId, "--scope", selectedScope.scope],
          [
            "plugin",
            "marketplace",
            "remove",
            identity.marketplaceName,
            "--scope",
            selectedScope.scope,
          ],
        ],
      });
      const result = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: isJapanese()
            ? `${identity.pluginName} をClaude Codeへインストール中...`
            : `Installing ${identity.pluginName} in Claude Code...`,
          cancellable: false,
        },
        () =>
          installClaudeCodePlugin({
            runner,
            pluginName: identity.pluginName,
            marketplaceName: identity.marketplaceName,
            marketplaceSource: identity.ownerRepo,
            scope: selectedScope.scope,
          }),
      );
      if (!result.ok) {
        vscode.window.showErrorMessage(
          isJapanese()
            ? `Claude Codeへのインストールに失敗しました: ${result.reason}`
            : `Claude Code plugin installation failed: ${result.reason}`,
        );
        return false;
      }
      vscode.window.showInformationMessage(
        isJapanese()
          ? `${pluginId} をClaude Codeへインストールしました。既存sessionでは /reload-plugins が必要な場合があります。`
          : `Installed ${pluginId} in Claude Code. Existing sessions may require /reload-plugins.`,
      );
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(message);
      return false;
    }
  }

  async function installPluginInCodex(skill: Skill): Promise<boolean> {
    if (!skillIndex) {
      skillIndex = await loadSkillIndex(context);
    }
    const source = skillIndex.sources.find(
      (candidate) => candidate.id === skill.source,
    );
    const ownerRepo = source ? getGitHubOwnerRepo(source) : undefined;
    if (!ownerRepo) {
      vscode.window.showErrorMessage(
        isJapanese()
          ? "Codex plugin marketplaceのGitHub sourceを解決できません。"
          : "The GitHub source for the Codex plugin marketplace could not be resolved.",
      );
      return false;
    }
    const codexExecutableProbe = await findCodexExecutableProbe();
    const codexExecutable = codexExecutableProbe.executablePath;
    logCodexFallback(codexExecutableProbe);
    const codexExtensionDetected =
      !!vscode.extensions.getExtension("openai.chatgpt");
    const availability = getCodexAvailability({
      extensionDetected: codexExtensionDetected,
      executablePath: codexExecutable,
      nativeExecutionEnabled: true,
    });
    if (availability === "unavailable") {
      const repairAction = isJapanese()
        ? "troubleshooting commandをコピー"
        : "Copy troubleshooting command";
      const selected = await vscode.window.showErrorMessage(
        isJapanese()
          ? `CodexのVS Code拡張またはCLIが見つかりません。${formatCodexExecutableReason(codexExecutableProbe, true)}`
          : `Neither the Codex VS Code extension nor CLI was found. ${formatCodexExecutableReason(codexExecutableProbe, false)}`,
        ...(process.platform === "win32" ? [repairAction] : []),
      );
      if (selected === repairAction) {
        await copyCodexRepairCommand();
      }
      return false;
    }
    const openAction = isJapanese()
      ? "Plugins Directoryを開く"
      : "Open Plugins Directory";
    let identity: CopilotMarketplacePluginIdentity | undefined;
    let identityError: string | undefined;
    try {
      identity = await resolveCopilotCliPluginIdentity(skill);
    } catch (error) {
      identityError = error instanceof Error ? error.message : String(error);
      logger.warn(
        `[Resource Ninja] Codex marketplace identity unavailable: ${identityError}`,
      );
    }
    if (!codexExecutable || !identity) {
      const choice = await vscode.window.showInformationMessage(
        isJapanese()
          ? `${skill.name} はChatGPT Plugins Directoryでインストールできます。${identityError ? ` 自動解決できない理由: ${identityError}` : ""}`
          : `${skill.name} can be installed from the ChatGPT Plugins Directory.${identityError ? ` Automatic resolution failed: ${identityError}` : ""}`,
        openAction,
      );
      if (choice === openAction) {
        await vscode.env.openExternal(
          vscode.Uri.parse("https://chatgpt.com/plugins"),
        );
      }
      return false;
    }
    const probe = await probePluginHostExecutable(
      "codex",
      codexExecutable,
      workspaceFolder?.uri.fsPath ?? os.homedir(),
    );
    const pluginId = `${identity.pluginName}@${identity.marketplaceName}`;
    const installAction = isJapanese()
      ? "Codexにインストール"
      : "Install in Codex";
    const choice = await vscode.window.showWarningMessage(
      isJapanese()
        ? `${pluginId} をCodexへインストールします。pluginはskills、hooks、MCP serversを含み得ます。hooksはCodex側のtrust確認に従います。\n\n${formatCodexExecutableReason(codexExecutableProbe, true)}\n実行: ${probe.executablePath}\nVersion: ${probe.version}`
        : `Install ${pluginId} in Codex. The plugin can include skills, hooks, and MCP servers. Plugin hooks remain subject to Codex trust review.\n\n${formatCodexExecutableReason(codexExecutableProbe, false)}\nExecutable: ${probe.executablePath}\nVersion: ${probe.version}`,
      { modal: true },
      installAction,
    );
    if (choice !== installAction) {
      return false;
    }
    const runner = createGatedPluginHostRunner({
      probe,
      hostId: "codex",
      action: "install",
      scope: "user",
      resourceIdentity: pluginId,
      sourceOrigin: ownerRepo,
      readonlyCommands: [
        ["plugin", "marketplace", "list", "--json"],
        ["plugin", "list", "--json"],
      ],
      mutationCommands: [
        ["plugin", "marketplace", "add", ownerRepo, "--json"],
        ["plugin", "add", pluginId, "--json"],
        ["plugin", "marketplace", "remove", identity.marketplaceName, "--json"],
      ],
    });
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: isJapanese()
          ? `${identity.pluginName} をCodexへインストール中...`
          : `Installing ${identity.pluginName} in Codex...`,
        cancellable: false,
      },
      () =>
        installCodexPlugin({
          runner,
          pluginName: identity.pluginName,
          marketplaceName: identity.marketplaceName,
          marketplaceSource: ownerRepo,
        }),
    );
    if (!result.ok) {
      vscode.window.showErrorMessage(
        isJapanese()
          ? `Codexへのインストールに失敗しました: ${result.reason}`
          : `Codex plugin installation failed: ${result.reason}`,
      );
      return false;
    }
    vscode.window.showInformationMessage(
      isJapanese()
        ? `${pluginId} をCodexへインストールしました。`
        : `Installed ${pluginId} in Codex.`,
    );
    return true;
  }

  async function managePluginInClaudeCode(
    skillOrItem?: Skill | SkillTreeItem,
  ): Promise<boolean> {
    const executable = await findExecutableOnPath("claude");
    if (!executable || !canExecuteWithoutShell(executable)) {
      vscode.window.showErrorMessage(
        isJapanese()
          ? "Claude Code standalone CLIが見つかりません。"
          : "The standalone Claude Code CLI was not found.",
      );
      return false;
    }
    const skill =
      skillOrItem instanceof SkillTreeItem
        ? skillOrItem.skill
        : skillOrItem ||
          (await pickInstalledRemotePlugin({
            hostId: "claude-code",
            executablePath: executable,
            manifestKind: "claude-plugin",
          }));
    if (!skill || skill.pluginManifestKind !== "claude-plugin") {
      return false;
    }
    try {
      const identity = await resolveCopilotCliPluginIdentity(skill);
      const executable = await findExecutableOnPath("claude");
      if (!executable) {
        vscode.window.showErrorMessage(
          isJapanese()
            ? "Claude Code standalone CLIが見つかりません。"
            : "The standalone Claude Code CLI was not found.",
        );
        return false;
      }
      const action = await vscode.window.showQuickPick(
        [
          { label: isJapanese() ? "更新" : "Update", value: "update" as const },
          {
            label: isJapanese() ? "有効化" : "Enable",
            value: "enable" as const,
          },
          {
            label: isJapanese() ? "無効化" : "Disable",
            value: "disable" as const,
          },
          {
            label: isJapanese() ? "アンインストール" : "Uninstall",
            value: "uninstall" as const,
          },
        ],
        {
          placeHolder: isJapanese()
            ? "Claude Code pluginの操作を選択"
            : "Choose a Claude Code plugin action",
        },
      );
      if (!action) {
        return false;
      }
      const scopes = [
        { label: "User", scope: "user" as PluginInstallScope },
        ...(vscode.workspace.isTrusted
          ? [
              { label: "Project", scope: "project" as PluginInstallScope },
              { label: "Local", scope: "local" as PluginInstallScope },
            ]
          : []),
      ];
      const selectedScope = await vscode.window.showQuickPick(scopes, {
        placeHolder: isJapanese()
          ? "対象scopeを選択"
          : "Choose the target scope",
      });
      if (!selectedScope) {
        return false;
      }
      const probe = await probePluginHostExecutable(
        "claude-code",
        executable,
        workspaceFolder?.uri.fsPath ?? os.homedir(),
      );
      const pluginId = `${identity.pluginName}@${identity.marketplaceName}`;
      const confirmAction = isJapanese() ? "実行" : "Run";
      const choice = await vscode.window.showWarningMessage(
        isJapanese()
          ? `${pluginId} に ${action.value} を実行します。Scope: ${selectedScope.scope}\n\n実行: ${probe.executablePath}\nVersion: ${probe.version}`
          : `Run ${action.value} for ${pluginId}. Scope: ${selectedScope.scope}\n\nExecutable: ${probe.executablePath}\nVersion: ${probe.version}`,
        { modal: true },
        confirmAction,
      );
      if (choice !== confirmAction) {
        return false;
      }
      const argv = [
        "plugin",
        action.value,
        pluginId,
        "--scope",
        selectedScope.scope,
      ];
      const runner = createGatedPluginHostRunner({
        probe,
        hostId: "claude-code",
        action: action.value,
        scope: selectedScope.scope,
        resourceIdentity: pluginId,
        sourceOrigin: identity.ownerRepo,
        readonlyCommands: [["plugin", "marketplace", "list", "--json"]],
        mutationCommands: [argv],
      });
      const result = await mutateClaudeCodePlugin({
        runner,
        action: action.value,
        pluginId,
        marketplaceName: identity.marketplaceName,
        marketplaceSource: identity.ownerRepo,
        scope: selectedScope.scope,
      });
      if (!result.ok) {
        vscode.window.showErrorMessage(result.reason);
        return false;
      }
      vscode.window.showInformationMessage(
        isJapanese()
          ? `${pluginId}: ${action.value} を完了しました。`
          : `${pluginId}: ${action.value} completed.`,
      );
      return true;
    } catch (error) {
      vscode.window.showErrorMessage(
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  async function managePluginInCodex(
    skillOrItem?: Skill | SkillTreeItem,
  ): Promise<boolean> {
    const executableProbe = await findCodexExecutableProbe();
    const executable = executableProbe.executablePath;
    if (!executable) {
      const repairAction = isJapanese()
        ? "troubleshooting commandをコピー"
        : "Copy troubleshooting command";
      const selected = await vscode.window.showErrorMessage(
        isJapanese()
          ? `Codex CLIが見つかりません。${formatCodexExecutableReason(executableProbe, true)}`
          : `Codex CLI was not found. ${formatCodexExecutableReason(executableProbe, false)}`,
        ...(process.platform === "win32" ? [repairAction] : []),
      );
      if (selected === repairAction) {
        await copyCodexRepairCommand();
      }
      return false;
    }
    logCodexFallback(executableProbe);
    const skill =
      skillOrItem instanceof SkillTreeItem
        ? skillOrItem.skill
        : skillOrItem ||
          (await pickInstalledRemotePlugin({
            hostId: "codex",
            executablePath: executable,
            manifestKind: "codex-plugin",
          }));
    if (!skill || skill.pluginManifestKind !== "codex-plugin") {
      return false;
    }
    try {
      const identity = await resolveCopilotCliPluginIdentity(skill);
      const probe = await probePluginHostExecutable(
        "codex",
        executable,
        workspaceFolder?.uri.fsPath ?? os.homedir(),
      );
      const pluginId = `${identity.pluginName}@${identity.marketplaceName}`;
      const confirmAction = isJapanese()
        ? "Codexから削除"
        : "Remove from Codex";
      const choice = await vscode.window.showWarningMessage(
        isJapanese()
          ? `${pluginId} をCodexから削除します。\n\n${formatCodexExecutableReason(executableProbe, true)}\n実行: ${probe.executablePath}\nVersion: ${probe.version}`
          : `Remove ${pluginId} from Codex.\n\n${formatCodexExecutableReason(executableProbe, false)}\nExecutable: ${probe.executablePath}\nVersion: ${probe.version}`,
        { modal: true },
        confirmAction,
      );
      if (choice !== confirmAction) {
        return false;
      }
      const argv = ["plugin", "remove", pluginId, "--json"];
      const runner = createGatedPluginHostRunner({
        probe,
        hostId: "codex",
        action: "uninstall",
        scope: "user",
        resourceIdentity: pluginId,
        sourceOrigin: identity.ownerRepo,
        readonlyCommands: [["plugin", "marketplace", "list", "--json"]],
        mutationCommands: [argv],
      });
      const result = await uninstallCodexPlugin({
        runner,
        pluginId,
        marketplaceName: identity.marketplaceName,
        marketplaceSource: identity.ownerRepo,
      });
      if (!result.ok) {
        vscode.window.showErrorMessage(result.reason);
        return false;
      }
      vscode.window.showInformationMessage(
        isJapanese()
          ? `${pluginId} をCodexから削除しました。`
          : `Removed ${pluginId} from Codex.`,
      );
      return true;
    } catch (error) {
      vscode.window.showErrorMessage(
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  async function copyCodexRepairCommand(): Promise<void> {
    if (process.platform !== "win32") {
      vscode.window.showInformationMessage(
        isJapanese()
          ? "このWinGet troubleshooting commandはWindows専用です。"
          : "This WinGet troubleshooting command is available only on Windows.",
      );
      return;
    }
    await vscode.env.clipboard.writeText(CODEX_REPAIR_COMMAND);
    vscode.window.showInformationMessage(
      isJapanese()
        ? "Codex CLIのtroubleshooting commandをコピーしました。WinGet alias/PATH修復を保証するものではありません。"
        : "Copied the Codex CLI troubleshooting command. It does not guarantee that WinGet will repair the alias or PATH.",
    );
  }

  async function getProjectedRealPath(targetPath: string): Promise<string> {
    const suffix: string[] = [];
    let ancestor = targetPath;
    while (true) {
      try {
        const ancestorRealPath = await realpath(ancestor);
        return path.join(ancestorRealPath, ...suffix);
      } catch {
        const parent = path.dirname(ancestor);
        if (parent === ancestor) {
          throw new Error(`No existing ancestor for ${targetPath}`);
        }
        suffix.unshift(path.basename(ancestor));
        ancestor = parent;
      }
    }
  }

  async function fingerprintDirectory(rootUri: vscode.Uri): Promise<string> {
    const hash = createHash("sha256");
    const visit = async (
      directory: vscode.Uri,
      relativeRoot: string,
    ): Promise<void> => {
      const entries = await vscode.workspace.fs.readDirectory(directory);
      entries.sort(([left], [right]) => left.localeCompare(right));
      for (const [name, type] of entries) {
        const relativePath = relativeRoot ? `${relativeRoot}/${name}` : name;
        if ((type & vscode.FileType.SymbolicLink) !== 0) {
          throw new Error(
            `Cursor plugin contains a symbolic link: ${relativePath}`,
          );
        }
        const uri = vscode.Uri.joinPath(directory, name);
        if ((type & vscode.FileType.Directory) !== 0) {
          hash.update(`D\0${relativePath}\0`, "utf8");
          await visit(uri, relativePath);
        } else if ((type & vscode.FileType.File) !== 0) {
          hash.update(`F\0${relativePath}\0`, "utf8");
          hash.update(await vscode.workspace.fs.readFile(uri));
        }
      }
    };
    await visit(rootUri, "");
    return hash.digest("hex");
  }

  async function installPluginInCursor(skill: Skill): Promise<boolean> {
    const targetPath = getCursorLocalPluginPath(os.homedir(), skill.name);
    if (
      !targetPath ||
      !isCursorEditor(vscode.env.appName, vscode.env.uriScheme)
    ) {
      vscode.window.showErrorMessage(
        isJapanese()
          ? "Cursor local plugin installはCursor上でのみ利用できます。"
          : "Cursor local plugin install is available only while running Cursor.",
      );
      return false;
    }
    const cursorRoot = path.dirname(targetPath);
    const projectedRoot = await getProjectedRealPath(cursorRoot);
    const projectedTarget = await getProjectedRealPath(targetPath);
    const homeRealPath = await realpath(os.homedir());
    if (
      !isDeletableWithin(homeRealPath, projectedRoot) ||
      !isDeletableWithin(projectedRoot, projectedTarget)
    ) {
      throw new Error("Cursor plugin target escapes the user home directory.");
    }
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(targetPath));
      vscode.window.showErrorMessage(
        isJapanese()
          ? `Cursor plugin targetは既に存在します。上書きしません: ${targetPath}`
          : `The Cursor plugin target already exists and will not be overwritten: ${targetPath}`,
      );
      return false;
    } catch {
      // Missing target is required for an owned install.
    }
    const installAction = isJapanese()
      ? "Cursor local pluginとしてコピー"
      : "Copy as Cursor local plugin";
    const choice = await vscode.window.showWarningMessage(
      isJapanese()
        ? `${skill.name} packageを ${targetPath} へコピーします。pluginはrules、skills、agents、hooks、MCP serversを含み得ます。完了後にCursorをreloadしてください。`
        : `Copy the ${skill.name} package to ${targetPath}. The plugin can contain rules, skills, agents, hooks, and MCP servers. Reload Cursor afterward.`,
      { modal: true },
      installAction,
    );
    if (choice !== installAction || !workspaceFolder) {
      return false;
    }
    const processExecutable = await realpath(process.execPath);
    const createSpec = () => ({
      hostId: "cursor" as const,
      action: "copy" as const,
      scope: "user" as const,
      executablePath: processExecutable,
      executableVersion: process.version,
      cwd: workspaceFolder.uri.fsPath,
      argv: ["copy-plugin", skill.source, skill.path, targetPath],
      environment: {},
      resourceIdentity: `${skill.source}:${skill.path}`,
      sourceOrigin: skill.source,
      resolutionMode: "local-copy" as const,
      targetPaths: [cursorRoot, targetPath],
    });
    const intent = pluginExecutionAuthority.approve(
      pluginExecutionAuthority.prepare(createSpec()),
    );
    let installResult: Awaited<ReturnType<typeof installSkill>> | undefined;
    await pluginMutationExecutor.execute(
      intent,
      async () => {
        const currentTarget = await getProjectedRealPath(targetPath);
        const currentRoot = await getProjectedRealPath(cursorRoot);
        const currentHome = await realpath(os.homedir());
        if (
          !isDeletableWithin(currentHome, currentRoot) ||
          !isDeletableWithin(currentRoot, currentTarget)
        ) {
          throw new Error("Cursor plugin target changed after approval.");
        }
        try {
          await vscode.workspace.fs.stat(vscode.Uri.file(targetPath));
          throw new Error("Cursor plugin target appeared after approval.");
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "Cursor plugin target appeared after approval."
          ) {
            throw error;
          }
        }
        return createSpec();
      },
      async () => {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(cursorRoot));
        installResult = await installSkill(
          skill,
          workspaceFolder.uri,
          context,
          {
            targetScope: "custom",
            customTargetUri: vscode.Uri.file(cursorRoot),
          },
        );
      },
    );
    if (!installResult || !installWasClean(installResult)) {
      if (isDeletableWithin(cursorRoot, targetPath)) {
        await vscode.workspace.fs.delete(vscode.Uri.file(targetPath), {
          recursive: true,
          useTrash: true,
        });
      }
      return false;
    }
    const fingerprint = await fingerprintDirectory(vscode.Uri.file(targetPath));
    const receipts = context.globalState.get<CursorPluginReceipt[]>(
      CURSOR_PLUGIN_RECEIPTS_KEY,
      [],
    );
    await context.globalState.update(CURSOR_PLUGIN_RECEIPTS_KEY, [
      ...receipts.filter((receipt) => receipt.targetPath !== targetPath),
      {
        rootPath: cursorRoot,
        targetPath,
        pluginName: skill.name,
        source: skill.source,
        remotePath: skill.path,
        fingerprint,
        installedAt: new Date().toISOString(),
      },
    ]);
    vscode.window.showInformationMessage(
      isJapanese()
        ? `${skill.name} をCursor local pluginとしてコピーしました。Cursorをreloadしてください。`
        : `Copied ${skill.name} as a Cursor local plugin. Reload Cursor to activate it.`,
    );
    return true;
  }

  async function uninstallPluginFromCursor(): Promise<boolean> {
    if (!isCursorEditor(vscode.env.appName, vscode.env.uriScheme)) {
      vscode.window.showErrorMessage(
        isJapanese()
          ? "Cursor local plugin uninstallはCursor上でのみ利用できます。"
          : "Cursor local plugin uninstall is available only while running Cursor.",
      );
      return false;
    }
    const receipts = context.globalState.get<CursorPluginReceipt[]>(
      CURSOR_PLUGIN_RECEIPTS_KEY,
      [],
    );
    if (receipts.length === 0) {
      vscode.window.showInformationMessage(
        isJapanese()
          ? "Agent Resources Ninjaが所有するCursor pluginはありません。"
          : "No Cursor plugins are owned by Agent Resources Ninja.",
      );
      return false;
    }
    const selected = await vscode.window.showQuickPick(
      receipts.map((receipt) => ({
        label: receipt.pluginName,
        description: receipt.source,
        detail: receipt.targetPath,
        receipt,
      })),
      {
        placeHolder: isJapanese()
          ? "削除するCursor local pluginを選択"
          : "Select a Cursor local plugin to remove",
      },
    );
    if (!selected) {
      return false;
    }
    const { receipt } = selected;
    const expectedTarget = getCursorLocalPluginPath(
      os.homedir(),
      receipt.pluginName,
    );
    const expectedRoot = expectedTarget
      ? path.dirname(expectedTarget)
      : undefined;
    if (
      !expectedTarget ||
      !expectedRoot ||
      receipt.rootPath !== expectedRoot ||
      receipt.targetPath !== expectedTarget ||
      !isDeletableWithin(expectedRoot, expectedTarget)
    ) {
      throw new Error(
        "Cursor plugin receipt points outside the local plugin root.",
      );
    }
    const cursorRoot = expectedRoot;
    const cursorRootRealPath = await realpath(cursorRoot);
    const homeRealPath = await realpath(os.homedir());
    const targetRealPath = await realpath(receipt.targetPath);
    if (
      !isDeletableWithin(homeRealPath, cursorRootRealPath) ||
      !isDeletableWithin(cursorRootRealPath, targetRealPath)
    ) {
      throw new Error(
        "Cursor plugin target escapes the fixed local plugin root.",
      );
    }
    const currentFingerprint = await fingerprintDirectory(
      vscode.Uri.file(receipt.targetPath),
    );
    if (currentFingerprint !== receipt.fingerprint) {
      vscode.window.showErrorMessage(
        isJapanese()
          ? "Cursor pluginはインストール後に変更されています。自動削除しません。"
          : "The Cursor plugin changed after installation and will not be deleted automatically.",
      );
      return false;
    }
    const removeAction = isJapanese() ? "削除" : "Remove";
    const choice = await vscode.window.showWarningMessage(
      isJapanese()
        ? `${receipt.pluginName} をCursor local pluginsから削除します。`
        : `Remove ${receipt.pluginName} from Cursor local plugins.`,
      { modal: true },
      removeAction,
    );
    if (choice !== removeAction) {
      return false;
    }
    const processExecutable = await realpath(process.execPath);
    const createSpec = () => ({
      hostId: "cursor" as const,
      action: "delete" as const,
      scope: "user" as const,
      executablePath: processExecutable,
      executableVersion: process.version,
      cwd: workspaceFolder?.uri.fsPath ?? os.homedir(),
      argv: ["delete-plugin", receipt.targetPath],
      environment: {},
      resourceIdentity: `${receipt.source}:${receipt.remotePath}`,
      sourceOrigin: receipt.source,
      resolutionMode: "local-copy" as const,
      targetPaths: [cursorRoot, receipt.targetPath],
    });
    const intent = pluginExecutionAuthority.approve(
      pluginExecutionAuthority.prepare(createSpec()),
    );
    await pluginMutationExecutor.execute(
      intent,
      async () => {
        const currentRootRealPath = await realpath(cursorRoot);
        const currentHomeRealPath = await realpath(os.homedir());
        const currentTargetRealPath = await realpath(receipt.targetPath);
        if (
          !isDeletableWithin(currentHomeRealPath, currentRootRealPath) ||
          !isDeletableWithin(currentRootRealPath, currentTargetRealPath)
        ) {
          throw new Error("Cursor plugin target changed after approval.");
        }
        const fingerprint = await fingerprintDirectory(
          vscode.Uri.file(receipt.targetPath),
        );
        if (fingerprint !== receipt.fingerprint) {
          throw new Error("Cursor plugin changed after approval.");
        }
        return createSpec();
      },
      async () => {
        await vscode.workspace.fs.delete(vscode.Uri.file(receipt.targetPath), {
          recursive: true,
          useTrash: true,
        });
      },
    );
    await context.globalState.update(
      CURSOR_PLUGIN_RECEIPTS_KEY,
      receipts.filter((item) => item.targetPath !== receipt.targetPath),
    );
    vscode.window.showInformationMessage(
      isJapanese()
        ? `${receipt.pluginName} をCursor local pluginsから削除しました。`
        : `Removed ${receipt.pluginName} from Cursor local plugins.`,
    );
    return true;
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

    const resourceKind = getResourceKind(skill);
    if (resourceKind === "plugin" && mode === "ask") {
      if (!skillIndex) {
        skillIndex = await loadSkillIndex(context);
      }
      const pluginSourceResolved = getIndexSources(skillIndex).some(
        (source) => source.id === skill.source && !!getGitHubOwnerRepo(source),
      );
      const pluginPackageResolved =
        !!skill.pluginRoot &&
        !!skill.pluginManifestPath &&
        (skill as Skill & { incomplete?: boolean }).incomplete !== true &&
        pluginSourceResolved;
      const pluginHostSetting = vscode.workspace
        .getConfiguration("resourceNinja")
        .inspect<DefaultPluginHost>("defaultPluginHost");
      const userDefault = pluginHostSetting?.globalValue ?? "auto";
      const workspaceSuggestion =
        pluginHostSetting?.workspaceFolderValue ??
        pluginHostSetting?.workspaceValue;
      const copilotCliExecutable = await findCopilotCliExecutable();
      const claudeExecutable = await findExecutableOnPath("claude");
      const claudeNativeExecutable =
        claudeExecutable && canExecuteWithoutShell(claudeExecutable)
          ? claudeExecutable
          : undefined;
      const claudeExtensionDetected = !!vscode.extensions.getExtension(
        "anthropic.claude-code",
      );
      const claudeDetected =
        claudeExtensionDetected || !!claudeNativeExecutable;
      const claudeCompatible =
        skill.pluginManifestKind === "claude-plugin" && pluginPackageResolved;
      const codexExecutableProbe = await findCodexExecutableProbe();
      const codexExecutable = codexExecutableProbe.executablePath;
      logCodexFallback(codexExecutableProbe);
      const codexExtensionDetected =
        !!vscode.extensions.getExtension("openai.chatgpt");
      const codexDetected = codexExtensionDetected || !!codexExecutable;
      const codexCompatible =
        skill.pluginManifestKind === "codex-plugin" && pluginPackageResolved;
      const cursorDetected = isCursorEditor(
        vscode.env.appName,
        vscode.env.uriScheme,
      );
      const cursorCompatible =
        (skill.pluginManifestKind === "agent-plugins" ||
          skill.pluginManifestKind === "cursor-plugin") &&
        pluginPackageResolved;
      const vscodeCompatible =
        skill.pluginManifestKind === "agent-plugins" && pluginPackageResolved;
      let stateIdentity: CopilotMarketplacePluginIdentity | undefined;
      if (
        pluginPackageResolved &&
        (copilotCliExecutable || claudeNativeExecutable || codexExecutable)
      ) {
        try {
          stateIdentity = await withPluginStateTimeout(
            resolveCopilotCliPluginIdentity(skill),
            12_000,
            undefined,
          );
        } catch (error) {
          logger.info(
            `[Resource Ninja] Plugin host state identity unavailable: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
      const hostStates = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: isJapanese()
            ? "Plugin hostの状態を確認中..."
            : "Checking plugin host state...",
          cancellable: false,
        },
        () =>
          probePluginHostStates({
            skill,
            identity: stateIdentity,
            copilotCliExecutable,
            claudeExecutable: claudeNativeExecutable,
            codexExecutable,
            cursorDetected,
          }),
      );
      const unavailableState = (hostId: PluginHostId): PluginHostState => ({
        hostId,
        status: "unknown",
        reason: stateIdentity
          ? "The host state could not be read."
          : "The marketplace identity could not be resolved.",
      });
      const choices = resolvePluginHostChoices({
        candidates: [
          ...(vscodeCompatible
            ? [
                {
                  hostId: "vscode-copilot" as const,
                  supportLevel: "native" as const,
                  compatible: true,
                  detected: !!vscode.extensions.getExtension(
                    "github.copilot-chat",
                  ),
                  available: supportsPluginLocations(vscode.version),
                  state: hostStates.get("vscode-copilot"),
                },
              ]
            : []),
          ...(stateIdentity && copilotCliExecutable
            ? [
                {
                  hostId: "copilot-cli" as const,
                  supportLevel: "native" as const,
                  compatible: true,
                  detected: true,
                  available: true,
                  state:
                    hostStates.get("copilot-cli") ??
                    unavailableState("copilot-cli"),
                },
              ]
            : []),
          ...(claudeCompatible &&
          claudeDetected &&
          (stateIdentity || !claudeNativeExecutable)
            ? [
                {
                  hostId: "claude-code" as const,
                  supportLevel: claudeNativeExecutable
                    ? ("native" as const)
                    : ("handoff" as const),
                  compatible: true,
                  detected: true,
                  available: true,
                  state: claudeNativeExecutable
                    ? (hostStates.get("claude-code") ??
                      unavailableState("claude-code"))
                    : unavailableState("claude-code"),
                  reason: isJapanese()
                    ? claudeNativeExecutable
                      ? "standalone Claude Code CLIでNative install"
                      : "Claude Codeの /plugins UIへHandoff"
                    : claudeNativeExecutable
                      ? "Native install through standalone Claude Code CLI"
                      : "Handoff to Claude Code's /plugins UI",
                },
              ]
            : []),
          ...(codexCompatible &&
          codexDetected &&
          (stateIdentity || !codexExecutable)
            ? [
                {
                  hostId: "codex" as const,
                  supportLevel: codexExecutable
                    ? ("native" as const)
                    : ("handoff" as const),
                  compatible: true,
                  detected: true,
                  available: true,
                  state: codexExecutable
                    ? (hostStates.get("codex") ?? unavailableState("codex"))
                    : unavailableState("codex"),
                  reason: isJapanese()
                    ? codexExecutable
                      ? formatCodexExecutableReason(codexExecutableProbe, true)
                      : "ChatGPT DesktopのPlugins DirectoryへHandoff"
                    : codexExecutable
                      ? formatCodexExecutableReason(codexExecutableProbe, false)
                      : "Handoff to the ChatGPT Desktop Plugins Directory",
                },
              ]
            : []),
          ...(cursorCompatible && cursorDetected
            ? [
                {
                  hostId: "cursor" as const,
                  supportLevel: "native" as const,
                  compatible: true,
                  detected: true,
                  available: true,
                  state: hostStates.get("cursor") ?? unavailableState("cursor"),
                  reason: isJapanese()
                    ? "Cursor local plugin folderへNative copy"
                    : "Native copy to Cursor's local plugin folder",
                },
              ]
            : []),
        ],
        userDefault,
        workspaceSuggestion,
      });
      if (choices.length === 0) {
        vscode.window.showInformationMessage(
          isJapanese()
            ? "このpackageをNative管理できるhostが見つかりません。managed copyのインストール先を選択します。"
            : "No native host can manage this package. Choose a managed-copy install target.",
        );
      }
      const hostItems = choices.map((choice) => {
        const isInstalled = choice.state?.status === "installed";
        const badges = [
          choice.recommended
            ? isJapanese()
              ? "おすすめ"
              : "Recommended"
            : undefined,
          choice.detected
            ? isJapanese()
              ? "検出済み"
              : "Detected"
            : undefined,
          choice.suggestedByWorkspace
            ? isJapanese()
              ? "Workspace の提案"
              : "Workspace suggestion"
            : undefined,
        ].filter((badge): badge is string => !!badge);
        const badgePrefix = badges.length > 0 ? `${badges.join(" · ")} — ` : "";
        const stateLabel = formatPluginHostState(choice.state, isJapanese());
        const detail = choice.reason
          ? `${stateLabel} · ${choice.reason}`
          : stateLabel;
        if (choice.hostId === "claude-code") {
          return {
            label: `$(sparkle) ${
              isInstalled
                ? isJapanese()
                  ? "Claude Codeで管理"
                  : "Manage in Claude Code"
                : isJapanese()
                  ? "Claude Codeでインストール"
                  : "Install with Claude Code"
            }`,
            description: `${badgePrefix}${detail}`,
            value: isInstalled
              ? ("claudeCodeManage" as const)
              : ("claudeCode" as const),
          };
        }
        if (choice.hostId === "codex") {
          return {
            label: `$(hubot) ${
              isInstalled
                ? isJapanese()
                  ? "Codexで管理"
                  : "Manage in Codex"
                : isJapanese()
                  ? "Codexでインストール"
                  : "Install with Codex"
            }`,
            description: `${badgePrefix}${detail}`,
            value: isInstalled ? ("codexManage" as const) : ("codex" as const),
          };
        }
        if (choice.hostId === "cursor") {
          return {
            label: `$(cursor) ${
              isInstalled
                ? isJapanese()
                  ? "Cursor local pluginを削除"
                  : "Remove Cursor local plugin"
                : isJapanese()
                  ? "Cursorでインストール"
                  : "Install with Cursor"
            }`,
            description: `${badgePrefix}${detail}`,
            value: isInstalled
              ? ("cursorUninstall" as const)
              : ("cursor" as const),
          };
        }
        if (choice.hostId === "copilot-cli") {
          return {
            label: `$(terminal) ${
              isInstalled
                ? isJapanese()
                  ? "Copilot CLIからアンインストール"
                  : "Uninstall from Copilot CLI"
                : isJapanese()
                  ? "Copilot CLI にインストール"
                  : "Install in Copilot CLI"
            }`,
            description: `${badgePrefix}${stateLabel} · ${
              isJapanese()
                ? "marketplace add + plugin@marketplace を Copilot CLI に委譲"
                : "Delegate marketplace add + plugin@marketplace to Copilot CLI"
            }`,
            value: isInstalled
              ? ("copilotCliUninstall" as const)
              : ("copilotCli" as const),
          };
        }
        return {
          label: `$(code) ${
            isInstalled
              ? isJapanese()
                ? "VS Code / GitHub Copilot Chatへ再インストール"
                : "Reinstall for VS Code / GitHub Copilot Chat"
              : isJapanese()
                ? "VS Code / GitHub Copilot Chat にインストール"
                : "Install for VS Code / GitHub Copilot Chat"
          }`,
          description: `${badgePrefix}${stateLabel} · ${
            isJapanese()
              ? "Global Home にコピーし、chat.pluginLocations への登録を確認"
              : "Copy to Global Home and offer chat.pluginLocations registration"
          }`,
          value: "vscode" as const,
        };
      });
      if (hostItems.length > 0) {
        const destination = await vscode.window.showQuickPick(hostItems, {
          placeHolder: isJapanese()
            ? "プラグインの利用先を選択"
            : "Choose where to install the plugin",
        });
        if (!destination) {
          return false;
        }
        if (destination.value === "copilotCli") {
          return installPluginInCopilotCli(skill);
        }
        if (destination.value === "copilotCliUninstall") {
          return uninstallPluginFromCopilotCli(skill);
        }
        if (destination.value === "claudeCode") {
          return installPluginInClaudeCode(skill);
        }
        if (destination.value === "claudeCodeManage") {
          return managePluginInClaudeCode(skill);
        }
        if (destination.value === "codex") {
          return installPluginInCodex(skill);
        }
        if (destination.value === "codexManage") {
          return managePluginInCodex(skill);
        }
        if (destination.value === "cursor") {
          return installPluginInCursor(skill);
        }
        if (destination.value === "cursorUninstall") {
          return uninstallPluginFromCursor();
        }
      }
    }

    const installTarget =
      mode === "default"
        ? await resolveDefaultInstallTarget(skill)
        : await pickInstallTarget(skill);
    if (!installTarget) {
      return false;
    }

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

      if (installResult && !installWasClean(installResult)) {
        workspaceProvider.refresh();
        browseProvider.refresh();
        return false;
      }

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
      // An install that could not download every file leaves a partial folder,
      // and the warning the install already showed is the user's notice of it.
      if (
        resourceKind === "plugin" &&
        installResult &&
        installWasClean(installResult)
      ) {
        await offerPluginLocationRegistration([installResult.destinationUri]);
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
        // reveal の失敗はインストール失敗として扱わず、警告ログのみ
        try {
          await installedTreeView.reveal(installedItem, {
            select: true,
            focus: true,
          });
        } catch (revealError) {
          logger.warn(
            `Failed to reveal installed item in tree view: ${
              revealError instanceof Error
                ? revealError.message
                : String(revealError)
            }`,
          );
        }
      }
      return true;
    } catch (error) {
      if (isSkillNotFoundHandledError(error)) {
        return false;
      }
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (
        shouldOfferGitHubAuth(error) ||
        errorMessage.includes("rate limit") ||
        errorMessage.includes("403") ||
        errorMessage.includes("authentication")
      ) {
        await showAuthHelp(error);
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

  const installPluginInCopilotCliCmd = vscode.commands.registerCommand(
    "resourceNinja.installPluginInCopilotCli",
    async (skillOrItem?: Skill | SkillTreeItem) => {
      const skill =
        skillOrItem instanceof SkillTreeItem
          ? skillOrItem.skill
          : skillOrItem || (await pickRemotePlugin());
      if (!skill || getResourceKind(skill) !== "plugin") {
        return false;
      }
      return installPluginInCopilotCli(skill);
    },
  );

  const uninstallPluginFromCopilotCliCmd = vscode.commands.registerCommand(
    "resourceNinja.uninstallPluginFromCopilotCli",
    uninstallPluginFromCopilotCli,
  );

  const managePluginInClaudeCodeCmd = vscode.commands.registerCommand(
    "resourceNinja.managePluginInClaudeCode",
    managePluginInClaudeCode,
  );

  const managePluginInCodexCmd = vscode.commands.registerCommand(
    "resourceNinja.managePluginInCodex",
    managePluginInCodex,
  );

  const copyCodexRepairCommandCmd = vscode.commands.registerCommand(
    "resourceNinja.copyCodexRepairCommand",
    copyCodexRepairCommand,
  );

  const uninstallPluginFromCursorCmd = vscode.commands.registerCommand(
    "resourceNinja.uninstallPluginFromCursor",
    uninstallPluginFromCursor,
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
        const removeAction = isJapanese() ? "ごみ箱へ移動" : "Move to Trash";
        const confirmed = await vscode.window.showWarningMessage(
          isJapanese()
            ? `「${skillName}」をごみ箱へ移動します。必要な場合は復元できます。`
            : `Move "${skillName}" to the trash? You can restore it if needed.`,
          { modal: true },
          removeAction,
        );
        if (confirmed !== removeAction) {
          return;
        }
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
    async (options: ReinstallAllCommandOptions = {}) => {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.window.showErrorMessage(messages.noWorkspace());
        return;
      }

      const installedMeta = await getInstalledSkillsWithMeta(wsFolder.uri);
      if (installedMeta.length === 0) {
        vscode.window.showInformationMessage(messages.noInstalledSkills());
        return false;
      }

      if (!options.skipConfirmation) {
        const confirm = await vscode.window.showWarningMessage(
          isJapanese()
            ? `${installedMeta.length} 個のスキルを再インストールしますか？`
            : `Reinstall ${installedMeta.length} skills?`,
          { modal: true },
          isJapanese() ? "再インストール" : "Reinstall",
        );

        if (!confirm) {
          return false;
        }
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
      let completed = 0;
      let cancelled = false;
      const failedSkills: string[] = [];

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: isJapanese()
            ? "スキルを再インストール中..."
            : "Reinstalling skills...",
          cancellable: true,
        },
        async (progress, token) => {
          for (const meta of installedMeta) {
            if (token.isCancellationRequested) {
              cancelled = true;
              break;
            }
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
                const installResult = await installSkill(
                  skill,
                  wsFolder.uri,
                  context,
                  {
                    suppressRecoveryPrompt: true,
                  },
                );
                if (!installWasClean(installResult)) {
                  failedSkills.push(meta.name);
                  completed++;
                  continue;
                }
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
      if (failedSkills.length > 0 || cancelled) {
        const total = cancelled ? completed : installedMeta.length;
        vscode.window.showWarningMessage(
          `${getBatchFailureMessage(
            isJapanese() ? "スキル再インストール" : "Skill reinstall",
            success,
            total,
            failedSkills,
          )}${cancelled ? getBatchCancellationSuffix(completed, installedMeta.length) : ""}${getReinstallTrashRecoverySuffix(failedSkills.length)}`,
        );
        return false;
      } else if (!options.suppressSuccessMessage) {
        vscode.window.showInformationMessage(
          isJapanese()
            ? `${success} 個のスキルを再インストールしました`
            : `Reinstalled ${success} skills`,
        );
      }
      return true;
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
      let resources = getIndexResources(index);
      let fullSkill = resources.find(
        (s: Skill) =>
          getResourceKind(s) === resourceKind &&
          s.source === source &&
          s.path === remotePath,
      );
      if (!fullSkill && source === "unknown") {
        fullSkill = resources.find(
          (s: Skill) =>
            getResourceKind(s) === resourceKind && s.name === resourceName,
        );
      }
      if (!fullSkill) {
        fullSkill = resources.find(
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
          resources = getIndexResources(index);

          fullSkill = resources.find(
            (s: Skill) =>
              getResourceKind(s) === resourceKind &&
              s.source === source &&
              s.path === remotePath,
          );
          if (!fullSkill && source === "unknown") {
            fullSkill = resources.find(
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

      const installOptions = { suppressRecoveryPrompt };

      try {
        // The uninstall below removes the plugin folder and its registration. The
        // destination is taken from the install itself, because a setting that
        // changes while the progress notification is up would make a precomputed
        // one name a folder that was never created.
        let installResult: Awaited<ReturnType<typeof installSkill>> | undefined;
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
            installResult = await installSkill(
              fullSkill,
              wsFolder.uri,
              context,
              installOptions,
            );

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

        // The uninstall above dropped the registration for the folder it removed,
        // so the destination the install reported goes back through the same path
        // a normal install uses and keeps honouring `registerPluginLocation` and
        // the version guard. A failed install leaves `installResult` unset, and an
        // install that could not download every file must not be registered
        // either, so nothing is put back for a folder with missing content.
        if (
          resourceKind === "plugin" &&
          installResult &&
          installWasClean(installResult)
        ) {
          await offerPluginLocationRegistration([installResult.destinationUri]);
        }

        markRecentlyInstalled(fullSkill);

        if (!installWasClean(installResult)) {
          // The install already warned about the files it could not download;
          // reporting failure here is what the group reinstall aggregates.
          workspaceProvider.refresh();
          browseProvider.refresh();
          return false;
        }

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
              ? `再インストール失敗: ${String(error)}。元のファイルはごみ箱から復元できます。`
              : `Reinstall failed: ${String(error)}. You can restore the original files from the trash.`,
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
      let completed = 0;
      let cancelled = false;
      const failedResources: string[] = [];

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: isJapanese()
            ? `${kindLabel} グループを再インストール中...`
            : `Reinstalling ${kindLabel} group...`,
          cancellable: true,
        },
        async (progress, token) => {
          for (const child of remoteInstalledItems) {
            if (token.isCancellationRequested) {
              cancelled = true;
              break;
            }
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
      if (failedResources.length > 0 || cancelled) {
        const total = cancelled ? completed : remoteInstalledItems.length;
        vscode.window.showWarningMessage(
          `${getBatchFailureMessage(
            kindLabel,
            success,
            total,
            failedResources,
          )}${cancelled ? getBatchCancellationSuffix(completed, remoteInstalledItems.length) : ""}${getReinstallTrashRecoverySuffix(failedResources.length)}`,
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
          ? `全てのスキルをごみ箱へ移動します。必要な場合は復元できます。`
          : `Move ALL skills to the trash? They can be restored if needed.`,
        { modal: true },
        isJapanese() ? "全て削除" : "Delete All",
      );

      if (!confirm2) {
        return;
      }

      let success = 0;
      let completed = 0;
      let cancelled = false;
      const failedSkills: string[] = [];
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: isJapanese()
            ? "全スキルを削除中..."
            : "Deleting all skills...",
          cancellable: true,
        },
        async (progress, token) => {
          for (const skillName of installed) {
            if (token.isCancellationRequested) {
              cancelled = true;
              break;
            }
            progress.report({
              message: `${skillName} (${completed + 1}/${installed.length})`,
              increment: 100 / installed.length,
            });
            try {
              await uninstallSkill(skillName, wsFolder.uri);
              success++;
            } catch (error) {
              logger.error(`Failed to uninstall ${skillName}:`, error);
              failedSkills.push(skillName);
            }
            completed++;
          }
        },
      );

      const config = vscode.workspace.getConfiguration("resourceNinja");
      if (success > 0 && config.get<boolean>("autoUpdateInstruction")) {
        await updateInstructionFile(wsFolder.uri, context);
      }

      workspaceProvider.refresh();
      browseProvider.refresh();
      if (failedSkills.length > 0 || cancelled) {
        const total = cancelled ? completed : installed.length;
        vscode.window.showWarningMessage(
          `${getBatchFailureMessage(
            isJapanese() ? "スキル一括削除" : "Skill uninstall",
            success,
            total,
            failedSkills,
          )}${cancelled ? getBatchCancellationSuffix(completed, installed.length) : ""}`,
        );
      } else {
        vscode.window.showInformationMessage(
          isJapanese()
            ? `${success} 個のスキルを削除しました`
            : `Deleted ${success} skills`,
        );
      }
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
      const resources = getIndexResources(index);

      // インストール順序を決定（installOrderがあればそれを使用、なければskills配列）
      const installOrder = bundle.installOrder || bundle.skills;
      const bundleResources = installOrder
        .map((skillName) => {
          const skill =
            resources.find(
              (s: Skill) => s.name === skillName && s.source === bundle.source,
            ) ||
            resources.find(
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
      let cancelled = false;
      let installedSkills = 0;
      const failedResources: string[] = [];
      const mcpConfigSummaries: string[] = [];
      const installedPluginUris: vscode.Uri[] = [];

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
          cancellable: true,
        },
        async (progress, token) => {
          for (const selectedItem of selectedItems) {
            if (token.isCancellationRequested) {
              cancelled = true;
              break;
            }
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
              if (getResourceKind(skill) === "plugin") {
                // The destination comes from the install itself: the
                // configuration is read again on every iteration, so a setting
                // changed during the batch would otherwise register a folder that
                // was never created. An install that could not download every
                // file is counted with the failures instead, which is what the
                // batch summary below reports, because the per-install warning is
                // suppressed here.
                if (installWasClean(installResult)) {
                  installedPluginUris.push(installResult.destinationUri);
                } else {
                  failed++;
                  failedResources.push(skill.name);
                }
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
                completed
              } 個インストール完了（${failed} 個失敗: ${failedSummary}${
                failedResources.length > 3 ? "..." : ""
              }）${cancelled ? getBatchCancellationSuffix(completed, selectedItems.length) : ""}。上流の plugin/resource path が変わっている可能性があります。`
            : `${bundle.name}: ${completed - failed}/${
                completed
              } installed (${failed} failed: ${failedSummary}${
                failedResources.length > 3 ? "..." : ""
              })${cancelled ? getBatchCancellationSuffix(completed, selectedItems.length) : ""}. Upstream plugin/resource paths may have changed.`,
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
      } else if (cancelled) {
        vscode.window.showWarningMessage(
          `${bundle.name}: ${completed}/${completed} ${
            isJapanese() ? "件インストール完了" : "installed"
          }${getBatchCancellationSuffix(completed, selectedItems.length)}`,
        );
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

      // One prompt for the whole batch instead of one per installed plugin.
      await offerPluginLocationRegistration(installedPluginUris);

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
          ? `${selected.length}個のスキルをごみ箱へ移動します。必要な場合は復元できます。`
          : `Move ${selected.length} skills to the trash? They can be restored if needed.`,
        { modal: true },
        isJapanese() ? "ごみ箱へ移動" : "Move to Trash",
      );

      if (!confirm) {
        return;
      }

      let success = 0;
      let completed = 0;
      let cancelled = false;
      const failedSkills: string[] = [];
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: isJapanese() ? "スキルを削除中..." : "Deleting skills...",
          cancellable: true,
        },
        async (progress, token) => {
          for (const item of selected) {
            if (token.isCancellationRequested) {
              cancelled = true;
              break;
            }
            progress.report({
              message: `${item.label} (${completed + 1}/${selected.length})`,
              increment: 100 / selected.length,
            });
            try {
              await uninstallSkill(item.label, wsFolder.uri);
              success++;
            } catch (error) {
              logger.error(`Failed to uninstall ${item.label}:`, error);
              failedSkills.push(item.label);
            }
            completed++;
          }
        },
      );

      const config = vscode.workspace.getConfiguration("resourceNinja");
      if (success > 0 && config.get<boolean>("autoUpdateInstruction")) {
        await updateInstructionFile(wsFolder.uri, context);
      }

      workspaceProvider.refresh();
      browseProvider.refresh();
      if (failedSkills.length > 0 || cancelled) {
        const total = cancelled ? completed : selected.length;
        vscode.window.showWarningMessage(
          `${getBatchFailureMessage(
            isJapanese() ? "スキル選択削除" : "Selected skill uninstall",
            success,
            total,
            failedSkills,
          )}${cancelled ? getBatchCancellationSuffix(completed, selected.length) : ""}${getReinstallTrashRecoverySuffix(failedSkills.length)}`,
        );
      } else {
        vscode.window.showInformationMessage(
          isJapanese()
            ? `${success} 個のスキルを削除しました`
            : `Deleted ${success} skills`,
        );
      }
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
          label: meta.incomplete ? `$(warning) ${meta.name}` : meta.name,
          description: meta.incomplete
            ? `${meta.source} · ${isJapanese() ? "不完全" : "Incomplete"}`
            : meta.source,
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
      let completed = 0;
      let cancelled = false;
      const failedSkills: string[] = [];

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: isJapanese()
            ? "スキルを再インストール中..."
            : "Reinstalling skills...",
          cancellable: true,
        },
        async (progress, token) => {
          for (const item of selected) {
            if (token.isCancellationRequested) {
              cancelled = true;
              break;
            }
            progress.report({
              message: `${item.label} (${completed + 1}/${selected.length})`,
              increment: 100 / selected.length,
            });

            const resources = getIndexResources(index);
            let skill = resources.find(
              (s: Skill) =>
                s.name === item.meta.name && s.source === item.meta.source,
            );
            // source が "unknown" の場合は name だけで検索
            if (!skill && item.meta.source === "unknown") {
              skill = resources.find((s: Skill) => s.name === item.meta.name);
            }

            if (skill) {
              try {
                await uninstallSkill(item.meta.name, wsFolder.uri);
                const installResult = await installSkill(
                  skill,
                  wsFolder.uri,
                  context,
                  {
                    suppressRecoveryPrompt: true,
                  },
                );
                if (!installWasClean(installResult)) {
                  failedSkills.push(item.meta.name);
                  completed++;
                  continue;
                }
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
      if (failedSkills.length > 0 || cancelled) {
        const total = cancelled ? completed : selected.length;
        vscode.window.showWarningMessage(
          `${getBatchFailureMessage(
            isJapanese() ? "スキル再インストール" : "Skill reinstall",
            success,
            total,
            failedSkills,
          )}${cancelled ? getBatchCancellationSuffix(completed, selected.length) : ""}`,
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

      const oldCount = getIndexResources(skillIndex).length;
      const totalSources = skillIndex.sources.length;

      try {
        const updateResult = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: messages.updatingIndex(),
            cancellable: false,
          },
          async (progress) =>
            updateIndexFromSourcesWithResult(context, skillIndex!, progress, {
              forceScan: true,
            }),
        );
        skillIndex = updateResult.index;
        const newCount = getIndexResources(skillIndex).length;
        const diff = newCount - oldCount;
        const diffText = diff > 0 ? `+${diff}` : diff === 0 ? "±0" : `${diff}`;
        for (const source of updateResult.succeeded) {
          logger.info(
            `[Source Index] [OK] ${getSourceUpdateDisplayName(source)}`,
          );
        }
        for (const failure of updateResult.failures) {
          logger.warn(
            `[Source Index] [FAILED] ${getSourceUpdateDisplayName(failure.entry)}: ${formatSourceUpdateFailureReason(failure.error)}`,
          );
        }
        for (const source of updateResult.skipped) {
          logger.info(
            `[Source Index] [SKIPPED] ${getSourceUpdateDisplayName(source)}`,
          );
        }

        if (updateResult.failures.length === 0) {
          await vscode.window.showInformationMessage(
            messages.indexUpdated(oldCount, newCount, diffText),
          );
        } else {
          const firstFailure = updateResult.failures[0];
          const detailAction = messages.actionShowDetails();
          const authAction = messages.actionConfigureGitHubAuth();
          const actions = shouldOfferGitHubAuth(firstFailure.error)
            ? [detailAction, authAction]
            : [detailAction];
          const action = await vscode.window.showWarningMessage(
            messages.staleSourceIndexPartialFailed(
              updateResult.succeeded.length,
              updateResult.failures.length,
              totalSources,
              updateResult.failures
                .slice(0, 3)
                .map((failure) => getSourceUpdateDisplayName(failure.entry))
                .join(", "),
              formatSourceUpdateFailureReason(firstFailure.error),
              updateResult.skipped.length,
            ),
            ...actions,
          );
          if (action === detailAction) {
            logger.show(true);
          } else if (action === authAction) {
            await showAuthHelp(firstFailure.error);
          }
        }
        browseProvider.refresh();
        return updateResult;
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (
          shouldOfferGitHubAuth(error) ||
          errorMessage.includes("rate limit") ||
          errorMessage.includes("authentication")
        ) {
          await showAuthHelp(error);
        } else {
          vscode.window.showErrorMessage(messages.updateFailed(errorMessage));
        }
        return undefined;
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

      const oldCount = getIndexResources(skillIndex).filter(
        (s) => s.source === sourceId,
      ).length;

      const runSourceIndexUpdate = async (
        allowEmptyResult: boolean,
      ): Promise<void> => {
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
              { forceScan: true, allowEmptyResult },
            );
          },
        );
        const newCount = getIndexResources(skillIndex).filter(
          (s) => s.source === sourceId,
        ).length;
        const diff = newCount - oldCount;
        const diffText = diff > 0 ? `+${diff}` : diff === 0 ? "±0" : `${diff}`;
        vscode.window.showInformationMessage(
          messages.sourceIndexUpdated(
            item.source?.name || sourceId,
            oldCount,
            newCount,
            diffText,
          ),
        );
        browseProvider.refresh();
      };

      try {
        await runSourceIndexUpdate(false);
      } catch (error: unknown) {
        if (isEmptySourceScanError(error)) {
          const applyAction = isJapanese()
            ? "空の結果を反映"
            : "Apply Empty Result";
          const choice = await vscode.window.showWarningMessage(
            isJapanese()
              ? `${item.source?.name || sourceId} のスキャンでリソースが 0 件でした。既存のインデックス（${oldCount} 件）を保持しています。`
              : `Scanning ${item.source?.name || sourceId} returned no resources. The existing index (${oldCount}) was kept.`,
            applyAction,
          );
          if (choice === applyAction) {
            try {
              await runSourceIndexUpdate(true);
            } catch (retryError: unknown) {
              vscode.window.showErrorMessage(
                messages.updateFailed(
                  retryError instanceof Error
                    ? retryError.message
                    : String(retryError),
                ),
              );
            }
          }
          return;
        }

        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (
          shouldOfferGitHubAuth(error) ||
          errorMessage.includes("rate limit") ||
          errorMessage.includes("authentication")
        ) {
          await showAuthHelp(error);
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

      const runAddSource = async (
        allowRepositoryChange: boolean,
      ): Promise<void> => {
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: messages.scanningRepo(),
            cancellable: false,
          },
          async () => {
            return await addSource(context, skillIndex!, repoUrl, {
              allowRepositoryChange,
            });
          },
        );

        skillIndex = result.index;
        vscode.window.showInformationMessage(
          messages.sourceAdded(result.addedSkills),
        );
        // 更新されたインデックスを直接設定
        browseProvider.setIndex(skillIndex);
      };

      try {
        await runAddSource(false);
      } catch (error: unknown) {
        if (isSourceRepositoryChangedError(error)) {
          const approveAction = isJapanese()
            ? "別リポジトリへの差し替えを承認"
            : "Approve Repository Change";
          const choice = await vscode.window.showWarningMessage(
            error.message,
            { modal: true },
            approveAction,
          );
          if (choice === approveAction) {
            try {
              await runAddSource(true);
            } catch (retryError: unknown) {
              vscode.window.showErrorMessage(
                messages.addSourceFailed(
                  retryError instanceof Error
                    ? retryError.message
                    : String(retryError),
                ),
              );
            }
          }
          return;
        }

        const errorMessage =
          error instanceof Error ? error.message : String(error);
        if (
          shouldOfferGitHubAuth(error) ||
          errorMessage.includes("rate limit") ||
          errorMessage.includes("authentication")
        ) {
          await showAuthHelp(error);
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
      const token = await getGitHubToken();

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
            shouldOfferGitHubAuth(error) ||
            errorMessage.includes("rate limit") ||
            errorMessage.includes("authentication")
          ) {
            await showAuthHelp(error);
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

      const favoriteSkills = getIndexResources(skillIndex).filter((s) =>
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
      const indexResources = getIndexResources(skillIndex);
      for (const skill of indexResources) {
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
            description: `${indexResources.length}`,
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
        ? indexResources.filter((skill) =>
            skill.categories?.includes(selectedCategory.category),
          )
        : indexResources;
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

      const removeAction = isJapanese() ? "削除する" : "Remove Block";
      const confirmed = await vscode.window.showWarningMessage(
        isJapanese()
          ? `管理マーカーブロックだけを削除します。その他の内容は保持します。\n${instructionUri.fsPath}`
          : `Remove only the managed marker block and preserve all other content?\n${instructionUri.fsPath}`,
        { modal: true },
        removeAction,
      );
      if (confirmed !== removeAction) {
        return;
      }

      const removed = await removeSkillSectionFromFile(instructionUri);
      await vscode.window.showInformationMessage(
        removed
          ? isJapanese()
            ? `管理マーカーブロックを削除しました: ${instructionUri.fsPath}`
            : `Removed managed marker block from ${instructionUri.fsPath}`
          : isJapanese()
            ? `管理マーカーブロックは見つかりませんでした: ${instructionUri.fsPath}`
            : `No managed marker block was found in ${instructionUri.fsPath}`,
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

      // トークンもリセット（旧設定 + SecretStorage）
      if (selected.value === "all") {
        await deleteConfiguredGitHubTokens();
        await deleteStoredGitHubToken();
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

  const clearGitHubTokenCmd = vscode.commands.registerCommand(
    "resourceNinja.clearGitHubToken",
    clearStoredGitHubTokenWithFeedback,
  );

  const showGitHubAuthStatusCmd = vscode.commands.registerCommand(
    "resourceNinja.showGitHubAuthStatus",
    async () => {
      const auth = await checkGitHubAuth();
      if (auth.authenticated) {
        await vscode.window.showInformationMessage(
          messages.githubAuthStatusAuthenticated(
            getGitHubAuthSourceLabel(auth.method),
          ),
        );
        return;
      }
      await showAuthHelp(auth.error);
    },
  );

  // Command: Copy URL (for Browse view)
  const copyUrlCmd = vscode.commands.registerCommand(
    "resourceNinja.copyUrl",
    async (item: SkillTreeItem) => {
      const url = item.skill
        ? await getSkillGitHubUrlAsync(
            item.skill,
            (await loadSkillIndex(context)).sources,
          )
        : item.source?.url;
      if (url) {
        await vscode.env.clipboard.writeText(url);
        await vscode.window.showInformationMessage(
          messages.copiedToClipboardWithValue(url),
        );
      } else {
        await vscode.window.showWarningMessage(
          messages.resourceUrlUnavailable(),
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
        try {
          const stat = await vscode.workspace.fs.stat(item.resourceUri);
          const cwd =
            stat.type === vscode.FileType.Directory
              ? item.resourceUri
              : vscode.Uri.file(path.dirname(item.resourceUri.fsPath));
          const terminal = vscode.window.createTerminal({
            name: `Resource: ${item.label}`,
            cwd,
          });
          terminal.show();
        } catch {
          await vscode.window.showWarningMessage(
            messages.resourceTerminalUnavailable(),
          );
        }
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
      const githubAuth = await resolveGitHubToken();

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
          `- OS: ${process.platform}\n` +
          `- GitHub 認証ソース: ${githubAuth.source}\n`
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
          `- OS: ${process.platform}\n` +
          `- GitHub Credential Source: ${githubAuth.source}\n`;

      await openBugReport(issueTitle, issueBody);
    },
  );

  context.subscriptions.push(
    searchCmd,
    installCmd,
    installDefaultCmd,
    installPluginInCopilotCliCmd,
    uninstallPluginFromCopilotCliCmd,
    managePluginInClaudeCodeCmd,
    managePluginInCodexCmd,
    copyCodexRepairCommandCmd,
    uninstallPluginFromCursorCmd,
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
    clearGitHubTokenCmd,
    showGitHubAuthStatusCmd,
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
        const reinstalled = await vscode.commands.executeCommand<boolean>(
          "resourceNinja.reinstallAll",
          {
            skipConfirmation: true,
            suppressSuccessMessage: true,
          },
        );
        if (reinstalled) {
          return; // 再インストールしたのでメタデータ更新はスキップ
        }
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
