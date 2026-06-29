#!/usr/bin/env node
/**
 * プリセットソースからスキルインデックスを更新するスクリプト
 * Usage: node scripts/update-preset-index.js
 *
 * 環境変数:
 *   GITHUB_TOKEN - GitHub API トークン（レート制限回避のため推奨）
 */

const fs = require("fs");
const path = require("path");

const INDEX_PATH = path.join(__dirname, "..", "resources", "skill-index.json");
const FETCH_TIMEOUT = 15000;
const CONCURRENCY = 5;
const SOURCE_FILTER = (
  process.env.RESOURCE_NINJA_SOURCES ||
  process.env.SKILL_NINJA_SOURCES ||
  ""
)
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

// GitHub API トークン（環境変数から取得）
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

function assertIndexShape(index, label = "resource index") {
  for (const fieldName of ["sources", "skills", "categories"]) {
    if (!Array.isArray(index?.[fieldName])) {
      throw new Error(`${label} field "${fieldName}" must be an array`);
    }
  }
}

function getLocalDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * タイムアウト付き fetch
 */
async function fetchWithTimeout(url, options = {}, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * GitHub API リクエスト
 */
async function githubFetch(url) {
  const headers = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "ResourceNinja-IndexUpdater",
  };
  if (GITHUB_TOKEN) {
    headers["Authorization"] = `token ${GITHUB_TOKEN}`;
  }
  const response = await fetchWithTimeout(url, { headers });
  if (response.status === 403 && headers.Authorization) {
    const bodyText = await response.clone().text();
    if (
      bodyText.includes("forbids access via a personal access tokens (classic)")
    ) {
      console.warn(
        "  ⚠️  Retrying without token because the repository rejects this classic PAT policy",
      );
      const retryHeaders = {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "ResourceNinja-IndexUpdater",
      };
      return fetchWithTimeout(url, { headers: retryHeaders });
    }
  }
  return response;
}

function unquoteYamlValue(value) {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function stripYamlInlineComment(value) {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let bracketDepth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      continue;
    }

    if (char === "[") {
      bracketDepth += 1;
      continue;
    }

    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (char === "#" && bracketDepth === 0) {
      const previousChar = index > 0 ? value[index - 1] : "";
      if (index === 0 || /\s/.test(previousChar)) {
        return value.slice(0, index).trimEnd();
      }
    }
  }

  return value.trimEnd();
}

function parseInlineYamlArray(value) {
  const match = stripYamlInlineComment(value).match(/^\[(.*)\]$/);
  if (!match) {
    return [];
  }
  return match[1]
    .split(",")
    .map((item) => unquoteYamlValue(item))
    .filter(Boolean);
}

function getBlockScalarStyle(value) {
  const match = value.match(
    /^([>|])(?:([1-9])([+-])?|([+-])([1-9])?)?(?:\s+#.*)?$/,
  );
  return match ? match[1] : null;
}

function parseTopLevelFrontmatter(frontmatter) {
  const values = new Map();
  const lines = frontmatter.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyMatch) {
      continue;
    }

    const [, key, rawValue] = keyMatch;
    const trimmedValue = rawValue.trim();

    const blockScalarStyle = getBlockScalarStyle(trimmedValue);
    if (blockScalarStyle) {
      const blockLines = [];
      let blockIndent = null;

      while (index + 1 < lines.length) {
        const nextLine = lines[index + 1];
        if (!nextLine.trim()) {
          blockLines.push("");
          index += 1;
          continue;
        }

        const indentMatch = nextLine.match(/^(\s+)/);
        if (!indentMatch) {
          break;
        }

        const indentLength = indentMatch[1].length;
        if (blockIndent === null) {
          blockIndent = indentLength;
        }
        if (indentLength < blockIndent) {
          break;
        }

        blockLines.push(nextLine.slice(blockIndent));
        index += 1;
      }

      const joined =
        blockScalarStyle === ">" ? blockLines.join(" ") : blockLines.join("\n");
      values.set(key, joined.trim());
      continue;
    }

    values.set(key, unquoteYamlValue(stripYamlInlineComment(trimmedValue)));
  }

  return values;
}

/**
 * リポジトリのデフォルトブランチを取得
 */
