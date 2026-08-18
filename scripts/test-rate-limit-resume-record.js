#!/usr/bin/env node

// Exercises the real rate-limit resume record store from src against a temporary
// shared directory, so the claim transaction is tested rather than re-described.

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const os = require("os");
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

const repoRoot = path.resolve(__dirname, "..");
const srcDir = path.join(repoRoot, "src");

const vscodeStub = {
  workspace: {
    getConfiguration: () => ({ get: () => true }),
    fs: {},
  },
  Uri: {
    file: (fsPath) => ({ fsPath, toString: () => fsPath }),
    joinPath: (base, ...segments) => ({
      fsPath: path.join(base.fsPath, ...segments),
    }),
  },
};

const tempRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "resource-ninja-resume-"),
);
const originalEnv = {
  APPDATA: process.env.APPDATA,
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
};
process.env.APPDATA = tempRoot;
process.env.HOME = tempRoot;
process.env.USERPROFILE = tempRoot;

const sharedManifest = requireTypeScriptModule(
  path.join(srcDir, "sharedManifest.ts"),
  { vscode: vscodeStub },
);

const sharedDir = sharedManifest.getAgentNinjaSharedDirectoryPath();
assert.ok(
  sharedDir.startsWith(tempRoot),
  `refusing to run: the shared directory ${sharedDir} is outside the temp root`,
);

const sharedStoreLock = requireTypeScriptModule(
  path.join(srcDir, "sharedStoreLock.ts"),
  {
    "./sharedManifest": sharedManifest,
    "./logger": { logger: { warn: () => {} } },
  },
);

const store = requireTypeScriptModule(
  path.join(srcDir, "sharedResourceIndexStore.ts"),
  {
    vscode: vscodeStub,
    "./sharedManifest": sharedManifest,
    "./sharedStoreLock": sharedStoreLock,
    "./coexistence": {
      SELF_EXTENSION_ID: "test.extension",
      getEffectiveOwner: async () => "self",
      buildSelfBeacon: () => ({}),
      RESOURCE_NINJA_KINDS: [],
    },
    "./customizationPaths": {
      getConfiguredUseSharedResourceIndex: () => true,
      getConfiguredUseSharedSourcesManifest: () => true,
    },
    "./logger": {
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    },
    "./i18n": {
      messages: {
        actionShowDetails: () => "Show Details",
        sharedStoreSyncPaused: (reason) => `paused: ${reason}`,
      },
    },
    "./skillIndex": {
      getIndexResources: () => [],
      getResourceKind: (resource) => resource?.kind || "skill",
    },
    "./sharedSourcesManifestStore": {
      readSharedSourcesManifest: async () => undefined,
      writeSharedSourcesManifest: async () => undefined,
    },
  },
);

const nowMs = Date.parse("2026-06-24T12:00:00.000Z");

function makeRecord(overrides = {}) {
  return {
    version: 1,
    sourceIds: ["rate-limited", "not-attempted"],
    retryNotBefore: "2026-06-24T12:30:00.000Z",
    createdAt: "2026-06-24T12:00:00.000Z",
    attempts: 0,
    ...overrides,
  };
}

