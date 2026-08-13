import { ResourceKind, Skill } from "./skillIndex";

export interface PluginPackageInfo {
  id: string;
  label: string;
  source: string;
  root: string;
  manifestPaths: string[];
}

type PluginPackageResource = Pick<
  Skill,
  | "kind"
  | "name"
  | "source"
  | "path"
  | "pluginRoot"
  | "pluginManifestPath"
  | "pluginManifestKind"
>;

const PLUGIN_PATH_PREFIX_PATTERN = /^(?:\.github\/)?plugins\/[^/]+\//;

/**
 * Kind rules for a path relative to a plugin root. Shared by the `plugins/<name>/`
 * layout and by roots discovered from a plugin manifest, so the rules stay in one place.
 */
export function detectPluginChildResourceKind(
  relativePath: string,
): ResourceKind | undefined {
  const lowerPath = relativePath.toLowerCase().replace(/\\/g, "/");
  if (/^agents\/[^/]+\.md$/.test(lowerPath)) {
    return "agent";
  }
  if (/^instructions\/[^/]+\.md$/.test(lowerPath)) {
    return "instruction";
  }
  if (/^prompts\/[^/]+\.md$/.test(lowerPath)) {
    return "prompt";
  }
  if (/^rules\/[^/]+\.mdc$/.test(lowerPath)) {
    return "cursor-rule";
  }
  if (/^hooks\/[^/]+\/readme\.md$/.test(lowerPath)) {
    return "hook";
  }
  if (
    /^hooks\/[^/]+\.json$/.test(lowerPath) &&
    !isResourceMetadataSidecarPath(lowerPath)
  ) {
    return "hook";
  }
  // Copilot plugin format keeps hooks in a root-level hooks.json.
  if (lowerPath === "hooks.json") {
    return "hook";
  }
  if (
    /^(?:mcp\.json|\.mcp\.json|\.vscode\/mcp\.json|mcp\/[^/]+\.json)$/.test(
      lowerPath,
    )
  ) {
    return "mcp";
  }
  if (/^skills\/[^/]+\/skill\.md$/.test(lowerPath)) {
    return "skill";
  }
  return undefined;
}

export function detectResourceKindFromPath(
  resourcePath: string,
): ResourceKind | undefined {
  const lowerPath = resourcePath.toLowerCase().replace(/\\/g, "/");
  if (isResourceMetadataSidecarPath(lowerPath)) {
    return undefined;
  }
  if (isPluginManifestPath(lowerPath)) {
    return "plugin";
  }
  const pluginPrefix = lowerPath.match(PLUGIN_PATH_PREFIX_PATTERN);
  if (pluginPrefix) {
    const childKind = detectPluginChildResourceKind(
      lowerPath.slice(pluginPrefix[0].length),
    );
    if (childKind) {
      return childKind;
    }
  }
  if (/^rules\/[^/]+\.mdc$/.test(lowerPath)) {
    return "cursor-rule";
  }
  if (isHookConfigFilePath(lowerPath)) {
    return "hook";
  }
  if (isNativeInstructionFilePath(lowerPath)) {
    return "instruction";
  }
  if (lowerPath === "skill.md" || lowerPath.endsWith("/skill.md")) {
    return "skill";
  }
  if (/(^|\/)skills\/[^/]+\//.test(lowerPath)) {
    return undefined;
  }
  if (lowerPath.endsWith(".agent.md")) {
    return "agent";
  }
  if (lowerPath.endsWith(".instructions.md")) {
    return "instruction";
  }
  if (lowerPath.endsWith(".prompt.md")) {
    return "prompt";
  }
  if (/^(?:\.github\/)?hooks\/[^/]+\/readme\.md$/i.test(lowerPath)) {
    return "hook";
  }
  if (
    lowerPath === "mcp.json" ||
    lowerPath === "mcp-config.json" ||
    lowerPath === ".mcp.json" ||
    lowerPath === ".vscode/mcp.json" ||
    /^(?:\.github\/)?mcp\/[^/]+\.json$/i.test(lowerPath)
  ) {
    return "mcp";
  }
  return undefined;
}

/** Accepts a full path or a bare entry name, in any casing. */
export function isResourceMetadataSidecarPath(resourcePath: string): boolean {
  const lowerPath = resourcePath.toLowerCase().replace(/\\/g, "/");
  return (
    lowerPath === ".skill-meta.json" ||
    lowerPath.endsWith("/.skill-meta.json") ||
    lowerPath.endsWith("/.resource-ninja.json") ||
    lowerPath.endsWith(".resource-ninja.json")
  );
}

