import * as crypto from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import {
  getAgentNinjaSharedDirectoryPath,
  SHARED_STORE_LOCK_FILE,
  SHARED_STORE_LOCK_HARD_STALE_MS,
  SHARED_STORE_LOCK_HEARTBEAT_MS,
  SHARED_STORE_LOCK_RETRY_COUNT,
  SHARED_STORE_RETRY_DELAY_MS,
  SHARED_STORE_LOCK_STALE_MS,
} from "./sharedManifest";
import { logger } from "./logger";

// The lock is shared with the skill-only sibling extension through the same
// `index.lock`, so the payload shape, the stale windows and the reclaim file name
// are a cross-extension contract rather than a local detail. They are mirrored from
// aktsmm/vscode-agent-skill-ninja v0.9.45 `src/shared-store-lock.ts`, and
// `scripts/test-shared-store-contract.js` fails if this side drifts.

export interface SharedStoreLockPayload {
  pid: number;
  acquiredAt: string;
  extensionId: string;
  generation: string;
}

/** Permission to write the shared store, valid only while the lock is still ours. */
export interface SharedStoreLease {
  readonly generation: string;
  assertHeld(): void;
  /**
   * A local flag is not a fence: a process paused past the stale window is
   * reclaimed without ever running its heartbeat, then resumes believing it still
   * owns the lock. The generation on disk is the only authority before a commit.
   */
  assertStillOwned(): Promise<void>;
}

export class SharedStoreLeaseLostError extends Error {
  constructor(generation: string) {
    super(`Shared store lease was lost (generation: ${generation})`);
    this.name = "SharedStoreLeaseLostError";
  }
}

export const SHARED_STORE_LOCK_UNAVAILABLE_MESSAGE =
  "Failed to acquire shared store lock";
export const SHARED_STORE_LOCK_RECLAIM_SUFFIX = ".reclaim-";

function isAlreadyExistsError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "EEXIST"
  );
}

/**
 * Losing the lock is an expected outcome of sharing the store with another tool,
 * so the callers that own a file report it instead of letting it escape as a crash.
 * Anything else is a real fault and keeps propagating.
 */
export function describeSharedStoreLockFailure(
  error: unknown,
): "lease-lost" | "lock-unavailable" | undefined {
  if (error instanceof SharedStoreLeaseLostError) {
    return "lease-lost";
  }
  if (!(error instanceof Error)) {
    return undefined;
  }
  return error.message === SHARED_STORE_LOCK_UNAVAILABLE_MESSAGE
    ? "lock-unavailable"
    : undefined;
}

interface SharedStoreLockRuntime {
  now(): number;
  isProcessAlive(pid: number): boolean;
  createGeneration(): string;
}

function isProcessAliveBySignal(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (
      !!error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "EPERM"
    );
  }
}

const DEFAULT_RUNTIME: SharedStoreLockRuntime = {
  now: () => Date.now(),
  isProcessAlive: isProcessAliveBySignal,
  createGeneration: () => crypto.randomUUID(),
};

let runtime: SharedStoreLockRuntime = { ...DEFAULT_RUNTIME };

/** Test seam: the clock, liveness and generations are environment, not behaviour. */
export function configureSharedStoreLockRuntime(
  overrides: Partial<SharedStoreLockRuntime>,
): void {
  runtime = { ...runtime, ...overrides };
}

export function resetSharedStoreLockRuntime(): void {
  runtime = { ...DEFAULT_RUNTIME };
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getSharedStoreLockPath(): string {
  return path.join(getAgentNinjaSharedDirectoryPath(), SHARED_STORE_LOCK_FILE);
}

/** Our own payload is well under 1 KB; anything larger is not a lock we wrote. */
const SHARED_STORE_LOCK_MAX_BYTES = 4 * 1024;

function normalizeLockPayload(
  raw: unknown,
): SharedStoreLockPayload | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }

  const candidate = raw as Partial<SharedStoreLockPayload>;
  if (
    typeof candidate.acquiredAt !== "string" ||
    typeof candidate.extensionId !== "string"
  ) {
    return undefined;
  }

  return {
    pid: typeof candidate.pid === "number" ? candidate.pid : -1,
    acquiredAt: candidate.acquiredAt,
    extensionId: candidate.extensionId,
    // A lock written before generations existed reads as "", which never matches
    // one we produced, so we can neither adopt nor delete it by mistake.
    generation:
      typeof candidate.generation === "string" ? candidate.generation : "",
  };
}

