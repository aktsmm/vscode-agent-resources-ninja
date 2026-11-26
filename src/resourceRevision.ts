import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { fetchGitHubWithOptionalAuthRetry } from "./githubFetch";
import {
  createGitHubResponseError,
  GitHubResponseError,
  isGitHubResponseError,
} from "./githubResponse";

/**
 * What a remote-backed resource was installed from: the commit it was read at
 * and the Git object id of the unit that was copied (a folder tree or one file
 * blob). The shape and the `sourceRevision` metadata key are shared with the
 * skill-only sibling extension, so a baseline written by either side is usable
 * by the other.
 */
export interface SourceRevision {
  owner: string;
  repo: string;
  ref: string;
  remotePath: string;
  commitSha: string;
  contentSha: string;
  kind: "tree" | "blob";
}

export interface RevisionTarget {
  owner: string;
  repo: string;
  branch: string;
  remotePath: string;
}

export interface RevisionFile {
  path: string;
  sha: string;
  mode: "100644" | "100755";
}

export interface RevisionResolver {
  (target: RevisionTarget): Promise<SourceRevision>;
  listFiles(revision: SourceRevision): Promise<RevisionFile[]>;
}

export type RevisionStatus =
  | "unchanged"
  | "changed"
  | "no-baseline"
  | "different-source";

/** Git hashes the object header and the exact bytes, not the decoded text. */
export function matchesGitBlob(
  bytes: Uint8Array,
  expectedSha: string,
): boolean {
  return (
    sha(expectedSha) &&
    createHash("sha1")
      .update(`blob ${bytes.byteLength}\0`)
      .update(bytes)
      .digest("hex") === expectedSha.toLowerCase()
  );
}

/**
 * Files up to this size are read into memory and compared by content hash. Larger
 * ones are streamed for a Git blob check and compared by size and modification time
 * between two looks at the same file.
 */
export const HASH_IN_MEMORY_LIMIT_BYTES = 20 * 1024 * 1024;
/** A skill file above this is refused: the download holds a whole file in memory. */
export const MAX_SKILL_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_SKILL_TOTAL_BYTES = 500 * 1024 * 1024;

/**
 * Streams a local file into the Git blob hash without holding it in memory.
 * Returns undefined when the file does not have exactly `expectedSize` bytes, which
 * means it changed while it was read.
 */
export async function gitBlobShaOfFile(
  location: string,
  expectedSize: number | bigint,
): Promise<string | undefined> {
  const size = Number(expectedSize);
  if (!Number.isSafeInteger(size) || size < 0) {
    return undefined;
  }
  const digest = createHash("sha1").update(`blob ${size}\0`);
  let read = 0;
  for await (const chunk of createReadStream(location, { highWaterMark: 1 << 20 })) {
    const bytes = chunk as Buffer;
    read += bytes.byteLength;
    if (read > size) {
      return undefined;
    }
    digest.update(bytes);
  }
  return read === size ? digest.digest("hex") : undefined;
}

/** True when `matchesGitBlob` would accept a file, for a file too large to read at once. */
export async function fileMatchesGitBlob(
  location: string,
  size: number | bigint,
  expectedSha: string,
): Promise<boolean> {
  if (!sha(expectedSha)) {
    return false;
  }
  return (
    (await gitBlobShaOfFile(location, size)) === expectedSha.toLowerCase()
  );
}

/** Streams two local files and reports whether they hold the same bytes. */
export async function filesHaveSameBytes(
  first: string,
  second: string,
  size: number | bigint,
): Promise<boolean> {
  const digest = async (location: string): Promise<string | undefined> => {
    const hash = createHash("sha256");
    let read = 0;
    for await (const chunk of createReadStream(location, { highWaterMark: 1 << 20 })) {
      read += (chunk as Buffer).byteLength;
      hash.update(chunk as Buffer);
    }
    return read === Number(size) ? hash.digest("hex") : undefined;
  };
  const [a, b] = [await digest(first), await digest(second)];
  return a !== undefined && a === b;
}

export class RevisionPathMissingError extends Error {
  constructor() {
    super("Source path no longer exists.");
    this.name = "RevisionPathMissingError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha(value: unknown): value is string {
  return typeof value === "string" && /^[a-fA-F0-9]{40}$/.test(value);
}

function segment(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9_.-]+$/.test(value) &&
    value !== "." &&
    value !== ".."
  );
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function remotePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (value === "" ||
      (!hasControlCharacters(value) &&
        !/[\\%:*?"<>|]/.test(value) &&
        value
          .split("/")
          .every(
            (part) =>
              part !== "" &&
              part !== "." &&
              part !== ".." &&
              !/[. ]$/.test(part),
          )))
  );
}