/** The sidecar file names this extension writes itself. */
const OWN_METADATA_SIDECAR_FILE_NAMES = [
  ".skill-meta.json",
  ".resource-ninja.json",
];

/**
 * Matches only the two sidecar names the extension writes, so a repository file
 * such as `payload.resource-ninja.json` is still installed like any other file.
 */
export function isOwnMetadataSidecarFileName(fileName: string): boolean {
  return OWN_METADATA_SIDECAR_FILE_NAMES.includes(fileName.toLowerCase());
}

/**
 * 生成テンプレートだけの SKILL.md を判定する。
 * frontmatter を持たない resource kind へ広げると誤検知するため skill 専用。
 */
export function isIncompleteSkillContent(text: string): boolean {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.length < 50) {
    return true;
  }
  if (normalized.startsWith("---\n")) {
    return false;
  }
  const lines = normalized.split("\n").filter((line) => line.trim());
  return lines.length <= 5 && /^Source:\s+\S+$/.test(lines[lines.length - 1]);
}

export function isHookConfigFilePath(resourcePath: string): boolean {
  const lowerPath = resourcePath.toLowerCase().replace(/\\/g, "/");
  if (!/(^|\/)(?:\.github\/)?hooks\/[^/]+\.json$/i.test(lowerPath)) {
    return false;
  }
  return !isResourceMetadataSidecarPath(lowerPath);
}

function isNativeInstructionFilePath(lowerPath: string): boolean {
  return (
    lowerPath === "copilot-instructions.md" ||
    lowerPath === ".github/copilot-instructions.md" ||
    lowerPath === "claude.md" ||
    lowerPath === "agents.md" ||
    lowerPath === ".codex/agents.md" ||
    lowerPath === "gemini.md" ||
    lowerPath === ".gemini/gemini.md"
  );
}

const PLUGIN_MARKER_MANIFEST_PATTERN =
  /^(.*?)(?:^|\/)\.(?:claude-plugin|codex-plugin|cursor-plugin|plugin)\/(?:plugin|marketplace)\.json$/i;

const PLUGIN_ROOT_MANIFEST_FILE_NAMES = new Set([
  "plugin.json",
  "gemini-extension.json",
  "apm.yml",
  "apm.yaml",
]);

function isPluginManifestPath(lowerPath: string): boolean {
  const fileName = lowerPath.slice(lowerPath.lastIndexOf("/") + 1);
  return (
    PLUGIN_ROOT_MANIFEST_FILE_NAMES.has(fileName) ||
    PLUGIN_MARKER_MANIFEST_PATTERN.test(lowerPath)
  );
}

export function getPluginRootFromManifestPath(
  resourcePath: string,
): string | undefined {
  const normalizedPath = resourcePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const lowerPath = normalizedPath.toLowerCase();
  if (!isPluginManifestPath(lowerPath)) {
    return undefined;
  }

  // `.claude-plugin/plugin.json` and friends describe the directory above the marker.
  const markerMatch = normalizedPath.match(PLUGIN_MARKER_MANIFEST_PATTERN);
  if (markerMatch) {
    return markerMatch[1].replace(/\/+$/, "") || ".";
  }

  const slashIndex = normalizedPath.lastIndexOf("/");
  if (slashIndex === -1) {
    return ".";
  }
  return normalizedPath.slice(0, slashIndex).replace(/\/+$/, "") || ".";
}

export const AGENT_PLUGINS_MANIFEST_SCHEMA =
  "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
export const AGENT_PLUGINS_MANIFEST_KIND = "agent-plugins";

export const AGENT_PLUGINS_NAME_MAX_LENGTH = 64;

/**
 * Agent Plugins 1.0.0 identifies itself through the `$schema` value of a root
 * `plugin.json`. The spec forbids fetching the schema, so only the string is compared.
 */
export function declaresAgentPluginsSchema(
  filePath: string,
  manifest: Record<string, unknown>,
): boolean {
  const lowerPath = filePath.toLowerCase().replace(/\\/g, "/");
  const fileName = lowerPath.slice(lowerPath.lastIndexOf("/") + 1);
  if (fileName !== "plugin.json") {
    return false;
  }
  // Client-specific marker directories keep their path-derived kind.
  if (
    /(^|\/)\.(?:claude-plugin|codex-plugin|cursor-plugin|plugin)\/plugin\.json$/.test(
      lowerPath,
    )
  ) {
    return false;
  }
  return manifest.$schema === AGENT_PLUGINS_MANIFEST_SCHEMA;
}

