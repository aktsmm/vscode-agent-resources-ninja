/**
 * Language model tools の対象解決（vscode 非依存）。
 * 名前だけでは同名リソース（public と private など）を区別できないため、
 * source / path を ID として受け取り、曖昧なときは先頭を選ばず候補を返す。
 */
import type { ResourceKind } from "./skillIndex";

export interface ResourceSelector {
  name?: string;
  kind?: ResourceKind;
  source?: string;
  path?: string;
}

export interface SelectableResource {
  name: string;
  kind?: ResourceKind;
  source?: string;
}

export interface ResourceSelection<T> {
  match?: T;
  candidates: T[];
  reason?: "empty" | "ambiguous" | "missing";
}

/** 型が不正な入力（モデルが数値などを渡す場合）を空文字に落とす。 */
export function toSelectorText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeSelectorSource(value: unknown): string {
  return toSelectorText(value)
    .toLowerCase()
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}

export function normalizeSelectorPath(value: unknown): string {
  return (
    toSelectorText(value)
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .replace(/\/+$/, "")
      .toLowerCase()
      // A skill is identified by its folder; the index lists its SKILL.md.
      .replace(/\/skill\.md$/, "")
  );
}

function pathCandidates(
  value: string | string[] | undefined,
): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.map((entry) => normalizeSelectorPath(entry));
}

/** Returns the unrecognized text when `kind` is set but is not a known kind. */
export function findUnknownKind(
  kind: unknown,
  known: readonly string[],
): string | undefined {
  const text = toSelectorText(kind).toLowerCase();
  if (!text || text === "all" || known.includes(text)) {
    return undefined;
  }
  return toSelectorText(kind);
}

export function selectResource<T extends SelectableResource>(
  resources: T[],
  selector: ResourceSelector,
  getPath: (resource: T) => string | string[] | undefined,
): ResourceSelection<T> {
  const name = toSelectorText(selector.name).toLowerCase();
  const path = normalizeSelectorPath(selector.path);
  const source = normalizeSelectorSource(selector.source);
  if (!name && !path) {
    return { candidates: [], reason: "empty" };
  }

  const narrowed = resources.filter((resource) => {
    if (selector.kind && (resource.kind || "skill") !== selector.kind) {
      return false;
    }
    if (source && normalizeSelectorSource(resource.source) !== source) {
      return false;
    }
    return true;
  });

  const exact = narrowed.filter((resource) => {
    if (path && !pathCandidates(getPath(resource)).includes(path)) {
      return false;
    }
    return !name || resource.name.toLowerCase() === name;
  });
  if (exact.length === 1) {
    return { match: exact[0], candidates: exact };
  }
  if (exact.length > 1) {
    return { candidates: exact, reason: "ambiguous" };
  }

  // 部分一致は「もしかして」として返すだけで、対象には決めない。
  const similar = name
    ? narrowed.filter((resource) => resource.name.toLowerCase().includes(name))
    : [];
  return { candidates: similar, reason: "missing" };
}