function ref(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value !== "." &&
    value !== ".." &&
    !hasControlCharacters(value)
  );
}

/**
 * Metadata comes from disk and can be edited by hand or arrive from another
 * tool, so a baseline is only trusted when every field has the expected shape.
 */
export function parseSourceRevision(value: unknown): SourceRevision | undefined {
  if (
    !record(value) ||
    !segment(value.owner) ||
    !segment(value.repo) ||
    !ref(value.ref) ||
    !remotePath(value.remotePath) ||
    !sha(value.commitSha) ||
    !sha(value.contentSha) ||
    (value.kind !== "tree" && value.kind !== "blob")
  ) {
    return undefined;
  }
  return {
    owner: value.owner,
    repo: value.repo,
    ref: value.ref,
    remotePath: value.remotePath,
    commitSha: value.commitSha.toLowerCase(),
    contentSha: value.contentSha.toLowerCase(),
    kind: value.kind,
  };
}

function sameIdentity(a: SourceRevision, b: SourceRevision): boolean {
  return (
    a.owner.toLowerCase() === b.owner.toLowerCase() &&
    a.repo.toLowerCase() === b.repo.toLowerCase() &&
    a.ref === b.ref &&
    a.remotePath === b.remotePath &&
    a.kind === b.kind
  );
}

/**
 * Compares the recorded baseline with the revision read now. Only an identical
 * content id under the same repository, ref and path counts as unchanged; a
 * missing or foreign baseline never does, so an unknown state is updated
 * rather than skipped.
 */
export function classifyRevision(
  baseline: unknown,
  current: SourceRevision,
): RevisionStatus {
  const parsed = parseSourceRevision(baseline);
  if (!parsed) {
    return "no-baseline";
  }
  if (!sameIdentity(parsed, current)) {
    return "different-source";
  }
  return parsed.contentSha === current.contentSha ? "unchanged" : "changed";
}

function failure(): Error {
  return new Error("Unable to resolve source revision.");
}

function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("Source revision request cancelled.");
    error.name = "AbortError";
    throw error;
  }
}

type RevisionJsonReader = (
  url: string,
  token?: string,
  signal?: AbortSignal,
) => Promise<unknown>;

async function readRevisionJson(
  url: string,
  token: string | undefined,
  signal: AbortSignal | undefined,
  request: typeof fetchGitHubWithOptionalAuthRetry,
): Promise<unknown> {
  assertActive(signal);
  const response = await request(url, {
    accept: "application/vnd.github.v3+json",
    token,
    signal,
  });
  assertActive(signal);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw createGitHubResponseError(response, body, "Revision check");
  }
  const value: unknown = await response.json();
  assertActive(signal);
  return value;
}

/** Shares only in-flight startup reads; each caller retains its own cancellation. */
export function createSharedRevisionJsonReader(
  request: typeof fetchGitHubWithOptionalAuthRetry = fetchGitHubWithOptionalAuthRetry,
): RevisionJsonReader {
  interface PendingRead {
    controller: AbortController;
    promise: Promise<unknown>;
    subscribers: number;
    completed: boolean;
  }
  const byToken = new Map<string | undefined, Map<string, PendingRead>>();
  return (url, token, signal) => {
    assertActive(signal);
    let reads = byToken.get(token);
    if (!reads) {
      reads = new Map();
      byToken.set(token, reads);
    }
    let entry = reads.get(url);
    if (!entry) {
      const controller = new AbortController();
      const ownerReads = reads;
      const created: PendingRead = {
        controller,
        subscribers: 0,
        completed: false,
        promise: readRevisionJson(url, token, controller.signal, request).finally(() => {
          created.completed = true;
          if (ownerReads.get(url) === created) {
            ownerReads.delete(url);
            if (ownerReads.size === 0) { byToken.delete(token); }
          }
        }),
      };
      ownerReads.set(url, created);
      entry = created;
    }
    const current = entry;
    const ownerReads = reads;
    current.subscribers++;
    return new Promise<unknown>((resolve, reject) => {
      let finished = false;
      const finish = (action: () => void): void => {
        if (finished) { return; }
        finished = true;
        signal?.removeEventListener("abort", onAbort);
        current.subscribers--;
        if (current.subscribers === 0 && !current.completed) {
          if (ownerReads.get(url) === current) {
            ownerReads.delete(url);
            if (ownerReads.size === 0) { byToken.delete(token); }
          }
          current.controller.abort();
        }
        action();
      };
      const onAbort = (): void => {
        finish(() => {
          try { assertActive(signal); } catch (error) { reject(error); }
        });
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) { onAbort(); }
      current.promise.then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      );
    });
  };
}

