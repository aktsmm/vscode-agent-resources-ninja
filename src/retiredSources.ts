import type { RetiredSource, SkillIndex } from "./skillIndex";

/**
 * 退役した preset source を index から取り除く。
 *
 * 後継 source があっても id の付け替えはしない。resource の path は退役元
 * リポジトリのものなので、そのまま後継 id へ移すと raw 取得が 404 になる。
 * 後継側のエントリは同梱 index の merge で入ってくる。
 */
export function applyRetiredSources(
  index: SkillIndex,
  retiredSources: readonly RetiredSource[] | undefined,
): SkillIndex {
  const retiredIds = getRetiredSourceIds(retiredSources);
  if (retiredIds.size === 0) {
    return index;
  }

  const sources = index.sources.filter((source) => !retiredIds.has(source.id));
  if (sources.length === index.sources.length) {
    return index;
  }

  const bundles = (index.bundles || []).filter(
    (bundle) => !retiredIds.has(bundle.source),
  );

  return {
    ...index,
    sources,
    skills: index.skills.filter((skill) => !retiredIds.has(skill.source)),
    bundles: bundles.length > 0 ? bundles : undefined,
  };
}

export function getRetiredSourceIds(
  retiredSources: readonly RetiredSource[] | undefined,
): Set<string> {
  return new Set(
    (Array.isArray(retiredSources) ? retiredSources : [])
      .map((entry) => (typeof entry?.id === "string" ? entry.id.trim() : ""))
      .filter(Boolean),
  );
}
