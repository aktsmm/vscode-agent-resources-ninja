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

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const repoRoot = path.resolve(__dirname, "..");
const freshness = requireTypeScriptModule(
  path.join(repoRoot, "src", "sourceFreshness.ts"),
);

const nowMs = Date.parse("2026-06-24T12:00:00.000Z");
const maxAgeMs = freshness.STALE_SOURCE_INDEX_MAX_AGE_MS;

test("source timestamp older than 30 days is stale", () => {
  assert.strictEqual(
    freshness.isSourceIndexStale("2026-05-24T11:59:59.000Z", {
      nowMs,
      maxAgeMs,
    }),
    true,
  );
});

test("source timestamp within 30 days is fresh", () => {
  assert.strictEqual(
    freshness.isSourceIndexStale("2026-05-25T12:00:00.000Z", {
      nowMs,
      maxAgeMs,
    }),
    false,
  );
});

test("source timestamp exactly 30 days old is still fresh", () => {
  assert.strictEqual(
    freshness.isSourceIndexStale("2026-05-25T12:00:00.000Z", {
      nowMs,
      maxAgeMs,
    }),
    false,
  );
});

test("date-only fallback is parsed deterministically", () => {
  assert.strictEqual(
    freshness.isSourceIndexStale("2026-05-26", { nowMs, maxAgeMs }),
    false,
  );
  assert.strictEqual(
    freshness.isSourceIndexStale("2026-05-24", { nowMs, maxAgeMs }),
    true,
  );
});

test("invalid and future timestamps are stale", () => {
  assert.strictEqual(
    freshness.isSourceIndexStale("not-a-date", { nowMs, maxAgeMs }),
    true,
  );
  assert.strictEqual(
    freshness.isSourceIndexStale("2026-06-25T00:00:00.000Z", {
      nowMs,
      maxAgeMs,
    }),
    true,
  );
});

test("per-source timestamp takes precedence over shared scan and global fallback", () => {
  const source = {
    id: "source-a",
    name: "Source A",
    url: "https://github.com/a/source",
    type: "github",
    description: "Source A",
    lastIndexedAt: "2026-06-01T00:00:00.000Z",
  };
  assert.strictEqual(
    freshness.getSourceFreshnessTimestamp(
      source,
      { "source-a": { lastScannedAt: "2026-01-01T00:00:00.000Z" } },
      "2025-01-01",
    ),
    "2026-06-01T00:00:00.000Z",
  );
});

test("missing per-source timestamp falls back to scanMeta then global lastUpdated", () => {
  const source = {
    id: "source-a",
    name: "Source A",
    url: "https://github.com/a/source",
    type: "github",
    description: "Source A",
  };
  assert.strictEqual(
    freshness.getSourceFreshnessTimestamp(
      source,
      { "source-a": { lastScannedAt: "2026-06-02T00:00:00.000Z" } },
      "2026-01-01",
    ),
    "2026-06-02T00:00:00.000Z",
  );
  assert.strictEqual(
    freshness.getSourceFreshnessTimestamp(source, {}, "2026-01-01"),
    "2026-01-01",
  );
});

test("stampIndexedSources only stamps successful source IDs", () => {
  const sources = [
    {
      id: "ok",
      name: "OK",
      url: "https://github.com/a/ok",
      type: "github",
      description: "ok",
    },
    {
      id: "failed",
      name: "Failed",
      url: "https://github.com/a/failed",
      type: "github",
      description: "failed",
      lastIndexedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  const stamped = freshness.stampIndexedSources(
    sources,
    ["ok"],
    "2026-06-24T12:00:00.000Z",
  );
  assert.strictEqual(stamped[0].lastIndexedAt, "2026-06-24T12:00:00.000Z");
  assert.strictEqual(stamped[1].lastIndexedAt, "2026-01-01T00:00:00.000Z");
});

console.log("RESULT=PASS");
