#!/usr/bin/env node

// The shared sources manifest is written by this extension AND by the sibling
// Agent Skills Ninja extension, so every case here is about not destroying data
// the other writer owns.

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

const SELF_ID = "yamapan.agent-resources-ninja";
const SIBLING_ID = "yamapan.agent-skills-ninja";

const repoRoot = path.resolve(__dirname, "..");
const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "resource-ninja-sources-"),
);
const manifestPath = path.join(tempDir, "sources.json");
const warnings = [];

const sharedManifestStub = {
  // Real constants so a cap change in production is exercised here rather than mirrored.
  ...requireTypeScriptModule(path.join(repoRoot, "src", "sharedManifest.ts"), {
    vscode: {
      Uri: {
        file: (fsPath) => ({ fsPath }),
        joinPath: (base, ...segments) => ({
          fsPath: path.join(base.fsPath, ...segments),
        }),
      },
    },
  }),
  getAgentNinjaSharedDirectoryPath: () => tempDir,
  getSharedSourcesManifestUri: () => ({ fsPath: manifestPath }),
  createEmptySharedSourcesManifest: (updatedBy) => ({
    schemaVersion: 1,
    sources: [],
    lastUpdated: new Date().toISOString(),
    updatedBy,
  }),
};

const sourceStoreStubs = {
  "./coexistence": { SELF_EXTENSION_ID: SELF_ID },
  "./gitHubRefSafety": requireTypeScriptModule(
    path.join(repoRoot, "src", "gitHubRefSafety.ts"),
  ),
  "./sharedManifest": sharedManifestStub,
  "./logger": {
    logger: { warn: (...args) => warnings.push(args.join(" ")) },
  },
  "./sharedStoreLock": {
    withSharedStoreLock: async (_owner, callback) =>
      callback({
        generation: "test-generation",
        assertHeld: () => {},
        assertStillOwned: async () => {},
      }),
    describeSharedStoreWriteFailure: () => undefined,
  },
};

const store = requireTypeScriptModule(
  path.join(repoRoot, "src", "sharedSourcesManifestStore.ts"),
  sourceStoreStubs,
);

const source = {
  id: "source-a",
  name: "Source A",
  url: "https://github.com/a/source-a",
  type: "github",
  repoId: 123456,
  branch: "main",
  description: "Source A",
  description_ja: "ソースA",
  includePaths: ["skills/"],
  excludePaths: ["tmp/"],
  lastIndexedAt: "2026-06-24T12:00:00.000Z",
  lastIndexedBy: SELF_ID,
};

