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
  if (
    !/(^|\/)(?:\.github\/)?hooks\/[^/]+\.json$/i.test(lowerPath) &&
    !/(^|\/)hooks\.json$/i.test(lowerPath)
  ) {
    return false;
  }
  return !isResourceMetadataSidecarPath(lowerPath);
}

export function getMcpConfigMetadata(
  content: string,
  fallbackName: string,
): { name: string; description: string } {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    const serverMap =
      parsed.mcpServers && typeof parsed.mcpServers === "object"
        ? (parsed.mcpServers as Record<string, unknown>)
        : parsed.servers && typeof parsed.servers === "object"
          ? (parsed.servers as Record<string, unknown>)
          : {};
    const serverNames = Object.keys(serverMap);
    if (serverNames.length === 1) {
      return {
        name: serverNames[0],
        description: `MCP configuration for ${serverNames[0]}`,
      };
    }
    if (serverNames.length > 1) {
      return {
        name: fallbackName,
        description: `MCP configuration for ${serverNames.join(", ")}`,
      };
    }
  } catch {
    // Non-JSON MCP resources use the path-derived fallback.
  }
  return {
    name: fallbackName,
    description: `MCP configuration for ${fallbackName}`,
  };
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

const PLUGIN_MARKER_DIRECTORY_NAMES = [
  ".claude-plugin",
  ".codex-plugin",
  ".cursor-plugin",
  ".plugin",
];

const PLUGIN_MARKER_DIRECTORY_PATHS = [
  ...PLUGIN_MARKER_DIRECTORY_NAMES,
  ".github/plugin",
];

const PLUGIN_MARKER_MANIFEST_FILE_NAMES = ["plugin.json", "marketplace.json"];

const PLUGIN_ROOT_MANIFEST_FILE_NAMES = [
  "plugin.json",
  "gemini-extension.json",
  "apm.yml",
  "apm.yaml",
];

const PLUGIN_ROOT_MANIFEST_FILE_NAME_SET = new Set(
  PLUGIN_ROOT_MANIFEST_FILE_NAMES,
);

function toRegExpAlternation(values: string[]): string {
  return values
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
}

const PLUGIN_MARKER_MANIFEST_PATTERN = new RegExp(
  `^(.*?)(?:^|/)(?:${toRegExpAlternation(PLUGIN_MARKER_DIRECTORY_PATHS)})/(?:${toRegExpAlternation(PLUGIN_MARKER_MANIFEST_FILE_NAMES)})$`,
  "i",
);

/**
 * Globs, relative to a directory that holds one folder per installed plugin, matching
 * only the manifest forms `isPluginManifestPath` accepts. Child resources of a plugin
 * are deliberately out of reach so a scan cannot list them a second time under the
 * root of their own kind.
 */
export function getPluginManifestScanGlobs(): string[] {
  return [
    `*/{${PLUGIN_ROOT_MANIFEST_FILE_NAMES.join(",")}}`,
    `*/{${PLUGIN_MARKER_DIRECTORY_NAMES.join(",")}}/{${PLUGIN_MARKER_MANIFEST_FILE_NAMES.join(",")}}`,
    `*/.github/plugin/{${PLUGIN_MARKER_MANIFEST_FILE_NAMES.join(",")}}`,
  ];
}

export function isPluginManifestPath(lowerPath: string): boolean {
  const fileName = lowerPath.slice(lowerPath.lastIndexOf("/") + 1);
  return (
    PLUGIN_ROOT_MANIFEST_FILE_NAME_SET.has(fileName) ||
    PLUGIN_MARKER_MANIFEST_PATTERN.test(lowerPath)
  );
}

/**
 * One package can ship several accepted manifests at once: `awslabs/agent-plugins`
 * ships `.claude-plugin/` and `.codex-plugin/` side by side, and a package may carry a
 * root `plugin.json` next to `gemini-extension.json` or `apm.yml`. Every scope picks
 * the manifest that comes first in this list, so a package is one row with the same
 * manifest everywhere. Marker forms rank above root forms because a marker directory
 * exists only to declare the plugin, while a root file name can also belong to an
 * unrelated tool.
 */
export function getPluginManifestPrecedence(): string[] {
  const markerForms = PLUGIN_MARKER_DIRECTORY_PATHS.flatMap((directoryName) =>
    PLUGIN_MARKER_MANIFEST_FILE_NAMES.map(
      (fileName) => `${directoryName}/${fileName}`,
    ),
  );
  return [...markerForms, ...PLUGIN_ROOT_MANIFEST_FILE_NAMES];
}

const PLUGIN_MANIFEST_PRECEDENCE_RANK = new Map(
  getPluginManifestPrecedence().map((form, index) => [form, index]),
);

