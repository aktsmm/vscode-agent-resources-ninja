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

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const root = path.join(__dirname, "..");
const {
  selectResource,
  normalizeSelectorSource,
  normalizeSelectorPath,
  toSelectorText,
  findUnknownKind,
} = requireTypeScriptModule(path.join(root, "src", "mcpResourceSelection.ts"));

const getPath = (resource) => resource.path;
const pub = { name: "review", source: "Acme/Public", path: "skills/review" };
const priv = { name: "review", source: "acme/private", path: "skills/review" };
const other = { name: "review-helper", source: "acme/public", path: "skills/review-helper" };
const agent = { name: "review", kind: "agent", source: "acme/public", path: "agents/review.md" };
const all = [pub, priv, other, agent];

test("same name in two sources is ambiguous and never picks the first", () => {
  const result = selectResource(all, { name: "review", kind: "skill" }, getPath);
  assert.strictEqual(result.match, undefined);
  assert.strictEqual(result.reason, "ambiguous");
  assert.deepStrictEqual(result.candidates, [pub, priv]);
});

test("source disambiguates, case and URL form insensitive", () => {
  const result = selectResource(
    all,
    { name: "review", kind: "skill", source: "https://github.com/ACME/private.git" },
    getPath,
  );
  assert.strictEqual(result.match, priv);
});

test("path selects exactly one resource without a name", () => {
  const result = selectResource(all, { path: ".\\agents\\review.md\\" }, getPath);
  assert.strictEqual(result.match, agent);
});

test("name plus path that disagree matches nothing", () => {
  const result = selectResource(all, { name: "other", path: "skills/review" }, getPath);
  assert.strictEqual(result.match, undefined);
  assert.strictEqual(result.reason, "missing");
});

test("a unique partial name is a suggestion, not a match", () => {
  const result = selectResource(all, { name: "helper" }, getPath);
  assert.strictEqual(result.match, undefined);
  assert.strictEqual(result.reason, "missing");
  assert.deepStrictEqual(result.candidates, [other]);
});

test("empty selector and non-string input are rejected", () => {
  assert.strictEqual(selectResource(all, {}, getPath).reason, "empty");
  assert.strictEqual(toSelectorText(42), "");
  assert.strictEqual(normalizeSelectorSource(undefined), "");
  assert.strictEqual(normalizeSelectorPath(null), "");
});

test("a skill is selected by its folder or its SKILL.md path", () => {
  const skill = { name: "x", source: "a/b", path: "skills/x/SKILL.md" };
  for (const p of ["skills/x", "skills/x/SKILL.md", ".\\Skills\\X\\skill.md"]) {
    assert.strictEqual(selectResource([skill], { path: p }, getPath).match, skill, p);
  }
  const multi = selectResource(
    [{ name: "x", source: "a/b", path: "rel/x" }],
    { path: "/abs/x" },
    () => ["rel/x", "/abs/x"],
  );
  assert.ok(multi.match, "any listed path may match");
});

test("findUnknownKind reports only set-but-unknown kinds", () => {
  const known = ["skill", "agent"];
  assert.strictEqual(findUnknownKind(undefined, known), undefined);
  assert.strictEqual(findUnknownKind("", known), undefined);
  assert.strictEqual(findUnknownKind("ALL", known), undefined);
  assert.strictEqual(findUnknownKind(" Agent ", known), undefined);
  assert.strictEqual(findUnknownKind("agents", known), "agents");
  assert.strictEqual(findUnknownKind(7, known), undefined);
});

test("language model tools expose and use the selector ids", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const tools = pkg.contributes.languageModelTools;
  const install = tools.find((tool) => tool.name === "resourceNinja_install");
  const uninstall = tools.find((tool) => tool.name === "resourceNinja_uninstall");
  for (const key of ["source", "path", "overwrite"]) {
    assert.ok(install.inputSchema.properties[key], `install.${key}`);
  }
  assert.ok(uninstall.inputSchema.properties.path, "uninstall.path");
  const source = fs.readFileSync(path.join(root, "src", "mcpTools.ts"), "utf8");
  assert.match(source, /from "\.\/mcpResourceSelection"/);
  assert.match(source, /options\.input\.overwrite !== true/);
  assert.match(source, /verifyInstalledDestination/);
  assert.match(source, /installResult\.destinationUri/);
  assert.doesNotMatch(source, /partialResourceMatches/);

  const chat = fs.readFileSync(path.join(root, "src", "chatParticipant.ts"), "utf8");
  assert.match(chat, /selectResource\(/);
  assert.doesNotMatch(chat, /partialMatches/);
  assert.doesNotMatch(source, /getIndexResources\(index\)\.find\(/);

  const localize = tools.find((tool) => tool.name === "resourceNinja_localize");
  for (const key of ["kind", "source", "path"]) {
    assert.ok(localize.inputSchema.properties[key], `localize.${key}`);
  }
  for (const file of ["README.md", "README_ja.md"]) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(text, /overwrite: true/, `${file} documents overwrite`);
    assert.match(text, /`source` と `path`|`source` and `path`/, `${file} documents ids`);
  }
});
