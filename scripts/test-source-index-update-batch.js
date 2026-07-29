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

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const root = path.join(__dirname, "..");
const githubResponseModule = requireTypeScriptModule(
  path.join(root, "src", "githubResponse.ts"),
);
const { runSourceIndexUpdateBatch } = requireTypeScriptModule(
  path.join(root, "src", "sourceIndexUpdateBatch.ts"),
  { "./githubResponse": githubResponseModule },
);

(async () => {
  await test("stops after rate limit and marks remaining sources skipped", async () => {
    const calls = [];
    const result = await runSourceIndexUpdateBatch(
      ["first", "second", "third"],
      [],
      async (value, entry) => {
        calls.push(entry);
        throw new githubResponseModule.GitHubResponseError(
          "rate-limit",
          403,
          "rate limit",
        );
      },
    );

    assert.deepStrictEqual(calls, ["first"]);
    assert.strictEqual(result.failures.length, 1);
    assert.deepStrictEqual(result.skipped, ["second", "third"]);
  });

  await test("continues after a source-specific failure", async () => {
    const calls = [];
    const result = await runSourceIndexUpdateBatch(
      ["first", "second", "third"],
      [],
      async (value, entry) => {
        calls.push(entry);
        if (entry === "second") {
          throw new Error("source failed");
        }
        return [...value, entry];
      },
    );

    assert.deepStrictEqual(calls, ["first", "second", "third"]);
    assert.deepStrictEqual(result.value, ["first", "third"]);
    assert.deepStrictEqual(result.succeeded, ["first", "third"]);
    assert.strictEqual(result.failures.length, 1);
    assert.deepStrictEqual(result.skipped, []);
  });

  console.log("Source index update batch tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
