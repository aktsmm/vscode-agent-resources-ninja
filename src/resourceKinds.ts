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
  const pluginPrefix = "(?:\\.github/)?plugins/[^/]+/";
  if (new RegExp(`^(?:${pluginPrefix})?rules/[^/]+\\.mdc$`).test(lowerPath)) {
    return "cursor-rule";
  }
  if (new RegExp(`^${pluginPrefix}agents/[^/]+\\.md$`).test(lowerPath)) {
    return "agent";
  }
  if (new RegExp(`^${pluginPrefix}instructions/[^/]+\\.md$`).test(lowerPath)) {
    return "instruction";
  }
  if (new RegExp(`^${pluginPrefix}prompts/[^/]+\\.md$`).test(lowerPath)) {
    return "prompt";
  }
  if (new RegExp(`^${pluginPrefix}hooks/[^/]+/readme\\.md$`).test(lowerPath)) {
    return "hook";
  }
  if (isHookConfigFilePath(lowerPath)) {
    return "hook";
  }
  if (
    new RegExp(
      `^${pluginPrefix}(?:mcp\\.json|\\.vscode/mcp\\.json|mcp/[^/]+\\.json)$`,
    ).test(lowerPath)
  ) {
    return "mcp";
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
  if (isHookConfigFilePath(lowerPath)) {
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

function isResourceMetadataSidecarPath(lowerPath: string): boolean {
  return (
    lowerPath.endsWith("/.skill-meta.json") ||
    lowerPath.endsWith("/.resource-ninja.json") ||
    lowerPath.endsWith(".resource-ninja.json")
  );
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

function isPluginManifestPath(lowerPath: string): boolean {
  return (
    lowerPath === "plugin.json" ||
    lowerPath === "gemini-extension.json" ||
    lowerPath === "apm.yml" ||
    lowerPath === "apm.yaml" ||
    /(^|\/)\.(?:claude-plugin|codex-plugin|cursor-plugin|plugin)\/(?:plugin|marketplace)\.json$/.test(
      lowerPath,
    )
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

  if (
    lowerPath === "plugin.json" ||
    lowerPath === "gemini-extension.json" ||
    lowerPath === "apm.yml" ||
    lowerPath === "apm.yaml"
  ) {
    return ".";
  }

  const markerMatch = normalizedPath.match(
    /^(.*?)(?:^|\/)\.(?:claude-plugin|codex-plugin|cursor-plugin|plugin)\/(?:plugin|marketplace)\.json$/i,
  );
  if (!markerMatch) {
    return ".";
  }
  const root = markerMatch[1].replace(/\/+$/, "");
  return root || ".";
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