interface TreeEntry {
  path: string;
  sha: string;
  type: "tree" | "blob" | "commit";
  mode: string;
}

interface Tree {
  entries: TreeEntry[];
  truncated: boolean;
}

const MAX_REVISION_FILES = 10_000;
const MAX_REVISION_DIRECTORIES = 10_000;
const MAX_REVISION_DEPTH = 64;

function parseTree(
  value: unknown,
  expectedSha: string,
  recursive: boolean,
): Tree {
  if (
    !record(value) ||
    !sha(value.sha) ||
    value.sha.toLowerCase() !== expectedSha ||
    typeof value.truncated !== "boolean" ||
    !Array.isArray(value.tree)
  ) {
    throw failure();
  }
  const paths = new Set<string>();
  const entries: TreeEntry[] = value.tree.map((entry: unknown) => {
    if (
      !record(entry) ||
      !remotePath(entry.path) ||
      !entry.path ||
      (!recursive && entry.path.includes("/")) ||
      !sha(entry.sha) ||
      (entry.type !== "tree" &&
        entry.type !== "blob" &&
        entry.type !== "commit") ||
      paths.has(entry.path) ||
      (entry.type === "tree" && entry.mode !== "040000") ||
      (entry.type === "blob" &&
        entry.mode !== "100644" &&
        entry.mode !== "100755" &&
        entry.mode !== "120000") ||
      (entry.type === "commit" && entry.mode !== "160000")
    ) {
      throw failure();
    }
    paths.add(entry.path);
    return {
      path: entry.path,
      sha: entry.sha.toLowerCase(),
      type: entry.type as TreeEntry["type"],
      mode: entry.mode as string,
    };
  });
  return { entries, truncated: value.truncated };
}

/**
 * Resolves the commit a branch points at and the Git object id of one path in
 * it. Requests for the same branch share one commit and tree snapshot, so a
 * batch over one repository costs a constant number of API calls.
 */
