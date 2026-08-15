#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

function requireTypeScriptModule(filePath) {
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
  loadedModule._compile(transpiled.outputText, filePath);
  return loadedModule.exports;
}

const repoRoot = path.join(__dirname, "..");
const {
  normalizeIndexTags,
  normalizeIndexText,
  normalizeRegistryIndexRow,
  normalizeSearchIndexRow,
  normalizeStarCount,
} = requireTypeScriptModule(
  path.join(repoRoot, "src", "indexDataNormalization.ts"),
);

assert.strictEqual(normalizeIndexText("  hello  "), "hello");
assert.strictEqual(normalizeIndexText({ toString: () => "<img>" }), "");
assert.strictEqual(normalizeIndexText("abcdef", 3), "abc");
assert.deepStrictEqual(
  normalizeIndexTags([" one ", "one", 42, "two", "three"], 2),
  ["one", "two"],
);
assert.strictEqual(normalizeStarCount(123.9), 123);
assert.strictEqual(
  normalizeStarCount("<img src=https://example.test/x>"),
  undefined,
);
assert.strictEqual(normalizeStarCount(Number.NaN), undefined);
assert.strictEqual(normalizeStarCount(-1), undefined);
assert.strictEqual(normalizeStarCount(2_000_000_000), 1_000_000_000);

assert.deepStrictEqual(
  normalizeSearchIndexRow(
    {
      n: " Demo ",
      i: " skills/demo ",
      d: " Description ",
      c: "dev",
      g: ["one", 7, "two", "three", "four"],
      r: 42.9,
    },
    { dev: "development" },
  ),
  {
    name: "Demo",
    path: "skills/demo",
    description: "Description",
    categories: ["development", "one", "two", "three"],
    stars: 42,
  },
);
assert.strictEqual(normalizeSearchIndexRow("bad", {}), undefined);
assert.strictEqual(normalizeSearchIndexRow({ n: "Demo" }, {}), undefined);
assert.deepStrictEqual(
  normalizeRegistryIndexRow({
    name: "Registry Demo",
    install_path: "registry/demo",
    description: 42,
    category: "tools",
    tags: ["one", "one", "two"],
    stars: "<img>",
  }),
  {
    name: "Registry Demo",
    path: "registry/demo",
    description: "",
    categories: ["tools", "one", "two"],
    stars: undefined,
  },
);
assert.strictEqual(normalizeRegistryIndexRow({ name: [] }), undefined);

const updaterSource = fs.readFileSync(
  path.join(repoRoot, "src", "indexUpdater.ts"),
  "utf8",
);
function functionSlice(name, nextName) {
  const start = updaterSource.indexOf(`function ${name}(`);
  const end = updaterSource.indexOf(`function ${nextName}(`, start + 1);
  assert.ok(start >= 0 && end > start, `Could not isolate ${name}`);
  return updaterSource.slice(start, end);
}

for (const body of [
  functionSlice("parseSearchIndex", "parseRegistryJson"),
  functionSlice("parseRegistryJson", "parseSkillFrontmatter"),
]) {
  assert.match(body, /normalize(?:Search|Registry)IndexRow/);
  assert.doesNotMatch(body, /stars:\s*item\.(?:r|stars)\b/);
}

const previewSource = fs.readFileSync(
  path.join(repoRoot, "src", "skillPreview.ts"),
  "utf8",
);
assert.match(
  previewSource,
  /normalizeStarCount\(skill\.stars\)[\s\S]*?escapeHtml\(normalizedStars\.toLocaleString\(\)\)/,
);
assert.doesNotMatch(previewSource, /skill\.stars\.toLocaleString\(\)/);

console.log("RESULT=PASS");