/**
 * Agent Plugins 1.0.0 §5.3 / §5.5 require `name`, and a conformant client rejects the
 * whole plugin when it breaks these rules. Returns the violated constraint, or
 * `undefined` when the value is valid.
 */
export function getAgentPluginsNameIssue(name: unknown): string | undefined {
  if (name === undefined || name === null) {
    return "missing";
  }
  if (typeof name !== "string") {
    return "not a string";
  }
  if (name.length === 0) {
    return "empty";
  }
  if (name.length > AGENT_PLUGINS_NAME_MAX_LENGTH) {
    return `longer than ${AGENT_PLUGINS_NAME_MAX_LENGTH} characters`;
  }
  if (!/^[a-z0-9.-]+$/.test(name)) {
    return "must use lowercase letters, digits, hyphens, and periods only";
  }
  if (!/^[a-z0-9]/.test(name) || !/[a-z0-9]$/.test(name)) {
    return "must start and end with a letter or digit";
  }
  if (name.includes("--") || name.includes("..")) {
    return 'must not contain "--" or ".."';
  }
  return undefined;
}

/** Agent Plugins 1.0.0 §5.2: the permitted top-level fields. */
export const AGENT_PLUGINS_MANIFEST_FIELDS = [
  "$schema",
  "name",
  "version",
  "description",
  "author",
  "homepage",
  "repository",
  "license",
  "keywords",
  "extensions",
] as const;

/** Agent Plugins 1.0.0 §5.4: the permitted `author` fields. */
export const AGENT_PLUGINS_AUTHOR_FIELDS = ["name", "email", "url"] as const;

const AGENT_PLUGINS_STRING_FIELDS = [
  "version",
  "description",
  "homepage",
  "repository",
  "license",
] as const;

/**
 * Agent Plugins 1.0.0 §5.2-§5.4 fatal manifest rules, excluding `name`, which
 * `getAgentPluginsNameIssue` owns. Returns the violated rule, or `undefined`.
 *
 * Non-fatal by specification and therefore never reported here: an unknown
 * top-level field and a non-object `extensions` are reported and ignored, and
 * §8.1 forbids validating the contents of `extensions` members. §5.3 also forbids
 * rejecting a manifest solely because `version` is not SemVer, a URL field is not
 * a recognized URL, `author.email` is not a recognized email, or `license` is not
 * an SPDX identifier, so none of those are checked.
 */
export function getAgentPluginsManifestIssue(
  manifest: Record<string, unknown>,
): string | undefined {
  for (const field of AGENT_PLUGINS_STRING_FIELDS) {
    const value = manifest[field];
    if (value !== undefined && typeof value !== "string") {
      return `"${field}" must be a string`;
    }
  }

  const keywords = manifest.keywords;
  if (keywords !== undefined) {
    if (!Array.isArray(keywords)) {
      return '"keywords" must be an array of strings';
    }
    for (let index = 0; index < keywords.length; index++) {
      if (typeof keywords[index] !== "string") {
        return `"keywords[${index}]" must be a string`;
      }
    }
  }

  const author = manifest.author;
  if (author !== undefined) {
    if (
      typeof author !== "object" ||
      author === null ||
      Array.isArray(author)
    ) {
      return '"author" must be an object';
    }
    for (const [field, value] of Object.entries(
      author as Record<string, unknown>,
    )) {
      if (!(AGENT_PLUGINS_AUTHOR_FIELDS as readonly string[]).includes(field)) {
        return `"author.${field}" is not a permitted field`;
      }
      if (typeof value !== "string") {
        return `"author.${field}" must be a string`;
      }
    }
  }

  return undefined;
}

/**
 * The single reason a `plugin.json` that declares the Agent Plugins schema is not
 * treated as conformant. Both index paths call this so their user-visible text and
 * their manifest kind can never disagree.
 */
