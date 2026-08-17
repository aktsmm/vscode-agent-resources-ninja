#!/usr/bin/env node

// Guards the SSO credential blocklist and the root-cause attribution that rides
// along with it: a rejected credential must stop being re-sent, a blocked
// credential must not turn a 404 into a 403 or strand the next credential, and
// the surfaced `kind` must stay untouched so batch abort keeps working.

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
const srcDir = path.join(repoRoot, "src");

const blocklist = requireTypeScriptModule(
  path.join(srcDir, "githubCredentialBlocklist.ts"),
);
const githubResponse = requireTypeScriptModule(
  path.join(srcDir, "githubResponse.ts"),
);

let resolveFallback = async () => undefined;
const loggedLines = [];
const githubFetch = requireTypeScriptModule(
  path.join(srcDir, "githubFetch.ts"),
  {
    "./githubResponse": githubResponse,
    "./githubCredentialBlocklist": blocklist,
    "./logger": {
      logger: {
        info: (...args) => loggedLines.push(args.join(" ")),
        warn: (...args) => loggedLines.push(args.join(" ")),
        error: (...args) => loggedLines.push(args.join(" ")),
      },
    },
    "./githubAuth": {
      resolveGitHubTokenAfterFailure: async (failedToken, alreadyTried) =>
        resolveFallback(failedToken, alreadyTried),
    },
  },
);

const API_URL = "https://api.github.com/repos/Contoso/example/git/trees/main";
const OTHER_API_URL = "https://api.github.com/repos/other/example/contents/a";
const RAW_URL =
  "https://raw.githubusercontent.com/Contoso/private/main/skills/demo/SKILL.md";
const ESCALATED_URL =
  "https://api.github.com/repos/Contoso/private/contents/skills/demo/SKILL.md?ref=main";

const SSO_BODY = JSON.stringify({
  message:
    "Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization.",
});
const SSO_HEADERS = {
  "x-github-sso":
    "required; url=https://github.com/orgs/contoso/sso?authorization_request=ABC123",
};

function ssoResponse() {
  return new Response(SSO_BODY, { status: 403, headers: SSO_HEADERS });
}