/**
 * The precedence-bearing tail of a manifest path: `.claude-plugin/plugin.json` for a
 * marker form, the file name for a root form. Everything above it identifies the
 * package rather than the manifest form, so it must not affect the ranking.
 */
function getPluginManifestForm(manifestPath: string): string | undefined {
  const lowerPath = manifestPath.replace(/\\/g, "/").toLowerCase();
  if (!isPluginManifestPath(lowerPath)) {
    return undefined;
  }
  for (const markerPath of PLUGIN_MARKER_DIRECTORY_PATHS) {
    for (const fileName of PLUGIN_MARKER_MANIFEST_FILE_NAMES) {
      const form = `${markerPath}/${fileName}`;
      if (lowerPath === form || lowerPath.endsWith(`/${form}`)) {
        return form;
      }
    }
  }
  return lowerPath.slice(lowerPath.lastIndexOf("/") + 1);
}

/**
 * Orders two manifests of the same package. Ties fall back to the path itself so the
 * choice never depends on directory iteration order.
 */
export function comparePluginManifestPrecedence(
  manifestPathA: string,
  manifestPathB: string,
): number {
  const rank = (manifestPath: string): number => {
    const form = getPluginManifestForm(manifestPath);
    const index =
      form === undefined
        ? undefined
        : PLUGIN_MANIFEST_PRECEDENCE_RANK.get(form);
    return index ?? Number.MAX_SAFE_INTEGER;
  };
  const rankDifference = rank(manifestPathA) - rank(manifestPathB);
  if (rankDifference !== 0) {
    return rankDifference;
  }
  const normalizedA = manifestPathA.replace(/\\/g, "/").toLowerCase();
  const normalizedB = manifestPathB.replace(/\\/g, "/").toLowerCase();
  return normalizedA < normalizedB ? -1 : normalizedA > normalizedB ? 1 : 0;
}

/**
 * The one manifest that represents a package whose directory holds several of them.
 */
export function selectPreferredPluginManifest<T>(
  candidates: readonly T[],
  toManifestPath: (candidate: T) => string,
): T | undefined {
  let preferred: T | undefined;
  for (const candidate of candidates) {
    if (
      preferred === undefined ||
      comparePluginManifestPrecedence(
        toManifestPath(candidate),
        toManifestPath(preferred),
      ) < 0
    ) {
      preferred = candidate;
    }
  }
  return preferred;
}

/**
 * Collapses manifests that resolve to the same plugin root down to the preferred one,
 * keeping the position of the first manifest seen for that root. Anything that is not
 * a plugin manifest passes through untouched.
 */
/**
 * Two plugin roots are the same package only when the filesystem says so. Folding
 * case everywhere would merge `plugins/demo` and `plugins/Demo` on Linux, where
 * they are two different installed packages. The platform test is inlined because
 * many plain-Node loaders read this module directly and must not need a stub for
 * another `src/` file.
 */
