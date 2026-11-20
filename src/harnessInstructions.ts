// Instruction files for harnesses other than Copilot: Codex reads `AGENTS.md` and
// Claude Code reads `.claude/rules`. Neither understands `applyTo`, so this module
// decides what can be carried over faithfully and what must be held back.
// Kept free of `vscode` imports so plain-Node regression scripts can load the real code.

import * as os from "os";
import * as path from "path";

export type HarnessInstallScope =
  | "claudeRules"
  | "claudeUserRules"
  | "codexInstructions"
  | "codexUserInstructions";

export const HARNESS_INSTALL_SCOPES: readonly HarnessInstallScope[] = [
  "claudeRules",
  "claudeUserRules",
  "codexInstructions",
  "codexUserInstructions",
];

export function isHarnessInstallScope(
  value: unknown,
): value is HarnessInstallScope {
  return (
    typeof value === "string" &&
    (HARNESS_INSTALL_SCOPES as readonly string[]).includes(value)
  );
}

/** A personal scope affects every project of the user, so it is never a default. */
export function isPersonalHarnessScope(scope: HarnessInstallScope): boolean {
  return scope === "claudeUserRules" || scope === "codexUserInstructions";
}

export function isCodexHarnessScope(scope: HarnessInstallScope): boolean {
  return scope === "codexInstructions" || scope === "codexUserInstructions";
}

export function resolveCodexHome(
  env: Readonly<Record<string, string | undefined>> = process.env,
  homeDir: string = os.homedir(),
): string {
  const configured = env.CODEX_HOME?.trim();
  return configured ? path.resolve(configured) : path.join(homeDir, ".codex");
}

export function getHarnessInstructionDirectory(
  scope: HarnessInstallScope,
  workspaceFsPath: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  homeDir: string = os.homedir(),
): string {
  switch (scope) {
    case "claudeRules":
      return path.join(workspaceFsPath, ".claude", "rules");
    case "claudeUserRules":
      return path.join(homeDir, ".claude", "rules");
    case "codexInstructions":
      return path.join(workspaceFsPath, "instructions");
    case "codexUserInstructions":
    default:
      return path.join(resolveCodexHome(env, homeDir), "instructions");
  }
}

export interface CodexGuidanceFiles {
  /** Folder that holds `AGENTS.md`; the instructions folder sits next to it. */
  guidanceDirectory: string;
  agentsPath: string;
  overridePath: string;
  instructionsDirectory: string;
}

export function getCodexGuidanceFiles(
  scope: HarnessInstallScope,
  workspaceFsPath: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
  homeDir: string = os.homedir(),
): CodexGuidanceFiles {
  const guidanceDirectory =
    scope === "codexUserInstructions"
      ? resolveCodexHome(env, homeDir)
      : workspaceFsPath;
  return {
    guidanceDirectory,
    agentsPath: path.join(guidanceDirectory, "AGENTS.md"),
    overridePath: path.join(guidanceDirectory, "AGENTS.override.md"),
    instructionsDirectory: path.join(guidanceDirectory, "instructions"),
  };
}

// ---------------------------------------------------------------------------
// Codex: one managed block in AGENTS.md that points at the instructions folder
// ---------------------------------------------------------------------------

export const CODEX_INSTRUCTIONS_MARKERS = {
  start: "<!-- resource-ninja-instructions-START -->",
  end: "<!-- resource-ninja-instructions-END -->",
} as const;

export function renderCodexInstructionsBlock(eol: string = "\n"): string {
  return [
    CODEX_INSTRUCTIONS_MARKERS.start,
    "## Instructions",
    "",
    "Managed by Agent Resources Ninja. Individual instruction files are not listed here.",
    "Before starting work, read the files in [instructions/](./instructions/) that are relevant to the task.",
    CODEX_INSTRUCTIONS_MARKERS.end,
  ].join(eol);
}

export type CodexLinkAction =
  | "create"
  | "append"
  | "update"
  | "unchanged"
  | "blocked";

export interface CodexLinkPlan {
  action: CodexLinkAction;
  /** Text to write; equals `baseText` unless the action writes. */
  nextText: string;
  baseText: string | undefined;
  /** Lines the extension adds to AGENTS.md, for the preview. */
  addedLines: string[];
  blockedReason?: "override-file" | "malformed-markers";
}

function detectEol(text: string | undefined): string {
  return text?.includes("\r\n") ? "\r\n" : "\n";
}

