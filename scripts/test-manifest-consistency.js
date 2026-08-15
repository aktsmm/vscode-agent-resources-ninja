#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
);
const packageLock = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package-lock.json"), "utf8"),
);
const nls = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.nls.json"), "utf8"),
);
const nlsJa = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.nls.ja.json"), "utf8"),
);
const chatParticipantSource = fs.readFileSync(
  path.join(repoRoot, "src", "chatParticipant.ts"),
  "utf8",
);
const extensionSource = fs.readFileSync(
  path.join(repoRoot, "src", "extension.ts"),
  "utf8",
);
const i18nSource = fs.readFileSync(
  path.join(repoRoot, "src", "i18n.ts"),
  "utf8",
);
const mcpToolsSource = fs.readFileSync(
  path.join(repoRoot, "src", "mcpTools.ts"),
  "utf8",
);
const loggerSource = fs.readFileSync(
  path.join(repoRoot, "src", "logger.ts"),
  "utf8",
);
const bugReportSource = fs.readFileSync(
  path.join(repoRoot, "src", "bugReport.ts"),
  "utf8",
);
const esbuildSource = fs.readFileSync(
  path.join(repoRoot, "esbuild.js"),
  "utf8",
);
const indexUpdaterSource = fs.readFileSync(
  path.join(repoRoot, "src", "indexUpdater.ts"),
  "utf8",
);
const localSkillScannerSource = fs.readFileSync(
  path.join(repoRoot, "src", "localSkillScanner.ts"),
  "utf8",
);
const instructionManagerSource = fs.readFileSync(
  path.join(repoRoot, "src", "instructionManager.ts"),
  "utf8",
);
const treeProviderSource = fs.readFileSync(
  path.join(repoRoot, "src", "treeProvider.ts"),
  "utf8",
);
const presetIndexUpdaterSource = fs.readFileSync(
  path.join(repoRoot, "scripts", "update-preset-index.js"),
  "utf8",
);
const skillIndexSource = fs.readFileSync(
  path.join(repoRoot, "src", "skillIndex.ts"),
  "utf8",
);
const skillSearchSource = fs.readFileSync(
  path.join(repoRoot, "src", "skillSearch.ts"),
  "utf8",
);
const skillPreviewSource = fs.readFileSync(
  path.join(repoRoot, "src", "skillPreview.ts"),
  "utf8",
);
const skillInstallerSource = fs.readFileSync(
  path.join(repoRoot, "src", "skillInstaller.ts"),
  "utf8",
);
const resourceKindsSource = fs.readFileSync(
  path.join(repoRoot, "src", "resourceKinds.ts"),
  "utf8",
);
const customizationPathsSource = fs.readFileSync(
  path.join(repoRoot, "src", "customizationPaths.ts"),
  "utf8",
);
const sourceFreshnessSource = fs.readFileSync(
  path.join(repoRoot, "src", "sourceFreshness.ts"),
  "utf8",
);
const sharedManifestSource = fs.readFileSync(
  path.join(repoRoot, "src", "sharedManifest.ts"),
  "utf8",
);
const sharedResourceIndexStoreSource = fs.readFileSync(
  path.join(repoRoot, "src", "sharedResourceIndexStore.ts"),
  "utf8",
);
const sharedSourcesManifestStoreSource = fs.readFileSync(
  path.join(repoRoot, "src", "sharedSourcesManifestStore.ts"),
  "utf8",
);
const bundledIndex = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "resources", "skill-index.json"), "utf8"),
);
const userResourceScannerSource = fs.readFileSync(
  path.join(repoRoot, "src", "userResourceScanner.ts"),
  "utf8",
);
const userResourcesProviderSource = fs.readFileSync(
  path.join(repoRoot, "src", "userResourcesProvider.ts"),
  "utf8",
);
const vscodeTestConfigSource = fs.readFileSync(
  path.join(repoRoot, ".vscode-test.mjs"),
  "utf8",
);
const vscodeSmokeRunnerSource = fs.readFileSync(
  path.join(repoRoot, "scripts", "run-vscode-smoke.js"),
  "utf8",
);
const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
const readmeJa = fs.readFileSync(path.join(repoRoot, "README_ja.md"), "utf8");
const gitignore = fs.readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
const vscodeignore = fs.readFileSync(
  path.join(repoRoot, ".vscodeignore"),
  "utf8",
);
const resourceTestRunner = require("./run-resource-tests.js");
const discoveredResourceTests = resourceTestRunner.discoverTestScripts();
const skippedResourceTests = Object.keys(resourceTestRunner.NETWORK_TESTS);
const executedResourceTests = discoveredResourceTests.filter(
  (fileName) => !skippedResourceTests.includes(fileName),
);

function assertResourceSuiteRuns(fileName, message) {
  assert.ok(
    executedResourceTests.includes(fileName),
    message || `Resource test suite should execute scripts/${fileName} offline`,
  );
}

function readRuntimeSources() {
  const srcRoot = path.join(repoRoot, "src");
  const sources = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.name.endsWith(".ts")) {
        sources.push({
          path: entryPath,
          text: fs.readFileSync(entryPath, "utf8"),
        });
      }
    }
  };
  visit(srcRoot);
  return sources;
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

function parseReadmeSettingsTable(readmeText) {
  const lines = readmeText.split(/\r?\n/);
  const headerIndex = lines.findIndex(
    (line) =>
      line.includes("| Order | Setting") || line.includes("| 順序 | Setting"),
  );
  assert.ok(headerIndex >= 0, "Expected README settings table header");

  const entries = [];
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("> ")) {
      break;
    }
    if (!/^\|\s*\d+\s*\|/.test(line)) {
      continue;
    }
    const columns = line
      .split("|")
      .slice(1, -1)
      .map((column) => column.trim());
    entries.push({
      order: Number(columns[0]),
      setting: columns[1].replace(/`/g, "").replace(/^resourceNinja\./, ""),
    });
  }

  return entries;
}

function assertNoDirectIndexSkillsRuntimeReads(sourceName, sourceText) {
  const forbidden =
    /\b(?:this\.)?(?:index|skillIndex|cachedIndex|currentIndex|updatedIndex)\.skills\s*(?:\.|\[)/g;
  const matches = Array.from(sourceText.matchAll(forbidden)).map(
    (match) => match[0],
  );
  assert.deepStrictEqual(
    matches,
    [],
    `${sourceName} must use getIndexResources() instead of direct .skills reads`,
  );
}

test("chat participant id matches implementation", () => {
  const participants = packageJson.contributes?.chatParticipants || [];
  assert.ok(participants.some((participant) => participant.id === "resources"));
  assert.match(
    chatParticipantSource,
    /createChatParticipant\(\s*[\r\n]*\s*"resources"\s*,/,
  );
  assert.doesNotMatch(
    chatParticipantSource,
    /createChatParticipant\(\s*[\r\n]*\s*"skill"\s*,/,
  );
});

test("chat participant buttons use contributed commands", () => {
  const commands = new Set(
    (packageJson.contributes?.commands || []).map((command) => command.command),
  );
  const commandMatches = Array.from(
    chatParticipantSource.matchAll(/command:\s*"([^"]+)"/g),
  )
    .map((match) => match[1])
    .filter((command) => command.startsWith("resourceNinja."));

  for (const command of commandMatches) {
    assert.ok(commands.has(command), `Missing contributed command: ${command}`);
    assert.match(
      extensionSource,
      new RegExp(`"${command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
    );
  }
});

