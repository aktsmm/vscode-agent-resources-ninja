#!/usr/bin/env node

// The index is read from files another writer can change (local cache, bundled
// catalog, a sibling's shared index). A mistyped field in one entry must not stop
// a search or a listing for every other resource.

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

let localIndexText = "";
let sharedSkills = null;
const written = [];
const makeUri = (label) => ({ label, toString: () => label });

const vscodeStub = {
  Uri: {
    joinPath: (base, ...segments) =>
      makeUri(`${base.label}/${segments.join("/")}`),
  },
  workspace: {
    fs: {
      readFile: async (uri) => {
        if (String(uri).includes("globalStorage")) {
          return Buffer.from(localIndexText, "utf-8");
        }
        return Buffer.from(
          JSON.stringify({ version: "1.0.0", sources: [], skills: [] }),
          "utf-8",
        );
      },
      writeFile: async (_uri, data) => written.push(Buffer.from(data).toString("utf-8")),
      createDirectory: async () => undefined,
      stat: async () => ({ mtime: 1, size: 1 }),
    },
  },
  env: { language: "en" },
};

const skillIndex = requireTypeScriptModule(
  path.join(repoRoot, "src", "skillIndex.ts"),
  {
    vscode: vscodeStub,
    "./gitHubRefSafety": requireTypeScriptModule(
      path.join(repoRoot, "src", "gitHubRefSafety.ts"),
    ),
    "./githubFetch": { fetchGitHubWithOptionalAuthRetry: async () => undefined },
    "./logger": { logger: { info() {}, warn() {}, error() {} } },
    "./retiredSources": requireTypeScriptModule(
      path.join(repoRoot, "src", "retiredSources.ts"),
    ),
    "./sharedResourceIndexStore": {
      loadSharedStoresIntoSkillIndex: async (_context, index) =>
        sharedSkills ? { ...index, skills: sharedSkills } : index,
      syncSharedStoresFromSkillIndex: async () => undefined,
    },
  },
);
const { sanitizeIndexResource, sanitizeIndexResources, loadSkillIndex } =
  skillIndex;

const context = {
  globalStorageUri: makeUri("globalStorage"),
  extensionUri: makeUri("extension"),
};

const good = {
  name: "ok",
  source: "acme/repo",
  path: "skills/ok",
  description: "fine",
  categories: ["a"],
};
const malformed = [
  { ...good, name: "desc-number", description: 42 },
  { ...good, name: "desc-object", description: { en: "x" } },
  { ...good, name: "cats-string", categories: "github" },
  { ...good, name: "cats-mixed", categories: ["x", 7, null] },
  { ...good, name: "stars-text", stars: "many" },
  { ...good, name: "bool-text", standalone: "yes", isOrg: 1 },
  { ...good, name: "requires-text", requires: "other" },
  { ...good, name: "ja-number", description_ja: 7 },
];

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

(async () => {
  await test("every declared field is reduced to its declared type", () => {
    for (const entry of malformed) {
      const clean = sanitizeIndexResource(entry);
      assert.ok(clean, entry.name);
      assert.strictEqual(typeof clean.description, "string", entry.name);
      assert.ok(Array.isArray(clean.categories), entry.name);
      assert.ok(clean.categories.every((c) => typeof c === "string"), entry.name);
      assert.ok(clean.stars === undefined || typeof clean.stars === "number");
      assert.ok(clean.standalone === undefined || typeof clean.standalone === "boolean");
      assert.ok(clean.isOrg === undefined || typeof clean.isOrg === "boolean");
      assert.ok(clean.requires === undefined || Array.isArray(clean.requires));
      assert.ok(clean.description_ja === undefined || typeof clean.description_ja === "string");
      // Search and display read these without checking.
      clean.description.toLowerCase();
      clean.categories.some((c) => c.toLowerCase().includes("x"));
    }
  });

  await test("an entry that cannot be identified is dropped, not guessed", () => {
    for (const bad of [
      null,
      "text",
      [],
      { ...good, name: 5 },
      { ...good, name: "  " },
      { ...good, source: undefined },
      { ...good, path: {} },
      { ...good, kind: "skills" },
      { ...good, kind: 3 },
    ]) {
      assert.strictEqual(sanitizeIndexResource(bad), undefined, JSON.stringify(bad));
    }
    assert.strictEqual(sanitizeIndexResource({ ...good, kind: "agent" }).kind, "agent");
  });

  await test("sanitizing twice changes nothing (read and write agree)", () => {
    for (const entry of [good, ...malformed, { ...good, description: "x".repeat(9000) }]) {
      const once = sanitizeIndexResource(entry);
      assert.deepStrictEqual(sanitizeIndexResource(once), once, entry.name);
    }
    assert.strictEqual(
      sanitizeIndexResource({ ...good, description: "x".repeat(9000) }).description.length,
      4000,
    );
  });

  await test("unknown fields and well-formed entries pass through unchanged", () => {
    const entry = { ...good, kind: "plugin", stars: 5, future: { a: 1 }, invocation: "explicitOnly" };
    assert.deepStrictEqual(sanitizeIndexResource(entry), entry);
  });

  await test("the bundled catalog is a fixed point (no entry is altered or dropped)", () => {
    const bundled = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "resources", "skill-index.json"), "utf8"),
    );
    const cleaned = sanitizeIndexResources(bundled.skills);
    assert.strictEqual(cleaned.length, bundled.skills.length);
    assert.deepStrictEqual(cleaned, bundled.skills);
  });

  await test("loadSkillIndex drops malformed local entries and keeps the rest usable", async () => {
    localIndexText = JSON.stringify({
      version: "1.0.0",
      sources: [],
      skills: [good, ...malformed, null, { name: 1 }],
    });
    sharedSkills = null;
    const index = await loadSkillIndex(context);
    assert.strictEqual(index.skills.length, 1 + malformed.length);
    for (const skill of index.skills) {
      skill.description.toLowerCase();
      skill.categories.join(", ");
    }
  });

  await test("entries copied in from a shared index are sanitized too", async () => {
    localIndexText = JSON.stringify({ version: "1.0.0", sources: [], skills: [good] });
    sharedSkills = [good, { ...good, name: "shared-bad", description: ["x"], categories: 9 }, { name: "no-source" }];
    const index = await loadSkillIndex(context);
    assert.deepStrictEqual(index.skills.map((s) => s.name), ["ok", "shared-bad"]);
    const bad = index.skills[1];
    assert.strictEqual(bad.description, "");
    assert.deepStrictEqual(bad.categories, []);
    sharedSkills = null;
  });

  if (failures > 0) {
    console.error(`${failures} test(s) failed`);
    process.exit(1);
  }
})();