export function getAgentPluginsConformanceIssue(
  filePath: string,
  manifest: Record<string, unknown>,
): string | undefined {
  if (!declaresAgentPluginsSchema(filePath, manifest)) {
    return undefined;
  }
  const nameIssue = getAgentPluginsNameIssue(manifest.name);
  if (nameIssue) {
    // The name issues are a mix of states ("missing") and rules ("must ...").
    return nameIssue.startsWith("must")
      ? `"name" ${nameIssue}`
      : `"name" is ${nameIssue}`;
  }
  return getAgentPluginsManifestIssue(manifest);
}

/**
 * The Output Channel is not a surface end users read, so the reason a package was
 * denied the conformance label is prepended to the description itself. It goes in
 * front because every row builder truncates from the end.
 */
export function markAgentPluginsIssueDescription(
  description: string,
  issue: string | undefined,
): string {
  if (!issue) {
    return description;
  }
  const marker = `[Agent Plugins 1.0.0: ${issue}]`;
  return description ? `${marker} ${description}` : marker;
}

/**
 * The `agent-plugins` label is a conformance claim, so it is only granted when the
 * manifest also satisfies the specification rules a conformant client treats as fatal.
 */
export function isAgentPluginsManifest(
  filePath: string,
  manifest: Record<string, unknown>,
): boolean {
  return (
    declaresAgentPluginsSchema(filePath, manifest) &&
    getAgentPluginsNameIssue(manifest.name) === undefined &&
    getAgentPluginsManifestIssue(manifest) === undefined
  );
}

function normalizeResourcePath(resourcePath: string): string {
  return resourcePath.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
}

function getSkillRootDirectoryFromPath(
  resourcePath: string,
): string | undefined {
  const normalizedPath = normalizeResourcePath(resourcePath);
  if (normalizedPath !== "skill.md" && !normalizedPath.endsWith("/skill.md")) {
    return undefined;
  }
  const slashIndex = normalizedPath.lastIndexOf("/");
  return slashIndex === -1 ? "" : normalizedPath.slice(0, slashIndex);
}

export function getSkillRootDirectoriesFromPaths(
  resourcePaths: string[],
): Set<string> {
  const rootDirectories = new Set<string>();
  for (const resourcePath of resourcePaths) {
    const rootDirectory = getSkillRootDirectoryFromPath(resourcePath);
    if (rootDirectory !== undefined) {
      rootDirectories.add(rootDirectory);
    }
  }
  return rootDirectories;
}

export function isNestedResourcePathUnderSkillRoot(
  resourcePath: string,
  kind: ResourceKind,
  skillRootDirectories: Set<string>,
): boolean {
  if (kind === "skill") {
    return false;
  }
  const normalizedPath = normalizeResourcePath(resourcePath);
  for (const rootDirectory of skillRootDirectories) {
    if (rootDirectory && normalizedPath.startsWith(`${rootDirectory}/`)) {
      return true;
    }
  }
  return false;
}