export function toPluginRootIdentityKey(
  pluginRootFsPath: string,
  platform: string = process.platform,
): string {
  const normalized = pluginRootFsPath.replace(/\\/g, "/");
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function dedupePluginManifestsByRoot<T>(
  items: readonly T[],
  toManifestFsPath: (item: T) => string,
): T[] {
  const deduped: T[] = [];
  const indexByPluginRoot = new Map<string, number>();
  for (const item of items) {
    const manifestFsPath = toManifestFsPath(item);
    const pluginRoot = getPluginRootFsPathFromManifestPath(manifestFsPath);
    if (pluginRoot === undefined) {
      deduped.push(item);
      continue;
    }
    const rootKey = toPluginRootIdentityKey(pluginRoot);
    const existingIndex = indexByPluginRoot.get(rootKey);
    if (existingIndex === undefined) {
      indexByPluginRoot.set(rootKey, deduped.length);
      deduped.push(item);
      continue;
    }
    if (
      comparePluginManifestPrecedence(
        manifestFsPath,
        toManifestFsPath(deduped[existingIndex]),
      ) < 0
    ) {
      deduped[existingIndex] = item;
    }
  }
  return deduped;
}

/**
 * A marker directory holds the manifest of the plugin rooted at the directory ABOVE it,
 * so it is never a plugin root of its own.
 */
export function isPluginMarkerDirectoryName(name: string): boolean {
  return PLUGIN_MARKER_DIRECTORY_NAMES.includes(name.toLowerCase());
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

/**
 * Filesystem variant of `getPluginRootFromManifestPath`: the result is a prefix of the
 * input, so an absolute prefix such as `/` or `D:\` and the platform separator both
 * survive. Returns `undefined` when the path is not a manifest, or when no directory
 * sits above the manifest, so a caller deleting the root recursively can never climb
 * out of the manifest's own folder.
 */
export function getPluginRootFsPathFromManifestPath(
  manifestFsPath: string,
): string | undefined {
  if (typeof manifestFsPath !== "string" || manifestFsPath.length === 0) {
    return undefined;
  }
  const lowerNormalizedPath = manifestFsPath.replace(/\\/g, "/").toLowerCase();
  if (!isPluginManifestPath(lowerNormalizedPath)) {
    return undefined;
  }

  // Marker manifests describe the directory above the marker path. The Copilot
  // `.github/plugin/` form is one level deeper than `.claude-plugin/` and friends.
  const markerForm = PLUGIN_MARKER_DIRECTORY_PATHS.find((markerPath) =>
    PLUGIN_MARKER_MANIFEST_FILE_NAMES.some((fileName) => {
      const suffix = `${markerPath}/${fileName}`;
      return (
        lowerNormalizedPath === suffix ||
        lowerNormalizedPath.endsWith(`/${suffix}`)
      );
    }),
  );
  const levelsAboveManifest = markerForm ? markerForm.split("/").length + 1 : 1;
  let cutIndex = manifestFsPath.length;
  for (let level = 0; level < levelsAboveManifest; level += 1) {
    cutIndex = lowerNormalizedPath.lastIndexOf("/", cutIndex - 1);
    if (cutIndex <= 0) {
      return undefined;
    }
  }
  const rootFsPath = manifestFsPath.slice(0, cutIndex);
  return isTooShallowForRecursiveDelete(rootFsPath) ? undefined : rootFsPath;
}

/**
 * A drive specifier like `D:` is drive-RELATIVE on Windows and resolves to that
 * drive's current directory, so returning one as a plugin root would point a
 * recursive delete somewhere unrelated. Filesystem and share roots are refused
 * for the same reason, and so is any relative path, which resolves against the
 * process working directory rather than the install location.
 */
function isTooShallowForRecursiveDelete(fsPath: string): boolean {
  const normalized = fsPath.replace(/\\/g, "/");
  const isAbsolute = /^\//.test(normalized) || /^[A-Za-z]:\//.test(normalized);
  return (
    normalized.length === 0 ||
    !isAbsolute ||
    /^[A-Za-z]:\/?$/.test(normalized) ||
    /^\/+$/.test(normalized) ||
    /^\/\/[^/]+\/[^/]+\/?$/.test(normalized)
  );
}

export const AGENT_PLUGINS_MANIFEST_SCHEMA =
  "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
export const AGENT_PLUGINS_MCP_SCHEMA =
  "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

export function getAgentPluginsMcpSchemaIssue(
  filePath: string,
  content: string,
  agentPluginRoots: ReadonlySet<string>,
): string | undefined {
  const normalizedPath = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const pluginRoot = Array.from(agentPluginRoots).find((root) => {
    const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
    const relativePath =
      normalizedRoot === "."
        ? normalizedPath
        : normalizedPath.startsWith(`${normalizedRoot}/`)
          ? normalizedPath.slice(normalizedRoot.length + 1)
          : undefined;
    return relativePath === "mcp.json";
  });
  if (!pluginRoot) {
    return undefined;
  }
  let config: Record<string, unknown>;
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return "mcp.json must be a JSON object";
    }
    config = parsed as Record<string, unknown>;
  } catch {
    return "mcp.json is not valid JSON";
  }
  if (config.$schema !== AGENT_PLUGINS_MCP_SCHEMA) {
    return `mcp.json must declare ${AGENT_PLUGINS_MCP_SCHEMA} to match ${AGENT_PLUGINS_MANIFEST_SCHEMA}`;
  }
  return undefined;
}
export const AGENT_PLUGINS_MANIFEST_KIND = "agent-plugins";

export const AGENT_PLUGINS_NAME_MAX_LENGTH = 64;

export interface PluginManifestInfo {
  pluginRoot: string;
  pluginManifestPath: string;
  pluginManifestKind: string;
}

export function getPluginManifestKindFromPath(
  filePath: string,
): string | undefined {
  const lowerPath = filePath.toLowerCase().replace(/\\/g, "/");
  if (lowerPath.endsWith(".claude-plugin/plugin.json")) return "claude-plugin";
  if (lowerPath.endsWith(".codex-plugin/plugin.json")) return "codex-plugin";
  if (lowerPath.endsWith(".cursor-plugin/plugin.json")) return "cursor-plugin";
  if (lowerPath.endsWith(".plugin/plugin.json")) return "plugin";
  if (lowerPath.endsWith("marketplace.json")) return "marketplace";
  if (lowerPath.endsWith("gemini-extension.json")) return "gemini-extension";
  if (lowerPath.endsWith("apm.yml") || lowerPath.endsWith("apm.yaml")) {
    return "apm";
  }
  if (lowerPath.endsWith("plugin.json")) return "plugin";
  return undefined;
}