interface MarkerSpan {
  start: number;
  end: number;
}

function findManagedBlock(
  text: string,
): MarkerSpan | "none" | "malformed" {
  const { start, end } = CODEX_INSTRUCTIONS_MARKERS;
  const first = text.indexOf(start);
  const lastStart = text.lastIndexOf(start);
  const firstEnd = text.indexOf(end);
  const lastEnd = text.lastIndexOf(end);
  if (first === -1 && firstEnd === -1) {
    return "none";
  }
  if (
    first === -1 ||
    firstEnd === -1 ||
    first !== lastStart ||
    firstEnd !== lastEnd ||
    firstEnd < first
  ) {
    return "malformed";
  }
  return { start: first, end: firstEnd + end.length };
}

/**
 * Decides what the one managed block in AGENTS.md should become. Everything
 * outside the markers is preserved byte for byte, and an `AGENTS.override.md` or
 * a marker pair that cannot be trusted stops the change instead of guessing.
 */
export function planCodexInstructionsLink(
  existingText: string | undefined,
  options: { overrideExists: boolean },
): CodexLinkPlan {
  const eol = detectEol(existingText);
  const block = renderCodexInstructionsBlock(eol);
  const addedLines = block.split(eol);

  if (options.overrideExists) {
    return {
      action: "blocked",
      blockedReason: "override-file",
      nextText: existingText ?? "",
      baseText: existingText,
      addedLines: [],
    };
  }
  if (existingText === undefined) {
    return {
      action: "create",
      nextText: `${block}${eol}`,
      baseText: undefined,
      addedLines,
    };
  }

  const span = findManagedBlock(existingText);
  if (span === "malformed") {
    return {
      action: "blocked",
      blockedReason: "malformed-markers",
      nextText: existingText,
      baseText: existingText,
      addedLines: [],
    };
  }
  if (span === "none") {
    const trimmedEnd = existingText.replace(/[\r\n\s]+$/, "");
    const separator = trimmedEnd.length === 0 ? "" : `${eol}${eol}`;
    return {
      action: "append",
      nextText: `${trimmedEnd}${separator}${block}${eol}`,
      baseText: existingText,
      addedLines,
    };
  }

  const nextText = `${existingText.slice(0, span.start)}${block}${existingText.slice(span.end)}`;
  return {
    action: nextText === existingText ? "unchanged" : "update",
    nextText,
    baseText: existingText,
    addedLines: nextText === existingText ? [] : addedLines,
  };
}

export interface CodexLinkRemoval {
  changed: boolean;
  nextText: string;
  /** Only the managed block was in the file, so the file itself can go. */
  empty: boolean;
  blockedReason?: "malformed-markers";
}

/** Removes only the extension's block; hand-written text stays. */
export function removeCodexInstructionsLink(text: string): CodexLinkRemoval {
  const span = findManagedBlock(text);
  if (span === "none") {
    return { changed: false, nextText: text, empty: false };
  }
  if (span === "malformed") {
    return {
      changed: false,
      nextText: text,
      empty: false,
      blockedReason: "malformed-markers",
    };
  }
  const eol = detectEol(text);
  const before = text.slice(0, span.start);
  const after = text.slice(span.end);
  const hasBefore = before.trim().length > 0;
  const hasAfter = after.trim().length > 0;
  if (!hasBefore && !hasAfter) {
    return { changed: true, nextText: "", empty: true };
  }
  const keptBefore = hasBefore
    ? before.replace(/\s+$/, "") + (hasAfter ? `${eol}${eol}` : eol)
    : "";
  const keptAfter = hasAfter ? after.replace(/^(\r?\n)+/, "") : "";
  return { changed: true, nextText: `${keptBefore}${keptAfter}`, empty: false };
}

// ---------------------------------------------------------------------------
// Claude Code: `.claude/rules` reads `paths`, not `applyTo`
// ---------------------------------------------------------------------------

export type ClaudeDeferralReason =
  | "no-applyTo"
  | "unsupported-applyTo"
  | "invalid-frontmatter";

export type ClaudeRuleConversion =
  | {
      status: "converted";
      mode: "scoped" | "always" | "native";
      content: string;
      paths: string[];
    }
  | {
      status: "deferred";
      reason: ClaudeDeferralReason;
      detail?: string;
    };

interface ParsedFrontmatter {
  state: "none" | "invalid" | "found";
  lines: string[];
  body: string;
  eol: string;
  bom: string;
}