function rateLimitResponse() {
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

const failures = [];

/** Mirrors the module's fingerprint so the guard can prove it never appears in output. */
function blocklistFingerprintOf(token) {
  return require("crypto")
    .createHash("sha256")
    .update(token)
    .digest("hex")
    .slice(0, 16);
}

async function test(name, fn) {
  blocklist.resetGitHubCredentialBlocklist();
  resolveFallback = async () => undefined;
  loggedLines.length = 0;
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

async function runOwnerParsingTests() {
  await test("owner is parsed from API and raw URLs and lowercased", () => {
    assert.strictEqual(blocklist.getGitHubBlocklistOwner(API_URL), "contoso");
    assert.strictEqual(blocklist.getGitHubBlocklistOwner(RAW_URL), "contoso");
    assert.strictEqual(
      blocklist.getGitHubBlocklistOwner(
        "https://api.github.com/repos/OCTO/repo",
      ),
      "octo",
    );
  });

  await test("URLs without an attributable owner are never blocked", () => {
    const unattributable = [
      "https://api.github.com/search/code?q=test",
      "https://api.github.com/user",
      "https://api.github.com/repos",
      "https://example.com/repos/octo/repo",
      "http://api.github.com/repos/octo/repo",
      "not a url",
      "https://api.github.com/repos/%2e%2e/repo",
      "https://api.github.com/repos/bad%2Fowner/repo",
      "https://api.github.com/repos/-leading/repo",
      "https://api.github.com/repos/has_underscore/repo",
      "https://raw.githubusercontent.com/%ZZ/repo/main/a.md",
    ];
    for (const url of unattributable) {
      assert.strictEqual(
        blocklist.getGitHubBlocklistOwner(url),
        undefined,
        `expected no owner for ${url}`,
      );
    }
  });

  await test("percent-encoded owners resolve to the decoded owner", () => {
    assert.strictEqual(
      blocklist.getGitHubBlocklistOwner(
        "https://api.github.com/repos/%43ontoso/repo",
      ),
      "contoso",
    );
  });
}

async function runBlocklistStateTests() {
  await test("a blocked credential expires after the TTL", () => {
    const epoch = blocklist.getGitHubCredentialBlocklistEpoch();
    blocklist.markGitHubCredentialBlocked(API_URL, "token-a", epoch, 1_000);
    assert.strictEqual(
      blocklist.isGitHubCredentialBlocked(API_URL, "token-a", 1_000),
      true,
    );
    assert.strictEqual(
      blocklist.isGitHubCredentialBlocked(
        API_URL,
        "token-a",
        1_000 + blocklist.GITHUB_CREDENTIAL_BLOCK_TTL_MS,
      ),
      false,
    );
  });

  await test("a block covers one owner and one credential only", () => {
    const epoch = blocklist.getGitHubCredentialBlocklistEpoch();
    blocklist.markGitHubCredentialBlocked(API_URL, "token-a", epoch);
    assert.strictEqual(
      blocklist.isGitHubCredentialBlocked(API_URL, "token-a"),
      true,
    );
    assert.strictEqual(
      blocklist.isGitHubCredentialBlocked(API_URL, "token-b"),
      false,
    );
    assert.strictEqual(
      blocklist.isGitHubCredentialBlocked(OTHER_API_URL, "token-a"),
      false,
    );
    assert.strictEqual(
      blocklist.isGitHubCredentialBlocked(API_URL, undefined),
      false,
    );
  });

  await test("a mark from a superseded epoch is ignored", () => {
    const staleEpoch = blocklist.getGitHubCredentialBlocklistEpoch();
    blocklist.resetGitHubCredentialBlocklist();
    blocklist.markGitHubCredentialBlocked(API_URL, "token-a", staleEpoch);
    assert.strictEqual(
      blocklist.isGitHubCredentialBlocked(API_URL, "token-a"),
      false,
      "an in-flight request must not resurrect a block the user just cleared",
    );

    blocklist.markGitHubCredentialBlocked(
      API_URL,
      "token-a",
      blocklist.getGitHubCredentialBlocklistEpoch(),
    );
    assert.strictEqual(
      blocklist.isGitHubCredentialBlocked(API_URL, "token-a"),
      true,
    );
  });

  await test("reset clears every recorded block", () => {
    blocklist.markGitHubCredentialBlocked(
      API_URL,
      "token-a",
      blocklist.getGitHubCredentialBlocklistEpoch(),
    );
    blocklist.resetGitHubCredentialBlocklist();
    assert.strictEqual(
      blocklist.isGitHubCredentialBlocked(API_URL, "token-a"),
      false,
    );
  });
}

async function runRequestSuppressionTests() {
  await test("an SSO rejection stops the credential from being re-sent", async () => {
    const first = createRecordingRequest([
      () => ssoResponse(),
      () => new Response("public", { status: 200 }),
    ]);
    const firstResult = await githubFetch.fetchGitHubWithOptionalAuthRetry(
      API_URL,
      {
        accept: "application/json",
        token: "sso-token",
        request: first.request,
      },
    );
    assert.strictEqual(firstResult.status, 200);
    assert.strictEqual(first.calls[0].authorization, "token sso-token");

    const second = createRecordingRequest([
      () => new Response("public", { status: 200 }),
    ]);
    const secondResult = await githubFetch.fetchGitHubWithOptionalAuthRetry(
      API_URL,
      {
        accept: "application/json",
        token: "sso-token",
        request: second.request,
      },
    );
    assert.strictEqual(secondResult.status, 200);
    assert.strictEqual(second.calls.length, 1, "no 403 round trip is repeated");
    assert.strictEqual(second.calls[0].authorization, undefined);
  });

  await test("a different owner keeps using the credential", async () => {
    const first = createRecordingRequest([
      () => ssoResponse(),
      () => new Response("public", { status: 200 }),
    ]);
    await githubFetch.fetchGitHubWithOptionalAuthRetry(API_URL, {
      accept: "application/json",
      token: "sso-token",
      request: first.request,
    });

    const second = createRecordingRequest([
      () => new Response("public", { status: 200 }),
    ]);
    await githubFetch.fetchGitHubWithOptionalAuthRetry(OTHER_API_URL, {
      accept: "application/json",
      token: "sso-token",
      request: second.request,
    });
    assert.strictEqual(second.calls[0].authorization, "token sso-token");
  });

  await test("a plain permission failure does not block the owner", async () => {
    const first = createRecordingRequest([
      () =>
        new Response(JSON.stringify({ message: "Bad credentials" }), {
          status: 401,
        }),
      () => new Response("public", { status: 200 }),
    ]);
    await githubFetch.fetchGitHubWithOptionalAuthRetry(API_URL, {
      accept: "application/json",
      token: "weak-token",
      request: first.request,
    });

    assert.strictEqual(
      blocklist.isGitHubCredentialBlocked(API_URL, "weak-token"),
      false,
      "auth-required must not blocklist an entire owner",
    );
  });

  await test("SSO wording wins over rate-limit headers on the same response", async () => {
    const hybrid = new Response(SSO_BODY, {
      status: 403,
      headers: { ...SSO_HEADERS, "x-ratelimit-remaining": "0" },
    });
    const { request } = createRecordingRequest([
      () => hybrid,
      () => new Response("public", { status: 200 }),
    ]);
    await githubFetch.fetchGitHubWithOptionalAuthRetry(API_URL, {
      accept: "application/json",
      token: "sso-token",
      request,
    });
    assert.strictEqual(
      blocklist.isGitHubCredentialBlocked(API_URL, "sso-token"),
      true,
    );
  });

  await test("a reset restores the credential immediately", async () => {
    const first = createRecordingRequest([
      () => ssoResponse(),
      () => new Response("public", { status: 200 }),
    ]);
    await githubFetch.fetchGitHubWithOptionalAuthRetry(API_URL, {
      accept: "application/json",
      token: "sso-token",
      request: first.request,
    });
    blocklist.resetGitHubCredentialBlocklist();

    const second = createRecordingRequest([
      () => new Response("public", { status: 200 }),
    ]);
    await githubFetch.fetchGitHubWithOptionalAuthRetry(API_URL, {
      accept: "application/json",
      token: "sso-token",
      request: second.request,
    });
    assert.strictEqual(second.calls[0].authorization, "token sso-token");
  });
}

async function runEscalationTests() {
  await test("a blocked credential still escalates so the next credential reaches the API", async () => {
    blocklist.markGitHubCredentialBlocked(
      RAW_URL,
      "blocked-token",
      blocklist.getGitHubCredentialBlocklistEpoch(),
    );
    resolveFallback = async () => ({ token: "good-token", source: "gh-cli" });

    const { request, calls } = createRecordingRequest([
      () => new Response("", { status: 404 }),
      () => new Response("", { status: 404 }),
      () => new Response("skill body", { status: 200 }),
    ]);

    const result = await githubFetch.fetchGitHubWithOptionalAuthRetry(RAW_URL, {
      accept: "text/plain",
      token: "blocked-token",
      authenticatedUrl: ESCALATED_URL,
      request,
    });

    assert.strictEqual(result.status, 200);
    assert.strictEqual(await result.text(), "skill body");
    assert.strictEqual(calls.length, 3);
    assert.strictEqual(calls[0].url, RAW_URL);
    assert.strictEqual(calls[0].authorization, undefined);
    assert.strictEqual(
      calls[1].url,
      ESCALATED_URL,
      "the escalation must still move the request onto the API URL",
    );
    assert.strictEqual(
      calls[1].authorization,
      undefined,
      "the blocked credential must not be attached",
    );
    assert.strictEqual(calls[2].url, ESCALATED_URL);
    assert.strictEqual(calls[2].authorization, "token good-token");
  });

  await test("an unblocked raw 404 still escalates with the credential", async () => {
    const { request, calls } = createRecordingRequest([
      () => new Response("", { status: 404 }),
      () => new Response("skill body", { status: 200 }),
    ]);

    const result = await githubFetch.fetchGitHubWithOptionalAuthRetry(RAW_URL, {
      accept: "text/plain",
      token: "fresh-token",
      authenticatedUrl: ESCALATED_URL,
      request,
    });

    assert.strictEqual(result.status, 200);
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(calls[1].authorization, "token fresh-token");
  });

  await test("a blocked candidate is skipped inside the credential walk", async () => {
    blocklist.markGitHubCredentialBlocked(
      API_URL,
      "blocked-fallback",
      blocklist.getGitHubCredentialBlocklistEpoch(),
    );
    const offered = ["blocked-fallback", "good-token"];
    resolveFallback = async () => {
      const token = offered.shift();
      return token ? { token, source: "gh-cli" } : undefined;
    };

    const { request, calls } = createRecordingRequest([
      () =>
        new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }),
      () => new Response("tree", { status: 200 }),
    ]);

    const result = await githubFetch.fetchGitHubWithOptionalAuthRetry(API_URL, {
      accept: "application/json",
      token: "first-token",
      request,
    });

    assert.strictEqual(result.status, 200);
    assert.strictEqual(calls.length, 2, "the blocked candidate is not sent");
    assert.strictEqual(calls[1].authorization, "token good-token");
  });

  await test("a credential rejected during the walk is recorded", async () => {
    resolveFallback = async () => ({ token: "walk-token", source: "gh-cli" });
    const { request } = createRecordingRequest([
      () =>
        new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }),
      () => ssoResponse(),
    ]);

    await githubFetch.fetchGitHubWithOptionalAuthRetry(API_URL, {
      accept: "application/json",
      token: "first-token",
      request,
    });

    assert.strictEqual(
      blocklist.isGitHubCredentialBlocked(API_URL, "walk-token"),
      true,
      "the walk must classify and record its own responses",
    );
  });
}

