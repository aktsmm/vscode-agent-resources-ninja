// Validation for GitHub owner / repository / ref values that arrive from the shared
// store, which any tool on the machine can write. Kept free of `vscode` imports so
// plain-Node regression scripts can load the real code.
//
// The rules are aligned with the sibling extension so one shared file cannot be read
// two different ways: aktsmm/vscode-agent-skill-ninja v0.9.44,
// `src/shared-manifest.ts` and `src/shared-sources-manifest-store.ts`.

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/; // eslint-disable-line no-control-regex

const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const GITHUB_REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const GITHUB_REPOSITORY_URL_PATTERN =
  /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/;

// `%` is refused so an encoded traversal cannot survive a sink that forgets to encode.
const GIT_REF_FORBIDDEN_CHARACTERS = /[\s~^:?*[\\"<>|%]/;
const MAX_GIT_REF_LENGTH = 255;

export function isSafeGitHubOwner(value: unknown): value is string {
  return typeof value === "string" && GITHUB_OWNER_PATTERN.test(value);
}

export function isSafeGitHubRepo(value: unknown): value is string {
  return (
    typeof value === "string" &&
    GITHUB_REPO_PATTERN.test(value) &&
    !isDotSegment(value)
  );
}

/** A plain `https://github.com/<owner>/<repo>` and nothing else. */
export function isSafeGitHubRepositoryUrl(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const match = GITHUB_REPOSITORY_URL_PATTERN.exec(value);
  return (
    match !== null && isSafeGitHubOwner(match[1]) && isSafeGitHubRepo(match[2])
  );
}

/**
 * A ref reaches raw.githubusercontent.com as path segments, so anything that could
 * climb out of the repository is refused. An interior `/` stays legal because
 * `feature/x` is an ordinary branch name.
 */
export function isSafeGitRef(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_GIT_REF_LENGTH ||
    CONTROL_CHARACTERS.test(value) ||
    GIT_REF_FORBIDDEN_CHARACTERS.test(value)
  ) {
    return false;
  }

  if (
    value.startsWith("/") ||
    value.endsWith("/") ||
    value.includes("//") ||
    value.endsWith(".") ||
    value.includes("@{")
  ) {
    return false;
  }

  return value
    .split("/")
    .every(
      (segment) =>
        segment.length > 0 &&
        !isDotSegment(segment) &&
        !segment.startsWith(".") &&
        !segment.endsWith(".lock"),
    );
}

/** Escapes each segment so a multi-segment ref such as `feature/x` stays intact. */
export function encodeGitRefForPath(ref: string): string {
  return ref.split("/").map(encodeURIComponent).join("/");
}

function isDotSegment(segment: string): boolean {
  return segment === "." || segment === "..";
}
