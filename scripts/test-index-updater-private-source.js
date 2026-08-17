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

const INDEX_UPDATER_PATH = path.join(__dirname, "..", "src", "indexUpdater.ts");
const RESOURCE_KINDS_PATH = path.join(
  __dirname,
  "..",
  "src",
  "resourceKinds.ts",
);

// src/resourceKinds.ts has no vscode dependency, so the real module is loaded
// instead of a hand-written stub that would drift from production behavior.
function collectResourceKindsImportNames() {
  const source = fs.readFileSync(INDEX_UPDATER_PATH, "utf8");
  const names = new Set();
  const pattern =
    /(?:import|export)\s*\{([^}]*)\}\s*from\s*"\.\/resourceKinds"/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    for (const entry of match[1].split(",")) {
      const tokens = entry.trim().split(/\s+/);
      if (tokens.length === 0 || !tokens[0]) continue;
      if (tokens[0] === "type") continue;
      names.add(tokens[0]);
    }
  }
  return [...names];
}

function createModule() {
  const writes = [];
  const resourceKindsModule = requireTypeScriptModule(RESOURCE_KINDS_PATH);
  const githubResponseModule = requireTypeScriptModule(
    path.join(__dirname, "..", "src", "githubResponse.ts"),
  );
  const githubCredentialBlocklistModule = requireTypeScriptModule(
    path.join(__dirname, "..", "src", "githubCredentialBlocklist.ts"),
  );
  const githubFetchModule = requireTypeScriptModule(
    path.join(__dirname, "..", "src", "githubFetch.ts"),
    {
      "./githubResponse": githubResponseModule,
      "./githubCredentialBlocklist": githubCredentialBlocklistModule,
      "./logger": { logger: { info() {}, warn() {}, error() {} } },
      "./githubAuth": {
        resolveGitHubTokenAfterFailure: async () => undefined,
      },
    },
  );
  const sourceUpdateReconcileModule = requireTypeScriptModule(
    path.join(__dirname, "..", "src", "sourceUpdateReconcile.ts"),
  );
  const indexDataNormalizationModule = requireTypeScriptModule(
    path.join(__dirname, "..", "src", "indexDataNormalization.ts"),
  );
  const uriApi = {
    joinPath: (base, ...segments) => ({
      fsPath: path.join(base.fsPath, ...segments),
    }),
  };
  const vscodeStub = {
    Uri: uriApi,
    env: { language: "en" },
    workspace: {
      getConfiguration: () => ({ get: () => undefined }),
      fs: {
        createDirectory: async () => undefined,
        writeFile: async (uri, content) => {
          writes.push({
            path: uri.fsPath,
            content: Buffer.from(content).toString("utf8"),
          });
        },
      },
    },
    window: {
      showInformationMessage: async () => undefined,
      showErrorMessage: async () => undefined,
    },
  };

  const moduleExports = requireTypeScriptModule(INDEX_UPDATER_PATH, {
    vscode: vscodeStub,
    "./skillIndex": {
      getResourceKind: (resource) => resource.kind || "skill",
      createBundleKey: (bundle) => `${bundle.source}:${bundle.id}`,
      normalizeGitHubRepoUrl: (url) => {
        const trimmed = url
          .trim()
          .replace(/\.git$/i, "")
          .replace(/\/$/, "");
        const match = trimmed.match(
          /^(https:\/\/github\.com\/[^/]+\/[^/]+)(?:\/(?:tree|blob)\/.*)?$/i,
        );
        return match ? match[1] : trimmed;
      },
      saveSkillIndex: async (_context, index) => {
        writes.push({
          path: "skill-index.json",
          content: JSON.stringify(index, null, 2),
        });
      },
    },
    "./githubAuth": {
      getGitHubToken: async () => "test-token",
      checkGitHubAuth: async () => ({
        authenticated: true,
        method: "config",
        message: "ok",
      }),
    },
    "./resourceKinds": resourceKindsModule,
    "./constants": {
      LICENSE_EXTRACTION: {
        FILE_NAMES: ["LICENSE", "LICENSE.txt"],
        SCAN_LENGTH: 2000,
      },
      INDEX_LIMITS: {
        SHORT_DESCRIPTION: 200,
        PREVIEW_LENGTH: 200,
      },
    },
    "./i18n": {
      messages: {
        authRequired: () => "GitHub authentication required",
        updatingSource: (name) => `Updating ${name}...`,
        sourceIndexResourcesUpdatedProgress: (count) =>
          `Updated ${count} resource(s)`,
      },
    },
    "./sharedResourceIndexStore": {
      shouldRunSharedScan: async () => true,
      updateSharedScanMetadata: async () => undefined,
      loadSharedStoresIntoSkillIndex: async (_context, index) => index,
      syncSharedStoresFromSkillIndex: async () => undefined,
    },
    "./sourceFreshness": {
      stampIndexedSources: (sources) => sources,
    },
    "./logger": {
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    },
    "./githubFetch": githubFetchModule,
    "./githubResponse": githubResponseModule,
    "./githubCredentialBlocklist": githubCredentialBlocklistModule,
    "./sourceUpdateReconcile": sourceUpdateReconcileModule,
    "./indexDataNormalization": indexDataNormalizationModule,
  });

  return { moduleExports, writes, resourceKindsModule };
}

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    clone() {
      return response(status, body, headers);
    },
  };
}

