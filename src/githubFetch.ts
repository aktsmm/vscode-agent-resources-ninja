import { resolveGitHubTokenAfterFailure } from "./githubAuth";
import {
  getGitHubBlocklistOwner,
  getGitHubCredentialBlocklistEpoch,
  GITHUB_CREDENTIAL_BLOCK_TTL_MS,
  isGitHubCredentialBlocked,
  markGitHubCredentialBlocked,
} from "./githubCredentialBlocklist";
import {
  annotateGitHubRootCause,
  classifyGitHubFailure,
  classifyGitHubResponse,
  classifyGitHubTransportFailure,
  extractSsoAuthorizationUrl,
  GitHubFailureKind,
  GitHubRootCause,
  rankGitHubFailureKind,
  retryGitHubRequestAnonymously,
} from "./githubResponse";
import { logger } from "./logger";

const GITHUB_USER_AGENT = "VSCode-AgentResourcesNinja";
const GITHUB_API_PREFIX = "https://api.github.com/";
const RAW_GITHUB_PREFIX = "https://raw.githubusercontent.com/";
export const GITHUB_REQUEST_TIMEOUT_MS = 15000;
export const GITHUB_OPERATION_TIMEOUT_MS = 60000;
export const GITHUB_RETRY_MAX_ATTEMPTS = 3;
export const GITHUB_RETRY_MAX_WAIT_MS = 20000;
const GITHUB_RETRY_BASE_DELAY_MS = 500;
/** ソース数と同じだけ試せば、未試行トークンは必ず尽きる。 */
const GITHUB_TOKEN_FALLBACK_MAX_ATTEMPTS = 4;

export async function fetchGitHubWithTimeout(
  url: string,
  init?: RequestInit,
  timeoutMs: number = GITHUB_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = init?.signal;
  let timedOut = false;
  const abortFromCaller = () => {
    if (!controller.signal.aborted) {
      controller.abort();
    }
  };

  if (callerSignal?.aborted) {
    abortFromCaller();
  } else {
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timeoutId = setTimeout(() => {
    if (!controller.signal.aborted) {
      timedOut = true;
      controller.abort();
    }
  }, timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      const timeoutError = new Error(
        `Request timeout: ${describeGitHubRequest(url)}`,
      ) as NodeJS.ErrnoException;
      timeoutError.code = "ETIMEDOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}

function isRawGitHubUrl(url: string): boolean {
  return url.startsWith(RAW_GITHUB_PREFIX);
}

function isGitHubApiUrl(url: string): boolean {
  return url.startsWith(GITHUB_API_PREFIX);
}

function shouldAttachGitHubToken(url: string, token?: string): boolean {
  if (!token) {
    return false;
  }

  // Public raw content works without auth, and authenticated raw requests can
  // fail in some environments even when the repository is public.
  return isGitHubApiUrl(url);
}

export function createGitHubHeaders(
  url: string,
  accept: string,
  token?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    "User-Agent": GITHUB_USER_AGENT,
  };

  if (shouldAttachGitHubToken(url, token)) {
    headers.Authorization = `token ${token}`;
  }

  return headers;
}

const RETRYABLE_GITHUB_FAILURE_KINDS: ReadonlySet<GitHubFailureKind> = new Set([
  "server-error",
  "transport",
]);

/** 5xx だけを対象にする。rate-limit/auth/not-found/other は上位へ返す。 */
export function isRetryableGitHubStatus(status: number): boolean {
  return RETRYABLE_GITHUB_FAILURE_KINDS.has(
    classifyGitHubFailure({ status, headers: new Headers() }, ""),
  );
}

function normalizeMaxAttempts(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return GITHUB_RETRY_MAX_ATTEMPTS;
  }
  return Math.min(10, Math.max(1, Math.floor(value)));
}

function readRetryAfterMs(
  response: Pick<Response, "headers">,
  now: number,
): number | undefined {
  const raw = response.headers.get("retry-after");
  if (!raw) {
    return undefined;
  }

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const dateMs = Date.parse(raw);
  return Number.isFinite(dateMs) ? Math.max(0, dateMs - now) : undefined;
}

function readRateLimitResetMs(
  response: Pick<Response, "headers">,
  now: number,
): number | undefined {
  if (response.headers.get("x-ratelimit-remaining") !== "0") {
    return undefined;
  }

  const resetSeconds = Number(response.headers.get("x-ratelimit-reset"));
  if (!Number.isFinite(resetSeconds) || resetSeconds <= 0) {
    return undefined;
  }

  return Math.max(0, resetSeconds * 1000 - now);
}

function getBackoffDelayMs(attempt: number, random: number): number {
  return Math.round(
    GITHUB_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) +
      random * GITHUB_RETRY_BASE_DELAY_MS,
  );
}

