// スキルインデックスの管理
// プリインストールされたインデックスと更新可能なローカルインデックスを管理

import * as vscode from "vscode";
import { fetchGitHubWithOptionalAuthRetry } from "./githubFetch";
import { encodeGitHubPathForUrl, encodeGitRefForPath } from "./gitHubRefSafety";
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

// リポジトリ構造ごとのスキャン方式（未指定は auto）
export type SourceScanner = "auto" | "claude-commands" | "top-level-dirs";

// ソース情報の型定義
export interface Source {
  id: string;
  name: string;
  url: string;
  type: string;
  repoId?: number; // GitHub の数値 repository id（初回スキャンで TOFU 記録）
  scanner?: SourceScanner; // リポジトリ名に依存しないスキャン方式の宣言
  foreignScanner?: string; // 共有 writer が宣言した未実装 scanner（走査抑止用）
  branch?: string; // 明示的なデフォルトブランチ（省略時は runtime で解決）
  lastIndexedAt?: string; // ソース単位の最終 index 更新日時
  lastIndexedBy?: string; // lastIndexedAt を書いた拡張の id（同居時の鮮度の帰属）
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
  syncWithSource?: boolean; // Source 更新時に全 non-plugin resources へ同期
  syncResourceKinds?: string[]; // 同期対象の resource kind allowlist
}

// インデックス全体の型定義
export interface SkillIndex {
  version: string;
  /** 同梱カタログの発行日。merge で同梱側の値へ上書きされる */
  lastUpdated: string;
  /** この端末で source を最後に scan した ISO 時刻 */
  lastScannedAt?: string;
  sources: Source[];
  skills: Skill[];
  categories: Category[];
  bundles?: Bundle[]; // Bundle一覧
}

/**
 * 退役した preset source id と、その配信を引き継いだ source id の対応。
 * installed metadata の正規化と cached index の統合で共有する。
 */
export const RETIRED_SOURCE_ALIASES: Readonly<Record<string, string>> = {
  "microsoft-copilot-for-azure-plugin": "microsoft-azure-skills",
};

function getArrayField<T>(
  index: Partial<SkillIndex> | undefined,
  fieldName: keyof Pick<
    SkillIndex,
    "sources" | "skills" | "categories" | "bundles"
  >,
): T[] {
  const value = index?.[fieldName];
  return Array.isArray(value) ? (value as T[]) : [];
}

function getNormalizedArrayField<T>(
  index: Partial<SkillIndex>,
  fieldName: keyof Pick<
    SkillIndex,
    "sources" | "skills" | "categories" | "bundles"
  >,
): T[] {
  const value = index[fieldName];
  if (value !== undefined && !Array.isArray(value)) {
    logger.warn(
      `[Resource Ninja] Skill index field "${fieldName}" is not an array (${typeof value}); using an empty array fallback.`,
    );
  }
  return getArrayField<T>(index, fieldName);
}

export function getIndexResources(
  index: Partial<SkillIndex> | undefined,
): Skill[] {
  return getArrayField<Skill>(index, "skills");
}

export function getIndexSources(
  index: Partial<SkillIndex> | undefined,
): Source[] {
  return getArrayField<Source>(index, "sources");
}

export function getIndexCategories(
  index: Partial<SkillIndex> | undefined,
): Category[] {
  return getArrayField<Category>(index, "categories");
}

export function getIndexBundles(
  index: Partial<SkillIndex> | undefined,
): Bundle[] {
  return getArrayField<Bundle>(index, "bundles");
}

function createSkillKey(
  skill: Pick<Skill, "source" | "name" | "kind">,
): string {
  return `${skill.source}:${getResourceKind(skill)}:${skill.name}`;
}

export function createBundleKey(bundle: Pick<Bundle, "source" | "id">): string {
  return `${bundle.source}:${bundle.id}`;
}

function normalizeSkillIndex(
  index: Partial<SkillIndex>,
  preserveRuntimeMarkers = false,
): SkillIndex {
  return {
    version: index.version || "1.0.0",
    lastUpdated: index.lastUpdated || new Date().toISOString().split("T")[0],
    lastScannedAt: index.lastScannedAt,
    sources: getNormalizedArrayField<Source>(index, "sources").map((source) => {
      const normalized = {
        ...source,
        url: normalizeGitHubRepoUrl(source.url),
      };
      if (!preserveRuntimeMarkers) {
        delete normalized.foreignScanner;
      }
      return normalized;
    }),
    skills: getNormalizedArrayField<Skill>(index, "skills"),
    categories: getNormalizedArrayField<Category>(index, "categories"),
    bundles: getNormalizedArrayField<Bundle>(index, "bundles"),
  };
}

