import { PluginHostId, PluginHostState } from "./types";

export async function withPluginStateTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutValue: T,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(timeoutValue), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function collectPluginHostStates(
  probes: readonly {
    hostId: PluginHostId;
    operation: Promise<PluginHostState>;
  }[],
  timeoutMs = 12_000,
): Promise<Map<PluginHostId, PluginHostState>> {
  const settled = await Promise.allSettled(
    probes.map(({ hostId, operation }) =>
      withPluginStateTimeout(
        operation.catch((error) => ({
          hostId,
          status: "error" as const,
          reason: error instanceof Error ? error.message : String(error),
        })),
        timeoutMs,
        {
          hostId,
          status: "error" as const,
          reason: "Plugin state probe timed out.",
        },
      ),
    ),
  );
  const states = new Map<PluginHostId, PluginHostState>();
  for (const result of settled) {
    if (result.status === "fulfilled") {
      states.set(result.value.hostId, result.value);
    }
  }
  return states;
}