/** 待機が長すぎる場合は undefined を返し、呼び出し側は最後の応答をそのまま返す。 */
export function getGitHubRetryDelayMs(
  response: Pick<Response, "headers">,
  attempt: number,
  now: number,
  random: number,
): number | undefined {
  const explicit =
    readRetryAfterMs(response, now) ?? readRateLimitResetMs(response, now);
  const delay = explicit ?? getBackoffDelayMs(attempt, random);
  return delay > GITHUB_RETRY_MAX_WAIT_MS ? undefined : delay;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createGitHubTimeoutError(label: string): NodeJS.ErrnoException {
  const error = new Error(
    `Operation timeout: ${label}`,
  ) as NodeJS.ErrnoException;
  error.code = "ETIMEDOUT";
  return error;
}

function createGitHubAbortError(): Error {
  const error = new Error("GitHub operation aborted");
  error.name = "AbortError";
  return error;
}

/** Diagnostics must never carry credentials, so log only host and path. */
function describeGitHubRequest(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return "(unparsable url)";
  }
}

export interface GitHubRequestOptions {
  accept: string;
  token?: string;
  method?: string;
  authenticatedUrl?: string | (() => Promise<string | undefined>);
  signal?: AbortSignal;
  extraHeaders?: Record<string, string>;
  maxAttempts?: number;
  operationTimeoutMs?: number;
  request?: (url: string, init?: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

interface GitHubOperationBudget {
  deadline: number;
  now: () => number;
  signal: AbortSignal;
  callerSignal?: AbortSignal;
  didTimeOut: () => boolean;
}

function assertGitHubOperationActive(
  budget: GitHubOperationBudget,
  label: string,
): void {
  if (budget.callerSignal?.aborted) {
    throw createGitHubAbortError();
  }
  if (budget.didTimeOut() || budget.now() >= budget.deadline) {
    throw createGitHubTimeoutError(label);
  }
}

async function waitWithinGitHubOperation(
  delay: number,
  sleep: (ms: number) => Promise<void>,
  budget: GitHubOperationBudget,
  label: string,
): Promise<void> {
  assertGitHubOperationActive(budget, label);
  const remaining = budget.deadline - budget.now();
  if (delay >= remaining) {
    throw createGitHubTimeoutError(label);
  }
  await resolveWithinGitHubOperation(sleep(delay), budget, label);
  assertGitHubOperationActive(budget, label);
}

async function resolveWithinGitHubOperation<T>(
  operation: Promise<T>,
  budget: GitHubOperationBudget,
  label: string,
): Promise<T> {
  assertGitHubOperationActive(budget, label);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(
        budget.callerSignal?.aborted
          ? createGitHubAbortError()
          : createGitHubTimeoutError(label),
      );
    budget.signal.addEventListener("abort", onAbort, { once: true });
    operation.then(resolve, reject).finally(() => {
      budget.signal.removeEventListener("abort", onAbort);
    });
  });
}

function buildRequestHeaders(
  headers: Record<string, string>,
  extraHeaders: Record<string, string> | undefined,
  anonymous: boolean,
): Record<string, string> {
  const merged: Record<string, string> = {
    ...(extraHeaders ?? {}),
    ...headers,
  };
  if (anonymous) {
    for (const key of Object.keys(merged)) {
      if (key.toLowerCase() === "authorization") {
        delete merged[key];
      }
    }
  }
  return merged;
}

