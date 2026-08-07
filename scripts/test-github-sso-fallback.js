#!/usr/bin/env node

// Guards the GitHub auth-failure paths: anonymous retry coverage after a raw->API
// escalation, and not masking an exhausted anonymous quota as an SSO failure.

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

const repoRoot = path.resolve(__dirname, "..");
const githubResponse = requireTypeScriptModule(
  path.join(repoRoot, "src", "githubResponse.ts"),
);
const githubFetch = requireTypeScriptModule(
  path.join(repoRoot, "src", "githubFetch.ts"),
  {
    "./githubResponse": githubResponse,
    "./logger": { logger: { info() {}, warn() {}, error() {} } },
    "./githubAuth": { resolveGitHubTokenAfterFailure: async () => undefined },
  },
);

const RAW_URL =
  "https://raw.githubusercontent.com/MicrosoftDocs/example/main/skills/demo/SKILL.md";
const API_URL =
  "https://api.github.com/repos/MicrosoftDocs/example/git/trees/main";

const SSO_BODY = JSON.stringify({
  message:
    "Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization.",
});

function ssoResponse() {
  return new Response(SSO_BODY, {
    status: 403,
    headers: { "x-github-sso": "required; url=https://github.com/orgs/x/sso" },
  });
}

function rateLimitedResponse() {
  return new Response(
    JSON.stringify({ message: "API rate limit exceeded for 203.0.113.1." }),
    {
      status: 403,
      headers: {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "1780000000",
      },
    },
  );
}

function createRecordingRequest(handlers) {
  const calls = [];
  const request = async (url, init) => {
    calls.push({
      url,
      authorization: init?.headers?.Authorization,
      accept: init?.headers?.Accept,
    });
    const handler = handlers[calls.length - 1];
    assert.ok(handler, `Unexpected request #${calls.length} to ${url}`);
    return handler(url, init);
  };
  return { request, calls };
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

async function run() {
  await test("SSO failure after a raw->API escalation is retried anonymously", async () => {
    const { request, calls } = createRecordingRequest([
      () => new Response("", { status: 404 }),
      () => ssoResponse(),
      () => new Response("skill body", { status: 200 }),
    ]);

    const response = await githubFetch.fetchGitHubWithOptionalAuthRetry(
      RAW_URL,
      { accept: "text/plain", token: "ghp_example", request },
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(await response.text(), "skill body");
    assert.strictEqual(calls.length, 3);
    assert.strictEqual(calls[0].authorization, undefined);
    assert.ok(calls[1].url.startsWith("https://api.github.com/"));
    assert.strictEqual(calls[1].authorization, "token ghp_example");
    assert.strictEqual(calls[2].url, calls[1].url);
    assert.strictEqual(calls[2].authorization, undefined);
    assert.strictEqual(calls[2].accept, "application/vnd.github.raw+json");
  });

  await test("exhausted anonymous quota is not masked as an SSO failure", async () => {
    const { request, calls } = createRecordingRequest([
      () => ssoResponse(),
      () => rateLimitedResponse(),
    ]);

    const response = await githubFetch.fetchGitHubWithOptionalAuthRetry(
      API_URL,
      { accept: "application/vnd.github+json", token: "ghp_example", request },
    );

    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[1].authorization, undefined);

    const bodyText = await response.clone().text();
    assert.strictEqual(
      githubResponse.classifyGitHubFailure(response, bodyText),
      "rate-limit",
      "the surfaced failure must be the exhausted anonymous quota",
    );

    const error = githubResponse.createGitHubResponseError(
      response,
      bodyText,
      "GitHub tree request failed",
    );
    assert.strictEqual(error.kind, "rate-limit");
    assert.ok(error.resetAt, "rate-limit errors must carry a reset timestamp");
  });

  await test("an anonymous retry that also fails auth keeps the original failure", async () => {
    const { request, calls } = createRecordingRequest([
      () => ssoResponse(),
      () =>
        new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }),
    ]);

    const response = await githubFetch.fetchGitHubWithOptionalAuthRetry(
      API_URL,
      { accept: "application/vnd.github+json", token: "ghp_example", request },
    );

    assert.strictEqual(calls.length, 2);
    assert.strictEqual(response.status, 403);
    assert.strictEqual(
      githubResponse.classifyGitHubFailure(
        response,
        await response.clone().text(),
      ),
      "sso-required",
    );
  });

  await test("requests without an Authorization header are not retried", async () => {
    const { request, calls } = createRecordingRequest([
      () => new Response("", { status: 404 }),
    ]);

    const response = await githubFetch.fetchGitHubWithOptionalAuthRetry(
      RAW_URL,
      { accept: "text/plain", request },
    );

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(response.status, 404);
  });

  await test("403 kinds stay distinguishable", () => {
    const classify = githubResponse.classifyGitHubFailure;

    assert.strictEqual(classify(ssoResponse(), SSO_BODY), "sso-required");
    assert.strictEqual(
      classify(new Response("", { status: 403 }), "rate limit exceeded"),
      "rate-limit",
    );
    assert.strictEqual(
      classify(
        new Response("", { status: 403 }),
        "`org` forbids access via a personal access tokens (classic)",
      ),
      "classic-pat-forbidden",
    );
    assert.strictEqual(
      classify(new Response("", { status: 403 }), "Forbidden"),
      "auth-required",
    );
  });

  console.log("\nAll GitHub SSO fallback tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