export function createRevisionResolver(
  token?: string,
  signal?: AbortSignal,
  request: typeof fetchGitHubWithOptionalAuthRetry = fetchGitHubWithOptionalAuthRetry,
  sharedJsonReader?: RevisionJsonReader,
): RevisionResolver {
  const snapshots = new Map<
    string,
    Promise<{ commitSha: string; rootSha: string; tree: Tree }>
  >();
  const trees = new Map<string, Promise<Tree>>();

  async function json(url: string): Promise<unknown> {
    return sharedJsonReader
      ? sharedJsonReader(url, token, signal)
      : readRevisionJson(url, token, signal, request);
  }

  function tree(
    base: string,
    treeSha: string,
    recursive: boolean,
  ): Promise<Tree> {
    const url = `${base}/git/trees/${treeSha}${recursive ? "?recursive=1" : ""}`;
    let pending = trees.get(url);
    if (!pending) {
      pending = json(url).then((value) => parseTree(value, treeSha, recursive));
      trees.set(url, pending);
    }
    return pending;
  }

  const resolve = async (target: RevisionTarget): Promise<SourceRevision> => {
    try {
      assertActive(signal);
      if (
        !record(target) ||
        !segment(target.owner) ||
        !segment(target.repo) ||
        !ref(target.branch) ||
        !remotePath(target.remotePath)
      ) {
        throw failure();
      }
      const owner = target.owner.toLowerCase();
      const repo = target.repo.toLowerCase();
      const base = `https://api.github.com/repos/${owner}/${repo}`;
      const key = `${base}/commits/${encodeURIComponent(target.branch)}`;
      let snapshot = snapshots.get(key);
      if (!snapshot) {
        snapshot = (async () => {
          const commit = await json(key);
          if (
            !record(commit) ||
            !sha(commit.sha) ||
            !record(commit.commit) ||
            !record(commit.commit.tree) ||
            !sha(commit.commit.tree.sha)
          ) {
            throw failure();
          }
          const rootSha = commit.commit.tree.sha.toLowerCase();
          return {
            commitSha: commit.sha.toLowerCase(),
            rootSha,
            tree: await tree(base, rootSha, true),
          };
        })();
        snapshots.set(key, snapshot);
      }
      const current = await snapshot;
      assertActive(signal);
      let selected: TreeEntry | undefined =
        target.remotePath === ""
          ? { path: "", sha: current.rootSha, type: "tree", mode: "040000" }
          : undefined;
      if (target.remotePath && current.tree.truncated) {
        // A truncated listing cannot be searched, so walk the path one level at a time.
        let parentSha = current.rootSha;
        const parts = target.remotePath.split("/");
        for (const [index, part] of parts.entries()) {
          const parent = await tree(base, parentSha, false);
          if (parent.truncated) {
            throw failure();
          }
          selected = parent.entries.find((entry) => entry.path === part);
          if (!selected) {
            throw new RevisionPathMissingError();
          }
          if (index < parts.length - 1 && selected.type !== "tree") {
            throw failure();
          }
          parentSha = selected.sha;
        }
      } else if (target.remotePath) {
        selected = current.tree.entries.find(
          (entry) => entry.path === target.remotePath,
        );
      }
      assertActive(signal);
      if (!selected) {
        throw new RevisionPathMissingError();
      }
      if (
        (selected.type !== "tree" && selected.type !== "blob") ||
        selected.mode === "120000"
      ) {
        throw failure();
      }
      return {
        owner,
        repo,
        ref: target.branch,
        remotePath: target.remotePath,
        commitSha: current.commitSha,
        contentSha: selected.sha,
        kind: selected.type,
      };
    } catch (error) {
      assertActive(signal);
      if (error instanceof RevisionPathMissingError) {
        throw error;
      }
      if (isGitHubResponseError(error)) {
        throw new GitHubResponseError(
          error.kind,
          error.status,
          "Unable to resolve source revision.",
        );
      }
      throw failure();
    }
  };

  resolve.listFiles = async (revision: SourceRevision): Promise<RevisionFile[]> => {
    const parsed = parseSourceRevision(revision);
    if (!parsed || parsed.kind !== "tree") {
      throw failure();
    }
    const selected = await resolve({
      owner: parsed.owner,
      repo: parsed.repo,
      branch: parsed.ref,
      remotePath: parsed.remotePath,
    });
    if (
      selected.commitSha !== parsed.commitSha ||
      selected.contentSha !== parsed.contentSha ||
      selected.kind !== "tree"
    ) {
      throw failure();
    }

    const base = `https://api.github.com/repos/${parsed.owner.toLowerCase()}/${parsed.repo.toLowerCase()}`;
    const key = `${base}/commits/${encodeURIComponent(parsed.ref)}`;
    const snapshot = await snapshots.get(key);
    if (!snapshot) {
      throw failure();
    }
    const files: RevisionFile[] = [];
    const addFile = (entry: TreeEntry, relativePath: string): void => {
      if (entry.type === "tree") {
        return;
      }
      if (
        entry.type !== "blob" ||
        entry.mode === "120000" ||
        relativePath.split("/").length > MAX_REVISION_DEPTH ||
        files.length >= MAX_REVISION_FILES
      ) {
        throw failure();
      }
      files.push({
        path: relativePath,
        sha: entry.sha,
        mode: entry.mode as RevisionFile["mode"],
      });
    };

    if (!snapshot.tree.truncated) {
      const prefix = parsed.remotePath ? `${parsed.remotePath}/` : "";
      for (const entry of snapshot.tree.entries) {
        if (entry.path.startsWith(prefix) && entry.path !== parsed.remotePath) {
          addFile(entry, entry.path.slice(prefix.length));
        }
      }
    } else {
      let directoryCount = 0;
      const visit = async (
        treeSha: string,
        prefix: string,
        depth: number,
        ancestors: ReadonlySet<string>,
      ): Promise<void> => {
        directoryCount++;
        if (
          directoryCount > MAX_REVISION_DIRECTORIES ||
          depth > MAX_REVISION_DEPTH ||
          ancestors.has(treeSha)
        ) {
          throw failure();
        }
        const listing = await tree(base, treeSha, false);
        if (listing.truncated) {
          throw failure();
        }
        for (const entry of listing.entries) {
          const relativePath = `${prefix}${entry.path}`;
          if (entry.type === "tree") {
            await visit(
              entry.sha,
              `${relativePath}/`,
              depth + 1,
              new Set([...ancestors, treeSha]),
            );
          } else {
            addFile(entry, relativePath);
          }
        }
      };
      await visit(parsed.contentSha, "", 0, new Set());
    }
    assertActive(signal);
    return files;
  };

  return resolve;
}