async function testPrivateSourceUsesContentsFallback() {
  const { moduleExports, writes } = createModule();
  const fetchCalls = [];
  global.fetch = async (url, options = {}) => {
    fetchCalls.push({ url, headers: options.headers || {} });

    if (url === "https://api.github.com/repos/octo/private-resources") {
      assert.strictEqual(options.headers.Authorization, "token test-token");
      return response(200, { default_branch: "main" });
    }

    if (
      url ===
      "https://api.github.com/repos/octo/private-resources/git/trees/main?recursive=1"
    ) {
      assert.strictEqual(options.headers.Authorization, "token test-token");
      return response(200, {
        tree: [
          { path: "skills/private-skill/SKILL.md", type: "blob" },
          { path: "bundle.json", type: "blob" },
        ],
      });
    }

    if (
      url ===
      "https://raw.githubusercontent.com/octo/private-resources/main/skills/private-skill/SKILL.md"
    ) {
      assert.ok(!options.headers?.Authorization);
      return response(404, "Not Found");
    }

    if (
      url ===
      "https://api.github.com/repos/octo/private-resources/contents/skills/private-skill/SKILL.md?ref=main"
    ) {
      assert.strictEqual(options.headers.Authorization, "token test-token");
      assert.strictEqual(
        options.headers.Accept,
        "application/vnd.github.raw+json",
      );
      return response(
        200,
        "---\nname: private-skill\ndescription: Private skill\nlicense: MIT\n---\n# Private\n",
      );
    }

    if (
      url ===
      "https://raw.githubusercontent.com/octo/private-resources/main/bundle.json"
    ) {
      assert.ok(!options.headers?.Authorization);
      return response(404, "Not Found");
    }

    if (
      url ===
      "https://api.github.com/repos/octo/private-resources/contents/bundle.json?ref=main"
    ) {
      assert.strictEqual(options.headers.Authorization, "token test-token");
      return response(200, {
        id: "private-bundle",
        name: "Private Bundle",
        skills: ["private-skill"],
        description: "Private bundle",
      });
    }

    throw new Error(`Unexpected fetch ${url}`);
  };

  const result = await moduleExports.addSource(
    { globalStorageUri: { fsPath: path.join("D:", "tmp", "storage") } },
    {
      version: "1.0.0",
      lastUpdated: "2026-06-20",
      sources: [],
      skills: [],
      categories: [],
      bundles: [],
    },
    "https://github.com/octo/private-resources",
  );

  assert.strictEqual(result.addedSkills, 1);
  assert.strictEqual(result.index.sources[0].id, "octo-private-resources");
  assert.strictEqual(result.index.skills[0].name, "private-skill");
  assert.strictEqual(result.index.bundles[0].id, "private-bundle");
  assert.ok(writes.length > 0, "Updated index should be persisted");
  assert.ok(
    fetchCalls.some((call) =>
      call.url.includes("/contents/skills/private-skill/SKILL.md"),
    ),
    "Private fallback should use the Contents API",
  );
}

