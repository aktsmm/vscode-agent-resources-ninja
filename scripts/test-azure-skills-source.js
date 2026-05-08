#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const index = require("../resources/skill-index.json");

const SOURCE_ID = "microsoft-azure-skills";
const SOURCE_REPO = "microsoft/azure-skills";
const SOURCE_URL = `https://github.com/${SOURCE_REPO}`;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

function createHeaders(userAgent) {
  const headers = { "User-Agent": userAgent };
  if (GITHUB_TOKEN) {
    headers.Authorization = `token ${GITHUB_TOKEN}`;
  }
  return headers;
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
  assert.deepStrictEqual(source.includePaths, ["skills/", ".mcp.json"]);

  const resources = index.skills.filter(
    (resource) => resource.source === SOURCE_ID,
  );
  assert.strictEqual(
    resources.length,
    32,
    "Expected 32 Azure Skills resources",
  );

  const skillResources = resources.filter(
    (resource) => (resource.kind || "skill") === "skill",
  );
  const mcpResources = resources.filter((resource) => resource.kind === "mcp");
  assert.strictEqual(skillResources.length, 31, "Expected 31 Azure skills");
  assert.strictEqual(mcpResources.length, 1, "Expected one Azure MCP config");

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

  const expectedSkills = [
    "azure-prepare",
    "azure-validate",
    "azure-deploy",
    "azure-rbac",
    "azure-cost",
    "azure-diagnostics",
    "microsoft-foundry",
    "deploy-model",
    "capacity",
    "customize",
    "preset",
  ];
  for (const name of expectedSkills) {
    assert.ok(resourceByName(skillResources, name), `Expected ${name} skill`);
  }

  const azureRbac = resourceByName(skillResources, "azure-rbac");
  assert.strictEqual(azureRbac.path, "skills/azure-rbac");
  assert.match(azureRbac.description, /Azure/i);

  const nestedDeployModel = resourceByName(skillResources, "deploy-model");
  assert.strictEqual(
    nestedDeployModel.path,
    "skills/microsoft-foundry/models/deploy-model",
  );

  const azureMcp = mcpResources[0];
  assert.deepStrictEqual(azureMcp.categories, ["mcp"]);
  assert.strictEqual(azureMcp.name, "azure");
  assert.strictEqual(azureMcp.path, ".mcp.json");
  assert.strictEqual(azureMcp.description, "MCP configuration for azure");

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
    resources.map((resource) => resource.name).sort(),
    "Bundle should include every indexed Microsoft Azure Skills resource",
  );

  let branch = "main";
  try {
    const repo = await fetchJson(`https://api.github.com/repos/${SOURCE_REPO}`);
    branch = repo.default_branch || "main";
    assert.strictEqual(branch, "main");

    const tree = await fetchJson(
      `https://api.github.com/repos/${SOURCE_REPO}/git/trees/${branch}?recursive=1`,
    );
    const upstreamPaths = tree.tree.map((entry) => entry.path);
    assert.ok(
      upstreamPaths.includes("skills/azure-rbac/SKILL.md"),
      "Upstream top-level skills path should contain azure-rbac/SKILL.md",
    );
    assert.ok(
      upstreamPaths.includes(
        ".github/plugins/azure-skills/skills/azure-rbac/SKILL.md",
      ),
      "Upstream plugin payload duplicate should exist but stay excluded from this source",
    );
    assert.ok(
      upstreamPaths.includes(".mcp.json"),
      "Upstream root MCP config should exist",
    );
  } catch (error) {
    console.warn(
      "WARN GitHub API tree unavailable; verifying indexed Azure Skills content through raw URLs only",
    );
    console.warn(error instanceof Error ? error.message : String(error));
  }

  const skillText = await fetchText(
    `https://raw.githubusercontent.com/${SOURCE_REPO}/${branch}/skills/azure-rbac/SKILL.md`,
  );
  assert.match(skillText, /^---\n[\s\S]*name:\s*azure-rbac/m);

  const mcpJson = await fetchJson(
    `https://raw.githubusercontent.com/${SOURCE_REPO}/${branch}/.mcp.json`,
  );
  assert.ok(
    mcpJson.mcpServers?.azure,
    "Upstream MCP config should define azure server",
  );
  assert.strictEqual(mcpJson.mcpServers.azure.command, "npx");

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
