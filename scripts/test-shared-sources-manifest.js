#!/usr/bin/env node

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

async function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "resource-ninja-sources-"),
  );
  const manifestPath = path.join(tempDir, "sources.json");

  const sharedManifestStub = {
    SHARED_MANIFEST_SCHEMA_VERSION: 1,
    SHARED_SOURCES_MANIFEST_TEMP_FILE: "sources.json.tmp",
    getAgentNinjaSharedDirectoryPath: () => tempDir,
    getSharedSourcesManifestUri: () => ({ fsPath: manifestPath }),
    createEmptySharedSourcesManifest: (updatedBy) => ({
      schemaVersion: 1,
      sources: [],
      lastUpdated: new Date().toISOString(),
      updatedBy,
    }),
  };

  const moduleExports = requireTypeScriptModule(
    path.join(repoRoot, "src", "sharedSourcesManifestStore.ts"),
    {
      vscode: {
        workspace: {
          fs: {
            readFile: async (uri) => fs.promises.readFile(uri.fsPath),
          },
        },
      },
      "./coexistence": { SELF_EXTENSION_ID: "yamapan.agent-resources-ninja" },
      "./sharedManifest": sharedManifestStub,
      "./logger": { logger: { warn: () => undefined } },
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
    branch: "main",
    description: "Source A",
    description_ja: "ソースA",
    includePaths: ["skills/"],
    excludePaths: ["tmp/"],
    lastIndexedAt: "2026-06-24T12:00:00.000Z",
  };

  await moduleExports.writeSharedSourcesManifest({
    schemaVersion: 1,
    sources: [source],
    lastUpdated: "2026-06-24T12:01:00.000Z",
    updatedBy: "test",
  });

  const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.strictEqual(raw.sources[0].lastIndexedAt, source.lastIndexedAt);

  const readBack = await moduleExports.readSharedSourcesManifest();
  assert.strictEqual(readBack.sources[0].lastIndexedAt, source.lastIndexedAt);
  assert.deepStrictEqual(readBack.sources[0].includePaths, ["skills/"]);
  assert.deepStrictEqual(readBack.sources[0].excludePaths, ["tmp/"]);

  fs.rmSync(tempDir, { recursive: true, force: true });
}

main()
  .then(() => {
    console.log("PASS shared sources manifest preserves lastIndexedAt");
    console.log("RESULT=PASS");
  })
  .catch((error) => {
    console.error("FAIL shared sources manifest preserves lastIndexedAt");
    throw error;
  });
