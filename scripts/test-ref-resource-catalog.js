#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
);
const bundledIndex = require(
  path.join(repoRoot, "resources", "skill-index.json"),
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

// Row builders are split across formats, so a marker added to one path alone
// would silently leave the other generated lists claiming a broken resource is fine.
function getFunctionBody(source, functionName) {
  const normalized = source.replace(/\r\n/g, "\n");
  const start = normalized.indexOf(`function ${functionName}(`);
  assert.notStrictEqual(start, -1, `${functionName} not found`);
  const end = normalized.indexOf("\n}\n", start);
  assert.notStrictEqual(end, -1, `${functionName} body not terminated`);
  return normalized.slice(start, end);
}

test("every generated resource list marks incomplete resources", () => {
  const converters = [
    "toSyncResourceFromLocal",
    "toSyncResourceFromUser",
    "toSyncResourceFromInstalledMeta",
  ];
  // These build both an installed row and a local row, so one call is not enough.
  const twoRowGenerators = [
    "generateLegacySection",
    "generateCompactSection",
    "generateFullSection",
  ];

  for (const builder of converters) {
    assert.match(
      getFunctionBody(instructionManagerSource, builder),
      /markIncompleteDescription\(/,
      `${builder} must mark incomplete resources`,
    );
  }

  for (const builder of twoRowGenerators) {
    const body = getFunctionBody(instructionManagerSource, builder);
    const calls = body.match(/markIncompleteDescription\(/g);
    assert.strictEqual(
      calls?.length,
      2,
      `${builder} must mark both its installed and local rows`,
    );
    // Without a budget the marker would push the row past the documented limit.
    const budgets = body.match(/SKILL_DESCRIPTION_LIMITS\.MAX_(TOTAL|EACH)/g);
    assert.ok(
      (budgets?.length ?? 0) >= 2,
      `${builder} must pass a row budget to markIncompleteDescription`,
    );
  }

  assert.match(
    instructionManagerSource,
    /INCOMPLETE_ROW_MARKER = "\[incomplete\]"/,
    "the marker text is the contract the generated lists expose to agents",
  );

  // The converters mark the head, so catalog truncation must cut the tail.
  assert.match(
    instructionManagerSource,
    /const truncateText = [\s\S]*?raw\.substring\(0, limit - 3\) \+ "\.\.\."/,
    "catalog truncation must keep the row head so the marker survives",
  );
});

// The behavioural proof lives in test-coexistence-ref-catalog-cleanup.js, which
// runs a hostile resource through the real generators. These checks only stop a
// new row from bypassing the shared helpers.
test("generated rows neutralize untrusted resource text", () => {
  // A raw pipe escape bypasses the newline and comment handling in the helper.
  const rawPipeEscapes = instructionManagerSource
    .split(/\r?\n/)
    .filter((line) => /replace\(\/\\\|\/g/.test(line))
    .filter((line) => !line.includes("sanitizeGeneratedText"));
  assert.deepStrictEqual(
    rawPipeEscapes,
    [],
    "escape table cells through escapeMarkdownTableText, not a bare pipe replace",
  );

  const unescapedLinks = instructionManagerSource
    .split(/\r?\n/)
    .filter((line) => /\| \[\$\{/.test(line))
    .filter(
      (line) =>
        !line.includes("escapeMarkdownLinkLabel(") ||
        !line.includes("escapeMarkdownLinkDestination("),
    );
  assert.deepStrictEqual(
    unescapedLinks,
    [],
    "build row links from escapeMarkdownLinkLabel and escapeMarkdownLinkDestination",
  );
});

test("the bundled index still contains the text this escaping exists for", () => {
  const resources = bundledIndex.resources || bundledIndex.skills || [];
  const withNewline = resources.filter((resource) =>
    /[\r\n]/.test(String(resource.description || "")),
  );
  assert.ok(
    withNewline.length > 0,
    "if no bundled description has a newline any more, re-check that this guard still covers a real case",
  );
});

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
