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

export type RevisionStatus =
  | "unchanged"
  | "changed"
  | "no-baseline"
  | "different-source";

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

interface TreeEntry {
  path: string;
  sha: string;
  type: "tree" | "blob" | "commit";
}

interface Tree {
  entries: TreeEntry[];
  truncated: boolean;
}

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
): (target: RevisionTarget) => Promise<SourceRevision> {
  const snapshots = new Map<
    string,
    Promise<{ commitSha: string; rootSha: string; tree: Tree }>
  >();
  const trees = new Map<string, Promise<Tree>>();

  async function json(url: string): Promise<unknown> {
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

  return async (target) => {
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
          ? { path: "", sha: current.rootSha, type: "tree" }
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
      if (selected.type !== "tree" && selected.type !== "blob") {
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
}