async function runAttributionTests() {
  await test("a rate-limited finish keeps its kind but reports the SSO root cause", async () => {
    resolveFallback = async () => ({ token: "second-token", source: "gh-cli" });
    const { request } = createRecordingRequest([
      () => ssoResponse(),
      () => rateLimitResponse(),
      () => rateLimitResponse(),
    ]);

    const response = await githubFetch.fetchGitHubWithOptionalAuthRetry(
      API_URL,
      { accept: "application/json", token: "sso-token", request },
    );

    const bodyText = await response.clone().text();
    const error = githubResponse.createGitHubResponseError(
      response,
      bodyText,
      "GitHub tree request failed",
    );

    assert.strictEqual(
      error.kind,
      "rate-limit",
      "batch abort keys off kind, so it must stay as classified",
    );
    assert.ok(error.resetAt, "rate-limit errors keep their reset timestamp");
    assert.strictEqual(error.rootCauseKind, "sso-required");
    assert.strictEqual(
      githubResponse.getGitHubEffectiveFailureKind(error),
      "sso-required",
    );
  });

  await test("a 404 finish is never annotated", async () => {
    resolveFallback = async () => ({ token: "second-token", source: "gh-cli" });
    const { request } = createRecordingRequest([
      () => ssoResponse(),
      () =>
        new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }),
      () =>
        new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }),
    ]);

    const response = await githubFetch.fetchGitHubWithOptionalAuthRetry(
      API_URL,
      { accept: "application/json", token: "sso-token", request },
    );

    assert.strictEqual(response.status, 404);
    assert.strictEqual(
      githubResponse.getGitHubRootCause(response),
      undefined,
      "branch fallback reads status 404, so its meaning must not be reinterpreted",
    );
    const error = githubResponse.createGitHubResponseError(
      response,
      await response.clone().text(),
      "GitHub tree request failed",
    );
    assert.strictEqual(error.kind, "not-found");
    assert.strictEqual(error.rootCauseKind, undefined);
  });

  await test("annotation survives a frozen response and does not follow clones", () => {
    const frozen = Object.freeze(new Response("", { status: 403 }));
    githubResponse.annotateGitHubRootCause(frozen, { kind: "sso-required" });
    assert.deepStrictEqual(githubResponse.getGitHubRootCause(frozen), {
      kind: "sso-required",
    });

    const cloneable = new Response("", { status: 403 });
    githubResponse.annotateGitHubRootCause(cloneable, { kind: "sso-required" });
    assert.strictEqual(
      githubResponse.getGitHubRootCause(cloneable.clone()),
      undefined,
      "callers must pass the original response, not a clone",
    );
  });
}

