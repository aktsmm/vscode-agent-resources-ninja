const CHECK_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;

export type WorkspaceUpdateCheckResult<T> =
  | { status: "not-due" }
  | { status: "checked"; complete: boolean; value: T };

export interface WorkspaceUpdateScheduleOptions<T> {
  getLastSuccess(): unknown;
  saveLastSuccess(time: number): PromiseLike<void>;
  check(): Promise<{ complete: boolean; value: T }>;
  now(): number;
}

export function createWorkspaceUpdateSchedule<T>(
  options: WorkspaceUpdateScheduleOptions<T>,
): {
  run(force?: boolean): Promise<WorkspaceUpdateCheckResult<T>>;
} {
  let pending: Promise<WorkspaceUpdateCheckResult<T>> | undefined;

  return {
    run(force = false) {
      if (pending) {
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
        const result = await options.check();
        if (result.complete) {
          await options.saveLastSuccess(options.now());
        }
        return { status: "checked", ...result } as const;
      })().finally(() => {
        pending = undefined;
      });
      return pending;
    },
  };
}
