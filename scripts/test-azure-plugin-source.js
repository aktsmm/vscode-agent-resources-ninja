#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const index = require("../resources/skill-index.json");
const { loadRepositoryTree } = require("./update-preset-index.js");

const SOURCE_ID = "microsoft-copilot-for-azure-plugin";
const SOURCE_REPO = "microsoft/GitHub-Copilot-for-Azure";

function createHeaders(userAgent) {
  return { "User-Agent": userAgent };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: createHeaders("ResourceNinja-AzurePluginTest"),
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
    headers: createHeaders("ResourceNinja-AzurePluginTest"),
  });
  assert.ok(
    response.ok,
    `Expected ${url} to be reachable, got ${response.status}`,
  );
  return response.text();
}

async function fetchBuffer(url) {
  const response = await fetch(url, {
    headers: createHeaders("ResourceNinja-AzurePluginTest"),
  });
  assert.ok(
    response.ok,
    `Expected ${url} to be reachable, got ${response.status}`,
  );
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const source = index.sources.find((candidate) => candidate.id === SOURCE_ID);
  assert.ok(source, "Azure plugin source should be bundled");
  assert.strictEqual(source.type, "official");
  assert.deepStrictEqual(source.includePaths, [
    "plugin/skills/",
    "plugin/.plugin/",
    "plugin/.claude-plugin/",
    "plugin/.cursor-plugin/",
    "plugin/gemini-extension.json",
  ]);

  const resources = index.skills.filter(
    (resource) => resource.source === SOURCE_ID,
  );
  const skillResources = resources.filter(
    (resource) => (resource.kind || "skill") === "skill",
  );
  const pluginResources = resources.filter(
    (resource) => resource.kind === "plugin",
  );
  assert.ok(skillResources.length > 0, "Expected indexed Azure plugin skills");
  assert.strictEqual(
    pluginResources.length,
    1,
    "Expected one Azure plugin manifest",
  );
  const azurePlugin = pluginResources[0];
  assert.strictEqual(azurePlugin.path, "plugin");
  assert.strictEqual(azurePlugin.pluginRoot, "plugin");
  assert.strictEqual(
    azurePlugin.pluginManifestPath,
    "plugin/.plugin/plugin.json",
  );
  assert.strictEqual(resources.length, skillResources.length + 1);
  assert.ok(
    skillResources.every((resource) =>
      resource.path.startsWith("plugin/skills/"),
    ),
    "Azure plugin resources should stay under the filtered plugin/skills root",
  );

  const repositoryTree = await loadRepositoryTree(
    "microsoft",
    "GitHub-Copilot-for-Azure",
    "main",
  );
  const branch = repositoryTree.branch;
  const upstreamSkillPaths = repositoryTree.data.tree
    .filter(
      (entry) =>
        entry.type === "blob" &&
        /^plugin\/skills\/.+\/SKILL\.md$/.test(entry.path),
    )
    .map((entry) => entry.path.replace(/\/SKILL\.md$/, ""))
    .sort();
  assert.deepStrictEqual(
    skillResources.map((resource) => resource.path).sort(),
    upstreamSkillPaths,
    "Indexed Azure plugin skills should match the current upstream tree",
  );
  assert.ok(
    repositoryTree.data.tree.some(
      (entry) => entry.path === "plugin/.plugin/plugin.json",
    ),
    "The indexed Azure plugin manifest should exist upstream",
  );

  const representativeSkill =
    skillResources.find((resource) => resource.name === "azure-prepare") ||
    skillResources[0];
  const representativeFiles = repositoryTree.data.tree
    .filter(
      (entry) =>
        entry.type === "blob" &&
        entry.path.startsWith(`${representativeSkill.path}/`),
    )
    .map((entry) => entry.path);
  assert.ok(
    representativeFiles.includes(`${representativeSkill.path}/SKILL.md`),
    "Representative Azure plugin skill should contain SKILL.md upstream",
  );

  const skillText = await fetchText(
    `https://raw.githubusercontent.com/${SOURCE_REPO}/${branch}/${representativeSkill.path}/SKILL.md`,
  );
  assert.match(skillText, /^---\n[\s\S]*name:/m);

  const pluginJson = await fetchJson(
    `https://raw.githubusercontent.com/${SOURCE_REPO}/${branch}/plugin/.plugin/plugin.json`,
  );
  assert.strictEqual(pluginJson.name, "azure");

  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "resource-ninja-azure-plugin-"),
  );
  try {
    const installRoot = path.join(tempRoot, representativeSkill.name);
    fs.mkdirSync(installRoot, { recursive: true });
    for (const upstreamPath of representativeFiles) {
      const relativePath = upstreamPath.slice(
        `${representativeSkill.path}/`.length,
      );
      const content = await fetchBuffer(
        `https://raw.githubusercontent.com/${SOURCE_REPO}/${branch}/${upstreamPath}`,
      );
      const localPath = path.join(installRoot, relativePath);
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, content);
    }
    assert.ok(
      fs.existsSync(path.join(installRoot, "SKILL.md")),
      "A lightweight install copy should create the representative SKILL.md",
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  console.log(
    "PASS Azure plugin source is indexed and upstream install content can be copied",
  );
  console.log("RESULT=PASS");
}

main().catch((error) => {
  console.error("FAIL Azure plugin source regression");
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
