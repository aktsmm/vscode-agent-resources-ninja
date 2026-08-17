import {
  GITHUB_RATE_LIMIT_FALLBACK_WAIT_MS,
  isGitHubResponseError,
} from "./githubResponse";

export interface SourceIndexUpdateFailure<TEntry> {
  entry: TEntry;
  error: unknown;
}

export interface SourceIndexUpdateBatchResult<TEntry, TValue> {
  value: TValue;
  succeeded: TEntry[];
  failures: SourceIndexUpdateFailure<TEntry>[];
  skipped: TEntry[];
}

export async function runSourceIndexUpdateBatch<TEntry, TValue>(
  entries: TEntry[],
  initialValue: TValue,
  update: (value: TValue, entry: TEntry) => Promise<TValue>,
): Promise<SourceIndexUpdateBatchResult<TEntry, TValue>> {
  let value = initialValue;
  const succeeded: TEntry[] = [];
  const failures: SourceIndexUpdateFailure<TEntry>[] = [];
  let skipped: TEntry[] = [];

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    try {
      value = await update(value, entry);
      succeeded.push(entry);
    } catch (error) {
      failures.push({ entry, error });
      if (isGitHubResponseError(error) && error.kind === "rate-limit") {
        skipped = entries.slice(index + 1);
        break;
      }
    }
  }

  return { value, succeeded, failures, skipped };
}

/** Extra wait on top of the deadline, so a clock skew cannot retry a moment early. */
export const RATE_LIMIT_RESUME_MARGIN_MS = 5_000;
/** Spread simultaneous resumes so several sources do not stampede the reset. */
export const RATE_LIMIT_RESUME_JITTER_MS = 30_000;

/** Structurally the persisted resume record, minus the fields a claim adds. */
export interface RateLimitResumePlan {
  version: 1;
  sourceIds: string[];
  retryNotBefore: string;
  createdAt: string;
  attempts: number;
}

/**
 * The source that raised the rate limit lands in `failures`, never in `skipped`,
 * so resuming from the skipped list alone would silently abandon it.
 */
export function planRateLimitResume<TEntry extends { id: string }>(
  failures: readonly SourceIndexUpdateFailure<TEntry>[],
  skipped: readonly TEntry[],
  options?: { previousAttempts?: number; nowMs?: number },
): RateLimitResumePlan | undefined {
  const rateLimited = failures.find(
    (failure) =>
      isGitHubResponseError(failure.error) &&
      failure.error.kind === "rate-limit",
  );
  if (!rateLimited || !isGitHubResponseError(rateLimited.error)) {
    return undefined;
  }

  const nowMs = options?.nowMs ?? Date.now();
  const sourceIds: string[] = [];
  for (const id of [
    rateLimited.entry.id,
    ...skipped.map((entry) => entry.id),
  ]) {
    if (!sourceIds.includes(id)) {
      sourceIds.push(id);
    }
  }

  const deadline =
    rateLimited.error.retryNotBefore ??
    rateLimited.error.resetAt ??
    new Date(nowMs + GITHUB_RATE_LIMIT_FALLBACK_WAIT_MS).toISOString();

  return {
    version: 1,
    sourceIds,
    retryNotBefore: deadline,
    createdAt: new Date(nowMs).toISOString(),
    attempts: options?.previousAttempts ?? 0,
  };
}

export function getRateLimitResumeDelayMs(
  retryNotBefore: string,
  nowMs: number = Date.now(),
  random: number = Math.random(),
): number {
  const deadlineMs = Date.parse(retryNotBefore);
  const waitMs = Number.isFinite(deadlineMs) ? deadlineMs - nowMs : 0;
  return (
    Math.max(0, waitMs) +
    RATE_LIMIT_RESUME_MARGIN_MS +
    Math.round(random * RATE_LIMIT_RESUME_JITTER_MS)
  );
}

export type RateLimitResumeArming =
  | {
      action: "skip";
      reason: "disposed" | "no-record" | "attempts-exhausted";
    }
  | { action: "arm"; delayMs: number; waitingOnForeignClaim: boolean };

export interface RateLimitResumeArmingInput {
  retryNotBefore: string;
  attempts: number;
  claimedBy?: string;
  claimedAt?: string;
}

/**
 * The arming decision is kept free of timers and file access so every branch —
 * including the one that waits out another window's claim — can be asserted.
 */
export function planRateLimitResumeArming(
  record: RateLimitResumeArmingInput | undefined,
  options: {
    sessionId: string;
    claimStaleMs: number;
    nowMs?: number;
    random?: number;
    disposed?: boolean;
  },
): RateLimitResumeArming {
  if (options.disposed) {
    return { action: "skip", reason: "disposed" };
  }
  if (!record) {
    return { action: "skip", reason: "no-record" };
  }
  // One automatic resume per record: a second rate limit keeps its new deadline
  // for a manual retry instead of chaining timers indefinitely.
  if (record.attempts > 0) {
    return { action: "skip", reason: "attempts-exhausted" };
  }

  const nowMs = options.nowMs ?? Date.now();
  const claimedAtMs = record.claimedAt ? Date.parse(record.claimedAt) : NaN;
  const waitingOnForeignClaim =
    record.claimedBy !== undefined &&
    record.claimedBy !== options.sessionId &&
    Number.isFinite(claimedAtMs) &&
    nowMs - claimedAtMs < options.claimStaleMs;

  // Waking at the foreign claim's expiry is what makes a host that died holding
  // the claim recoverable without polling for it.
  const delayMs = waitingOnForeignClaim
    ? Math.max(0, claimedAtMs + options.claimStaleMs - nowMs) +
      RATE_LIMIT_RESUME_MARGIN_MS
    : getRateLimitResumeDelayMs(record.retryNotBefore, nowMs, options.random);

  return { action: "arm", delayMs, waitingOnForeignClaim };
}
