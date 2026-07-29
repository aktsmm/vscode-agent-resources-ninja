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
const { fetchGitHubWithOptionalAuthRetry } = requireTypeScriptModule(
  path.join(root, "src", "githubFetch.ts"),
  { "./githubResponse": githubResponseModule },
);
const {
  classifyGitHubFailure,
  createGitHubResponseError,
  retryGitHubRequestAnonymously,
} = githubResponseModule;

(async () => {
  const originalFetch = global.fetch;

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

  global.fetch = originalFetch;
  console.log("GitHub source fallback tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
