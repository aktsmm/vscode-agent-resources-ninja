#!/usr/bin/env node

// Loading the shared manifest replaces the runtime source list and the result is
// persisted into the local index, so a source dropped here is lost locally even
// though the shared file still holds it. These cases pin what may be dropped.

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

const repoRoot = path.resolve(__dirname, "..");
const srcDir = path.join(repoRoot, "src");

const warnings = [];

const vscodeStub = {
  workspace: {
    getConfiguration: () => ({ get: () => true }),
    fs: {},
  },
  window: {
    showWarningMessage: (message, ...actions) => {
      warnings.push({ message, actions });
      return Promise.resolve(undefined);
    },
  },
  commands: {
    executeCommand: async () => undefined,
  },
  Uri: {
    file: (fsPath) => ({ fsPath, toString: () => fsPath }),
    joinPath: (base, ...segments) => ({
      fsPath: path.join(base.fsPath, ...segments),
    }),
  },
};

const tempRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "resource-ninja-merge-"),
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
const sharedIndexPath = path.join(sharedDir, "index.json");
let useSharedResourceIndex = true;
let useSharedSourcesManifest = true;
let sourceBootstrapResult = { status: "written" };

function makeContext() {
  const state = new Map();
  return {
    globalState: {
      get: (key) => state.get(key),
      update: async (key, value) => {
        state.set(key, value);
      },
    },
  };
}

const store = requireTypeScriptModule(
  path.join(srcDir, "sharedResourceIndexStore.ts"),
  {
    vscode: vscodeStub,
    "./sharedManifest": sharedManifest,
    "./sharedStoreLock": {
      withSharedStoreLock: async (_owner, callback) =>
        callback({
          generation: "test-generation",
          assertHeld: () => {},
          assertStillOwned: async () => {},
        }),
      describeSharedStoreLockFailure: () => undefined,
    },
    "./coexistence": {
      SELF_EXTENSION_ID: "test.extension",
      getEffectiveOwner: async () => "self",
      buildSelfBeacon: () => ({}),
      RESOURCE_NINJA_KINDS: [
        "skill",
        "agent",
        "instruction",
        "prompt",
        "hook",
        "mcp",
        "plugin",
        "cursor-rule",
      ],
    },
    "./customizationPaths": {
      getConfiguredUseSharedResourceIndex: () => useSharedResourceIndex,
      getConfiguredUseSharedSourcesManifest: () => useSharedSourcesManifest,
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
        actionShowCoexistenceStatus: () => "Show Coexistence Status",
        sharedStoreSyncPaused: (reason) => `paused: ${reason}`,
      },
    },
    "./skillIndex": {
      getIndexResources: () => [],
      getResourceKind: (resource) => resource?.kind || "skill",
    },
    "./sharedSourcesManifestStore": {
      readSharedSourcesManifest: async () => ({ status: "missing" }),
      writeSharedSourcesManifest: async () => ({ status: "written" }),
      bootstrapSharedSourcesManifest: async () => sourceBootstrapResult,
    },
  },
);

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

function makeSource(id, overrides = {}) {
  return {
    id,
    name: id,
    url: `https://github.com/owner/${id}`,
    type: "github",
    description: id,
    ...overrides,
  };
}

test("an id is collected even from an entry that failed validation", () => {
  const ids = store.collectManifestEntryIds([
    { id: "usable" },
    { id: "unusable", url: "https://evil.example.com/a/b" },
    { id: "" },
    { name: "no id at all" },
    null,
    "not an object",
    ["array"],
  ]);

  assert.deepStrictEqual(
    [...ids].sort(),
    ["unusable", "usable"],
    "only well-formed string ids are collected, but a rejected entry still counts",
  );
});

test("the manifest still decides the shared fields of a source we both know", () => {
  const merged = store.mergeSharedManifestSources(
    [makeSource("shared", { repoId: 1, branch: "main" })],
    [makeSource("shared", { branch: "develop" })],
    new Set(["shared"]),
  );

  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].branch, "develop", "the manifest value wins");
  assert.strictEqual(
    merged[0].repoId,
    1,
    "a field the manifest does not carry keeps the local value",
  );
});