interface SharedStoreLockState {
  exists: boolean;
  payload?: SharedStoreLockPayload;
  mtimeMs?: number;
}

async function readLockState(lockPath: string): Promise<SharedStoreLockState> {
  let handle;
  try {
    handle = await fs.open(lockPath, "r");
  } catch {
    return { exists: false };
  }

  try {
    const stats = await handle.stat();
    if (stats.size > SHARED_STORE_LOCK_MAX_BYTES) {
      return { exists: true, mtimeMs: stats.mtimeMs };
    }

    const content = await handle.readFile("utf8");
    let payload: SharedStoreLockPayload | undefined;
    try {
      payload = normalizeLockPayload(JSON.parse(content));
    } catch {
      payload = undefined;
    }
    return { exists: true, payload, mtimeMs: stats.mtimeMs };
  } catch {
    return { exists: false };
  } finally {
    await handle.close();
  }
}

async function readLockPayload(
  lockPath: string,
): Promise<SharedStoreLockPayload | undefined> {
  return (await readLockState(lockPath)).payload;
}

/**
 * Renaming first means only one process wins the reclaim, and an owner whose lock
 * vanished underneath it sees a changed generation rather than a file it can write.
 */
async function reclaimLockFile(lockPath: string): Promise<void> {
  const reclaimPath = `${lockPath}${SHARED_STORE_LOCK_RECLAIM_SUFFIX}${runtime.createGeneration()}`;
  try {
    await fs.rename(lockPath, reclaimPath);
  } catch {
    return;
  }
  await fs.rm(reclaimPath, { force: true });
}

/**
 * A readable lock is only reclaimed once it is stale and its owner is gone, because
 * taking it from a live but paused process lets both sides write. The hard window is
 * the escape hatch for a reused pid that would otherwise look alive forever.
 */
async function removeStaleLock(lockPath: string): Promise<void> {
  const state = await readLockState(lockPath);
  if (!state.exists) {
    return;
  }

  if (state.payload) {
    const acquiredAt = Date.parse(state.payload.acquiredAt);
    if (!Number.isFinite(acquiredAt)) {
      return;
    }

    const age = runtime.now() - acquiredAt;
    if (age <= SHARED_STORE_LOCK_STALE_MS) {
      return;
    }
    if (
      age <= SHARED_STORE_LOCK_HARD_STALE_MS &&
      runtime.isProcessAlive(state.payload.pid)
    ) {
      return;
    }

    // A heartbeat or a new acquisition between the two reads means the lock is live.
    const current = await readLockState(lockPath);
    if (
      !current.payload ||
      current.payload.generation !== state.payload.generation ||
      current.payload.acquiredAt !== state.payload.acquiredAt
    ) {
      return;
    }

    await reclaimLockFile(lockPath);
    return;
  }

  // Unreadable: the remains of a write that died midway, judged on the file itself.
  if (
    state.mtimeMs === undefined ||
    runtime.now() - state.mtimeMs <= SHARED_STORE_LOCK_STALE_MS
  ) {
    return;
  }

  const current = await readLockState(lockPath);
  if (current.payload || current.mtimeMs !== state.mtimeMs) {
    return;
  }

  logger.warn(
    "[Resource Ninja] Reclaiming an unreadable shared store lock that is older than the stale window.",
  );
  await reclaimLockFile(lockPath);
}

/**
 * Written to a staging file and linked into place, so no one can observe a lock
 * without a payload. `link` fails with EEXIST, which makes it the exclusive create.
 */
