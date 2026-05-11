// スキルインデックスの管理
// プリインストールされたインデックスと更新可能なローカルインデックスを管理

import * as vscode from "vscode";
import {
  createGitHubHeaders,
  fetchGitHubWithOptionalAuthRetry,
} from "./githubFetch";
import { logger } from "./logger";
import {
  loadSharedStoresIntoSkillIndex,
  syncSharedStoresFromSkillIndex,
} from "./sharedResourceIndexStore";

export type ResourceKind =
  | "skill"
  | "agent"
  | "instruction"
  | "prompt"
  | "hook"
  | "mcp"
  | "plugin"
  | "cursor-rule";

export function getResourceKind(resource: Pick<Skill, "kind">): ResourceKind {
  return resource.kind || "skill";
}

export function getResourceKindLabel(
  kind: ResourceKind,
  isJa: boolean,
): string {
  switch (kind) {
    case "agent":
      return isJa ? "エージェント" : "Agent";
    case "instruction":
      return isJa ? "インストラクション" : "Instruction";
    case "prompt":
      return isJa ? "プロンプト" : "Prompt";
    case "hook":
      return isJa ? "フック" : "Hook";
    case "mcp":
      return "MCP";
    case "plugin":
      return isJa ? "プラグイン" : "Plugin";
    case "cursor-rule":
      return isJa ? "Cursor ルール" : "Cursor Rule";
    case "skill":
    default:
      return isJa ? "スキル" : "Skill";
  }
}

export function getResourceKindIcon(kind: ResourceKind): string {
  switch (kind) {
    case "agent":
      return "hubot";
    case "instruction":
      return "note";
    case "prompt":
      return "comment-discussion";
    case "hook":
      return "plug";
    case "mcp":
      return "server-process";
    case "plugin":
      return "extensions";
    case "cursor-rule":
      return "settings";
    case "skill":
    default:
      return "package";
  }
}

// スキル情報の型定義
export interface Skill {
  kind?: ResourceKind;
  name: string;
  source: string;
  path: string;
  remotePath?: string;
  categories: string[];
  description: string; // 英語説明（デフォルト）
  description_ja?: string; // 日本語説明（オプション）
  url?: string; // GitHub URL (for preview/favorites)
  rawUrl?: string; // Raw content URL
  stars?: number; // GitHub stars count
  owner?: string; // Repository owner (user or org)
  isOrg?: boolean; // Whether owner is an organization
  // Bundle/Framework 対応
  standalone?: boolean; // false = 単体では動作しない（デフォルト true）
  requires?: string[]; // 依存スキル名のリスト
  bundle?: string; // 所属 Bundle ID
  // 公式仕様に基づくメタデータ
  license?: string; // ライセンス（例: MIT, Apache-2.0）
  author?: string; // 作成者
  version?: string; // バージョン
  pluginRoot?: string; // Plugin 全体のリモートルート（manifest 由来 resource 用）
  pluginManifestPath?: string; // Plugin manifest のリモートパス
  pluginManifestKind?: string; // claude-plugin / cursor-plugin / gemini-extension など
}

/**
 * 言語に応じたスキルの説明を取得
 */
export function getLocalizedDescription(skill: Skill, isJa: boolean): string {
  if (isJa && skill.description_ja) {
    return skill.description_ja;
  }
  return skill.description;
}

/**
 * カテゴリーIDの配列を言語に応じた表示名に変換
 * @param categoryIds カテゴリーIDの配列
 * @param categories カテゴリーマスター
 * @param isJa 日本語表示するかどうか
 */
export function getLocalizedCategoryNames(
  categoryIds: string[],
  categories: Category[],
  isJa: boolean,
): string[] {
  return categoryIds.map((id) => {
    const category = categories.find((c) => c.id === id);
    if (!category) {
      return id; // マスターにない場合はIDをそのまま返す
    }
    if (isJa && category.name_ja) {
      return category.name_ja;
    }
    return category.name;
  });
}

