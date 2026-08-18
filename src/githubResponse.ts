export type GitHubFailureKind =
  | "rate-limit"
  | "server-error"
  | "transport"
  | "sso-required"
  | "classic-pat-forbidden"
  | "auth-required"
  | "not-found"
  | "other";

export interface GitHubResponseErrorDetails {
  /** The failure that started the credential walk, when the surfaced one hides it. */
  rootCauseKind?: GitHubFailureKind;
  ssoAuthorizationUrl?: string;
  /** Earliest instant a retry is allowed, per GitHub's documented rate-limit ladder. */
  retryNotBefore?: string;
}

export class GitHubResponseError extends Error {
  public readonly rootCauseKind?: GitHubFailureKind;
  public readonly retryNotBefore?: string;
  declare readonly ssoAuthorizationUrl?: string;

  constructor(
    public readonly kind: GitHubFailureKind,
    public readonly status: number,
    message: string,
    public readonly resetAt?: string,
    details?: GitHubResponseErrorDetails,
  ) {
    super(message);
    this.name = "GitHubResponseError";
    this.rootCauseKind = details?.rootCauseKind;
    this.retryNotBefore = details?.retryNotBefore;
    // Non-enumerable so serializing this error cannot leak the pending SSO authorization.
    Object.defineProperty(this, "ssoAuthorizationUrl", {
      value: details?.ssoAuthorizationUrl,
      enumerable: false,
      configurable: true,
    });
  }
}

export function isGitHubResponseError(
  error: unknown,
): error is GitHubResponseError {
  return error instanceof GitHubResponseError;
}

const GITHUB_AUTH_MESSAGE_MARKERS = [
  "rate limit",
  "authentication",
  "github api の制限に達しました",
  "github トークンで認証",
];

export function isGitHubAuthFailureMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return GITHUB_AUTH_MESSAGE_MARKERS.some((marker) =>
    normalized.includes(marker),
  );
}

export function containsHttpStatus(
  message: string,
  ...statuses: readonly number[]
): boolean {
  return statuses.some((status) =>
    new RegExp(`(?:^|[\\s(:])${status}(?=$|[\\s):.,])`).test(message),
  );
}

/**
 * Presentation and recovery-policy code should explain the root cause; control
 * flow must keep reading `kind`, which still carries the surfaced failure.
 */
export function getGitHubEffectiveFailureKind(
  error: GitHubResponseError,
): GitHubFailureKind {
  return error.rootCauseKind ?? error.kind;
}

/** Lower means closer to the root cause of a credential walk. */
const GITHUB_FAILURE_ROOT_CAUSE_RANK: Record<GitHubFailureKind, number> = {
  "sso-required": 0,
  "classic-pat-forbidden": 1,
  "auth-required": 2,
  "not-found": 3,
  "rate-limit": 4,
  "server-error": 5,
  transport: 6,
  other: 7,
};

export function rankGitHubFailureKind(kind: GitHubFailureKind): number {
  return GITHUB_FAILURE_ROOT_CAUSE_RANK[kind];
}

export interface GitHubRootCause {
  kind: GitHubFailureKind;
  ssoAuthorizationUrl?: string;
}

// A WeakMap keeps frozen test doubles assignable and leaves the response shape untouched.
const gitHubRootCauses = new WeakMap<object, GitHubRootCause>();

export function annotateGitHubRootCause(
  response: object,
  rootCause: GitHubRootCause,
): void {
  try {
    gitHubRootCauses.set(response, rootCause);
  } catch {
    // Diagnostics must never break a request.
  }
}

/** `Response.clone()` produces a new object, so read this from the original response. */
export function getGitHubRootCause(
  response: object,
): GitHubRootCause | undefined {
  try {
    return gitHubRootCauses.get(response);
  } catch {
    return undefined;
  }
}

export function classifyGitHubFailure(
  response: Pick<Response, "status" | "headers">,
  bodyText: string,
): GitHubFailureKind {
  const lowerBody = bodyText.toLowerCase();
  const ssoHeader = response.headers.get("x-github-sso")?.toLowerCase() || "";

  if (
    ssoHeader.includes("required") ||
    lowerBody.includes("saml enforcement") ||
    lowerBody.includes("must grant your oauth token access")
  ) {
    return "sso-required";
  }

  if (
    lowerBody.includes("forbids access via a personal access tokens (classic)")
  ) {
    return "classic-pat-forbidden";
  }

  if (
    response.status === 429 ||
    response.headers.get("x-ratelimit-remaining") === "0" ||
    lowerBody.includes("rate limit")
  ) {
    return "rate-limit";
  }

  if (response.status === 404) {
    return "not-found";
  }

  if (response.status === 401 || response.status === 403) {
    return "auth-required";
  }

  if (response.status >= 500 && response.status <= 599) {
    return "server-error";
  }

  return "other";
}

const TRANSPORT_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "ETIMEDOUT",
]);

export async function classifyGitHubResponse(
  response: Response,
): Promise<GitHubFailureKind> {
  let bodyText = "";
  try {
    bodyText = await response.clone().text();
  } catch {
    bodyText = "";
  }
  return classifyGitHubFailure(response, bodyText);
}

const SSO_AUTHORIZATION_PATH_PATTERN = /^\/orgs\/[^/]+\/sso$/;

/** A URL from a response header must not carry whitespace or control characters. */
function hasUnsafeUrlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Reads the organization SSO authorization URL from `X-GitHub-SSO`. The
 * `authorization_request` value is kept because it binds the pending
 * authorization to the rejected credential, so it must never be logged.
 */
