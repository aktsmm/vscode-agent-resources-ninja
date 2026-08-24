#!/usr/bin/env node

// Every command path calls loadSkillIndex, and the bundled index cannot change
// while the host runs, so it must be parsed once rather than on every call.

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");

function requireTypeScriptModule(filePath, stubs = {}) {
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  });
  const loaded = new Module(filePath, module);
  loaded.filename = filePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(filePath));
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) =>
    Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad(request, parent, isMain);
  try {
    loaded._compile(transpiled.outputText, filePath);
  } finally {
    Module._load = originalLoad;
  }
  return loaded.exports;
}

const reads = [];
const bundledStat = { mtime: 1, size: 10 };
let failBundledRead = false;

function makeUri(label) {
  return { label, toString: () => label };
}

const vscodeStub = {
  Uri: {
    joinPath: (base, ...segments) =>
      makeUri(`${base.label}/${segments.join("/")}`),
  },
  workspace: {
    fs: {
      readFile: async (uri) => {
        reads.push(String(uri));
        if (String(uri).includes("globalStorage")) {
          const error = new Error("no local index");
          error.code = "FileNotFound";
          throw error;
        }
        if (failBundledRead) {
          throw new Error("transient bundle read failure");
        }
        return Buffer.from(
          JSON.stringify({
            version: "1.0.0",
            sources: [
              { id: "bundled", name: "Bundled", url: "", type: "github" },
            ],
            skills: [
              {
                name: "bundled-skill",
                description: "from the bundle",
                source: "bundled",
                path: "skills/bundled-skill",
              },
            ],
          }),
          "utf-8",
        );
      },
      writeFile: async () => undefined,
      createDirectory: async () => undefined,
      stat: async (uri) =>
        String(uri).startsWith("extension/") ? { ...bundledStat } : {},
    },
  },
  env: { language: "en" },
};

const skillIndexModule = requireTypeScriptModule(
  path.join(repoRoot, "src", "skillIndex.ts"),
  {
    vscode: vscodeStub,
    "./gitHubRefSafety": requireTypeScriptModule(
      path.join(repoRoot, "src", "gitHubRefSafety.ts"),
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
    "./sharedResourceIndexStore": {
      loadSharedStoresIntoSkillIndex: async (_context, index) => index,
      syncSharedStoresFromSkillIndex: async () => undefined,
    },
  },
);

const { loadSkillIndex, resetBundledSkillIndexCache } = skillIndexModule;

const context = {
  globalStorageUri: makeUri("globalStorage"),
  extensionUri: makeUri("extension"),
};

const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}: ${error && error.message}`);
  }
}

function bundledReadCount() {
  return reads.filter((entry) => entry.startsWith("extension/")).length;
}

async function main() {
  await test("the bundled index is read once across repeated loads", async () => {
    resetBundledSkillIndexCache();
    reads.length = 0;
    await loadSkillIndex(context);
    const afterFirst = bundledReadCount();
    assert.strictEqual(afterFirst, 1, "the first load must read the bundle");
    await loadSkillIndex(context);
    await loadSkillIndex(context);
    assert.strictEqual(
      bundledReadCount(),
      1,
      `the bundle was re-read: ${JSON.stringify(reads)}`,
    );
  });

  await test("clearing the cache makes the next load read again", async () => {
    resetBundledSkillIndexCache();
    reads.length = 0;
    await loadSkillIndex(context);
    resetBundledSkillIndexCache();
    await loadSkillIndex(context);
    assert.strictEqual(bundledReadCount(), 2);
  });

  await test("a caller cannot mutate the cached bundle for the next caller", async () => {
    resetBundledSkillIndexCache();
    const first = await loadSkillIndex(context);
    const bundledSkill = first.skills.find(
      (skill) => skill.name === "bundled-skill",
    );
    assert.ok(bundledSkill, "the stub bundle must reach the merged index");
    bundledSkill.description = "mutated by a caller";
    first.skills.push({ name: "injected", source: "bundled", path: "x" });

    const second = await loadSkillIndex(context);
    const secondSkill = second.skills.find(
      (skill) => skill.name === "bundled-skill",
    );
    assert.strictEqual(secondSkill.description, "from the bundle");
    assert.ok(!second.skills.some((skill) => skill.name === "injected"));
  });

  await test("a burst of callers shares one read of the bundle", async () => {
    resetBundledSkillIndexCache();
    reads.length = 0;
    await Promise.all([
      loadSkillIndex(context),
      loadSkillIndex(context),
      loadSkillIndex(context),
    ]);
    assert.strictEqual(
      bundledReadCount(),
      1,
      `concurrent callers each parsed the bundle: ${JSON.stringify(reads)}`,
    );
  });

  await test("a rebuilt bundle is picked up without a reload", async () => {
    resetBundledSkillIndexCache();
    reads.length = 0;
    await loadSkillIndex(context);
    bundledStat.mtime += 1;
    await loadSkillIndex(context);
    assert.strictEqual(bundledReadCount(), 2);
    await loadSkillIndex(context);
    assert.strictEqual(bundledReadCount(), 2, "the new stamp must cache too");
  });

  await test("a failed read is retried instead of becoming the answer", async () => {
    resetBundledSkillIndexCache();
    reads.length = 0;
    failBundledRead = true;
    const failed = await loadSkillIndex(context);
    assert.ok(
      !failed.skills.some((skill) => skill.name === "bundled-skill"),
      "the failing read must not produce bundled entries",
    );
    failBundledRead = false;
    const recovered = await loadSkillIndex(context);
    assert.ok(
      recovered.skills.some((skill) => skill.name === "bundled-skill"),
      "the next load must read the bundle again rather than reuse the failure",
    );
  });

  if (failures.length > 0) {
    console.log("RESULT=FAIL");
    process.exitCode = 1;
    return;
  }
  console.log("RESULT=PASS");
}

void main();