test("bug report links are generated by the shared helper", () => {
  assert.match(bugReportSource, /BUG_REPORT_URL_MAX_LENGTH = 7_500/);
  assert.match(bugReportSource, /BUG_REPORT_TRUNCATION_NOTICE/);
  assert.match(bugReportSource, /createBugReportUrl\(boundedTitle/);
  assert.match(bugReportSource, /export async function openBugReport/);
  assert.match(
    extensionSource,
    /await openBugReport\(issueTitle, issueBody\);/,
  );
  assert.match(
    skillInstallerSource,
    /await openBugReportIssue\(issueTitle, issueBody\);/,
  );
  assert.doesNotMatch(
    extensionSource,
    /issues\/new\?\$\{params\.toString\(\)\}/,
  );
  assert.doesNotMatch(
    skillInstallerSource,
    /issues\/new\?\$\{params\.toString\(\)\}/,
  );
});

test("esbuild log labels distinguish watch and one-shot builds", () => {
  assert.match(
    esbuildSource,
    /const logPrefix = watch \? "\[watch\]" : "\[build\]";/,
  );
  assert.match(
    esbuildSource,
    /console\.log\(`\$\{logPrefix\} build started`\);/,
  );
  assert.match(
    esbuildSource,
    /console\.log\(`\$\{logPrefix\} build finished`\);/,
  );
});

test("chat and language model list surfaces cover workspace resource kinds", () => {
  const participant = packageJson.contributes?.chatParticipants?.find(
    (entry) => entry.id === "resources",
  );
  const listCommand = participant?.commands?.find(
    (command) => command.name === "list",
  );
  assert.strictEqual(listCommand?.description, "List workspace resources");

  const tools = packageJson.contributes?.languageModelTools || [];
  const listTool = tools.find((tool) => tool.name === "resourceNinja_list");
  assert.strictEqual(listTool?.displayName, "List Workspace Resources");
  assert.match(
    listTool?.modelDescription || "",
    /skills, agents, prompts, instructions, hooks, and MCP config resources/,
  );

  assert.match(
    chatParticipantSource,
    /scanLocalSkills\(workspaceFolder\.uri, true, true\)/,
  );
  assert.match(chatParticipantSource, /Workspace Resources/);
  assert.match(chatParticipantSource, /List Workspace/);
  assert.match(chatParticipantSource, /getResourceKindLabel/);
  assert.match(
    mcpToolsSource,
    /scanLocalSkills\(workspaceFolder\.uri, true, true\)/,
  );
  assert.match(mcpToolsSource, /Workspace Resources/);
  assert.match(mcpToolsSource, /\| # \| Kind \| Name \| Path \|/);
});

test("language model uninstall supports non-skill workspace resources safely", () => {
  const tools = packageJson.contributes?.languageModelTools || [];
  const uninstallTool = tools.find(
    (tool) => tool.name === "resourceNinja_uninstall",
  );
  assert.match(uninstallTool?.modelDescription || "", /workspace resource/);
  assert.match(mcpToolsSource, /class SkillUninstallTool/);
  assert.match(
    mcpToolsSource,
    /scanLocalSkills\(workspaceFolder\.uri, true, true\)/,
  );
  assert.match(mcpToolsSource, /Multiple workspace resources match/);
  assert.match(mcpToolsSource, /uninstallSkillByPath/);
  assert.match(mcpToolsSource, /formatHookConfigUpdateSummary/);
});

test("language model resource actions are kind-aware and ambiguity-safe", () => {
  const tools = packageJson.contributes?.languageModelTools || [];
  const searchTool = tools.find((tool) => tool.name === "resourceNinja_search");
  const installTool = tools.find(
    (tool) => tool.name === "resourceNinja_install",
  );
  const uninstallTool = tools.find(
    (tool) => tool.name === "resourceNinja_uninstall",
  );

  assert.deepStrictEqual(searchTool?.inputSchema?.properties?.kind?.enum, [
    "skill",
    "agent",
    "instruction",
    "prompt",
    "hook",
    "mcp",
    "plugin",
    "cursor-rule",
    "all",
  ]);
  assert.deepStrictEqual(installTool?.inputSchema?.properties?.kind?.enum, [
    "skill",
    "agent",
    "instruction",
    "prompt",
    "hook",
    "mcp",
    "plugin",
    "cursor-rule",
  ]);
  assert.deepStrictEqual(uninstallTool?.inputSchema?.properties?.kind?.enum, [
    "skill",
    "agent",
    "instruction",
    "prompt",
    "hook",
    "mcp",
    "plugin",
    "cursor-rule",
  ]);

  assert.match(mcpToolsSource, /normalizeKindFilter/);
  assert.match(mcpToolsSource, /resourceName is required/);
  assert.match(mcpToolsSource, /Multiple resources match/);
  assert.match(mcpToolsSource, /findIndexedResourceCandidates/);
  assert.match(chatParticipantSource, /findChatInstallCandidates/);
  assert.match(chatParticipantSource, /Multiple resources match/);
});

test("bundle install uses selectable resource checklist", () => {
  assert.match(extensionSource, /canPickMany:\s*true/);
  assert.match(extensionSource, /Select Curated Set Resources/);
  assert.doesNotMatch(extensionSource, /Select Bundle Resources/);
  assert.match(extensionSource, /getResourceKindIcon\(kind\)/);
  assert.match(extensionSource, /selectedKindSummary/);
  assert.match(
    extensionSource,
    /MCP config files will use the selected activation mode/,
  );
  assert.match(extensionSource, /MCP config の有効化方法/);
  assert.match(
    extensionSource,
    /const installTarget = await pickInstallTarget\(selectedItems\[0\]\.skill\)/,
  );
  assert.match(
    extensionSource,
    /installSkill\(skill, wsFolder\.uri, context, \{[\s\S]*\.\.\.installTarget,[\s\S]*suppressRecoveryPrompt: true,[\s\S]*\}\)/,
  );
  assert.match(extensionSource, /if \(failed > 0\)/);
  assert.match(extensionSource, /Update This Source Index/);
  assert.match(extensionSource, /installTarget\.targetScope === "workspace"/);
  assert.match(extensionSource, /selectedItems\.length/);
  assert.doesNotMatch(
    extensionSource,
    /Install \$\{installOrder\.length\} skills from/,
    "Bundle install should not imply unselectable all-skill install",
  );
});

test("remote bundles prioritize and highlight official sources", () => {
  assert.match(treeProviderSource, /getOrderedBundles/);
  assert.match(treeProviderSource, /getBundleSortWeight/);
  assert.match(treeProviderSource, /source\?\.type === "official"/);
  assert.match(
    treeProviderSource,
    /new vscode\.ThemeIcon\(\s*"verified",\s*new vscode\.ThemeColor\("charts\.blue"\)/,
  );
  assert.match(treeProviderSource, /Official/);
  assert.match(treeProviderSource, /公式/);
});

test("search results disambiguate duplicate resource names", () => {
  assert.match(skillSearchSource, /getSourceDisplayName/);
  assert.match(skillSearchSource, /formatSourceDisplayName/);
  assert.match(skillSearchSource, /getDuplicateNameCounts/);
  assert.match(skillSearchSource, /hasDuplicateName/);
  assert.match(skillSearchSource, /compareSearchTieBreakers/);
  assert.match(skillSearchSource, /isPluginPath/);
  assert.match(skillSearchSource, /\^plugins\?\\\//);
  assert.match(skillSearchSource, /Source.*Path/s);
});

test("MCP install targets avoid generic filename collisions", () => {
  assert.match(skillInstallerSource, /getInstallFileName/);
  assert.match(
    skillInstallerSource,
    /normalizedFileName\.toLowerCase\(\) !== "mcp\.json"/,
  );
  assert.match(
    skillInstallerSource,
    /`\$\{sanitizeSkillName\(skill\.source\)\}-\$\{normalizedFileName\}`/,
  );
});

test("bundled resource index has a release-safe shape", () => {
  const knownKinds = new Set([
    "skill",
    "agent",
    "instruction",
    "prompt",
    "hook",
    "mcp",
    "plugin",
    "cursor-rule",
  ]);
  assert.ok(Array.isArray(bundledIndex.skills), "skills must be an array");
  assert.ok(Array.isArray(bundledIndex.sources), "sources must be an array");
  assert.ok(
    Array.isArray(bundledIndex.categories),
    "categories must be an array",
  );
  assert.ok(
    bundledIndex.skills.length >= 100,
    `bundled index should contain at least 100 resources, got ${bundledIndex.skills.length}`,
  );
  assert.ok(bundledIndex.sources.length > 0, "sources must not be empty");

  const sourceIds = new Set(bundledIndex.sources.map((source) => source.id));
  for (const [index, resource] of bundledIndex.skills.entries()) {
    assert.ok(resource.name, `skills[${index}] missing name`);
    assert.ok(resource.source, `skills[${index}] missing source`);
    assert.strictEqual(
      typeof resource.path,
      "string",
      `skills[${index}] missing path field`,
    );
    assert.ok(resource.description, `skills[${index}] missing description`);
    assert.ok(
      sourceIds.has(resource.source),
      `skills[${index}] references missing source ${resource.source}`,
    );
    assert.ok(
      !resource.kind || knownKinds.has(resource.kind),
      `skills[${index}] has unknown kind ${resource.kind}`,
    );
  }
});

test("user-facing and read-only runtime code uses safe resource index accessors", () => {
  assert.match(skillIndexSource, /export function getIndexResources/);
  for (const [sourceName, sourceText] of [
    ["treeProvider.ts", treeProviderSource],
    ["chatParticipant.ts", chatParticipantSource],
    ["mcpTools.ts", mcpToolsSource],
    ["extension.ts", extensionSource],
    ["instructionManager.ts", instructionManagerSource],
    ["sharedResourceIndexStore.ts", sharedResourceIndexStoreSource],
    ["skillPreview.ts", skillPreviewSource],
    ["skillSearch.ts", skillSearchSource],
  ]) {
    assert.match(
      sourceText,
      /getIndexResources/,
      `${sourceName} should import or call getIndexResources`,
    );
    assertNoDirectIndexSkillsRuntimeReads(sourceName, sourceText);
  }
});

test("bundled MicrosoftDocs renamed skills use current upstream paths", () => {
  const foundryLocal = bundledIndex.skills.find(
    (skill) =>
      skill.source === "microsoftdocs-agent-skills" &&
      skill.name === "microsoft-foundry-local",
  );
  assert.ok(foundryLocal, "Expected microsoft-foundry-local in bundled index");
  assert.strictEqual(foundryLocal.path, "skills/microsoft-foundry-local");
  assert.ok(
    !bundledIndex.skills.some(
      (skill) =>
        skill.source === "microsoftdocs-agent-skills" &&
        (skill.name === "azure-ai-foundry-local" ||
          skill.path === "skills/azure-ai-foundry-local"),
    ),
    "Bundled index should not keep the removed Azure AI Foundry Local path",
  );
});

test("bundled Microsoft Azure Skills plugin source is complete", () => {
  const source = bundledIndex.sources.find(
    (candidate) => candidate.id === "microsoft-azure-skills",
  );
  assert.ok(source, "Expected microsoft-azure-skills source in bundled index");
  assert.strictEqual(source.type, "official");
  assert.strictEqual(source.url, "https://github.com/microsoft/azure-skills");
  assert.deepStrictEqual(source.includePaths, [
    "skills/",
    ".mcp.json",
    "plugin.json",
    ".claude-plugin/",
    ".cursor-plugin/",
    "gemini-extension.json",
  ]);

  const resources = bundledIndex.skills.filter(
    (resource) => resource.source === "microsoft-azure-skills",
  );
  const skillResources = resources.filter(
    (resource) => (resource.kind || "skill") === "skill",
  );
  assert.ok(skillResources.length > 0, "Expected current Azure skills");
  assert.strictEqual(
    resources.filter((resource) => resource.kind === "mcp").length,
    1,
  );
  assert.strictEqual(
    resources.filter((resource) => resource.kind === "plugin").length,
    1,
  );
  assert.strictEqual(resources.length, skillResources.length + 2);
  assert.ok(
    resources.some(
      (resource) =>
        resource.kind === "mcp" &&
        resource.name === "azure" &&
        resource.path === ".mcp.json" &&
        resource.description === "MCP configuration for azure",
    ),
    "Azure Skills MCP config should be indexed with useful metadata",
  );
  const bundle = bundledIndex.bundles.find(
    (candidate) => candidate.id === "microsoft-azure-skills-plugin-resources",
  );
  assert.ok(bundle, "Expected Microsoft Azure Skills resource bundle");
  assert.strictEqual(bundle.source, "microsoft-azure-skills");
  assert.strictEqual(bundle.syncWithSource, true);
  assert.deepStrictEqual(bundle.syncResourceKinds, ["skill", "mcp"]);
  assert.match(bundle.description, /Azure skills plus the Azure MCP config/);
  assert.match(bundle.description, /optional workspace mcp\.json merge/);
  assert.deepStrictEqual(
    [...bundle.skills].sort(),
    resources
      .filter((resource) => resource.kind !== "plugin")
      .map((resource) => resource.name)
      .sort(),
    "Azure Skills bundle should include every indexed non-plugin resource from the source",
  );
  assert.deepStrictEqual(bundle.installOrder, bundle.skills);
  assert.ok(
    resources.every(
      (resource) =>
        !String(resource.path).startsWith(".github/plugins/azure-skills/"),
    ),
    "Azure Skills source should prefer top-level distribution paths over plugin payload duplicates",
  );
  assert.match(presetIndexUpdaterSource, /kind === "mcp"/);
  assert.match(presetIndexUpdaterSource, /getMcpConfigMetadata/);
  assert.match(
    resourceKindsSource,
    /parsed\.mcpServers[\s\S]*?parsed\.servers/,
  );
  assert.ok(
    skippedResourceTests.includes("test-azure-skills-source.js"),
    "Azure Skills upstream comparison should stay declared as a network test",
  );
  assert.strictEqual(
    packageJson.scripts?.["test:upstream"],
    "node scripts/run-resource-tests.js --include-network",
    "Network tests should stay reachable through an opt-in npm script",
  );
});

test("new product metadata is internally consistent", () => {
  assert.strictEqual(packageJson.name, "agent-resources-ninja");
  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/);
  assert.strictEqual(
    packageJson.scripts?.test,
    "node scripts/run-vscode-smoke.js",
  );
  assert.strictEqual(
    packageJson.scripts?.["release:vsce"],
    "pwsh -NoProfile -File ./scripts/Invoke-VsceWithPat.ps1",
  );
  assert.strictEqual(
    packageJson.repository?.url,
    "https://github.com/aktsmm/vscode-agent-resources-ninja",
  );
  const activityContainers =
    packageJson.contributes?.viewsContainers?.activitybar || [];
  assert.ok(
    activityContainers.some((container) => container.id === "resource-ninja"),
    "Expected resource-ninja activity bar container",
  );
  assert.ok(
    !activityContainers.some((container) => container.id === "skill-ninja"),
    "Activity bar container should not use old skill-ninja id",
  );
});

test("extension-host smoke runner guards windows update mutex and uses isolated test paths", () => {
  assert.match(
    vscodeSmokeRunnerSource,
    /Mutex\]::OpenExisting\('vscode-updating'\)/,
  );
  assert.match(vscodeSmokeRunnerSource, /Skipping Extension Host smoke launch/);
  assert.match(vscodeSmokeRunnerSource, /process\.exit\(2\)/);
  assert.match(
    vscodeSmokeRunnerSource,
    /"@vscode",\s*\r?\n\s*"test-cli",\s*\r?\n\s*"out",\s*\r?\n\s*"bin\.mjs"/,
  );
  assert.match(vscodeTestConfigSource, /fromPath: vscodeExecutablePath/);
  assert.match(vscodeTestConfigSource, /manual-local-launch/);
  assert.match(vscodeTestConfigSource, /--disable-updates/);
  assert.match(vscodeTestConfigSource, /--user-data-dir/);
  assert.match(vscodeTestConfigSource, /--extensions-dir/);
});

test("commands, views, and settings use resourceNinja namespace", () => {
  const commands = packageJson.contributes?.commands || [];
  const views = Object.values(packageJson.contributes?.views || {}).flat();
  const settings = Object.keys(
    packageJson.contributes?.configuration?.properties || {},
  );

  for (const command of commands) {
    assert.ok(
      command.command.startsWith("resourceNinja."),
      `Command should use resourceNinja namespace: ${command.command}`,
    );
    assert.ok(
      !command.command.startsWith("skillNinja."),
      `Command should not use skillNinja namespace: ${command.command}`,
    );
  }

  for (const view of views) {
    assert.ok(
      view.id.startsWith("resourceNinja."),
      `View should use resourceNinja namespace: ${view.id}`,
    );
  }

  for (const setting of settings) {
    assert.ok(
      setting.startsWith("resourceNinja."),
      `Setting should use resourceNinja namespace: ${setting}`,
    );
    assert.ok(
      !setting.includes("SkillsOnUpgrade") &&
        !setting.includes("skillsDirectory") &&
        !setting.includes("includeLocalSkills"),
      `Setting should use resource-oriented names: ${setting}`,
    );
  }
});

test("local views appear before remote resources", () => {
  const views = packageJson.contributes?.views?.["resource-ninja"] || [];
  const viewIds = views.map((view) => view.id);
  assert.deepStrictEqual(
    viewIds,
    [
      "resourceNinja.installedView",
      "resourceNinja.userResourcesView",
      "resourceNinja.browseView",
    ],
    "Expected workspace and user/global local views before remote resources",
  );
  assert.strictEqual(nls["view.userResources"], "User / Global Resource Home");
  assert.strictEqual(
    nlsJa["view.userResources"],
    "ユーザー / グローバル リソース",
  );
});

test("user global resources view excludes workspace roots", () => {
  assert.doesNotMatch(
    userResourceScannerSource,
    /scope:\s*"workspace"/,
    "User / Global Resource Home should not duplicate workspace resources",
  );
  assert.doesNotMatch(
    userResourceScannerSource,
    /Workspace \.github/,
    "User / Global Resource Home should not label workspace roots",
  );
});

test("user global resources support deleting only non-built-in resources", () => {
  const itemMenus = packageJson.contributes?.menus?.["view/item/context"] || [];
  const commands = packageJson.contributes?.commands || [];
  assert.ok(
    commands.some(
      (command) => command.command === "resourceNinja.deleteUserResource",
    ),
    "Delete User / Global Resource Home Resource command should be contributed",
  );
  assert.ok(
    itemMenus.some(
      (item) =>
        item.command === "resourceNinja.deleteUserResource" &&
        item.when ===
          "view == resourceNinja.userResourcesView && (viewItem == userResource || viewItem == userRemoteResource)",
    ),
    "Delete command should appear only for non-built-in user resources",
  );
  assert.doesNotMatch(
    itemMenus
      .filter((item) => item.command === "resourceNinja.deleteUserResource")
      .map((item) => item.when || "")
      .join("\n"),
    /builtInUserResource/,
    "Built-in User / Global Resource Home resources must remain read-only",
  );
  assert.doesNotMatch(
    itemMenus
      .filter((item) => item.command === "resourceNinja.deleteUserResource")
      .map((item) => item.when || "")
      .join("\n"),
    /readOnlyUserResource/,
    "Installed extension resources must remain read-only",
  );
  assert.match(userResourcesProviderSource, /builtInUserResource/);
  assert.match(userResourcesProviderSource, /readOnlyUserResource/);
  assert.match(extensionSource, /resourceNinja\.deleteUserResource/);
  assert.match(
    extensionSource,
    /resource\.isBuiltIn \|\| resource\.isReadOnly/,
  );
  assert.match(extensionSource, /getResourceMetadataPath/);
  assert.match(userResourcesProviderSource, /userRemoteResource/);
  assert.match(extensionSource, /resourceNinja\.reinstallUserResource/);
});

test("user global resources expose per-resource and group reinstall actions", () => {
  const itemMenus = packageJson.contributes?.menus?.["view/item/context"] || [];
  assert.ok(
    itemMenus.some(
      (item) =>
        item.command === "resourceNinja.reinstallUserResource" &&
        item.when ===
          "view == resourceNinja.userResourcesView && viewItem == userRemoteResource",
    ),
    "User / Global view should expose reinstall for remote-installed resources",
  );
  assert.ok(
    itemMenus.some(
      (item) =>
        item.command === "resourceNinja.reinstallUserResourceGroup" &&
        item.when ===
          "view == resourceNinja.userResourcesView && (viewItem == kind || viewItem == plugin)",
    ),
    "User / Global view should expose group reinstall for kind and plugin groups",
  );
});

test("built-in user resources remain openable and copyable", () => {
  const itemMenus = packageJson.contributes?.menus?.["view/item/context"] || [];
  for (const command of [
    "resourceNinja.openUserResource",
    "resourceNinja.revealUserResource",
    "resourceNinja.copyUserResourcePath",
  ]) {
    assert.ok(
      itemMenus.some(
        (item) =>
          item.command === command &&
          (item.when || "").includes("builtInUserResource") &&
          (item.when || "").includes("readOnlyUserResource"),
      ),
      `${command} should remain available for built-in and read-only extension resources`,
    );
  }
});

test("remote resources support repository-first and resource-type-first layouts", () => {
  const config = packageJson.contributes?.configuration?.properties || {};
  assert.deepStrictEqual(config["resourceNinja.remoteResourceViewMode"]?.enum, [
    "repositoryFirst",
    "resourceTypeFirst",
  ]);
  assert.strictEqual(
    config["resourceNinja.remoteResourceViewMode"]?.default,
    "repositoryFirst",
  );
  assert.ok(
    (packageJson.contributes?.commands || []).some(
      (command) =>
        command.command === "resourceNinja.toggleRemoteResourceViewMode",
    ),
    "Expected toggleRemoteResourceViewMode command contribution",
  );
  assert.ok(
    (packageJson.contributes?.menus?.["view/title"] || []).some(
      (item) =>
        item.command === "resourceNinja.toggleRemoteResourceViewMode" &&
        item.when === "view == resourceNinja.browseView",
    ),
    "Remote Resources toolbar should expose the layout toggle",
  );
  assert.match(extensionSource, /resourceNinja\.remoteResourceViewMode/);
  assert.match(extensionSource, /toggleRemoteResourceViewMode/);
  assert.match(treeProviderSource, /remoteResourceType/);
  assert.match(treeProviderSource, /remoteKindSource/);
  assert.match(treeProviderSource, /getRemoteResourceViewMode/);
  assert.match(treeProviderSource, /resourceTypeFirst/);
  assert.match(treeProviderSource, /pluginSection/);
  assert.match(treeProviderSource, /getPluginGroups/);
  assert.match(treeProviderSource, /getPluginIdFromPath/);
});

test("explicit source refresh works from both remote layouts", () => {
  assert.match(
    extensionSource,
    /item\?\.contextValue === "source"\s*\|\|\s*item\?\.contextValue === "remoteKindSource"/,
    "Update Source Index should accept source items from both browse layouts",
  );
  assert.match(
    extensionSource,
    /updateIndexFromSingleSource\([\s\S]*?\{ forceScan: true[,\s}]/,
    "Manual source refresh should bypass shared scan dedup when explicitly requested",
  );
  assert.match(
    indexUpdaterSource,
    /options\?: \{ forceScan\?: boolean[;,\s]/,
    "Single-source updater should expose a forceScan option for explicit refreshes",
  );
  assert.match(
    indexUpdaterSource,
    /!options\?\.forceScan && !\(await shouldRunSharedScan\(context, sourceId\)\)/,
    "Shared scan dedup should only apply when forceScan is not requested",
  );
});

test("source index updates keep the data-integrity guards wired", () => {
  assert.match(
    indexUpdaterSource,
    /reconcileSourceScanResult\(\{/,
    "Source updates should route scan results through the empty-scan reconcile guard",
  );
  assert.match(
    indexUpdaterSource,
    /assertSourceRepositoryIdentity\(\{/,
    "Repository scans should verify the recorded repository identity",
  );
  assert.match(
    indexUpdaterSource,
    /new Set\(updatedBundles\.map\(createBundleKey\)\)/,
    "Bundle preservation should key on source:id, not on a bare bundle id",
  );
  assert.doesNotMatch(
    indexUpdaterSource,
    /new Set\(updatedBundles\.map\(\(b\) => b\.id\)\)/,
    "Bundle preservation should not fall back to bare bundle ids",
  );
});

test("settings commands are reachable from every resource view toolbar", () => {
  const commands = packageJson.contributes?.commands || [];
  for (const commandId of [
    "resourceNinja.openSettings",
    "resourceNinja.resetSettings",
  ]) {
    assert.ok(
      commands.some((command) => command.command === commandId),
      `${commandId} command should remain available from the Command Palette`,
    );
  }
  const titleMenus = packageJson.contributes?.menus?.["view/title"] || [];
  for (const viewId of [
    "resourceNinja.installedView",
    "resourceNinja.userResourcesView",
    "resourceNinja.browseView",
  ]) {
    for (const commandId of [
      "resourceNinja.openSettings",
      "resourceNinja.resetSettings",
    ]) {
      assert.ok(
        titleMenus.some(
          (item) =>
            item.command === commandId && item.when === `view == ${viewId}`,
        ),
        `${commandId} should be visible from ${viewId}`,
      );
    }
  }
});

test("support command is reachable from every resource view toolbar", () => {
  const commands = packageJson.contributes?.commands || [];
  assert.ok(
    commands.some((command) => command.command === "resourceNinja.reportBug"),
    "Report a Bug command should remain available from the Command Palette",
  );
  const titleMenus = packageJson.contributes?.menus?.["view/title"] || [];
  for (const viewId of [
    "resourceNinja.installedView",
    "resourceNinja.userResourcesView",
    "resourceNinja.browseView",
  ]) {
    assert.ok(
      titleMenus.some(
        (item) =>
          item.command === "resourceNinja.reportBug" &&
          item.when === `view == ${viewId}`,
      ),
      `Report a Bug should be visible from ${viewId}`,
    );
  }
});

test("settings and support toolbar groups stay consistent", () => {
  const titleMenus = packageJson.contributes?.menus?.["view/title"] || [];
  for (const viewId of [
    "resourceNinja.installedView",
    "resourceNinja.userResourcesView",
    "resourceNinja.browseView",
  ]) {
    const viewMenus = titleMenus.filter(
      (item) => item.when === `view == ${viewId}`,
    );
    assert.strictEqual(
      viewMenus.find((item) => item.command === "resourceNinja.openSettings")
        ?.group,
      "z_settings@1",
      `${viewId} should keep Open Settings first in the settings group`,
    );
    assert.strictEqual(
      viewMenus.find((item) => item.command === "resourceNinja.resetSettings")
        ?.group,
      "z_settings@2",
      `${viewId} should keep Reset Settings second in the settings group`,
    );
    assert.strictEqual(
      viewMenus.find((item) => item.command === "resourceNinja.reportBug")
        ?.group,
      "z_support@1",
      `${viewId} should keep Report a Bug in the support group`,
    );
  }
});

test("reset settings command presents destructive intent", () => {
  const commands = packageJson.contributes?.commands || [];
  const resetCommand = commands.find(
    (command) => command.command === "resourceNinja.resetSettings",
  );
  assert.strictEqual(resetCommand?.icon, "$(warning)");
  assert.match(nls["command.resetSettings"], /\.\.\.$/);
  assert.match(nlsJa["command.resetSettings"], /\.\.\.$/);
});

test("reset settings resets every non-secret extension setting", () => {
  const config = packageJson.contributes?.configuration?.properties || {};
  const contributedSettings = Object.keys(config)
    .filter((setting) => setting.startsWith("resourceNinja."))
    .map((setting) => setting.replace(/^resourceNinja\./, ""))
    .filter((setting) => setting !== "githubToken" && setting !== "versionInfo")
    .sort();
  const resettableSettingsMatch = extensionSource.match(
    /const RESETTABLE_RESOURCE_NINJA_SETTINGS = \[([\s\S]*?)\] as const;/,
  );
  assert.ok(resettableSettingsMatch, "Expected resettable settings list");
  const resettableSettings = Array.from(
    resettableSettingsMatch[1].matchAll(/"([^"]+)"/g),
    (match) => match[1],
  ).sort();
  assert.ok(!resettableSettings.includes("githubToken"));
  assert.deepStrictEqual(resettableSettings, contributedSettings);
  assert.match(
    extensionSource,
    /for \(const setting of RESETTABLE_RESOURCE_NINJA_SETTINGS\)/,
  );
  assert.match(
    extensionSource,
    /githubToken[\s\S]*vscode\.ConfigurationTarget\.Global/,
  );
});

test("reset settings confirms destructive reset scopes", () => {
  assert.match(extensionSource, /showWarningMessage\(/);
  assert.match(extensionSource, /\{ modal: true \}/);
  assert.match(extensionSource, /messages\.resetConfirmSettings\(\)/);
  assert.match(extensionSource, /messages\.resetConfirmAll\(\)/);
  assert.match(extensionSource, /messages\.resetConfirmAction\(\)/);
  assert.match(
    extensionSource,
    /confirmation !== messages\.resetConfirmAction\(\)/,
  );
  assert.match(i18nSource, /resetConfirmSettings/);
  assert.match(i18nSource, /resetConfirmAll/);
  assert.match(i18nSource, /resetConfirmAction/);
});

test("github token setting is password-style and excluded from standard reset", () => {
  const config = packageJson.contributes?.configuration?.properties || {};
  assert.strictEqual(
    config["resourceNinja.githubToken"]?.editPresentation,
    "password",
  );
  assert.match(
    nls["config.githubToken.markdownDescription"],
    /Personal Access Token/,
  );
  assert.doesNotMatch(
    nls["config.githubToken.markdownDescription"],
    /scopes=|public_repo|repo,read:org|read:org/,
    "GitHub token settings should not encourage broad default scopes",
  );
  assert.match(
    nls["config.githubToken.markdownDescription"],
    /no repository scopes are required/,
  );
  assert.match(
    nlsJa["config.githubToken.markdownDescription"],
    /リポジトリ scope は不要/,
  );
});

test("plugin resources remain browsable from raw plugin paths", () => {
  // The generator imports the real rules, so assert behaviour instead of its source shape.
  const generator = require("./update-preset-index.js");
  assert.strictEqual(
    generator.detectResourceKindFromPath("plugins/foo/agents/reviewer.md"),
    "agent",
  );
  assert.strictEqual(
    generator.detectPluginChildResourceKind("agents/reviewer.md"),
    "agent",
  );
  assert.match(presetIndexUpdaterSource, /plugin:\$\{pluginId\}/);
  assert.match(presetIndexUpdaterSource, /detectResourceKindWithPluginRoots/);
  assert.match(resourceKindsSource, /getPluginIdFromPath/);
  assert.match(resourceKindsSource, /pluginPrefix/);
  assert.match(resourceKindsSource, /agents/);
  assert.match(
    skillIndexSource,
    /localSkill\.pluginRoot !== mergedSkill\.pluginRoot/,
  );
  assert.match(
    skillIndexSource,
    /localBundle\.safetyBoundary !== mergedBundle\.safetyBoundary/,
  );
});

test("install target picker uses localized resource-aware labels", () => {
  for (const messageName of [
    "installTargetWorkspaceLabel",
    "installTargetUserProfileLabel",
    "installTargetCopilotHomeLabel",
    "installTargetCustomLabel",
  ]) {
    assert.match(
      extensionSource,
      new RegExp(`messages\\.${messageName}\\(`),
      `Install target picker should use ${messageName}`,
    );
  }
  assert.match(
    extensionSource,
    /previewTargetPath\(skill,\s*"userData"\)/,
    "Install target picker should show a resource-aware User Profile path preview",
  );
  assert.match(
    extensionSource,
    /getResourceTargetUri\([\s\S]*activeWorkspaceFolder\.uri,[\s\S]*config,[\s\S]*skill,/,
    "Install target picker should preview the actual configured target path",
  );
});

test("click installs default to workspace while explicit install still asks", () => {
  const config = packageJson.contributes?.configuration?.properties || {};
  assert.strictEqual(
    config["resourceNinja.defaultInstallTarget"]?.default,
    "workspace",
  );
  assert.deepStrictEqual(config["resourceNinja.defaultInstallTarget"]?.enum, [
    "workspace",
    "ask",
    "userData",
    "globalHome",
  ]);
  assert.match(extensionSource, /resourceNinja\.installDefault/);
  assert.match(extensionSource, /getDefaultInstallTarget/);
  assert.match(extensionSource, /resolveDefaultInstallTarget/);
  assert.match(
    extensionSource,
    /registerCommand\(\s*"resourceNinja\.install"[\s\S]*installResource\(skillOrItem,\s*"ask"\)/,
    "Explicit Install Resource command should keep showing the target picker",
  );
  assert.match(
    extensionSource,
    /registerCommand\(\s*"resourceNinja\.installDefault"[\s\S]*installResource\(skillOrItem,\s*"default"\)/,
    "Click install command should use the configured default target",
  );
  assert.match(
    treeProviderSource,
    /resourceNinja\.installDefault/,
    "Remote tree click actions should use the default install target command",
  );
  assert.match(
    nls["config.resourcesDirectory.markdownDescription"],
    /Workspace Skill Directory[\s\S]*workspace-relative, absolute, and `~\/` paths/,
    "Settings copy should explain configurable workspace skill paths",
  );
  assert.match(
    nls["config.defaultInstallTarget.markdownDescription"],
    /Workspace[\s\S]*User Profile[\s\S]*Global Resource Home[\s\S]*Custom/,
    "Default target settings copy should explain multi-scope routing and Custom picker behavior",
  );
  assert.ok(
    config["resourceNinja.defaultInstallTarget"]?.order <
      config["resourceNinja.singleClickInstall"]?.order,
    "Default target should remain before single-click install",
  );
});

test("resource install and scan roots are configurable per scope and kind", () => {
  const config = packageJson.contributes?.configuration?.properties || {};
  const expectedSettings = [
    "resourceNinja.workspaceAgentsDirectory",
    "resourceNinja.workspaceInstructionsDirectory",
    "resourceNinja.workspacePromptsDirectory",
    "resourceNinja.workspaceHooksDirectory",
    "resourceNinja.workspaceMcpDirectory",
    "resourceNinja.userAgentsDirectory",
    "resourceNinja.userInstructionsDirectory",
    "resourceNinja.userPromptsDirectory",
    "resourceNinja.globalResourceHomePreset",
    "resourceNinja.globalHomeDirectory",
  ];
  for (const setting of expectedSettings) {
    assert.ok(config[setting], `Missing setting: ${setting}`);
  }

  assert.strictEqual(
    config["resourceNinja.workspaceAgentsDirectory"]?.default,
    ".github/agents",
  );
  assert.strictEqual(
    config["resourceNinja.workspaceMcpDirectory"]?.default,
    ".github/mcp",
  );
  assert.strictEqual(
    config["resourceNinja.globalResourceHomePreset"]?.default,
    "copilot",
  );
  assert.strictEqual(config["resourceNinja.globalHomeDirectory"]?.default, "");
  assert.deepStrictEqual(
    config["resourceNinja.globalResourceHomePreset"]?.enum,
    ["copilot", "claude", "agents", "custom"],
  );
  assert.match(skillInstallerSource, /getConfiguredWorkspaceAgentsDirectory/);
  assert.match(skillInstallerSource, /getConfiguredWorkspaceMcpDirectory/);
  assert.match(skillInstallerSource, /getConfiguredUserPromptsDirectory/);
  assert.match(
    skillInstallerSource,
    /getConfiguredUserAgentsDirectory\(config\) \|\|[\s\S]*getConfiguredUserPromptsDirectory\(config\)/,
    "User Profile agents should default to the VS Code User prompts folder when no agent override is configured",
  );
  assert.match(skillInstallerSource, /getConfiguredGlobalHomeDirectory/);
  assert.match(
    customizationPathsSource,
    /getDefaultGlobalHomeDirectoryForPreset[\s\S]*"~\/\.claude"[\s\S]*"~\/\.agents"/,
  );
  assert.match(localSkillScannerSource, /getConfiguredWorkspaceResourceRoots/);
  assert.match(localSkillScannerSource, /resolveConfiguredUri/);
  assert.match(localSkillScannerSource, /getWorkspaceRelativeOrAbsolutePath/);
  assert.match(skillInstallerSource, /isAbsoluteResourcePath/);
  assert.match(userResourceScannerSource, /getConfiguredUserPromptsDirectory/);
  assert.match(
    userResourceScannerSource,
    /vscode\.Uri\.joinPath\(userDataUri, "agents"\)/,
    "User / Global scan should still include legacy VS Code User agents installs",
  );
  assert.match(
    userResourceScannerSource,
    /vscode\.Uri\.joinPath\(userDataUri, "prompts"\)/,
    "User / Global scan should include VS Code User prompts, where .agent.md files are discoverable",
  );
  assert.match(userResourceScannerSource, /getConfiguredGlobalHomeDirectory/);
  assert.match(userResourceScannerSource, /globalStorage/);
  assert.match(userResourceScannerSource, /vscode\.env\.appRoot/);
  assert.match(userResourceScannerSource, /vscode\.extensions\.all/);
  assert.match(userResourceScannerSource, /isVsCodeBundledExtension/);
  assert.match(userResourceScannerSource, /resources\\\/app\\\/extensions/);
  assert.match(userResourceScannerSource, /assets[\s\S]*prompts/);
  assert.match(
    userResourceScannerSource,
    /extension\.extensionUri[\s\S]*"skills"/,
  );
  assert.match(userResourceScannerSource, /builtInOnly/);
  assert.doesNotMatch(userResourceScannerSource, /import \* as path/);
  assert.doesNotMatch(userResourceScannerSource, /Buffer\.from/);
  assert.match(userResourceScannerSource, /openTextDocument/);
});

test("settings order keeps install and destination paths first", () => {
  const config = packageJson.contributes?.configuration?.properties || {};
  const orderOf = (setting) => config[setting]?.order;
  const orderedSettings = [
    "resourceNinja.defaultInstallTarget",
    "resourceNinja.singleClickInstall",
    "resourceNinja.resourcesDirectory",
    "resourceNinja.additionalSkillRoots",
    "resourceNinja.workspaceAgentsDirectory",
    "resourceNinja.workspaceInstructionsDirectory",
    "resourceNinja.workspacePromptsDirectory",
    "resourceNinja.workspaceHooksDirectory",
    "resourceNinja.workspaceMcpDirectory",
    "resourceNinja.userAgentsDirectory",
    "resourceNinja.userInstructionsDirectory",
    "resourceNinja.userPromptsDirectory",
    "resourceNinja.globalResourceHomePreset",
    "resourceNinja.globalHomeDirectory",
    "resourceNinja.autoUpdateInstruction",
    "resourceNinja.instructionFile",
    "resourceNinja.customInstructionPath",
    "resourceNinja.includeLocalResources",
    "resourceNinja.autoUpdateResourcesOnUpgrade",
    "resourceNinja.useRefOutput",
    "resourceNinja.outputFormat",
    "resourceNinja.refCatalogFormat",
    "resourceNinja.showBuiltInResources",
    "resourceNinja.remoteResourceViewMode",
    "resourceNinja.language",
    "resourceNinja.githubToken",
    "resourceNinja.instructionBlock.includeAgents",
    "resourceNinja.instructionBlock.includeInstructions",
    "resourceNinja.instructionBlock.globalHome.includeAgents",
    "resourceNinja.instructionBlock.globalHome.includeInstructions",
    "resourceNinja.registerPluginLocation",
  ];

  for (let index = 1; index < orderedSettings.length; index += 1) {
    assert.ok(
      orderOf(orderedSettings[index - 1]) < orderOf(orderedSettings[index]),
      `${orderedSettings[index - 1]} should appear before ${orderedSettings[index]}`,
    );
  }
});

test("workspace installed non-skill resources preserve source metadata", () => {
  assert.match(localSkillScannerSource, /getBuiltInResourceSourceLabel/);
  assert.match(
    localSkillScannerSource,
    /installMeta\?\.source \|\| "local"/,
    "Local scanner should preserve sidecar source metadata for non-built-in resources",
  );
  assert.match(
    treeProviderSource,
    /source: local\.source \|\| \(isInstalled \? undefined : "local"\)/,
    "Workspace tree should not drop sidecar source metadata for installed non-skill resources",
  );
  assert.doesNotMatch(
    treeProviderSource,
    /source: isInstalled \? undefined : "local"/,
    "Old source-dropping expression should not return",
  );
});

test("stale source index freshness setting is wired through manifest docs and code", () => {
  const config = packageJson.contributes?.configuration?.properties || {};
  const setting = config["resourceNinja.staleSourceIndexUpdateMode"];
  assert.ok(setting, "Missing stale source index update mode setting");
  assert.strictEqual(setting.default, "prompt");
  assert.deepStrictEqual(setting.enum, ["always", "prompt", "never"]);
  assert.strictEqual(setting.order, 23);
  for (const key of [
    "config.staleSourceIndexUpdateMode.markdownDescription",
    "config.staleSourceIndexUpdateMode.always",
    "config.staleSourceIndexUpdateMode.prompt",
    "config.staleSourceIndexUpdateMode.never",
  ]) {
    assert.ok(nls[key], `Missing English NLS key: ${key}`);
    assert.ok(nlsJa[key], `Missing Japanese NLS key: ${key}`);
  }
  assert.match(readme, /staleSourceIndexUpdateMode/);
  assert.match(readmeJa, /staleSourceIndexUpdateMode/);
  assert.match(
    customizationPathsSource,
    /getConfiguredStaleSourceIndexUpdateMode/,
  );
  assert.match(sourceFreshnessSource, /STALE_SOURCE_INDEX_DAYS\s*=\s*30/);
});

test("plugin location registration setting is wired through manifest and code", () => {
  const config = packageJson.contributes?.configuration?.properties || {};
  const setting = config["resourceNinja.registerPluginLocation"];
  assert.ok(setting, "Missing plugin location registration setting");
  assert.strictEqual(setting.type, "string");
  assert.strictEqual(setting.default, "prompt");
  assert.deepStrictEqual(setting.enum, ["always", "prompt", "never"]);
  assert.strictEqual(setting.order, 35);
  for (const key of [
    "config.registerPluginLocation.markdownDescription",
    "config.registerPluginLocation.always",
    "config.registerPluginLocation.prompt",
    "config.registerPluginLocation.never",
  ]) {
    assert.ok(nls[key], `Missing English NLS key: ${key}`);
    assert.ok(nlsJa[key], `Missing Japanese NLS key: ${key}`);
  }
  assert.match(extensionSource, /offerPluginLocationRegistration/);
  assert.match(
    extensionSource,
    /update\(\s*"pluginLocations"[\s\S]*?ConfigurationTarget\.Global/,
    "Plugin locations must be written to user settings, not workspace settings",
  );
  assert.match(
    extensionSource,
    /if \(choice !== registerAction\) \{\s*return;\s*\}\s*\}\s*try \{[\s\S]*?getConfiguration\("chat"\);\s*const merged = mergePluginLocations\(/,
    "The setting must be re-read after the prompt so user think time cannot discard a concurrent change",
  );
  assert.match(
    extensionSource,
    /getPluginLocationsToRegister\([\s\S]*?\)\.length === 0/,
    "Registration must skip the prompt when every key is already enabled",
  );
  assert.match(
    skillInstallerSource,
    /collectPluginLocationKeysForRemoval\(\s*existing,\s*deletedFsPaths,\s*pluginFolderName,\s*isContainedPath,?\s*\)/,
    "Removal must derive keys from the deleted paths, bounded upwards by the plugin folder and downwards by real path containment",
  );
});

test("plugin location registration is gated on a VS Code that has the setting", () => {
  const offerStart = extensionSource.indexOf(
    "async function offerPluginLocationRegistration(",
  );
  const unregisterStart = skillInstallerSource.indexOf(
    "export async function unregisterPluginLocations(",
  );
  assert.ok(offerStart > -1, "Missing offerPluginLocationRegistration");
  assert.ok(unregisterStart > -1, "Missing unregisterPluginLocations");
  const offerSource = extensionSource.slice(
    offerStart,
    extensionSource.indexOf("type CreateResourceScope", offerStart),
  );
  const unregisterSource = skillInstallerSource.slice(
    unregisterStart,
    skillInstallerSource.indexOf(
      "export async function uninstallSkill(",
      unregisterStart,
    ),
  );

  for (const [label, body] of [
    ["offerPluginLocationRegistration", offerSource],
    ["unregisterPluginLocations", unregisterSource],
  ]) {
    const guardIndex = body.indexOf(
      "if (!supportsPluginLocations(vscode.version))",
    );
    assert.ok(
      guardIndex > -1,
      `${label} must check the VS Code version before touching chat.pluginLocations`,
    );
    const configIndex = body.indexOf('getConfiguration("chat")');
    assert.ok(
      configIndex > guardIndex,
      `${label} must run the version guard before reading the chat configuration`,
    );
    assert.ok(
      body.indexOf("update(") > guardIndex,
      `${label} must run the version guard before writing the setting`,
    );
  }

  const promptIndex = offerSource.indexOf("showInformationMessage");
  assert.ok(
    promptIndex >
      offerSource.indexOf("if (!supportsPluginLocations(vscode.version))"),
    "The version guard must run before the user is prompted",
  );
  assert.ok(
    offerSource.indexOf('getConfiguration("resourceNinja")') >
      offerSource.indexOf("if (!supportsPluginLocations(vscode.version))"),
    "The version guard must run before the registerPluginLocation mode is read",
  );

  // A log line is not a signal the user reads, so the unsupported build has to
  // surface a notification unless the user opted out with `never`.
  const unsupportedBlock = offerSource.slice(
    offerSource.indexOf("if (!supportsPluginLocations(vscode.version))"),
    promptIndex,
  );
  assert.match(
    unsupportedBlock,
    /showWarningMessage\(/,
    "An unsupported VS Code build must warn the user, not only write a log line",
  );
  assert.match(
    unsupportedBlock,
    /!==\s*"never"/,
    "The unsupported-build warning must respect the never opt-out",
  );

  assert.match(
    offerSource,
    /messages\.pluginLocationOpenSettingAction\(\)/,
    "The success notification must offer a way to reach the setting",
  );
  assert.match(
    offerSource,
    /"workbench\.action\.openSettings",\s*"chat\.pluginLocations",/,
    "The success action must open the setting it wrote",
  );

  const jaStart = i18nSource.indexOf("const jaMessages");
  const enStart = i18nSource.indexOf("const enMessages");
  const enEnd = i18nSource.indexOf("function getCurrentLanguage");
  assert.ok(
    jaStart > -1 && enStart > jaStart && enEnd > enStart,
    "Could not locate the i18n message dictionaries",
  );
  const dictionaries = [
    ["Japanese", i18nSource.slice(jaStart, enStart)],
    ["English", i18nSource.slice(enStart, enEnd)],
  ];
  for (const [language, dictionary] of dictionaries) {
    for (const key of [
      "pluginLocationOpenSettingAction",
      "pluginLocationUnsupportedVersion",
      "pluginLocationRegisterPrompt",
      "pluginLocationRegisterPromptMultiple",
      "pluginLocationRegistered",
    ]) {
      assert.ok(
        dictionary.includes(`${key}:`),
        `Missing ${language} i18n key: ${key}`,
      );
    }
    // The prompt has to say which setting it writes and that it is the user's.
    for (const promptKey of [
      "pluginLocationRegisterPrompt",
      "pluginLocationRegisterPromptMultiple",
      "pluginLocationRegistered",
    ]) {
      const keyIndex = dictionary.indexOf(`${promptKey}:`);
      const messageText = dictionary.slice(keyIndex, keyIndex + 400);
      assert.ok(
        messageText.includes("chat.pluginLocations"),
        `${language} ${promptKey} must name the setting it changes`,
      );
      assert.ok(
        /user settings|ユーザー設定/.test(messageText),
        `${language} ${promptKey} must say the write goes to user settings`,
      );
    }

    // An unsupported build must tell the user the consequence and the remedy,
    // not just that something was skipped.
    const unsupportedIndex = dictionary.indexOf(
      "pluginLocationUnsupportedVersion:",
    );
    const unsupportedText = dictionary.slice(
      unsupportedIndex,
      unsupportedIndex + 400,
    );
    assert.ok(
      unsupportedText.includes("1.116"),
      `${language} pluginLocationUnsupportedVersion must name the version that fixes it`,
    );
    assert.ok(
      /will not load|読み込まれません/.test(unsupportedText),
      `${language} pluginLocationUnsupportedVersion must state that the plugin will not load`,
    );
  }
});

test("every delete path that can remove a plugin folder unregisters it, and a reinstall re-registers", () => {
  // The delete paths are enumerated from the source instead of being listed
  // here, so a new one added without unregistration fails this guard.
  const files = [
    ["src/extension.ts", extensionSource],
    ["src/skillInstaller.ts", skillInstallerSource],
  ];
  // Plugin-aware: the unit resolves the plugin root from the manifest path, or
  // delegates to a helper that does, so the folder it removes IS the plugin.
  const pluginAwareDeleteMarkers = [
    "deleteInstalledResourceByPath(",
    "uninstallSkillByPath(",
  ];
  // Collateral: `uninstallSkill` deletes `<skillsRoot>/<name>` recursively
  // without looking at the resource kind, and the skills root is a configurable
  // path, so a plugin folder can be removed through it. Its callers still owe
  // the unregistration, but what they reinstall is a skill, not a plugin.
  const collateralDeleteMarkers = ["uninstallSkill("];
  const pluginDeleteMarkers = [
    ...pluginAwareDeleteMarkers,
    ...collateralDeleteMarkers,
  ];
  // `uninstallSkill(` ends with `installSkill(`, so a plain substring test reads
  // every uninstall as a reinstall — which is how a reinstall that never
  // re-registers stayed invisible.
  const reinstallCallPattern = /(?<![A-Za-z0-9_$.])installSkill\(/;
  const units = [];
  for (const [file, source] of files) {
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const addUnit = (name, node) => {
      if (!name) return;
      units.push({
        file,
        name,
        start: node.getStart(sourceFile),
        end: node.end,
        source,
      });
    };
    const visit = (node) => {
      if (ts.isFunctionDeclaration(node) && node.name) {
        addUnit(node.name.text, node);
      } else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
        addUnit(node.name.text, node);
      } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        const initializer = node.initializer;
        if (
          initializer &&
          (ts.isArrowFunction(initializer) ||
            ts.isFunctionExpression(initializer) ||
            (ts.isCallExpression(initializer) &&
              initializer.expression
                .getText(sourceFile)
                .endsWith(".registerCommand")))
        ) {
          addUnit(node.name.text, node.parent.parent);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  function findUnit(file, index) {
    return units
      .filter(
        (unit) => unit.file === file && unit.start <= index && index < unit.end,
      )
      .sort(
        (left, right) => left.end - left.start - (right.end - right.start),
      )[0];
  }

  const unitBody = (unit) => unit.source.slice(unit.start, unit.end);

  // A unit is a delete path when it calls a marker, and also when it IS the
  // helper a marker names: a helper that performs the delete itself owes the
  // unregistration in its own body instead of being exempted as a primitive.
  const deletePaths = new Map();
  const recordDeletePath = (unit, marker) => {
    const key = `${unit.file}:${unit.name}`;
    const entry = deletePaths.get(key) || { unit, markers: new Set() };
    entry.markers.add(marker);
    deletePaths.set(key, entry);
  };

  for (const [file, source] of files) {
    for (const marker of pluginDeleteMarkers) {
      let index = source.indexOf(marker);
      while (index !== -1) {
        const lineStart = source.lastIndexOf("\n", index) + 1;
        const lineEnd = source.indexOf("\n", index);
        const line = source.slice(
          lineStart,
          lineEnd === -1 ? source.length : lineEnd,
        );
        const isDeclaration = /function \w+\s*\($/.test(line.trimEnd());
        const unit = findUnit(file, index);
        assert.ok(
          unit,
          `Could not attribute ${marker} at ${file}:${index} to a function`,
        );
        if (!isDeclaration || unit.name === marker.slice(0, -1)) {
          recordDeletePath(unit, marker);
        }
        index = source.indexOf(marker, index + marker.length);
      }
    }
  }

  assert.ok(
    deletePaths.size >= 8,
    `Expected the plugin delete paths to be discovered, found ${deletePaths.size}`,
  );
  for (const required of [
    "src/extension.ts:deleteInstalledResourceByPath",
    "src/skillInstaller.ts:uninstallSkill",
    "src/skillInstaller.ts:uninstallSkillByPath",
  ]) {
    assert.ok(
      deletePaths.has(required),
      `${required} deletes a folder that can be a plugin and must be enumerated, found ${Array.from(
        deletePaths.keys(),
      ).join(", ")}`,
    );
  }

  // Which helpers a caller may lean on is read out of the source, so a helper
  // that stops unregistering pushes the obligation back onto every caller
  // instead of leaving a hand-written exemption behind.
  const unitByName = new Map(units.map((unit) => [unit.name, unit]));
  const delegatesUnregistration = new Set();
  for (const marker of pluginDeleteMarkers) {
    const helper = unitByName.get(marker.slice(0, -1));
    if (helper && unitBody(helper).includes("unregisterPluginLocations(")) {
      delegatesUnregistration.add(marker);
    }
  }

  const covered = [];
  const reinstallCovered = [];
  // Every violation is reported, not only the first: a helper that stops
  // unregistering fails its callers too, and the helper is the one to fix.
  const missingUnregistration = [];
  const missingReregistration = [];
  for (const [key, { unit, markers }] of deletePaths) {
    const body = unitBody(unit);
    const ownMarker = `${unit.name}(`;
    const unregisters =
      body.includes("unregisterPluginLocations(") ||
      Array.from(delegatesUnregistration).some(
        (marker) => marker !== ownMarker && body.includes(marker),
      );
    if (!unregisters) {
      missingUnregistration.push(key);
    }
    covered.push(key);

    // A reinstall recreates the folder, but the destination is computed from the
    // install options and is not required to be where the resource was removed
    // from, so the registration has to be offered again rather than assumed.
    const isPluginAware = pluginAwareDeleteMarkers.some((marker) =>
      markers.has(marker),
    );
    if (isPluginAware && reinstallCallPattern.test(body)) {
      if (!body.includes("offerPluginLocationRegistration(")) {
        missingReregistration.push(key);
      }
      reinstallCovered.push(key);
    }
  }

  assert.strictEqual(
    missingUnregistration.join(", "),
    "",
    `these remove a plugin folder but neither call unregisterPluginLocations nor delegate to a helper that does: ${missingUnregistration.join(", ")}`,
  );
  assert.strictEqual(
    missingReregistration.join(", "),
    "",
    `these remove a plugin folder and reinstall it, but never re-register the destination through offerPluginLocationRegistration: ${missingReregistration.join(", ")}`,
  );

  assert.ok(
    covered.length >= 8,
    `Expected at least 8 covered plugin delete paths, found ${covered.length}: ${covered.join(", ")}`,
  );
  assert.ok(
    covered.some((key) => key.startsWith("src/skillInstaller.ts:")),
    `The uninstall path in skillInstaller must be covered, found ${covered.join(", ")}`,
  );
  for (const required of [
    "src/extension.ts:reinstallCmd",
    "src/extension.ts:reinstallUserResourceCmd",
  ]) {
    assert.ok(
      reinstallCovered.includes(required),
      `${required} must be checked for re-registration, found ${reinstallCovered.join(", ")}`,
    );
  }
});

test("source freshness metadata is preserved and stamped only on successful scans", () => {
  assert.match(skillIndexSource, /lastIndexedAt\?: string/);
  assert.match(sharedManifestSource, /\| "lastIndexedAt"/);
  assert.match(
    sharedSourcesManifestStoreSource,
    /lastIndexedAt: source\.lastIndexedAt/,
  );
  assert.match(indexUpdaterSource, /stampIndexedSources/);
  assert.match(indexUpdaterSource, /scannedSourceIds/);
  assert.match(
    indexUpdaterSource,
    /updateSharedScanMetadata\([\s\S]*indexedAt/,
  );
  assertResourceSuiteRuns("test-source-index-freshness.js");
  assertResourceSuiteRuns("test-shared-sources-manifest.js");
});

test("startup stale update flow avoids duplicate missing-index prompts", () => {
  assert.match(extensionSource, /runStartupIndexMaintenance/);
  assert.match(extensionSource, /startupIndexMaintenanceStarted/);
  assert.match(extensionSource, /STALE_SOURCE_PROMPT_DATE_KEY/);
  assert.match(extensionSource, /resourceNinja\.staleSourceLastPromptDate/);
  assert.match(extensionSource, /collectMissingIndexedInstalledSkills/);
  assert.match(extensionSource, /collectStaleSources/);
  assert.match(
    extensionSource,
    /return;[\s\S]*const config = vscode\.workspace\.getConfiguration\("resourceNinja"\)/,
  );
  assert.match(
    extensionSource,
    /updateIndexFromSingleSource\([\s\S]*forceScan: true/,
  );
  assert.match(
    extensionSource,
    /if \(choice !== updateAction\) \{\s*await context\.globalState\.update\(STALE_SOURCE_PROMPT_DATE_KEY, today\);/,
    "Deferring stale source updates should record the daily prompt only after the user defers",
  );
  assert.match(
    extensionSource,
    /if \(failures\.length === 0 && staleUpdateMode !== "always"\) \{\s*await context\.globalState\.update\(/,
    "Successful prompt-driven stale source updates should record the daily prompt after updates finish",
  );
  assert.match(extensionSource, /runSourceIndexUpdateBatch\(/);
  assert.match(extensionSource, /scaleSourceIndexProgressIncrement\(/);
  assert.match(extensionSource, /\[Source Index\] \[SKIPPED\]/);
});

test("chat participant and MCP short responses use runtime localization helpers", () => {
  assert.match(chatParticipantSource, /function chatText/);
  assert.match(chatParticipantSource, /isJapanese\(\)/);
  assert.match(chatParticipantSource, /getLocalizedDescription/);
  assert.match(mcpToolsSource, /export function localizeMcpText/);
  assert.match(mcpToolsSource, /export function formatMcpError/);
  assert.match(
    mcpToolsSource,
    /error instanceof Error \? error\.message : String\(error\)/,
  );
  assert.match(mcpToolsSource, /mcpContextUnavailableMessage/);
  assert.doesNotMatch(
    chatParticipantSource,
    /label: "\$\(search\) Search Resources"/,
  );
  assert.doesNotMatch(
    mcpToolsSource,
    /new vscode\.LanguageModelTextPart\(`❌ Extension context not available\.`\)/,
  );
});

test("settings distinguish skill index sync from native non-skill resource paths", () => {
  const config = packageJson.contributes?.configuration?.properties || {};
  assert.match(
    nls["config.instructionFile.markdownDescription"],
    /generated instruction block/,
  );
  assert.match(
    nls["config.instructionFile.markdownDescription"],
    /index, not a copy/,
  );
  assert.match(
    nls["config.autoUpdateInstruction.markdownDescription"],
    /resource install\/uninstall[\s\S]*shared `agent-ninja` block[\s\S]*legacy `resource-ninja` skill block/,
  );
  assert.match(
    nls["config.includeLocalResources.markdownDescription"],
    /SKILL\.md[\s\S]*generated instruction block/,
  );
  assert.match(
    nls["config.instructionBlock.includeAgents.markdownDescription"],
    /Add `agent` resources[\s\S]*AGENTS\.md[\s\S]*workspace targets[\s\S]*Default: off/,
  );
  assert.match(
    nls["config.instructionBlock.includeInstructions.markdownDescription"],
    /Add `instruction` resources[\s\S]*AGENTS\.md[\s\S]*workspace targets[\s\S]*Default: off/,
  );
  assert.match(
    nls["config.instructionBlock.globalHome.includeAgents.markdownDescription"],
    /inherit[\s\S]*do not need to enter the same choice twice/,
  );
  assert.match(
    nls[
      "config.instructionBlock.globalHome.includeInstructions.markdownDescription"
    ],
    /inherit[\s\S]*do not need to enter the same choice twice/,
  );
  assert.match(
    nls["config.kindsExcluded.markdownDescription"],
    /Deprecated compatibility[\s\S]*`skill` is always kept/,
  );
  assert.match(
    nls["config.resourcesDirectory.markdownDescription"],
    /workspace-relative, absolute, and `~\/` paths/,
  );
  assert.match(
    nls["config.workspaceAgentsDirectory.markdownDescription"],
    /Workspace Agent Directory/,
  );
  assert.match(
    nls["config.globalHomeDirectory.markdownDescription"],
    /Global Resource Home Directory override/,
  );
  assert.match(
    nls["config.globalHomeDirectory.markdownDescription"],
    /overrides the selected/,
  );
  assert.match(
    nls["config.globalResourceHomePreset.markdownDescription"],
    /Global Resource Home Preset/,
  );
  assert.match(
    nls["config.instructionFile.markdownDescription"],
    /~\/\.copilot\/copilot-instructions\.md/,
  );
  assert.ok(
    config["resourceNinja.instructionFile"]?.enum?.includes(
      "~/.copilot/copilot-instructions.md",
    ),
    "Instruction file setting should offer the Copilot CLI global local instructions file",
  );
  assert.match(instructionManagerSource, /resolveInstructionSkillSource/);
  assert.match(instructionManagerSource, /getInstructionBlockKindsForRuntime/);
  assert.match(instructionManagerSource, /getInstalledSkillsWithMetaFromRoot/);
  assert.match(
    instructionManagerSource,
    /isSameOrInside\(globalHomeUri, instructionUri\)/,
  );
  assert.match(instructionManagerSource, /skillSource\.scope === "workspace"/);
  assertResourceSuiteRuns("test-global-home-routing.js");
  assertResourceSuiteRuns(
    "test-instruction-block-policy.js",
    "Resource test suite should validate instruction block policy defaults and overrides",
  );
  assertResourceSuiteRuns(
    "test-create-resource-templates.js",
    "Resource test suite should validate generated Create Resource templates",
  );
  assertResourceSuiteRuns(
    "test-create-resource-flow.js",
    "Resource test suite should validate Create Resource cancellation, preview, and write-error flow",
  );
  assertResourceSuiteRuns(
    "test-create-resource-validation.js",
    "Resource test suite should validate Create Resource input and path limits",
  );
  assertResourceSuiteRuns(
    "test-instruction-target-ux.js",
    "Resource test suite should validate instruction target UX wording",
  );
  assertResourceSuiteRuns(
    "test-localization-ux.js",
    "Resource test suite should validate localization and command label UX",
  );
  assertResourceSuiteRuns(
    "test-readme-release-ux.js",
    "Resource test suite should validate README and Marketplace-facing release UX",
  );
  assertResourceSuiteRuns(
    "test-view-welcome-ux.js",
    "Resource test suite should validate empty-state view welcome UX",
  );
  assertResourceSuiteRuns(
    "test-activation-ux.js",
    "Resource test suite should validate lazy activation UX and performance",
  );
  assertResourceSuiteRuns(
    "test-release-hygiene.js",
    "Resource test suite should validate release hygiene and packaged payload exclusions",
  );
  assertResourceSuiteRuns(
    "test-mcp-config-merge.js",
    "Resource test suite should validate MCP config merge behavior",
  );
  assertResourceSuiteRuns(
    "test-coexistence-ref-catalog-cleanup.js",
    "Resource test suite should validate stale sibling coexistence catalog cleanup against a real compressed README fixture",
  );
  assertResourceSuiteRuns(
    "test-skill-installer-auth-fallback.js",
    "Resource test suite should validate installer auth fallback and runtime GitHub resolution behavior",
  );
  assertResourceSuiteRuns(
    "test-audit-resource-installability.js",
    "Resource test suite should validate bundled remote installability audit coverage",
  );
  assertResourceSuiteRuns(
    "test-update-preset-index-fallback.js",
    "Resource test suite should validate preset updater rate-limit fallback and source-synchronized bundles",
  );
  assert.strictEqual(
    packageJson.scripts?.["audit:runtime"],
    "npm audit --omit=dev --audit-level=moderate",
    "Runtime dependency audit should remain an explicit release gate",
  );
  assertResourceSuiteRuns(
    "test-temporary-install-source.js",
    "Resource test suite should validate temporary preview or web-search installs without a persisted source entry",
  );
  assertResourceSuiteRuns(
    "test-shared-file-serialization.js",
    "Resource test suite should validate that shared-file writers are serialized",
  );
  assertResourceSuiteRuns(
    "test-changelog-hygiene.js",
    "Resource test suite should validate changelog format, version sync, and replacement-character hygiene",
  );
});

test("every scripts/test-*.js is either executed or explicitly declared as a network test", () => {
  assert.strictEqual(
    packageJson.scripts?.["test:resources"],
    "node scripts/run-resource-tests.js",
    "test:resources should stay the single aggregate entry point",
  );

  const runnerSource = fs.readFileSync(
    path.join(repoRoot, "scripts", "run-resource-tests.js"),
    "utf8",
  );
  assert.match(
    runnerSource,
    /readdirSync\(scriptsDir[\s\S]*\/\^test-\.\*\\\.js\$\//,
    "The runner must discover scripts/test-*.js at run time, not from a hard-coded list",
  );

  // A reintroduced hard-coded list would show up as script names baked into the runner.
  const literalScriptNames = new Set(
    Array.from(runnerSource.matchAll(/"(test-[a-z0-9-]+\.js)"/g)).map(
      (match) => match[1],
    ),
  );
  for (const fileName of literalScriptNames) {
    assert.ok(
      skippedResourceTests.includes(fileName),
      `${fileName} is hard-coded in the runner but is not a declared network test`,
    );
  }

  const covered = new Set([...executedResourceTests, ...skippedResourceTests]);
  // Enumerated here rather than through the runner so a narrowed discovery
  // filter cannot hide a script from its own guard.
  const testScriptsOnDisk = fs
    .readdirSync(path.join(repoRoot, "scripts"))
    .filter((fileName) => /^test-.*\.js$/.test(fileName))
    .sort();
  for (const fileName of testScriptsOnDisk) {
    assert.ok(
      covered.has(fileName),
      `scripts/${fileName} would be neither executed nor explicitly skipped`,
    );
  }
  assert.strictEqual(
    covered.size,
    testScriptsOnDisk.length,
    "Executed plus skipped must equal every scripts/test-*.js on disk",
  );

  // Widening this set hides a gate, so it stays a ratchet against an explicit
  // baseline: membership was measured by preloading a module that throws from
  // fetch/http/https and seeing which scripts fail. Adding an entry must be a
  // deliberate edit here, and removing one must shrink this list.
  const JUSTIFIED_NETWORK_TESTS = [
    "test-azure-skills-source.js",
    "test-copilot-plugins-upstream.js",
    "test-microsoft-install-e2e.js",
  ];
  assert.deepStrictEqual(
    [...skippedResourceTests].sort(),
    [...JUSTIFIED_NETWORK_TESTS].sort(),
    "Network skip allowlist changed; only measured network tests may be skipped",
  );
  for (const fileName of skippedResourceTests) {
    assert.ok(
      discoveredResourceTests.includes(fileName),
      `${fileName} is declared as a network test but does not exist`,
    );
    assert.ok(
      String(resourceTestRunner.NETWORK_TESTS[fileName] || "").length > 20,
      `${fileName} must document why it needs the network`,
    );
  }
  assert.match(
    runnerSource,
    /SKIP \$\{fileName\}: \$\{NETWORK_TESTS\[fileName\]\}/,
    "Skips must be printed with their reason so they can never be silent",
  );
});

test("a filtered index regeneration does not claim the untouched sources are fresh", () => {
  const generator = require("./update-preset-index.js");
  assert.strictEqual(
    generator.resolveIndexLastUpdated("2026-07-30", true, "2026-08-13"),
    "2026-07-30",
    "A filtered scan must keep the previous index-wide date",
  );
  assert.strictEqual(
    generator.resolveIndexLastUpdated("2026-07-30", false, "2026-08-13"),
    "2026-08-13",
    "A full scan must advance the index-wide date",
  );

  // No source carries its own timestamp yet, so the index-wide date is the only
  // freshness signal and must never run ahead of the last full scan.
  const index = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, "resources", "skill-index.json"),
      "utf8",
    ),
  );
  assert.strictEqual(
    index.sources.filter((source) => source.lastIndexedAt).length,
    0,
    "Add per-source freshness handling here once sources carry lastIndexedAt",
  );
});

test("README settings tables stay in sync with package.json order", () => {
  const config = packageJson.contributes?.configuration?.properties || {};
  const expected = Object.entries(config)
    .filter(([key]) => key.startsWith("resourceNinja."))
    .filter(([key]) => key !== "resourceNinja.versionInfo")
    .map(([key, value]) => ({
      setting: key.replace(/^resourceNinja\./, ""),
      order: value.order,
    }))
    .sort((left, right) => left.order - right.order);

  assert.deepStrictEqual(parseReadmeSettingsTable(readme), expected);
  assert.deepStrictEqual(parseReadmeSettingsTable(readmeJa), expected);
});

test("activation events are lazy and contribution complete", () => {
  const activationEvents = packageJson.activationEvents || [];
  assert.ok(!activationEvents.includes("onStartupFinished"));
  assert.ok(!activationEvents.includes("*"));
  for (const view of packageJson.contributes?.views?.["resource-ninja"] || []) {
    assert.ok(!activationEvents.includes(`onView:${view.id}`));
  }
  for (const command of packageJson.contributes?.commands || []) {
    assert.ok(!activationEvents.includes(`onCommand:${command.command}`));
  }
  for (const participant of packageJson.contributes?.chatParticipants || []) {
    assert.ok(activationEvents.includes(`onChatParticipant:${participant.id}`));
  }
  for (const tool of packageJson.contributes?.languageModelTools || []) {
    assert.ok(activationEvents.includes(`onLanguageModelTool:${tool.name}`));
  }
});

test("resource command ids do not expose old skill-only actions", () => {
  const commands = (packageJson.contributes?.commands || []).map(
    (command) => command.command,
  );
  const forbiddenCommands = [
    "resourceNinja.openSkillFile",
    "resourceNinja.openSkillFolder",
    "resourceNinja.registerLocalSkill",
    "resourceNinja.unregisterLocalSkill",
  ];

  for (const command of forbiddenCommands) {
    assert.ok(
      !commands.includes(command),
      `Unexpected old command id: ${command}`,
    );
  }
});

test("toolbar create action is resource-kind aware", () => {
  const commands = packageJson.contributes?.commands || [];
  assert.ok(
    commands.some(
      (command) => command.command === "resourceNinja.createResource",
    ),
    "Expected createResource command contribution",
  );
  const titleMenus = packageJson.contributes?.menus?.["view/title"] || [];
  for (const viewId of [
    "resourceNinja.installedView",
    "resourceNinja.userResourcesView",
    "resourceNinja.browseView",
  ]) {
    assert.ok(
      titleMenus.some(
        (item) =>
          item.command === "resourceNinja.createResource" &&
          item.when === `view == ${viewId}`,
      ),
      `Create Resource should be visible from ${viewId}`,
    );
  }
  assert.match(
    extensionSource,
    /registerCommand\(\s*"resourceNinja\.createResource"/,
  );
  assert.match(extensionSource, /getResourceKindLabel\(kind/);
  assert.match(extensionSource, /getCreateResourceUri/);
  assert.match(extensionSource, /getCreateResourceTemplate/);
  assert.match(extensionSource, /showOpenDialog/);
  assert.match(extensionSource, /User Profile/);
  assert.match(extensionSource, /Global Resource Home/);
});

test("instruction index actions are reachable from matching workspace and user-global views", () => {
  const titleMenus = packageJson.contributes?.menus?.["view/title"] || [];
  assert.ok(
    titleMenus.some(
      (item) =>
        item.command === "resourceNinja.openInstructionFile" &&
        item.when === "view == resourceNinja.installedView",
    ),
    "Workspace view should open the workspace output target",
  );
  assert.ok(
    titleMenus.some(
      (item) =>
        item.command === "resourceNinja.openGlobalInstructionFile" &&
        item.when === "view == resourceNinja.userResourcesView",
    ),
    "User / Global view should open the global output target",
  );
  assert.ok(
    !titleMenus.some(
      (item) =>
        item.command === "resourceNinja.openInstructionFile" &&
        item.when === "view == resourceNinja.userResourcesView",
    ),
    "User / Global view should not open the workspace output target",
  );
  assert.ok(
    titleMenus.some(
      (item) =>
        item.command === "resourceNinja.updateInstruction" &&
        item.when === "view == resourceNinja.installedView",
    ),
    "Workspace view should update the workspace instruction target",
  );
  assert.ok(
    titleMenus.some(
      (item) =>
        item.command === "resourceNinja.updateGlobalInstruction" &&
        item.when === "view == resourceNinja.userResourcesView",
    ),
    "User / Global view should update the global instruction target",
  );
  assert.ok(
    !titleMenus.some(
      (item) =>
        item.command === "resourceNinja.updateInstruction" &&
        item.when === "view == resourceNinja.userResourcesView",
    ),
    "User / Global view should not update the workspace instruction target",
  );
});

test("instruction file actions avoid remote-only browse view", () => {
  const titleMenus = packageJson.contributes?.menus?.["view/title"] || [];
  for (const command of [
    "resourceNinja.openInstructionFile",
    "resourceNinja.openGlobalInstructionFile",
    "resourceNinja.updateInstruction",
    "resourceNinja.updateGlobalInstruction",
  ]) {
    assert.ok(
      !titleMenus.some(
        (item) =>
          item.command === command &&
          item.when === "view == resourceNinja.browseView",
      ),
      `${command} should not appear in Remote Resources because it targets the selected local/global instruction file`,
    );
  }
});

test("instruction file setting exposes local and non-local targets", () => {
  const config = packageJson.contributes?.configuration?.properties || {};
  const instructionFile = config["resourceNinja.instructionFile"];
  for (const target of [
    "none",
    "AGENTS.md",
    "~/.copilot/copilot-instructions.md",
    ".github/copilot-instructions.md",
    ".github/instructions/SkillList.instructions.md",
    "CLAUDE.md",
    ".claude/CLAUDE.md",
    ".claude/CLAUDE.local.md",
    ".cursor/rules/skills.mdc",
    ".windsurfrules",
    ".clinerules",
    "custom",
  ]) {
    assert.ok(
      instructionFile?.enum?.includes(target),
      `Instruction File setting should include ${target}`,
    );
  }
  assert.match(
    nls["config.instructionFile.markdownDescription"],
    /~\/\.copilot\/copilot-instructions\.md[\s\S]*\.github\/copilot-instructions\.md[\s\S]*\.cursor\/rules\/skills\.mdc/,
    "Instruction File settings copy should document global, repository, and compatibility targets",
  );
});

test("open output flow supports non-local target discovery and ref fallback", () => {
  assert.match(extensionSource, /getConfiguredInstructionFilePath\(config\)/);
  assert.match(
    extensionSource,
    /resolveInstructionFileUri\(workspaceFolder\.uri, config\)/,
  );
  assert.match(extensionSource, /resolvePrimaryRefCatalogUri/);
  assert.match(extensionSource, /resolveOutputFormat\(workspaceFolder\.uri\)/);
  assert.match(
    extensionSource,
    /Managed output regeneration did not create an openable target/,
  );
  assert.match(extensionSource, /fileUri\.fsPath/);
  assert.match(extensionSource, /messages\.openSettings\(\)/);
  assert.match(extensionSource, /resourceNinja\.openSettings/);
  assert.match(extensionSource, /Failed to create output file:/);
  assert.match(extensionSource, /出力先ファイルを作成できませんでした:/);
});

test("plugin grouped resources can be installed as a selectable set", () => {
  const commands = packageJson.contributes?.commands || [];
  const itemMenus = packageJson.contributes?.menus?.["view/item/context"] || [];
  assert.ok(
    commands.some(
      (command) => command.command === "resourceNinja.installPluginResources",
    ),
    "Expected installPluginResources command contribution",
  );
  assert.ok(
    itemMenus.some(
      (item) =>
        item.command === "resourceNinja.installPluginResources" &&
        item.when === "view == resourceNinja.browseView && viewItem == plugin",
    ),
    "Remote plugin groups should expose Pick & Install from Plugin",
  );
  assert.match(extensionSource, /resourceNinja\.installPluginResources/);
  assert.match(extensionSource, /resourceNinja\.installBundle/);
  assert.match(treeProviderSource, /virtualBundle/);
  assert.match(
    treeProviderSource,
    /plugin\.resources\.map\(\(resource\) => resource\.path\)/,
  );
  assert.match(treeProviderSource, /Pick from a Plugin/);
  assert.match(treeProviderSource, /getPluginPackageCandidates/);
  assert.match(treeProviderSource, /getPluginPackageId/);
  assert.match(treeProviderSource, /getPluginPackageLabel/);
  assert.strictEqual(nls["command.installBundle"], "Install Curated Set");
  assert.strictEqual(
    nls["command.installPluginResources"],
    "Pick & Install from Plugin",
  );
  assert.strictEqual(
    nlsJa["command.installPluginResources"],
    "プラグイン中身を選んでインストール",
  );
});

test("contributed commands are registered at runtime", () => {
  const commands = (packageJson.contributes?.commands || []).map(
    (command) => command.command,
  );

  for (const command of commands) {
    assert.match(
      extensionSource,
      new RegExp(
        `registerCommand\\(\\s*"${command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
      ),
      `Missing runtime command registration: ${command}`,
    );
  }
});

test("runtime commands are contributed or explicitly internal", () => {
  const contributedCommands = new Set(
    (packageJson.contributes?.commands || []).map((command) => command.command),
  );
  const internalCommands = new Set([
    "resourceNinja.onSkillClick",
    "resourceNinja.installDefault",
  ]);
  const runtimeCommands = Array.from(
    extensionSource.matchAll(/registerCommand\(\s*"(resourceNinja\.[^"]+)"/g),
  ).map((match) => match[1]);

  for (const command of runtimeCommands) {
    assert.ok(
      contributedCommands.has(command) || internalCommands.has(command),
      `Runtime command is not contributed or allowlisted: ${command}`,
    );
  }
});

test("package NLS placeholders exist in English and Japanese", () => {
  const packageText = JSON.stringify(packageJson);
  const placeholders = new Set(
    Array.from(packageText.matchAll(/%([^%]+)%/g)).map((match) => match[1]),
  );

  for (const key of placeholders) {
    assert.ok(Object.hasOwn(nls, key), `Missing package.nls.json key: ${key}`);
    assert.ok(
      Object.hasOwn(nlsJa, key),
      `Missing package.nls.ja.json key: ${key}`,
    );
  }
});

test("all contributed command titles use localization placeholders", () => {
  for (const command of packageJson.contributes?.commands || []) {
    assert.match(
      command.title || "",
      /^%[^%]+%$/,
      `Command title should use package NLS placeholder: ${command.command}`,
    );
  }
});

test("command palette hides context-only and compatibility commands", () => {
  const hiddenFromPalette = new Set(
    (packageJson.contributes?.menus?.commandPalette || [])
      .filter((item) => item.when === "false")
      .map((item) => item.command),
  );
  for (const commandId of [
    "resourceNinja.install",
    "resourceNinja.uninstall",
    "resourceNinja.reinstall",
    "resourceNinja.reinstallResourceGroup",
    "resourceNinja.reinstallAll",
    "resourceNinja.uninstallAll",
    "resourceNinja.uninstallMultiple",
    "resourceNinja.reinstallMultiple",
    "resourceNinja.editWhenToUse",
    "resourceNinja.openResourceFile",
    "resourceNinja.openResourceFolder",
    "resourceNinja.updateSourceIndex",
    "resourceNinja.toggleFavorite",
    "resourceNinja.openOnGitHub",
    "resourceNinja.removeSource",
    "resourceNinja.preview",
    "resourceNinja.registerLocalResource",
    "resourceNinja.unregisterLocalResource",
    "resourceNinja.createSkill",
    "resourceNinja.refreshLocal",
    "resourceNinja.refreshUserResources",
    "resourceNinja.openUserResource",
    "resourceNinja.openInstructionFile",
    "resourceNinja.openGlobalInstructionFile",
    "resourceNinja.revealUserResource",
    "resourceNinja.copyUserResourcePath",
    "resourceNinja.deleteUserResource",
    "resourceNinja.reinstallUserResource",
    "resourceNinja.reinstallUserResourceGroup",
    "resourceNinja.installBundle",
    "resourceNinja.installPluginResources",
    "resourceNinja.deletePluginResources",
    "resourceNinja.copyUrl",
    "resourceNinja.copyPath",
    "resourceNinja.openInTerminal",
  ]) {
    assert.ok(
      hiddenFromPalette.has(commandId),
      `${commandId} should be hidden from Command Palette`,
    );
  }
});

test("visible command palette labels are not duplicated", () => {
  const hiddenFromPalette = new Set(
    (packageJson.contributes?.menus?.commandPalette || [])
      .filter((item) => item.when === "false")
      .map((item) => item.command),
  );
  const visibleCommands = (packageJson.contributes?.commands || []).filter(
    (command) => !hiddenFromPalette.has(command.command),
  );
  const localizedTitles = new Map();
  for (const command of visibleCommands) {
    const titleKey = (command.title || "").replace(/^%|%$/g, "");
    const localizedTitle = nls[titleKey] || command.title;
    const existing = localizedTitles.get(localizedTitle) || [];
    existing.push(command.command);
    localizedTitles.set(localizedTitle, existing);
  }
  for (const [title, commandIds] of localizedTitles) {
    assert.strictEqual(
      commandIds.length,
      1,
      `Duplicate visible Command Palette title "${title}": ${commandIds.join(", ")}`,
    );
  }
});

test("generic output command stays visible while scoped output commands stay hidden", () => {
  const hiddenFromPalette = new Set(
    (packageJson.contributes?.menus?.commandPalette || [])
      .filter((item) => item.when === "false")
      .map((item) => item.command),
  );
  assert.ok(!hiddenFromPalette.has("resourceNinja.openResourceOutput"));
  assert.ok(hiddenFromPalette.has("resourceNinja.openInstructionFile"));
  assert.ok(hiddenFromPalette.has("resourceNinja.openGlobalInstructionFile"));
});

test("language model tools use resource-oriented public names", () => {
  const tools = packageJson.contributes?.languageModelTools || [];
  assert.ok(
    tools.length > 0,
    "Expected language model tools to be contributed",
  );

  for (const tool of tools) {
    assert.ok(
      tool.name.startsWith("resourceNinja_"),
      `Tool name should use resourceNinja_*: ${tool.name}`,
    );
    assert.ok(
      tool.toolReferenceName.includes("Resource") ||
        tool.toolReferenceName.includes("Resources"),
      `Tool reference should use Resource(s): ${tool.toolReferenceName}`,
    );
    assert.ok(
      !tool.tags?.includes("skill-ninja"),
      `Tool tags should not expose skill-ninja: ${tool.name}`,
    );
  }
});

test("contributed language model tools are registered at runtime", () => {
  const tools = packageJson.contributes?.languageModelTools || [];

  for (const tool of tools) {
    assert.match(
      mcpToolsSource,
      new RegExp(`"${tool.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
      `Missing runtime registration for tool name: ${tool.name}`,
    );
  }
});

test("language model runtime registrations are contributed and resource-oriented", () => {
  const forbiddenAliases = [
    "searchSkills",
    "installSkill",
    "uninstallSkill",
    "listSkills",
    "recommendSkills",
    "updateSkillIndex",
    "webSearchSkills",
    "addSkillSource",
    "localizeSkill",
  ];
  for (const alias of forbiddenAliases) {
    assert.doesNotMatch(
      mcpToolsSource,
      new RegExp(`"${alias}"`),
      `Unexpected old LM tool alias: ${alias}`,
    );
  }

  const contributedToolNames = new Set(
    (packageJson.contributes?.languageModelTools || []).map(
      (tool) => tool.name,
    ),
  );
  const runtimeToolNames = Array.from(
    mcpToolsSource.matchAll(
      /registerLanguageModelTool\(\s*context,\s*"([^"]+)"/g,
    ),
  ).map((match) => match[1]);

  assert.ok(
    runtimeToolNames.length > 0,
    "Expected runtime LM tool registrations",
  );
  for (const name of runtimeToolNames) {
    assert.ok(
      contributedToolNames.has(name),
      `Runtime LM tool must be contributed in package.json: ${name}`,
    );
  }
});

test("local resource registration detection is not skill-only", () => {
  assert.doesNotMatch(
    localSkillScannerSource,
    /skill\.kind\s*&&\s*skill\.kind\s*!==\s*"skill"/,
    "Local registration status should not ignore non-skill resources",
  );
  assert.match(
    localSkillScannerSource,
    /skill\.path/,
    "Local registration status should match resource paths as well as names",
  );
});

test("workspace tree item labels are resource-oriented", () => {
  assert.doesNotMatch(
    treeProviderSource,
    /Open SKILL\.md|SKILL\.md を開く/,
    "Workspace resource click labels should not be hard-coded to SKILL.md",
  );
  assert.match(
    treeProviderSource,
    /Open Resource|リソースを開く/,
    "Workspace resource click labels should say Resource",
  );
  assert.match(
    treeProviderSource,
    /workspaceResourceType/,
    "Workspace resources should be grouped by resource kind",
  );
  assert.match(
    treeProviderSource,
    /getPresentWorkspaceResourceKinds/,
    "Workspace resource kind groups should be derived from present resources",
  );
  assert.match(treeProviderSource, /"mcp"/);
  assert.match(userResourcesProviderSource, /"mcp"/);
  assert.doesNotMatch(
    treeProviderSource,
    /builtInResources|builtInResourceType|getBuiltInResourceDedupeKey/,
    "Workspace Resources should not contain built-in grouping; built-ins are centralized in User / Global Resource Home",
  );
});

test("workspace resource menus distinguish skill-only actions from generic resources", () => {
  const itemMenus = packageJson.contributes?.menus?.["view/item/context"] || [];
  const titleMenus = packageJson.contributes?.menus?.["view/title"] || [];
  const whenFor = (command) =>
    itemMenus
      .filter((item) => item.command === command)
      .map((item) => item.when || "")
      .join("\n");
  const titleWhenFor = (command) =>
    titleMenus
      .filter((item) => item.command === command)
      .map((item) => item.when || "")
      .join("\n");

  assert.match(treeProviderSource, /"installedResource"/);
  assert.match(treeProviderSource, /"installedRemoteSkill"/);
  assert.match(treeProviderSource, /"installedRemoteResource"/);
  assert.match(treeProviderSource, /"localResource"/);
  assert.match(treeProviderSource, /resourceNinja\.hasInstalledSkills/);
  assert.match(extensionSource, /getResourceKind\(skill\) !== "skill"/);
  assert.match(extensionSource, /path\.dirname\(skill\.fullPath\)/);

  assert.strictEqual(
    titleWhenFor("resourceNinja.reinstallAll"),
    "",
    "Bulk reinstall should not occupy the Workspace Resources title toolbar",
  );

  for (const command of [
    "resourceNinja.uninstallAll",
    "resourceNinja.uninstallMultiple",
    "resourceNinja.reinstallMultiple",
  ]) {
    assert.match(
      titleWhenFor(command),
      /resourceNinja\.hasInstalledSkills/,
      `${command} should be hidden when no installed skills exist`,
    );
  }

  assert.strictEqual(nls["command.reinstall"], "Reinstall Resource");
  assert.strictEqual(
    nls["command.uninstallMultiple"],
    "Uninstall Selected Skills",
  );
  assert.strictEqual(nls["command.editWhenToUse"], "Edit Skill When To Use");
  assert.match(nlsJa["command.reinstall"], /リソース/);
  assert.match(nlsJa["command.uninstallMultiple"], /skill/);

  assert.match(whenFor("resourceNinja.uninstall"), /installedResource/);
  assert.match(whenFor("resourceNinja.uninstall"), /installedRemoteResource/);
  assert.match(whenFor("resourceNinja.reinstall"), /installedRemoteSkill/);
  assert.match(whenFor("resourceNinja.reinstall"), /installedRemoteResource/);
  assert.match(
    whenFor("resourceNinja.reinstallResourceGroup"),
    /workspaceResourceType/,
  );
  assert.match(extensionSource, /reinstallResourceGroupCmd/);
  assert.match(extensionSource, /children\.filter/);
  assert.doesNotMatch(
    whenFor("resourceNinja.reinstall"),
    /viewItem == installedSkill|viewItem == installedResource/,
    "Reinstall should only appear for remote-installed resources with source metadata",
  );
  assert.doesNotMatch(
    whenFor("resourceNinja.editWhenToUse"),
    /installedResource|localResource/,
    "When-to-use editing should not appear for non-skill resources",
  );
  assert.match(
    extensionSource,
    /When To Use editing is only available for skill entries/,
  );
  assert.match(extensionSource, /Edit When To Use for/);
  assert.match(extensionSource, /remote install metadata is missing/);
  assert.doesNotMatch(
    extensionSource,
    /Description editing is only available for skill resources/,
  );
  assert.doesNotMatch(extensionSource, /Edit skill description for/);
  assert.doesNotMatch(
    extensionSource,
    /Reinstall is only available for skill resources/,
  );

  for (const command of [
    "resourceNinja.openResourceFolder",
    "resourceNinja.openResourceFile",
    "resourceNinja.copyPath",
    "resourceNinja.openInTerminal",
  ]) {
    const when = whenFor(command);
    assert.match(when, /installedRemoteResource/);
    assert.match(when, /installedResource/);
    assert.match(when, /localResource/);
  }

  assert.doesNotMatch(
    whenFor("resourceNinja.registerLocalResource"),
    /localResource/,
    "Instruction sync currently indexes skills, so non-skill local resources should not show register",
  );
  assert.doesNotMatch(
    whenFor("resourceNinja.unregisterLocalResource"),
    /localResource/,
    "Instruction sync currently indexes skills, so non-skill local resources should not show unregister",
  );
});

test("built-in resource visibility is configurable", () => {
  const config = packageJson.contributes?.configuration?.properties || {};
  assert.strictEqual(
    config["resourceNinja.showBuiltInResources"]?.default,
    true,
  );
  assert.ok(
    (packageJson.contributes?.commands || []).some(
      (command) => command.command === "resourceNinja.toggleBuiltInResources",
    ),
    "Expected toggleBuiltInResources command contribution",
  );
  assert.ok(
    (packageJson.contributes?.commands || []).some(
      (command) => command.command === "resourceNinja.showBuiltInResources",
    ),
    "Expected explicit showBuiltInResources command contribution",
  );
  assert.ok(
    (packageJson.contributes?.commands || []).some(
      (command) => command.command === "resourceNinja.hideBuiltInResources",
    ),
    "Expected explicit hideBuiltInResources command contribution",
  );
  const titleMenus = packageJson.contributes?.menus?.["view/title"] || [];
  assert.ok(
    titleMenus.every(
      (item) =>
        (item.command !== "resourceNinja.showBuiltInResources" &&
          item.command !== "resourceNinja.hideBuiltInResources") ||
        item.when.includes("resourceNinja.userResourcesView"),
    ),
    "Built-in toggle should be shown only in User / Global Resource Home",
  );
  assert.ok(
    titleMenus.some(
      (item) =>
        item.command === "resourceNinja.showBuiltInResources" &&
        item.when.includes("resourceNinja.userResourcesView") &&
        item.when.includes("!resourceNinja.builtInResourcesVisible"),
    ),
    "User / Global view should show a Show Built-in command when hidden",
  );
  assert.ok(
    titleMenus.some(
      (item) =>
        item.command === "resourceNinja.hideBuiltInResources" &&
        item.when.includes("resourceNinja.userResourcesView") &&
        item.when.includes("resourceNinja.builtInResourcesVisible"),
    ),
    "User / Global view should show a Hide Built-in command when visible",
  );
  assert.match(extensionSource, /showBuiltInResources/);
  assert.match(extensionSource, /toggleBuiltInResources/);
  assert.match(extensionSource, /setContext/);
  assert.match(extensionSource, /resourceNinja\.builtInResourcesVisible/);
  assert.match(extensionSource, /userResourcesProvider\.refresh\(\)/);
  assert.match(localSkillScannerSource, /isBuiltInResourcePath/);
  assert.match(localSkillScannerSource, /includeBuiltInResources/);
  assert.match(localSkillScannerSource, /MAX_LOCAL_RESOURCE_FILES\s*=\s*1000/);
  assert.match(
    localSkillScannerSource,
    /WORKSPACE_SCAN_EXCLUDE_PATTERN\s*=\s*"\{\*\*\/node_modules\/\*\*,\*\*\/\.vscode-test\/\*\*\}"/,
    "Workspace scanning must exclude .vscode-test even when built-ins are visible",
  );
  assert.match(localSkillScannerSource, /getBuiltInResourceSourceLabel/);
  assert.match(
    treeProviderSource,
    /this\.workspaceUri,\s*true,\s*true,\s*false/,
    "Workspace Resources should not duplicate built-in resources that belong in User / Global Resource Home",
  );
  assert.doesNotMatch(treeProviderSource, /builtInResources/);
  assert.doesNotMatch(treeProviderSource, /builtInResourceType/);
  assert.doesNotMatch(
    treeProviderSource,
    /getWorkspaceResourceCountForBuiltIn/,
  );
  assert.doesNotMatch(
    treeProviderSource,
    /installed from \$\{skill\.source \|\| "unknown"\}/,
  );
  assert.match(treeProviderSource, /sourceLabel/);
  assert.ok(
    resourceKindsSource.includes("globalstorage\\/github\\.copilot-chat"),
    "Built-in detection should cover Copilot Chat globalStorage layouts",
  );
  assert.ok(
    resourceKindsSource.includes(
      "builtin-(skills|agents|prompts|instructions|hooks|mcp)",
    ),
    "Built-in detection should cover versioned Copilot CLI builtin resource layouts",
  );
  assert.match(
    localSkillScannerSource,
    /resources\/app\/node_modules\/\*\*\/SKILL\.md/,
    "Built-in app node_modules skills should be scanned by targeted glob only when enabled",
  );
  assert.match(
    localSkillScannerSource,
    /"\*\*\/\.vscode-test\/\*\*"/,
    "Targeted built-in node_modules scan must still exclude test archives",
  );
  assert.match(userResourceScannerSource, /isBuiltInResourcePath/);
  assert.match(userResourceScannerSource, /getBuiltInResourceSourceLabel/);
  assert.match(userResourceScannerSource, /getBuiltInResourceDedupeKey/);
  assert.match(userResourceScannerSource, /shouldReplaceBuiltInResourcePath/);
  assert.match(userResourceScannerSource, /includeBuiltInResources/);
  assert.match(userResourceScannerSource, /lowerName === "pkg"/);
  assert.match(userResourceScannerSource, /github\.copilot-chat/);
  assert.match(userResourceScannerSource, /getInstalledExtensionsScopeLabel/);
  assert.match(userResourceScannerSource, /readOnly: true/);
  assert.match(userResourceScannerSource, /chatAgents/);
  assert.match(userResourceScannerSource, /chatPromptFiles/);
  assert.match(userResourceScannerSource, /exactFile: true/);
  assert.match(userResourceScannerSource, /isInstalledExtensionPath/);
  assert.match(userResourceScannerSource, /out[\s\S]*vs[\s\S]*sessions/);
  assert.match(
    userResourceScannerSource,
    /node_modules[\s\S]*@github[\s\S]*copilot[\s\S]*builtin-skills/,
  );
  assert.match(userResourceScannerSource, /root\.builtInOnly && !isBuiltIn/);
  assert.match(userResourcesProviderSource, /builtInScope/);
  assert.match(userResourcesProviderSource, /builtInTool/);
  assert.match(userResourcesProviderSource, /extensionTool/);
  assert.match(userResourcesProviderSource, /extensionKind/);
  assert.match(userResourcesProviderSource, /resource\.scope === "extension"/);
  assert.match(
    userResourcesProviderSource,
    /resource\.tool === element\.scopeLabel/,
  );
  assert.match(userResourcesProviderSource, /getBuiltInResources/);
});

test("generated instruction empty states explain skill index scope", () => {
  assert.match(
    instructionManagerSource,
    /messages\.emptySkillEntries\(getSearchCommandTitle\(\)\)/,
  );
  assert.match(
    instructionManagerSource,
    /messages\.emptyResourceEntries\(getSearchCommandTitle\(\)\)/,
  );
  assert.doesNotMatch(
    instructionManagerSource,
    /Agent Resources Ninja: Search Resources/,
  );
  assert.doesNotMatch(instructionManagerSource, /No skills listed yet/);
});

test("install target picker offers workspace and global scopes", () => {
  for (const marker of [
    "installTargetWorkspaceLabel",
    "installTargetUserProfileLabel",
    "installTargetCopilotHomeLabel",
    "installTargetCustomLabel",
    'targetScope: "workspace"',
    'targetScope: "userData"',
    'targetScope: "globalHome"',
    'targetScope: "custom"',
  ]) {
    assert.match(
      extensionSource,
      new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `Install target picker missing marker: ${marker}`,
    );
  }
});

test("preset index updater discovers every supported resource kind", () => {
  // The generator imports the real rules, so assert behaviour instead of its source shape.
  const generator = require("./update-preset-index.js");
  for (const [samplePath, expectedKind] of [
    ["skills/reviewer/SKILL.md", "skill"],
    ["agents/reviewer.agent.md", "agent"],
    ["instructions/style.instructions.md", "instruction"],
    ["prompts/refine.prompt.md", "prompt"],
    ["hooks/format.json", "hook"],
    ["mcp.json", "mcp"],
    ["plugin.json", "plugin"],
  ]) {
    assert.strictEqual(
      generator.detectResourceKindFromPath(samplePath),
      expectedKind,
      `Preset updater should discover ${samplePath} as ${expectedKind}`,
    );
  }
  assert.doesNotMatch(
    presetIndexUpdaterSource,
    /const skillFiles = data\.tree\.filter/,
    "Preset updater should not be SKILL.md-only",
  );
  assert.match(
    presetIndexUpdaterSource,
    /createResourceKey/,
    "Preset updater should deduplicate by resource key",
  );
});

test("preset source path filters are wired through scripts and runtime", () => {
  assert.match(skillIndexSource, /includePaths\?: string\[\]/);
  assert.match(skillIndexSource, /excludePaths\?: string\[\]/);
  assert.match(presetIndexUpdaterSource, /isResourcePathAllowed/);
  assert.match(presetIndexUpdaterSource, /pathMatchesPrefix/);
  assert.match(indexUpdaterSource, /isResourcePathAllowed/);
  assert.match(indexUpdaterSource, /pathMatchesPrefix/);
  assert.match(indexUpdaterSource, /includePaths|excludePaths/);

  for (const sourceId of [
    "google-gemini-cli",
    "openai-codex",
    "anthropic-claude-code",
    "aws-agent-plugins",
    "elastic-agent-skills",
    "cline-official",
  ]) {
    const source = bundledIndex.sources.find((item) => item.id === sourceId);
    assert.ok(source, `Missing filtered source: ${sourceId}`);
    assert.ok(
      source.includePaths?.length > 0,
      `Expected includePaths for ${sourceId}`,
    );
  }
});

test("legacy special scanners are fallback-only", () => {
  assert.match(indexUpdaterSource, /canUseLegacyFallbackScanner/);
  assert.match(
    indexUpdaterSource,
    /resourceFiles\.length === 0/,
    "Runtime updater should prefer normal resource files before legacy scanners",
  );
  assert.match(
    indexUpdaterSource,
    /declaredScanner === "claude-commands"/,
    "The claude-commands scanner should be selectable declaratively",
  );
  assert.match(
    indexUpdaterSource,
    /declaredScanner === "top-level-dirs"/,
    "The top-level-dirs scanner should be selectable declaratively",
  );
  assert.match(
    indexUpdaterSource,
    /declaredScanner === undefined &&\s*repoName\.toLowerCase\(\)\.includes\("prps-agentic"\) &&\s*canUseLegacyFallbackScanner/,
    "PRPs repo-name matching should stay a fallback for sources without a declared scanner",
  );
  assert.match(
    indexUpdaterSource,
    /declaredScanner === undefined &&\s*repoName\.toLowerCase\(\)\.includes\("awesome-claude-skills"\) &&\s*canUseLegacyFallbackScanner/,
    "Composio repo-name matching should stay a fallback for sources without a declared scanner",
  );
});

test("startup diagnostics use output channel logger", () => {
  assert.match(loggerSource, /createOutputChannel\("Agent Resources Ninja"\)/);
  assert.match(loggerSource, /new vscode\.Disposable\(\(\) =>/);
  assert.match(loggerSource, /outputChannelDisposed = true/);
  assert.match(loggerSource, /function appendLine\(line: string\)/);
  assert.match(loggerSource, /Diagnostics must never break extension behavior/);
  assert.match(extensionSource, /registerLogger\(context\)/);
  assert.match(
    extensionSource,
    /logger\.info\("Agent Resources Ninja is now active!"\)/,
  );
  assert.doesNotMatch(
    extensionSource,
    /console\.log\("Agent Resources Ninja is now active!"\)/,
  );
  assert.match(
    mcpToolsSource,
    /logger\.info\("Agent Resources Ninja: MCP tools registered successfully"\)/,
  );
  assert.doesNotMatch(
    mcpToolsSource,
    /console\.log\("Agent Resources Ninja: MCP tools registered successfully"\)/,
  );
});

test("runtime sources do not write diagnostics to process console", () => {
  for (const source of readRuntimeSources()) {
    assert.doesNotMatch(
      source.text,
      /console\.(log|warn|error)\(/,
      `Runtime source should use logger instead of console: ${path.relative(repoRoot, source.path)}`,
    );
  }
});

test("documentation covers diagnostics and license consistently", () => {
  for (const doc of [readme, readmeJa]) {
    assert.match(doc, /Output → Agent Resources Ninja/);
    assert.match(doc, /test-logger\.js/);
    assert.match(doc, /CC BY-NC-SA 4\.0/);
    assert.doesNotMatch(doc, /CC BY-NC 4\.0/);
  }
});

test("ignore files exclude local release and agent artifacts", () => {
  for (const marker of [".vscode-test/", ".hiker/", "*.vsix"]) {
    assert.match(
      gitignore,
      new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `.gitignore should exclude ${marker}`,
    );
  }
  for (const marker of [
    ".vscode-test/**",
    ".hiker/**",
    "*.vsix",
    "release-notes-v*.md",
  ]) {
    assert.match(
      vscodeignore,
      new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `.vscodeignore should exclude ${marker}`,
    );
  }
});

test("legacy Refine ledgers never return under .github", () => {
  const legacyRefineLedgers = [
    ".github/refine-product.md",
    ".github/refine-product-state.md",
  ];
  for (const relativePath of legacyRefineLedgers) {
    assert.strictEqual(
      fs.existsSync(path.join(repoRoot, relativePath)),
      false,
      `${relativePath} is obsolete; Refine state belongs only in .git/info/refine-product-state.md`,
    );
  }
});

test("generated release artifacts stay out of the repository root", () => {
  const rootVsixFiles = fs
    .readdirSync(repoRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".vsix"))
    .map((entry) => entry.name);
  assert.deepStrictEqual(
    rootVsixFiles,
    [],
    "VSIX artifacts belong under artifacts/vsix, not the repository root",
  );
  assert.strictEqual(
    fs.existsSync(path.join(repoRoot, "compile.log")),
    false,
    "compile.log is a temporary build artifact and must not remain at the repository root",
  );
});

test("package lock uses public registry URLs and sha512 integrity", () => {
  const packageLockText = JSON.stringify(packageLock);
  assert.doesNotMatch(
    packageLockText,
    /pkgs\.visualstudio\.com|ms-feed/i,
    "package-lock.json must not contain private Azure Artifacts feed URLs",
  );
  for (const [packagePath, packageInfo] of Object.entries(
    packageLock.packages || {},
  )) {
    if (!packageInfo.resolved) {
      continue;
    }
    assert.match(
      packageInfo.resolved,
      /^https:\/\/registry\.npmjs\.org\//,
      `${packagePath} should resolve through the public npm registry`,
    );
    assert.match(
      packageInfo.integrity || "",
      /^sha512-/,
      `${packagePath} should use sha512 package integrity`,
    );
  }
});

test("version info reflects extension release and bundled resource index metadata", () => {
  const changelog = fs.readFileSync(
    path.join(repoRoot, "CHANGELOG.md"),
    "utf8",
  );
  const releaseDateMatch = changelog.match(
    new RegExp(
      `## \\[${packageJson.version.replace(/\./g, "\\.")}\\] - (\\d{4}-\\d{2}-\\d{2})`,
    ),
  );
  assert.ok(
    releaseDateMatch,
    `CHANGELOG should include release date for ${packageJson.version}`,
  );
  const extensionReleaseDate = releaseDateMatch[1];
  const expectedRows = [
    `Extension | **${packageJson.version}**`,
    `Resource Index | **v${bundledIndex.version}**`,
    `Last Updated | ${extensionReleaseDate}`,
    `Resource Index Updated | ${bundledIndex.lastUpdated}`,
    `Resources | ${bundledIndex.skills.length}`,
    `Sources | ${bundledIndex.sources.length}`,
  ];

  for (const row of expectedRows) {
    assert.ok(
      nls["config.versionInfo.markdownDescription"].includes(row),
      `English version info missing row: ${row}`,
    );
    assert.ok(
      nlsJa["config.versionInfo.markdownDescription"].includes(row),
      `Japanese version info missing row: ${row}`,
    );
  }
});

console.log("Manifest consistency tests passed");
