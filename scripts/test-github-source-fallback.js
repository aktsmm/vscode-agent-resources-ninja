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
let resolveFallback = async () => undefined;
const {
  fetchGitHubWithOptionalAuthRetry,
  fetchGitHubWithTimeout,
  GITHUB_REQUEST_TIMEOUT_MS,
} = requireTypeScriptModule(
  path.join(root, "src", "githubFetch.ts"),
  {
    "./githubResponse": githubResponseModule,
    "./githubAuth": {
      resolveGitHubTokenAfterFailure: async (failedToken) =>
        resolveFallback(failedToken),
    },
  },
);
const {
  classifyGitHubFailure,
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
        fetchGitHubWithTimeout(
          "https://api.github.com/repos/octo/repo",
          {},
          5,
        ),
      (error) =>
        error.message ===
        "Request timeout: https://api.github.com/repos/octo/repo",
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
      { accept: "text/plain", token: "secret-token" },
    );

    assert.strictEqual(result.status, 200);
    assert.strictEqual(requests[0].headers.Authorization, undefined);
    assert.match(requests[1].url, /^https:\/\/api\.github\.com\/repos\//);
    assert.strictEqual(requests[1].headers.Authorization, "token secret-token");
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
        { accept: "text/plain", token: "secret-token" },
      );
      assert.strictEqual(result.status, 200);
      assert.strictEqual(requests.length, 3);
      assert.strictEqual(requests[0].headers.Authorization, undefined);
      assert.strictEqual(requests[1].headers.Authorization, "token secret-token");
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
        { accept: "*/*", token: "secret-token", method: "HEAD" },
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
      assert.strictEqual(requests[0].headers.Authorization, "token secret-token");
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

  await test("classifies SAML and rate-limit responses", async () => {
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

  global.fetch = originalFetch;
  console.log("GitHub source fallback tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
