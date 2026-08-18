#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

function requireTypeScriptModule(filePath, stubs = {}) {
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  });
  const loadedModule = new Module(filePath, module);
  loadedModule.filename = filePath;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(filePath));
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) {
      return stubs[request];
    }
    return originalLoad(request, parent, isMain);
  };
  try {
    loadedModule._compile(transpiled.outputText, filePath);
  } finally {
    Module._load = originalLoad;
  }
  return loadedModule.exports;
}

function response(status, body = "", headers = {}) {
  return new Response(body, { status, headers });
}

async function test(name, fn) {
  // Cases share owners, so a block recorded by an earlier case would strip the token.
  githubCredentialBlocklistModule.resetGitHubCredentialBlocklist();
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const root = path.join(__dirname, "..");
const githubResponseModule = requireTypeScriptModule(
  path.join(root, "src", "githubResponse.ts"),
);
const githubCredentialBlocklistModule = requireTypeScriptModule(
  path.join(root, "src", "githubCredentialBlocklist.ts"),
);
let resolveFallback = async () => undefined;
const loggedLines = [];
const loggerSpy = {
  info: (...args) => loggedLines.push(args.join(" ")),
  warn: (...args) => loggedLines.push(args.join(" ")),
  error: (...args) => loggedLines.push(args.join(" ")),
};
const {
  fetchGitHubWithOptionalAuthRetry,
  fetchGitHubWithTimeout,
  GITHUB_REQUEST_TIMEOUT_MS,
} = requireTypeScriptModule(path.join(root, "src", "githubFetch.ts"), {
  "./githubResponse": githubResponseModule,
  "./githubCredentialBlocklist": githubCredentialBlocklistModule,
  "./logger": { logger: loggerSpy },
  "./githubAuth": {
    resolveGitHubTokenAfterFailure: async (failedToken) =>
      resolveFallback(failedToken),
  },
});
const {
  classifyGitHubFailure,
  classifyGitHubTransportFailure,
  createGitHubResponseError,
  retryGitHubRequestAnonymously,
} = githubResponseModule;

(async () => {
  const originalFetch = global.fetch;

  await test("uses a bounded default request timeout", async () => {
    assert.strictEqual(GITHUB_REQUEST_TIMEOUT_MS, 15000);
    global.fetch = async (_url, options = {}) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      });

    await assert.rejects(
      () =>
        fetchGitHubWithTimeout("https://api.github.com/repos/octo/repo", {}, 5),
      (error) =>
        error.message === "Request timeout: api.github.com/repos/octo/repo" &&
        error.code === "ETIMEDOUT",
    );
  });

  await test("keeps query strings out of timeout diagnostics", async () => {
    global.fetch = async (_url, options = {}) =>
      new Promise((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });

    await assert.rejects(
      () =>
        fetchGitHubWithTimeout(
          "https://api.github.com/repos/octo/repo/contents/SKILL.md?ref=main",
          {},
          5,
        ),
      (error) =>
        error.message ===
        "Request timeout: api.github.com/repos/octo/repo/contents/SKILL.md",
    );
  });

  await test("preserves caller cancellation instead of reporting timeout", async () => {
    global.fetch = async (_url, options = {}) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => {
            const error = new Error("caller aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      });
    const controller = new AbortController();
    const request = fetchGitHubWithTimeout(
      "https://api.github.com/repos/octo/repo",
      { signal: controller.signal },
      1000,
    );
    controller.abort();

    await assert.rejects(
      request,
      (error) =>
        error.name === "AbortError" && error.message === "caller aborted",
    );
  });

  await test("successful requests release timeout and caller listener", async () => {
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    const timeoutHandle = { id: "timeout" };
    let clearedHandle;
    let addedListener;
    let removedListener;
    const callerSignal = {
      aborted: false,
      addEventListener(_event, listener) {
        addedListener = listener;
      },
      removeEventListener(_event, listener) {
        removedListener = listener;
      },
    };
    global.setTimeout = (_callback, timeoutMs) => {
      assert.strictEqual(timeoutMs, 250);
      return timeoutHandle;
    };
    global.clearTimeout = (handle) => {
      clearedHandle = handle;
    };
    global.fetch = async () => response(200, "ok");

    try {
      const result = await fetchGitHubWithTimeout(
        "https://api.github.com/repos/octo/repo",
        { signal: callerSignal },
        250,
      );
      assert.strictEqual(result.status, 200);
      assert.strictEqual(clearedHandle, timeoutHandle);
      assert.strictEqual(removedListener, addedListener);
    } finally {
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
    }
  });

  await test("fetches public raw content anonymously", async () => {
    const requests = [];
    global.fetch = async (url, options = {}) => {
      requests.push({ url: String(url), headers: options.headers || {} });
      return response(200, "public");
    };

    const result = await fetchGitHubWithOptionalAuthRetry(
      "https://raw.githubusercontent.com/octo/public/main/SKILL.md",
      { accept: "text/plain", token: "secret-token" },
    );

    assert.strictEqual(result.status, 200);
    assert.strictEqual(requests.length, 1);
    assert.strictEqual(requests[0].headers.Authorization, undefined);
  });

  await test("resolves the authenticated URL only after an anonymous raw 404", async () => {
    let resolutions = 0;
    const authenticatedUrl = async () => {
      resolutions += 1;
      return "https://api.github.com/repos/octo/private/contents/SKILL.md?ref=feature%2Fx";
    };

    global.fetch = async () => response(200, "public");
    await fetchGitHubWithOptionalAuthRetry(
      "https://raw.githubusercontent.com/octo/public/feature/x/SKILL.md",
      { accept: "text/plain", token: "secret-token", authenticatedUrl },
    );
    assert.strictEqual(
      resolutions,
      0,
      "public content must not resolve the API route",
    );

    let requests = 0;
    global.fetch = async () => {
      requests += 1;
      return requests === 1
        ? response(404, "Not Found")
        : response(200, "private");
    };
    await fetchGitHubWithOptionalAuthRetry(
      "https://raw.githubusercontent.com/octo/private/feature/x/SKILL.md",
      { accept: "text/plain", token: "secret-token", authenticatedUrl },
    );
    assert.strictEqual(
      resolutions,
      1,
      "private escalation resolves the API route once",
    );
  });

  await test("retries an anonymous raw 404 through the authenticated API", async () => {
    const requests = [];
    global.fetch = async (url, options = {}) => {
      requests.push({ url: String(url), headers: options.headers || {} });
      return requests.length === 1
        ? response(404, "Not Found")
        : response(200, "private");
    };

    const result = await fetchGitHubWithOptionalAuthRetry(
      "https://raw.githubusercontent.com/octo/private/main/skills/demo/SKILL.md",
      {
        accept: "text/plain",
        token: "secret-token",
        authenticatedUrl:
          "https://api.github.com/repos/octo/private/contents/skills/demo/SKILL.md?ref=main",
      },
    );

    assert.strictEqual(result.status, 200);
    assert.strictEqual(requests[0].headers.Authorization, undefined);
    assert.match(requests[1].url, /^https:\/\/api\.github\.com\/repos\//);
    assert.strictEqual(requests[1].headers.Authorization, "token secret-token");
  });

  await test("uses the explicit Contents URL for a multi-segment branch", async () => {
    const requests = [];
    global.fetch = async (url) => {
      requests.push(String(url));
      return requests.length === 1
        ? response(404, "Not Found")
        : response(200, "private");
    };

    const authenticatedUrl =
      "https://api.github.com/repos/octo/private/contents/SKILL.md?ref=feature%2Fx%20y";
    const result = await fetchGitHubWithOptionalAuthRetry(
      "https://raw.githubusercontent.com/octo/private/feature/x%20y/SKILL.md",
      {
        accept: "text/plain",
        token: "secret-token",
        authenticatedUrl,
      },
    );

    assert.strictEqual(result.status, 200);
    assert.strictEqual(requests[1], authenticatedUrl);
    assert.strictEqual(
      new URL(requests[1]).searchParams.get("ref"),
      "feature/x y",
    );
  });

  await test("does not infer an authenticated URL from an ambiguous raw path", async () => {
    const requests = [];
    global.fetch = async (url) => {
      requests.push(String(url));
      return response(404, "Not Found");
    };

    const result = await fetchGitHubWithOptionalAuthRetry(
      "https://raw.githubusercontent.com/octo/private/feature/x/SKILL.md",
      { accept: "text/plain", token: "secret-token" },
    );

    assert.strictEqual(result.status, 404);
    assert.deepStrictEqual(requests, [
      "https://raw.githubusercontent.com/octo/private/feature/x/SKILL.md",
    ]);
  });

  await test("retries private raw content with the next distinct credential", async () => {
    const requests = [];
    resolveFallback = async (failedToken) => {
      assert.strictEqual(failedToken, "secret-token");
      return { token: "env-token", source: "env" };
    };
    global.fetch = async (url, options = {}) => {
      requests.push({
        url: String(url),
        headers: options.headers || {},
        method: options.method,
      });
      return requests.length < 3
        ? response(404, "Not Found")
        : response(200, "private");
    };

    try {
      const result = await fetchGitHubWithOptionalAuthRetry(
        "https://raw.githubusercontent.com/octo/private/main/SKILL.md",
        {
          accept: "text/plain",
          token: "secret-token",
          authenticatedUrl:
            "https://api.github.com/repos/octo/private/contents/SKILL.md?ref=main",
        },
      );
      assert.strictEqual(result.status, 200);
      assert.strictEqual(requests.length, 3);
      assert.strictEqual(requests[0].headers.Authorization, undefined);
      assert.strictEqual(
        requests[1].headers.Authorization,
        "token secret-token",
      );
      assert.strictEqual(requests[2].headers.Authorization, "token env-token");
      assert.strictEqual(requests[2].url, requests[1].url);
    } finally {
      resolveFallback = async () => undefined;
    }
  });

  await test("preserves HEAD across private and credential retries", async () => {
    const requests = [];
    resolveFallback = async () => ({ token: "gh-token", source: "gh-cli" });
    global.fetch = async (url, options = {}) => {
      requests.push({
        url: String(url),
        headers: options.headers || {},
        method: options.method,
      });
      return requests.length < 3
        ? response(404, "Not Found")
        : response(200, "");
    };

    try {
      const result = await fetchGitHubWithOptionalAuthRetry(
        "https://raw.githubusercontent.com/octo/private/main/SKILL.md",
        {
          accept: "*/*",
          token: "secret-token",
          method: "HEAD",
          authenticatedUrl:
            "https://api.github.com/repos/octo/private/contents/SKILL.md?ref=main",
        },
      );
      assert.strictEqual(result.status, 200);
      assert.strictEqual(requests.length, 3);
      assert.ok(requests.every((request) => request.method === "HEAD"));
      assert.strictEqual(requests[2].headers.Authorization, "token gh-token");
    } finally {
      resolveFallback = async () => undefined;
    }
  });

  await test("retries SAML and stale-token API failures anonymously", async () => {
    for (const initial of [
      response(403, "Resource protected by organization SAML enforcement"),
      response(401, "Bad credentials"),
    ]) {
      // The SAML iteration blocks this owner, so the stale-token case starts clean.
      githubCredentialBlocklistModule.resetGitHubCredentialBlocklist();
      const requests = [];
      global.fetch = async (url, options = {}) => {
        requests.push({ url: String(url), headers: options.headers || {} });
        return requests.length === 1 ? initial : response(200, "public");
      };

      const result = await fetchGitHubWithOptionalAuthRetry(
        "https://api.github.com/repos/octo/public",
        { accept: "application/json", token: "stale-token" },
      );
      assert.strictEqual(result.status, 200);
      assert.strictEqual(
        requests[0].headers.Authorization,
        "token stale-token",
      );
      assert.strictEqual(requests[1].headers.Authorization, undefined);
    }
  });

  await test("retries API auth failure with a different credential", async () => {
    const requests = [];
    resolveFallback = async () => ({ token: "gh-token", source: "gh-cli" });
    global.fetch = async (url, options = {}) => {
      requests.push({ url: String(url), headers: options.headers || {} });
      if (requests.length === 1) {
        return response(401, "Bad credentials");
      }
      if (requests.length === 2) {
        return response(404, "Not Found");
      }
      return response(200, "private");
    };

    try {
      const result = await fetchGitHubWithOptionalAuthRetry(
        "https://api.github.com/repos/octo/private",
        { accept: "application/json", token: "secret-token" },
      );
      assert.strictEqual(result.status, 200);
      assert.strictEqual(requests.length, 3);
      assert.strictEqual(
        requests[0].headers.Authorization,
        "token secret-token",
      );
      assert.strictEqual(requests[1].headers.Authorization, undefined);
      assert.strictEqual(requests[2].headers.Authorization, "token gh-token");
    } finally {
      resolveFallback = async () => undefined;
    }
  });

  await test("preserves the authenticated failure when anonymous retry fails", async () => {
    const initial = response(401, "Bad credentials");
    const result = await retryGitHubRequestAnonymously(
      initial,
      true,
      async () => response(404, "Not Found"),
    );
    assert.strictEqual(result, initial);
  });

  await test("does not retry rate-limit failures anonymously", async () => {
    const requests = [];
    global.fetch = async (url, options = {}) => {
      requests.push({ url: String(url), headers: options.headers || {} });
      return response(403, "API rate limit exceeded", {
        "x-ratelimit-remaining": "0",
      });
    };

    const result = await fetchGitHubWithOptionalAuthRetry(
      "https://api.github.com/repos/octo/public",
      { accept: "application/json", token: "secret-token" },
    );
    assert.strictEqual(result.status, 403);
    assert.strictEqual(requests.length, 1);
  });

  await test("does not retry a 429 response", async () => {
    const requests = [];
    const sleeps = [];
    global.fetch = async (url, options = {}) => {
      requests.push({ url: String(url), headers: options.headers || {} });
      return response(429, "Too Many Requests", { "retry-after": "2" });
    };

    const result = await fetchGitHubWithOptionalAuthRetry(
      "https://api.github.com/repos/octo/public",
      {
        accept: "application/json",
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        now: () => 0,
        random: () => 0,
      },
    );

    assert.strictEqual(result.status, 429);
    assert.strictEqual(requests.length, 1);
    assert.deepStrictEqual(sleeps, []);
  });

  await test("gives up instead of waiting out a long rate-limit reset", async () => {
    const requests = [];
    const sleeps = [];
    global.fetch = async (url, options = {}) => {
      requests.push({ url: String(url), headers: options.headers || {} });
      return response(429, "Too Many Requests", {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "3600",
      });
    };

    const result = await fetchGitHubWithOptionalAuthRetry(
      "https://api.github.com/repos/octo/public",
      {
        accept: "application/json",
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        now: () => 0,
        random: () => 0,
      },
    );

    assert.strictEqual(result.status, 429);
    assert.strictEqual(requests.length, 1);
    assert.deepStrictEqual(sleeps, []);
  });

  await test("never retries auth or missing statuses", async () => {
    for (const status of [401, 403, 404]) {
      const requests = [];
      global.fetch = async (url, options = {}) => {
        requests.push({ url: String(url), headers: options.headers || {} });
        return response(status, "nope");
      };

      const result = await fetchGitHubWithOptionalAuthRetry(
        "https://api.github.com/repos/octo/public",
        {
          accept: "application/json",
          sleep: async () => {
            throw new Error(`status ${status} must not back off`);
          },
        },
      );
      assert.strictEqual(result.status, status);
      assert.strictEqual(requests.length, 1);
    }
  });

  await test("caps a broken maxAttempts instead of looping forever", async () => {
    for (const maxAttempts of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -5,
      0,
      -0.5,
      1.9,
      10.9,
    ]) {
      const requests = [];
      global.fetch = async () => {
        requests.push(1);
        return response(503, "Service Unavailable");
      };

      const result = await fetchGitHubWithOptionalAuthRetry(
        "https://api.github.com/repos/octo/public",
        {
          accept: "application/json",
          maxAttempts,
          sleep: async () => undefined,
          now: () => 0,
          random: () => 0,
        },
      );
      assert.strictEqual(result.status, 503);
      assert.ok(
        requests.length >= 1 && requests.length <= 10,
        `maxAttempts ${maxAttempts} produced ${requests.length} requests`,
      );
      if (maxAttempts === 1.9) {
        assert.strictEqual(requests.length, 1, "1.9 must floor to 1 attempt");
      }
      if (maxAttempts === 10.9) {
        // The exponential cap stops earlier than the clamp, which is the point.
        assert.ok(
          requests.length > 1 && requests.length <= 10,
          `10.9 produced ${requests.length} requests`,
        );
      }
    }
  });

  await test("stops retrying when the caller aborts during the backoff", async () => {
    const controller = new AbortController();
    const requests = [];
    global.fetch = async () => {
      requests.push(1);
      return response(429, "Too Many Requests");
    };

    const result = await fetchGitHubWithOptionalAuthRetry(
      "https://api.github.com/repos/octo/public",
      {
        accept: "application/json",
        signal: controller.signal,
        sleep: async () => {
          controller.abort();
        },
        now: () => 0,
        random: () => 0,
      },
    );

    assert.strictEqual(result.status, 429);
    assert.strictEqual(requests.length, 1);
  });

  await test("bounds the worst case across escalation, anonymous, and credential retries", async () => {
    const fallbackTokens = ["tok-1", "tok-2", "tok-3", "tok-4", "tok-5"];
    let fallbackIndex = 0;
    resolveFallback = async () => {
      const token = fallbackTokens[fallbackIndex];
      fallbackIndex += 1;
      return token ? { token, source: "gh-cli" } : undefined;
    };

    // Walks raw 404 -> authenticated escalation -> anonymous retry -> credential fallback.
    const scriptedResponses = [
      () => response(404, "Not Found"),
      () => response(401, "Bad credentials"),
      () => response(503, "Service Unavailable"),
      () => response(404, "Not Found"),
    ];
    const requests = [];
    global.fetch = async (url, options = {}) => {
      requests.push({ url: String(url), headers: options.headers || {} });
      const scripted = scriptedResponses[requests.length - 1];
      return scripted ? scripted() : response(403, "Forbidden");
    };

    try {
      const result = await fetchGitHubWithOptionalAuthRetry(
        "https://raw.githubusercontent.com/octo/private/main/SKILL.md",
        {
          accept: "text/plain",
          token: "secret-token",
          authenticatedUrl:
            "https://api.github.com/repos/octo/private/contents/SKILL.md?ref=main",
          sleep: async () => undefined,
          now: () => 0,
          random: () => 0,
        },
      );

      assert.strictEqual(result.status, 403);
      assert.strictEqual(requests[0].headers.Authorization, undefined);
      assert.match(requests[1].url, /^https:\/\/api\.github\.com\/repos\//);
      assert.strictEqual(
        requests[1].headers.Authorization,
        "token secret-token",
      );
      assert.strictEqual(
        requests[2].headers.Authorization,
        undefined,
        "the authenticated 401 must be retried anonymously",
      );
      assert.deepStrictEqual(
        requests.slice(4).map((request) => request.headers.Authorization),
        ["token tok-1", "token tok-2", "token tok-3", "token tok-4"],
        "the credential fallback must stop after every source is tried once",
      );
      assert.strictEqual(requests.length, 8);
      // 3 attempts x (raw + escalation + anonymous + 4 credential retries).
      assert.ok(
        requests.length <= 3 * 7,
        `worst case grew to ${requests.length} requests`,
      );
    } finally {
      resolveFallback = async () => undefined;
    }
  });

  await test("retries an internal timeout but not a caller abort", async () => {
    let timeoutCalls = 0;
    const timeoutResult = await fetchGitHubWithOptionalAuthRetry(
      "https://api.github.com/repos/octo/public",
      {
        accept: "application/json",
        sleep: async () => undefined,
        now: () => 0,
        random: () => 0,
        request: async () => {
          timeoutCalls += 1;
          if (timeoutCalls === 1) {
            const error = new Error(
              "Request timeout: https://api.github.com/repos/octo/public",
            );
            error.code = "ETIMEDOUT";
            throw error;
          }
          return response(200, "ok");
        },
      },
    );
    assert.strictEqual(timeoutResult.status, 200);
    assert.strictEqual(timeoutCalls, 2);

    const controller = new AbortController();
    controller.abort();
    let abortCalls = 0;
    await assert.rejects(
      fetchGitHubWithOptionalAuthRetry(
        "https://api.github.com/repos/octo/public",
        {
          accept: "application/json",
          signal: controller.signal,
          sleep: async () => {
            throw new Error("a caller abort must not back off");
          },
          request: async () => {
            abortCalls += 1;
            const error = new Error("aborted");
            error.name = "AbortError";
            throw error;
          },
        },
      ),
      /aborted/,
    );
    assert.strictEqual(
      abortCalls,
      0,
      "an already-aborted operation must stop before the first request",
    );
  });

  await test("bounds cumulative retries with one operation deadline", async () => {
    let clock = 0;
    let requestCalls = 0;
    await assert.rejects(
      fetchGitHubWithOptionalAuthRetry(
        "https://api.github.com/repos/octo/public",
        {
          accept: "application/json",
          operationTimeoutMs: 600,
          now: () => clock,
          random: () => 0,
          request: async () => {
            requestCalls += 1;
            return response(503, "Service Unavailable");
          },
          sleep: async (delay) => {
            clock += delay;
          },
        },
      ),
      (error) =>
        error.code === "ETIMEDOUT" && /Operation timeout/.test(error.message),
    );
    assert.strictEqual(requestCalls, 2);
    assert.strictEqual(clock, 500);
  });

  await test("times out a custom request that ignores AbortSignal", async () => {
    await assert.rejects(
      fetchGitHubWithOptionalAuthRetry(
        "https://api.github.com/repos/octo/hanging",
        {
          accept: "application/json",
          operationTimeoutMs: 5,
          request: () => new Promise(() => {}),
        },
      ),
      (error) =>
        error.code === "ETIMEDOUT" && /Operation timeout/.test(error.message),
    );
  });

  await test("times out a lazy authenticated URL factory that never resolves", async () => {
    await assert.rejects(
      fetchGitHubWithOptionalAuthRetry(
        "https://raw.githubusercontent.com/octo/private/main/SKILL.md",
        {
          accept: "text/plain",
          token: "secret-token",
          operationTimeoutMs: 5,
          request: async () => response(404, "Not Found"),
          authenticatedUrl: () => new Promise(() => {}),
        },
      ),
      (error) =>
        error.code === "ETIMEDOUT" && /Operation timeout/.test(error.message),
    );
  });

  await test("forwards signal and extra headers, and drops auth when retrying anonymously", async () => {
    const controller = new AbortController();
    const requests = [];
    global.fetch = async (url, options = {}) => {
      requests.push({
        url: String(url),
        headers: options.headers || {},
        signal: options.signal,
      });
      return requests.length === 1
        ? response(401, "Bad credentials")
        : response(200, "public");
    };

    const result = await fetchGitHubWithOptionalAuthRetry(
      "https://api.github.com/repos/octo/public",
      {
        accept: "application/json",
        token: "stale-token",
        signal: controller.signal,
        extraHeaders: { "X-Trace": "abc", Authorization: "token leaked" },
      },
    );

    assert.strictEqual(result.status, 200);
    assert.strictEqual(requests.length, 2);
    assert.strictEqual(requests[0].headers["X-Trace"], "abc");
    assert.strictEqual(requests[0].headers.Authorization, "token stale-token");
    assert.strictEqual(requests[1].headers["X-Trace"], "abc");
    assert.strictEqual(requests[1].headers.Authorization, undefined);
    assert.ok(requests.every((request) => request.signal !== undefined));
  });

  await test("logs retries and credential switches without leaking a token", async () => {
    loggedLines.length = 0;
    resolveFallback = async () => ({
      token: "fallback-token",
      source: "gh-cli",
    });
    const requests = [];
    global.fetch = async (url, options = {}) => {
      requests.push({ url: String(url), headers: options.headers || {} });
      if (requests.length === 1) {
        return response(503, "Service Unavailable");
      }
      return requests.length === 2
        ? response(404, "Not Found")
        : response(200, "ok");
    };

    try {
      const result = await fetchGitHubWithOptionalAuthRetry(
        "https://api.github.com/repos/octo/private",
        {
          accept: "application/json",
          token: "secret-token",
          sleep: async () => undefined,
          now: () => 0,
          random: () => 0,
        },
      );

      assert.strictEqual(result.status, 200);
      const logged = loggedLines.join("\n");
      assert.match(logged, /GitHub returned 503 .*retrying in 500ms/);
      assert.match(logged, /next credential source: gh-cli/);
      assert.match(logged, /api\.github\.com\/repos\/octo\/private/);
      assert.doesNotMatch(
        logged,
        /secret-token|fallback-token|Authorization/,
        "diagnostics must never carry a credential",
      );
    } finally {
      resolveFallback = async () => undefined;
    }
  });

  await test("classifies SAML, rate-limit, server, and transport failures", async () => {
    assert.strictEqual(
      classifyGitHubFailure(
        response(403, "SAML enforcement"),
        "SAML enforcement",
      ),
      "sso-required",
    );
    assert.strictEqual(
      classifyGitHubFailure(
        response(403, "rate limit", { "x-ratelimit-remaining": "0" }),
        "rate limit",
      ),
      "rate-limit",
    );
    assert.strictEqual(
      classifyGitHubFailure(response(503, "Service Unavailable"), ""),
      "server-error",
    );
    const timeoutError = new Error("timed out");
    timeoutError.code = "ETIMEDOUT";
    assert.strictEqual(
      classifyGitHubTransportFailure(timeoutError),
      "transport",
    );
    const controller = new AbortController();
    controller.abort();
    assert.strictEqual(
      classifyGitHubTransportFailure(timeoutError, controller.signal),
      "other",
      "caller cancellation must not be retried as a transport failure",
    );
  });

  await test("keeps response bodies and tokens out of classified errors", async () => {
    const error = createGitHubResponseError(
      response(401, "Bad credentials: secret-token"),
      "Bad credentials: secret-token",
      "GitHub source request failed",
    );
    assert.doesNotMatch(error.message, /secret-token|Bad credentials/);
  });

  const githubFetchSource = fs.readFileSync(
    path.join(root, "src", "githubFetch.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    githubFetchSource,
    /fetch\(url,[\s\S]*?Authorization:[\s\S]*?isRawGitHubUrl/,
  );

  const bareFetchFiles = fs
    .readdirSync(path.join(root, "src"))
    .filter((fileName) => fileName.endsWith(".ts"))
    .filter((fileName) =>
      /\bfetch\s*\(/.test(
        fs.readFileSync(path.join(root, "src", fileName), "utf8"),
      ),
    )
    .sort();
  assert.deepStrictEqual(bareFetchFiles, ["githubAuth.ts", "githubFetch.ts"]);

  await test("the retry-not-before ladder follows GitHub's documented order", () => {
    const nowMs = Date.parse("2026-06-24T12:00:00.000Z");
    const withHeaders = (entries) => ({ headers: new Headers(entries) });

    assert.strictEqual(
      githubResponseModule.getGitHubRetryNotBefore(
        withHeaders({ "retry-after": "120" }),
        nowMs,
      ),
      "2026-06-24T12:02:00.000Z",
      "numeric retry-after wins",
    );
    assert.strictEqual(
      githubResponseModule.getGitHubRetryNotBefore(
        withHeaders({ "retry-after": "Wed, 24 Jun 2026 12:05:00 GMT" }),
        nowMs,
      ),
      "2026-06-24T12:05:00.000Z",
      "HTTP-date retry-after is accepted",
    );
    assert.strictEqual(
      githubResponseModule.getGitHubRetryNotBefore(
        withHeaders({
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(
            Math.floor(Date.parse("2026-06-24T12:45:00.000Z") / 1000),
          ),
        }),
        nowMs,
      ),
      "2026-06-24T12:45:00.000Z",
      "the reset header is used once the window is exhausted",
    );
    assert.strictEqual(
      githubResponseModule.getGitHubRetryNotBefore(withHeaders({}), nowMs),
      "2026-06-24T12:01:00.000Z",
      "a secondary limit with no headers still waits the documented minimum",
    );
    assert.strictEqual(
      githubResponseModule.getGitHubRetryNotBefore(
        withHeaders({
          "x-ratelimit-remaining": "12",
          "x-ratelimit-reset": String(
            Math.floor(Date.parse("2026-06-24T12:45:00.000Z") / 1000),
          ),
        }),
        nowMs,
      ),
      "2026-06-24T12:01:00.000Z",
      "a reset header with quota left is not a deadline",
    );
  });

  global.fetch = originalFetch;
  console.log("GitHub source fallback tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