async function publishLockFile(
  lockPath: string,
  payload: SharedStoreLockPayload,
): Promise<boolean> {
  const stagingPath = `${lockPath}.${payload.generation}`;
  const body = JSON.stringify(payload, null, 2);

  try {
    await fs.writeFile(stagingPath, body, "utf8");
    try {
      await fs.link(stagingPath, lockPath);
      return true;
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        return false;
      }

      // Fallback for filesystems without hard links; the empty window returns.
      try {
        const handle = await fs.open(lockPath, "wx");
        try {
          await handle.writeFile(body, "utf8");
        } finally {
          await handle.close();
        }
        return true;
      } catch (fallbackError) {
        if (isAlreadyExistsError(fallbackError)) {
          return false;
        }
        throw fallbackError;
      }
    }
  } finally {
    await fs.rm(stagingPath, { force: true });
  }
}

async function releaseOwnedLock(
  lockPath: string,
  generation: string,
): Promise<void> {
  const payload = await readLockPayload(lockPath);
  if (!payload || payload.generation !== generation) {
    // Already reclaimed: the file belongs to whoever holds it now.
    return;
  }
  await fs.rm(lockPath, { force: true });
}

export async function withSharedStoreLock<T>(
  extensionId: string,
  task: (lease: SharedStoreLease) => Promise<T>,
): Promise<T> {
  const sharedDir = getAgentNinjaSharedDirectoryPath();
  const lockPath = getSharedStoreLockPath();
  await fs.mkdir(sharedDir, { recursive: true });

  for (let attempt = 0; attempt < SHARED_STORE_LOCK_RETRY_COUNT; attempt += 1) {
    const generation = runtime.createGeneration();
    const payload: SharedStoreLockPayload = {
      pid: typeof process.pid === "number" ? process.pid : -1,
      acquiredAt: new Date(runtime.now()).toISOString(),
      extensionId,
      generation,
    };

    if (!(await publishLockFile(lockPath, payload))) {
      await removeStaleLock(lockPath);
      // The lock can legitimately be held for as long as a multi-megabyte write
      // takes, so the wait grows instead of giving up inside half a second.
      await delay(SHARED_STORE_RETRY_DELAY_MS * 2 ** attempt);
      continue;
    }

    let held = true;
    const lease: SharedStoreLease = {
      generation,
      assertHeld: () => {
        if (!held) {
          throw new SharedStoreLeaseLostError(generation);
        }
      },
      assertStillOwned: async () => {
        const current = await readLockPayload(lockPath);
        if (!current || current.generation !== generation) {
          held = false;
          throw new SharedStoreLeaseLostError(generation);
        }
      },
    };

    let pendingHeartbeat: Promise<void> | undefined;
    const runHeartbeat = async (): Promise<void> => {
      if (!held) {
        return;
      }

      const current = await readLockPayload(lockPath);
      if (!current || current.generation !== generation) {
        held = false;
        return;
      }

      try {
        // Writing in place would leave a truncated payload behind if we died here.
        const refreshPath = `${lockPath}.refresh-${generation}`;
        await fs.writeFile(
          refreshPath,
          JSON.stringify(
            { ...current, acquiredAt: new Date(runtime.now()).toISOString() },
            null,
            2,
          ),
          "utf8",
        );

        if (!held) {
          await fs.rm(refreshPath, { force: true });
          return;
        }
        await fs.rename(refreshPath, lockPath);
      } catch {
        held = false;
      }
    };

    const heartbeat = setInterval(() => {
      if (pendingHeartbeat) {
        return;
      }
      pendingHeartbeat = runHeartbeat().finally(() => {
        pendingHeartbeat = undefined;
      });
    }, SHARED_STORE_LOCK_HEARTBEAT_MS);
    if (typeof heartbeat.unref === "function") {
      heartbeat.unref();
    }

    try {
      return await task(lease);
    } finally {
      clearInterval(heartbeat);
      held = false;
      await pendingHeartbeat;
      await releaseOwnedLock(lockPath, generation);
    }
  }

  throw new Error(SHARED_STORE_LOCK_UNAVAILABLE_MESSAGE);
}