test("a source only the manifest knows about is adopted", () => {
  const merged = store.mergeSharedManifestSources(
    [],
    [makeSource("sibling-only")],
    new Set(["sibling-only"]),
  );

  assert.deepStrictEqual(
    merged.map((source) => source.id),
    ["sibling-only"],
  );
});

test("a local source whose entry is on disk but unusable is not dropped", () => {
  // The regression this pins: per-entry validation removes the entry from the
  // usable list, and returning only the usable list deleted our own source from
  // the runtime index and then persisted that loss into the local index.
  const merged = store.mergeSharedManifestSources(
    [makeSource("kept"), makeSource("rejected-on-disk")],
    [makeSource("kept")],
    new Set(["kept", "rejected-on-disk"]),
  );

  assert.deepStrictEqual(
    merged.map((source) => source.id).sort(),
    ["kept", "rejected-on-disk"],
    "an entry present on disk is unusable, not deleted",
  );
});

test("a source genuinely absent from the shared file is still removed", () => {
  const merged = store.mergeSharedManifestSources(
    [makeSource("kept"), makeSource("removed-elsewhere")],
    [makeSource("kept")],
    new Set(["kept"]),
  );

  assert.deepStrictEqual(
    merged.map((source) => source.id),
    ["kept"],
    "removal through the shared manifest keeps working",
  );
});

test("before the first reconciliation the shared file cannot delete a local source", () => {
  // Sharing is off by default, so sources added while it was off never reached
  // the shared file. Turning sharing on must not read that silence as a removal.
  const merged = store.mergeSharedManifestSources(
    [makeSource("added-while-sharing-was-off"), makeSource("shared")],
    [makeSource("shared")],
    new Set(["shared"]),
    { keepUnlistedLocalSources: true },
  );

  assert.deepStrictEqual(merged.map((source) => source.id).sort(), [
    "added-while-sharing-was-off",
    "shared",
  ]);
});

test("after reconciliation the shared file is authoritative again", () => {
  const merged = store.mergeSharedManifestSources(
    [makeSource("removed-elsewhere"), makeSource("shared")],
    [makeSource("shared")],
    new Set(["shared"]),
    { keepUnlistedLocalSources: false },
  );

  assert.deepStrictEqual(
    merged.map((source) => source.id),
    ["shared"],
  );
});

test("a rejected entry is restored with its local values, not the raw ones", () => {
  const local = makeSource("rejected-on-disk", {
    repoId: 42,
    branch: "release",
  });
  const merged = store.mergeSharedManifestSources(
    [local],
    [],
    new Set(["rejected-on-disk"]),
  );

  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].repoId, 42);
  assert.strictEqual(merged[0].branch, "release");
});

test("a refused write tells the user once and stays quiet on repeats", () => {
  assert.deepStrictEqual(
    store.planSharedStoreRejectionNotice("rejected", "invalid JSON", undefined),
    { action: "notify", reason: "invalid JSON" },
    "the first refusal must reach the user; silence reads as working sync",
  );

  assert.deepStrictEqual(
    store.planSharedStoreRejectionNotice(
      "rejected",
      "invalid JSON",
      "invalid JSON",
    ),
    { action: "skip" },
    "the same reason must not nag on every save",
  );
});

test("a different reason speaks again, and a success resets the notice", () => {
  assert.deepStrictEqual(
    store.planSharedStoreRejectionNotice(
      "rejected",
      "schema version mismatch",
      "invalid JSON",
    ),
    { action: "notify", reason: "schema version mismatch" },
  );

  assert.deepStrictEqual(
    store.planSharedStoreRejectionNotice("written", undefined, "invalid JSON"),
    { action: "clear" },
    "a later break must be able to notify again",
  );

  assert.deepStrictEqual(
    store.planSharedStoreRejectionNotice("written", undefined, undefined),
    { action: "skip" },
    "a normal successful save writes nothing",
  );
});