export function getPluginIdFromPath(resourcePath?: string): string | undefined {
  const normalizedPath = (resourcePath || "").replace(/\\/g, "/");
  const match = normalizedPath.match(/^plugins\/([^/]+)\//i);
  if (match?.[1]) {
    return match[1];
  }
  const githubPluginMatch = normalizedPath.match(
    /^\.github\/plugins\/([^/]+)\//i,
  );
  return githubPluginMatch?.[1];
}

function normalizePluginRoot(root: string | undefined): string | undefined {
  if (!root) {
    return undefined;
  }
  const normalizedRoot = root.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return normalizedRoot || ".";
}

function getPluginPackageKey(source: string, root: string): string {
  return `${source}:${root}`;
}

function getPluginFallbackRoot(resourcePath?: string): string | undefined {
  const pluginId = getPluginIdFromPath(resourcePath);
  return pluginId ? `plugins/${pluginId}` : undefined;
}

function getPluginPackageRoot(
  resource: PluginPackageResource,
): string | undefined {
  const explicitRoot = normalizePluginRoot(
    resource.pluginRoot ||
      getPluginRootFromManifestPath(
        resource.pluginManifestPath || resource.path,
      ),
  );
  if (explicitRoot) {
    return explicitRoot;
  }
  return getPluginFallbackRoot(resource.path);
}

function isPackageManifest(resource: PluginPackageResource): boolean {
  return (
    (resource.kind || detectResourceKindFromPath(resource.path)) === "plugin" &&
    resource.pluginManifestKind !== "marketplace"
  );
}

export function getPluginPackageCandidates(
  resources: PluginPackageResource[],
): PluginPackageInfo[] {
  const packages = new Map<string, PluginPackageInfo>();

  for (const resource of resources) {
    if (!isPackageManifest(resource)) {
      continue;
    }
    const root = getPluginPackageRoot(resource);
    if (!root) {
      continue;
    }
    const id = getPluginPackageKey(resource.source, root);
    const manifestPath = resource.pluginManifestPath || resource.path;
    const existing = packages.get(id);
    if (existing) {
      if (!existing.manifestPaths.includes(manifestPath)) {
        existing.manifestPaths.push(manifestPath);
      }
      continue;
    }
    packages.set(id, {
      id,
      label: resource.name || (root === "." ? resource.source : root),
      source: resource.source,
      root,
      manifestPaths: [manifestPath],
    });
  }

  for (const resource of resources) {
    const fallbackRoot = getPluginFallbackRoot(resource.path);
    if (!fallbackRoot) {
      continue;
    }
    const id = getPluginPackageKey(resource.source, fallbackRoot);
    if (packages.has(id)) {
      continue;
    }
    const pathPluginId = fallbackRoot.split("/").pop() || fallbackRoot;
    packages.set(id, {
      id,
      label: pathPluginId,
      source: resource.source,
      root: fallbackRoot,
      manifestPaths: [],
    });
  }

  return [...packages.values()].sort((a, b) => {
    const sourceCompare = a.source.localeCompare(b.source);
    if (sourceCompare !== 0) {
      return sourceCompare;
    }
    if (a.root === "." && b.root !== ".") {
      return 1;
    }
    if (a.root !== "." && b.root === ".") {
      return -1;
    }
    return a.label.localeCompare(b.label);
  });
}

export function getPluginPackageId(
  resource: PluginPackageResource,
  packages: PluginPackageInfo[] = [],
): string | undefined {
  if (!resource.source) {
    return undefined;
  }

  const directRoot = getPluginPackageRoot(resource);
  if (directRoot) {
    const directId = getPluginPackageKey(resource.source, directRoot);
    if (packages.length === 0 || packages.some((pkg) => pkg.id === directId)) {
      return directId;
    }
  }

  const normalizedPath = resource.path.replace(/\\/g, "/").replace(/^\/+/, "");
  const sourcePackages = packages
    .filter((pkg) => pkg.source === resource.source)
    .sort((a, b) => b.root.length - a.root.length);

  for (const pkg of sourcePackages) {
    if (pkg.root === ".") {
      continue;
    }
    if (
      normalizedPath === pkg.root ||
      normalizedPath.startsWith(`${pkg.root}/`)
    ) {
      return pkg.id;
    }
  }

  const rootPackage = sourcePackages.find((pkg) => pkg.root === ".");
  if (rootPackage && resource.pluginManifestKind !== "marketplace") {
    return rootPackage.id;
  }

  return undefined;
}

export function getPluginPackageLabel(
  packageId: string | undefined,
  packages: PluginPackageInfo[] = [],
): string | undefined {
  if (!packageId) {
    return undefined;
  }
  const pluginPackage = packages.find((pkg) => pkg.id === packageId);
  if (pluginPackage) {
    return pluginPackage.label;
  }
  return packageId.split(":").pop()?.split("/").pop();
}

export function isBuiltInResourcePath(resourcePath: string): boolean {
  const lowerPath = resourcePath.toLowerCase().replace(/\\/g, "/");
  return (
    /(^|\/)resources\/app\/out\/vs\/sessions\//.test(lowerPath) ||
    /(^|\/)extensions[^/]*\/github\.copilot-chat-[^/]+\/assets\/prompts\//.test(
      lowerPath,
    ) ||
    /(^|\/)globalstorage\/github\.copilot-chat\//.test(lowerPath) ||
    /(^|\/)resources\/app\/extensions\/copilot\/assets\/prompts\//.test(
      lowerPath,
    ) ||
    /(^|\/)resources\/app\/extensions\/[^/]+\/skills\//.test(lowerPath) ||
    /(^|\/)resources\/app\/node_modules\//.test(lowerPath) ||
    /(^|\/)pkg\/universal\/[^/]+\/builtin-(skills|agents|prompts|instructions|hooks|mcp)\//.test(
      lowerPath,
    ) ||
    /(^|\/)builtin-(skills|agents|prompts|instructions|hooks|mcp)\//.test(
      lowerPath,
    )
  );
}