// ソース情報の型定義
export interface Source {
  id: string;
  name: string;
  url: string;
  type: string;
  branch?: string; // 明示的なデフォルトブランチ（省略時は runtime で解決）
  includePaths?: string[]; // Only index resources under these path prefixes
  excludePaths?: string[]; // Exclude resources under these path prefixes
  description: string;
  description_ja?: string; // 日本語説明（オプション）
}

// カテゴリ情報の型定義
export interface Category {
  id: string;
  name: string;
  name_ja?: string;
  description: string;
  description_ja?: string;
}

// Bundle情報の型定義
export interface Bundle {
  id: string;
  name: string;
  source: string; // ソースID
  description: string;
  description_ja?: string;
  skills: string[]; // 含まれるスキル名のリスト
  installOrder?: string[]; // インストール順序（依存解決済み）
  coreSkill?: string; // コアスキル（最初にインストール必須）
  pluginId?: string; // Plugin-scoped install set の識別子
  mode?: string; // skill-only / plugin-managed-copy などの安全境界ラベル
  safetyBoundary?: string; // Hooks/executables/MCP などの扱い説明
}

// インデックス全体の型定義
export interface SkillIndex {
  version: string;
  lastUpdated: string;
  sources: Source[];
  skills: Skill[];
  categories: Category[];
  bundles?: Bundle[]; // Bundle一覧
}

function createSkillKey(
  skill: Pick<Skill, "source" | "name" | "kind">,
): string {
  return `${skill.source}:${getResourceKind(skill)}:${skill.name}`;
}

function createBundleKey(bundle: Pick<Bundle, "source" | "id">): string {
  return `${bundle.source}:${bundle.id}`;
}

function normalizeSkillIndex(index: Partial<SkillIndex>): SkillIndex {
  return {
    version: index.version || "1.0.0",
    lastUpdated: index.lastUpdated || new Date().toISOString().split("T")[0],
    sources: Array.isArray(index.sources) ? index.sources : [],
    skills: Array.isArray(index.skills) ? index.skills : [],
    categories: Array.isArray(index.categories) ? index.categories : [],
    bundles: Array.isArray(index.bundles) ? index.bundles : [],
  };
}

/**
 * スキルインデックスを読み込む
 * 1. globalStorageUri にローカルインデックスがあればそれを使用
 * 2. なければバンドルされたインデックスをコピーして使用
 * 3. バンドル版のバージョンが新しければソースをマージ
 */
export async function loadSkillIndex(
  context: vscode.ExtensionContext,
): Promise<SkillIndex> {
  const localIndexPath = vscode.Uri.joinPath(
    context.globalStorageUri,
    "skill-index.json",
  );

  // バンドルされたインデックスを読み込む
  const bundledIndexPath = vscode.Uri.joinPath(
    context.extensionUri,
    "resources",
    "skill-index.json",
  );

  let bundledIndex: SkillIndex | null = null;
  try {
    const bundledContent = await vscode.workspace.fs.readFile(bundledIndexPath);
    bundledIndex = normalizeSkillIndex(
      JSON.parse(
        Buffer.from(bundledContent).toString("utf-8"),
      ) as Partial<SkillIndex>,
    );
  } catch {
    // バンドルがなければ null のまま
  }

  let effectiveIndex: SkillIndex;

  try {
    // ローカルインデックスを読み込む
    const content = await vscode.workspace.fs.readFile(localIndexPath);
    const localIndex = normalizeSkillIndex(
      JSON.parse(Buffer.from(content).toString("utf-8")) as Partial<SkillIndex>,
    );

    // バンドル版がある場合は常にマージ（description_ja の補完のため）
    if (bundledIndex) {
      const mergedIndex = mergeSkillIndexes(localIndex, bundledIndex);
      // バンドル版で補完できるメタデータがあれば保存する
      if (shouldPersistMergedIndex(localIndex, mergedIndex)) {
        await saveSkillIndex(context, mergedIndex);
      }
      effectiveIndex = mergedIndex;
    } else {
      effectiveIndex = localIndex;
    }
  } catch {
    // ローカルにない場合はバンドルされたインデックスを使用
    if (bundledIndex) {
      // ローカルにコピー
      await vscode.workspace.fs.createDirectory(context.globalStorageUri);
      await vscode.workspace.fs.writeFile(
        localIndexPath,
        Buffer.from(JSON.stringify(bundledIndex, null, 2), "utf-8"),
      );
      effectiveIndex = bundledIndex;
    } else {
      logger.warn("No skill index found, using empty index");
      effectiveIndex = {
        version: "1.0.0",
        lastUpdated: new Date().toISOString().split("T")[0],
        sources: [],
        skills: [],
        categories: [],
      };
    }
  }

  const sharedMergedIndex = await loadSharedStoresIntoSkillIndex(
    context,
    effectiveIndex,
  );

  if (shouldPersistMergedIndex(effectiveIndex, sharedMergedIndex)) {
    await vscode.workspace.fs.createDirectory(context.globalStorageUri);
    await vscode.workspace.fs.writeFile(
      localIndexPath,
      Buffer.from(JSON.stringify(sharedMergedIndex, null, 2), "utf-8"),
    );
  }

  return sharedMergedIndex;
}

