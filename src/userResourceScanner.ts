import * as vscode from "vscode";
import { ResourceKind } from "./skillIndex";
import {
  DEFAULT_GLOBAL_HOME_DIRECTORY,
  getConfiguredGlobalHomeDirectory,
  getConfiguredGlobalResourceHomePreset,
  getConfiguredUserAgentsDirectory,
  getConfiguredUserInstructionsDirectory,
  getConfiguredUserPromptsDirectory,
  resolveConfiguredUri,
} from "./customizationPaths";
import {
  detectResourceKindFromPath,
  getBuiltInResourceSourceLabel,
  getBuiltInResourceDedupeKey,
  getDefaultResourceCategories,
  getFallbackResourceName,
  getResourceMetadataPath,
  isBuiltInResourcePath,
  isIncompleteSkillContent,
  isPluginManifestPath,
  isPluginMarkerDirectoryName,
  selectPreferredPluginManifest,
  shouldReplaceBuiltInResourcePath,
} from "./resourceKinds";
import { isJapanese } from "./i18n";
import { getVsCodeUserDataPath } from "./userDataPaths";
import { stripSkillMetaLocalPaths } from "./skillInstaller";

export type UserResourceScope = "userData" | "globalHome" | "extension";

export interface UserResourceRoot {
  scope: UserResourceScope;
  label: string;
  tool: string;
  uri: vscode.Uri;
  relativeBase?: string;
  builtInOnly?: boolean;
  readOnly?: boolean;
  exactFile?: boolean;
}

export interface UserResource {
  kind: ResourceKind;
  name: string;
  description: string;
  source?: string;
  categories: string[];
  relativePath: string;
  remotePath?: string;
  pluginRoot?: string;
  pluginManifestPath?: string;
  pluginManifestKind?: string;
  fullPath: string;
  scope: UserResourceScope;
  scopeLabel: string;
  tool: string;
  rootLabel: string;
  rootFsPath: string;
  isBuiltIn?: boolean;
  isReadOnly?: boolean;
  incomplete?: boolean;
  lifecycleLabel?: string;
  lifecycleTooltipLines?: string[];
}

interface ResourceInstallMeta {
  name?: string;
  source?: string;
  description?: string;
  description_ja?: string;
  categories?: string[];
  remotePath?: string;
  incomplete?: boolean;
  pluginRoot?: string;
  pluginManifestPath?: string;
  pluginManifestKind?: string;
}

interface CollectResourceFilesOptions {
  prioritizeResourceDirectories?: boolean;
  skipRuntimeDirectories?: boolean;
}

interface ExtensionPackageJson {
  displayName?: string;
  name?: string;
  contributes?: {
    chatAgents?: Array<{ path?: unknown }>;
    chatPromptFiles?: Array<{ path?: unknown }>;
  };
}

const RESOURCE_DIRECTORY_NAMES = new Set([
  ".claude-plugin",
  ".codex",
  ".codex-plugin",
  ".cursor-plugin",
  ".gemini",
  ".github",
  ".plugin",
  ".vscode",
  "agents",
  "hooks",
  "instructions",
  "mcp",
  "plugins",
  "prompts",
  "rules",
  "skills",
]);

// Directories that GitHub Copilot CLI / App / cloud agent create under the
// global home (`~/.copilot`) for runtime state or working copies rather than
// curated resources. They must never be surfaced as user resources.
// `repos` in particular holds git worktrees checked out by the Copilot cloud
// agent (e.g. `repos/copilot-worktrees/<repo>/<branch>/.github/skills/**`),
// which otherwise leak into the tree as global-home skills.
const GLOBAL_HOME_RUNTIME_DIRECTORY_NAMES = new Set([
  "browser-output",
  "chats",
  "crash-context",
  "heartbeat",
  "ide",
  "logs",
  "m-audit-logs",
  "mcp-oauth-config",
  "media-cache",
  "repos",
  "restart",
  "run",
  "session-state",
  "session-store",
]);

const EXTENSION_RESOURCE_DIRECTORIES = [
  "agents",
  "hooks",
  "instructions",
  "mcp",
  "prompts",
  "skills",
];