async function runSsoUrlTests() {
  await test("the SSO authorization URL keeps only the authorization request", () => {
    const url = githubResponse.extractSsoAuthorizationUrl(
      new Headers({
        "x-github-sso":
          "required; url=https://github.com/orgs/contoso/sso?authorization_request=ABC123&next=%2Fevil#frag",
      }),
    );
    assert.strictEqual(
      url,
      "https://github.com/orgs/contoso/sso?authorization_request=ABC123",
    );
  });

  await test("an SSO URL without a request parameter is still usable", () => {
    assert.strictEqual(
      githubResponse.extractSsoAuthorizationUrl(
        new Headers({
          "x-github-sso": "required; url=https://github.com/orgs/contoso/sso",
        }),
      ),
      "https://github.com/orgs/contoso/sso",
    );
  });

  await test("only https github.com organization SSO URLs are accepted", () => {
    const rejected = [
      "required; url=http://github.com/orgs/contoso/sso",
      "required; url=https://github.com.evil.example/orgs/contoso/sso",
      "required; url=https://evil.example/orgs/contoso/sso",
      "required; url=https://github.com@evil.example/orgs/contoso/sso",
      "required; url=https://user:pw@github.com/orgs/contoso/sso",
      "required; url=https://github.com:8443/orgs/contoso/sso",
      "required; url=https://github.com/orgs/contoso/sso/../../settings",
      "required; url=https://github.com/settings/tokens",
      "required; url=javascript:alert(1)",
      "required; url=not a url",
      "required",
      "partial-results; organizations=contoso",
    ];
    for (const header of rejected) {
      assert.strictEqual(
        githubResponse.extractSsoAuthorizationUrl(
          new Headers({ "x-github-sso": header }),
        ),
        undefined,
        `expected rejection for ${header}`,
      );
    }
    assert.strictEqual(
      githubResponse.extractSsoAuthorizationUrl(new Headers({})),
      undefined,
    );
  });

  await test("an SSO failure carries the authorization URL onto the error", async () => {
    const { request } = createRecordingRequest([
      () => ssoResponse(),
      () =>
        new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }),
    ]);
    const response = await githubFetch.fetchGitHubWithOptionalAuthRetry(
      API_URL,
      { accept: "application/json", token: "sso-token", request },
    );
    const error = githubResponse.createGitHubResponseError(
      response,
      await response.clone().text(),
      "GitHub tree request failed",
    );
    assert.strictEqual(error.kind, "sso-required");
    assert.strictEqual(
      error.ssoAuthorizationUrl,
      "https://github.com/orgs/contoso/sso?authorization_request=ABC123",
    );
  });
}

