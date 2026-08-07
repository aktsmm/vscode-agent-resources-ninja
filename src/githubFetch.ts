import { resolveGitHubTokenAfterFailure } from "./githubAuth";
import { retryGitHubRequestAnonymously } from "./githubResponse";
import { logger } from "./logger";

const GITHUB_USER_AGENT = "VSCode-AgentResourcesNinja";
const GITHUB_API_PREFIX = "https://api.github.com/";
const RAW_GITHUB_PREFIX = "https://raw.githubusercontent.com/";
export const GITHUB_REQUEST_TIMEOUT_MS = 15000;
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
      throw new Error(`Request timeout: ${describeGitHubRequest(url)}`);
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

function buildAuthenticatedContentUrl(rawUrl: string): string | undefined {
  try {
    const parsed = new URL(rawUrl);
    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length < 4) {
      return undefined;
    }

    const [owner, repo, branch, ...contentPath] = segments;
    return `${GITHUB_API_PREFIX}repos/${owner}/${repo}/contents/${contentPath.join("/")}?ref=${branch}`;
  } catch {
    return undefined;
  }
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

/** 429 と一過性のゲートウェイ失敗だけを対象にする。401/403/404 は auth fallback の担当。 */
export function isRetryableGitHubStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
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

function isTransientNetworkError(
  error: unknown,
  signal: AbortSignal | undefined,
): boolean {
  if (signal?.aborted) {
    return false;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  // 呼び出し側のキャンセルは再試行しない。内部タイムアウトだけ一過性として扱う。
  if (error.name === "AbortError") {
    return false;
  }
  if (error.message.startsWith("Request timeout: ")) {
    return true;
  }
  return error instanceof TypeError;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  authenticatedUrl?: string;
  signal?: AbortSignal;
  extraHeaders?: Record<string, string>;
  maxAttempts?: number;
  request?: (url: string, init?: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

function buildRequestHeaders(
  headers: Record<string, string>,
  extraHeaders: Record<string, string> | undefined,
  anonymous: boolean,
): Record<string, string> {
  const merged: Record<string, string> = { ...(extraHeaders ?? {}), ...headers };
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
): Promise<Response> {
  const maxAttempts = normalizeMaxAttempts(options.maxAttempts);
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const signal = options.signal;

  for (let attempt = 1; ; attempt++) {
    let response: Response;
    try {
      response = await perform();
    } catch (error) {
      if (attempt >= maxAttempts || !isTransientNetworkError(error, signal)) {
        throw error;
      }
      const delay = getBackoffDelayMs(attempt, random());
      if (delay > GITHUB_RETRY_MAX_WAIT_MS) {
        throw error;
      }
      logger.warn(
        `[Resource Ninja] Transient network failure for ${label}; retrying in ${delay}ms (attempt ${attempt}/${maxAttempts})`,
      );
      await sleep(delay);
      if (signal?.aborted) {
        throw error;
      }
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
    await sleep(delay);
    if (signal?.aborted) {
      return response;
    }
  }
}

export async function fetchGitHubWithOptionalAuthRetry(
  url: string,
  options: GitHubRequestOptions,
): Promise<Response> {
  const request = options.request ?? fetchGitHubWithTimeout;
  // リトライ層はここだけ。個々のリクエストを包むので、認証エスカレーションは再実行されない。
  const send = (targetUrl: string, headers: Record<string, string>) =>
    sendGitHubRequestWithRetry(
      () =>
        request(targetUrl, {
          headers,
          method: options.method,
          signal: options.signal,
        }),
      options,
      describeGitHubRequest(targetUrl),
    );

  let requestUrl = url;
  let requestAccept = options.accept;
  let requestHeaders = buildRequestHeaders(
    createGitHubHeaders(url, requestAccept, options.token),
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
      options.authenticatedUrl || buildAuthenticatedContentUrl(url);
    if (!authenticatedUrl) {
      return response;
    }

    requestUrl = authenticatedUrl;
    requestAccept = "application/vnd.github.raw+json";
    requestHeaders = buildRequestHeaders(
      {
        Accept: requestAccept,
        "User-Agent": GITHUB_USER_AGENT,
        Authorization: `token ${options.token}`,
      },
      options.extraHeaders,
      false,
    );
    response = await send(requestUrl, requestHeaders);
  }

  // Gate on the headers actually sent so the escalated request is covered too.
  if (
    requestHeaders.Authorization &&
    (response.status === 401 || response.status === 403)
  ) {
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
  let activeToken = options.token;
  if (activeToken) {
    triedTokens.add(activeToken);
  }

  for (
    let attempt = 0;
    activeToken &&
    [401, 403, 404].includes(response.status) &&
    attempt < GITHUB_TOKEN_FALLBACK_MAX_ATTEMPTS;
    attempt++
  ) {
    const fallback = await resolveGitHubTokenAfterFailure(
      activeToken,
      triedTokens,
    );
    if (!fallback || triedTokens.has(fallback.token)) {
      break;
    }
    triedTokens.add(fallback.token);
    activeToken = fallback.token;
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
  }

  return response;
}