function getInstalledExtensionToolLabel(
  extension: vscode.Extension<unknown>,
): string {
  const packageJson = extension.packageJSON as ExtensionPackageJson;
  return packageJson.displayName || packageJson.name || extension.id;
}

function getExtensionManifestResourcePaths(
  extension: vscode.Extension<unknown>,
): string[] {
  const packageJson = extension.packageJSON as ExtensionPackageJson;
  const contributes = packageJson.contributes;
  const candidates = [
    ...(contributes?.chatAgents || []),
    ...(contributes?.chatPromptFiles || []),
  ];
  return candidates
    .map((candidate) => candidate.path)
    .filter((candidate): candidate is string => typeof candidate === "string")
    .map((candidate) => normalizeSeparators(candidate).replace(/^\/+/, ""));
}

function isInstalledExtensionPath(extensionPath: string): boolean {
  const lowerPath = normalizeSeparators(extensionPath).toLowerCase();
  return /(^|\/)\.vscode(-insiders)?\/extensions\//.test(lowerPath);
}

function getUserResourceScopeOrder(scope: UserResourceScope): number {
  switch (scope) {
    case "userData":
      return 0;
    case "globalHome":
      return 1;
    case "extension":
      return 2;
    default:
      return 9;
  }
}

function getGlobalHomeToolLabel(config: vscode.WorkspaceConfiguration): string {
  if (config.get<string>("globalHomeDirectory")?.trim()) {
    return "Custom resource home";
  }
  switch (getConfiguredGlobalResourceHomePreset(config)) {
    case "claude":
      return "Claude-compatible";
    case "agents":
      return "Open agent resources";
    case "custom":
      return "Custom resource home";
    case "copilot":
    default:
      return "GitHub Copilot CLI";
  }
}

function getInstalledExtensionsScopeLabel(): string {
  return isJapanese() ? "インストール済み拡張機能" : "Installed Extensions";
}

function normalizeSeparators(value: string): string {
  return value.replace(/\\/g, "/");
}

function getRelativeFsPath(baseFsPath: string, targetFsPath: string): string {
  const base = normalizeSeparators(baseFsPath).replace(/\/+$/, "");
  const target = normalizeSeparators(targetFsPath);
  const baseCompare = base.toLowerCase();
  const targetCompare = target.toLowerCase();

  if (targetCompare === baseCompare) {
    return "";
  }

  const basePrefix = `${baseCompare}/`;
  if (targetCompare.startsWith(basePrefix)) {
    return target.slice(base.length + 1);
  }

  return target;
}

function getFileName(fsPath: string): string {
  const normalized = normalizeSeparators(fsPath).replace(/\/+$/g, "");
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
}