async function runObservabilityTests() {
  await test("a suppressed credential is announced once with the owner and reason", async () => {
    const { request } = createRecordingRequest([
      () => ssoResponse(),
      () => new Response("public", { status: 200 }),
    ]);
    await githubFetch.fetchGitHubWithOptionalAuthRetry(API_URL, {
      accept: "application/json",
      token: "sso-token",
      request,
    });

    const announcements = loggedLines.filter((line) =>
      line.includes("suppressed for that owner"),
    );
    assert.strictEqual(announcements.length, 1);
    assert.ok(announcements[0].includes("contoso"));
    assert.ok(announcements[0].includes("sso-required"));
    for (const secret of [
      "sso-token",
      "authorization_request",
      "ABC123",
      blocklistFingerprintOf("sso-token"),
    ]) {
      assert.ok(
        !announcements[0].includes(secret),
        `the announcement must not carry ${secret}`,
      );
    }
  });

  await test("the raw-404 escalation path also announces the suppression", async () => {
    const { request } = createRecordingRequest([
      () => new Response("", { status: 404 }),
      () => ssoResponse(),
      () => new Response("", { status: 404 }),
    ]);
    await githubFetch.fetchGitHubWithOptionalAuthRetry(RAW_URL, {
      accept: "text/plain",
      token: "sso-token",
      authenticatedUrl: ESCALATED_URL,
      request,
    });

    const announcements = loggedLines.filter((line) =>
      line.includes("suppressed for that owner"),
    );
    assert.strictEqual(
      announcements.length,
      1,
      "the most common real path is raw 404 then an authenticated API call",
    );
    assert.ok(announcements[0].includes("contoso"));
    assert.strictEqual(
      blocklist.isGitHubCredentialBlocked(RAW_URL, "sso-token"),
      true,
    );
  });

  await test("a repeated rejection does not repeat the announcement", () => {
    const epoch = blocklist.getGitHubCredentialBlocklistEpoch();
    assert.strictEqual(
      blocklist.markGitHubCredentialBlocked(API_URL, "sso-token", epoch),
      true,
    );
    assert.strictEqual(
      blocklist.markGitHubCredentialBlocked(API_URL, "sso-token", epoch),
      false,
      "parallel rejections must not each announce the same suppression",
    );
    blocklist.resetGitHubCredentialBlocklist();
    assert.strictEqual(
      blocklist.markGitHubCredentialBlocked(
        API_URL,
        "sso-token",
        blocklist.getGitHubCredentialBlocklistEpoch(),
      ),
      true,
      "a cleared blocklist announces the next rejection again",
    );
  });

  await test("an expired suppression announces the next rejection again", () => {
    const epoch = blocklist.getGitHubCredentialBlocklistEpoch();
    assert.strictEqual(
      blocklist.markGitHubCredentialBlocked(API_URL, "sso-token", epoch, 1_000),
      true,
    );
    assert.strictEqual(
      blocklist.markGitHubCredentialBlocked(
        API_URL,
        "sso-token",
        epoch,
        1_000 + blocklist.GITHUB_CREDENTIAL_BLOCK_TTL_MS,
      ),
      true,
    );
  });
}