async function persistLocalSkillIndex(
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
    Buffer.from(JSON.stringify(normalizeSkillIndex(index), null, 2), "utf-8"),
  );
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
  } catch (error) {
    logger.warn(
      `[Resource Ninja] Failed to load bundled skill index from ${bundledIndexPath.toString(true)}; continuing without bundled fallback.`,
      error,
    );
    // バンドルがなければ null のまま
  }

  let effectiveIndex: SkillIndex;
  let newlyBundledSources: Source[] = [];

  try {
    // ローカルインデックスを読み込む
    const content = await vscode.workspace.fs.readFile(localIndexPath);
    const localIndex = normalizeSkillIndex(
      JSON.parse(Buffer.from(content).toString("utf-8")) as Partial<SkillIndex>,
    );

    // バンドル版がある場合は常にマージ（description_ja の補完のため）
    if (bundledIndex) {
      const mergedIndex = mergeSkillIndexes(localIndex, bundledIndex);
      const localSourceIds = new Set(
        localIndex.sources.map((source) => source.id),
      );
      newlyBundledSources = mergedIndex.sources.filter(
        (source) => !localSourceIds.has(source.id),
      );
      effectiveIndex = mergedIndex;
    } else {
      effectiveIndex = localIndex;
    }
  } catch (error) {
    logger.warn(
      `[Resource Ninja] Failed to load local skill index from ${localIndexPath.toString(true)}; using bundled fallback when available.`,
      error,
    );
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
      logger.warn(
        "[Resource Ninja] No skill index found; using empty index fallback. Run Resource Ninja: Update Index to rebuild it.",
      );
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
  const sharedSourceIds = new Set(
    sharedMergedIndex.sources.map((source) => source.id),
  );
  const sourcesToPublish = newlyBundledSources.filter(
    (source) => !sharedSourceIds.has(source.id),
  );
  const sourceIdsToPublish = new Set(
    sourcesToPublish.map((source) => source.id),
  );
  const sharedResourceKeys = new Set(
    sharedMergedIndex.skills.map(createSkillKey),
  );
  const resourcesToPublish = effectiveIndex.skills.filter(
    (skill) =>
      sourceIdsToPublish.has(skill.source) &&
      !sharedResourceKeys.has(createSkillKey(skill)),
  );
  const finalIndex =
    sourcesToPublish.length > 0
      ? {
          ...sharedMergedIndex,
          sources: [...sharedMergedIndex.sources, ...sourcesToPublish],
          skills: [...sharedMergedIndex.skills, ...resourcesToPublish],
        }
      : sharedMergedIndex;

  if (sourcesToPublish.length > 0) {
    // Shared state has now been read and merged, so publishing cannot overwrite
    // a sibling's newer fields with stale local cache data.
    await saveSkillIndex(context, finalIndex);
  } else if (shouldPersistMergedIndex(effectiveIndex, finalIndex)) {
    await persistLocalSkillIndex(context, finalIndex);
  }

  return finalIndex;
}

/**
 * 2つのスキルインデックスをマージ
 * バンドル版の新しいソースをローカル版に追加
 * 既存スキルの多言語説明も更新
 */