function getKnownRoots(
  workspaceUri?: vscode.Uri,
  includeBuiltInResources: boolean = false,
): UserResourceRoot[] {
  const roots: UserResourceRoot[] = [];
  const config = vscode.workspace.getConfiguration("resourceNinja");
  const userDataUri = vscode.Uri.file(
    getVsCodeUserDataPath({ appName: vscode.env.appName }),
  );
  roots.push(
    {
      scope: "userData",
      label: "VS Code User Customizations",
      tool: "VS Code",
      uri: resolveConfiguredUri(
        workspaceUri,
        getConfiguredUserAgentsDirectory(config),
        vscode.Uri.joinPath(userDataUri, "agents").fsPath,
      ),
    },
    {
      scope: "userData",
      label: "VS Code User Customizations",
      tool: "VS Code",
      uri: resolveConfiguredUri(
        workspaceUri,
        getConfiguredUserInstructionsDirectory(config),
        vscode.Uri.joinPath(userDataUri, "instructions").fsPath,
      ),
    },
    {
      scope: "userData",
      label: "VS Code User Customizations",
      tool: "VS Code",
      uri: resolveConfiguredUri(
        workspaceUri,
        getConfiguredUserPromptsDirectory(config),
        vscode.Uri.joinPath(userDataUri, "prompts").fsPath,
      ),
    },
  );

  roots.push({
    scope: "globalHome",
    label: "Global Resource Home",
    tool: getGlobalHomeToolLabel(config),
    uri: resolveConfiguredUri(
      workspaceUri,
      getConfiguredGlobalHomeDirectory(config),
      DEFAULT_GLOBAL_HOME_DIRECTORY,
    ),
  });

  if (includeBuiltInResources) {
    roots.push(
      {
        scope: "userData",
        label: "Built-in Resources",
        tool: "GitHub Copilot Chat",
        uri: vscode.Uri.joinPath(
          userDataUri,
          "globalStorage",
          "github.copilot-chat",
        ),
        builtInOnly: true,
      },
      {
        scope: "userData",
        label: "Built-in Resources",
        tool: "GitHub Copilot Chat",
        uri: vscode.Uri.joinPath(
          vscode.Uri.file(vscode.env.appRoot),
          "extensions",
          "copilot",
          "assets",
          "prompts",
        ),
        builtInOnly: true,
      },
      {
        scope: "userData",
        label: "Built-in Resources",
        tool: "VS Code",
        uri: vscode.Uri.joinPath(
          vscode.Uri.file(vscode.env.appRoot),
          "out",
          "vs",
          "sessions",
        ),
        builtInOnly: true,
      },
      {
        scope: "userData",
        label: "Built-in Resources",
        tool: "VS Code",
        uri: vscode.Uri.joinPath(
          vscode.Uri.file(vscode.env.appRoot),
          "node_modules",
          "@github",
          "copilot",
          "builtin-skills",
        ),
        builtInOnly: true,
      },
    );

    for (const extension of vscode.extensions.all) {
      const extensionId = extension.id.toLowerCase();
      const extensionPath = normalizeSeparators(extension.extensionPath);
      const isVsCodeBundledExtension =
        /(^|\/)resources\/app\/extensions\/[^/]+$/.test(
          extensionPath.toLowerCase(),
        );
      if (
        extensionId === "github.copilot-chat" ||
        /(^|\/)github\.copilot-chat-[^/]+$/.test(extensionPath.toLowerCase())
      ) {
        roots.push({
          scope: "userData",
          label: "Built-in Resources",
          tool: "GitHub Copilot Chat",
          uri: vscode.Uri.joinPath(extension.extensionUri, "assets", "prompts"),
          builtInOnly: true,
        });
      }

      if (isVsCodeBundledExtension) {
        roots.push({
          scope: "userData",
          label: "Built-in Resources",
          tool: "VS Code",
          uri: vscode.Uri.joinPath(extension.extensionUri, "skills"),
          builtInOnly: true,
        });
      }
    }
  }

  for (const extension of vscode.extensions.all) {
    const extensionId = extension.id.toLowerCase();
    const extensionPath = normalizeSeparators(extension.extensionPath);
    const isVsCodeBundledExtension =
      /(^|\/)resources\/app\/extensions\/[^/]+$/.test(
        extensionPath.toLowerCase(),
      );
    if (
      !isVsCodeBundledExtension &&
      extensionId !== "github.copilot-chat" &&
      !/(^|\/)github\.copilot-chat-[^/]+$/.test(extensionPath.toLowerCase()) &&
      isInstalledExtensionPath(extensionPath)
    ) {
      const tool = getInstalledExtensionToolLabel(extension);
      for (const directory of EXTENSION_RESOURCE_DIRECTORIES) {
        roots.push({
          scope: "extension",
          label: getInstalledExtensionsScopeLabel(),
          tool,
          uri: vscode.Uri.joinPath(
            extension.extensionUri,
            "resources",
            directory,
          ),
          relativeBase: directory,
          readOnly: true,
        });
      }
      for (const manifestPath of getExtensionManifestResourcePaths(extension)) {
        roots.push({
          scope: "extension",
          label: getInstalledExtensionsScopeLabel(),
          tool,
          uri: vscode.Uri.joinPath(extension.extensionUri, manifestPath),
          relativeBase: manifestPath,
          readOnly: true,
          exactFile: true,
        });
      }
    }
  }

  return roots;
}

async function pathExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function hasFileType(
  type: vscode.FileType,
  expectedType: vscode.FileType,
): boolean {
  return (type & expectedType) !== 0;
}