export function extractSsoAuthorizationUrl(
  headers: Pick<Headers, "get">,
): string | undefined {
  const header = headers.get("x-github-sso");
  if (!header) {
    return undefined;
  }

  const candidate = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith("url="))
    ?.slice("url=".length)
    .trim();
  if (!candidate || hasUnsafeUrlCharacters(candidate)) {
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return undefined;
  }

  if (
    parsed.origin !== "https://github.com" ||
    parsed.username ||
    parsed.password ||
    !SSO_AUTHORIZATION_PATH_PATTERN.test(parsed.pathname)
  ) {
    return undefined;
  }

  // Rebuilding drops the fragment and every parameter except the one we need.
  const sanitized = new URL(`https://github.com${parsed.pathname}`);
  const authorizationRequest = parsed.searchParams.get("authorization_request");
  if (authorizationRequest) {
    sanitized.searchParams.set("authorization_request", authorizationRequest);
  }
  return sanitized.toString();
}

export function classifyGitHubTransportFailure(
  error: unknown,
  signal?: AbortSignal,
): GitHubFailureKind {
  if (signal?.aborted || !(error instanceof Error)) {
    return "other";
  }
  if (error.name === "AbortError") {
    return "other";
  }
  const code = (error as NodeJS.ErrnoException).code;
  return error instanceof TypeError || (code && TRANSPORT_ERROR_CODES.has(code))
    ? "transport"
    : "other";
}

function getRateLimitResetAt(
  response: Pick<Response, "headers">,
): string | undefined {
  const resetSeconds = Number(response.headers.get("x-ratelimit-reset"));
  if (!Number.isFinite(resetSeconds) || resetSeconds <= 0) {
    return undefined;
  }

  return new Date(resetSeconds * 1000).toISOString();
}

/** GitHub's documented minimum wait when no header says when to come back. */
export const GITHUB_RATE_LIMIT_FALLBACK_WAIT_MS = 60_000;

/**
 * Follows GitHub's documented order: `retry-after`, then `x-ratelimit-reset`
 * once the window is exhausted, then a conservative minimum wait. Secondary
 * limits often send only `retry-after`, so reading the reset header alone
 * leaves those retries with no deadline at all.
 */
export function getGitHubRetryNotBefore(
  response: Pick<Response, "headers">,
  nowMs: number = Date.now(),
): string {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return new Date(nowMs + Math.max(0, seconds * 1000)).toISOString();
    }
    const dateMs = Date.parse(retryAfter);
    if (Number.isFinite(dateMs)) {
      return new Date(Math.max(nowMs, dateMs)).toISOString();
    }
  }

  if (response.headers.get("x-ratelimit-remaining") === "0") {
    const resetAt = getRateLimitResetAt(response);
    if (resetAt) {
      return resetAt;
    }
  }

  return new Date(nowMs + GITHUB_RATE_LIMIT_FALLBACK_WAIT_MS).toISOString();
}

export function createGitHubResponseError(
  response: Pick<Response, "status" | "headers">,
  bodyText: string,
  context: string,
): GitHubResponseError {
  const kind = classifyGitHubFailure(response, bodyText);
  const resetAt =
    kind === "rate-limit" ? getRateLimitResetAt(response) : undefined;
  const detail =
    kind === "rate-limit"
      ? `GitHub API rate limit exceeded${resetAt ? ` until ${resetAt}` : ""}`
      : kind === "server-error"
        ? `GitHub server error (${response.status})`
        : kind === "sso-required"
          ? "GitHub organization SSO authorization is required"
          : kind === "classic-pat-forbidden"
            ? "GitHub organization policy rejected the classic PAT"
            : kind === "auth-required"
              ? "GitHub authentication or repository permission is required"
              : kind === "not-found"
                ? "GitHub resource was not found"
                : `GitHub API request failed (${response.status})`;

  const rootCause = getGitHubRootCause(response);
  return new GitHubResponseError(
    kind,
    response.status,
    `${context}: ${detail}`,
    resetAt,
    {
      rootCauseKind: rootCause?.kind,
      retryNotBefore:
        kind === "rate-limit" ? getGitHubRetryNotBefore(response) : undefined,
      ssoAuthorizationUrl:
        rootCause?.ssoAuthorizationUrl ??
        extractSsoAuthorizationUrl(response.headers),
    },
  );
}

export async function retryGitHubRequestAnonymously(
  response: Response,
  hasToken: boolean,
  requestWithoutToken: () => Promise<Response>,
): Promise<Response> {
  if (!hasToken || response.ok) {
    return response;
  }

  const bodyText = await response
    .clone()
    .text()
    .catch(() => "");
  const failureKind = classifyGitHubFailure(response, bodyText);
  if (
    failureKind !== "sso-required" &&
    failureKind !== "classic-pat-forbidden" &&
    failureKind !== "auth-required"
  ) {
    return response;
  }

  try {
    const retryResponse = await requestWithoutToken();
    if (retryResponse.ok) {
      return retryResponse;
    }

    // Unauthenticated api.github.com allows only 60 req/h, so an exhausted
    // anonymous quota must not be reported as the authenticated auth failure.
    const retryBodyText = await retryResponse
      .clone()
      .text()
      .catch(() => "");
    if (classifyGitHubFailure(retryResponse, retryBodyText) === "rate-limit") {
      return retryResponse;
    }

    return response;
  } catch {
    return response;
  }
}