test("a refusal with no stated reason still notifies", () => {
  assert.deepStrictEqual(
    store.planSharedStoreRejectionNotice("rejected", undefined, undefined),
    { action: "notify", reason: "unknown" },
  );
});

test("losing a race for the lock is not worth a notification", () => {
  for (const reason of ["lease-lost", "lock-unavailable"]) {
    assert.deepStrictEqual(
      store.planSharedStoreRejectionNotice("rejected", reason, undefined),
      { action: "skip" },
      `${reason} resolves on the next sync, so it is not a pause`,
    );
    assert.deepStrictEqual(
      store.planSharedStoreRejectionNotice("rejected", reason, "too large"),
      { action: "skip" },
      "and it says nothing about a genuine pause already reported",
    );
  }
});

test("an unreadable shared index is never rebuilt from our own data", async () => {
  // Rebuilding would replace every resource and scan record only the sibling
  // holds, which is the same loss the sources manifest already guards against.
  const corrupt = '{ "schemaVersion": 1, "byKind": { broken';
  fs.mkdirSync(sharedDir, { recursive: true });
  fs.writeFileSync(sharedIndexPath, corrupt, "utf8");

  await store.syncSharedStoresFromSkillIndex(makeContext(), {
    version: "1.0.0",
    lastUpdated: "2026-08-18",
    sources: [makeSource("local")],
    skills: [],
    categories: [],
  });

  assert.strictEqual(
    fs.readFileSync(sharedIndexPath, "utf8"),
    corrupt,
    "the unreadable file must be left exactly as it was",
  );
});

test("scan metadata is not written over an unreadable shared index", async () => {
  const corrupt = '{ "schemaVersion": 1, "byKind": { broken';
  fs.mkdirSync(sharedDir, { recursive: true });
  fs.writeFileSync(sharedIndexPath, corrupt, "utf8");

  await store.updateSharedScanMetadata(
    makeContext(),
    {
      version: "1.0.0",
      lastUpdated: "2026-08-18",
      sources: [makeSource("local")],
      skills: [],
      categories: [],
    },
    ["local"],
  );

  assert.strictEqual(fs.readFileSync(sharedIndexPath, "utf8"), corrupt);
});

test("a paused shared index tells the user, and a healthy manifest does not silence it", async () => {
  fs.mkdirSync(sharedDir, { recursive: true });
  fs.writeFileSync(
    sharedIndexPath,
    '{ "schemaVersion": 1, "byKind": { broken',
    "utf8",
  );
  warnings.length = 0;
  const context = makeContext();

  await store.syncSharedStoresFromSkillIndex(context, {
    version: "1.0.0",
    lastUpdated: "2026-08-18",
    sources: [makeSource("local")],
    skills: [],
    categories: [],
  });

  assert.strictEqual(
    warnings.length,
    1,
    "the index refusal must reach a notification, not only the log",
  );
  assert.ok(
    context.globalState.get(store.SHARED_STORE_REJECTION_NOTICE_KEYS.index) !==
      undefined,
    "the index notice is remembered under its own key",
  );
  assert.strictEqual(
    context.globalState.get(store.SHARED_STORE_REJECTION_NOTICE_KEYS.sources),
    undefined,
    "a healthy sources manifest must not carry an index rejection",
  );

  // A second save must not nag about the same reason.
  await store.syncSharedStoresFromSkillIndex(context, {
    version: "1.0.0",
    lastUpdated: "2026-08-18",
    sources: [makeSource("local")],
    skills: [],
    categories: [],
  });
  assert.strictEqual(warnings.length, 1, "the same reason must not repeat");
});