export function getBuiltInResourceSourceLabel(resourcePath: string): string {
  const lowerPath = resourcePath.toLowerCase().replace(/\\/g, "/");

  if (
    /(^|\/)globalstorage\/github\.copilot-chat\//.test(lowerPath) ||
    /(^|\/)extensions[^/]*\/github\.copilot-chat-[^/]+\/assets\/prompts\//.test(
      lowerPath,
    ) ||
    /(^|\/)resources\/app\/extensions\/copilot\/assets\/prompts\//.test(
      lowerPath,
    )
  ) {
    return "GitHub Copilot Chat";
  }

  if (
    /(^|\/)pkg\/universal\/[^/]+\/builtin-(skills|agents|prompts|instructions|hooks|mcp)\//.test(
      lowerPath,
    ) ||
    /(^|\/)builtin-(skills|agents|prompts|instructions|hooks|mcp)\//.test(
      lowerPath,
    ) ||
    /(^|\/)resources\/app\/node_modules\/.*builtin-skills\//.test(lowerPath)
  ) {
    return "GitHub Copilot CLI";
  }

  if (
    /(^|\/)resources\/app\/out\/vs\/sessions\//.test(lowerPath) ||
    /(^|\/)resources\/app\/extensions\/[^/]+\/skills\//.test(lowerPath) ||
    /(^|\/)resources\/app\/node_modules\//.test(lowerPath)
  ) {
    return "VS Code";
  }

  return "Built-in";
}

function getBuiltInPackageVersion(resourcePath: string): number[] | undefined {
  const match = resourcePath
    .toLowerCase()
    .replace(/\\/g, "/")
    .match(
      /(^|\/)pkg\/universal\/([^/]+)\/builtin-(skills|agents|prompts|instructions|hooks|mcp)\//,
    );
  if (!match) {
    return undefined;
  }
  return match[2]
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function compareVersionParts(a: number[], b: number[]): number {
  const maxLength = Math.max(a.length, b.length);
  for (let index = 0; index < maxLength; index += 1) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) {
      return left - right;
    }
  }
  return 0;
}

function getBuiltInResourcePathPriority(resourcePath: string): number {
  const lowerPath = resourcePath.toLowerCase().replace(/\\/g, "/");
  if (
    /(^|\/)pkg\/universal\/[^/]+\/builtin-(skills|agents|prompts|instructions|hooks|mcp)\//.test(
      lowerPath,
    )
  ) {
    return 0;
  }
  if (
    /\/resources\/app\/extensions\/copilot\/assets\/prompts\//.test(lowerPath)
  ) {
    return 1;
  }
  if (/\/resources\/app\/out\/vs\/sessions\//.test(lowerPath)) {
    return 2;
  }
  if (/\/resources\/app\/extensions\/[^/]+\/skills\//.test(lowerPath)) {
    return 3;
  }
  if (/\/resources\/app\/node_modules\//.test(lowerPath)) {
    return 4;
  }
  if (
    /\/extensions[^/]*\/github\.copilot-chat-[^/]+\/assets\/prompts\//.test(
      lowerPath,
    )
  ) {
    return 5;
  }
  if (/\/globalstorage\/github\.copilot-chat\/[^/]+-agent\//.test(lowerPath)) {
    return 6;
  }
  return 9;
}

export function getBuiltInResourceDedupeKey(resource: {
  kind?: ResourceKind;
  name: string;
}): string {
  return `built-in:${resource.kind || "skill"}:${resource.name.toLowerCase()}`;
}

export function getResourceMetadataPath(
  resourcePath: string,
  kind: ResourceKind,
): string {
  const normalizedPath = resourcePath.replace(/\\/g, "/");
  if (kind === "skill") {
    return `${normalizedPath.replace(/\/SKILL\.md$/i, "")}/.skill-meta.json`;
  }
  if (kind === "hook") {
    return `${normalizedPath.replace(/\/README\.md$/i, "")}/.resource-ninja.json`;
  }
  if (kind === "plugin") {
    return `${normalizedPath.replace(/\/+$/g, "")}/.resource-ninja.json`;
  }
  return `${normalizedPath}.resource-ninja.json`;
}

