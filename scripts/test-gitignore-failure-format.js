#!/usr/bin/env node

// Guards the Gitignore failure notice: it must name the cause and the folder, and
// every cause the synchronizer can report needs wording in both languages.

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

const manager = requireTypeScriptModule(
  path.join(srcDir, "gitignoreManager.ts"),
  {
    "./logger": {
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    },
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

const source = fs.readFileSync(
  path.join(srcDir, "gitignoreManager.ts"),
  "utf8",
);
const reasonUnion = source.match(/reason\?:([^;]+);/);
const reasons = Array.from(reasonUnion[1].matchAll(/"([a-z-]+)"/g)).map(
  (match) => match[1],
);

test("every reason the synchronizer reports has wording in both languages", () => {
  assert.ok(reasons.length >= 10, "the reason union should be found");
  for (const reason of reasons) {
    for (const japanese of [true, false]) {
      const text = manager.formatGitignoreFailure(
        { reason },
        { rootLabel: "C:\\ws\\skills", japanese },
      );
      assert.ok(!text.includes("undefined"), `${reason} (${japanese})`);
      assert.ok(text.includes("C:\\ws\\skills"), "the folder is named");
    }
  }
});

test("the lock notice names the lock file and never asks for a silent delete", () => {
  const text = manager.formatGitignoreFailure(
    { reason: "busy" },
    { rootLabel: "skills", japanese: false },
  );

  assert.ok(text.includes(manager.GITIGNORE_LOCK_NAME));
  assert.match(text, /delete it manually only if it remains/);
});

test("a cleanup failure is worded apart from a synchronization failure", () => {
  const sync = manager.formatGitignoreFailure(
    { reason: "io-failure" },
    { rootLabel: "skills", japanese: false },
  );
  const cleanup = manager.formatGitignoreFailure(
    { reason: "io-failure", cleanup: true },
    { rootLabel: "skills", japanese: false },
  );

  assert.match(sync, /synchronization could not finish/);
  assert.match(cleanup, /exclusions may remain/);
  assert.notStrictEqual(sync, cleanup);
});

test("a leftover temporary file or lock is reported with the cause", () => {
  const text = manager.formatGitignoreFailure(
    { reason: "io-failure", warning: "cleanup-failed" },
    { rootLabel: "skills", japanese: true },
  );

  assert.match(text, /一時ファイルまたはロックを削除できませんでした/);
  assert.match(text, /権限や OneDrive/);
});

test("a warning without a reason still produces a complete sentence", () => {
  const text = manager.formatGitignoreFailure(
    { warning: "cleanup-failed" },
    { rootLabel: "skills", japanese: false },
  );

  assert.match(text, /Cause: a temporary file or lock could not be removed/);
});

test("the notice shows the cause and offers the lock file only when it is busy", () => {
  const extension = fs.readFileSync(path.join(srcDir, "extension.ts"), "utf8");

  assert.match(extension, /formatGitignoreFailure\(result, \{/);
  assert.match(
    extension,
    /result\.reason === "busy"\s*\? \[details, showLock, showFolder\]/,
  );
  assert.match(extension, /GITIGNORE_LOCK_NAME\)/);
});

console.log("\nAll gitignore failure format tests passed.");
