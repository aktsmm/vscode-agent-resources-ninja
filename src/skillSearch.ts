// スキル検索機能
// キーワードやカテゴリでスキルを検索

import * as vscode from "vscode";
import {
  SkillIndex,
  Skill,
  Source,
  ResourceKind,
  getLocalizedDescription,
  getResourceKind,
  getResourceKindIcon,
  getResourceKindLabel,
} from "./skillIndex";
import { isJapanese } from "./i18n";

// QuickPick用のアイテム型
export interface SkillQuickPickItem extends vscode.QuickPickItem {
  skill: Skill;
}

/**
 * ソースタイプの優先度を取得
 */
function getSourceTypePriority(sourceId: string, sources: Source[]): number {
  const source = sources.find((s) => s.id === sourceId);
  if (!source) return 99;
  const priority: Record<string, number> = {
    official: 0,
    "awesome-list": 1,
    community: 2,
  };
  return priority[source.type] ?? 99;
}

function getSourceDisplayName(sourceId: string, sources: Source[]): string {
  return sources.find((source) => source.id === sourceId)?.name || sourceId;
}

function formatSourceDisplayName(sourceId: string, sources: Source[]): string {
  const displayName = getSourceDisplayName(sourceId, sources);
  const maxLength = 44;
  if (displayName.length <= maxLength) {
    return displayName;
  }
  return `${displayName.slice(0, maxLength - 3)}...`;
}

function isPluginPath(resourcePath: string): boolean {
  return /^plugins?\//.test(resourcePath.replace(/\\/g, "/"));
}

function compareSearchTieBreakers(
  first: Skill,
  second: Skill,
  sources: Source[],
): number {
  const priorityA = getSourceTypePriority(first.source, sources);
  const priorityB = getSourceTypePriority(second.source, sources);
  if (priorityA !== priorityB) return priorityA - priorityB;

  const nameCompare = first.name.localeCompare(second.name);
  if (nameCompare !== 0) return nameCompare;

  const firstIsPluginPath = isPluginPath(first.path);
  const secondIsPluginPath = isPluginPath(second.path);
  if (firstIsPluginPath !== secondIsPluginPath) {
    return firstIsPluginPath ? 1 : -1;
  }

  if (first.path.length !== second.path.length) {
    return first.path.length - second.path.length;
  }

  return first.source.localeCompare(second.source);
}

