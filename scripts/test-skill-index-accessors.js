#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const os = require("os");
const path = require("path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");

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

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function makeUri(fsPath) {
  return {
    fsPath,
    toString() {
      return fsPath;
    },
  };
}

function makeVscodeStub() {
  return {
    workspace: {
      fs: {
        readFile: async (uri) => fs.promises.readFile(uri.fsPath),
        writeFile: async (uri, content) =>
          fs.promises.writeFile(uri.fsPath, content),
        createDirectory: async (uri) =>
          fs.promises.mkdir(uri.fsPath, { recursive: true }),
      },
    },
    Uri: {
      joinPath: (base, ...segments) =>
        makeUri(path.join(base.fsPath, ...segments)),
    },
  };
}

const skillIndex = requireTypeScriptModule(
  path.join(repoRoot, "src", "skillIndex.ts"),
  {
    vscode: {
      workspace: {
        fs: {},
      },
      Uri: {
        joinPath: (...parts) => ({ parts }),
      },
    },
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
      syncSharedStoresFromSkillIndex: async () => undefined,
    },
  },
);

async function main() {
  await test("safe index accessors return empty arrays for missing index", () => {
    assert.deepStrictEqual(skillIndex.getIndexResources(undefined), []);
    assert.deepStrictEqual(skillIndex.getIndexSources(undefined), []);
    assert.deepStrictEqual(skillIndex.getIndexCategories(undefined), []);
    assert.deepStrictEqual(skillIndex.getIndexBundles(undefined), []);
  });

  await test("safe index accessors return empty arrays for malformed fields", () => {
    const malformed = {
      skills: "not-array",
      sources: null,
      categories: { 0: { id: "bad" } },
      bundles: 42,
    };

    assert.deepStrictEqual(skillIndex.getIndexResources(malformed), []);
    assert.deepStrictEqual(skillIndex.getIndexSources(malformed), []);
    assert.deepStrictEqual(skillIndex.getIndexCategories(malformed), []);
    assert.deepStrictEqual(skillIndex.getIndexBundles(malformed), []);
  });

  await test("safe index accessors preserve valid arrays", () => {
    const resource = {
      name: "sample-resource",
      source: "sample-source",
      path: "resources/sample-resource",
      categories: ["sample"],
      description: "Sample resource",
    };
    const source = {
      id: "sample-source",
      name: "Sample Source",
      url: "https://github.com/example/sample-source",
      type: "community",
      description: "Sample source",
    };
    const category = {
      id: "sample",
      name: "Sample",
      description: "Sample category",
    };
    const bundle = {
      id: "sample-bundle",
      name: "Sample Bundle",
      source: "sample-source",
      description: "Sample bundle",
      skills: ["sample-resource"],
    };

    const index = {
      skills: [resource],
      sources: [source],
      categories: [category],
      bundles: [bundle],
    };

    assert.deepStrictEqual(skillIndex.getIndexResources(index), [resource]);
    assert.deepStrictEqual(skillIndex.getIndexSources(index), [source]);
    assert.deepStrictEqual(skillIndex.getIndexCategories(index), [category]);
    assert.deepStrictEqual(skillIndex.getIndexBundles(index), [bundle]);
  });

  await test("loadSkillIndex recovers from malformed local index and logs diagnostics", async () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "resource-index-load-"),
    );
    const extensionRoot = path.join(tempRoot, "extension");
    const globalStorageRoot = path.join(tempRoot, "global-storage");
    fs.mkdirSync(path.join(extensionRoot, "resources"), { recursive: true });
    fs.mkdirSync(globalStorageRoot, { recursive: true });

    const bundledIndex = {
      version: "1.2.0",
      lastUpdated: "2026-06-30",
      sources: [
        {
          id: "bundled-source",
          name: "Bundled Source",
          url: "https://github.com/example/bundled-source",
          type: "official",
          description: "Bundled source",
        },
      ],
      skills: [
        {
          name: "bundled-resource",
          source: "bundled-source",
          path: "skills/bundled-resource",
          categories: ["sample"],
          description: "Bundled resource",
        },
      ],
      categories: [
        {
          id: "sample",
          name: "Sample",
          description: "Sample category",
        },
      ],
      bundles: [],
    };
    const malformedLocalIndex = {
      version: "9.9.9",
      lastUpdated: "2026-06-29",
      sources: "not-array",
      skills: "not-array",
      categories: "not-array",
      bundles: "not-array",
    };

    fs.writeFileSync(
      path.join(extensionRoot, "resources", "skill-index.json"),
      `${JSON.stringify(bundledIndex, null, 2)}\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(globalStorageRoot, "skill-index.json"),
      `${JSON.stringify(malformedLocalIndex, null, 2)}\n`,
      "utf8",
    );

    const warnings = [];
    const moduleWithFs = requireTypeScriptModule(
      path.join(repoRoot, "src", "skillIndex.ts"),
      {
        vscode: makeVscodeStub(),
        "./githubFetch": {
          createGitHubHeaders: () => ({}),
          fetchGitHubWithOptionalAuthRetry: async () => ({ ok: false }),
        },
        "./logger": {
          logger: {
            info: () => undefined,
            warn: (message) => warnings.push(String(message)),
            error: () => undefined,
          },
        },
        "./sharedResourceIndexStore": {
          loadSharedStoresIntoSkillIndex: async (_context, index) => index,
          syncSharedStoresFromSkillIndex: async () => undefined,
        },
      },
    );

    try {
      const loaded = await moduleWithFs.loadSkillIndex({
        extensionUri: makeUri(extensionRoot),
        globalStorageUri: makeUri(globalStorageRoot),
      });

      assert.deepStrictEqual(
        moduleWithFs.getIndexResources(loaded).map((resource) => resource.name),
        ["bundled-resource"],
      );
      assert.deepStrictEqual(
        moduleWithFs.getIndexSources(loaded).map((source) => source.id),
        ["bundled-source"],
      );
      assert.ok(
        warnings.some((message) =>
          message.includes('field "skills" is not an array'),
        ),
        "expected malformed skills diagnostic",
      );
      assert.ok(
        warnings.some((message) =>
          message.includes('field "sources" is not an array'),
        ),
        "expected malformed sources diagnostic",
      );
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  console.log("RESULT=PASS");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
