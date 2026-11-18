import type * as vscode from "vscode";
import type {
  DirtyDocumentGuard,
  WorkspaceSkillApplyResult,
  WorkspaceSkillApproval,
  WorkspaceSkillCandidate,
  WorkspaceSkillPrepareResult,
} from "./workspaceSkillUpdate";

export interface WorkspaceUpdateTarget {
  readonly workspace: vscode.Uri;
  readonly target: vscode.Uri;
  readonly label: string;
}

/** Bytes must be verified against the candidate's saved and staged snapshots. */
export interface WorkspaceUpdateDiff {
  readonly path: string;
  readonly local?: Uint8Array;
  readonly staged?: Uint8Array;
}

export interface WorkspaceUpdateOutcome {
  readonly target: WorkspaceUpdateTarget;
  readonly status:
    | "updated"
    | "unchanged"
    | "skipped"
    | "failed"
    | "recovery-required";
  readonly reason?: string;
  readonly recoveryDirectory?: vscode.Uri;
}

export interface WorkspaceUpdateUiDependencies {
  notify(
    targets: readonly WorkspaceUpdateTarget[],
  ): Promise<"bulk" | "details" | undefined>;
  /** Explain that local edits are skipped and sharing/sync detection is incomplete. */
  confirmBulk(targets: readonly WorkspaceUpdateTarget[]): Promise<boolean>;
  chooseTarget(
    targets: readonly WorkspaceUpdateTarget[],
  ): Promise<WorkspaceUpdateTarget | undefined>;
  /** Must reject if either snapshot no longer matches the pinned candidate. */
  getVerifiedDiffs(
    candidate: WorkspaceSkillCandidate,
  ): Promise<readonly WorkspaceUpdateDiff[]>;
  showDetails(
    candidate: WorkspaceSkillCandidate,
    diffs: readonly WorkspaceUpdateDiff[],
  ): Promise<"update" | "close">;
  /** Warn about uncertain sharing/sync and any saved edits that will be overwritten. */
  confirmSingle(candidate: WorkspaceSkillCandidate): Promise<boolean>;
  prepare(target: WorkspaceUpdateTarget): Promise<WorkspaceSkillPrepareResult>;
  apply(
    candidate: WorkspaceSkillCandidate,
    approval: WorkspaceSkillApproval,
    guard: DirtyDocumentGuard,
  ): Promise<WorkspaceSkillApplyResult>;
  discard(candidate: WorkspaceSkillCandidate): Promise<"discarded" | "preserved">;
  /** Also blocks known shared roots; unknown or dirty documents are not writable. */
  guard: DirtyDocumentGuard;
  classifyBlocked(reason: string): "skip" | "failure" | "rate-limit";
  isRateLimit(error: unknown): boolean;
  isCancelled(): boolean;
  report(outcomes: readonly WorkspaceUpdateOutcome[]): Promise<void>;
  log(message: string, error?: unknown): void;
}

/**
 * Presents only already-checked changed targets. No preparation occurs before
 * the user selects an action; the caller owns scheduling and revision checks.
 */
