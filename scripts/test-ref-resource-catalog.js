#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
);
const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
const readmeJa = fs.readFileSync(path.join(repoRoot, "README_ja.md"), "utf8");
const toolDetectorSource = fs.readFileSync(
  path.join(repoRoot, "src", "toolDetector.ts"),
  "utf8",
);
const extensionSource = fs.readFileSync(
  path.join(repoRoot, "src", "extension.ts"),
  "utf8",
);
const instructionManagerSource = fs.readFileSync(
  path.join(repoRoot, "src", "instructionManager.ts"),
  "utf8",
);
const nls = fs.readFileSync(path.join(repoRoot, "package.nls.json"), "utf8");
const nlsJa = fs.readFileSync(
  path.join(repoRoot, "package.nls.ja.json"),
  "utf8",
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

test("manifest exposes ref as default output format", () => {
  const config = packageJson.contributes.configuration.properties;
  assert.strictEqual(config["resourceNinja.outputFormat"].default, "ref");
  assert.deepStrictEqual(config["resourceNinja.outputFormat"].enum, [
    "ref",
    "full",
    "compact",
    "legacy",
  ]);
  assert.strictEqual(config["resourceNinja.refCatalogDirectory"].default, "");
  assert.strictEqual(config["resourceNinja.refCatalogFormat"].default, "full");
  assert.deepStrictEqual(config["resourceNinja.refCatalogFormat"].enum, [
    "full",
    "compact",
    "legacy",
  ]);
});

test("tool detector prefers ref for always-loaded markdown targets", () => {
  assert.match(
    toolDetectorSource,
    /tool:\s*"claude-code"[\s\S]*?format:\s*"ref"/,
  );
  assert.match(
    toolDetectorSource,
    /tool:\s*"github-copilot"[\s\S]*?format:\s*"ref"/,
  );
  assert.match(toolDetectorSource, /tool:\s*"cursor"[\s\S]*?format:\s*"full"/);
  assert.match(toolDetectorSource, /normalizeOutputFormat\(/);
  assert.match(
    toolDetectorSource,
    /getConfiguration\("resourceNinja", workspaceUri\)/,
  );
});

test("instruction manager defines scope-aware ref catalog roots", () => {
  assert.match(
    instructionManagerSource,
    /getConfiguration\("resourceNinja", workspaceUri\)/,
  );
  assert.match(
    instructionManagerSource,
    /DEFAULT_WORKSPACE_REF_CATALOG_DIRECTORY = "\.github\/resource-catalog"/,
  );
  assert.match(
    instructionManagerSource,
    /DEFAULT_GLOBAL_REF_CATALOG_DIRECTORY = "\.catalog\/resources"/,
  );
  assert.match(
    instructionManagerSource,
    /scope === "workspace"[\s\S]*DEFAULT_WORKSPACE_REF_CATALOG_DIRECTORY/,
  );
  assert.match(
    instructionManagerSource,
    /const instructionDirectoryUri = vscode\.Uri\.file\([\s\S]*path\.dirname\(instructionUri\.fsPath\)/,
  );
});

test("instruction manager generates per-kind ref catalogs and skill-only IMPORTANT copy", () => {
  assert.match(instructionManagerSource, /fileName: "skills\.md"/);
  assert.match(instructionManagerSource, /fileName: "agents\.md"/);
  assert.match(instructionManagerSource, /fileName: "instructions\.md"/);
  assert.match(instructionManagerSource, /fileName: "prompts\.md"/);
  assert.match(instructionManagerSource, /fileName: "hooks\.md"/);
  assert.match(instructionManagerSource, /fileName: "mcp\.md"/);
  assert.match(instructionManagerSource, /fileName: "plugins\.md"/);
  assert.match(instructionManagerSource, /fileName: "cursor-rules\.md"/);
  assert.match(
    instructionManagerSource,
    /kind === "skill"[\s\S]*Prefer skill-led reasoning/,
  );
  assert.match(
    instructionManagerSource,
    /See \[\$\{descriptor\.sectionTitle\}\]\(\$\{catalogLink\}\)/,
  );
  assert.match(instructionManagerSource, /syncRefCatalogFiles\(/);
  assert.match(instructionManagerSource, /cleanupRefCatalogFiles\(/);
  assert.match(instructionManagerSource, /getConfiguredRefCatalogFormat/);
  assert.match(instructionManagerSource, /Compressed Index/);
  assert.match(instructionManagerSource, /REF_CATALOG_MARKER_PREFIX/);
  assert.match(
    instructionManagerSource,
    /deleteGeneratedRefCatalogFileIfExists/,
  );
  assert.match(instructionManagerSource, /Keeping non-generated catalog file/);
  assert.match(
    instructionManagerSource,
    /\| Resource \| Source \| Path \| Repository \| Remote URL \| Description \|/,
  );
});

test("README documents ref output and catalog directories", () => {
  const docs = [readme, readmeJa].join("\n");
  assert.match(docs, /resourceNinja\.refCatalogDirectory/);
  assert.match(docs, /resourceNinja\.refCatalogFormat/);
  assert.match(docs, /\.github\/resource-catalog/);
  assert.match(docs, /\.catalog\/resources/);
  assert.match(docs, /resource-ninja-catalog/);
  assert.match(docs, /manually authored files|手書きファイル/);
  assert.match(
    docs,
    /Leave `resourceNinja\.refCatalogDirectory` empty|`resourceNinja\.refCatalogDirectory` は空欄/,
  );
  assert.doesNotMatch(docs, /Default `auto` mode|既定の `auto` モード/);
  assert.doesNotMatch(
    docs,
    /\| \[review-agent\]\(\.github\/agents\/review\.agent\.md\)/,
  );
  assert.match(
    docs,
    /`ref`, `full`, `compact`, `legacy`|`ref` \/ `full` \/ `compact` \/ `legacy`/,
  );
  assert.match(
    docs,
    /Lightweight references \+ per-kind catalogs|軽量な参照ブロック \+ kind 別 catalog/,
  );
  assert.match(
    docs,
    /catalog file \(`refCatalogFormat`\)|catalog file \(`refCatalogFormat`\)|catalog 内の詳細形式/,
  );
  assert.doesNotMatch(
    docs,
    /default `auto` mode writes a shared managed section with \*\*IMPORTANT prompt\*\* and \*\*Description column\*\*|既定の `auto` モードでは、instruction file に \*\*IMPORTANT プロンプト\*\* と \*\*Description 列\*\* を含む共有管理セクション/,
  );
});

test("settings copy distinguishes coexistence mode from output format", () => {
  const settingsCopy = [nls, nlsJa].join("\n");
  assert.match(settingsCopy, /coexistenceMode = auto/);
  assert.match(settingsCopy, /refCatalogFormat/);
  assert.doesNotMatch(settingsCopy, /default `auto` mode|既定の `auto` モード/);
});

test("extension watches ref settings and migrates legacy output formats across scopes", () => {
  assert.match(
    extensionSource,
    /affectsConfiguration\("resourceNinja\.refCatalogDirectory"\)/,
  );
  assert.match(
    extensionSource,
    /affectsConfiguration\("resourceNinja\.refCatalogFormat"\)/,
  );
  assert.match(extensionSource, /inspected\?\.globalValue/);
  assert.match(extensionSource, /inspected\?\.workspaceValue/);
  assert.match(extensionSource, /inspected\?\.workspaceFolderValue/);
  assert.match(extensionSource, /markdown: "legacy"/);
  assert.match(extensionSource, /"compressed-index": "compact"/);
  assert.match(extensionSource, /"markdown-with-index": "full"/);
});

console.log("RESULT=PASS");