// --- Leak guards ------------------------------------------------------------

async function runLeakGuards() {
  await test("the SSO authorization value never reaches diagnostics", async () => {
    const { request } = createRecordingRequest([
      () => ssoResponse(),
      () =>
        new Response(JSON.stringify({ message: "Not Found" }), { status: 404 }),
    ]);
    const response = await githubFetch.fetchGitHubWithOptionalAuthRetry(
      API_URL,
      { accept: "application/json", token: "sso-token", request },
    );
    const error = githubResponse.createGitHubResponseError(
      response,
      await response.clone().text(),
      "GitHub tree request failed",
    );
    assert.strictEqual(
      error.ssoAuthorizationUrl,
      "https://github.com/orgs/contoso/sso?authorization_request=ABC123",
    );

    const appended = [];
    const loggerModule = requireTypeScriptModule(
      path.join(srcDir, "logger.ts"),
      {
        vscode: {
          window: {
            createOutputChannel: () => ({
              appendLine: (line) => appended.push(line),
              show: () => undefined,
              dispose: () => undefined,
            }),
          },
          Disposable: class {},
        },
      },
    );
    loggerModule.logger.warn("Failed to update source example:", error);
    loggerModule.logger.error(error);
    // A wrapped error takes the JSON.stringify branch, which only sees enumerable fields.
    loggerModule.logger.warn("wrapped", { error });
    loggerModule.logger.warn("listed", [error]);

    const emitted = appended.join("\n");
    assert.ok(emitted.length > 0, "the guard must inspect real logger output");
    for (const secret of ["authorization_request", "ABC123"]) {
      assert.ok(
        !emitted.includes(secret),
        `logger output must not carry ${secret}`,
      );
      assert.ok(
        !error.message.includes(secret),
        `error message must not carry ${secret}`,
      );
    }
    const serialized = JSON.stringify(error);
    assert.ok(
      serialized.includes("sso-required"),
      "serialization must actually reach this error's enumerable fields",
    );
    assert.ok(
      !serialized.includes("ABC123"),
      "the SSO authorization must not be an enumerable field",
    );
  });

  await test("the blocklist has no diagnostics dependency", () => {
    const source = fs.readFileSync(
      path.join(srcDir, "githubCredentialBlocklist.ts"),
      "utf8",
    );
    assert.ok(
      !/from "\.\/logger"/.test(source),
      "token fingerprints must stay unloggable by construction",
    );
  });
}

