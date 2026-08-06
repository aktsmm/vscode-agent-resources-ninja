#!/usr/bin/env node

// Guards the trust-on-first-use repository identity check and the source merge that
// keeps curated fields when a scan reports new repository facts.

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
const identity = requireTypeScriptModule(
  path.join(repoRoot, "src", "sourceUpdateReconcile.ts"),
);

test("a source without a recorded repository id is accepted", () => {
  identity.assertSourceRepositoryIdentity({
    sourceId: "acme-demo",
    actualRepoId: 4242,
  });
});

test("a matching repository id is accepted", () => {
  identity.assertSourceRepositoryIdentity({
    sourceId: "acme-demo",
    expectedRepoId: 4242,
    actualRepoId: 4242,
  });
});

test("a changed repository id is refused", () => {
  assert.throws(
    () =>
      identity.assertSourceRepositoryIdentity({
        sourceId: "acme-demo",
        sourceName: "Acme Demo Skills",
        expectedRepoId: 4242,
        actualRepoId: 9999,
      }),
    (error) => {
      assert.ok(identity.isSourceRepositoryChangedError(error));
      assert.strictEqual(error.sourceId, "acme-demo");
      assert.strictEqual(error.expectedRepoId, 4242);
      assert.strictEqual(error.actualRepoId, 9999);
      assert.ok(error.message.includes("Acme Demo Skills"));
      return true;
    },
  );
});

test("an explicit approval allows the repository change", () => {
  identity.assertSourceRepositoryIdentity({
    sourceId: "acme-demo",
    expectedRepoId: 4242,
    actualRepoId: 9999,
    allowRepositoryChange: true,
  });
});

test("an unavailable repository id leaves the check disabled", () => {
  identity.assertSourceRepositoryIdentity({
    sourceId: "acme-demo",
    expectedRepoId: 4242,
    actualRepoId: undefined,
  });
});

test("a rename keeps the same repository id and is accepted", () => {
  identity.assertSourceRepositoryIdentity({
    sourceId: "acme-old-name",
    expectedRepoId: 4242,
    actualRepoId: 4242,
  });

  const merged = identity.mergeScannedSource(
    {
      id: "acme-old-name",
      name: "Acme Curated Name",
      url: "https://github.com/acme/old-name",
      type: "preset",
      repoId: 4242,
      description: "Curated description",
      description_ja: "キュレーション済みの説明",
      includePaths: ["skills/"],
      excludePaths: ["tmp/"],
      branch: "release",
    },
    {
      id: "acme-new-name",
      name: "new-name",
      url: "https://github.com/acme/new-name",
      type: "user-added",
      repoId: 4242,
      description: "User added repository: acme/new-name",
      branch: "main",
    },
  );

  assert.strictEqual(
    merged.id,
    "acme-old-name",
    "a scan must not re-key a source",
  );
  assert.strictEqual(merged.url, "https://github.com/acme/new-name");
  assert.strictEqual(merged.name, "Acme Curated Name");
  assert.strictEqual(merged.type, "preset");
  assert.strictEqual(merged.description, "Curated description");
  assert.strictEqual(merged.description_ja, "キュレーション済みの説明");
  assert.strictEqual(merged.branch, "release");
  assert.deepStrictEqual(merged.includePaths, ["skills/"]);
  assert.deepStrictEqual(merged.excludePaths, ["tmp/"]);
});

test("a first scan records the repository id", () => {
  const merged = identity.mergeScannedSource(
    {
      id: "acme-demo",
      name: "Acme Demo",
      url: "https://github.com/acme/demo",
      type: "preset",
      description: "Curated description",
    },
    {
      id: "acme-demo",
      name: "demo",
      url: "https://github.com/acme/demo",
      type: "user-added",
      repoId: 4242,
      description: "User added repository: acme/demo",
    },
  );

  assert.strictEqual(merged.repoId, 4242);
});

test("a scan without a repository id keeps the recorded one", () => {
  const merged = identity.mergeScannedSource(
    {
      id: "acme-demo",
      name: "Acme Demo",
      url: "https://github.com/acme/demo",
      type: "preset",
      repoId: 4242,
      description: "Curated description",
    },
    {
      id: "acme-demo",
      name: "demo",
      url: "https://github.com/acme/demo",
      type: "user-added",
      description: "User added repository: acme/demo",
    },
  );

  assert.strictEqual(merged.repoId, 4242);
});

console.log("\nAll source repository identity tests passed.");
