import { resolveGitHubTokenAfterFailure } from "./githubAuth";
import { retryGitHubRequestAnonymously } from "./githubResponse";

const GITHUB_USER_AGENT = "VSCode-AgentResourcesNinja";
const GITHUB_API_PREFIX = "https://api.github.com/";
const RAW_GITHUB_PREFIX = "https://raw.githubusercontent.com/";
export const GITHUB_REQUEST_TIMEOUT_MS = 15000;

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
      throw new Error(`Request timeout: ${url}`);
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

export async function fetchGitHubWithOptionalAuthRetry(
  url: string,
  options: {
    accept: string;
    token?: string;
    method?: string;
    authenticatedUrl?: string;
    request?: (url: string, init?: RequestInit) => Promise<Response>;
  },
): Promise<Response> {
  const request = options.request ?? fetchGitHubWithTimeout;

  let requestUrl = url;
  let requestAccept = options.accept;
  let requestHeaders = createGitHubHeaders(url, requestAccept, options.token);
  let response = await request(requestUrl, {
    headers: requestHeaders,
    method: options.method,
  });

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
    requestHeaders = {
      Accept: requestAccept,
      "User-Agent": GITHUB_USER_AGENT,
      Authorization: `token ${options.token}`,
    };
    response = await request(requestUrl, {
      headers: requestHeaders,
      method: options.method,
    });
  }

  // Gate on the headers actually sent so the escalated request is covered too.
  if (
    requestHeaders.Authorization &&
    (response.status === 401 || response.status === 403)
  ) {
    response = await retryGitHubRequestAnonymously(response, true, () =>
      request(requestUrl, {
        headers: {
          Accept: requestAccept,
          "User-Agent": GITHUB_USER_AGENT,
        },
        method: options.method,
      }),
    );
  }

  if ([401, 403, 404].includes(response.status) && options.token) {
    const fallback = await resolveGitHubTokenAfterFailure(options.token);
    if (fallback) {
      response = await request(requestUrl, {
        headers: createGitHubHeaders(requestUrl, requestAccept, fallback.token),
        method: options.method,
      });
    }
  }

  return response;
}