// --- Static guard -----------------------------------------------------------

const RESET_CALL_NAME = "resetGitHubCredentialBlocklist";
const RESET_ENTRY_POINTS = [
  ["indexUpdater.ts", "updateSingleSource"],
  ["indexUpdater.ts", "updateIndexFromSourcesWithResult"],
  ["indexUpdater.ts", "updateIndexFromSingleSource"],
  ["indexUpdater.ts", "addSource"],
  ["indexUpdater.ts", "searchGitHub"],
  ["skillInstaller.ts", "installSkill"],
  ["skillPreview.ts", "showSkillPreview"],
  ["githubAuth.ts", "clearStoredGitHubTokenWithFeedback"],
];

// Shared helpers run many times inside one user action, so resetting there would
// re-send a rejected credential for every source, file, or branch lookup.
const NON_RESET_HELPERS = [
  ["indexUpdater.ts", "scanRepositoryForSkills"],
  ["indexUpdater.ts", "fetchGitHubTextContent"],
  ["skillInstaller.ts", "listGitHubDirectory"],
  ["skillIndex.ts", "getDefaultBranch"],
];

const EFFECTIVE_KIND_CALL_NAME = "getGitHubEffectiveFailureKind";
const SHARED_REASON_CALL_NAME = "getGitHubAuthFailureReason";

// Every surface that explains a failure to a person must report the root cause.
const ROOT_CAUSE_PRESENTATION_SITES = [
  ["extension.ts", "formatSourceUpdateFailureReason", EFFECTIVE_KIND_CALL_NAME],
  ["extension.ts", "shouldOfferGitHubAuth", EFFECTIVE_KIND_CALL_NAME],
  ["indexUpdater.ts", "getGitHubAuthFailureReason", EFFECTIVE_KIND_CALL_NAME],
  ["indexUpdater.ts", "showAuthHelp", EFFECTIVE_KIND_CALL_NAME],
  ["mcpTools.ts", "formatMcpError", SHARED_REASON_CALL_NAME],
];

// These branch on the surfaced failure, so the root cause must not reach them.
const SURFACED_KIND_CONTROL_FLOW_SITES = [
  ["indexUpdater.ts", "updateIndexFromSourcesWithResult"],
  ["sourceIndexUpdateBatch.ts", "runSourceIndexUpdateBatch"],
];

function parseSource(fileName) {
  return ts.createSourceFile(
    fileName,
    fs.readFileSync(path.join(srcDir, fileName), "utf8"),
    ts.ScriptTarget.ES2020,
    true,
  );
}

