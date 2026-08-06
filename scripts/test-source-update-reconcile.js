#!/usr/bin/env node

// Guards the empty-scan reconcile rules: a successful scan that returns nothing
// must not silently wipe an existing source index unless the caller opts in.

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
const reconcile = requireTypeScriptModule(
  path.join(repoRoot, "src", "sourceUpdateReconcile.ts"),
);

const existingSkills = [
  { kind: "skill", name: "alpha", source: "acme-demo", path: "skills/alpha" },
  { kind: "skill", name: "beta", source: "acme-demo", path: "skills/beta" },
];
const existingBundles = [{ id: "core", name: "Core", source: "acme-demo" }];

test("an empty scan keeps the existing resources", () => {
  const result = reconcile.reconcileSourceScanResult({
    existingSkills,
    scannedSkills: [],
    existingBundles,
    scannedBundles: [],
  });

  assert.strictEqual(result.keptExisting, true);
  assert.deepStrictEqual(
    result.skills.map((skill) => skill.name),
    ["alpha", "beta"],
  );
  assert.deepStrictEqual(
    result.bundles.map((bundle) => bundle.id),
    ["core"],
  );
});

test("allowEmptyResult lets the index shrink to zero", () => {
  const result = reconcile.reconcileSourceScanResult({
    existingSkills,
    scannedSkills: [],
    existingBundles,
    scannedBundles: [],
    allowEmptyResult: true,
  });

  assert.strictEqual(result.keptExisting, false);
  assert.deepStrictEqual(result.skills, []);
  assert.deepStrictEqual(result.bundles, []);
});

test("a source with no indexed resources may stay empty", () => {
  const result = reconcile.reconcileSourceScanResult({
    existingSkills: [],
    scannedSkills: [],
  });

  assert.strictEqual(result.keptExisting, false);
  assert.deepStrictEqual(result.skills, []);
});

test("a non-empty scan replaces the existing resources", () => {
  const scannedSkills = [
    { kind: "skill", name: "gamma", source: "acme-demo", path: "skills/gamma" },
  ];
  const result = reconcile.reconcileSourceScanResult({
    existingSkills,
    scannedSkills,
    existingBundles,
    scannedBundles: [],
  });

  assert.strictEqual(result.keptExisting, false);
  assert.deepStrictEqual(
    result.skills.map((skill) => skill.name),
    ["gamma"],
  );
  assert.deepStrictEqual(result.bundles, []);
});

test("the reconciled arrays are copies of the inputs", () => {
  const scannedSkills = [
    { kind: "skill", name: "gamma", source: "acme-demo", path: "skills/gamma" },
  ];
  const result = reconcile.reconcileSourceScanResult({
    existingSkills,
    scannedSkills,
  });

  result.skills.push({ name: "injected" });
  assert.strictEqual(scannedSkills.length, 1);
  assert.strictEqual(existingSkills.length, 2);
});

test("the empty-scan error is identifiable and names the source", () => {
  const error = reconcile.createEmptySourceScanError(
    "acme-demo",
    "Acme Demo Skills",
  );

  assert.ok(reconcile.isEmptySourceScanError(error));
  assert.strictEqual(error.sourceId, "acme-demo");
  assert.ok(error.message.includes("Acme Demo Skills"));
  assert.strictEqual(
    reconcile.isEmptySourceScanError(new Error("nope")),
    false,
  );
});

console.log("\nAll source update reconcile tests passed.");
