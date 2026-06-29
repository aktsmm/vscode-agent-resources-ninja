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

function createModule() {
  const writes = [];
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

  const moduleExports = requireTypeScriptModule(
    path.join(__dirname, "..", "src", "indexUpdater.ts"),
    {
      vscode: vscodeStub,
      "./skillIndex": {
        getResourceKind: (resource) => resource.kind || "skill",
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
      "./resourceKinds": {
        detectResourceKindFromPath: (filePath) => {
          const lower = filePath.toLowerCase();
          if (lower.endsWith("/skill.md")) return "skill";
          if (lower.endsWith(".agent.md")) return "agent";
          if (lower.endsWith(".prompt.md")) return "prompt";
          if (lower.endsWith(".instructions.md")) return "instruction";
          if (lower.endsWith("/readme.md") && lower.includes("hooks/")) {
            return "hook";
          }
          if (lower.endsWith(".json") && lower.includes("mcp")) return "mcp";
          if (lower.endsWith("plugin.json")) return "plugin";
          return undefined;
        },
        getDefaultResourceCategories: (kind) => [kind || "skill"],
        getFallbackResourceName: (filePath) =>
          path.basename(path.dirname(filePath)) || path.basename(filePath),
        getPluginIdFromPath: () => undefined,
        getPluginRootFromManifestPath: () => undefined,
        getResourceInstallPath: (filePath) =>
          filePath.endsWith("/SKILL.md")
            ? filePath.replace(/\/SKILL\.md$/i, "")
            : filePath,
        getSkillRootDirectoriesFromPaths: (paths) =>
          paths
            .filter((filePath) => filePath.toLowerCase().endsWith("/skill.md"))
            .map((filePath) => filePath.replace(/\/SKILL\.md$/i, "")),
        isNestedResourcePathUnderSkillRoot: () => false,
      },
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
    },
  );

  return { moduleExports, writes };
}

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
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

async function main() {
  await testPrivateSourceUsesContentsFallback();
  await testPublicRawDoesNotAttachToken();
  await testRemoveSourceRemovesOnlyIndexedEntries();
  await testMutationBoundariesRejectMalformedIndexShape();
  await testSaveSkillIndexSyncsSharedStores();
  await testTruncatedTreeFailsExplicitly();
  await testRootResourceLicensePathIsNormalized();
  console.log("PASS index updater private source auth");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