async function testPublicRawDoesNotAttachToken() {
  const { moduleExports } = createModule();
  const rawCalls = [];
  global.fetch = async (url, options = {}) => {
    if (url === "https://api.github.com/repos/octo/public-resources") {
      return response(200, { default_branch: "main" });
    }

    if (
      url ===
      "https://api.github.com/repos/octo/public-resources/git/trees/main?recursive=1"
    ) {
      return response(200, {
        tree: [{ path: "skills/public-skill/SKILL.md", type: "blob" }],
      });
    }

    if (
      url ===
      "https://raw.githubusercontent.com/octo/public-resources/main/skills/public-skill/SKILL.md"
    ) {
      rawCalls.push(options.headers || {});
      return response(
        200,
        "---\nname: public-skill\ndescription: Public skill\nlicense: MIT\n---\n# Public\n",
      );
    }

    throw new Error(`Unexpected fetch ${url}`);
  };

  const result = await moduleExports.addSource(
    { globalStorageUri: { fsPath: path.join("D:", "tmp", "storage") } },
    {
      version: "1.0.0",
      lastUpdated: "2026-06-20",
      sources: [],
      skills: [],
      categories: [],
      bundles: [],
    },
    "https://github.com/octo/public-resources",
  );

  assert.strictEqual(result.addedSkills, 1);
  assert.strictEqual(rawCalls.length, 1);
  assert.ok(!rawCalls[0].Authorization, "Public raw fetch should omit token");
}

