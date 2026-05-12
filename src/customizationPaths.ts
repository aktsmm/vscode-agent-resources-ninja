import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ResourceKind } from "./skillIndex";

export const DEFAULT_SKILLS_DIRECTORY = ".github/skills";
export const DEFAULT_WORKSPACE_AGENTS_DIRECTORY = ".github/agents";
export const DEFAULT_WORKSPACE_INSTRUCTIONS_DIRECTORY = ".github/instructions";
export const DEFAULT_WORKSPACE_PROMPTS_DIRECTORY = ".github/prompts";
export const DEFAULT_WORKSPACE_HOOKS_DIRECTORY = ".github/hooks";
export const DEFAULT_WORKSPACE_MCP_DIRECTORY = ".github/mcp";
export const DEFAULT_GLOBAL_HOME_DIRECTORY = "~/.copilot";
export const DEFAULT_GLOBAL_RESOURCE_HOME_PRESET = "copilot";
export const DEFAULT_INSTRUCTION_FILE = "AGENTS.md";
export const DISABLED_INSTRUCTION_FILE = "none";

export type CoexistenceMode = "auto" | "independent";
export type InstructionBlockScope = "workspace" | "globalHome";
export type InstructionBlockScopeOverride = "inherit" | "on" | "off";

export type GlobalResourceHomePreset =
  | "copilot"
  | "claude"
  | "agents"
  | "custom";

function normalizeSeparators(value: string): string {
  return value.replace(/\\/g, "/");
}

function getWorkspaceRelativeUri(
  workspaceUri: vscode.Uri,
  relativePath: string,
): vscode.Uri {
  const segments = normalizeSeparators(relativePath).split("/").filter(Boolean);
  return vscode.Uri.joinPath(workspaceUri, ...segments);
}

export function isHomeRelativePath(configuredPath: string): boolean {
  return normalizeSeparators(configuredPath).startsWith("~/");
}

export function isAbsoluteConfiguredPath(configuredPath: string): boolean {
  return path.isAbsolute(configuredPath);
}

export function isWorkspaceRelativeConfiguredPath(
  configuredPath: string,
): boolean {
  return (
    !isHomeRelativePath(configuredPath) &&
    !isAbsoluteConfiguredPath(configuredPath)
  );
}

export function resolveConfiguredUri(
  workspaceUri: vscode.Uri | undefined,
  configuredPath: string | undefined,
  fallbackPath: string,
): vscode.Uri {
  const rawPath = (configuredPath || fallbackPath).trim() || fallbackPath;
  const normalizedPath = normalizeSeparators(rawPath);

  if (isHomeRelativePath(normalizedPath)) {
    const resolvedPath = path.join(os.homedir(), normalizedPath.slice(2));
    return vscode.Uri.file(path.normalize(resolvedPath));
  }

  if (isAbsoluteConfiguredPath(normalizedPath)) {
    return vscode.Uri.file(path.normalize(normalizedPath));
  }

  if (!workspaceUri) {
    return vscode.Uri.file(path.resolve(normalizedPath));
  }

  return getWorkspaceRelativeUri(workspaceUri, normalizedPath);
}

export function getConfiguredInstructionFilePath(
  config: vscode.WorkspaceConfiguration,
): string {
  const instructionFile =
    config.get<string>("instructionFile") || DEFAULT_INSTRUCTION_FILE;

  if (instructionFile === "custom") {
    return (
      config.get<string>("customInstructionPath") || DEFAULT_INSTRUCTION_FILE
    );
  }

  return instructionFile;
}