async function getDefaultBranch(owner, repo) {
  const url = `https://api.github.com/repos/${owner}/${repo}`;
  const response = await githubFetch(url);
  if (!response.ok) {
    // フォールバック
    return "main";
  }
  const data = await response.json();
  return data.default_branch || "main";
}

/**
 * リポジトリ内の対応リソースファイルを検索
 */
async function scanRepositoryForSkills(source) {
  const match = source.url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) {
    console.error(`  ❌ Invalid URL: ${source.url}`);
    return [];
  }

  const [, owner, repo] = match;
  const repoName = repo.replace(/\.git$/, "");

  // ブランチを決定
  const branch = source.branch || (await getDefaultBranch(owner, repoName));
  console.log(`  📦 ${owner}/${repoName} (branch: ${branch})`);

  // リポジトリのツリーを取得
  const treeUrl = `https://api.github.com/repos/${owner}/${repoName}/git/trees/${branch}?recursive=1`;
  const response = await githubFetch(treeUrl);

  if (!response.ok) {
    if (response.status === 404) {
      // 別のブランチを試す
      const fallbackBranch = branch === "main" ? "master" : "main";
      const fallbackUrl = `https://api.github.com/repos/${owner}/${repoName}/git/trees/${fallbackBranch}?recursive=1`;
      const fallbackResponse = await githubFetch(fallbackUrl);
      if (fallbackResponse.ok) {
        const data = await fallbackResponse.json();
        return await processTree(data, owner, repoName, fallbackBranch, source);
      }
    }
    throw new Error(`Failed to fetch tree: ${response.status}`);
  }

  const data = await response.json();
  return await processTree(data, owner, repoName, branch, source);
}

/**
 * パスからリソース種別を判定
 */