async function sendGitHubRequestWithRetry(
  perform: () => Promise<Response>,
  options: GitHubRequestOptions,
  label: string,
  budget: GitHubOperationBudget,
): Promise<Response> {
  const maxAttempts = normalizeMaxAttempts(options.maxAttempts);
  const sleep = options.sleep ?? defaultSleep;
  const now = budget.now;
  const random = options.random ?? Math.random;
  const signal = options.signal;

  for (let attempt = 1; ; attempt++) {
    assertGitHubOperationActive(budget, label);
    let response: Response;
    try {
      response = await resolveWithinGitHubOperation(perform(), budget, label);
    } catch (error) {
      const failureKind = classifyGitHubTransportFailure(error, signal);
      if (
        attempt >= maxAttempts ||
        !RETRYABLE_GITHUB_FAILURE_KINDS.has(failureKind)
      ) {
        throw error;
      }
      const delay = getBackoffDelayMs(attempt, random());
      if (delay > GITHUB_RETRY_MAX_WAIT_MS) {
        throw error;
      }
      logger.warn(
        `[Resource Ninja] Transient network failure for ${label}; retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})`,
      );
      await waitWithinGitHubOperation(delay, sleep, budget, label);
      continue;
    }

    if (attempt >= maxAttempts || !isRetryableGitHubStatus(response.status)) {
      return response;
    }
    const delay = getGitHubRetryDelayMs(response, attempt, now(), random());
    if (delay === undefined) {
      logger.warn(
        `[Resource Ninja] GitHub returned ${response.status} for ${label}; not retrying because the wait exceeds ${GITHUB_RETRY_MAX_WAIT_MS}ms`,
      );
      return response;
    }
    logger.warn(
      `[Resource Ninja] GitHub returned ${response.status} for ${label}; retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})`,
    );
    await waitWithinGitHubOperation(delay, sleep, budget, label);
  }
}

