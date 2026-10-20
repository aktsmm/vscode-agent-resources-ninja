// スキル一覧の絞り込み・並べ替えの共通ロジック。
// vscode に依存しない純粋関数だけを置き、Installed / User-Global / Browse の各ビューが同じ規則を使う。
// 絞り込みの対象は skill だけで、他の種別（agent など）には呼び出しモードがないため常に残す。

import {
  normalizeSkillInvocation,
  type SkillInvocation,
} from "./skillInvocationMode";

/** 呼び出しモードで絞る。`all` は絞り込みなし。 */
export type SkillInvocationFilter = "all" | SkillInvocation;

/**
 * - default: ビュー既定の順序（ローカルは既存の順、Browse はインデックス順）
 * - name: 名前順
 * - stars: GitHub スター数の多い順（Browse のみ）
 * - invocation: 手動専用 → モデル専用 → 自動の順（ローカルのみ）
 */
export type SkillSortMode = "default" | "name" | "stars" | "invocation";

export type SkillViewScope = "local" | "browse";

export const LOCAL_SORT_MODES: readonly SkillSortMode[] = [
  "default",
  "name",
  "invocation",
];
export const BROWSE_SORT_MODES: readonly SkillSortMode[] = [
  "default",
  "name",
  "stars",
];

export interface SkillViewOptions {
  filter: SkillInvocationFilter;
  sort: SkillSortMode;
}

export const DEFAULT_SKILL_VIEW_OPTIONS: Readonly<SkillViewOptions> = {
  filter: "all",
  sort: "default",
};

export function getSortModes(scope: SkillViewScope): readonly SkillSortMode[] {
  return scope === "browse" ? BROWSE_SORT_MODES : LOCAL_SORT_MODES;
}

// ビューごとの現在値。Installed と User-Global は同じ「local」を共有し、Browse は独立して持つ。
const viewOptionsByScope: Record<SkillViewScope, SkillViewOptions> = {
  local: { ...DEFAULT_SKILL_VIEW_OPTIONS },
  browse: { ...DEFAULT_SKILL_VIEW_OPTIONS },
};

export function getSkillViewOptions(scope: SkillViewScope): SkillViewOptions {
  return viewOptionsByScope[scope];
}

export function setSkillViewOptions(
  scope: SkillViewScope,
  options: SkillViewOptions,
): void {
  viewOptionsByScope[scope] = { ...options };
}

export function normalizeInvocationFilter(
  value: unknown,
): SkillInvocationFilter {
  return value === "auto" || value === "explicitOnly" || value === "modelOnly"
    ? value
    : "all";
}

export function normalizeSortMode(
  value: unknown,
  allowed: readonly SkillSortMode[],
): SkillSortMode {
  return allowed.includes(value as SkillSortMode)
    ? (value as SkillSortMode)
    : "default";
}

/** 既定から外れているか。ビュータイトルのアイコン切り替えに使う。 */
export function isViewOptionsActive(options: SkillViewOptions): boolean {
  return options.filter !== "all" || options.sort !== "default";
}

export function matchesInvocationFilter(
  skill: { invocation?: unknown },
  filter: SkillInvocationFilter,
): boolean {
  return (
    filter === "all" || normalizeSkillInvocation(skill.invocation) === filter
  );
}

export interface SortableSkill {
  name: string;
  stars?: number;
  invocation?: unknown;
}

// 探しやすさ優先: 明示呼び出し専用 → モデル専用 → 通常
const INVOCATION_SORT_RANK: Record<SkillInvocation, number> = {
  explicitOnly: 0,
  modelOnly: 1,
  auto: 2,
};

/** `default` は 0 を返すので、呼び出し側の既定順序（安定ソート）がそのまま残る。 */
export function compareSkillsByMode(
  left: SortableSkill,
  right: SortableSkill,
  mode: SkillSortMode,
): number {
  switch (mode) {
    case "name":
      return left.name.localeCompare(right.name);
    case "stars":
      return (
        (right.stars ?? 0) - (left.stars ?? 0) ||
        left.name.localeCompare(right.name)
      );
    case "invocation":
      return (
        INVOCATION_SORT_RANK[normalizeSkillInvocation(left.invocation)] -
          INVOCATION_SORT_RANK[normalizeSkillInvocation(right.invocation)] ||
        left.name.localeCompare(right.name)
      );
    default:
      return 0;
  }
}

export function sortSkills<T extends SortableSkill>(
  skills: readonly T[],
  mode: SkillSortMode,
): T[] {
  const copy = [...skills];
  return mode === "default"
    ? copy
    : copy.sort((left, right) => compareSkillsByMode(left, right, mode));
}

/**
 * 絞り込みを適用する。skill 以外の種別は対象外で常に残す。
 * `kind` が無いリソースは skill として扱う。
 */
export function filterSkillsByInvocation<
  T extends { kind?: string; invocation?: unknown },
>(resources: readonly T[], filter: SkillInvocationFilter): T[] {
  return filter === "all"
    ? [...resources]
    : resources.filter(
        (resource) =>
          (resource.kind || "skill") !== "skill" ||
          matchesInvocationFilter(resource, filter),
      );
}

/**
 * インデックスに呼び出しモードが 1 件でも入っているか。
 * 未更新のインデックスでは絞り込みが「該当なし」になるため、案内を出す判断に使う。
 */
export function hasInvocationData(
  skills: ReadonlyArray<{ kind?: string; invocation?: unknown }>,
): boolean {
  return skills.some(
    (skill) => (skill.kind || "skill") === "skill" && skill.invocation !== undefined,
  );
}
