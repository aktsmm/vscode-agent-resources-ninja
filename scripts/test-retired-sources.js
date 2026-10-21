#!/usr/bin/env node

// Guards retired preset sources: the catalog can retire a source, and neither the
// local index nor the shared stores may bring it back or lose it for a sibling.

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

const retired = requireTypeScriptModule(path.join(srcDir, "retiredSources.ts"));
const { mergeSkillIndexes } = requireTypeScriptModule(
  path.join(srcDir, "skillIndex.ts"),
  {
    vscode: {
      Uri: { joinPath: (base, ...segments) => ({ base, segments }) },
      workspace: { fs: {} },
      env: { language: "en" },
    },
    "./gitHubRefSafety": requireTypeScriptModule(
      path.join(srcDir, "gitHubRefSafety.ts"),
    ),
    "./githubFetch": {
      fetchGitHubWithOptionalAuthRetry: async () => undefined,
    },
    "./logger": {
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    },
    "./retiredSources": retired,
    "./sharedResourceIndexStore": {
      loadSharedStoresIntoSkillIndex: async (_context, index) => index,
      syncSharedStoresFromSkillIndex: async () => undefined,
    },
  },
);
const manifestStore = requireTypeScriptModule(
  path.join(srcDir, "sharedSourcesManifestStore.ts"),
  {
    "./logger": {
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    },
    "./sharedStoreLock": {
      describeSharedStoreWriteFailure: () => undefined,
      withSharedStoreLock: async () => undefined,
    },
    "./sharedManifest": {
      SHARED_MANIFEST_SCHEMA_VERSION: 1,
      SHARED_SOURCES_MANIFEST_MAX_BYTES: 2 * 1024 * 1024,
      SHARED_SOURCES_MANIFEST_TEMP_FILE: "sources.json.tmp",
      SHARED_STORE_RETRY_DELAY_MS: 100,
      createEmptySharedSourcesManifest: () => ({ sources: [] }),
      getAgentNinjaSharedDirectoryPath: () => "",
      getSharedSourcesManifestUri: () => ({ fsPath: "" }),
    },
    "./coexistence": { SELF_EXTENSION_ID: "test.extension" },
    "./gitHubRefSafety": requireTypeScriptModule(
      path.join(srcDir, "gitHubRefSafety.ts"),
    ),
  },
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

function makeIndex(overrides = {}) {
  return {
    version: "1.0.0",
    lastUpdated: "2026-01-01",
    sources: [
      {
        id: "keep",
        name: "Keep",
        url: "https://github.com/a/keep",
        type: "official",
        description: "",
      },
      {
        id: "old",
        name: "Old",
        url: "https://github.com/a/old",
        type: "official",
        description: "",
      },
    ],
    skills: [
      {
        kind: "skill",
        name: "k",
        source: "keep",
        path: "skills/k",
        categories: [],
        description: "k",
      },
      {
        kind: "skill",
        name: "o",
        source: "old",
        path: "skills/o",
        categories: [],
        description: "o",
      },
    ],
    categories: [],
    bundles: [
      { id: "b", name: "B", source: "old", description: "", skills: ["o"] },
    ],
    ...overrides,
  };
}

test("retired ids ignore blank and malformed entries", () => {
  assert.deepStrictEqual(
    Array.from(
      retired.getRetiredSourceIds([{ id: " old " }, { id: "" }, {}, null]),
    ),
    ["old"],
  );
  assert.strictEqual(retired.getRetiredSourceIds(undefined).size, 0);
});

test("a retired source takes its resources and bundles with it", () => {
  const result = retired.applyRetiredSources(makeIndex(), [{ id: "old" }]);

  assert.deepStrictEqual(
    result.sources.map((s) => s.id),
    ["keep"],
  );
  assert.deepStrictEqual(
    result.skills.map((s) => s.source),
    ["keep"],
  );
  assert.strictEqual(result.bundles, undefined);
});

test("an index without a retired source is returned as is", () => {
  const index = makeIndex();
  assert.strictEqual(
    retired.applyRetiredSources(index, [{ id: "absent" }]),
    index,
  );
  assert.strictEqual(retired.applyRetiredSources(index, undefined), index);
});

test("merging with a catalog that retires a source drops it from the local index", () => {
  const bundled = makeIndex({
    version: "2.0.0",
    retiredSources: [{ id: "old" }],
    sources: [makeIndex().sources[0]],
    skills: [makeIndex().skills[0]],
    bundles: [],
  });
  const merged = mergeSkillIndexes(makeIndex(), bundled);

  assert.deepStrictEqual(
    merged.sources.map((s) => s.id),
    ["keep"],
  );
  assert.ok(merged.skills.every((skill) => skill.source !== "old"));
  assert.deepStrictEqual(merged.retiredSources, [{ id: "old" }]);
});

test("a retired id kept in the shared file survives our rewrite", () => {
  const raw = [
    {
      id: "keep",
      name: "Keep",
      url: "https://github.com/a/keep",
      type: "official",
      description: "",
    },
    {
      id: "old",
      name: "Old",
      url: "https://github.com/a/old",
      type: "official",
      description: "",
    },
    {
      id: "gone",
      name: "Gone",
      url: "https://github.com/a/gone",
      type: "official",
      description: "",
    },
  ];
  const own = [raw[0]];

  const merged = manifestStore.mergeSourceEntriesForRewrite(raw, own, {
    allowRemoval: true,
    preservedIds: new Set(["old"]),
  });

  assert.deepStrictEqual(
    merged.map((entry) => entry.id),
    ["keep", "old"],
  );
});

test("without a preserved id the removal still applies", () => {
  const raw = [
    {
      id: "keep",
      name: "Keep",
      url: "https://github.com/a/keep",
      type: "official",
      description: "",
    },
    {
      id: "old",
      name: "Old",
      url: "https://github.com/a/old",
      type: "official",
      description: "",
    },
  ];
  const merged = manifestStore.mergeSourceEntriesForRewrite(raw, [raw[0]], {
    allowRemoval: true,
  });

  assert.deepStrictEqual(
    merged.map((entry) => entry.id),
    ["keep"],
  );
});

test("the bundled index retires openai-codex and no longer ships it", () => {
  const bundled = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "resources", "skill-index.json"),
      "utf8",
    ),
  );

  assert.ok(
    retired.getRetiredSourceIds(bundled.retiredSources).has("openai-codex"),
  );
  assert.ok(!bundled.sources.some((source) => source.id === "openai-codex"));
  assert.ok(!bundled.skills.some((skill) => skill.source === "openai-codex"));
});

console.log("\nAll retired source tests passed.");