function shouldSkipScanDirectory(
  name: string,
  includeBuiltInResources: boolean,
  options: CollectResourceFilesOptions,
): boolean {
  const lowerName = name.toLowerCase();
  return (
    lowerName === "node_modules" ||
    lowerName === ".git" ||
    (!includeBuiltInResources && lowerName === "pkg") ||
    (!!options.skipRuntimeDirectories &&
      GLOBAL_HOME_RUNTIME_DIRECTORY_NAMES.has(lowerName))
  );
}

function getScanPriority(
  name: string,
  type: vscode.FileType,
  options: CollectResourceFilesOptions,
): number {
  if (hasFileType(type, vscode.FileType.File)) {
    return 0;
  }
  if (
    options.prioritizeResourceDirectories &&
    RESOURCE_DIRECTORY_NAMES.has(name.toLowerCase())
  ) {
    return 1;
  }
  return 2;
}

/**
 * `<scanRoot>/plugins/<name>/` is where a plugin package is installed, and it mirrors
 * the depth-1 glob the workspace scanner uses, so both scopes collapse exactly the
 * same directories. The depth is part of the rule: a `plugins` directory further down
 * — say `<scanRoot>/skills/x/plugins/y/` — belongs to somebody else and must keep its
 * recursive walk. The segment is matched case-insensitively because a case-insensitive
 * filesystem happily serves the same install directory as `Plugins`.
 */
function isPluginPackageDirectory(
  directory: vscode.Uri,
  scanRoot: vscode.Uri,
): boolean {
  const rootSegments = scanRoot.path.split("/").filter(Boolean);
  const segments = directory.path.split("/").filter(Boolean);
  return (
    segments.length === rootSegments.length + 2 &&
    segments[rootSegments.length].toLowerCase() === "plugins"
  );
}

/**
 * A plugin is installed as a whole package, so its manifest is the only file that
 * represents it. When `directory` is a plugin root this returns that manifest and the
 * caller must stop descending: the package's own skills, agents, hooks and MCP config
 * belong to the plugin, and VS Code already loads them from `chat.pluginLocations`.
 *
 * A package can ship several accepted manifests, so the one that represents it is
 * chosen by the shared precedence rather than by directory iteration order, which is
 * what keeps this scope on the same manifest as the workspace scope.
 */
async function findPluginManifestInDirectory(
  directory: vscode.Uri,
  entries: [string, vscode.FileType][],
): Promise<vscode.Uri | undefined> {
  const candidates: { manifestPath: string; uri: vscode.Uri }[] = [];

  for (const [name, type] of entries) {
    if (
      hasFileType(type, vscode.FileType.File) &&
      isPluginManifestPath(name.toLowerCase())
    ) {
      candidates.push({
        manifestPath: name,
        uri: vscode.Uri.joinPath(directory, name),
      });
    }
  }

  for (const [name, type] of entries) {
    if (
      !hasFileType(type, vscode.FileType.Directory) ||
      !isPluginMarkerDirectoryName(name)
    ) {
      continue;
    }
    const markerUri = vscode.Uri.joinPath(directory, name);
    let markerEntries: [string, vscode.FileType][];
    try {
      markerEntries = await vscode.workspace.fs.readDirectory(markerUri);
    } catch {
      continue;
    }
    for (const [markerFileName, markerType] of markerEntries) {
      const manifestPath = `${name}/${markerFileName}`;
      if (
        hasFileType(markerType, vscode.FileType.File) &&
        isPluginManifestPath(manifestPath.toLowerCase())
      ) {
        candidates.push({
          manifestPath,
          uri: vscode.Uri.joinPath(markerUri, markerFileName),
        });
      }
    }
  }

  return selectPreferredPluginManifest(
    candidates,
    (candidate) => candidate.manifestPath,
  )?.uri;
}