function findFunctionDeclaration(sourceFile, name) {
  let found;
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

function findEarliestPosition(node, predicate) {
  let earliest;
  const visit = (current) => {
    if (predicate(current)) {
      earliest =
        earliest === undefined ? current.pos : Math.min(earliest, current.pos);
    }
    ts.forEachChild(current, visit);
  };
  ts.forEachChild(node, visit);
  return earliest;
}

async function runResetGuard() {
  await test("every user-initiated entry resets the blocklist before its first await", () => {
    const parsed = new Map();
    for (const [fileName, functionName] of RESET_ENTRY_POINTS) {
      if (!parsed.has(fileName)) {
        parsed.set(fileName, parseSource(fileName));
      }
      const declaration = findFunctionDeclaration(
        parsed.get(fileName),
        functionName,
      );
      assert.ok(declaration, `${fileName}: ${functionName} was not found`);

      const resetPosition = findEarliestPosition(
        declaration,
        (node) =>
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === RESET_CALL_NAME,
      );
      assert.ok(
        resetPosition !== undefined,
        `${fileName}: ${functionName} must call ${RESET_CALL_NAME}`,
      );

      const awaitPosition = findEarliestPosition(declaration, (node) =>
        ts.isAwaitExpression(node),
      );
      assert.ok(
        awaitPosition === undefined || resetPosition < awaitPosition,
        `${fileName}: ${functionName} must reset before its first await`,
      );
    }
  });

  await test("shared helpers must not reset the blocklist", () => {
    const parsed = new Map();
    for (const [fileName, functionName] of NON_RESET_HELPERS) {
      if (!parsed.has(fileName)) {
        parsed.set(fileName, parseSource(fileName));
      }
      const declaration = findFunctionDeclaration(
        parsed.get(fileName),
        functionName,
      );
      // Assert the target exists first, so a rename cannot make this absence check vacuous.
      assert.ok(declaration, `${fileName}: ${functionName} was not found`);

      const resetPosition = findEarliestPosition(
        declaration,
        (node) =>
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === RESET_CALL_NAME,
      );
      assert.strictEqual(
        resetPosition,
        undefined,
        `${fileName}: ${functionName} runs per source, file, or lookup, so it must not reset`,
      );
    }
  });

  await test("every failure surface reports the root cause", () => {
    const parsed = new Map();
    const findCall = (declaration, callName) =>
      findEarliestPosition(
        declaration,
        (node) =>
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === callName,
      );

    for (const [
      fileName,
      functionName,
      callName,
    ] of ROOT_CAUSE_PRESENTATION_SITES) {
      if (!parsed.has(fileName)) {
        parsed.set(fileName, parseSource(fileName));
      }
      const declaration = findFunctionDeclaration(
        parsed.get(fileName),
        functionName,
      );
      assert.ok(declaration, `${fileName}: ${functionName} was not found`);
      assert.ok(
        findCall(declaration, callName) !== undefined,
        `${fileName}: ${functionName} must explain failures through ${callName}`,
      );
    }

    for (const [fileName, functionName] of SURFACED_KIND_CONTROL_FLOW_SITES) {
      if (!parsed.has(fileName)) {
        parsed.set(fileName, parseSource(fileName));
      }
      const declaration = findFunctionDeclaration(
        parsed.get(fileName),
        functionName,
      );
      // Assert the target exists first, so a rename cannot make this absence check vacuous.
      assert.ok(declaration, `${fileName}: ${functionName} was not found`);
      assert.strictEqual(
        findCall(declaration, EFFECTIVE_KIND_CALL_NAME),
        undefined,
        `${fileName}: ${functionName} aborts on the surfaced rate limit, so it must keep reading kind`,
      );
    }
  });
}

async function run() {
  await runOwnerParsingTests();
  await runBlocklistStateTests();
  await runRequestSuppressionTests();
  await runEscalationTests();
  await runAttributionTests();
  await runSsoUrlTests();
  await runObservabilityTests();
  await runLeakGuards();
  await runResetGuard();

  if (failures.length > 0) {
    console.error(`\n${failures.length} test(s) failed:`);
    for (const name of failures) {
      console.error(`  - ${name}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("\nAll GitHub credential blocklist tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
