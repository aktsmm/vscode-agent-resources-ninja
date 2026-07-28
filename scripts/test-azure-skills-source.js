#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const index = require("../resources/skill-index.json");
const { loadRepositoryTree } = require("./update-preset-index.js");

const SOURCE_ID = "microsoft-azure-skills";
const SOURCE_REPO = "microsoft/azure-skills";
const SOURCE_URL = `https://github.com/${SOURCE_REPO}`;

function createHeaders(userAgent) {
  return { "User-Agent": userAgent };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: createHeaders("ResourceNinja-AzureSkillsTest"),
  });
  const text = await response.text();
  assert.ok(
    response.ok,
    `Expected ${url} to be reachable, got ${response.status}: ${text}`,
  );
  return JSON.parse(text);
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: createHeaders("ResourceNinja-AzureSkillsTest"),
  });
  assert.ok(
    response.ok,
    `Expected ${url} to be reachable, got ${response.status}`,
  );
  return response.text();
}

function resourceByName(resources, name) {
  return resources.find((resource) => resource.name === name);
}

async function main() {
  const source = index.sources.find((candidate) => candidate.id === SOURCE_ID);
  assert.ok(source, "Microsoft Azure Skills source should be bundled");
  assert.strictEqual(source.type, "official");
  assert.strictEqual(source.url, SOURCE_URL);
  assert.deepStrictEqual(source.includePaths, [
    "skills/",
    ".mcp.json",
    "plugin.json",
    ".claude-plugin/",
    ".cursor-plugin/",
    "gemini-extension.json",
  ]);

  const resources = index.skills.filter(
    (resource) => resource.source === SOURCE_ID,
  );
  const skillResources = resources.filter(
    (resource) => (resource.kind || "skill") === "skill",
  );
  const mcpResources = resources.filter((resource) => resource.kind === "mcp");
  const pluginResources = resources.filter(
    (resource) => resource.kind === "plugin",
  );
  assert.ok(skillResources.length > 0, "Expected indexed Azure skills");
  assert.strictEqual(mcpResources.length, 1, "Expected one Azure MCP config");
  assert.strictEqual(
    pluginResources.length,
    1,
    "Expected one Azure plugin manifest",
  );
  assert.strictEqual(
    resources.length,
    skillResources.length + mcpResources.length + pluginResources.length,
  );
  assert.strictEqual(pluginResources[0].path, ".");
  assert.strictEqual(pluginResources[0].pluginRoot, ".");
  assert.strictEqual(pluginResources[0].pluginManifestPath, "plugin.json");
  assert.strictEqual(pluginResources[0].pluginManifestKind, "plugin");

  assert.ok(
    skillResources.every((resource) => resource.path.startsWith("skills/")),
    "Azure Skills skill resources should use top-level skills/ paths",
  );
  assert.ok(
    resources.every(
      (resource) => !resource.path.startsWith(".github/plugins/azure-skills/"),
    ),
    "Distribution-ready top-level paths should be preferred over plugin payload duplicates",
  );
  assert.ok(
    resources.every((resource) => resource.categories?.length >= 0),
    "Every resource should have a categories array",
  );
  assert.ok(
    resources.every((resource) => resource.description !== "{"),
    "JSON MCP resources should not surface raw JSON braces as descriptions",
  );

  assert.ok(
    skillResources.every(
      (resource) =>
        resource.pluginRoot === "." &&
        resource.pluginManifestPath === "plugin.json",
    ),
    "Every top-level Azure skill should retain root plugin metadata",
  );

  const azureMcp = mcpResources[0];
  assert.deepStrictEqual(azureMcp.categories, ["mcp"]);
  assert.strictEqual(azureMcp.name, "azure");
  assert.strictEqual(azureMcp.path, ".mcp.json");
  assert.strictEqual(azureMcp.description, "MCP configuration for azure");
  assert.strictEqual(azureMcp.pluginRoot, ".");
  assert.strictEqual(azureMcp.pluginManifestPath, "plugin.json");

  const bundle = index.bundles.find(
    (candidate) => candidate.id === "microsoft-azure-skills-plugin-resources",
  );
  assert.ok(bundle, "Expected Microsoft Azure Skills resource bundle");
  assert.strictEqual(bundle.source, SOURCE_ID);
  assert.match(bundle.description, /Azure skills plus the Azure MCP config/);
  assert.match(bundle.description, /optional workspace mcp\.json merge/);
  assert.ok(
    bundle.skills.includes("azure"),
    "Bundle should include Azure MCP config",
  );
  assert.deepStrictEqual(bundle.installOrder, bundle.skills);
  assert.deepStrictEqual(
    [...bundle.skills].sort(),
    resources
      .filter((resource) => resource.kind !== "plugin")
      .map((resource) => resource.name)
      .sort(),
    "Bundle should include every indexed non-plugin Microsoft Azure Skills resource",
  );

  const repositoryTree = await loadRepositoryTree(
    "microsoft",
    "azure-skills",
    "main",
  );
  const branch = repositoryTree.branch;
  const upstreamPaths = repositoryTree.data.tree.map((entry) => entry.path);
  const upstreamSkillPaths = repositoryTree.data.tree
    .filter(
      (entry) =>
        entry.type === "blob" && /^skills\/.+\/SKILL\.md$/.test(entry.path),
    )
    .map((entry) => entry.path.replace(/\/SKILL\.md$/, ""))
    .sort();
  assert.deepStrictEqual(
    skillResources.map((resource) => resource.path).sort(),
    upstreamSkillPaths,
    "Indexed Azure skills should match the current top-level upstream tree",
  );
  assert.ok(
    upstreamPaths.includes(".mcp.json"),
    "Root MCP config should exist",
  );
  assert.ok(
    upstreamPaths.includes("plugin.json"),
    "Root plugin manifest should exist",
  );

  const representativeSkill =
    resourceByName(skillResources, "azure-prepare") || skillResources[0];

  const skillText = await fetchText(
    `https://raw.githubusercontent.com/${SOURCE_REPO}/${branch}/${representativeSkill.path}/SKILL.md`,
  );
  assert.match(skillText, /^---\n[\s\S]*name:/m);

  const mcpJson = await fetchJson(
    `https://raw.githubusercontent.com/${SOURCE_REPO}/${branch}/.mcp.json`,
  );
  assert.ok(
    mcpJson.mcpServers?.azure,
    "Upstream MCP config should define azure server",
  );
  assert.strictEqual(mcpJson.mcpServers.azure.command, "npx");

  const pluginJson = await fetchJson(
    `https://raw.githubusercontent.com/${SOURCE_REPO}/${branch}/plugin.json`,
  );
  assert.strictEqual(pluginJson.name, "azure");

  const updaterSource = fs.readFileSync(
    path.join(__dirname, "update-preset-index.js"),
    "utf8",
  );
  assert.match(updaterSource, /kind === "mcp"/);
  assert.match(updaterSource, /mcpServers/);
  assert.match(updaterSource, /MCP configuration for/);

  console.log(
    "PASS Microsoft Azure Skills source is indexed with skills and MCP metadata",
  );
  console.log("RESULT=PASS");
}

main().catch((error) => {
  console.error("FAIL Microsoft Azure Skills source regression");
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