export function getConfiguredSkillsDirectory(
  config: vscode.WorkspaceConfiguration,
): string {
  const resourcesDirectoryInspect =
    config.inspect<string>("resourcesDirectory");
  const configuredResourcesDirectory =
    resourcesDirectoryInspect?.workspaceValue ||
    resourcesDirectoryInspect?.workspaceFolderValue ||
    resourcesDirectoryInspect?.globalValue;
  if (typeof configuredResourcesDirectory === "string") {
    const trimmed = configuredResourcesDirectory.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  const legacySkillsDirectoryInspect =
    config.inspect<string>("skillsDirectory");
  const configuredLegacySkillsDirectory =
    legacySkillsDirectoryInspect?.workspaceValue ||
    legacySkillsDirectoryInspect?.workspaceFolderValue ||
    legacySkillsDirectoryInspect?.globalValue;
  if (typeof configuredLegacySkillsDirectory === "string") {
    const trimmed = configuredLegacySkillsDirectory.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  const siblingSkillsDirectory = vscode.workspace
    .getConfiguration("skillNinja")
    .get<string>("skillsDirectory")
    ?.trim();
  if (siblingSkillsDirectory) {
    return siblingSkillsDirectory;
  }

  return DEFAULT_SKILLS_DIRECTORY;
}

export function getConfiguredCoexistenceMode(
  config: vscode.WorkspaceConfiguration,
): CoexistenceMode {
  return config.get<CoexistenceMode>("coexistenceMode") || "auto";
}

export function getConfiguredKindsExcluded(
  config: vscode.WorkspaceConfiguration,
): ResourceKind[] {
  const configuredKinds = config.get<string[]>("kindsExcluded") || [];
  return configuredKinds.filter(
    (kind): kind is ResourceKind =>
      kind === "skill" ||
      kind === "agent" ||
      kind === "instruction" ||
      kind === "prompt" ||
      kind === "hook" ||
      kind === "mcp" ||
      kind === "plugin" ||
      kind === "cursor-rule",
  );
}

function getConfiguredInstructionBlockIncludeAgents(
  config: vscode.WorkspaceConfiguration,
): boolean {
  return config.get<boolean>("instructionBlock.includeAgents") ?? true;
}

function getConfiguredInstructionBlockIncludeInstructions(
  config: vscode.WorkspaceConfiguration,
): boolean {
  return config.get<boolean>("instructionBlock.includeInstructions") ?? false;
}

function getConfiguredInstructionBlockOverride(
  config: vscode.WorkspaceConfiguration,
  key:
    | "instructionBlock.globalHome.includeAgents"
    | "instructionBlock.globalHome.includeInstructions",
): InstructionBlockScopeOverride {
  const value = config.get<InstructionBlockScopeOverride>(key) ?? "inherit";
  return value === "on" || value === "off" || value === "inherit"
    ? value
    : "inherit";
}

function resolveInstructionBlockToggle(
  baseValue: boolean,
  overrideValue: InstructionBlockScopeOverride,
): boolean {
  switch (overrideValue) {
    case "on":
      return true;
    case "off":
      return false;
    case "inherit":
    default:
      return baseValue;
  }
}

export function getInstructionBlockKinds(
  config: vscode.WorkspaceConfiguration,
  scope: InstructionBlockScope,
  options?: { ignoreLegacyKindsExcluded?: boolean },
): ResourceKind[] {
  const includeAgentsBase = getConfiguredInstructionBlockIncludeAgents(config);
  const includeInstructionsBase =
    getConfiguredInstructionBlockIncludeInstructions(config);

  const includeAgents =
    scope === "globalHome"
      ? resolveInstructionBlockToggle(
          includeAgentsBase,
          getConfiguredInstructionBlockOverride(
            config,
            "instructionBlock.globalHome.includeAgents",
          ),
        )
      : includeAgentsBase;
  const includeInstructions =
    scope === "globalHome"
      ? resolveInstructionBlockToggle(
          includeInstructionsBase,
          getConfiguredInstructionBlockOverride(
            config,
            "instructionBlock.globalHome.includeInstructions",
          ),
        )
      : includeInstructionsBase;

  const kinds: ResourceKind[] = ["skill"];
  if (includeAgents) {
    kinds.push("agent");
  }
  if (includeInstructions) {
    kinds.push("instruction");
  }

  if (options?.ignoreLegacyKindsExcluded) {
    return kinds;
  }

  const legacyExcludedKinds = new Set(getConfiguredKindsExcluded(config));
  return kinds.filter(
    (kind) => kind === "skill" || !legacyExcludedKinds.has(kind),
  );
}

export function getConfiguredUseSharedSourcesManifest(
  config: vscode.WorkspaceConfiguration,
): boolean {
  return config.get<boolean>("useSharedSourcesManifest") ?? false;
}

export function getConfiguredUseSharedResourceIndex(
  config: vscode.WorkspaceConfiguration,
): boolean {
  return config.get<boolean>("useSharedResourceIndex") ?? false;
}

export function getConfiguredWorkspaceAgentsDirectory(
  config: vscode.WorkspaceConfiguration,
): string {
  return (
    config.get<string>("workspaceAgentsDirectory") ||
    DEFAULT_WORKSPACE_AGENTS_DIRECTORY
  );
}

export function getConfiguredWorkspaceInstructionsDirectory(
  config: vscode.WorkspaceConfiguration,
): string {
  return (
    config.get<string>("workspaceInstructionsDirectory") ||
    DEFAULT_WORKSPACE_INSTRUCTIONS_DIRECTORY
  );
}

export function getConfiguredWorkspacePromptsDirectory(
  config: vscode.WorkspaceConfiguration,
): string {
  return (
    config.get<string>("workspacePromptsDirectory") ||
    DEFAULT_WORKSPACE_PROMPTS_DIRECTORY
  );
}

export function getConfiguredWorkspaceHooksDirectory(
  config: vscode.WorkspaceConfiguration,
): string {
  return (
    config.get<string>("workspaceHooksDirectory") ||
    DEFAULT_WORKSPACE_HOOKS_DIRECTORY
  );
}

export function getConfiguredWorkspaceMcpDirectory(
  config: vscode.WorkspaceConfiguration,
): string {
  return (
    config.get<string>("workspaceMcpDirectory") ||
    DEFAULT_WORKSPACE_MCP_DIRECTORY
  );
}

export function getConfiguredUserAgentsDirectory(
  config: vscode.WorkspaceConfiguration,
): string | undefined {
  return config.get<string>("userAgentsDirectory") || undefined;
}

export function getConfiguredUserInstructionsDirectory(
  config: vscode.WorkspaceConfiguration,
): string | undefined {
  return config.get<string>("userInstructionsDirectory") || undefined;
}

export function getConfiguredUserPromptsDirectory(
  config: vscode.WorkspaceConfiguration,
): string | undefined {
  return config.get<string>("userPromptsDirectory") || undefined;
}

export function getDefaultGlobalHomeDirectoryForPreset(
  preset: string | undefined,
): string {
  switch (preset) {
    case "claude":
      return "~/.claude";
    case "agents":
      return "~/.agents";
    case "custom":
    case "copilot":
    default:
      return DEFAULT_GLOBAL_HOME_DIRECTORY;
  }
}

export function getConfiguredGlobalResourceHomePreset(
  config: vscode.WorkspaceConfiguration,
): GlobalResourceHomePreset {
  const preset =
    config.get<GlobalResourceHomePreset>("globalResourceHomePreset") ||
    DEFAULT_GLOBAL_RESOURCE_HOME_PRESET;
  if (
    preset === "copilot" ||
    preset === "claude" ||
    preset === "agents" ||
    preset === "custom"
  ) {
    return preset;
  }
  return DEFAULT_GLOBAL_RESOURCE_HOME_PRESET;
}

export function getConfiguredGlobalHomeDirectory(
  config: vscode.WorkspaceConfiguration,
): string {
  const configuredPath = config.get<string>("globalHomeDirectory")?.trim();
  if (configuredPath) {
    return configuredPath;
  }
  return getDefaultGlobalHomeDirectoryForPreset(
    getConfiguredGlobalResourceHomePreset(config),
  );
}

export function getConfiguredAutoUpdateResourcesOnUpgrade(
  config: vscode.WorkspaceConfiguration,
): string {
  return (
    config.get<string>("autoUpdateResourcesOnUpgrade") ||
    config.get<string>("autoUpdateSkillsOnUpgrade") ||
    "prompt"
  );
}

export function getConfiguredIncludeLocalResources(
  config: vscode.WorkspaceConfiguration,
): boolean {
  return (
    config.get<boolean>("includeLocalResources") ??
    config.get<boolean>("includeLocalSkills") ??
    false
  );
}

export function resolveSkillsDirectoryUri(
  workspaceUri: vscode.Uri,
  config: vscode.WorkspaceConfiguration,
): vscode.Uri {
  return resolveConfiguredUri(
    workspaceUri,
    getConfiguredSkillsDirectory(config),
    DEFAULT_SKILLS_DIRECTORY,
  );
}

export function resolveInstructionFileUri(
  workspaceUri: vscode.Uri,
  config: vscode.WorkspaceConfiguration,
): vscode.Uri | undefined {
  const instructionPath = getConfiguredInstructionFilePath(config);
  if (instructionPath === DISABLED_INSTRUCTION_FILE) {
    return undefined;
  }

  return resolveConfiguredUri(
    workspaceUri,
    instructionPath,
    DEFAULT_INSTRUCTION_FILE,
  );
}

export function getGlobalInstructionFileNameForPreset(
  preset: GlobalResourceHomePreset,
): string {
  switch (preset) {
    case "copilot":
      return "copilot-instructions.md";
    case "claude":
      return "CLAUDE.md";
    case "agents":
    case "custom":
    default:
      return DEFAULT_INSTRUCTION_FILE;
  }
}

export function resolveGlobalInstructionFileUri(
  workspaceUri: vscode.Uri,
  config: vscode.WorkspaceConfiguration,
): vscode.Uri | undefined {
  const instructionPath = getConfiguredInstructionFilePath(config);
  if (instructionPath === DISABLED_INSTRUCTION_FILE) {
    return undefined;
  }

  if (
    isHomeRelativePath(instructionPath) ||
    isAbsoluteConfiguredPath(instructionPath)
  ) {
    return resolveConfiguredUri(
      workspaceUri,
      instructionPath,
      DEFAULT_INSTRUCTION_FILE,
    );
  }

  const globalHomeUri = resolveConfiguredUri(
    workspaceUri,
    getConfiguredGlobalHomeDirectory(config),
    DEFAULT_GLOBAL_HOME_DIRECTORY,
  );
  return vscode.Uri.joinPath(
    globalHomeUri,
    getGlobalInstructionFileNameForPreset(
      getConfiguredGlobalResourceHomePreset(config),
    ),
  );
}

export function getRelativeSkillsPathForWorkspace(
  resourcesDirectory: string,
): string | undefined {
  if (!isWorkspaceRelativeConfiguredPath(resourcesDirectory)) {
    return undefined;
  }

  return normalizeSeparators(resourcesDirectory).replace(/^\.\//, "");
}