function writeRawManifest(manifest) {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

function readRawManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function listBrokenFiles() {
  return fs.readdirSync(tempDir).filter((entry) => entry.includes(".broken-"));
}

function resetStore() {
  store.resetSharedSourcesManifestSession();
  warnings.length = 0;
  if (fs.existsSync(manifestPath)) {
    fs.rmSync(manifestPath);
  }
}

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

test("round trip keeps every curated field", async () => {
  resetStore();
  await store.writeSharedSourcesManifest({
    schemaVersion: 1,
    sources: [source],
    lastUpdated: "2026-06-24T12:01:00.000Z",
    updatedBy: "test",
  });

  const raw = readRawManifest();
  assert.strictEqual(raw.sources[0].lastIndexedAt, source.lastIndexedAt);
  assert.strictEqual(raw.sources[0].lastIndexedBy, SELF_ID);
  assert.strictEqual(raw.sources[0].repoId, 123456);

  const result = await store.readSharedSourcesManifest();
  assert.strictEqual(result.status, "valid");
  assert.strictEqual(
    result.manifest.sources[0].lastIndexedAt,
    source.lastIndexedAt,
  );
  assert.strictEqual(result.manifest.sources[0].repoId, 123456);
  assert.deepStrictEqual(result.manifest.sources[0].includePaths, ["skills/"]);
  assert.deepStrictEqual(result.manifest.sources[0].excludePaths, ["tmp/"]);
});

test("an absent manifest is reported as missing, not rejected", async () => {
  resetStore();
  const result = await store.readSharedSourcesManifest();
  assert.strictEqual(result.status, "missing");
});

test("a persistent filesystem write failure becomes a rejected sync result", async () => {
  resetStore();
  const fsPromises = require("fs/promises");
  const failingStore = requireTypeScriptModule(
    path.join(repoRoot, "src", "sharedSourcesManifestStore.ts"),
    {
      ...sourceStoreStubs,
      "fs/promises": {
        ...fsPromises,
        writeFile: async () => {
          const error = new Error("read-only shared store");
          error.code = "EACCES";
          throw error;
        },
      },
      "./sharedStoreLock": {
        ...sourceStoreStubs["./sharedStoreLock"],
        describeSharedStoreWriteFailure: (error) =>
          error?.code === "EACCES" ? "write failed: EACCES" : undefined,
      },
    },
  );

  assert.deepStrictEqual(
    await failingStore.writeSharedSourcesManifest({
      schemaVersion: 1,
      sources: [source],
      lastUpdated: "2026-08-18T00:00:00.000Z",
      updatedBy: SELF_ID,
    }),
    { status: "rejected", reason: "write failed: EACCES" },
  );
});

test("untrusted scalar fields are not adopted at runtime", async () => {
  resetStore();
  writeRawManifest({
    schemaVersion: 1,
    sources: [
      { ...source, repoId: "123456; DROP", scanner: "../../etc/passwd" },
    ],
    lastUpdated: "2026-06-24T12:02:00.000Z",
    updatedBy: "someone-else",
  });

  const result = await store.readSharedSourcesManifest();
  assert.strictEqual(result.status, "valid");
  assert.strictEqual(
    result.manifest.sources[0].repoId,
    undefined,
    "a non-numeric repoId must not be trusted",
  );
  assert.strictEqual(
    result.manifest.sources[0].scanner,
    undefined,
    "an unknown scanner value must not be trusted",
  );
});

test("entries that steer downloads outside the repository are not usable", async () => {
  resetStore();
  writeRawManifest({
    schemaVersion: 1,
    sources: [
      { ...source, id: "bad-url", url: "https://evil.example.com/a/b" },
      { ...source, id: "bad-host-path", url: "https://github.com/a/b/../../c" },
      { ...source, id: "absolute", includePaths: ["/etc/"] },
      { ...source, id: "traversal", includePaths: ["skills/../../secrets/"] },
      { ...source, id: "unc", excludePaths: ["\\\\server\\share"] },
      { ...source, id: "drive", excludePaths: ["C:/Windows"] },
      { ...source, id: "bad id with spaces" },
      { ...source, id: "ok" },
    ],
    lastUpdated: "2026-06-24T12:03:00.000Z",
    updatedBy: SIBLING_ID,
  });

  const result = await store.readSharedSourcesManifest();
  assert.strictEqual(result.status, "valid");
  assert.deepStrictEqual(
    result.manifest.sources.map((entry) => entry.id),
    ["ok"],
    "only the entry with a plain GitHub repo URL and relative paths is usable",
  );
  assert.strictEqual(result.rejectedEntryCount, 7);
});

test("a dot segment in the owner, repo or branch makes an entry unusable", async () => {
  resetStore();
  writeRawManifest({
    schemaVersion: 1,
    sources: [
      { ...source, id: "dotdot-owner", url: "https://github.com/../repo" },
      { ...source, id: "dot-owner", url: "https://github.com/./repo" },
      { ...source, id: "dotdot-repo", url: "https://github.com/owner/.." },
      { ...source, id: "traversal-branch", branch: "../../other/repo/main" },
      { ...source, id: "encoded-branch", branch: "%2e%2e/x" },
      { ...source, id: "control-branch", branch: "main\u0007" },
      { ...source, id: "nested-branch", branch: "feature/x" },
    ],
    lastUpdated: "2026-06-24T12:03:30.000Z",
    updatedBy: SIBLING_ID,
  });

  const result = await store.readSharedSourcesManifest();
  assert.strictEqual(result.status, "valid");
  assert.deepStrictEqual(
    result.manifest.sources.map((entry) => entry.id),
    ["nested-branch"],
    "an ordinary branch containing a slash must stay usable",
  );
  assert.strictEqual(
    result.manifest.sources[0].branch,
    "feature/x",
    "the branch value must survive validation unchanged",
  );
  assert.strictEqual(result.rejectedEntryCount, 6);
});

test("an entry rejected for its branch is still written back verbatim", async () => {
  resetStore();
  writeRawManifest({
    schemaVersion: 1,
    sources: [
      {
        id: "sibling-bad-branch",
        name: "Sibling Bad Branch",
        url: "https://github.com/sibling/only",
        type: "community",
        branch: "../../escape",
        futureField: { anything: true },
      },
    ],
    lastUpdated: "2026-06-24T12:03:45.000Z",
    updatedBy: SIBLING_ID,
  });

  await store.readSharedSourcesManifest();
  await store.writeSharedSourcesManifest({
    schemaVersion: 1,
    sources: [source],
    lastUpdated: "2026-06-24T12:03:46.000Z",
    updatedBy: SELF_ID,
  });

  const kept = readRawManifest().sources.find(
    (entry) => entry.id === "sibling-bad-branch",
  );
  assert.ok(
    kept,
    "an entry we refuse to use is another writer's data, not ours",
  );
  assert.strictEqual(kept.branch, "../../escape");
  assert.deepStrictEqual(kept.futureField, { anything: true });
});

test("a scanner we cannot run never reaches the runtime", async () => {
  resetStore();
  writeRawManifest({
    schemaVersion: 1,
    sources: [{ ...source, scanner: "registry-json" }],
    lastUpdated: "2026-06-24T12:03:50.000Z",
    updatedBy: SIBLING_ID,
  });

  const read = await store.readSharedSourcesManifest();
  assert.strictEqual(read.status, "valid");
  assert.strictEqual(read.manifest.sources[0].scanner, undefined);
  assert.strictEqual(read.manifest.sources[0].foreignScanner, "registry-json");
});

test("a scanner only the sibling implements survives our rewrite", async () => {
  resetStore();
  writeRawManifest({
    schemaVersion: 1,
    sources: [
      source,
      {
        id: "sibling-scanner",
        name: "Sibling Scanner",
        url: "https://github.com/sibling/only",
        type: "community",
        scanner: "registry-json",
      },
    ],
    lastUpdated: "2026-06-24T12:03:51.000Z",
    updatedBy: SIBLING_ID,
  });

  // No read first: removal is only allowed while our view of the file is current.
  await store.writeSharedSourcesManifest({
    schemaVersion: 1,
    sources: [source],
    lastUpdated: "2026-06-24T12:03:52.000Z",
    updatedBy: SELF_ID,
  });

  const kept = readRawManifest().sources.find(
    (entry) => entry.id === "sibling-scanner",
  );
  assert.ok(kept, "the sibling entry must survive the rewrite");
  assert.strictEqual(
    kept.scanner,
    "registry-json",
    "dropping it would delete the sibling's configuration on every save",
  );
});

test("a stale known scanner cannot overwrite a newer sibling scanner", async () => {
  resetStore();
  writeRawManifest({
    schemaVersion: 1,
    sources: [{ ...source, scanner: "registry-json" }],
    lastUpdated: "2026-06-24T12:03:52.000Z",
    updatedBy: SIBLING_ID,
  });

  const read = await store.readSharedSourcesManifest();
  assert.strictEqual(read.status, "valid");
  const runtimeSource = {
    ...read.manifest.sources[0],
    scanner: "auto",
  };
  await store.writeSharedSourcesManifest({
    schemaVersion: 1,
    sources: [runtimeSource],
    lastUpdated: "2026-06-24T12:03:53.000Z",
    updatedBy: SELF_ID,
  });

  const rewritten = readRawManifest().sources[0];
  assert.strictEqual(rewritten.scanner, "registry-json");
  assert.strictEqual(rewritten.lastIndexedAt, source.lastIndexedAt);
  assert.strictEqual(rewritten.lastIndexedBy, source.lastIndexedBy);
});

test("a stale foreign runtime source cannot recreate a sibling deletion", async () => {
  resetStore();
  writeRawManifest({
    schemaVersion: 1,
    sources: [{ ...source, scanner: "registry-json" }],
    lastUpdated: "2026-06-24T12:03:54.000Z",
    updatedBy: SIBLING_ID,
  });
  const read = await store.readSharedSourcesManifest();
  assert.strictEqual(read.status, "valid");
  assert.strictEqual(read.manifest.sources[0].foreignScanner, "registry-json");

  writeRawManifest({
    schemaVersion: 1,
    sources: [],
    lastUpdated: "2026-06-24T12:03:55.000Z",
    updatedBy: SIBLING_ID,
  });
  await store.writeSharedSourcesManifest({
    schemaVersion: 1,
    sources: read.manifest.sources,
    lastUpdated: "2026-06-24T12:03:56.000Z",
    updatedBy: SELF_ID,
  });

  assert.deepStrictEqual(readRawManifest().sources, []);
});

test("a scanner value that is not a plain name is not carried over", async () => {
  resetStore();
  writeRawManifest({
    schemaVersion: 1,
    sources: [
      source,
      {
        id: "sibling-junk-scanner",
        name: "Sibling Junk Scanner",
        url: "https://github.com/sibling/only",
        type: "community",
        scanner: "../../etc/passwd",
      },
    ],
    lastUpdated: "2026-06-24T12:03:53.000Z",
    updatedBy: SIBLING_ID,
  });

  await store.writeSharedSourcesManifest({
    schemaVersion: 1,
    sources: [source],
    lastUpdated: "2026-06-24T12:03:54.000Z",
    updatedBy: SELF_ID,
  });

  const kept = readRawManifest().sources.find(
    (entry) => entry.id === "sibling-junk-scanner",
  );
  assert.ok(kept, "the entry itself is still another writer's data");
  assert.strictEqual(kept.scanner, undefined);
});

test("the same id written twice yields one runtime source", async () => {
  resetStore();
  writeRawManifest({
    schemaVersion: 1,
    sources: [
      { ...source, name: "First" },
      { ...source, name: "Second" },
    ],
    lastUpdated: "2026-06-24T12:03:54.000Z",
    updatedBy: SIBLING_ID,
  });

  const result = await store.readSharedSourcesManifest();
  assert.strictEqual(result.status, "valid");
  assert.strictEqual(result.manifest.sources.length, 1);
  assert.strictEqual(result.manifest.sources[0].name, "First");
  assert.strictEqual(
    result.rejectedEntryCount,
    0,
    "a repeated id is a duplicate, not an invalid entry",
  );
});

test("a source only the sibling knows about survives our rewrite", async () => {
  resetStore();
  writeRawManifest({
    schemaVersion: 1,
    sources: [
      source,
      {
        id: "sibling-only",
        name: "Sibling Only",
        url: "https://github.com/sibling/only",
        type: "community",
        description: "Added by the sibling extension",
        lastIndexedAt: "2026-06-23T00:00:00.000Z",
        lastIndexedBy: SIBLING_ID,
        futureField: { anything: true },
      },
    ],
    lastUpdated: "2026-06-24T12:04:00.000Z",
    updatedBy: SIBLING_ID,
  });

  // Our own view never included the sibling entry, which is exactly the state
  // that used to overwrite it.
  await store.writeSharedSourcesManifest({
    schemaVersion: 1,
    sources: [source],
    lastUpdated: "2026-06-24T12:05:00.000Z",
    updatedBy: SELF_ID,
  });

  const raw = readRawManifest();
  const siblingEntry = raw.sources.find((entry) => entry.id === "sibling-only");
  assert.ok(siblingEntry, "the sibling-only source must still be on disk");
  assert.deepStrictEqual(
    siblingEntry.futureField,
    { anything: true },
    "a field this extension does not understand must survive untouched",
  );
  assert.strictEqual(siblingEntry.lastIndexedBy, SIBLING_ID);
});

test("an entry we cannot validate is kept on disk but never used", async () => {
  resetStore();
  writeRawManifest({
    schemaVersion: 1,
    sources: [
      source,
      {
        id: "unverifiable",
        name: "Unverifiable",
        url: "ftp://example.com/nope",
        type: "community",
        description: "written by some other tool",
      },
    ],
    lastUpdated: "2026-06-24T12:06:00.000Z",
    updatedBy: SIBLING_ID,
  });

  const read = await store.readSharedSourcesManifest();
  assert.deepStrictEqual(
    read.manifest.sources.map((entry) => entry.id),
    ["source-a"],
    "the unverifiable entry must not reach the runtime",
  );

  const write = await store.writeSharedSourcesManifest({
    schemaVersion: 1,
    sources: [source],
    lastUpdated: "2026-06-24T12:07:00.000Z",
    updatedBy: SELF_ID,
  });
  assert.strictEqual(
    write.status,
    "written",
    "one unverifiable entry must not stop us from persisting our own sources",
  );

  const raw = readRawManifest();
  const kept = raw.sources.find((entry) => entry.id === "unverifiable");
  assert.ok(kept, "the unverifiable entry stays on disk for its owner");
  assert.strictEqual(kept.url, "ftp://example.com/nope");
});

test("a local removal propagates only while our view is current", async () => {
  resetStore();
  writeRawManifest({
    schemaVersion: 1,
    sources: [source, { ...source, id: "source-b", name: "Source B" }],
    lastUpdated: "2026-06-24T12:08:00.000Z",
    updatedBy: SELF_ID,
  });

  await store.readSharedSourcesManifest();
  await store.writeSharedSourcesManifest({
    schemaVersion: 1,
    sources: [source],
    lastUpdated: "2026-06-24T12:09:00.000Z",
    updatedBy: SELF_ID,
  });
  assert.deepStrictEqual(
    readRawManifest().sources.map((entry) => entry.id),
    ["source-a"],
    "removing a source locally must reach the shared manifest",
  );

  // A sibling writes after our last read, so an id we do not know about is not
  // proof that we removed it.
  writeRawManifest({
    schemaVersion: 1,
    sources: [source, { ...source, id: "source-c", name: "Source C" }],
    lastUpdated: "2026-06-24T12:10:00.000Z",
    updatedBy: SIBLING_ID,
  });
  await store.writeSharedSourcesManifest({
    schemaVersion: 1,
    sources: [source],
    lastUpdated: "2026-06-24T12:11:00.000Z",
    updatedBy: SELF_ID,
  });
  assert.deepStrictEqual(
    readRawManifest()
      .sources.map((entry) => entry.id)
      .sort(),
    ["source-a", "source-c"],
    "a source added since our last read must not be treated as a local removal",
  );
});

test("a prototype-polluting key never round trips", async () => {
  resetStore();
  fs.writeFileSync(
    manifestPath,
    '{"schemaVersion":1,"sources":[{"id":"source-a","name":"Source A","url":"https://github.com/a/source-a","type":"github","description":"Source A","__proto__":{"polluted":true}}],"lastUpdated":"2026-06-24T12:12:00.000Z","updatedBy":"someone-else"}',
    "utf8",
  );

  await store.readSharedSourcesManifest();
  await store.writeSharedSourcesManifest({
    schemaVersion: 1,
    sources: [source],
    lastUpdated: "2026-06-24T12:13:00.000Z",
    updatedBy: SELF_ID,
  });

  assert.strictEqual(
    {}.polluted,
    undefined,
    "reading the shared store must not touch Object.prototype",
  );
  assert.ok(
    !fs.readFileSync(manifestPath, "utf8").includes("polluted"),
    "a prototype key must not be written back",
  );
});

test("an unusable file is rejected, left alone, and never bootstrapped over", async () => {
  for (const [label, contents] of [
    ["invalid JSON", "{ not json"],
    ["schema mismatch", JSON.stringify({ schemaVersion: 99, sources: [] })],
    [
      "sources is not an array",
      JSON.stringify({ schemaVersion: 1, sources: {} }),
    ],
  ]) {
    resetStore();
    fs.writeFileSync(manifestPath, contents, "utf8");
    const before = fs.readFileSync(manifestPath, "utf8");

    const read = await store.readSharedSourcesManifest();
    assert.strictEqual(read.status, "rejected", `${label} should be rejected`);
    assert.strictEqual(
      fs.readFileSync(manifestPath, "utf8"),
      before,
      `${label}: a reader must never modify the shared file`,
    );
    assert.deepStrictEqual(
      listBrokenFiles(),
      [],
      `${label}: no .broken-* copy may be produced`,
    );

    const write = await store.writeSharedSourcesManifest({
      schemaVersion: 1,
      sources: [source],
      lastUpdated: "2026-06-24T12:14:00.000Z",
      updatedBy: SELF_ID,
    });
    assert.strictEqual(
      write.status,
      "rejected",
      `${label}: we must not overwrite a file we cannot understand`,
    );
    assert.strictEqual(fs.readFileSync(manifestPath, "utf8"), before);
  }
});

test("an oversized file is rejected before it is parsed", async () => {
  resetStore();
  const padding = "x".repeat(
    sharedManifestStub.SHARED_SOURCES_MANIFEST_MAX_BYTES,
  );
  writeRawManifest({
    schemaVersion: 1,
    sources: [source],
    lastUpdated: "2026-06-24T12:15:00.000Z",
    updatedBy: SIBLING_ID,
    padding,
  });

  const read = await store.readSharedSourcesManifest();
  assert.strictEqual(read.status, "rejected");
  assert.match(read.reason, /exceeds/);
  assert.deepStrictEqual(listBrokenFiles(), []);
});

test("an entry count above the cap rejects the whole file", async () => {
  resetStore();
  writeRawManifest({
    schemaVersion: 1,
    sources: Array.from(
      { length: store.MAX_SHARED_SOURCE_ENTRIES + 1 },
      (_unused, index) => ({ ...source, id: `source-${index}` }),
    ),
    lastUpdated: "2026-06-24T12:16:00.000Z",
    updatedBy: SIBLING_ID,
  });

  const read = await store.readSharedSourcesManifest();
  assert.strictEqual(read.status, "rejected");
  assert.match(read.reason, /entry limit/);
});

// The merge adds our entries to whatever the sibling already wrote, so the writer
// has to hold itself to the limits the reader enforces.
test("a merge past the entry cap is refused instead of written", async () => {
  resetStore();
  writeRawManifest({
    schemaVersion: 1,
    sources: Array.from(
      { length: store.MAX_SHARED_SOURCE_ENTRIES },
      (_unused, index) => ({
        ...source,
        id: `sibling-${index}`,
        lastIndexedBy: SIBLING_ID,
      }),
    ),
    lastUpdated: "2026-06-24T12:17:00.000Z",
    updatedBy: SIBLING_ID,
  });
  const before = fs.readFileSync(manifestPath, "utf8");

  const write = await store.writeSharedSourcesManifest({
    schemaVersion: 1,
    sources: [{ ...source, id: "own-extra" }],
    lastUpdated: "2026-06-24T12:17:01.000Z",
    updatedBy: SELF_ID,
  });

  assert.strictEqual(write.status, "rejected");
  // A lock or path failure returns the same shape, so the reason has to be checked.
  assert.strictEqual(
    write.reason,
    `${store.MAX_SHARED_SOURCE_ENTRIES + 1} entries exceeds the ${store.MAX_SHARED_SOURCE_ENTRIES} entry limit`,
  );
  assert.strictEqual(fs.readFileSync(manifestPath, "utf8"), before);
});

test("a merge exactly at the entry cap is written and reads back", async () => {
  resetStore();
  writeRawManifest({
    schemaVersion: 1,
    sources: Array.from(
      { length: store.MAX_SHARED_SOURCE_ENTRIES - 1 },
      (_unused, index) => ({
        ...source,
        id: `sibling-${index}`,
        lastIndexedBy: SIBLING_ID,
      }),
    ),
    lastUpdated: "2026-06-24T12:17:02.000Z",
    updatedBy: SIBLING_ID,
  });

  const write = await store.writeSharedSourcesManifest({
    schemaVersion: 1,
    sources: [{ ...source, id: "own-extra" }],
    lastUpdated: "2026-06-24T12:17:03.000Z",
    updatedBy: SELF_ID,
  });

  assert.strictEqual(write.status, "written");
  const read = await store.readSharedSourcesManifest();
  assert.strictEqual(read.status, "valid");
  assert.strictEqual(
    read.manifest.sources.length,
    store.MAX_SHARED_SOURCE_ENTRIES,
  );
});

test("a merge past the byte cap is refused instead of written", async () => {
  resetStore();
  const write = await store.writeSharedSourcesManifest({
    schemaVersion: 1,
    sources: Array.from({ length: 40 }, (_unused, index) => ({
      ...source,
      id: `own-${index}`,
      includePaths: Array.from(
        { length: 64 },
        (_path, position) => `${"a".repeat(500)}/${position}`,
      ),
      excludePaths: Array.from(
        { length: 64 },
        (_path, position) => `${"b".repeat(500)}/${position}`,
      ),
    })),
    lastUpdated: "2026-06-24T12:17:04.000Z",
    updatedBy: SELF_ID,
  });

  assert.strictEqual(write.status, "rejected");
  assert.match(
    write.reason,
    new RegExp(
      `^\\d+ bytes exceeds the ${sharedManifestStub.SHARED_SOURCES_MANIFEST_MAX_BYTES} byte limit$`,
    ),
  );
  assert.strictEqual(
    fs.existsSync(manifestPath),
    false,
    "a refused write must not publish a file we would then reject",
  );
});

test("everything we write is something we can read back", async () => {
  resetStore();
  // A branch the reader refuses would cost us the whole source if we published it.
  await store.writeSharedSourcesManifest({
    schemaVersion: 1,
    sources: [{ ...source, branch: "../../escape" }],
    lastUpdated: "2026-06-24T12:03:55.000Z",
    updatedBy: SELF_ID,
  });

  const written = readRawManifest().sources[0];
  assert.strictEqual(
    written.branch,
    undefined,
    "an unusable branch is dropped rather than published",
  );

  const result = await store.readSharedSourcesManifest();
  assert.strictEqual(result.status, "valid");
  assert.strictEqual(
    result.rejectedEntryCount,
    0,
    "our own entry must survive its own round trip",
  );
  assert.strictEqual(result.manifest.sources[0].id, source.id);
});

async function main() {
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      console.error(`FAIL ${name}`);
      throw error;
    }
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
}

main()
  .then(() => {
    console.log("RESULT=PASS");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
