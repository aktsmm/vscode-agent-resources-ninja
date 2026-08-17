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
  SHARED_MANIFEST_SCHEMA_VERSION: 1,
  SHARED_SOURCES_MANIFEST_TEMP_FILE: "sources.json.tmp",
  SHARED_SOURCES_MANIFEST_MAX_BYTES: 1024 * 1024,
  getAgentNinjaSharedDirectoryPath: () => tempDir,
  getSharedSourcesManifestUri: () => ({ fsPath: manifestPath }),
  createEmptySharedSourcesManifest: (updatedBy) => ({
    schemaVersion: 1,
    sources: [],
    lastUpdated: new Date().toISOString(),
    updatedBy,
  }),
};

const store = requireTypeScriptModule(
  path.join(repoRoot, "src", "sharedSourcesManifestStore.ts"),
  {
    "./coexistence": { SELF_EXTENSION_ID: SELF_ID },
    "./sharedManifest": sharedManifestStub,
    "./logger": {
      logger: { warn: (...args) => warnings.push(args.join(" ")) },
    },
    "./sharedStoreLock": {
      withSharedStoreLock: async (_owner, callback) => callback(),
    },
  },
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