function splitFrontmatter(text: string): ParsedFrontmatter {
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const source = bom ? text.slice(1) : text;
  const eol = detectEol(source);
  if (!/^---[ \t]*(\r?\n|$)/.test(source)) {
    return { state: "none", lines: [], body: source, eol, bom };
  }
  const empty = /^---[ \t]*\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  if (empty) {
    return {
      state: "found",
      lines: [],
      body: source.slice(empty[0].length),
      eol,
      bom,
    };
  }
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(
    source,
  );
  if (!match) {
    return { state: "invalid", lines: [], body: source, eol, bom };
  }
  return {
    state: "found",
    lines: match[1].split(/\r?\n/),
    body: source.slice(match[0].length),
    eol,
    bom,
  };
}

const TOP_LEVEL_KEY = /^([A-Za-z0-9_][A-Za-z0-9_-]*)[ \t]*:(.*)$/;

function findTopLevelKeyIndexes(lines: string[], key: string): number[] {
  const indexes: number[] = [];
  lines.forEach((line, index) => {
    const match = TOP_LEVEL_KEY.exec(line);
    if (match && match[1] === key) {
      indexes.push(index);
    }
  });
  return indexes;
}

/** A scalar value on one line, or `undefined` when YAML makes it ambiguous. */
function readSingleLineScalar(
  lines: string[],
  index: number,
): string | undefined {
  const rawValue = (TOP_LEVEL_KEY.exec(lines[index])?.[2] ?? "").trim();
  const next = lines[index + 1];
  if (next !== undefined && /^[ \t]+\S|^-(\s|$)/.test(next)) {
    return undefined;
  }
  if (rawValue.length === 0 || /^[|>]/.test(rawValue)) {
    return undefined;
  }
  if (rawValue.startsWith('"')) {
    const quoted = /^("(?:[^"\\]|\\.)*")[ \t]*(?:#.*)?$/.exec(rawValue);
    if (!quoted) {
      return undefined;
    }
    try {
      const parsed: unknown = JSON.parse(quoted[1]);
      return typeof parsed === "string" ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  if (rawValue.startsWith("'")) {
    const quoted = /^'((?:[^']|'')*)'[ \t]*(?:#.*)?$/.exec(rawValue);
    return quoted ? quoted[1].replace(/''/g, "'") : undefined;
  }
  if (/^[[{&!%@`]/.test(rawValue) || /[ \t]#/.test(rawValue)) {
    return undefined;
  }
  return rawValue;
}

function splitTopLevelCommas(value: string): string[] | undefined {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const character of value) {
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth < 0) {
        return undefined;
      }
    }
    if (character === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  if (depth !== 0) {
    return undefined;
  }
  parts.push(current);
  return parts.map((part) => part.trim());
}

const SAFE_PATTERN_CHARACTERS = /^[A-Za-z0-9_.\-/*{},]+$/;
const SAFE_BRACE_GROUP = /\{([A-Za-z0-9_.-]+(?:,[A-Za-z0-9_.-]+)*)\}/g;
const MAX_BRACE_GROUPS = 2;

function isConvertibleGlob(pattern: string): boolean {
  if (pattern.length === 0 || !SAFE_PATTERN_CHARACTERS.test(pattern)) {
    return false;
  }
  if (pattern.startsWith("/") || pattern.endsWith("/")) {
    return false;
  }
  if (pattern.split("/").some((segment) => segment === ".." || segment === "")) {
    return false;
  }
  const groups = pattern.match(SAFE_BRACE_GROUP) ?? [];
  if (groups.length > MAX_BRACE_GROUPS) {
    return false;
  }
  // Anything left over after the well-formed groups must be brace-free.
  return !/[{}]/.test(pattern.replace(SAFE_BRACE_GROUP, ""));
}

export type ApplyToConversion =
  | { status: "always" }
  | { status: "scoped"; paths: string[] }
  | { status: "unsupported"; detail: string };

/**
 * `applyTo` is relative to the workspace root in VS Code and `paths` is relative to
 * the project root in Claude Code. A name pattern without a slash (`*.py`) matches
 * only the root in VS Code but anywhere in Claude Code, so it becomes `/*.py`.
 * Everything that is not a plain glob stays unconverted instead of being widened.
 */
export function convertApplyToForClaude(applyTo: string): ApplyToConversion {
  const parts = splitTopLevelCommas(applyTo);
  if (!parts) {
    return { status: "unsupported", detail: "unbalanced braces" };
  }
  const paths: string[] = [];
  for (const part of parts) {
    if (!isConvertibleGlob(part)) {
      return { status: "unsupported", detail: part || "(empty pattern)" };
    }
    if (part === "**" || part === "**/*") {
      return { status: "always" };
    }
    // A bare literal such as `docs` may name a file or a directory; the two
    // agents are only documented to agree on wildcard name patterns.
    if (!/[/*{]/.test(part)) {
      return { status: "unsupported", detail: part };
    }
    paths.push(part.includes("/") ? part : `/${part}`);
  }
  return { status: "scoped", paths: Array.from(new Set(paths)) };
}

export interface ClaudeConversionOptions {
  /** Install as an always-loaded rule when `applyTo` cannot be converted. */
  alwaysOnWhenDeferred?: boolean;
}

function renderFrontmatter(
  keptLines: string[],
  paths: string[] | undefined,
  note: string | undefined,
  eol: string,
): string {
  const lines = [...keptLines];
  if (note) {
    lines.push(`# ${note}`);
  }
  if (paths && paths.length > 0) {
    lines.push("paths:");
    for (const entry of paths) {
      lines.push(`  - ${JSON.stringify(entry)}`);
    }
  }
  return lines.length === 0 ? "" : `---${eol}${lines.join(eol)}${eol}---${eol}`;
}

/**
 * Turns a Copilot instruction file into a Claude rule. A rule without `paths` is
 * loaded every session, so a missing or unclear `applyTo` is never converted into
 * one unless the caller opted in.
 */
export function convertInstructionForClaudeRule(
  text: string,
  options: ClaudeConversionOptions = {},
): ClaudeRuleConversion {
  const parsed = splitFrontmatter(text);
  if (parsed.state === "invalid") {
    return options.alwaysOnWhenDeferred
      ? { status: "converted", mode: "always", content: text, paths: [] }
      : { status: "deferred", reason: "invalid-frontmatter" };
  }

  const applyToIndexes =
    parsed.state === "found"
      ? findTopLevelKeyIndexes(parsed.lines, "applyTo")
      : [];
  const pathsIndexes =
    parsed.state === "found"
      ? findTopLevelKeyIndexes(parsed.lines, "paths")
      : [];

  if (applyToIndexes.length === 0 && pathsIndexes.length > 0) {
    return { status: "converted", mode: "native", content: text, paths: [] };
  }

  const defer = (
    reason: ClaudeDeferralReason,
    detail?: string,
  ): ClaudeRuleConversion => {
    if (!options.alwaysOnWhenDeferred) {
      return { status: "deferred", reason, detail };
    }
    const kept =
      parsed.state === "found"
        ? parsed.lines.filter((_line, index) => !applyToIndexes.includes(index))
        : [];
    // Only a single-line applyTo can be dropped cleanly; keep the file otherwise.
    const droppable = applyToIndexes.length <= 1 &&
      applyToIndexes.every((index) => {
        const next = parsed.state === "found" ? parsed.lines[index + 1] : undefined;
        return next === undefined || !/^[ \t]+\S|^-(\s|$)/.test(next);
      });
    if (!droppable) {
      return { status: "deferred", reason, detail };
    }
    return {
      status: "converted",
      mode: "always",
      content: `${parsed.bom}${renderFrontmatter(kept, undefined, undefined, parsed.eol)}${parsed.body}`,
      paths: [],
    };
  };

  if (applyToIndexes.length === 0) {
    return defer("no-applyTo");
  }
  if (applyToIndexes.length > 1 || pathsIndexes.length > 0) {
    return defer("unsupported-applyTo", "duplicate or conflicting keys");
  }

  const applyToIndex = applyToIndexes[0];
  const applyTo = readSingleLineScalar(parsed.lines, applyToIndex);
  if (applyTo === undefined) {
    return defer("unsupported-applyTo", "multi-line or ambiguous value");
  }
  const conversion = convertApplyToForClaude(applyTo);
  if (conversion.status === "unsupported") {
    return defer("unsupported-applyTo", conversion.detail);
  }

  const kept = parsed.lines.filter((_line, index) => index !== applyToIndex);
  if (conversion.status === "always") {
    return {
      status: "converted",
      mode: "always",
      content: `${parsed.bom}${renderFrontmatter(kept, undefined, undefined, parsed.eol)}${parsed.body}`,
      paths: [],
    };
  }
  return {
    status: "converted",
    mode: "scoped",
    content: `${parsed.bom}${renderFrontmatter(
      kept,
      conversion.paths,
      `Converted from applyTo: ${applyTo}`,
      parsed.eol,
    )}${parsed.body}`,
    paths: conversion.paths,
  };
}

export class HarnessInstructionDeferredError extends Error {
  constructor(
    public readonly resourceName: string,
    public readonly reason: ClaudeDeferralReason,
    public readonly detail?: string,
  ) {
    super(`Claude rule deferred (${reason}): ${resourceName}`);
    this.name = "HarnessInstructionDeferredError";
  }
}

// ---------------------------------------------------------------------------
// Files: all writes go through a small interface so the logic runs on real files
// in tests and on the VS Code file system in the extension.
// ---------------------------------------------------------------------------

export interface HarnessFileSystem {
  readText(fsPath: string): Promise<string | undefined>;
  /** Replaces `fsPath` as one step; a failure leaves the previous file untouched. */
  writeTextAtomic(fsPath: string, text: string): Promise<void>;
  exists(fsPath: string): Promise<boolean>;
  /** File names directly inside `directoryFsPath`; empty when it does not exist. */
  listFileNames(directoryFsPath: string): Promise<string[]>;
  /** Moves a file to the trash (or removes it when there is none). */
  remove(fsPath: string): Promise<void>;
  isDirty(fsPath: string): Promise<boolean>;
}

export class HarnessLinkConflictError extends Error {
  constructor(
    public readonly reason: "dirty-document" | "changed-during-update",
    public readonly fsPath: string,
  ) {
    super(`AGENTS.md update stopped (${reason}): ${fsPath}`);
    this.name = "HarnessLinkConflictError";
  }
}

export interface CodexLinkPreview {
  files: CodexGuidanceFiles;
  plan: CodexLinkPlan;
}

export async function previewCodexInstructionsLink(
  fileSystem: HarnessFileSystem,
  files: CodexGuidanceFiles,
): Promise<CodexLinkPreview> {
  const [existingText, overrideExists] = await Promise.all([
    fileSystem.readText(files.agentsPath),
    fileSystem.exists(files.overridePath),
  ]);
  return {
    files,
    plan: planCodexInstructionsLink(existingText, { overrideExists }),
  };
}

/** Applies the planned AGENTS.md change, re-reading the file right before the swap. */
export async function applyCodexInstructionsLink(
  fileSystem: HarnessFileSystem,
  files: CodexGuidanceFiles,
): Promise<CodexLinkPlan> {
  const { plan } = await previewCodexInstructionsLink(fileSystem, files);
  if (plan.action === "blocked" || plan.action === "unchanged") {
    return plan;
  }
  if (await fileSystem.isDirty(files.agentsPath)) {
    throw new HarnessLinkConflictError("dirty-document", files.agentsPath);
  }
  const current = await fileSystem.readText(files.agentsPath);
  if (current !== plan.baseText) {
    throw new HarnessLinkConflictError(
      "changed-during-update",
      files.agentsPath,
    );
  }
  await fileSystem.writeTextAtomic(files.agentsPath, plan.nextText);
  return plan;
}

export type CodexLinkReconcileResult =
  | "not-managed"
  | "kept-in-use"
  | "removed"
  | "removed-file"
  | "blocked";

/**
 * After an instruction file was deleted: when the folder it lived in is the one the
 * managed block points at and nothing is left in it, take the block out again.
 * Ownership is proven by the markers, so a hand-written link is never touched.
 */
export async function reconcileCodexInstructionsLinkAfterRemoval(
  fileSystem: HarnessFileSystem,
  removedFileFsPath: string,
): Promise<CodexLinkReconcileResult> {
  const instructionsDirectory = path.dirname(removedFileFsPath);
  if (path.basename(instructionsDirectory) !== "instructions") {
    return "not-managed";
  }
  const agentsPath = path.join(path.dirname(instructionsDirectory), "AGENTS.md");
  const agentsText = await fileSystem.readText(agentsPath);
  if (agentsText === undefined) {
    return "not-managed";
  }
  const removal = removeCodexInstructionsLink(agentsText);
  if (removal.blockedReason) {
    return "blocked";
  }
  if (!removal.changed) {
    return "not-managed";
  }
  const remaining = (await fileSystem.listFileNames(instructionsDirectory)).filter(
    (name) => name.toLowerCase().endsWith(".md"),
  );
  if (remaining.length > 0) {
    return "kept-in-use";
  }
  if (await fileSystem.isDirty(agentsPath)) {
    throw new HarnessLinkConflictError("dirty-document", agentsPath);
  }
  if ((await fileSystem.readText(agentsPath)) !== agentsText) {
    throw new HarnessLinkConflictError("changed-during-update", agentsPath);
  }
  if (removal.empty) {
    await fileSystem.remove(agentsPath);
    return "removed-file";
  }
  await fileSystem.writeTextAtomic(agentsPath, removal.nextText);
  return "removed";
}

// ---------------------------------------------------------------------------
// Preview text shown before anything is written
// ---------------------------------------------------------------------------

export interface HarnessPreviewInput {
  scope: HarnessInstallScope;
  destinationDirectory: string;
  fileNames: string[];
  codex?: CodexLinkPreview;
  isJa: boolean;
}

export function formatHarnessInstallPreview(input: HarnessPreviewInput): string {
  const { scope, destinationDirectory, fileNames, codex, isJa } = input;
  const lines: string[] = [];
  const list = fileNames.slice(0, 5).join(", ");
  const more = fileNames.length > 5 ? ` (+${fileNames.length - 5})` : "";
  lines.push(
    isJa
      ? `保存先: ${destinationDirectory}`
      : `Destination: ${destinationDirectory}`,
  );
  lines.push(isJa ? `ファイル: ${list}${more}` : `Files: ${list}${more}`);

  if (isCodexHarnessScope(scope) && codex) {
    const { plan, files } = codex;
    lines.push(isJa ? `AGENTS.md: ${files.agentsPath}` : `AGENTS.md: ${files.agentsPath}`);
    switch (plan.action) {
      case "create":
      case "append":
      case "update":
        lines.push(
          isJa
            ? `AGENTS.md に次の管理ブロックを ${plan.action === "create" ? "新規作成" : plan.action === "append" ? "追記" : "更新"}します（管理ブロック外の本文は変更しません）:`
            : `AGENTS.md will get this managed block (${plan.action}; text outside the markers is not changed):`,
        );
        lines.push(...plan.addedLines.map((line) => `  + ${line}`));
        break;
      case "unchanged":
        lines.push(
          isJa
            ? "AGENTS.md には既に同じ管理ブロックがあり、変更しません。"
            : "AGENTS.md already has the same managed block and is left unchanged.",
        );
        break;
      case "blocked":
        lines.push(
          plan.blockedReason === "override-file"
            ? isJa
              ? `AGENTS.override.md があり、Codex はそちらを優先します。AGENTS.md は変更しません。次の案内を ${files.overridePath} に手で追記してください。`
              : `AGENTS.override.md exists and Codex prefers it, so AGENTS.md is not changed. Add the following guidance to ${files.overridePath} yourself.`
            : isJa
              ? "AGENTS.md の管理マーカーが壊れているため変更しません。マーカーを確認してください。"
              : "The managed markers in AGENTS.md are damaged, so it is not changed. Check the markers.",
        );
        if (plan.blockedReason === "override-file") {
          lines.push(
            ...renderCodexInstructionsBlock()
              .split("\n")
              .map((line) => `  ${line}`),
          );
        }
        break;
    }
    lines.push(
      isJa
        ? "注意: リンクだけでは自動で読み込まれません。Copilot の applyTo は Codex では適用されません。読むかどうかは Codex の判断です。AGENTS.md は他のエージェントも読む場合があります。"
        : "Note: a link is not loaded automatically, and Copilot's applyTo is not applied by Codex; whether a file is read is up to Codex. Other agents may read AGENTS.md too.",
    );
  } else {
    lines.push(
      isJa
        ? "Claude Code は .claude/rules を自動で検出します。CLAUDE.md への登録は行いません。applyTo は意味が一致するものだけ paths に変換し、それ以外は保留します。"
        : "Claude Code discovers .claude/rules on its own, so CLAUDE.md is not edited. applyTo is converted to paths only when the meaning matches; anything else is held back.",
    );
  }
  if (isPersonalHarnessScope(scope)) {
    lines.push(
      isJa
        ? "個人用の保存先です。すべてのプロジェクトに影響します。"
        : "This is a personal location and affects every project.",
    );
  }
  return lines.join("\n");
}