test("the shared index keeps what belongs to the other extension", () => {
  // The two shared settings are independent, so with only the shared index
  // enabled the sibling's sources are absent from our list. Rebuilding the file
  // from our view alone would delete its resources and scan records every save.
  const previous = {
    schemaVersion: 1,
    lastFullScan: "2026-08-01T00:00:00.000Z",
    lastScannedBy: "sibling.extension",
    byKind: {
      skill: [
        { name: "sibling-only", source: "sibling-src", kind: "skill" },
        { name: "stale-ours", source: "dropped-src", kind: "skill" },
      ],
    },
    translations: { ja: {} },
    scanMeta: {
      "sibling-src": {
        lastScannedAt: "2026-08-01T00:00:00.000Z",
        lastScannedBy: "sibling.extension",
      },
      "dropped-src": {
        lastScannedAt: "2026-08-01T00:00:00.000Z",
        lastScannedBy: "test.extension",
      },
      local: {
        lastScannedAt: "2026-08-02T00:00:00.000Z",
        lastScannedBy: "test.extension",
      },
    },
  };

  const next = store.buildSharedResourceIndexFromSkillIndex(
    {
      version: "1.0.0",
      lastUpdated: "2026-08-18",
      sources: [makeSource("local")],
      skills: [],
      categories: [],
    },
    previous,
  );

  assert.deepStrictEqual(
    Object.keys(next.scanMeta).sort(),
    ["local", "sibling-src"],
    "our own stale record is cleaned up, the sibling's is the only copy and stays",
  );

  const kept = JSON.stringify(next.byKind);
  assert.ok(
    kept.includes("sibling-only"),
    "a resource we cannot rebuild must not be deleted",
  );
  assert.strictEqual(
    kept.includes("stale-ours"),
    false,
    "a resource from a source we carry is rebuilt from our index",
  );
});

test("normalization preserves sibling ownership when skillCount is absent", async () => {
  fs.mkdirSync(sharedDir, { recursive: true });
  const siblingResource = {
    name: "sibling-only",
    source: "sibling-src",
    path: "skills/sibling-only/SKILL.md",
    kind: "skill",
  };
  const previous =
    sharedManifest.createEmptySharedResourceIndex("sibling.extension");
  previous.byKind.skill = [siblingResource];
  previous.scanMeta["sibling-src"] = {
    lastScannedAt: "invalid-date",
    lastScannedBy: "sibling.extension",
  };
  fs.writeFileSync(sharedIndexPath, JSON.stringify(previous), "utf8");

  const read = await store.readSharedResourceIndexResult();
  assert.strictEqual(read.status, "valid");
  assert.strictEqual(
    read.index.scanMeta["sibling-src"].lastScannedBy,
    "sibling.extension",
  );
  assert.strictEqual(read.index.scanMeta["sibling-src"].skillCount, 0);
  assert.strictEqual(
    read.index.scanMeta["sibling-src"].lastScannedAt,
    new Date(0).toISOString(),
  );

  const rebuilt = store.buildSharedResourceIndexFromSkillIndex(
    {
      version: "1.0.0",
      lastUpdated: "2026-08-18",
      sources: [makeSource("local")],
      skills: [],
      categories: [],
    },
    read.index,
  );
  assert.ok(
    rebuilt.byKind.skill.some((resource) => resource.name === "sibling-only"),
    "a malformed auxiliary counter must not transfer sibling ownership",
  );
});

test("a rejected sources bootstrap never marks reconciliation complete", async () => {
  useSharedResourceIndex = false;
  sourceBootstrapResult = { status: "rejected", reason: "write failed" };
  const context = makeContext();
  try {
    await store.loadSharedStoresIntoSkillIndex(context, {
      version: "1.0.0",
      lastUpdated: "2026-08-18",
      sources: [makeSource("local")],
      skills: [],
      categories: [],
    });
    assert.strictEqual(
      context.globalState.get(store.SHARED_SOURCES_MANIFEST_RECONCILED_KEY),
      undefined,
    );
  } finally {
    sourceBootstrapResult = { status: "written" };
    useSharedResourceIndex = true;
  }
});