function detectResourceKindFromPath(resourcePath) {
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

function isResourceMetadataSidecarPath(lowerPath) {
  return (
    lowerPath.endsWith("/.skill-meta.json") ||
    lowerPath.endsWith("/.resource-ninja.json") ||
    lowerPath.endsWith(".resource-ninja.json")
  );
}

function isHookConfigFilePath(resourcePath) {
  const lowerPath = resourcePath.toLowerCase().replace(/\\/g, "/");
  if (!/(^|\/)(?:\.github\/)?hooks\/[^/]+\.json$/i.test(lowerPath)) {
    return false;
  }
  return !isResourceMetadataSidecarPath(lowerPath);
}

function isPluginManifestPath(lowerPath) {
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

function getPluginRootFromManifestPath(resourcePath) {
  const normalizedPath = String(resourcePath)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
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
  return markerMatch[1].replace(/\/+$/, "") || ".";
}

function normalizeResourcePath(resourcePath) {
  return String(resourcePath)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .toLowerCase();
}

function getSkillRootDirectoryFromPath(resourcePath) {
  const normalizedPath = normalizeResourcePath(resourcePath);
  if (normalizedPath !== "skill.md" && !normalizedPath.endsWith("/skill.md")) {
    return undefined;
  }
  const slashIndex = normalizedPath.lastIndexOf("/");
  return slashIndex === -1 ? "" : normalizedPath.slice(0, slashIndex);
}

function getSkillRootDirectoriesFromPaths(resourcePaths) {
  const rootDirectories = new Set();
  for (const resourcePath of resourcePaths) {
    const rootDirectory = getSkillRootDirectoryFromPath(resourcePath);
    if (rootDirectory !== undefined) {
      rootDirectories.add(rootDirectory);
    }
  }
  return rootDirectories;
}

function isNestedResourcePathUnderSkillRoot(
  resourcePath,
  kind,
  skillRootDirectories,
) {
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

function getResourceInstallPath(filePath, kind) {
  const normalizedPath = filePath.replace(/\\/g, "/");
  if (kind === "skill") {
    return normalizedPath.replace(/\/SKILL\.md$/i, "");
  }
  if (kind === "plugin") {
    return getPluginRootFromManifestPath(normalizedPath) || normalizedPath;
  }
  return normalizedPath;
}

function getFallbackResourceName(filePath, kind) {
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
  const fallbackName = fileName
    .replace(/\.(agent|instructions|prompt)\.md$/i, "")
    .replace(/\.mdc$/i, "")
    .replace(/\.mcp\.json$/i, "")
    .replace(/\.json$/i, "");
  return fallbackName || fileName.replace(/^\./, "").replace(/\.json$/i, "");
}

function getDefaultResourceCategories(kind) {
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

function getResourceKind(resource) {
  return resource.kind || "skill";
}

function getPluginManifestKind(filePath) {
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

function stringifyManifestValue(value) {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value && typeof value === "object") {
    const parts = [value.name, value.url, value.email]
      .map((part) => (typeof part === "string" ? part.trim() : ""))
      .filter(Boolean);
    return parts.length
      ? parts.join(" <") + (parts.length > 1 ? ">" : "")
      : undefined;
  }
  return undefined;
}

function parseSimpleYamlObject(content) {
  const values = {};
  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (!match) continue;
    values[match[1]] = unquoteYamlValue(stripYamlInlineComment(match[2]));
  }
  return values;
}

function parsePluginManifestMetadata(content, filePath) {
  const manifestKind = getPluginManifestKind(filePath);
  const pluginRoot = getPluginRootFromManifestPath(filePath) || ".";
  let manifest = {};
  try {
    manifest = JSON.parse(content);
  } catch {
    manifest = parseSimpleYamlObject(content);
  }

  const interfaceMetadata =
    manifest.interface && typeof manifest.interface === "object"
      ? manifest.interface
      : {};
  const name =
    stringifyManifestValue(manifest.name) ||
    stringifyManifestValue(interfaceMetadata.displayName) ||
    getFallbackResourceName(filePath, "plugin");
  const description =
    stringifyManifestValue(manifest.description) ||
    stringifyManifestValue(interfaceMetadata.shortDescription) ||
    stringifyManifestValue(interfaceMetadata.longDescription) ||
    `Plugin manifest for ${name}`;

  return {
    name,
    description,
    description_ja: "",
    categories: ["plugins"],
    license: stringifyManifestValue(manifest.license),
    author: stringifyManifestValue(manifest.author),
    version: stringifyManifestValue(manifest.version),
    pluginRoot,
    pluginManifestPath: filePath.replace(/\\/g, "/"),
    pluginManifestKind: manifestKind,
  };
}

function createResourceKey(resource) {
  return `${resource.source}:${getResourceKind(resource)}:${String(
    resource.path || resource.name,
  ).toLowerCase()}`;
}

function createResourceDisplayKey(resource) {
  if (getResourceKind(resource) === "plugin") {
    return [
      resource.source,
      "plugin",
      resource.pluginRoot || resource.path,
    ].join(":");
  }
  const pluginId = getPluginIdFromPath(resource.path);
  const description = String(resource.description || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  if (!description) {
    return createResourceKey(resource);
  }

  return [
    pluginId ? `plugin:${pluginId}` : "resource",
    resource.source,
    getResourceKind(resource),
    String(resource.name || "")
      .trim()
      .toLowerCase(),
    description,
  ].join(":");
}

function getPluginIdFromPath(resourcePath) {
  const normalizedPath = String(resourcePath || "").replace(/\\/g, "/");
  const match = normalizedPath.match(/^plugins\/([^/]+)\//i);
  if (match?.[1]) {
    return match[1];
  }
  return normalizedPath.match(/^\.github\/plugins\/([^/]+)\//i)?.[1];
}

function shouldPreferResource(candidate, existing) {
  if (
    getResourceKind(candidate) === "plugin" &&
    getResourceKind(existing) === "plugin"
  ) {
    const candidateWeight =
      candidate.pluginManifestKind === "marketplace" ? 1 : 0;
    const existingWeight =
      existing.pluginManifestKind === "marketplace" ? 1 : 0;
    if (candidateWeight !== existingWeight)
      return candidateWeight < existingWeight;

    const candidateManifestPath = String(
      candidate.pluginManifestPath || candidate.path || "",
    );
    const existingManifestPath = String(
      existing.pluginManifestPath || existing.path || "",
    );
    if (candidateManifestPath.length !== existingManifestPath.length) {
      return candidateManifestPath.length < existingManifestPath.length;
    }
  }
  const candidatePath = String(candidate.path || "");
  const existingPath = String(existing.path || "");
  const candidateIsPluginPath = candidatePath.startsWith("plugins/");
  const existingIsPluginPath = existingPath.startsWith("plugins/");

  if (candidateIsPluginPath !== existingIsPluginPath) {
    return !candidateIsPluginPath;
  }

  return candidatePath.length < existingPath.length;
}

function normalizePrefix(prefix) {
  return String(prefix)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function pathMatchesPrefix(filePath, prefix) {
  return filePath === prefix || filePath.startsWith(`${prefix}/`);
}

function isResourcePathAllowed(filePath, source) {
  const normalizedPath = normalizePrefix(filePath);
  const includePaths = (source.includePaths || []).map(normalizePrefix);
  const excludePaths = (source.excludePaths || []).map(normalizePrefix);

  if (
    includePaths.length > 0 &&
    !includePaths.some((prefix) => pathMatchesPrefix(normalizedPath, prefix))
  ) {
    return false;
  }

  return !excludePaths.some((prefix) =>
    pathMatchesPrefix(normalizedPath, prefix),
  );
}

function getPluginRootsFromPaths(paths) {
  return Array.from(
    new Set(
      paths
        .map((filePath) => getPluginRootFromManifestPath(filePath))
        .filter(Boolean),
    ),
  ).sort((a, b) => b.length - a.length);
}

function shouldPreferPluginManifestInfo(candidate, existing) {
  if (!existing) return true;
  const candidateWeight =
    candidate.pluginManifestKind === "marketplace" ? 1 : 0;
  const existingWeight = existing.pluginManifestKind === "marketplace" ? 1 : 0;
  if (candidateWeight !== existingWeight) {
    return candidateWeight < existingWeight;
  }
  return (
    candidate.pluginManifestPath.length < existing.pluginManifestPath.length
  );
}

function getPluginManifestInfoByRoot(paths) {
  const pluginInfos = new Map();

  for (const filePath of paths) {
    const kind = detectResourceKindFromPath(filePath);
    if (kind !== "plugin") {
      continue;
    }

    const pluginRoot = getPluginRootFromManifestPath(filePath) || ".";
    const pluginInfo = {
      pluginRoot,
      pluginManifestPath: filePath.replace(/\\/g, "/"),
      pluginManifestKind: getPluginManifestKind(filePath),
    };

    const existing = pluginInfos.get(pluginRoot);
    if (shouldPreferPluginManifestInfo(pluginInfo, existing)) {
      pluginInfos.set(pluginRoot, pluginInfo);
    }
  }

  return pluginInfos;
}

function getRelativePathFromPluginRoot(filePath, pluginRoot) {
  const normalizedPath = String(filePath)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (pluginRoot === ".") {
    return normalizedPath;
  }
  const normalizedRoot = String(pluginRoot)
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  return normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : undefined;
}

function getOwningPluginManifestInfo(filePath, kind, pluginManifestInfoByRoot) {
  const normalizedPath = String(filePath)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");

  for (const [pluginRoot, pluginInfo] of pluginManifestInfoByRoot.entries()) {
    if (normalizedPath === pluginInfo.pluginManifestPath) {
      continue;
    }

    const relativePath = getRelativePathFromPluginRoot(
      normalizedPath,
      pluginRoot,
    );
    if (!relativePath) {
      continue;
    }

    const childKind = detectPluginChildResourceKind(relativePath);
    if (childKind || pluginRoot === ".") {
      return pluginInfo;
    }
  }

  return undefined;
}

function detectPluginChildResourceKind(relativePath) {
  const lowerPath = relativePath.toLowerCase();
  if (/^agents\/[^/]+\.md$/.test(lowerPath)) return "agent";
  if (/^instructions\/[^/]+\.md$/.test(lowerPath)) return "instruction";
  if (/^prompts\/[^/]+\.md$/.test(lowerPath)) return "prompt";
  if (/^rules\/[^/]+\.mdc$/.test(lowerPath)) return "cursor-rule";
  if (/^hooks\/[^/]+\/readme\.md$/.test(lowerPath)) return "hook";
  if (/^hooks\/[^/]+\.json$/.test(lowerPath)) return "hook";
  if (/^(?:mcp\.json|\.vscode\/mcp\.json|mcp\/[^/]+\.json)$/.test(lowerPath)) {
    return "mcp";
  }
  if (/^skills\/[^/]+\/skill\.md$/.test(lowerPath)) return "skill";
  return undefined;
}

function detectResourceKindWithPluginRoots(filePath, pluginRoots) {
  const kind = detectResourceKindFromPath(filePath);
  if (kind) return kind;

  for (const pluginRoot of pluginRoots) {
    const relativePath = getRelativePathFromPluginRoot(filePath, pluginRoot);
    if (!relativePath) continue;
    const childKind = detectPluginChildResourceKind(relativePath);
    if (childKind) return childKind;
  }

  return undefined;
}

/**
 * ツリーを処理してリソースを抽出
 */
async function processTree(data, owner, repoName, branch, source) {
  const allowedBlobFiles = data.tree.filter((item) => {
    if (item.type !== "blob") return false;
    if (!isResourcePathAllowed(item.path, source)) return false;
    return true;
  });
  const skillRootDirectories = getSkillRootDirectoriesFromPaths(
    allowedBlobFiles.map((item) => item.path),
  );
  const pluginManifestInfoByRoot = getPluginManifestInfoByRoot(
    allowedBlobFiles.map((item) => item.path),
  );
  const pluginRoots = Array.from(pluginManifestInfoByRoot.keys()).sort(
    (a, b) => b.length - a.length,
  );
  const resourceFiles = allowedBlobFiles.filter((item) => {
    const kind = detectResourceKindWithPluginRoots(item.path, pluginRoots);
    return (
      !!kind &&
      !isNestedResourcePathUnderSkillRoot(item.path, kind, skillRootDirectories)
    );
  });

  const kindCounts = resourceFiles.reduce((counts, item) => {
    const kind =
      detectResourceKindWithPluginRoots(item.path, pluginRoots) || "skill";
    counts[kind] = (counts[kind] || 0) + 1;
    return counts;
  }, {});
  console.log(
    `  📄 Found ${resourceFiles.length} resources (${Object.entries(kindCounts)
      .map(([kind, count]) => `${kind}: ${count}`)
      .join(", ")})`,
  );

  const skills = [];

  // 並列でリソース情報を取得
  const chunks = [];
  for (let i = 0; i < resourceFiles.length; i += CONCURRENCY) {
    chunks.push(resourceFiles.slice(i, i + CONCURRENCY));
  }

  for (const chunk of chunks) {
    const results = await Promise.all(
      chunk.map(async (file) => {
        try {
          const kind = detectResourceKindWithPluginRoots(
            file.path,
            pluginRoots,
          );
          if (!kind) return null;

          const pluginInfo =
            kind === "plugin"
              ? pluginManifestInfoByRoot.get(
                  getPluginRootFromManifestPath(file.path) || ".",
                )
              : getOwningPluginManifestInfo(
                  file.path,
                  kind,
                  pluginManifestInfoByRoot,
                );

          const rawUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/${branch}/${file.path}`;
          const response = await fetchWithTimeout(rawUrl);
          if (!response.ok) return null;

          const content = await response.text();
          const skillInfo = parseSkillFrontmatter(content, file.path, kind);
          if (!skillInfo) return null;

          return {
            kind,
            name: skillInfo.name,
            source: source.id,
            path: getResourceInstallPath(file.path, kind),
            categories:
              skillInfo.categories?.length > 0
                ? skillInfo.categories
                : getDefaultResourceCategories(kind),
            description: skillInfo.description || "",
            description_ja: skillInfo.description_ja,
            ...(kind === "skill" && skillInfo.standalone !== undefined
              ? { standalone: skillInfo.standalone }
              : {}),
            ...(kind === "skill" && skillInfo.requires?.length
              ? { requires: skillInfo.requires }
              : {}),
            ...(kind === "skill" && skillInfo.bundle
              ? { bundle: skillInfo.bundle }
              : {}),
            license: skillInfo.license,
            author: skillInfo.author,
            version: skillInfo.version,
            ...(pluginInfo
              ? {
                  pluginRoot: pluginInfo.pluginRoot,
                  pluginManifestPath: pluginInfo.pluginManifestPath,
                  pluginManifestKind: pluginInfo.pluginManifestKind,
                }
              : {}),
          };
        } catch (error) {
          return null;
        }
      }),
    );

    skills.push(...results.filter(Boolean));
  }

  return skills;
}

/**
 * リソースファイルの frontmatter を解析
 */
function parseSkillFrontmatter(content, filePath, kind = "skill") {
  const normalizedContent = content.replace(/\r\n/g, "\n");
  if (kind === "plugin") {
    return parsePluginManifestMetadata(normalizedContent, filePath);
  }
  // frontmatter を抽出
  const frontmatterMatch = normalizedContent.match(/^---\n([\s\S]*?)\n---/);

  let name = "";
  let description = "";
  let description_ja = "";
  let categories = [];
  let standalone;
  let requires;
  let bundle;
  let license;
  let author;
  let version;

  if (frontmatterMatch) {
    const frontmatter = parseTopLevelFrontmatter(frontmatterMatch[1]);
    const metadataMatch = frontmatterMatch[1].match(
      /metadata:[\s\S]*?author:\s*["']?([^"'\n]+)["']?/m,
    );
    name = frontmatter.get("name") || "";
    description = frontmatter.get("description") || "";
    description_ja = frontmatter.get("description_ja") || "";
    categories = parseInlineYamlArray(frontmatter.get("categories") || "[]");
    standalone =
      frontmatter.get("standalone") === "true"
        ? true
        : frontmatter.get("standalone") === "false"
          ? false
          : undefined;
    requires = parseInlineYamlArray(frontmatter.get("requires") || "[]");
    bundle = frontmatter.get("bundle") || undefined;
    license = frontmatter.get("license") || undefined;
    author = frontmatter.get("author") || metadataMatch?.[1]?.trim();
    version = frontmatter.get("version") || undefined;
  }

  if (!frontmatterMatch && kind === "mcp") {
    try {
      const parsed = JSON.parse(normalizedContent);
      const serverNames = Object.keys(parsed?.mcpServers || {});
      if (serverNames.length === 1) {
        name = serverNames[0];
        description = `MCP configuration for ${serverNames[0]}`;
      } else if (serverNames.length > 1) {
        name = getFallbackResourceName(filePath, kind);
        description = `MCP configuration for ${serverNames.join(", ")}`;
      }
    } catch {
      // Fall back to path-derived metadata for non-JSON MCP files.
    }
  }

  // name がない場合はパスから推測
  if (!name) {
    name = getFallbackResourceName(filePath, kind);
  }

  // # ヘッダーから name を取得
  if (!name) {
    const headerMatch = normalizedContent.match(/^#\s+(.+)$/m);
    if (headerMatch) {
      name = headerMatch[1].trim();
    }
  }

  if (!name) {
    return null;
  }

  // description がない場合は本文から抽出
  if (!description) {
    const lines = normalizedContent.split("\n");
    let inFrontmatter = false;
    for (const line of lines) {
      if (line.trim() === "---") {
        inFrontmatter = !inFrontmatter;
        continue;
      }
      if (inFrontmatter) continue;

      const trimmed = line.trim();
      if (
        trimmed &&
        !trimmed.startsWith("#") &&
        !trimmed.startsWith("Source:") &&
        !trimmed.startsWith("<!--")
      ) {
        description = trimmed.substring(0, 200);
        break;
      }
    }
  }

  return {
    name,
    description,
    description_ja,
    categories,
    standalone,
    requires: requires?.length ? requires : undefined,
    bundle,
    license,
    author,
    version,
  };
}

/**
 * メイン処理
 */
async function main() {
  console.log("🥷 Resource Ninja - Preset Index Updater\n");

  if (!GITHUB_TOKEN) {
    console.log("⚠️  GITHUB_TOKEN not set. Rate limit: 60 requests/hour");
    console.log("   Set GITHUB_TOKEN for 5000 requests/hour\n");
  } else {
    console.log("✅ GITHUB_TOKEN detected\n");
  }

  // 現在のインデックスを読み込む
  const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf-8"));
  assertIndexShape(index, INDEX_PATH);
  console.log(
    `📂 Current index: ${index.skills.length} resources, ${index.sources.length} sources\n`,
  );

  // 既存のスキルを保持（ソースIDでグループ化）
  const existingSkillsBySource = {};
  for (const skill of index.skills) {
    if (!existingSkillsBySource[skill.source]) {
      existingSkillsBySource[skill.source] = [];
    }
    existingSkillsBySource[skill.source].push(skill);
  }

  // 各ソースをスキャン
  const allSkills = [];
  const failures = [];
  const sourcesToUpdate =
    SOURCE_FILTER.length > 0
      ? index.sources.filter((source) => SOURCE_FILTER.includes(source.id))
      : index.sources;

  if (SOURCE_FILTER.length > 0 && sourcesToUpdate.length === 0) {
    const availableSourceIds = index.sources
      .map((source) => source.id)
      .join(", ");
    console.error(
      "\n❌ Preset index update aborted. RESOURCE_NINJA_SOURCES did not match any source IDs.",
    );
    console.error(`Requested: ${SOURCE_FILTER.join(", ")}`);
    console.error(`Available: ${availableSourceIds}`);
    process.exit(1);
  }

  for (const source of sourcesToUpdate) {
    console.log(`\n🔄 Updating: ${source.name}`);
    try {
      const skills = await scanRepositoryForSkills(source);

      // 既存のリソース情報をマージ（description_ja など）
      const existingSkills = existingSkillsBySource[source.id] || [];
      const existingMap = new Map(
        existingSkills.map((resource) => [
          createResourceKey(resource),
          resource,
        ]),
      );

      for (const skill of skills) {
        const existing = existingMap.get(createResourceKey(skill));
        if (existing) {
          // 既存の情報を保持
          if (!skill.description && existing.description) {
            skill.description = existing.description;
          }
          if (!skill.description_ja && existing.description_ja) {
            skill.description_ja = existing.description_ja;
          }
          if (
            skill.categories.length === 0 &&
            existing.categories?.length > 0
          ) {
            skill.categories = existing.categories;
          }
          if (
            skill.standalone === undefined &&
            existing.standalone !== undefined
          ) {
            skill.standalone = existing.standalone;
          }
          if (!skill.requires?.length && existing.requires?.length) {
            skill.requires = existing.requires;
          }
          if (!skill.bundle && existing.bundle) {
            skill.bundle = existing.bundle;
          }
          if (!skill.license && existing.license) {
            skill.license = existing.license;
          }
          if (!skill.author && existing.author) {
            skill.author = existing.author;
          }
          if (!skill.version && existing.version) {
            skill.version = existing.version;
          }
          if (!skill.pluginRoot && existing.pluginRoot) {
            skill.pluginRoot = existing.pluginRoot;
          }
          if (!skill.pluginManifestPath && existing.pluginManifestPath) {
            skill.pluginManifestPath = existing.pluginManifestPath;
          }
          if (!skill.pluginManifestKind && existing.pluginManifestKind) {
            skill.pluginManifestKind = existing.pluginManifestKind;
          }
        }
      }

      allSkills.push(...skills);
      console.log(`  ✅ ${skills.length} resources`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ❌ Error: ${message}`);
      failures.push({ source: source.name, message });
    }
  }

  // Preserve all-or-nothing semantics here.
  // Falling back to stale per-source data on failure makes bundled counts look fresh
  // while silently locking in degraded index contents.
  if (failures.length > 0) {
    console.error(
      "\n❌ Preset index update aborted. One or more sources failed:",
    );
    for (const failure of failures) {
      console.error(`  - ${failure.source}: ${failure.message}`);
    }
    console.error("\nNo changes were written to resources/skill-index.json.");
    process.exit(1);
  }

  if (SOURCE_FILTER.length > 0) {
    const untouchedSkills = index.skills.filter(
      (skill) => !SOURCE_FILTER.includes(skill.source),
    );
    allSkills.push(...untouchedSkills);
  }

  // UI上も同一に見える同名・同説明リソースは、配布向けの短いパスを優先して重複除去する。
  // 説明が空のものは従来通り source + kind + path で区別する。
  const uniqueSkillsMap = new Map();
  for (const skill of allSkills) {
    const key = createResourceDisplayKey(skill);
    const existing = uniqueSkillsMap.get(key);
    if (!existing || shouldPreferResource(skill, existing)) {
      uniqueSkillsMap.set(key, skill);
    }
  }
  const uniqueSkills = Array.from(uniqueSkillsMap.values());

  // ソート
  uniqueSkills.sort((a, b) => a.name.localeCompare(b.name));

  // インデックスを更新
  const newIndex = {
    version: index.version,
    lastUpdated: getLocalDateString(),
    sources: index.sources,
    categories: index.categories,
    bundles: index.bundles,
    skills: uniqueSkills,
  };

  // 保存
  fs.writeFileSync(
    INDEX_PATH,
    JSON.stringify(newIndex, null, 2) + "\n",
    "utf-8",
  );

  console.log(
    `\n✅ Updated: ${uniqueSkills.length} resources (was ${index.skills.length})`,
  );
  console.log(`📁 Saved to: ${INDEX_PATH}`);
}

main().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
