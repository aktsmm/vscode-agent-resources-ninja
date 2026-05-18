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

test("manifest splits Ref mode from inline output format", () => {
  const config = packageJson.contributes.configuration.properties;
  assert.strictEqual(config["resourceNinja.useRefOutput"].default, true);
  assert.strictEqual(config["resourceNinja.outputFormat"].default, "full");
  assert.deepStrictEqual(config["resourceNinja.outputFormat"].enum, [
    "full",
    "compact",
    "legacy",
  ]);
  assert.strictEqual(config["resourceNinja.refCatalogDirectory"], undefined);
  assert.strictEqual(config["resourceNinja.refCatalogFormat"].default, "full");
  assert.deepStrictEqual(config["resourceNinja.refCatalogFormat"].enum, [
    "full",
    "compact",
    "legacy",
  ]);
  assert.deepStrictEqual(
    config["resourceNinja.refCatalogFormat"].enumDescriptions,
    [
      "%config.refCatalogFormat.full%",
      "%config.refCatalogFormat.compact%",
      "%config.refCatalogFormat.legacy%",
    ],
  );
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
    /getConfiguration\([\s\S]*"resourceNinja",[\s\S]*workspaceUri[\s\S]*\)/,
  );
});

test("instruction manager resolves native README indexes and legacy cleanup roots", () => {
  assert.match(
    instructionManagerSource,
    /getConfiguration\([\s\S]*"resourceNinja",[\s\S]*workspaceUri[\s\S]*\)/,
  );
  assert.match(
    instructionManagerSource,
    /LEGACY_WORKSPACE_REF_CATALOG_DIRECTORY = "\.github\/resource-catalog"/,
  );
  assert.match(
    instructionManagerSource,
    /LEGACY_GLOBAL_REF_CATALOG_DIRECTORY = "\.catalog\/resources"/,
  );
  assert.match(
    instructionManagerSource,
    /function resolveWorkspaceResourceDirectoryUri/,
  );
  assert.match(
    instructionManagerSource,
    /function resolveGlobalRefCatalogDirectoryUri/,
  );
  assert.match(
    instructionManagerSource,
    /function resolveRefCatalogFileUri[\s\S]*README\.md/,
  );
  assert.match(instructionManagerSource, /function getLegacyRefCatalogRootUri/);
});

test("instruction manager generates per-kind README indexes and preserves manual content", () => {
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
  assert.match(instructionManagerSource, /REF_CATALOG_END_MARKER_PREFIX/);
  assert.match(
    instructionManagerSource,
    /deleteGeneratedRefCatalogFileIfExists/,
  );
  assert.match(
    instructionManagerSource,
    /async function cleanupLegacyRefCatalogFiles/,
  );
  assert.match(instructionManagerSource, /stripCatalogSection/);
  assert.match(instructionManagerSource, /upsertCatalogSection/);
  assert.match(
    instructionManagerSource,
    /await cleanupLegacyRefCatalogFiles\([\s\S]*skillSource\.scope/,
  );
  assert.match(instructionManagerSource, /Keeping non-generated catalog file/);
  assert.match(
    instructionManagerSource,
    /\| Resource \| Source \| Path \| Repository \| Remote URL \| Description \|/,
  );
});

test("README documents ref output with native README indexes", () => {
  const docs = [readme, readmeJa].join("\n");
  assert.match(docs, /resourceNinja\.useRefOutput/);
  assert.doesNotMatch(docs, /resourceNinja\.refCatalogDirectory/);
  assert.doesNotMatch(docs, /Ref Catalog Output Directory/);
  assert.match(docs, /resourceNinja\.refCatalogFormat/);
  assert.match(docs, /\.github\/skills\/README\.md/);
  assert.match(docs, /\.github\/agents\/README\.md/);
  assert.match(docs, /~\/.copilot\/prompts\/README\.md/);
  assert.match(docs, /resource-ninja-catalog/);
  assert.match(docs, /manually authored README|手書き README/);
  assert.doesNotMatch(docs, /Default `auto` mode|既定の `auto` モード/);
  assert.doesNotMatch(
    docs,
    /\| \[review-agent\]\(\.github\/agents\/review\.agent\.md\)/,
  );
  assert.match(
    docs,
    /`full`, `compact`, `legacy`|`full` \/ `compact` \/ `legacy`/,
  );
  assert.match(docs, /Use Ref Output|Ref 出力/);
  assert.match(
    docs,
    /README index \(`refCatalogFormat`\)|README index \(`refCatalogFormat`\)|README index 内の詳細形式|README index の詳細形式/,
  );
  assert.doesNotMatch(
    docs,
    /default `auto` mode writes a shared managed section with \*\*IMPORTANT prompt\*\* and \*\*Description column\*\*|既定の `auto` モードでは、instruction file に \*\*IMPORTANT プロンプト\*\* と \*\*Description 列\*\* を含む共有管理セクション/,
  );
});

test("settings copy distinguishes coexistence mode from output format", () => {
  const settingsCopy = [nls, nlsJa].join("\n");
  assert.match(settingsCopy, /coexistenceMode = auto/);
  assert.match(settingsCopy, /useRefOutput/);
  assert.match(settingsCopy, /refCatalogFormat/);
  assert.match(settingsCopy, /config\.refCatalogFormat\.full|Full index/);
  assert.doesNotMatch(settingsCopy, /default `auto` mode|既定の `auto` モード/);
});

test("extension watches remaining ref settings and migrates legacy output formats across scopes", () => {
  assert.match(
    extensionSource,
    /affectsConfiguration\("resourceNinja\.useRefOutput"\)/,
  );
  assert.doesNotMatch(
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
  assert.match(extensionSource, /useRefInspected\?\.globalValue/);
  assert.match(extensionSource, /update\("useRefOutput", true, target\)/);
  assert.match(
    extensionSource,
    /outputFormat ref → useRefOutput true \+ outputFormat full/,
  );
  assert.match(extensionSource, /markdown: "legacy"/);
  assert.match(extensionSource, /"compressed-index": "compact"/);
  assert.match(extensionSource, /"markdown-with-index": "full"/);
  assert.match(
    extensionSource,
    /resolvePrimaryRefCatalogUri\([\s\S]*scope,[\s\S]*config/,
  );
});

test("release notes no longer mention deleted refCatalogDirectory setting", () => {
  const releaseNotes = fs.readFileSync(
    path.join(repoRoot, `release-notes-v${packageJson.version}.md`),
    "utf8",
  );
  assert.doesNotMatch(releaseNotes, /refCatalogDirectory/);
  assert.match(releaseNotes, /refCatalogFormat/);
});

console.log("RESULT=PASS");