test("a foreign resource already loaded into our index is not written twice", () => {
  // A previous load copies the sibling's resources into our runtime index, so a
  // rebuild that emits everything and then carries the foreign ones over would
  // duplicate them, and duplicate again on every save.
  const foreign = {
    name: "sibling-only",
    source: "sibling-src",
    kind: "skill",
  };
  const previous = {
    schemaVersion: 1,
    lastFullScan: "2026-08-01T00:00:00.000Z",
    lastScannedBy: "sibling.extension",
    byKind: { skill: [foreign] },
    translations: { ja: {} },
    scanMeta: {
      "sibling-src": {
        lastScannedAt: "2026-08-01T00:00:00.000Z",
        lastScannedBy: "sibling.extension",
      },
    },
  };

  const next = store.buildSharedResourceIndexFromSkillIndex(
    {
      version: "1.0.0",
      lastUpdated: "2026-08-18",
      sources: [makeSource("local")],
      skills: [{ ...foreign }],
      categories: [],
    },
    previous,
  );

  const copies = next.byKind.skill.filter(
    (entry) => entry.name === "sibling-only",
  );
  assert.strictEqual(copies.length, 1, "the foreign resource is written once");
});

test("a shared resource entry that steers a download is rejected", () => {
  const usable = {
    name: "ok",
    source: "src",
    path: "skills/ok/SKILL.md",
    kind: "skill",
  };
  assert.strictEqual(store.isUsableSharedResourceEntry(usable), true);
  const acceptedAtFieldLimit = Object.assign(
    { ...usable },
    Object.fromEntries(
      Array.from(
        { length: store.SHARED_RESOURCE_MAX_FIELDS - 4 },
        (_, index) => [`extra${index}`, index],
      ),
    ),
  );
  assert.strictEqual(
    Object.keys(acceptedAtFieldLimit).length,
    store.SHARED_RESOURCE_MAX_FIELDS,
  );
  assert.strictEqual(
    store.isUsableSharedResourceEntry(acceptedAtFieldLimit),
    true,
  );

  const rejected = [
    null,
    "string",
    ["array"],
    { ...usable, name: "" },
    { ...usable, source: "bad id with spaces" },
    { ...usable, path: "/etc/passwd" },
    { ...usable, path: "skills/../../secrets" },
    { ...usable, path: "C:/Windows" },
    { ...usable, remotePath: "../escape" },
    { ...usable, kind: "not-a-kind" },
    { ...usable, url: "javascript:alert(1)" },
    { ...usable, rawUrl: "http://insecure.example.com/x" },
    { ...usable, name: "x".repeat(4096) },
    Object.assign(
      { ...usable },
      Object.fromEntries(
        Array.from(
          { length: store.SHARED_RESOURCE_MAX_FIELDS - 3 },
          (_, index) => [`extra${index}`, index],
        ),
      ),
    ),
  ];
  const rejectedAtFieldLimit = rejected[rejected.length - 1];
  assert.strictEqual(
    Object.keys(rejectedAtFieldLimit).length,
    store.SHARED_RESOURCE_MAX_FIELDS + 1,
  );

  for (const entry of rejected) {
    assert.strictEqual(
      store.isUsableSharedResourceEntry(entry),
      false,
      `expected rejection: ${JSON.stringify(entry)?.slice(0, 80)}`,
    );
  }
});