export async function presentWorkspaceSkillUpdates(
  targets: readonly WorkspaceUpdateTarget[],
  ui: WorkspaceUpdateUiDependencies,
  /** Set only when the user has already pressed a bulk action, such as retrying failures. */
  initialAction?: "bulk",
): Promise<readonly WorkspaceUpdateOutcome[]> {
  const outcomes: WorkspaceUpdateOutcome[] = [];
  let stopReason: "rate-limit" | "recovery-required" | undefined;
  if (!targets.length) {
    return outcomes;
  }

  const recordError = (target: WorkspaceUpdateTarget, error: unknown) => {
    ui.log("[Workspace update] Operation failed", error);
    const rateLimited = ui.isRateLimit(error);
    if (rateLimited) { stopReason = "rate-limit"; }
    outcomes.push({
      target,
      status: "failed",
      reason: rateLimited ? "rate-limit" : "operation-failed",
    });
  };

  const recordBlocked = (
    target: WorkspaceUpdateTarget,
    reason: string,
    rateLimited = false,
    directory?: vscode.Uri,
  ) => {
    const classification = rateLimited ? "rate-limit" : ui.classifyBlocked(reason);
    if (classification === "rate-limit") { stopReason = "rate-limit"; }
    // A retained backup from an earlier update is surfaced, but it stops only this skill.
    if (directory) {
      outcomes.push({ target, status: "recovery-required", reason, recoveryDirectory: directory });
      return;
    }
    outcomes.push({
      target,
      status: classification === "skip" ? "skipped" : "failed",
      reason: classification === "rate-limit" ? "rate-limit" : reason,
    });
  };

  const process = async (
    target: WorkspaceUpdateTarget,
    mode: "bulk" | "single",
  ): Promise<void> => {
    if (stopReason) {
      outcomes.push({ target, status: "skipped", reason: stopReason });
      return;
    }
    if (ui.isCancelled()) {
      outcomes.push({ target, status: "skipped", reason: "cancelled" });
      return;
    }

    const outcomeIndex = outcomes.length;
    let candidate: WorkspaceSkillCandidate | undefined;
    let consumed = false;
    try {
      if ((await ui.guard(target.target)) !== "clean") {
        outcomes.push({ target, status: "skipped", reason: "dirty-or-unknown" });
        return;
      }
      const prepared = await ui.prepare(target);
      if (prepared.status === "cleanup-required") {
        stopReason = prepared.failureKind === "rate-limit" ? "rate-limit" : "recovery-required";
        ui.log("[Workspace update] Preparation cleanup required", prepared.reason);
        outcomes.push({
          target,
          status: "recovery-required",
          reason: prepared.cleanupReason,
          recoveryDirectory: prepared.directory,
        });
        return;
      }
      if (prepared.status === "blocked") {
        ui.log("[Workspace update] Preparation blocked", prepared.reason);
        recordBlocked(target, prepared.reason, prepared.failureKind === "rate-limit", prepared.directory);
        return;
      }
      if (prepared.status === "unchanged") {
        outcomes.push({ target, status: "unchanged" });
        return;
      }
      candidate = prepared.candidate;
      if (candidate.target.toString() !== target.target.toString()) {
        ui.log("[Workspace update] Candidate target mismatch");
        outcomes.push({ target, status: "failed", reason: "target-mismatch" });
        return;
      }
      if (ui.isCancelled()) {
        outcomes.push({ target, status: "skipped", reason: "cancelled" });
        return;
      }
      if (mode === "bulk" && candidate.localChanges.length) {
        outcomes.push({ target, status: "skipped", reason: "local-changes" });
        return;
      }
      if (mode === "single") {
        const diffs = await ui.getVerifiedDiffs(candidate);
        if (ui.isCancelled() || (await ui.showDetails(candidate, diffs)) !== "update") {
          outcomes.push({ target, status: "skipped", reason: "not-approved" });
          return;
        }
        if (ui.isCancelled() || !(await ui.confirmSingle(candidate))) {
          outcomes.push({ target, status: "skipped", reason: "not-approved" });
          return;
        }
      }
      if (ui.isCancelled()) {
        outcomes.push({ target, status: "skipped", reason: "cancelled" });
        return;
      }
      const result = await ui.apply(
        candidate,
        {
          candidateId: candidate.id,
          mode,
          ...(mode === "single" && candidate.localChanges.length
            ? { overwriteLocalChanges: true }
            : {}),
        },
        ui.guard,
      );
      if (result.status === "updated") {
        consumed = true;
        outcomes.push({ target, status: "updated", recoveryDirectory: result.backup });
      } else if (result.status === "recovery-required") {
        stopReason = "recovery-required";
        consumed = true;
        ui.log("[Workspace update] Recovery required", result.reason);
        outcomes.push({
          target,
          status: "recovery-required",
          reason: result.reason,
          recoveryDirectory: result.backup,
        });
      } else if (result.status === "rolled-back") {
        consumed = true;
        ui.log("[Workspace update] Update rolled back", result.reason);
        outcomes.push({
          target,
          status: "failed",
          reason: result.reason,
          recoveryDirectory: result.backup,
        });
      } else {
        ui.log("[Workspace update] Application blocked", result.reason);
        recordBlocked(target, result.reason);
      }
    } catch (error) {
      recordError(target, error);
    } finally {
      if (candidate && !consumed) {
        try {
          if ((await ui.discard(candidate)) !== "discarded") {
            stopReason = "recovery-required";
            ui.log("[Workspace update] Staged candidate was preserved");
            outcomes[outcomeIndex] = {
              target,
              status: "recovery-required",
              reason: "candidate-preserved",
              recoveryDirectory: candidate.recoveryDirectory,
            };
          }
        } catch (error) {
          stopReason = "recovery-required";
          ui.log("[Workspace update] Failed to discard candidate", error);
          outcomes[outcomeIndex] = {
            target,
            status: "recovery-required",
            reason: "discard-failed",
            recoveryDirectory: candidate.recoveryDirectory,
          };
        }
      }
    }
  };

  try {
    const action = initialAction ?? (await ui.notify(targets));
    if (action === "bulk") {
      if (await ui.confirmBulk(targets)) {
        for (const target of targets) {
          await process(target, "bulk");
        }
      }
    } else if (action === "details") {
      const remaining = [...targets];
      while (remaining.length && !ui.isCancelled() && !stopReason) {
        const target = await ui.chooseTarget(remaining);
        if (!target) {
          break;
        }
        const index = remaining.indexOf(target);
        if (index < 0) {
          ui.log("[Workspace update] Invalid selected target");
          break;
        }
        remaining.splice(index, 1);
        await process(target, "single");
      }
      if (stopReason) {
        for (const target of remaining) {
          outcomes.push({ target, status: "skipped", reason: stopReason });
        }
      }
    }
  } catch (error) {
    ui.log("[Workspace update] Presentation failed", error);
    throw error;
  }
  if (outcomes.length) {
    try {
      await ui.report(outcomes);
    } catch (error) {
      ui.log("[Workspace update] Result presentation failed", error);
      throw error;
    }
  }
  return outcomes;
}
