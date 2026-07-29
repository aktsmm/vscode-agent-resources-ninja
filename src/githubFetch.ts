import { retryGitHubRequestAnonymously } from "./githubResponse";

const GITHUB_USER_AGENT = "VSCode-AgentResourcesNinja";
const GITHUB_API_PREFIX = "https://api.github.com/";
const RAW_GITHUB_PREFIX = "https://raw.githubusercontent.com/";

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
  const request = options.request || fetch;
  const headers = createGitHubHeaders(url, options.accept, options.token);

  const response = await request(url, {
    headers,
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

    return request(authenticatedUrl, {
      headers: {
        Accept: "application/vnd.github.raw+json",
        "User-Agent": GITHUB_USER_AGENT,
        Authorization: `token ${options.token}`,
      },
      method: options.method,
    });
  }

  if (isGitHubApiUrl(url)) {
    return retryGitHubRequestAnonymously(
      response,
      Boolean(headers.Authorization),
      () =>
        request(url, {
          headers: {
            Accept: options.accept,
            "User-Agent": GITHUB_USER_AGENT,
          },
          method: options.method,
        }),
    );
  }

  return response;
}