export async function collectMarkdownFiles(
  root: vscode.Uri,
  includeBuiltInResources: boolean,
  options: CollectResourceFilesOptions = {},
): Promise<vscode.Uri[]> {
  const files: vscode.Uri[] = [];
  const maxFiles = 2000;
  const rootStat = await vscode.workspace.fs.stat(root);
  if (hasFileType(rootStat.type, vscode.FileType.File)) {
    const name = root.path.split("/").pop()?.toLowerCase() || "";
    return name.endsWith(".md") ||
      name.endsWith(".json") ||
      name.endsWith(".mdc") ||
      name.endsWith(".yml") ||
      name.endsWith(".yaml")
      ? [root]
      : [];
  }

  async function walk(current: vscode.Uri, isScanRoot: boolean): Promise<void> {
    if (files.length >= maxFiles) {
      return;
    }

    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(current);
    } catch {
      return;
    }

    // Only a package this extension installed is collapsed to its manifest, and
    // those always sit one level under the scan root's own `plugins` directory. A
    // stray `plugin.json` elsewhere, or a `plugins` directory nested deeper in the
    // tree, is somebody else's and must not hide the resources beside it.
    if (!isScanRoot && isPluginPackageDirectory(current, root)) {
      const pluginManifestUri = await findPluginManifestInDirectory(
        current,
        entries,
      );
      if (pluginManifestUri) {
        files.push(pluginManifestUri);
        return;
      }
    }

    const sortedEntries = entries
      .slice()
      .sort(([nameA, typeA], [nameB, typeB]) => {
        const priorityA = getScanPriority(nameA, typeA, options);
        const priorityB = getScanPriority(nameB, typeB, options);
        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }
        return nameA.localeCompare(nameB);
      });

    for (const [name, type] of sortedEntries) {
      if (shouldSkipScanDirectory(name, includeBuiltInResources, options)) {
        continue;
      }

      const child = vscode.Uri.joinPath(current, name);
      if (hasFileType(type, vscode.FileType.Directory)) {
        await walk(child, false);
      } else if (
        hasFileType(type, vscode.FileType.File) &&
        (name.toLowerCase().endsWith(".md") ||
          name.toLowerCase().endsWith(".json") ||
          name.toLowerCase().endsWith(".mdc") ||
          name.toLowerCase().endsWith(".yml") ||
          name.toLowerCase().endsWith(".yaml"))
      ) {
        files.push(child);
        if (files.length >= maxFiles) {
          return;
        }
      }
    }
  }

  await walk(root, true);
  return files;
}

