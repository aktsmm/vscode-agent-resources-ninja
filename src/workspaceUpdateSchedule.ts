const CHECK_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;

export type WorkspaceUpdateCheckResult<T> =
  | { status: "not-due" }
  | { status: "cancelled" }
  | { status: "checked"; complete: boolean; value: T };

export interface WorkspaceUpdateScheduleOptions<T> {
  getLastSuccess(): unknown;
  saveLastSuccess(time: number): PromiseLike<void>;
  check(includeMissingBaseline?: boolean, signal?: AbortSignal): Promise<{ complete: boolean; value: T }>;
  now(): number;
}

export function createWorkspaceUpdateSchedule<T>(
  options: WorkspaceUpdateScheduleOptions<T>,
): {
  run(
    force?: boolean,
    includeMissingBaseline?: boolean,
    signal?: AbortSignal,
  ): Promise<WorkspaceUpdateCheckResult<T>>;
} {
  let pending: Promise<WorkspaceUpdateCheckResult<T>> | undefined;

  return {
    run(force = false, includeMissingBaseline = false, signal) {
      if (signal?.aborted) {
        return Promise.resolve({ status: "cancelled" });
      }
      if (pending) {
        if (force) {
          const queued = pending;
          return new Promise((resolve, reject) => {
            const cancel = () => {
              signal?.removeEventListener("abort", cancel);
              resolve({ status: "cancelled" });
            };
            const resume = () => {
              signal?.removeEventListener("abort", cancel);
              if (!signal?.aborted) {
                this.run(force, includeMissingBaseline, signal).then(resolve, reject);
              }
            };
            signal?.addEventListener("abort", cancel, { once: true });
            if (signal?.aborted) {
              cancel();
            }
            void queued.then(resume, resume);
          });
        }
        return pending;
      }

      const last = options.getLastSuccess();
      const now = options.now();
      if (
        !force &&
        typeof last === "number" &&
        Number.isFinite(last) &&
        last >= 0 &&
        last <= now &&
        now - last < CHECK_INTERVAL_MS
      ) {
        return Promise.resolve({ status: "not-due" });
      }

      pending = (async () => {
        const result = await options.check(includeMissingBaseline, signal);
        if (signal?.aborted) {
          return { status: "cancelled" } as const;
        }
        if (result.complete) {
          await options.saveLastSuccess(options.now());
        }
        if (signal?.aborted) {
          return { status: "cancelled" } as const;
        }
        return { status: "checked", ...result } as const;
      })().finally(() => {
        pending = undefined;
      });
      return pending;
    },
  };
}