function shouldPreferPluginManifestInfo(
  candidate: PluginManifestInfo,
  existing: PluginManifestInfo | undefined,
): boolean {
  if (!existing) return true;
  const candidateWeight =
    candidate.pluginManifestKind === "marketplace" ? 1 : 0;
  const existingWeight = existing.pluginManifestKind === "marketplace" ? 1 : 0;
  if (candidateWeight !== existingWeight)
    return candidateWeight < existingWeight;
  return (
    candidate.pluginManifestPath.length < existing.pluginManifestPath.length
  );
}

export function getPluginManifestInfoByRoot(
  paths: readonly string[],
): Map<string, PluginManifestInfo> {
  const infos = new Map<string, PluginManifestInfo>();
  for (const filePath of paths) {
    if (detectResourceKindFromPath(filePath) !== "plugin") continue;
    const pluginRoot = getPluginRootFromManifestPath(filePath) || ".";
    const pluginManifestKind = getPluginManifestKindFromPath(filePath);
    if (!pluginManifestKind) continue;
    const candidate = {
      pluginRoot,
      pluginManifestPath: filePath.replace(/\\/g, "/"),
      pluginManifestKind,
    };
    if (shouldPreferPluginManifestInfo(candidate, infos.get(pluginRoot))) {
      infos.set(pluginRoot, candidate);
    }
  }
  return infos;
}

export function getOwningPluginManifestInfo(
  filePath: string,
  pluginManifestInfoByRoot: ReadonlyMap<string, PluginManifestInfo>,
): PluginManifestInfo | undefined {
  const normalizedPath = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const entries = Array.from(pluginManifestInfoByRoot.entries()).sort(
    ([left], [right]) => right.length - left.length,
  );
  for (const [pluginRoot, info] of entries) {
    if (normalizedPath === info.pluginManifestPath) continue;
    const normalizedRoot = pluginRoot.replace(/\\/g, "/").replace(/\/+$/, "");
    const relativePath =
      normalizedRoot === "."
        ? normalizedPath
        : normalizedPath.startsWith(`${normalizedRoot}/`)
          ? normalizedPath.slice(normalizedRoot.length + 1)
          : undefined;
    if (!relativePath) continue;
    if (detectPluginChildResourceKind(relativePath) || pluginRoot === ".") {
      return info;
    }
  }
  return undefined;
}

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

export function qualifyPluginOwnedResourceName(
  kind: ResourceKind,
  name: string,
  pluginInfo: PluginManifestInfo | undefined,
): string {
  if (
    kind !== "hook" ||
    !pluginInfo ||
    pluginInfo.pluginRoot === "." ||
    (name !== "hooks" && name !== "hooks.json")
  ) {
    return name;
  }
  const pluginName = pluginInfo.pluginRoot
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .split("/")
    .pop();
  return pluginName ? `${pluginName}-hooks` : name;
}

export function getPluginOwnedHookInstallFileName(input: {
  kind?: ResourceKind;
  source?: string;
  pluginRoot?: string;
  resourcePath?: string;
  fileName: string;
}): string {
  if (
    input.kind !== "hook" ||
    !isHookConfigFilePath(input.resourcePath || input.fileName) ||
    !input.pluginRoot
  ) {
    return input.fileName;
  }
  const pluginName =
    input.pluginRoot === "."
      ? input.source
      : input.pluginRoot
          .replace(/\\/g, "/")
          .replace(/\/+$/, "")
          .split("/")
          .pop();
  const sanitizedPluginName = pluginName
    ?.toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[()[\]{}]/g, "")
    .replace(/[^a-z0-9\-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return sanitizedPluginName
    ? `${sanitizedPluginName}-${input.fileName}`
    : input.fileName;
}

export function getPluginOwnedInstallFileName(input: {
  kind?: ResourceKind;
  pluginRoot?: string;
  fileName: string;
}): string {
  if (
    !input.pluginRoot ||
    input.pluginRoot === "." ||
    (input.kind !== "agent" &&
      input.kind !== "instruction" &&
      input.kind !== "prompt")
  ) {
    return input.fileName;
  }
  const pluginName = input.pluginRoot
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .split("/")
    .pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  const safeFileName = pathBasename(input.fileName);
  return pluginName && safeFileName
    ? `${pluginName}-${safeFileName}`
    : input.fileName;
}

function pathBasename(fileName: string): string {
  return fileName.replace(/\\/g, "/").split("/").pop() || "";
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
    // The installer passes the plugin root while a scanner passes the manifest
    // it found, so normalize here rather than at each call site.
    const rootFromManifest =
      getPluginRootFsPathFromManifestPath(resourcePath) ?? resourcePath;
    return `${rootFromManifest.replace(/\\/g, "/").replace(/\/+$/g, "")}/.resource-ninja.json`;
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