async function main() {
  await test("a record further out than one rate-limit window is treated as corrupt", () => {
    assert.ok(store.normalizeRateLimitResumeRecord(makeRecord(), nowMs));
    assert.strictEqual(
      store.normalizeRateLimitResumeRecord(
        makeRecord({ retryNotBefore: "2026-06-24T23:00:00.000Z" }),
        nowMs,
      ),
      undefined,
    );
    assert.strictEqual(
      store.normalizeRateLimitResumeRecord(
        makeRecord({ retryNotBefore: "not-a-date" }),
        nowMs,
      ),
      undefined,
    );
    assert.strictEqual(
      store.normalizeRateLimitResumeRecord(
        makeRecord({ sourceIds: [] }),
        nowMs,
      ),
      undefined,
    );
    assert.strictEqual(
      store.normalizeRateLimitResumeRecord(makeRecord({ version: 2 }), nowMs),
      undefined,
    );
  });

  await test("a saved record round-trips through the shared directory", async () => {
    await store.saveRateLimitResumeRecord(makeRecord());
    const loaded = await store.readRateLimitResumeRecord(nowMs);
    assert.deepStrictEqual(loaded.sourceIds, ["rate-limited", "not-attempted"]);
    assert.strictEqual(loaded.attempts, 0);
  });

  await test("claiming refuses before the deadline", async () => {
    assert.strictEqual(
      await store.claimRateLimitResumeRecord("session-a", nowMs),
      undefined,
    );
  });

  await test("only one session claims a due record", async () => {
    const dueMs = Date.parse("2026-06-24T12:31:00.000Z");
    const first = await store.claimRateLimitResumeRecord("session-a", dueMs);
    assert.strictEqual(first.claimedBy, "session-a");

    const second = await store.claimRateLimitResumeRecord("session-b", dueMs);
    assert.strictEqual(
      second,
      undefined,
      "a live claim from another session must not be taken over",
    );
  });

  await test("a claim left behind by a dead session is taken over", async () => {
    const laterMs =
      Date.parse("2026-06-24T12:31:00.000Z") +
      store.RATE_LIMIT_RESUME_CLAIM_STALE_MS +
      1000;
    const takeover = await store.claimRateLimitResumeRecord(
      "session-b",
      laterMs,
    );
    assert.strictEqual(takeover.claimedBy, "session-b");
  });

  await test("a spent record is never claimed again, whatever the trigger", async () => {
    await store.saveRateLimitResumeRecord(
      makeRecord({ attempts: 1, createdAt: "2026-06-24T12:05:00.000Z" }),
    );
    assert.strictEqual(
      await store.claimRateLimitResumeRecord(
        "session-a",
        Date.parse("2026-06-24T12:31:00.000Z"),
      ),
      undefined,
      "an exhausted record must not be resumed by a later host restart",
    );
    await store.clearRateLimitResumeRecord();
  });

  await test("renewing keeps a long resume from losing its claim", async () => {
    const dueMs = Date.parse("2026-06-24T12:31:00.000Z");
    await store.saveRateLimitResumeRecord(makeRecord());
    const claimed = await store.claimRateLimitResumeRecord("session-a", dueMs);

    const laterMs = dueMs + store.RATE_LIMIT_RESUME_CLAIM_STALE_MS / 2;
    assert.strictEqual(
      await store.renewRateLimitResumeClaim(
        "session-a",
        claimed.createdAt,
        laterMs,
      ),
      true,
    );
    assert.strictEqual(
      await store.renewRateLimitResumeClaim(
        "session-b",
        claimed.createdAt,
        laterMs,
      ),
      false,
      "only the owning session may renew",
    );

    const afterOriginalExpiry =
      dueMs + store.RATE_LIMIT_RESUME_CLAIM_STALE_MS + 1000;
    assert.strictEqual(
      await store.claimRateLimitResumeRecord("session-b", afterOriginalExpiry),
      undefined,
      "a renewed claim must still block a takeover",
    );
    await store.clearRateLimitResumeRecord();
  });

  await test("clearing only removes the generation and owner it was given", async () => {
    const dueMs = Date.parse("2026-06-24T12:31:00.000Z");
    await store.saveRateLimitResumeRecord(
      makeRecord({ createdAt: "2026-06-24T12:20:00.000Z" }),
    );
    await store.clearRateLimitResumeRecord({
      createdAt: "2026-06-24T12:00:00.000Z",
      claimedBy: "session-a",
    });
    assert.ok(
      await store.readRateLimitResumeRecord(nowMs),
      "a newer record stored by another host must survive an older clear",
    );

    await store.claimRateLimitResumeRecord("session-b", dueMs);
    await store.clearRateLimitResumeRecord({
      createdAt: "2026-06-24T12:20:00.000Z",
      claimedBy: "session-a",
    });
    assert.ok(
      await store.readRateLimitResumeRecord(nowMs),
      "a host that lost its claim must not delete the new owner's record",
    );

    await store.clearRateLimitResumeRecord({
      createdAt: "2026-06-24T12:20:00.000Z",
      claimedBy: "session-b",
    });
    assert.strictEqual(await store.readRateLimitResumeRecord(nowMs), undefined);
  });

  await test("an oversized shared file is ignored instead of parsed", async () => {
    const recordPath = path.join(sharedDir, "rate-limit-resume.json");
    await store.saveRateLimitResumeRecord(makeRecord());
    assert.ok(await store.readRateLimitResumeRecord(nowMs));

    const padded = JSON.stringify({
      ...makeRecord(),
      padding: "x".repeat(store.RATE_LIMIT_RESUME_MAX_FILE_BYTES),
    });
    fs.writeFileSync(recordPath, padded, "utf8");
    assert.strictEqual(
      await store.readRateLimitResumeRecord(nowMs),
      undefined,
      "a file past the byte limit must not reach JSON.parse",
    );
    fs.rmSync(recordPath, { force: true });
  });

  // The reader ignores an oversized record silently, so writing one would strand
  // every deferred source. Keeping the previous record instead would resume a
  // different source set than the one that was actually deferred.
  await test("a record we could not read back is discarded, not kept", async () => {
    const recordPath = path.join(sharedDir, "rate-limit-resume.json");
    await store.saveRateLimitResumeRecord(makeRecord());
    await store.saveRateLimitResumeRecord(
      makeRecord({
        sourceIds: Array.from(
          { length: 500 },
          (_unused, index) => `${"s".repeat(250)}-${index}`,
        ),
      }),
    );

    assert.strictEqual(
      fs.existsSync(recordPath),
      false,
      "a stale record must not survive a refused write",
    );
    assert.strictEqual(await store.readRateLimitResumeRecord(nowMs), undefined);
  });

  // Claiming re-serializes the record with two more fields, so a record that was
  // readable can cross the limit on the way back out.
  await test("a claim that cannot be written leaves nothing to retry", async () => {
    const recordPath = path.join(sharedDir, "rate-limit-resume.json");
    const dueMs = Date.parse("2026-06-24T12:31:00.000Z");
    const cap = store.RATE_LIMIT_RESUME_MAX_FILE_BYTES;
    const sourceIds = Array.from(
      { length: 500 },
      (_unused, index) => `${"s".repeat(240)}-${index}`,
    );
    const sizeOf = (value) => Buffer.byteLength(JSON.stringify(value, null, 2));
    const build = (count, pad) =>
      makeRecord({
        sourceIds: sourceIds.slice(0, count),
        retryNotBefore: "2026-06-24T12:30:00.000Z",
        createdAt: `2026-06-24T12:00:00.000Z${"p".repeat(pad)}`,
      });

    // As many ids as still fit, then createdAt pads one byte at a time into the
    // narrow window where the record fits but its claimed form does not. Only the
    // length of createdAt is checked on read, so padding it keeps the record valid.
    let count = 0;
    while (count < sourceIds.length && sizeOf(build(count + 1, 0)) <= cap) {
      count += 1;
    }

    let fixture;
    for (let pad = 0; pad <= 250 && !fixture; pad += 1) {
      const candidate = build(count, pad);
      const claimed = {
        ...candidate,
        claimedBy: "session-a",
        claimedAt: new Date(dueMs).toISOString(),
      };
      if (sizeOf(candidate) <= cap && sizeOf(claimed) > cap) {
        fixture = candidate;
      }
    }
    assert.ok(
      fixture,
      "no fixture sits in the readable-but-unclaimable window",
    );

    fs.writeFileSync(recordPath, JSON.stringify(fixture, null, 2), "utf8");
    assert.ok(
      await store.readRateLimitResumeRecord(dueMs),
      "the fixture has to be readable, or the claim never reaches the write",
    );

    assert.strictEqual(
      await store.claimRateLimitResumeRecord("session-a", dueMs),
      undefined,
      "a claim that cannot be written is not a claim",
    );
    assert.strictEqual(
      fs.existsSync(recordPath),
      false,
      "and it leaves nothing behind for the next claim to retry forever",
    );
  });

  await test("untrusted source lists are bounded and deduplicated", () => {
    assert.deepStrictEqual(
      store.normalizeRateLimitResumeRecord(
        makeRecord({ sourceIds: ["a", "a", "b", "", 42, null, "b"] }),
        nowMs,
      ).sourceIds,
      ["a", "b"],
    );
    assert.strictEqual(
      store.normalizeRateLimitResumeRecord(
        makeRecord({
          sourceIds: Array.from(
            { length: store.RATE_LIMIT_RESUME_MAX_SOURCE_IDS + 1 },
            (_, index) => `source-${index}`,
          ),
        }),
        nowMs,
      ),
      undefined,
      "a list past the cap is rejected rather than silently truncated",
    );
    assert.deepStrictEqual(
      store.normalizeRateLimitResumeRecord(
        makeRecord({ sourceIds: ["ok", "x".repeat(300)] }),
        nowMs,
      ).sourceIds,
      ["ok"],
      "an oversized id is dropped",
    );
  });

  await test("untrusted claim fields cannot carry unbounded strings", () => {
    const normalized = store.normalizeRateLimitResumeRecord(
      makeRecord({
        claimedBy: "y".repeat(300),
        claimedAt: "",
        createdAt: "z".repeat(300),
      }),
      nowMs,
    );
    assert.strictEqual(normalized.claimedBy, undefined);
    assert.strictEqual(normalized.claimedAt, undefined);
    assert.notStrictEqual(
      normalized.createdAt,
      "z".repeat(300),
      "an oversized createdAt falls back to a generated timestamp",
    );
  });

  await test("clearing removes the record", async () => {
    await store.saveRateLimitResumeRecord(makeRecord());
    await store.clearRateLimitResumeRecord();
    assert.strictEqual(await store.readRateLimitResumeRecord(nowMs), undefined);
  });

  console.log("RESULT=PASS");
}

main()
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(() => {
    process.env.APPDATA = originalEnv.APPDATA;
    process.env.HOME = originalEnv.HOME;
    process.env.USERPROFILE = originalEnv.USERPROFILE;
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
