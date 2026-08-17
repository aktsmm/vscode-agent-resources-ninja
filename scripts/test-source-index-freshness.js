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

test("scanning one source does not make untimestamped sources look fresh", () => {
  const sources = [
    {
      id: "scanned",
      name: "Scanned",
      url: "https://github.com/a/scanned",
      type: "github",
      description: "scanned",
      lastIndexedAt: "2026-06-24T00:00:00.000Z",
    },
    {
      id: "legacy",
      name: "Legacy",
      url: "https://github.com/a/legacy",
      type: "github",
      description: "legacy",
    },
  ];

  const stale = freshness.collectStaleSources(
    {
      sources,
      lastUpdated: "2025-01-01",
      lastScannedAt: "2026-06-24T00:00:00.000Z",
    },
    {},
    { nowMs, maxAgeMs },
  );

  assert.deepStrictEqual(
    stale.map((entry) => entry.source.id),
    ["legacy"],
    "a source with no timestamp of its own must not inherit an index-wide scan time",
  );
});

test("sortSourcesByFreshness puts never-indexed first and keeps ties stable", () => {
  const sources = [
    {
      id: "recent",
      name: "Recent",
      url: "https://github.com/a/recent",
      type: "github",
      description: "recent",
      lastIndexedAt: "2026-06-20T00:00:00.000Z",
    },
    {
      id: "never-a",
      name: "Never A",
      url: "https://github.com/a/never-a",
      type: "github",
      description: "never a",
    },
    {
      id: "oldest",
      name: "Oldest",
      url: "https://github.com/a/oldest",
      type: "github",
      description: "oldest",
      lastIndexedAt: "2026-01-01T00:00:00.000Z",
    },
    {
      id: "never-b",
      name: "Never B",
      url: "https://github.com/a/never-b",
      type: "github",
      description: "never b",
    },
    {
      id: "shared-meta",
      name: "Shared Meta",
      url: "https://github.com/a/shared-meta",
      type: "github",
      description: "shared meta",
    },
  ];

  const ordered = freshness.sortSourcesByFreshness(sources, {
    "shared-meta": { lastScannedAt: "2026-03-01T00:00:00.000Z" },
  });

  assert.deepStrictEqual(
    ordered.map((source) => source.id),
    ["never-a", "never-b", "oldest", "shared-meta", "recent"],
  );
});

test("sortSourcesByFreshness does not mutate the input", () => {
  const sources = [
    {
      id: "b",
      name: "B",
      url: "https://github.com/a/b",
      type: "github",
      description: "b",
      lastIndexedAt: "2026-06-20T00:00:00.000Z",
    },
    {
      id: "a",
      name: "A",
      url: "https://github.com/a/a",
      type: "github",
      description: "a",
      lastIndexedAt: "2026-01-01T00:00:00.000Z",
    },
  ];

  freshness.sortSourcesByFreshness(sources);
  assert.deepStrictEqual(
    sources.map((source) => source.id),
    ["b", "a"],
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

function makeSources(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `source-${index + 1}`,
    name: `Source ${index + 1}`,
    url: `https://github.com/a/source-${index + 1}`,
    type: "github",
    description: `Source ${index + 1}`,
  }));
}

test("startup stale updates are capped and the rest are deferred", () => {
  const selection = freshness.selectStaleSourcesForStartup(makeSources(12));

  assert.strictEqual(
    selection.selected.length,
    freshness.STALE_SOURCE_INDEX_MAX_PER_STARTUP,
  );
  assert.strictEqual(selection.selected.length + selection.deferred.length, 12);
  assert.deepStrictEqual(
    selection.selected.map((source) => source.id),
    ["source-1", "source-2", "source-3", "source-4", "source-5"],
  );
  assert.strictEqual(selection.nextCursorSourceId, "source-5");
});

test("the cursor rotates the starting point on the next startup", () => {
  const sources = makeSources(12);
  const second = freshness.selectStaleSourcesForStartup(sources, {
    startAfterSourceId: "source-5",
  });

  assert.deepStrictEqual(
    second.selected.map((source) => source.id),
    ["source-6", "source-7", "source-8", "source-9", "source-10"],
  );
  assert.strictEqual(second.nextCursorSourceId, "source-10");
});

test("the cursor wraps around so no stale source starves", () => {
  const sources = makeSources(6);
  const wrapped = freshness.selectStaleSourcesForStartup(sources, {
    startAfterSourceId: "source-5",
  });

  assert.deepStrictEqual(
    wrapped.selected.map((source) => source.id),
    ["source-6", "source-1", "source-2", "source-3", "source-4"],
  );
});

test("an unknown or removed cursor restarts from the beginning", () => {
  const sources = makeSources(3);
  const selection = freshness.selectStaleSourcesForStartup(sources, {
    startAfterSourceId: "removed-source",
  });

  assert.deepStrictEqual(
    selection.selected.map((source) => source.id),
    ["source-1", "source-2", "source-3"],
  );
  assert.deepStrictEqual(selection.deferred, []);
});

console.log("RESULT=PASS");