/**
 * 2つのスキルインデックスをマージ
 * バンドル版の新しいソースをローカル版に追加
 * 既存スキルの多言語説明も更新
 */
function mergeSkillIndexes(
  localIndex: SkillIndex,
  bundledIndex: SkillIndex,
): SkillIndex {
  const bundledSourcesById = new Map(
    bundledIndex.sources.map((source) => [source.id, source]),
  );
  const bundledCategoriesById = new Map(
    bundledIndex.categories.map((category) => [category.id, category]),
  );
  const bundledBundlesByKey = new Map(
    (bundledIndex.bundles || []).map((bundle) => [
      createBundleKey(bundle),
      bundle,
    ]),
  );
  const bundledSkillsByKey = new Map(
    bundledIndex.skills.map((skill) => [createSkillKey(skill), skill]),
  );

  // ローカルのソース ID セット
  const localSourceIds = new Set(localIndex.sources.map((s) => s.id));
  const localCategoryIds = new Set(localIndex.categories.map((c) => c.id));
  const localBundleKeys = new Set(
    (localIndex.bundles || []).map((bundle) => createBundleKey(bundle)),
  );

  // バンドル版の新しいソースを追加
  const newSources = bundledIndex.sources.filter(
    (s) => !localSourceIds.has(s.id),
  );
  const newCategories = bundledIndex.categories.filter(
    (category) => !localCategoryIds.has(category.id),
  );
  const newBundles = (bundledIndex.bundles || []).filter(
    (bundle) => !localBundleKeys.has(createBundleKey(bundle)),
  );

  // 既存ソースをバンドル版で補完・更新
  const updatedSources = localIndex.sources.map((localSource) => {
    const bundledSource = bundledSourcesById.get(localSource.id);
    if (bundledSource) {
      return {
        ...localSource,
        ...bundledSource,
        description_ja:
          bundledSource.description_ja || localSource.description_ja,
      };
    }
    return localSource;
  });

  // 既存カテゴリをバンドル版で補完・更新
  const updatedCategories = localIndex.categories.map((localCategory) => {
    const bundledCategory = bundledCategoriesById.get(localCategory.id);
    if (bundledCategory) {
      return {
        ...localCategory,
        ...bundledCategory,
        name_ja: bundledCategory.name_ja || localCategory.name_ja,
        description_ja:
          bundledCategory.description_ja || localCategory.description_ja,
      };
    }
    return localCategory;
  });

  // バンドル版の新しいスキルを追加
  // 既存ソースでも新スキルが追加されるため、source+name で欠分を補完する
  const localSkillKeys = new Set(
    localIndex.skills.map((skill) => createSkillKey(skill)),
  );
  const newSkills = bundledIndex.skills.filter(
    (skill) => !localSkillKeys.has(createSkillKey(skill)),
  );

  // 既存スキルをバンドル版で補完・更新
  const updatedSkills = localIndex.skills.map((localSkill) => {
    const bundledSkill = bundledSkillsByKey.get(createSkillKey(localSkill));
    if (bundledSkill) {
      return {
        ...localSkill,
        ...bundledSkill,
        description_ja:
          bundledSkill.description_ja || localSkill.description_ja,
        requires:
          bundledSkill.requires && bundledSkill.requires.length > 0
            ? bundledSkill.requires
            : localSkill.requires,
        categories:
          bundledSkill.categories.length > 0
            ? bundledSkill.categories
            : localSkill.categories,
        standalone: bundledSkill.standalone ?? localSkill.standalone,
        bundle: bundledSkill.bundle || localSkill.bundle,
        license: bundledSkill.license || localSkill.license,
        author: bundledSkill.author || localSkill.author,
        version: bundledSkill.version || localSkill.version,
        pluginRoot: bundledSkill.pluginRoot || localSkill.pluginRoot,
        pluginManifestPath:
          bundledSkill.pluginManifestPath || localSkill.pluginManifestPath,
        pluginManifestKind:
          bundledSkill.pluginManifestKind || localSkill.pluginManifestKind,
      };
    }
    return localSkill;
  });

  // 既存バンドルをバンドル版で補完・更新
  const updatedBundles = (localIndex.bundles || []).map((localBundle) => {
    const bundledBundle = bundledBundlesByKey.get(createBundleKey(localBundle));
    if (bundledBundle) {
      return {
        ...localBundle,
        ...bundledBundle,
        description_ja:
          bundledBundle.description_ja || localBundle.description_ja,
      };
    }
    return localBundle;
  });

  return {
    ...localIndex,
    version: bundledIndex.version,
    lastUpdated: bundledIndex.lastUpdated,
    sources: [...updatedSources, ...newSources],
    categories: [...updatedCategories, ...newCategories],
    skills: [...updatedSkills, ...newSkills],
    bundles:
      updatedBundles.length > 0 || newBundles.length > 0
        ? [...updatedBundles, ...newBundles]
        : localIndex.bundles,
  };
}

