#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = "C:\\workspace\\skills";
const join = (...parts) => path.win32.join(...parts);
const uri = (fsPath) => ({ fsPath });
const missing = () => Object.assign(new Error("not found"), { code: "ENOENT" });
const denied = () =>
  Object.assign(new Error("secret-token and private path"), { code: "EACCES" });

function fixture() {
  const dirs = new Map([
    [root, [["one", 2], ["two", 2]]],
    [join(root, "one"), []],
    [join(root, "two"), []],
  ]);
  const files = new Map([
    [join(root, "one", "SKILL.md"), "---\nname: one\n---\n"],
    [join(root, "one", ".skill-meta.json"), '{"name":"one","source":"upstream"}'],
    [join(root, "two", "SKILL.md"), "---\nname: two\n---\n"],
  ]);
  const failures = new Map();
  const calls = new Map();
  const fail = (operation, target) => {
    const key = `${operation}:${target}`;
    calls.set(key, (calls.get(key) || 0) + 1);
    const error = failures.get(key);
    if (error) throw error();
  };
  const vscode = {
    Uri: { joinPath: (base, ...parts) => uri(join(base.fsPath, ...parts)) },
    FileType: { Directory: 2 },
    workspace: {
      getConfiguration: () => ({}),
      fs: {
        stat: async ({ fsPath }) => {
          fail("stat", fsPath);
          if (!dirs.has(fsPath) && !files.has(fsPath)) throw missing();
          return {};
        },
        readDirectory: async ({ fsPath }) => {
          fail("directory", fsPath);
          if (!dirs.has(fsPath)) throw missing();
          return dirs.get(fsPath);
        },
        readFile: async ({ fsPath }) => {
          fail("read", fsPath);
          if (!files.has(fsPath)) throw missing();
          return Buffer.from(files.get(fsPath));
        },
      },
    },
  };
  const installerPath = path.join(__dirname, "..", "src", "skillInstaller.ts");
  const source = fs.readFileSync(installerPath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: installerPath,
  }).outputText;
  const loaded = new Module(installerPath, module);
  loaded.filename = installerPath;
  loaded.paths = Module._nodeModulePaths(path.dirname(installerPath));
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === "vscode") return vscode;
    if (request === "./skillIndex") return { RETIRED_SOURCE_ALIASES: {} };
    if (request === "./customizationPaths") {
      return { resolveSkillsDirectoryUri: () => uri(root) };
    }
    if (request.startsWith("./")) return {};
    return originalLoad(request, parent, isMain);
  };
  try {
    loaded._compile(output, installerPath);
  } finally {
    Module._load = originalLoad;
  }
  return { api: loaded.exports, dirs, files, failures, calls };
}

async function main() {
  const f = fixture();
  const scan = () => f.api.getInstalledSkillsWithMetaResultFromRoot(uri(root));
  const legacy = () => f.api.getInstalledSkillsWithMetaFromRoot(uri(root));
  const baseline = await scan();
  assert.equal(baseline.complete, true);
  assert.deepEqual(baseline.errors, []);
  assert.equal(baseline.errorCount, 0);
  assert.equal(baseline.metas.length, 2);
  assert.deepEqual(await legacy(), baseline.metas);
  assert.deepEqual(await f.api.getInstalledSkillsWithMetaResult(uri("C:\\workspace")), baseline);
  assert.deepEqual(await f.api.getInstalledSkillsWithMeta(uri("C:\\workspace")), baseline.metas);

  f.failures.set(`stat:${root}`, missing);
  assert.deepEqual(await scan(), { metas: [], complete: true, errors: [], errorCount: 0 });
  f.failures.set(`stat:${root}`, denied);
  assert.deepEqual(await scan(), { metas: [], complete: false, errors: ["root-stat"], errorCount: 1 });
  assert.deepEqual(await legacy(), []);
  f.failures.set(`stat:${root}`, () =>
    Object.assign(new Error("ENOENT in unrelated detail"), { code: "EACCES" }),
  );
  assert.deepEqual((await scan()).errors, ["root-stat"]);
  f.failures.clear();

  for (const [operation, target, expected] of [
    ["directory", root, "directory-read"],
    ["stat", join(root, "one"), "directory-stat"],
    ["directory", join(root, "one"), "directory-read"],
    ["stat", join(root, "one", "SKILL.md"), "skill-stat"],
    ["read", join(root, "one", ".skill-meta.json"), "metadata-read"],
    ["read", join(root, "two", "SKILL.md"), "skill-read"],
  ]) {
    f.failures.set(`${operation}:${target}`, denied);
    const result = await scan();
    assert.equal(result.complete, false, expected);
    assert.ok(result.errors.includes(expected), expected);
    assert.deepEqual(result.metas, await legacy(), expected);
    assert.ok(!JSON.stringify(result.errors).includes("secret"));
    f.failures.clear();
  }

  const meta = join(root, "one", ".skill-meta.json");
  f.files.set(meta, "{broken");
  const invalid = await scan();
  assert.equal(invalid.complete, false);
  assert.deepEqual(invalid.errors, ["metadata-invalid"]);
  assert.deepEqual(invalid.metas, await legacy());
  f.files.set(meta, '{"name":"one","source":"upstream"}');

  let directory = root;
  for (const name of ["one", "nested", "deeper", "limit"]) {
    f.dirs.set(directory, [[name, 2]]);
    directory = join(directory, name);
    if (!f.dirs.has(directory)) f.dirs.set(directory, []);
  }
  const limited = await scan();
  assert.equal(limited.complete, false);
  assert.deepEqual(limited.errors, ["depth-limit"]);
  assert.deepEqual(limited.metas, await legacy());

  const entries = Array.from({ length: 40 }, (_, i) => [`child${i}`, 2]);
  f.dirs.set(root, entries);
  for (const [name] of entries) {
    f.failures.set(`stat:${join(root, name, "SKILL.md")}`, denied);
    f.failures.set(`stat:${join(root, name)}`, denied);
  }
  const bounded = await scan();
  assert.equal(bounded.complete, false);
  assert.equal(bounded.errorCount, 80);
  assert.equal(bounded.errors.length, 32);
  assert.deepEqual(bounded.metas, await legacy());
  console.log("installed skill scan diagnostics: PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