function getDuplicateNameCounts(resources: Skill[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const resource of resources) {
    const key = `${getResourceKind(resource)}:${resource.name.toLowerCase()}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function hasDuplicateName(
  skill: Skill,
  duplicateNameCounts: Map<string, number>,
): boolean {
  const key = `${getResourceKind(skill)}:${skill.name.toLowerCase()}`;
  return (duplicateNameCounts.get(key) || 0) > 1;
}

/**
 * スキルの検索スコアを計算
 * 高いスコア = より関連性が高い
 */
function calculateSearchScore(skill: Skill, keywords: string[]): number {
  let score = 0;
  const nameLower = skill.name.toLowerCase();
  const descLower = skill.description.toLowerCase();
  const descJaLower = skill.description_ja?.toLowerCase() || "";
  const categoriesLower = skill.categories.map((c) => c.toLowerCase());
  const sourceLower = skill.source.toLowerCase();

  for (const keyword of keywords) {
    // 名前の完全一致（最高スコア）
    if (nameLower === keyword) {
      score += 100;
    }
    // 名前の先頭一致
    else if (nameLower.startsWith(keyword)) {
      score += 50;
    }
    // 名前の部分一致
    else if (nameLower.includes(keyword)) {
      score += 30;
    }
    // カテゴリの一致
    if (categoriesLower.some((cat) => cat.includes(keyword))) {
      score += 20;
    }
    // 説明文の一致（英語・日本語）
    if (descLower.includes(keyword) || descJaLower.includes(keyword)) {
      score += 10;
    }
    // ソースの一致
    if (sourceLower.includes(keyword)) {
      score += 5;
    }
  }

  return score;
}

/**
 * スキルを検索してQuickPickアイテムに変換
 */
export function searchSkills(
  index: SkillIndex,
  query: string,
  kindFilter?: ResourceKind,
): SkillQuickPickItem[] {
  const lowerQuery = query.toLowerCase().trim();
  const resources = kindFilter
    ? index.skills.filter((skill) => getResourceKind(skill) === kindFilter)
    : index.skills;

  // クエリが空の場合はソースタイプ順でソートして返す
  if (!lowerQuery) {
    const sorted = [...resources].sort((a, b) => {
      return compareSearchTieBreakers(a, b, index.sources);
    });
    const visibleResources = sorted.slice(0, 100);
    const duplicateNameCounts = getDuplicateNameCounts(visibleResources);
    return visibleResources.map((skill) =>
      skillToQuickPickItem(skill, index.sources, duplicateNameCounts),
    );
  }

  // スペース区切りで複数キーワード対応（AND検索）
  const keywords = lowerQuery.split(/\s+/).filter((k) => k.length > 0);

  // スコア付きでフィルタリング
  const scoredSkills = resources
    .map((skill) => ({
      skill,
      score: calculateSearchScore(skill, keywords),
    }))
    .filter(({ score }) => score > 0);

  // ソート: ソースタイプ優先 → スコア順 → 名前順
  scoredSkills.sort((a, b) => {
    // まずスコアで比較（高い順）
    if (b.score !== a.score) return b.score - a.score;

    return compareSearchTieBreakers(a.skill, b.skill, index.sources);
  });

  // 最大100件に制限
  const visibleResources = scoredSkills.slice(0, 100).map(({ skill }) => skill);
  const duplicateNameCounts = getDuplicateNameCounts(visibleResources);
  return visibleResources.map((skill) =>
    skillToQuickPickItem(skill, index.sources, duplicateNameCounts),
  );
}

/**
 * スキルをQuickPickアイテムに変換
 */
function skillToQuickPickItem(
  skill: Skill,
  sources: Source[],
  duplicateNameCounts: Map<string, number>,
): SkillQuickPickItem {
  const isJa = isJapanese();
  const categoryTags =
    skill.categories.length > 0
      ? skill.categories.map((c) => `#${c}`).join(" ")
      : "";
  const desc = getLocalizedDescription(skill, isJa);
  const kind = getResourceKind(skill);
  const kindLabel = getResourceKindLabel(kind, isJa);
  const icon = getResourceKindIcon(kind);
  const sourceName = formatSourceDisplayName(skill.source, sources);
  const isDuplicate = hasDuplicateName(skill, duplicateNameCounts);

  return {
    label: `$(${icon}) ${skill.name}`,
    description: `$(repo) ${sourceName} · ${kindLabel}`,
    detail: `${desc || (isJa ? "説明なし" : "No description")}${
      categoryTags ? `  ${categoryTags}` : ""
    }${isDuplicate ? `\n${isJa ? "Source" : "Source"}: ${skill.source} · Path: ${skill.path}` : ""}`,
    skill: skill,
  };
}

/**
 * カテゴリでスキルをグループ化
 */
export function groupByCategory(index: SkillIndex): Map<string, Skill[]> {
  const groups = new Map<string, Skill[]>();

  for (const skill of index.skills) {
    for (const category of skill.categories) {
      if (!groups.has(category)) {
        groups.set(category, []);
      }
      groups.get(category)!.push(skill);
    }
  }

  return groups;
}

/**
 * ソースでスキルをグループ化
 */
export function groupBySource(index: SkillIndex): Map<string, Skill[]> {
  const groups = new Map<string, Skill[]>();

  for (const skill of index.skills) {
    if (!groups.has(skill.source)) {
      groups.set(skill.source, []);
    }
    groups.get(skill.source)!.push(skill);
  }

  return groups;
}