test("a shared resource index above the entry cap is rejected", async () => {
  fs.mkdirSync(sharedDir, { recursive: true });
  const entry = {
    name: "bounded",
    source: "src",
    path: "skills/bounded/SKILL.md",
    kind: "skill",
  };
  const byKind = sharedManifest.createEmptySharedResourceBuckets();
  byKind.skill = Array.from(
    { length: store.SHARED_RESOURCE_INDEX_MAX_ENTRIES + 1 },
    (_, index) => ({ ...entry, name: `bounded-${index}` }),
  );
  const oversizedCountIndex = {
    schemaVersion: sharedManifest.SHARED_RESOURCE_INDEX_SCHEMA_VERSION,
    lastFullScan: new Date(0).toISOString(),
    lastScannedBy: "test.extension",
    byKind,
    translations: { ja: {} },
    scanMeta: {},
  };
  const acceptedAtCountLimit = {
    ...oversizedCountIndex,
    byKind: {
      ...byKind,
      skill: byKind.skill.slice(0, store.SHARED_RESOURCE_INDEX_MAX_ENTRIES),
    },
  };
  fs.writeFileSync(
    sharedIndexPath,
    JSON.stringify(acceptedAtCountLimit),
    "utf8",
  );
  assert.strictEqual(
    (await store.readSharedResourceIndexResult()).status,
    "valid",
  );

  fs.writeFileSync(
    sharedIndexPath,
    JSON.stringify(oversizedCountIndex),
    "utf8",
  );

  const read = await store.readSharedResourceIndexResult();
  assert.strictEqual(read.status, "rejected");
  assert.match(read.reason, /10001 resources exceeds the 10000 entry limit/);
  assert.deepStrictEqual(
    await store.writeSharedResourceIndex(oversizedCountIndex),
    {
      status: "rejected",
      reason: "10001 resources exceeds the 10000 entry limit",
    },
  );
});

test("shared resource metadata maps are bounded", async () => {
  const base = sharedManifest.createEmptySharedResourceIndex("test.extension");
  const tooManyEntries = Object.fromEntries(
    Array.from(
      { length: store.SHARED_RESOURCE_INDEX_MAX_METADATA_ENTRIES + 1 },
      (_, index) => [`key-${index}`, {}],
    ),
  );

  const acceptedTranslations = Object.fromEntries(
    Array.from(
      { length: store.SHARED_RESOURCE_INDEX_MAX_METADATA_ENTRIES },
      (_, index) => [`key-${index}`, `translation-${index}`],
    ),
  );
  fs.writeFileSync(
    sharedIndexPath,
    JSON.stringify({ ...base, translations: { ja: acceptedTranslations } }),
    "utf8",
  );
  assert.strictEqual(
    (await store.readSharedResourceIndexResult()).status,
    "valid",
  );

  for (const [label, index] of [
    ["translations", { ...base, translations: { ja: tooManyEntries } }],
    ["scan records", { ...base, scanMeta: tooManyEntries }],
  ]) {
    fs.writeFileSync(sharedIndexPath, JSON.stringify(index), "utf8");
    const read = await store.readSharedResourceIndexResult();
    assert.strictEqual(read.status, "rejected", label);
    assert.match(read.reason, new RegExp(label));
    assert.strictEqual(
      (await store.writeSharedResourceIndex(index)).status,
      "rejected",
      label,
    );
  }
});

test("invalid shared metadata values are filtered before runtime use", async () => {
  const base = sharedManifest.createEmptySharedResourceIndex("test.extension");
  const index = {
    ...base,
    translations: {
      ja: {
        valid: "説明",
        empty: "",
        oversized: "x".repeat(4096),
        object: { unsafe: true },
      },
    },
    scanMeta: {
      valid: {
        lastScannedAt: "2026-08-18T00:00:00.000Z",
        lastScannedBy: "test.extension",
        skillCount: 1,
      },
      "bad source id": {
        lastScannedAt: "2026-08-18T00:00:00.000Z",
        lastScannedBy: "test.extension",
        skillCount: 1,
      },
      invalid: {
        lastScannedAt: "not-a-date",
        lastScannedBy: "",
        skillCount: -1,
      },
    },
  };
  fs.writeFileSync(sharedIndexPath, JSON.stringify(index), "utf8");

  const read = await store.readSharedResourceIndexResult();
  assert.strictEqual(read.status, "valid");
  assert.deepStrictEqual(read.index.translations.ja, { valid: "説明" });
  assert.deepStrictEqual(Object.keys(read.index.scanMeta), ["valid"]);
});

async function main() {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${name}`);
      console.error(error);
    }
  }

  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });

  console.log(`RESULT=${failed === 0 ? "PASS" : "FAIL"}`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main();