export async function fetchGitHubWithOptionalAuthRetry(
  url: string,
  options: GitHubRequestOptions,
): Promise<Response> {
  const now = options.now ?? Date.now;
  const operationTimeoutMs =
    typeof options.operationTimeoutMs === "number" &&
    Number.isFinite(options.operationTimeoutMs) &&
    options.operationTimeoutMs > 0
      ? Math.floor(options.operationTimeoutMs)
      : GITHUB_OPERATION_TIMEOUT_MS;
  const operationController = new AbortController();
  const callerSignal = options.signal;
  let operationTimedOut = false;
  const abortFromCaller = () => operationController.abort();
  if (callerSignal?.aborted) {
    throw createGitHubAbortError();
  }
  callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeoutId = setTimeout(() => {
    operationTimedOut = true;
    operationController.abort();
  }, operationTimeoutMs);
  const budget: GitHubOperationBudget = {
    deadline: now() + operationTimeoutMs,
    now,
    signal: operationController.signal,
    callerSignal,
    didTimeOut: () => operationTimedOut,
  };
  const request = options.request ?? fetchGitHubWithTimeout;
  // リトライ層はここだけ。個々のリクエストを包むので、認証エスカレーションは再実行されない。
  const send = (targetUrl: string, headers: Record<string, string>) =>
    sendGitHubRequestWithRetry(
      () =>
        request(targetUrl, {
          headers,
          method: options.method,
          signal: operationController.signal,
        }),
      options,
      describeGitHubRequest(targetUrl),
      budget,
    );

  try {
    // Captured once: a reset during this operation must not be undone by a late mark.
    const blocklistEpoch = getGitHubCredentialBlocklistEpoch();
    let rootCause: GitHubRootCause | undefined;

    const recordCredentialFailure = async (
      targetUrl: string,
      token: string | undefined,
      candidate: Response,
    ): Promise<void> => {
      if (!token || (candidate.status !== 401 && candidate.status !== 403)) {
        return;
      }
      const kind = await classifyGitHubResponse(candidate);
      // A plain permission gap must not blocklist an entire owner.
      if (kind !== "sso-required" && kind !== "classic-pat-forbidden") {
        return;
      }
      if (markGitHubCredentialBlocked(targetUrl, token, blocklistEpoch)) {
        logger.info(
          `[Resource Ninja] GitHub rejected the active credential for ${getGitHubBlocklistOwner(targetUrl)} (${kind}); it is suppressed for that owner for ${Math.round(GITHUB_CREDENTIAL_BLOCK_TTL_MS / 60000)} minutes, or until the next index update, install, preview, GitHub search, credential reset, or SSO authorization`,
        );
      }
      if (
        !rootCause ||
        rankGitHubFailureKind(kind) < rankGitHubFailureKind(rootCause.kind)
      ) {
        rootCause = {
          kind,
          ssoAuthorizationUrl: extractSsoAuthorizationUrl(candidate.headers),
        };
      }
    };

    let requestUrl = url;
    let requestAccept = options.accept;
    let activeToken = isGitHubCredentialBlocked(url, options.token)
      ? undefined
      : options.token;
    let requestHeaders = buildRequestHeaders(
      createGitHubHeaders(url, requestAccept, activeToken),
      options.extraHeaders,
      false,
    );
    let response = await send(requestUrl, requestHeaders);

    if (
      response.status === 404 &&
      Boolean(options.token) &&
      isRawGitHubUrl(url)
    ) {
      const authenticatedUrl =
        typeof options.authenticatedUrl === "function"
          ? await resolveWithinGitHubOperation(
              options.authenticatedUrl(),
              budget,
              "authenticated content URL",
            )
          : options.authenticatedUrl;
      if (!authenticatedUrl) {
        return response;
      }

      // The escalation still happens for a blocked credential: it moves the
      // request onto the API URL, which is the only URL a later credential can
      // authenticate against. Only the Authorization header is withheld, and an
      // anonymous API request answers 404 rather than 403, so branch fallback
      // keeps working.
      const escalationToken = isGitHubCredentialBlocked(
        authenticatedUrl,
        options.token,
      )
        ? undefined
        : options.token;
      requestUrl = authenticatedUrl;
      requestAccept = "application/vnd.github.raw+json";
      activeToken = escalationToken;
      requestHeaders = buildRequestHeaders(
        {
          Accept: requestAccept,
          "User-Agent": GITHUB_USER_AGENT,
          ...(escalationToken
            ? { Authorization: `token ${escalationToken}` }
            : {}),
        },
        options.extraHeaders,
        !escalationToken,
      );
      response = await send(requestUrl, requestHeaders);
    }

    // Gate on the headers actually sent so the escalated request is covered too.
    if (
      requestHeaders.Authorization &&
      (response.status === 401 || response.status === 403)
    ) {
      await recordCredentialFailure(requestUrl, activeToken, response);
      response = await retryGitHubRequestAnonymously(response, true, () =>
        send(
          requestUrl,
          buildRequestHeaders(
            {
              Accept: requestAccept,
              "User-Agent": GITHUB_USER_AGENT,
            },
            options.extraHeaders,
            true,
          ),
        ),
      );
    }

    const triedTokens = new Set<string>();
    if (options.token) {
      triedTokens.add(options.token);
    }
    let walkToken = options.token;

    for (
      let attempt = 0;
      walkToken &&
      [401, 403, 404].includes(response.status) &&
      attempt < GITHUB_TOKEN_FALLBACK_MAX_ATTEMPTS;
      attempt++
    ) {
      const fallback = await resolveWithinGitHubOperation(
        resolveGitHubTokenAfterFailure(walkToken, triedTokens),
        budget,
        describeGitHubRequest(requestUrl),
      );
      if (!fallback || triedTokens.has(fallback.token)) {
        break;
      }
      triedTokens.add(fallback.token);
      walkToken = fallback.token;
      if (isGitHubCredentialBlocked(requestUrl, fallback.token)) {
        continue;
      }
      logger.info(
        `[Resource Ninja] GitHub returned ${response.status} for ${describeGitHubRequest(requestUrl)}; retrying with the next credential source: ${fallback.source}`,
      );
      response = await send(
        requestUrl,
        buildRequestHeaders(
          createGitHubHeaders(requestUrl, requestAccept, fallback.token),
          options.extraHeaders,
          false,
        ),
      );
      await recordCredentialFailure(requestUrl, fallback.token, response);
    }

    // Annotate only 401/403 so a 404 keeps the meaning branch fallback relies on.
    if (rootCause && (response.status === 401 || response.status === 403)) {
      annotateGitHubRootCause(response, rootCause);
    }

    return response;
  } catch (error) {
    if (operationTimedOut) {
      throw createGitHubTimeoutError(describeGitHubRequest(url));
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}
