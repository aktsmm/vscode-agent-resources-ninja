export type IndexRefreshRecoveryDecision = "skipped" | "refresh" | "declined";

export type ReinstallFailureKind =
  | "rate-limit"
  | "server-error"
  | "transport"
  | "sso-required"
  | "classic-pat-forbidden"
  | "auth-required"
  | "not-found"
  | "incomplete"
  | "cancelled"
  | "other";

export interface ReinstallTask<T> {
  name: string;
  remove: () => Promise<void>;
  install: () => Promise<T>;
}

export interface ReinstallTaskResult<T> {
  success: boolean;
  attempts: number;
  removed: boolean;
  stage: "not-started" | "remove" | "install" | "complete";
  failureKind?: ReinstallFailureKind;
  error?: unknown;
  value?: T;
}

export interface ReinstallBatchRecord<T> {
  task: ReinstallTask<T>;
  result: ReinstallTaskResult<T>;
}

export class ReinstallAttemptError extends Error {
  constructor(
    public readonly kind: ReinstallFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "ReinstallAttemptError";
  }
}

const REINSTALL_RETRYABLE_FAILURE_KINDS = new Set<ReinstallFailureKind>([
  "server-error",
  "transport",
]);

export function classifyReinstallFailure(error: unknown): ReinstallFailureKind {
  if (error instanceof ReinstallAttemptError) {
    return error.kind;
  }
  const candidate = error as
    | { kind?: unknown; rootCauseKind?: unknown }
    | undefined;
  const kind = candidate?.rootCauseKind ?? candidate?.kind;
  return typeof kind === "string" &&
    [
      "rate-limit",
      "server-error",
      "transport",
      "sso-required",
      "classic-pat-forbidden",
      "auth-required",
      "not-found",
    ].includes(kind)
    ? (kind as ReinstallFailureKind)
    : "other";
}

export function isReinstallRetryable(kind?: ReinstallFailureKind): boolean {
  return !!kind && REINSTALL_RETRYABLE_FAILURE_KINDS.has(kind);
}

export async function runReinstallTask<T>(
  task: ReinstallTask<T>,
  options: {
    skipRemoval?: boolean;
    alreadyRemoved?: boolean;
    initialAttempts?: number;
    automaticRetries?: number;
  } = {},
): Promise<ReinstallTaskResult<T>> {
  let removed = options.alreadyRemoved === true;
  let attempts = options.initialAttempts ?? 0;
  if (!options.skipRemoval) {
    try {
      await task.remove();
      removed = true;
    } catch (error) {
      return {
        success: false,
        attempts,
        removed,
        stage: "remove",
        failureKind: classifyReinstallFailure(error),
        error,
      };
    }
  }

  const maximumAttempts = attempts + 1 + (options.automaticRetries ?? 1);
  while (attempts < maximumAttempts) {
    attempts++;
    try {
      return {
        success: true,
        attempts,
        removed,
        stage: "complete",
        value: await task.install(),
      };
    } catch (error) {
      const failureKind = classifyReinstallFailure(error);
      if (!isReinstallRetryable(failureKind) || attempts >= maximumAttempts) {
        return {
          success: false,
          attempts,
          removed,
          stage: "install",
          failureKind,
          error,
        };
      }
    }
  }

  throw new Error("Unreachable reinstall attempt state");
}

export async function runReinstallBatch<T>(
  tasks: readonly ReinstallTask<T>[],
  options: {
    isCancellationRequested?: () => boolean;
    onProgress?: (task: ReinstallTask<T>, index: number) => void;
  } = {},
): Promise<ReinstallBatchRecord<T>[]> {
  const records: ReinstallBatchRecord<T>[] = [];
  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index];
    if (options.isCancellationRequested?.()) {
      records.push(
        ...tasks.slice(index).map((unstartedTask) => ({
          task: unstartedTask,
          result: {
            success: false,
            attempts: 0,
            removed: false,
            stage: "not-started" as const,
            failureKind: "cancelled" as const,
          },
        })),
      );
      break;
    }
    options.onProgress?.(task, index);
    records.push({ task, result: await runReinstallTask(task) });
  }
  return records;
}

export async function retryReinstallBatch<T>(
  records: readonly ReinstallBatchRecord<T>[],
): Promise<ReinstallBatchRecord<T>[]> {
  const retried: ReinstallBatchRecord<T>[] = [];
  for (const record of records) {
    if (
      record.result.stage !== "install" ||
      !isReinstallRetryable(record.result.failureKind)
    ) {
      retried.push(record);
      continue;
    }
    retried.push({
      task: record.task,
      result: await runReinstallTask(record.task, {
        skipRemoval: true,
        alreadyRemoved: record.result.removed,
        initialAttempts: record.result.attempts,
        automaticRetries: 0,
      }),
    });
  }
  return retried;
}

export interface IndexRefreshRecoveryOptions {
  /** Set by callers that await this decision inside a batch or an automatic flow. */
  suppressRecoveryPrompt: boolean;
  message: string;
  refreshLabel: string;
  declineLabel: string;
  showPrompt: (
    message: string,
    ...items: string[]
  ) => PromiseLike<string | undefined>;
}

/**
 * A non-modal notification only settles once it is answered, so awaiting one on
 * behalf of a batch or background caller can hold that caller forever.
 */
export async function decideIndexRefreshRecovery(
  options: IndexRefreshRecoveryOptions,
): Promise<IndexRefreshRecoveryDecision> {
  if (options.suppressRecoveryPrompt) {
    return "skipped";
  }
  const choice = await options.showPrompt(
    options.message,
    options.refreshLabel,
    options.declineLabel,
  );
  return choice === options.refreshLabel ? "refresh" : "declined";
}