export function shouldReplaceBuiltInResourcePath(
  existingPath: string,
  candidatePath: string,
): boolean {
  const existingVersion = getBuiltInPackageVersion(existingPath);
  const candidateVersion = getBuiltInPackageVersion(candidatePath);
  if (existingVersion && candidateVersion) {
    const versionCompare = compareVersionParts(
      candidateVersion,
      existingVersion,
    );
    if (versionCompare !== 0) {
      return versionCompare > 0;
    }
  }

  const existingPriority = getBuiltInResourcePathPriority(existingPath);
  const candidatePriority = getBuiltInResourcePathPriority(candidatePath);
  if (existingPriority !== candidatePriority) {
    return candidatePriority < existingPriority;
  }

  const existingNormalized = existingPath.toLowerCase().replace(/\\/g, "/");
  const candidateNormalized = candidatePath.toLowerCase().replace(/\\/g, "/");
  if (existingNormalized.length !== candidateNormalized.length) {
    return candidateNormalized.length < existingNormalized.length;
  }
  return candidateNormalized.localeCompare(existingNormalized) < 0;
}

export function getResourceInstallPath(
  filePath: string,
  kind: ResourceKind,
): string {
  const normalizedPath = filePath.replace(/\\/g, "/");
  if (kind === "skill") {
    return normalizedPath.replace(/\/SKILL\.md$/i, "");
  }
  if (kind === "plugin") {
    return getPluginRootFromManifestPath(normalizedPath) || normalizedPath;
  }
  return normalizedPath;
}

export function getFallbackResourceName(
  filePath: string,
  kind: ResourceKind,
): string {
  const pathParts = filePath.replace(/\\/g, "/").split("/");
  if (kind === "skill") {
    return pathParts[pathParts.length - 2] || "Unknown";
  }
  if (kind === "hook" && !isHookConfigFilePath(filePath)) {
    return pathParts[pathParts.length - 2] || "Unknown";
  }
  if (kind === "plugin") {
    const pluginRoot = getPluginRootFromManifestPath(filePath);
    if (pluginRoot && pluginRoot !== ".") {
      const rootParts = pluginRoot.split("/");
      return rootParts[rootParts.length - 1] || "plugin";
    }
    return "plugin";
  }

  const fileName = pathParts[pathParts.length - 1] || "Unknown";
  return fileName
    .replace(/\.(agent|instructions|prompt)\.md$/i, "")
    .replace(/\.mdc$/i, "")
    .replace(/\.mcp\.json$/i, "")
    .replace(/\.json$/i, "");
}

export function getDefaultResourceCategories(kind: ResourceKind): string[] {
  switch (kind) {
    case "agent":
      return ["agents"];
    case "instruction":
      return ["instructions"];
    case "prompt":
      return ["prompts"];
    case "hook":
      return ["hooks"];
    case "mcp":
      return ["mcp"];
    case "plugin":
      return ["plugins"];
    case "cursor-rule":
      return ["cursor-rules"];
    case "skill":
    default:
      return [];
  }
}

export function getInstalledResourceKey(resource: {
  kind?: ResourceKind;
  path?: string;
  relativePath?: string;
  name: string;
}): string {
  const pathValueRaw = resource.relativePath || resource.path || resource.name;
  const kind =
    resource.kind || detectResourceKindFromPath(pathValueRaw) || "skill";
  const pathValue = (resource.relativePath || resource.path || resource.name)
    .replace(/\\/g, "/")
    .toLowerCase();

  if (kind === "skill") {
    return `${kind}:${resource.name.toLowerCase()}`;
  }

  return `${kind}:${pathValue}`;
}

export function getResourceIdentityKeys(resource: {
  kind?: ResourceKind;
  path?: string;
  relativePath?: string;
  remotePath?: string;
  source?: string;
  name: string;
}): string[] {
  const keys = new Set<string>();
  const kind = resource.kind || "skill";
  keys.add(getInstalledResourceKey(resource));
  keys.add(`${kind}:name:${resource.name.toLowerCase()}`);

  if (resource.source) {
    keys.add(
      `${kind}:source:${resource.source.toLowerCase()}:${resource.name.toLowerCase()}`,
    );
  }

  const remotePath = resource.remotePath || resource.path;
  if (resource.source && remotePath) {
    keys.add(
      `${kind}:remote:${resource.source.toLowerCase()}:${remotePath
        .replace(/\\/g, "/")
        .toLowerCase()}`,
    );
  }

  return [...keys];
}

export function getResourceLabelSuffix(resource: Pick<Skill, "kind">): string {
  const kind = resource.kind || "skill";
  return kind === "skill" ? "" : ` (${kind})`;
}
