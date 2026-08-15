const DEFAULT_INDEX_TEXT_MAX_LENGTH = 4_000;
const DEFAULT_INDEX_TAG_MAX_LENGTH = 64;
const DEFAULT_INDEX_TAG_MAX_COUNT = 20;
const MAX_STAR_COUNT = 1_000_000_000;

export interface NormalizedExternalIndexRow {
  name: string;
  path: string;
  description: string;
  categories: string[];
  stars?: number;
}

export function normalizeIndexText(
  value: unknown,
  maxLength = DEFAULT_INDEX_TEXT_MAX_LENGTH,
): string {
  if (typeof value !== "string") {
    return "";
  }
  const boundedLength = Number.isFinite(maxLength)
    ? Math.max(0, Math.floor(maxLength))
    : DEFAULT_INDEX_TEXT_MAX_LENGTH;
  return value.trim().slice(0, boundedLength);
}

export function normalizeIndexTags(
  value: unknown,
  maxCount = DEFAULT_INDEX_TAG_MAX_COUNT,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const boundedCount = Number.isFinite(maxCount)
    ? Math.max(0, Math.floor(maxCount))
    : DEFAULT_INDEX_TAG_MAX_COUNT;
  const normalized = new Set<string>();
  for (const item of value) {
    const tag = normalizeIndexText(item, DEFAULT_INDEX_TAG_MAX_LENGTH);
    if (tag) {
      normalized.add(tag);
    }
    if (normalized.size >= boundedCount) {
      break;
    }
  }
  return [...normalized];
}

export function normalizeStarCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return Math.min(Math.floor(value), MAX_STAR_COUNT);
}

export function normalizeSearchIndexRow(
  value: unknown,
  categoryMap: Readonly<Record<string, string>>,
): NormalizedExternalIndexRow | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const item = value as Record<string, unknown>;
  const name = normalizeIndexText(item.n, 256);
  const installPath = normalizeIndexText(item.i, 2_048);
  if (!name || !installPath) {
    return undefined;
  }
  const categoryCode = normalizeIndexText(item.c, 64);
  return {
    name,
    path: installPath,
    description: normalizeIndexText(item.d),
    categories: [
      categoryMap[categoryCode] || categoryCode || "other",
      ...normalizeIndexTags(item.g, 3),
    ],
    stars: normalizeStarCount(item.r),
  };
}

export function normalizeRegistryIndexRow(
  value: unknown,
): NormalizedExternalIndexRow | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const item = value as Record<string, unknown>;
  const name = normalizeIndexText(item.name, 256);
  const installPath = normalizeIndexText(
    item.install_path || item.path || item.repo,
    2_048,
  );
  if (!name || !installPath) {
    return undefined;
  }
  const category = normalizeIndexText(item.category, 64);
  const categories = [
    ...(category ? [category] : []),
    ...normalizeIndexTags(item.tags, 3),
  ];
  return {
    name,
    path: installPath,
    description: normalizeIndexText(item.description),
    categories: categories.length > 0 ? categories : ["other"],
    stars: normalizeStarCount(item.stars),
  };
}
