// Decides how one explicitly requested reinstall may replace an installed copy.
// Kept free of `vscode` imports so plain-Node regression scripts can load the real code.

import type { ResourceKind } from "./skillIndex";

export type SingleReinstallScope = "workspace" | "userData" | "globalHome";

export type SingleReinstallDecision =
  | { mode: "staged" }
  | { mode: "in-place-file" }
  | { mode: "blocked"; reason: "kind" | "scope" };

/** Kinds that are one plain file plus a metadata sidecar and nothing else. */
const IN_PLACE_FILE_KINDS: ReadonlySet<ResourceKind> = new Set<ResourceKind>([
  "agent",
  "prompt",
  "instruction",
  "cursor-rule",
]);

/**
 * A single reinstall never moves the current copy aside before the new one is
 * downloaded and verified.
 *
 * - A skill folder in an ordinary local workspace has the staged replacement
 *   (`workspaceSkillUpdate.ts`).
 * - A single-file kind (agent, prompt, instruction, cursor rule) keeps the current file
 *   and its sidecar saved, installs over them after the download succeeds, and restores
 *   them on failure (`singleFileReplace.ts`), in any scope.
 * - Everything else is refused before anything is removed, because the delete-first
 *   sequence would leave the user with no copy if the download or install failed
 *   afterwards: hook and MCP installs also rewrite a shared configuration file, a plugin is
 *   a managed folder with registrations, and a skill outside the workspace has no staging
 *   location.
 *
 * Reinstall All, group and multiple-selection reinstall are separate, explicit
 * repair actions that keep the trash-first sequence; they do not use this policy.
 */
export function decideSingleReinstall(
  kind: ResourceKind,
  scope: SingleReinstallScope,
): SingleReinstallDecision {
  if (IN_PLACE_FILE_KINDS.has(kind)) {
    return { mode: "in-place-file" };
  }
  if (kind !== "skill") {
    return { mode: "blocked", reason: "kind" };
  }
  if (scope !== "workspace") {
    return { mode: "blocked", reason: "scope" };
  }
  return { mode: "staged" };
}

/**
 * Batch callers pass the suppress flags or `beforeRemove`; a menu click passes
 * none of them. Only the latter is a single, explicit reinstall.
 */
export function isExplicitSingleReinstall(options: {
  suppressSuccessMessage?: boolean;
  suppressRecoveryPrompt?: boolean;
  beforeRemove?: unknown;
}): boolean {
  return (
    options.suppressSuccessMessage !== true &&
    options.suppressRecoveryPrompt !== true &&
    options.beforeRemove === undefined
  );
}