function areStringArraysEqual(left?: string[], right?: string[]): boolean {
  const leftValues = left || [];
  const rightValues = right || [];

  if (leftValues.length !== rightValues.length) {
    return false;
  }

  return leftValues.every((value, index) => value === rightValues[index]);
}

function shouldPersistMergedIndex(
  localIndex: SkillIndex,
  mergedIndex: SkillIndex,
): boolean {
  if (
    localIndex.version !== mergedIndex.version ||
    localIndex.lastUpdated !== mergedIndex.lastUpdated
  ) {
    return true;
  }

  if (localIndex.sources.length !== mergedIndex.sources.length) {
    return true;
  }

  for (let index = 0; index < localIndex.sources.length; index += 1) {
    const localSource = localIndex.sources[index];
    const mergedSource = mergedIndex.sources[index];
    if (
      localSource.id !== mergedSource.id ||
      localSource.name !== mergedSource.name ||
      localSource.url !== mergedSource.url ||
      localSource.type !== mergedSource.type ||
      localSource.branch !== mergedSource.branch ||
      localSource.description !== mergedSource.description ||
      localSource.description_ja !== mergedSource.description_ja
    ) {
      return true;
    }
  }

  if (localIndex.categories.length !== mergedIndex.categories.length) {
    return true;
  }

  for (let index = 0; index < localIndex.categories.length; index += 1) {
    const localCategory = localIndex.categories[index];
    const mergedCategory = mergedIndex.categories[index];
    if (
      localCategory.id !== mergedCategory.id ||
      localCategory.name !== mergedCategory.name ||
      localCategory.name_ja !== mergedCategory.name_ja ||
      localCategory.description !== mergedCategory.description ||
      localCategory.description_ja !== mergedCategory.description_ja
    ) {
      return true;
    }
  }

  const localBundles = localIndex.bundles || [];
  const mergedBundles = mergedIndex.bundles || [];
  if (localBundles.length !== mergedBundles.length) {
    return true;
  }

  for (let index = 0; index < localBundles.length; index += 1) {
    const localBundle = localBundles[index];
    const mergedBundle = mergedBundles[index];
    if (
      localBundle.id !== mergedBundle.id ||
      localBundle.name !== mergedBundle.name ||
      localBundle.source !== mergedBundle.source ||
      localBundle.description !== mergedBundle.description ||
      localBundle.description_ja !== mergedBundle.description_ja ||
      localBundle.coreSkill !== mergedBundle.coreSkill ||
      localBundle.pluginId !== mergedBundle.pluginId ||
      localBundle.mode !== mergedBundle.mode ||
      localBundle.safetyBoundary !== mergedBundle.safetyBoundary ||
      !areStringArraysEqual(localBundle.skills, mergedBundle.skills) ||
      !areStringArraysEqual(localBundle.installOrder, mergedBundle.installOrder)
    ) {
      return true;
    }
  }

  if (localIndex.skills.length !== mergedIndex.skills.length) {
    return true;
  }

  for (let index = 0; index < localIndex.skills.length; index += 1) {
    const localSkill = localIndex.skills[index];
    const mergedSkill = mergedIndex.skills[index];
    if (
      localSkill.name !== mergedSkill.name ||
      getResourceKind(localSkill) !== getResourceKind(mergedSkill) ||
      localSkill.source !== mergedSkill.source ||
      localSkill.path !== mergedSkill.path ||
      localSkill.description !== mergedSkill.description ||
      localSkill.description_ja !== mergedSkill.description_ja ||
      localSkill.url !== mergedSkill.url ||
      localSkill.rawUrl !== mergedSkill.rawUrl ||
      localSkill.stars !== mergedSkill.stars ||
      localSkill.owner !== mergedSkill.owner ||
      localSkill.isOrg !== mergedSkill.isOrg ||
      localSkill.standalone !== mergedSkill.standalone ||
      localSkill.bundle !== mergedSkill.bundle ||
      localSkill.license !== mergedSkill.license ||
      localSkill.author !== mergedSkill.author ||
      localSkill.version !== mergedSkill.version ||
      localSkill.pluginRoot !== mergedSkill.pluginRoot ||
      localSkill.pluginManifestPath !== mergedSkill.pluginManifestPath ||
      localSkill.pluginManifestKind !== mergedSkill.pluginManifestKind ||
      !areStringArraysEqual(localSkill.categories, mergedSkill.categories) ||
      !areStringArraysEqual(localSkill.requires, mergedSkill.requires)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * スキルインデックスを保存する
 */
export async function saveSkillIndex(
  context: vscode.ExtensionContext,
  index: SkillIndex,
): Promise<void> {
  const localIndexPath = vscode.Uri.joinPath(
    context.globalStorageUri,
    "skill-index.json",
  );
  await vscode.workspace.fs.createDirectory(context.globalStorageUri);
  await vscode.workspace.fs.writeFile(
    localIndexPath,
    Buffer.from(JSON.stringify(index, null, 2), "utf-8"),
  );
  await syncSharedStoresFromSkillIndex(context, index);
}

// デフォルトブランチのキャッシュ（リポジトリURL → ブランチ名）
const branchCache = new Map<string, string>();

/**
 * URL が存在するか HEAD リクエストで確認
 */
async function checkUrlExists(url: string, token?: string): Promise<boolean> {
  const headers = createGitHubHeaders(url, "*/*", token);
  delete headers.Accept;

  try {
    const response = await fetch(url, { method: "HEAD", headers });
    return response.ok;
  } catch {
    return false;
  }
}

function normalizeGitHubRepoUrl(url: string): string {
  return url.replace(/\.git$/, "").replace(/\/$/, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rewriteStoredGitHubUrl(
  skill: Pick<Skill, "url">,
  sourceUrl: string,
  branch: string,
): string | undefined {
  if (!skill.url) {
    return undefined;
  }

  const repoUrl = normalizeGitHubRepoUrl(sourceUrl);
  const pattern = new RegExp(
    `^${escapeRegExp(repoUrl)}/(blob|tree)/[^/]+(?<suffix>/.*)?$`,
  );
  const match = skill.url.match(pattern);
  if (!match) {
    return undefined;
  }

  const suffix = match.groups?.suffix || "";
  return `${repoUrl}/${match[1]}/${branch}${suffix}`;
}

function getRawUrlFromSkillUrl(
  skill: Pick<Skill, "url" | "rawUrl">,
): string | undefined {
  if (skill.rawUrl) {
    return skill.rawUrl;
  }
  if (!skill.url) {
    return undefined;
  }

  const match = skill.url.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/,
  );
  if (!match) {
    return undefined;
  }

  const [, owner, repo, branch, path] = match;
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
}

/**
 * GitHub リポジトリのデフォルトブランチを取得する
 * 1. キャッシュがあればそれを返す
 * 2. skill-index.json に設定があればそれを使用
 * 3. main/master を HEAD リクエストで確認
 * 4. どちらもダメなら GitHub API で取得
 */
export async function getDefaultBranch(
  repoUrl: string,
  token?: string,
  testPath?: string, // 存在確認用のパス（例: "skills/xxx/SKILL.md"）
): Promise<string> {
  // キャッシュチェック
  if (branchCache.has(repoUrl)) {
    return branchCache.get(repoUrl)!;
  }

  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) {
    return "main"; // フォールバック
  }

  const [, owner, repo] = match;

  // HEAD リクエストで main/master を確認
  const branches = ["main", "master"];
  for (const branch of branches) {
    // testPath があればそれを使用、なければ README を確認
    const testFile = testPath || "README.md";
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${testFile}`;

    if (await checkUrlExists(rawUrl, token)) {
      branchCache.set(repoUrl, branch);
      return branch;
    }
  }

  // HEAD リクエストで判定できない場合は GitHub API で取得
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;
  try {
    const response = await fetchGitHubWithOptionalAuthRetry(apiUrl, {
      accept: "application/vnd.github.v3+json",
      token,
    });
    if (response.ok) {
      const data = (await response.json()) as { default_branch?: string };
      const branch = data.default_branch || "main";
      branchCache.set(repoUrl, branch);
      return branch;
    }
  } catch {
    // API エラー時はフォールバック
  }

  // フォールバック
  branchCache.set(repoUrl, "main");
  return "main";
}

/**
 * ソースのブランチを取得（キャッシュ or HEAD確認 or API）
 */
export async function getSourceBranch(
  source: Source,
  token?: string,
  skillPath?: string, // 存在確認用のスキルパス
): Promise<string> {
  // skill-index.json に明示的に設定されていればそれを使用
  if (source.branch) {
    return source.branch;
  }
  // HEAD リクエストまたは API で動的取得
  // 実ファイルならそのまま使用し、directory 型の skill だけ /SKILL.md を追加
  let testPath: string | undefined;
  if (skillPath) {
    testPath = getResourceContentPath({ path: skillPath });
  }
  return await getDefaultBranch(source.url, token, testPath);
}

export function isResourceFilePath(resourcePath: string): boolean {
  const fileName = resourcePath.replace(/\\/g, "/").split("/").pop() || "";
  return /\.(?:agent\.md|instructions\.md|prompt\.md|md|mdx|mdc|json|ya?ml|toml|txt)$/i.test(
    fileName,
  );
}

export function getResourceContentPath(
  resource: Pick<Skill, "path" | "kind" | "pluginManifestPath">,
  defaultFileName: string = "SKILL.md",
): string {
  if (getResourceKind(resource) === "plugin" && resource.pluginManifestPath) {
    return resource.pluginManifestPath;
  }
  if (isResourceFilePath(resource.path)) {
    return resource.path;
  }
  return `${resource.path.replace(/\/+$/, "")}/${defaultFileName}`;
}

export function buildGitHubResourceUrl(
  repoUrl: string,
  branch: string,
  resource: Pick<Skill, "path" | "kind" | "pluginRoot">,
): string {
  const baseUrl = normalizeGitHubRepoUrl(repoUrl);
  if (getResourceKind(resource) === "plugin") {
    const pluginPath = resource.pluginRoot || resource.path;
    return pluginPath === "."
      ? `${baseUrl}/tree/${branch}`
      : `${baseUrl}/tree/${branch}/${pluginPath}`;
  }
  const route = isResourceFilePath(resource.path) ? "blob" : "tree";
  return `${baseUrl}/${route}/${branch}/${resource.path}`;
}

export function buildGitHubRawUrl(
  repoUrl: string,
  branch: string,
  resource: Pick<Skill, "path" | "kind" | "pluginManifestPath">,
  fileName: string = "SKILL.md",
): string | undefined {
  const match = normalizeGitHubRepoUrl(repoUrl).match(
    /github\.com\/([^/]+)\/([^/]+)/,
  );
  if (!match) {
    return undefined;
  }

  const [, owner, repo] = match;
  const contentPath = getResourceContentPath(resource, fileName);
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${contentPath}`;
}

/**
 * ソース情報からスキルの GitHub URL を取得する（非同期版）
 */
export async function getSkillGitHubUrlAsync(
  skill: Skill,
  sources: Source[],
  token?: string,
): Promise<string | undefined> {
  const source = sources.find((s) => s.id === skill.source);
  if (!source) {
    return skill.url;
  }

  const branch = await getSourceBranch(source, token, skill.path);
  const storedUrl = rewriteStoredGitHubUrl(skill, source.url, branch);
  if (storedUrl) {
    return storedUrl;
  }
  return buildGitHubResourceUrl(source.url, branch, skill);
}

/**
 * ソース情報からスキルの GitHub URL を取得する（同期版 - フォールバック用）
 */
export function getSkillGitHubUrl(
  skill: Skill,
  sources: Source[],
): string | undefined {
  const source = sources.find((s) => s.id === skill.source);
  if (!source) {
    return skill.url;
  }

  const cachedBranch = branchCache.get(source.url);
  const branch = cachedBranch || source.branch;
  if (branch) {
    const storedUrl = rewriteStoredGitHubUrl(skill, source.url, branch);
    if (storedUrl) {
      return storedUrl;
    }
    return buildGitHubResourceUrl(source.url, branch, skill);
  }

  return skill.url || buildGitHubResourceUrl(source.url, "main", skill);
}

/**
 * スキルの raw ファイル URL を取得する（非同期版）
 */
export async function getSkillRawUrlAsync(
  skill: Skill,
  sources: Source[],
  fileName: string = "SKILL.md",
  token?: string,
): Promise<string | undefined> {
  const source = sources.find((s) => s.id === skill.source);
  if (!source) {
    return getRawUrlFromSkillUrl(skill);
  }

  const branch = await getSourceBranch(source, token, skill.path);
  return (
    buildGitHubRawUrl(source.url, branch, skill, fileName) ||
    getRawUrlFromSkillUrl(skill)
  );
}

/**
 * スキルの raw ファイル URL を取得する（同期版 - フォールバック用）
 */
export function getSkillRawUrl(
  skill: Skill,
  sources: Source[],
  fileName: string = "SKILL.md",
): string | undefined {
  const source = sources.find((s) => s.id === skill.source);
  if (!source) {
    return getRawUrlFromSkillUrl(skill);
  }

  const cachedBranch = branchCache.get(source.url);
  const branch = cachedBranch || source.branch;
  if (branch) {
    return (
      buildGitHubRawUrl(source.url, branch, skill, fileName) ||
      getRawUrlFromSkillUrl(skill)
    );
  }

  return (
    getRawUrlFromSkillUrl(skill) ||
    buildGitHubRawUrl(source.url, "main", skill, fileName)
  );
}