async function testFullUpdateStopsAfterRateLimit() {
  const { moduleExports } = createModule();
  const fetchCalls = [];
  const progressEvents = [];
  global.fetch = async (url) => {
    fetchCalls.push(url);
    assert.deepStrictEqual(
      progressEvents.map((event) => event.increment),
      [undefined],
      "Progress must not advance before the source request completes",
    );
    if (
      url ===
      "https://api.github.com/repos/octo/rate-limited/git/trees/main?recursive=1"
    ) {
      return response(403, "API rate limit exceeded", {
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "1785344400",
      });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };

  const currentIndex = {
    version: "1.0.0",
    lastUpdated: "2026-06-20",
    sources: [
      {
        id: "rate-limited",
        name: "Rate Limited",
        url: "https://github.com/octo/rate-limited",
        type: "official",
        branch: "main",
        description: "Rate limited source",
      },
      {
        id: "not-attempted",
        name: "Not Attempted",
        url: "https://github.com/octo/not-attempted",
        type: "official",
        branch: "main",
        description: "Skipped source",
      },
    ],
    skills: [
      {
        name: "existing-first",
        source: "rate-limited",
        path: "skills/existing-first",
        categories: [],
        description: "Existing first",
      },
      {
        name: "existing-second",
        source: "not-attempted",
        path: "skills/existing-second",
        categories: [],
        description: "Existing second",
      },
    ],
    categories: [],
    bundles: [],
  };

  const result = await moduleExports.updateIndexFromSourcesWithResult(
    { globalStorageUri: { fsPath: path.join("D:", "tmp", "storage") } },
    currentIndex,
    {
      report(event) {
        progressEvents.push(event);
      },
    },
    { forceScan: true },
  );

  assert.deepStrictEqual(fetchCalls, [
    "https://api.github.com/repos/octo/rate-limited",
    "https://api.github.com/repos/octo/rate-limited/git/trees/main?recursive=1",
  ]);
  assert.strictEqual(result.succeeded.length, 0);
  assert.deepStrictEqual(
    result.failures.map((failure) => failure.entry.id),
    ["rate-limited"],
  );
  assert.deepStrictEqual(
    result.skipped.map((source) => source.id),
    ["not-attempted"],
  );
  assert.deepStrictEqual(
    result.index.skills.map((skill) => skill.name).sort(),
    ["existing-first", "existing-second"],
  );
  assert.deepStrictEqual(progressEvents, [
    { message: "Updating Rate Limited..." },
    { increment: 50 },
  ]);
}

async function testSingleSourceProgressAdvancesAfterScan() {
  const { moduleExports } = createModule();
  const progressEvents = [];
  global.fetch = async (url) => {
    assert.deepStrictEqual(
      progressEvents.map((event) => event.increment),
      [undefined],
      "Single-source progress must not advance before its request completes",
    );
    if (
      url ===
      "https://api.github.com/repos/octo/progress-source/git/trees/main?recursive=1"
    ) {
      return response(200, {
        tree: [{ path: "skills/demo/SKILL.md", type: "blob" }],
      });
    }
    if (
      url ===
      "https://raw.githubusercontent.com/octo/progress-source/main/skills/demo/SKILL.md"
    ) {
      return response(
        200,
        "---\nname: demo\ndescription: Demo\nlicense: MIT\n---\n# Demo\n",
      );
    }
    throw new Error(`Unexpected fetch ${url}`);
  };

  await moduleExports.updateIndexFromSingleSource(
    { globalStorageUri: { fsPath: path.join("D:", "tmp", "storage") } },
    {
      version: "1.0.0",
      lastUpdated: "2026-06-20",
      sources: [
        {
          id: "progress-source",
          name: "Progress Source",
          url: "https://github.com/octo/progress-source",
          type: "official",
          branch: "main",
          description: "Progress source",
        },
      ],
      skills: [],
      categories: [],
      bundles: [],
    },
    "progress-source",
    {
      report(event) {
        progressEvents.push(event);
      },
    },
    { forceScan: true },
  );

  assert.deepStrictEqual(progressEvents, [
    { message: "Updating Progress Source..." },
    { message: "Updated 1 resource(s)", increment: 100 },
  ]);
}

async function testRemoveSourceRemovesOnlyIndexedEntries() {
  const { moduleExports, writes } = createModule();
  const currentIndex = {
    version: "1.0.0",
    lastUpdated: "2026-06-20",
    sources: [
      {
        id: "octo-private-resources",
        name: "private-resources",
        url: "https://github.com/octo/private-resources",
        type: "user-added",
        description: "Private",
      },
      {
        id: "octo-public-resources",
        name: "public-resources",
        url: "https://github.com/octo/public-resources",
        type: "user-added",
        description: "Public",
      },
    ],
    skills: [
      {
        name: "private-skill",
        source: "octo-private-resources",
        path: "skills/private-skill",
        categories: [],
        description: "Private skill",
      },
      {
        name: "public-skill",
        source: "octo-public-resources",
        path: "skills/public-skill",
        categories: [],
        description: "Public skill",
      },
    ],
    categories: [],
    bundles: [
      {
        id: "private-bundle",
        name: "Private Bundle",
        source: "octo-private-resources",
        description: "Private bundle",
        skills: ["private-skill"],
      },
    ],
  };

  const result = await moduleExports.removeSource(
    { globalStorageUri: { fsPath: path.join("D:", "tmp", "storage") } },
    currentIndex,
    "octo-private-resources",
  );

  assert.strictEqual(result.removedSkills, 1);
  assert.deepStrictEqual(
    result.index.sources.map((source) => source.id),
    ["octo-public-resources"],
  );
  assert.deepStrictEqual(
    result.index.skills.map((skill) => skill.name),
    ["public-skill"],
  );
  assert.deepStrictEqual(result.index.bundles, undefined);

  assert.strictEqual(writes.length, 1, "removeSource should persist the index");
  const savedIndex = JSON.parse(writes[0].content);
  assert.deepStrictEqual(
    savedIndex.sources.map((source) => source.id),
    ["octo-public-resources"],
  );
  assert.deepStrictEqual(
    savedIndex.skills.map((skill) => skill.name),
    ["public-skill"],
  );
}

async function testMutationBoundariesRejectMalformedIndexShape() {
  const { moduleExports } = createModule();

  await assert.rejects(
    () =>
      moduleExports.removeSource(
        { globalStorageUri: { fsPath: path.join("D:", "tmp", "storage") } },
        {
          version: "1.0.0",
          lastUpdated: "2026-06-20",
          sources: "not-array",
          skills: [],
          categories: [],
        },
        "sample-source",
      ),
    /Cannot remove source sample-source: resource index field "sources" must be an array/,
  );

  await assert.rejects(
    () =>
      moduleExports.addSource(
        { globalStorageUri: { fsPath: path.join("D:", "tmp", "storage") } },
        {
          version: "1.0.0",
          lastUpdated: "2026-06-20",
          sources: [],
          skills: "not-array",
          categories: [],
        },
        "https://github.com/octo/private-resources",
      ),
    /Cannot add source: resource index field "skills" must be an array/,
  );
}

async function testSaveSkillIndexSyncsSharedStores() {
  const writes = [];
  let syncedIndex;
  const vscodeStub = {
    Uri: {
      joinPath: (base, ...segments) => ({
        fsPath: path.join(base.fsPath, ...segments),
      }),
    },
    workspace: {
      fs: {
        createDirectory: async () => undefined,
        writeFile: async (uri, content) => {
          writes.push({
            path: uri.fsPath,
            content: Buffer.from(content).toString("utf8"),
          });
        },
      },
    },
  };

  const moduleExports = requireTypeScriptModule(
    path.join(__dirname, "..", "src", "skillIndex.ts"),
    {
      vscode: vscodeStub,
      "./githubFetch": {
        createGitHubHeaders: () => ({}),
        fetchGitHubWithOptionalAuthRetry: async () => ({ ok: false }),
      },
      "./logger": {
        logger: {
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
        },
      },
      "./sharedResourceIndexStore": {
        loadSharedStoresIntoSkillIndex: async (_context, index) => index,
        syncSharedStoresFromSkillIndex: async (_context, index) => {
          syncedIndex = index;
        },
      },
    },
  );

  const index = {
    version: "1.0.0",
    lastUpdated: "2026-06-21",
    sources: [
      {
        id: "octo-public-resources",
        name: "public-resources",
        url: "https://github.com/octo/public-resources",
        type: "user-added",
        description: "Public",
      },
    ],
    skills: [],
    categories: [],
    bundles: [],
  };

  await moduleExports.saveSkillIndex(
    { globalStorageUri: { fsPath: path.join("D:", "tmp", "storage") } },
    index,
  );

  assert.strictEqual(
    writes.length,
    1,
    "saveSkillIndex should write local index",
  );
  assert.ok(syncedIndex, "saveSkillIndex should sync shared stores");
  assert.deepStrictEqual(
    syncedIndex.sources.map((source) => source.id),
    ["octo-public-resources"],
  );
}

async function testTruncatedTreeFailsExplicitly() {
  const { moduleExports } = createModule();
  global.fetch = async (url) => {
    if (url === "https://api.github.com/repos/octo/huge-resources") {
      return response(200, { default_branch: "main" });
    }

    if (
      url ===
      "https://api.github.com/repos/octo/huge-resources/git/trees/main?recursive=1"
    ) {
      return response(200, {
        truncated: true,
        tree: [{ path: "skills/partial-skill/SKILL.md", type: "blob" }],
      });
    }

    throw new Error(`Unexpected fetch ${url}`);
  };

  await assert.rejects(
    () =>
      moduleExports.addSource(
        { globalStorageUri: { fsPath: path.join("D:", "tmp", "storage") } },
        {
          version: "1.0.0",
          lastUpdated: "2026-06-20",
          sources: [],
          skills: [],
          categories: [],
          bundles: [],
        },
        "https://github.com/octo/huge-resources",
      ),
    /GitHub tree response was truncated/,
  );
}

async function testRootResourceLicensePathIsNormalized() {
  const { moduleExports } = createModule();
  const fetchCalls = [];
  global.fetch = async (url, options = {}) => {
    fetchCalls.push(url);

    if (url === "https://api.github.com/repos/octo/root-plugin") {
      return response(200, { default_branch: "main" });
    }

    if (
      url ===
      "https://api.github.com/repos/octo/root-plugin/git/trees/main?recursive=1"
    ) {
      return response(200, {
        tree: [{ path: "plugin.json", type: "blob" }],
      });
    }

    if (
      url ===
      "https://raw.githubusercontent.com/octo/root-plugin/main/plugin.json"
    ) {
      return response(
        200,
        JSON.stringify({ name: "Root Plugin", description: "Root plugin" }),
      );
    }

    if (
      url === "https://raw.githubusercontent.com/octo/root-plugin/main/LICENSE"
    ) {
      return response(200, "MIT License\n");
    }

    throw new Error(`Unexpected fetch ${url}`);
  };

  const result = await moduleExports.addSource(
    { globalStorageUri: { fsPath: path.join("D:", "tmp", "storage") } },
    {
      version: "1.0.0",
      lastUpdated: "2026-06-20",
      sources: [],
      skills: [],
      categories: [],
      bundles: [],
    },
    "https://github.com/octo/root-plugin",
  );

  assert.strictEqual(result.addedSkills, 1);
  assert.strictEqual(result.index.skills[0].license, "MIT");
  assert.ok(
    !fetchCalls.some((url) => url.includes("/main//LICENSE")),
    "Root license fetch should not contain a double slash",
  );
}

async function testSuppliedResourceKindsCoversIndexUpdaterImports() {
  const { resourceKindsModule } = createModule();
  const importedNames = collectResourceKindsImportNames();
  assert.ok(
    importedNames.length > 0,
    "src/indexUpdater.ts should import named bindings from ./resourceKinds",
  );
  const missing = importedNames.filter(
    (name) => resourceKindsModule[name] === undefined,
  );
  assert.deepStrictEqual(
    missing,
    [],
    `./resourceKinds supplied to src/indexUpdater.ts is missing: ${missing.join(", ")}`,
  );
}

async function testExternalRegistryParsersBuildNormalizedSkills() {
  const { moduleExports } = createModule();
  const searchResult = moduleExports.parseSearchIndex(
    {
      s: [
        {
          n: " Demo ",
          i: " skills/demo ",
          d: " Description ",
          c: "dev",
          g: ["one", 7, "two"],
          r: "<img src=https://example.test/x>",
        },
        { n: "Missing path" },
        "bad row",
      ],
    },
    "owner",
    "search-repo",
    "main",
  );
  assert.deepStrictEqual(
    { ...searchResult.skills[0] },
    {
      name: "Demo",
      source: "owner-search-repo",
      path: "skills/demo",
      categories: ["development", "one", "two"],
      description: "Description",
      stars: undefined,
    },
  );
  assert.strictEqual(searchResult.skills.length, 1);

  const registryResult = moduleExports.parseRegistryJson(
    {
      skills: [
        {
          name: " Registry Demo ",
          install_path: " registry/demo ",
          description: 42,
          category: "tools",
          tags: ["one", "one", "two"],
          stars: 9.8,
        },
        { name: [], path: "invalid" },
      ],
    },
    "owner",
    "registry-repo",
    "main",
  );
  assert.deepStrictEqual(
    { ...registryResult.skills[0] },
    {
      name: "Registry Demo",
      source: "owner-registry-repo",
      path: "registry/demo",
      categories: ["tools", "one", "two"],
      description: "",
      stars: 9,
    },
  );
  assert.strictEqual(registryResult.skills.length, 1);
}

async function main() {
  await testPrivateSourceUsesContentsFallback();
  await testPublicRawDoesNotAttachToken();
  await testFullUpdateStopsAfterRateLimit();
  await testSingleSourceProgressAdvancesAfterScan();
  await testRemoveSourceRemovesOnlyIndexedEntries();
  await testMutationBoundariesRejectMalformedIndexShape();
  await testSaveSkillIndexSyncsSharedStores();
  await testTruncatedTreeFailsExplicitly();
  await testRootResourceLicensePathIsNormalized();
  await testSuppliedResourceKindsCoversIndexUpdaterImports();
  await testExternalRegistryParsersBuildNormalizedSkills();
  console.log("PASS index updater private source auth");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
