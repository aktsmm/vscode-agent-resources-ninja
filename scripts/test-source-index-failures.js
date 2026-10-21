#!/usr/bin/env node

// Guards the once-per-cause handling of source scan failures: a failure a retry
// cannot fix is recorded and shown once, while transient failures stay actionable.

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

const srcDir = path.join(__dirname, "..", "src");

function requireTypeScriptModule(filePath, stubs = {}) {
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
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

const reconcile = requireTypeScriptModule(
  path.join(srcDir, "sourceUpdateReconcile.ts"),
);
const failures = requireTypeScriptModule(
  path.join(srcDir, "sourceIndexFailures.ts"),
  { "./sourceUpdateReconcile": reconcile },
);

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const NOW = new Date("2026-10-21T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function makeSource(overrides = {}) {
  return {
    id: "acme",
    name: "Acme",
    url: "https://github.com/acme/skills",
    type: "official",
    description: "",
    includePaths: ["skills/"],
    ...overrides,
  };
}

test("only lasting scan failures are classified as persistent", () => {
  assert.strictEqual(
    failures.classifyPersistentFailure(
      reconcile.createEmptySourceScanError("acme", "Acme", 0),
    ),
    "empty-scan",
  );
  assert.strictEqual(
    failures.classifyPersistentFailure(
      new reconcile.SourceRepositoryChangedError("acme", 1, 2, "changed"),
    ),
    "identity-changed",
  );
  assert.strictEqual(
    failures.classifyPersistentFailure(
      reconcile.createEmptySourceScanError("acme", "Acme", 4),
    ),
    undefined,
    "unreadable candidates are a failed read, not a lasting empty source",
  );
  assert.strictEqual(
    failures.classifyPersistentFailure(new Error("rate limit")),
    undefined,
  );
});

test("classification ignores the message text", () => {
  const error = new reconcile.SourceScanError(
    "empty-scan",
    "acme",
    "ソースのスキャン結果が空でした",
  );
  assert.strictEqual(failures.classifyPersistentFailure(error), "empty-scan");
  assert.strictEqual(
    failures.classifyPersistentFailure(new Error("empty-scan")),
    undefined,
  );
});

test("a cause is shown once and a different cause is shown again", () => {
  const source = makeSource();
  const first = failures.recordPersistentFailure({}, source, "empty-scan", NOW);
  assert.strictEqual(first.shouldNotify, true);

  const second = failures.recordPersistentFailure(
    first.state,
    source,
    "empty-scan",
    NOW,
  );
  assert.strictEqual(second.shouldNotify, false);

  const third = failures.recordPersistentFailure(
    second.state,
    source,
    "identity-changed",
    NOW,
  );
  assert.strictEqual(third.shouldNotify, true);
});

test("a cause that could not be shown stays unshown", () => {
  const source = makeSource();
  const skipped = failures.recordPersistentFailure(
    {},
    source,
    "empty-scan",
    NOW,
    false,
  );
  assert.strictEqual(skipped.shouldNotify, false);

  const later = failures.recordPersistentFailure(
    skipped.state,
    source,
    "empty-scan",
    NOW,
  );
  assert.strictEqual(later.shouldNotify, true);
});

test("a failed source is retried only after seven days", () => {
  const source = makeSource();
  const { state } = failures.recordPersistentFailure(
    {},
    source,
    "empty-scan",
    NOW,
  );

  assert.strictEqual(
    failures.isEligibleForAutoUpdate(
      state,
      source,
      new Date(NOW.getTime() + 6 * DAY_MS),
    ),
    false,
  );
  assert.strictEqual(
    failures.isEligibleForAutoUpdate(
      state,
      source,
      new Date(NOW.getTime() + 7 * DAY_MS),
    ),
    true,
  );
  assert.strictEqual(failures.isEligibleForAutoUpdate({}, source, NOW), true);
});

test("a skipped source stays out of automatic updates", () => {
  const source = makeSource();
  const { state } = failures.recordPersistentFailure(
    {},
    source,
    "empty-scan",
    NOW,
  );
  const muted = failures.muteSource(state, source);

  assert.strictEqual(
    failures.isEligibleForAutoUpdate(
      muted,
      source,
      new Date(NOW.getTime() + 90 * DAY_MS),
    ),
    false,
  );
});

test("an edited source definition starts clean", () => {
  const source = makeSource();
  const { state } = failures.recordPersistentFailure(
    failures.muteSource({}, source),
    source,
    "empty-scan",
    NOW,
  );
  const edited = makeSource({ includePaths: ["other/"] });

  assert.strictEqual(
    failures.isEligibleForAutoUpdate(state, edited, NOW),
    true,
  );
  assert.deepStrictEqual(
    Object.keys(failures.pruneFailureState(state, [edited])),
    [],
  );
  assert.deepStrictEqual(
    Object.keys(failures.pruneFailureState(state, [source])),
    ["acme"],
  );
});

test("records of removed sources are dropped", () => {
  const source = makeSource();
  const { state } = failures.recordPersistentFailure(
    {},
    source,
    "empty-scan",
    NOW,
  );

  assert.deepStrictEqual(
    Object.keys(failures.pruneFailureState(state, [])),
    [],
  );
});

test("only sources whose index time advanced are recovered", () => {
  const acme = makeSource({ lastIndexedAt: "2026-09-01T00:00:00.000Z" });
  const other = makeSource({
    id: "other",
    url: "https://github.com/other/skills",
    lastIndexedAt: "2026-09-01T00:00:00.000Z",
  });
  let state = failures.recordPersistentFailure(
    {},
    acme,
    "empty-scan",
    NOW,
  ).state;
  state = failures.recordPersistentFailure(
    state,
    other,
    "empty-scan",
    NOW,
  ).state;

  const recovered = failures.clearRecoveredSources(
    state,
    [acme, other],
    [{ ...acme, lastIndexedAt: "2026-10-21T00:00:00.000Z" }, other],
  );

  assert.deepStrictEqual(Object.keys(recovered), ["other"]);
});

test("persisted state is validated before it is trusted", () => {
  const normalized = failures.normalizeFailureState({
    good: {
      kind: "empty-scan",
      lastFailedAt: NOW.toISOString(),
      notified: true,
      muted: false,
      fingerprint: "[]",
    },
    badKind: {
      kind: "rate-limit",
      lastFailedAt: NOW.toISOString(),
      fingerprint: "[]",
    },
    badDate: {
      kind: "empty-scan",
      lastFailedAt: "not a date",
      fingerprint: "[]",
    },
    noFingerprint: { kind: "empty-scan", lastFailedAt: NOW.toISOString() },
  });

  assert.deepStrictEqual(Object.keys(normalized), ["good"]);
  assert.deepStrictEqual(
    Object.keys(failures.normalizeFailureState("nope")),
    [],
  );
  assert.deepStrictEqual(Object.keys(failures.normalizeFailureState([])), []);
});

test("a batch of failures is split into repeated and once-per-cause reports", () => {
  const empty = makeSource({ id: "empty" });
  const moved = makeSource({ id: "moved", url: "https://github.com/a/moved" });
  const flaky = makeSource({ id: "flaky", url: "https://github.com/a/flaky" });
  const batch = [
    {
      entry: empty,
      error: reconcile.createEmptySourceScanError("empty", "Empty", 0),
    },
    { entry: flaky, error: new Error("network") },
    {
      entry: moved,
      error: new reconcile.SourceRepositoryChangedError("moved", 1, 2, "moved"),
    },
  ];

  const first = failures.triageSourceFailures({}, batch, {
    maxNotices: 5,
    now: NOW,
  });
  assert.deepStrictEqual(
    first.transient.map((failure) => failure.entry.id),
    ["flaky"],
  );
  assert.deepStrictEqual(
    first.notices.map((notice) => `${notice.source.id}:${notice.kind}`),
    ["empty:empty-scan", "moved:identity-changed"],
  );

  const again = failures.triageSourceFailures(first.state, batch, {
    maxNotices: 5,
    now: NOW,
  });
  assert.deepStrictEqual(
    again.notices,
    [],
    "the same causes are not shown again",
  );
  assert.strictEqual(
    again.transient.length,
    1,
    "a transient failure is always reported",
  );
});

test("causes beyond the notice limit wait and are shown later without a scan", () => {
  const sources = ["a", "b", "c", "d"].map((id) =>
    makeSource({ id, url: `https://github.com/acme/${id}` }),
  );
  const batch = sources.map((entry) => ({
    entry,
    error: reconcile.createEmptySourceScanError(entry.id, entry.name, 0),
  }));

  const run = failures.triageSourceFailures({}, batch, {
    maxNotices: 3,
    now: NOW,
  });
  assert.strictEqual(run.notices.length, 3);

  const later = failures.takeUnshownFailures(run.state, sources, 3);
  assert.deepStrictEqual(
    later.notices.map((notice) => notice.source.id),
    ["d"],
  );

  const afterwards = failures.takeUnshownFailures(later.state, sources, 3);
  assert.deepStrictEqual(afterwards.notices, [], "each cause is shown once");
});

test("skipped sources are listed for the tree until they recover or change", () => {
  const acme = makeSource();
  const other = makeSource({ id: "other", url: "https://github.com/a/other" });
  let state = failures.recordPersistentFailure(
    {},
    acme,
    "empty-scan",
    NOW,
  ).state;
  state = failures.recordPersistentFailure(
    state,
    other,
    "empty-scan",
    NOW,
  ).state;
  state = failures.muteSource(state, acme);

  assert.deepStrictEqual(
    [...failures.getMutedSourceIds(state, [acme, other])],
    ["acme"],
  );
  assert.deepStrictEqual(
    [
      ...failures.getMutedSourceIds(state, [
        makeSource({ includePaths: ["x/"] }),
      ]),
    ],
    [],
    "an edited definition no longer counts as skipped",
  );
  assert.deepStrictEqual(
    [
      ...failures.getMutedSourceIds(failures.clearFailure(state, "acme"), [
        acme,
      ]),
    ],
    [],
    "a recovered source is no longer listed",
  );
});

test("the tree marks skipped sources and the extension keeps it in sync", () => {
  const extension = fs.readFileSync(path.join(srcDir, "extension.ts"), "utf8");
  const tree = fs.readFileSync(path.join(srcDir, "treeProvider.ts"), "utf8");

  assert.match(
    extension,
    /await context\.globalState\.update\(SOURCE_INDEX_FAILURES_KEY, state\);\s*syncMutedSourcesToTree\(state\)/,
  );
  assert.match(
    extension,
    /syncMutedSourcesToTree\(readSourceFailureState\(\)\)/,
  );
  assert.match(tree, /this\.mutedSourceIds\.has\(source\.id\)/);
  assert.match(tree, /sourceAutoUpdateOffHint\(\)/);
});

test("the skipped-source marker is documented in both languages", () => {
  const root = path.join(__dirname, "..");
  for (const [file, text] of [
    ["README.md", /auto-update off/],
    ["README_ja.md", /自動更新オフ/],
    ["CHANGELOG.md", /auto-update off/],
    ["CHANGELOG.md", /自動更新オフ/],
  ]) {
    assert.match(fs.readFileSync(path.join(root, file), "utf8"), text, file);
  }
});

test("a skipped source is never shown as pending", () => {
  const source = makeSource();
  const { state } = failures.recordPersistentFailure(
    {},
    source,
    "empty-scan",
    NOW,
    false,
  );
  const muted = failures.muteSource(state, source);

  assert.deepStrictEqual(
    failures.takeUnshownFailures(muted, [source], 3).notices,
    [],
  );
});

test("the startup refresh and the shared stores use these rules", () => {
  const extension = fs.readFileSync(path.join(srcDir, "extension.ts"), "utf8");
  const store = fs.readFileSync(
    path.join(srcDir, "sharedResourceIndexStore.ts"),
    "utf8",
  );

  assert.match(
    extension,
    /isEligibleForAutoUpdate\(failureStateAtStart, source\)/,
  );
  assert.match(extension, /triageSourceFailures\(failureState, failures/);
  assert.match(extension, /takeUnshownFailures\(/);
  assert.match(extension, /forgetRecoveredSourceFailures\(/);
  assert.match(
    extension,
    /await writeSourceFailureState\(failureStateAtStart\)/,
    "records of removed sources are dropped even when nothing is stale",
  );
  assert.match(
    extension,
    /async function refreshIndexForKnownSources\([\s\S]*?forgetRecoveredSourceFailures\(index, refreshed\)/,
    "a user-requested refresh clears the record of a source that recovered",
  );
  assert.match(
    store,
    /applyRetiredSources\(nextIndex, currentIndex\.retiredSources\)/,
  );
  assert.match(
    store,
    /preservedIds: getRetiredSourceIds\(currentIndex\.retiredSources\)/,
  );
});

console.log("\nAll source index failure tests passed.");