function parseFrontmatterValue(frontmatter: string, key: string): string {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*([^\\n]+)`, "m"));
  return match?.[1]?.trim().replace(/^["']|["']$/g, "") || "";
}

async function readResourceInstallMetadata(
  fileUri: vscode.Uri,
  kind: ResourceKind,
): Promise<ResourceInstallMeta | undefined> {
  try {
    const metadataUri = vscode.Uri.file(
      getResourceMetadataPath(fileUri.fsPath, kind),
    );
    const document = await vscode.workspace.openTextDocument(metadataUri);
    const parsed = JSON.parse(document.getText());
    // The sidecar can arrive from a third-party repository, so a path found
    // inside it never becomes a location this extension acts on.
    stripSkillMetaLocalPaths(parsed);
    return parsed;
  } catch {
    return undefined;
  }
}

async function parseResourceFile(
  fileUri: vscode.Uri,
  root: UserResourceRoot,
): Promise<UserResource | undefined> {
  const relativePath = normalizeSeparators(
    getRelativeFsPath(root.uri.fsPath, fileUri.fsPath),
  );
  const detectionPath = root.relativeBase
    ? `${root.relativeBase}/${relativePath}`
    : relativePath;
  const kind = detectResourceKindFromPath(detectionPath);
  if (!kind) {
    return undefined;
  }
  const installMeta = await readResourceInstallMetadata(fileUri, kind);

  let name = "";
  let description = "";
  let bodyText = "";
  try {
    const document = await vscode.workspace.openTextDocument(fileUri);
    const text = document.getText().replace(/\r\n/g, "\n");
    bodyText = text;
    const frontmatterMatch = text.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      name = parseFrontmatterValue(frontmatterMatch[1], "name");
      description = parseFrontmatterValue(frontmatterMatch[1], "description");
    }
    if (!name) {
      name = text.match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
    }
  } catch {
    // Keep fallback metadata if the file cannot be read.
  }

  const normalizedDetectionPath = normalizeSeparators(detectionPath);
  const isBuiltIn =
    isBuiltInResourcePath(normalizedDetectionPath) ||
    isBuiltInResourcePath(fileUri.fsPath);
  const isReadOnly = !!root.readOnly || isBuiltIn;
  if (root.builtInOnly && !isBuiltIn) {
    return undefined;
  }
  if (!name) {
    name = getFallbackResourceName(normalizedDetectionPath, kind);
  }
  name = installMeta?.name || name;
  description = installMeta?.description || description;

  return {
    kind,
    name,
    description,
    source: installMeta?.source,
    categories: installMeta?.categories?.length
      ? installMeta.categories
      : getDefaultResourceCategories(kind),
    relativePath: normalizedDetectionPath,
    remotePath: installMeta?.remotePath,
    pluginRoot: installMeta?.pluginRoot,
    pluginManifestPath: installMeta?.pluginManifestPath,
    pluginManifestKind: installMeta?.pluginManifestKind,
    fullPath: fileUri.fsPath,
    scope: root.scope,
    scopeLabel: root.label,
    tool: isBuiltIn ? getBuiltInResourceSourceLabel(fileUri.fsPath) : root.tool,
    rootLabel: root.label,
    rootFsPath: root.uri.fsPath,
    isBuiltIn,
    isReadOnly,
    incomplete:
      kind === "skill" &&
      !isBuiltIn &&
      (installMeta?.incomplete === true || isIncompleteSkillContent(bodyText))
        ? true
        : undefined,
  };
}

export async function scanUserResources(
  workspaceUri?: vscode.Uri,
  includeBuiltInResources: boolean = false,
): Promise<UserResource[]> {
  const roots = getKnownRoots(workspaceUri, includeBuiltInResources);
  const resources = new Map<string, UserResource>();
  const seenPaths = new Set<string>();

  for (const root of roots) {
    if (!(await pathExists(root.uri))) {
      continue;
    }

    const files = await collectMarkdownFiles(
      root.uri,
      includeBuiltInResources,
      {
        prioritizeResourceDirectories:
          root.scope === "globalHome" && !root.builtInOnly && !root.exactFile,
        skipRuntimeDirectories:
          root.scope === "globalHome" && !root.builtInOnly && !root.exactFile,
      },
    );
    for (const file of files) {
      const key = file.fsPath.toLowerCase();
      if (seenPaths.has(key)) {
        continue;
      }
      seenPaths.add(key);

      const resource = await parseResourceFile(file, root);
      if (resource) {
        if (resource.isBuiltIn && !includeBuiltInResources) {
          continue;
        }
        const resourceKey = resource.isBuiltIn
          ? getBuiltInResourceDedupeKey(resource)
          : `${resource.scope}:${resource.kind}:${resource.relativePath.toLowerCase()}`;
        const existing = resources.get(resourceKey);
        if (
          existing?.isBuiltIn &&
          !shouldReplaceBuiltInResourcePath(
            existing.fullPath,
            resource.fullPath,
          )
        ) {
          continue;
        }
        resources.set(resourceKey, resource);
      }
    }
  }

  return Array.from(resources.values()).sort((a, b) => {
    const scopeOrderCompare =
      getUserResourceScopeOrder(a.scope) - getUserResourceScopeOrder(b.scope);
    if (scopeOrderCompare !== 0) return scopeOrderCompare;
    if (a.scope === "extension" || b.scope === "extension") {
      const toolCompare = a.tool.localeCompare(b.tool);
      if (toolCompare !== 0) return toolCompare;
    }
    const scopeCompare = a.scopeLabel.localeCompare(b.scopeLabel);
    if (scopeCompare !== 0) return scopeCompare;
    const kindCompare = a.kind.localeCompare(b.kind);
    if (kindCompare !== 0) return kindCompare;
    const fileCompare = getFileName(a.fullPath).localeCompare(
      getFileName(b.fullPath),
    );
    if (fileCompare !== 0) return fileCompare;
    return a.name.localeCompare(b.name);
  });
}