export function mergeSkillIndexes(
  localIndex: SkillIndex,
  bundledIndex: SkillIndex,
): SkillIndex {
  const bundledCategories = getIndexCategories(bundledIndex);
  const localCategories = getIndexCategories(localIndex);
  const bundledSourcesById = new Map(
    getIndexSources(bundledIndex).map((source) => [source.id, source]),
  );
  const bundledCategoriesById = new Map(
    bundledCategories.map((category) => [category.id, category]),
  );
  const bundledBundlesByKey = new Map(
    getIndexBundles(bundledIndex).map((bundle) => [
      createBundleKey(bundle),
      bundle,
    ]),
  );
  const bundledSkillsByKey = new Map(
    getIndexResources(bundledIndex).map((skill) => [
      createSkillKey(skill),
      skill,
    ]),
  );

  // 退役した preset source のうち、後継 source が同梱カタログに存在するものだけを
  // 統合対象にする。ユーザー追加 source は id が衝突しても対象にしない。
  const consolidatableSourceIds = new Set(
    getIndexSources(localIndex)
      .filter((source) => {
        const canonicalId = RETIRED_SOURCE_ALIASES[source.id];
        return (
          canonicalId !== undefined &&
          source.type !== "user-added" &&
          !bundledSourcesById.has(source.id) &&
          bundledSourcesById.has(canonicalId)
        );
      })
      .map((source) => source.id),
  );

  // 後継側に同じリソースが揃っているものだけ落とす。旧 source にしか無い配信物は、
  // 後継 repository に同じ path がある保証が無いので残す。
  const canonicalResourceKeys = new Set(
    [...getIndexResources(localIndex), ...getIndexResources(bundledIndex)].map(
      (resource) => createSkillKey(resource),
    ),
  );
  const retainedLocalSkills = getIndexResources(localIndex).filter((skill) => {
    if (!consolidatableSourceIds.has(skill.source)) {
      return true;
    }
    return !canonicalResourceKeys.has(
      createSkillKey({
        ...skill,
        source: RETIRED_SOURCE_ALIASES[skill.source],
      }),
    );
  });

  const retainedSkillSourceIds = new Set(
    retainedLocalSkills.map((resource) => resource.source),
  );
  const retainedLocalBundles = getIndexBundles(localIndex).filter(
    (bundle) =>
      !consolidatableSourceIds.has(bundle.source) ||
      retainedSkillSourceIds.has(bundle.source),
  );

  // ローカルのソース ID セット
  const localSourceIds = new Set(getIndexSources(localIndex).map((s) => s.id));
  const localBundleSourceIds = new Set(
    retainedLocalBundles.map((bundle) => bundle.source),
  );
  const localCategoryIds = new Set(localCategories.map((c) => c.id));
  const localBundleKeys = new Set(
    retainedLocalBundles.map((bundle) => createBundleKey(bundle)),
  );

  // バンドル版の新しいソースを追加
  const newSources = getIndexSources(bundledIndex).filter(
    (s) => !localSourceIds.has(s.id),
  );
  const newCategories = bundledCategories.filter(
    (category) => !localCategoryIds.has(category.id),
  );
  const newBundles = getIndexBundles(bundledIndex).filter(
    (bundle) => !localBundleKeys.has(createBundleKey(bundle)),
  );

  // 既存ソースをバンドル版で補完・更新
  // 退役した preset source は bundled index から消えても cached index に残り続け、
  // 中身ゼロのエントリとして表示され続けるため、痕跡が無いものだけ取り除く。
  const updatedSources = getIndexSources(localIndex)
    .filter((localSource) => {
      if (
        bundledSourcesById.has(localSource.id) ||
        localSource.type === "user-added"
      ) {
        return true;
      }
      return (
        retainedSkillSourceIds.has(localSource.id) ||
        localBundleSourceIds.has(localSource.id)
      );
    })
    .map((localSource) => {
      const bundledSource = bundledSourcesById.get(localSource.id);
      if (bundledSource) {
        return {
          ...localSource,
          ...bundledSource,
          description_ja:
            bundledSource.description_ja || localSource.description_ja,
          // Repository facts are resolved by a scan; a bundled preset ships
          // curation only and must not overwrite what the runtime verified.
          // Once an identity is recorded the runtime owns the URL so a followed
          // rename is not reverted; repointing a preset uses a new source id.
          repoId: localSource.repoId ?? bundledSource.repoId,
          lastIndexedAt:
            localSource.lastIndexedAt ?? bundledSource.lastIndexedAt,
          lastIndexedBy:
            localSource.lastIndexedBy ?? bundledSource.lastIndexedBy,
          url:
            localSource.repoId === undefined
              ? bundledSource.url
              : localSource.url,
        };
      }
      return localSource;
    });

  // 既存カテゴリをバンドル版で補完・更新
  const updatedCategories = localCategories.map((localCategory) => {
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
    retainedLocalSkills.map((skill) => createSkillKey(skill)),
  );
  const newSkills = getIndexResources(bundledIndex).filter(
    (skill) => !localSkillKeys.has(createSkillKey(skill)),
  );

  // 既存スキルをバンドル版で補完・更新
  const updatedSkills = retainedLocalSkills.map((localSkill) => {
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
  const updatedBundles = retainedLocalBundles.map((localBundle) => {
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

  const mergedBundles = [...updatedBundles, ...newBundles];
  // Consolidation can legitimately empty the list, so an empty result is only
  // "nothing to say" when no local bundle was dropped.
  const droppedLocalBundles =
    retainedLocalBundles.length < getIndexBundles(localIndex).length;

  return {
    ...localIndex,
    version: bundledIndex.version,
    lastUpdated: bundledIndex.lastUpdated,
    sources: [...updatedSources, ...newSources],
    categories: [...updatedCategories, ...newCategories],
    skills: [...updatedSkills, ...newSkills],
    bundles:
      mergedBundles.length > 0 || droppedLocalBundles
        ? mergedBundles
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
      localSource.repoId !== mergedSource.repoId ||
      localSource.scanner !== mergedSource.scanner ||
      localSource.branch !== mergedSource.branch ||
      localSource.lastIndexedAt !== mergedSource.lastIndexedAt ||
      localSource.lastIndexedBy !== mergedSource.lastIndexedBy ||
      localSource.description !== mergedSource.description ||
      localSource.description_ja !== mergedSource.description_ja ||
      !areStringArraysEqual(
        localSource.includePaths,
        mergedSource.includePaths,
      ) ||
      !areStringArraysEqual(localSource.excludePaths, mergedSource.excludePaths)
    ) {
      return true;
    }
  }

  const localCategories = getIndexCategories(localIndex);
  const mergedCategories = getIndexCategories(mergedIndex);
  if (localCategories.length !== mergedCategories.length) {
    return true;
  }

  for (let index = 0; index < localCategories.length; index += 1) {
    const localCategory = localCategories[index];
    const mergedCategory = mergedCategories[index];
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
      localBundle.syncWithSource !== mergedBundle.syncWithSource ||
      !areStringArraysEqual(
        localBundle.syncResourceKinds,
        mergedBundle.syncResourceKinds,
      ) ||
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
  const runtimeIndex = normalizeSkillIndex(index, true);
  await persistLocalSkillIndex(context, index);
  await syncSharedStoresFromSkillIndex(context, runtimeIndex);
}

export const DEFAULT_BRANCH_NEGATIVE_CACHE_TTL_MS = 30_000;

interface BranchCacheEntry {
  branch: string;
  expiresAt?: number;
}

// 確認済みブランチは保持し、推測フォールバックだけ短時間で失効させる。
const branchCache = new Map<string, BranchCacheEntry>();

function getCachedBranch(repoUrl: string, now: number): string | undefined {
  const cached = branchCache.get(repoUrl);
  if (!cached) {
    return undefined;
  }
  if (cached.expiresAt !== undefined && cached.expiresAt <= now) {
    branchCache.delete(repoUrl);
    return undefined;
  }
  return cached.branch;
}

/**
 * URL が存在するか HEAD リクエストで確認
 */
async function checkUrlExists(url: string, token?: string): Promise<boolean> {
  try {
    const response = await fetchGitHubWithOptionalAuthRetry(url, {
      accept: "*/*",
      token,
      method: "HEAD",
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function normalizeGitHubRepoUrl(url: string): string {
  const trimmed = url
    .trim()
    .replace(/\.git$/i, "")
    .replace(/\/$/, "");
  const match = trimmed.match(
    /^(https:\/\/github\.com\/[^/]+\/[^/]+)(?:\/(?:tree|blob)\/.*)?$/i,
  );
  return match ? match[1] : trimmed;
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
  return `${repoUrl}/${match[1]}/${encodeGitRefForPath(branch)}${suffix}`;
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
  return `https://raw.githubusercontent.com/${owner}/${repo}/${encodeGitRefForPath(branch)}/${path}`;
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
  now: () => number = Date.now,
): Promise<string> {
  // キャッシュチェック
  const cachedBranch = getCachedBranch(repoUrl, now());
  if (cachedBranch) {
    return cachedBranch;
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
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encodeGitHubPathForUrl(testFile)}`;

    if (await checkUrlExists(rawUrl, token)) {
      branchCache.set(repoUrl, { branch });
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
      const branch = data.default_branch?.trim();
      if (branch) {
        branchCache.set(repoUrl, { branch });
        return branch;
      }
    }
  } catch {
    // API エラー時はフォールバック
  }

  // フォールバック
  branchCache.set(repoUrl, {
    branch: "main",
    expiresAt: now() + DEFAULT_BRANCH_NEGATIVE_CACHE_TTL_MS,
  });
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
  const ref = encodeGitRefForPath(branch);
  if (getResourceKind(resource) === "plugin") {
    const pluginPath = resource.pluginRoot || resource.path;
    return pluginPath === "."
      ? `${baseUrl}/tree/${ref}`
      : `${baseUrl}/tree/${ref}/${encodeGitHubPathForUrl(pluginPath)}`;
  }
  const route = isResourceFilePath(resource.path) ? "blob" : "tree";
  return `${baseUrl}/${route}/${ref}/${encodeGitHubPathForUrl(resource.path)}`;
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
  return `https://raw.githubusercontent.com/${owner}/${repo}/${encodeGitRefForPath(branch)}/${encodeGitHubPathForUrl(contentPath)}`;
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

  const cachedBranch = getCachedBranch(source.url, Date.now());
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

  const cachedBranch = getCachedBranch(source.url, Date.now());
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
