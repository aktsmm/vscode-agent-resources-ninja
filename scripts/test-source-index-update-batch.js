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
const {
  runSourceIndexUpdateBatch,
  planRateLimitResume,
  planRateLimitResumeArming,
  getRateLimitResumeDelayMs,
  RATE_LIMIT_RESUME_MARGIN_MS,
  RATE_LIMIT_RESUME_JITTER_MS,
} = requireTypeScriptModule(
  path.join(root, "src", "sourceIndexUpdateBatch.ts"),
  {
    "./githubResponse": githubResponseModule,
  },
);

(async () => {
  await test("stops after rate limit and marks remaining sources skipped", async () => {
    const calls = [];
    const result = await runSourceIndexUpdateBatch(
      ["first", "second", "third"],
      [],
      async (value, entry) => {
        calls.push(entry);
        throw new githubResponseModule.GitHubResponseError(
          "rate-limit",
          403,
          "rate limit",
        );
      },
    );

    assert.deepStrictEqual(calls, ["first"]);
    assert.strictEqual(result.failures.length, 1);
    assert.deepStrictEqual(result.skipped, ["second", "third"]);
  });

  await test("continues after a source-specific failure", async () => {
    const calls = [];
    const result = await runSourceIndexUpdateBatch(
      ["first", "second", "third"],
      [],
      async (value, entry) => {
        calls.push(entry);
        if (entry === "second") {
          throw new Error("source failed");
        }
        return [...value, entry];
      },
    );

    assert.deepStrictEqual(calls, ["first", "second", "third"]);
    assert.deepStrictEqual(result.value, ["first", "third"]);
    assert.deepStrictEqual(result.succeeded, ["first", "third"]);
    assert.strictEqual(result.failures.length, 1);
    assert.deepStrictEqual(result.skipped, []);
  });

  await test("the resume plan keeps the source that raised the rate limit", async () => {
    const nowMs = Date.parse("2026-06-24T12:00:00.000Z");
    const plan = planRateLimitResume(
      [
        { entry: { id: "unrelated" }, error: new Error("boom") },
        {
          entry: { id: "rate-limited" },
          error: new githubResponseModule.GitHubResponseError(
            "rate-limit",
            403,
            "rate limit",
            undefined,
            { retryNotBefore: "2026-06-24T12:30:00.000Z" },
          ),
        },
      ],
      [{ id: "not-attempted-a" }, { id: "not-attempted-b" }],
      { nowMs, previousAttempts: 1 },
    );

    assert.deepStrictEqual(plan.sourceIds, [
      "rate-limited",
      "not-attempted-a",
      "not-attempted-b",
    ]);
    assert.strictEqual(plan.retryNotBefore, "2026-06-24T12:30:00.000Z");
    assert.strictEqual(plan.version, 1);
    assert.strictEqual(plan.createdAt, "2026-06-24T12:00:00.000Z");
    assert.strictEqual(
      plan.attempts,
      1,
      "the plan carries the attempt count so a second rate limit cannot be replayed",
    );
  });

  await test("a run with no rate-limit failure has nothing to resume", async () => {
    assert.strictEqual(
      planRateLimitResume(
        [{ entry: { id: "a" }, error: new Error("boom") }],
        [{ id: "b" }],
        { nowMs: Date.parse("2026-06-24T12:00:00.000Z") },
      ),
      undefined,
    );
  });

  await test("a rate limit without headers still gets a deadline", async () => {
    const nowMs = Date.parse("2026-06-24T12:00:00.000Z");
    const plan = planRateLimitResume(
      [
        {
          entry: { id: "rate-limited" },
          error: new githubResponseModule.GitHubResponseError(
            "rate-limit",
            403,
            "rate limit",
          ),
        },
      ],
      [],
      { nowMs },
    );

    assert.strictEqual(plan.retryNotBefore, "2026-06-24T12:01:00.000Z");
    assert.strictEqual(plan.attempts, 0);
  });

  await test("the resume delay never fires before the deadline", async () => {
    const nowMs = Date.parse("2026-06-24T12:00:00.000Z");
    assert.strictEqual(
      getRateLimitResumeDelayMs("2026-06-24T12:10:00.000Z", nowMs, 0),
      10 * 60 * 1000 + RATE_LIMIT_RESUME_MARGIN_MS,
    );
    assert.strictEqual(
      getRateLimitResumeDelayMs("2026-06-24T11:59:00.000Z", nowMs, 1),
      RATE_LIMIT_RESUME_MARGIN_MS + RATE_LIMIT_RESUME_JITTER_MS,
    );
  });

  await test("arming skips a record no trigger may consume", async () => {
    const base = {
      sessionId: "session-a",
      claimStaleMs: 10 * 60 * 1000,
      nowMs: Date.parse("2026-06-24T12:00:00.000Z"),
      random: 0,
    };

    assert.deepStrictEqual(planRateLimitResumeArming(undefined, base), {
      action: "skip",
      reason: "no-record",
    });
    assert.deepStrictEqual(
      planRateLimitResumeArming(
        { retryNotBefore: "2026-06-24T12:10:00.000Z", attempts: 1 },
        base,
      ),
      { action: "skip", reason: "attempts-exhausted" },
    );
    assert.deepStrictEqual(
      planRateLimitResumeArming(
        { retryNotBefore: "2026-06-24T12:10:00.000Z", attempts: 0 },
        { ...base, disposed: true },
      ),
      { action: "skip", reason: "disposed" },
      "a host disposed while the record was being read must not arm a timer",
    );
  });

  await test("arming waits out another window's claim, then its expiry", async () => {
    const base = {
      sessionId: "session-a",
      claimStaleMs: 10 * 60 * 1000,
      nowMs: Date.parse("2026-06-24T12:00:00.000Z"),
      random: 0,
    };
    const record = {
      retryNotBefore: "2026-06-24T11:50:00.000Z",
      attempts: 0,
      claimedBy: "session-b",
      claimedAt: "2026-06-24T11:56:00.000Z",
    };

    assert.deepStrictEqual(planRateLimitResumeArming(record, base), {
      action: "arm",
      // The claim goes stale 6 minutes after it was taken, not at the deadline.
      delayMs: 6 * 60 * 1000 + RATE_LIMIT_RESUME_MARGIN_MS,
      waitingOnForeignClaim: true,
    });

    assert.deepStrictEqual(
      planRateLimitResumeArming(record, {
        ...base,
        nowMs: Date.parse("2026-06-24T12:07:00.000Z"),
      }),
      {
        action: "arm",
        delayMs: RATE_LIMIT_RESUME_MARGIN_MS,
        waitingOnForeignClaim: false,
      },
      "once the foreign claim is stale the deadline path takes over",
    );

    assert.strictEqual(
      planRateLimitResumeArming({ ...record, claimedBy: "session-a" }, base)
        .waitingOnForeignClaim,
      false,
      "this window's own claim is not a foreign claim",
    );
  });

  await test("arming without a claim uses the deadline and jitter", async () => {
    assert.deepStrictEqual(
      planRateLimitResumeArming(
        { retryNotBefore: "2026-06-24T12:10:00.000Z", attempts: 0 },
        {
          sessionId: "session-a",
          claimStaleMs: 10 * 60 * 1000,
          nowMs: Date.parse("2026-06-24T12:00:00.000Z"),
          random: 1,
        },
      ),
      {
        action: "arm",
        delayMs:
          10 * 60 * 1000 +
          RATE_LIMIT_RESUME_MARGIN_MS +
          RATE_LIMIT_RESUME_JITTER_MS,
        waitingOnForeignClaim: false,
      },
    );
  });

  console.log("Source index update batch tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
