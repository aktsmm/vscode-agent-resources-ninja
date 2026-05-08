#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const index = require("../resources/skill-index.json");

const SOURCE_ID = "microsoft-copilot-for-azure-plugin";
const SOURCE_REPO = "microsoft/GitHub-Copilot-for-Azure";
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

async function main() {
  const source = index.sources.find((candidate) => candidate.id === SOURCE_ID);
  assert.ok(source, "Azure plugin source should be bundled");
  assert.strictEqual(source.type, "official");
  assert.deepStrictEqual(source.includePaths, ["plugin/skills/"]);

  const resources = index.skills.filter(
    (resource) => resource.source === SOURCE_ID,
  );
  assert.strictEqual(resources.length, 31, "Expected 31 Azure plugin skills");
  assert.ok(
    resources.every((resource) => (resource.kind || "skill") === "skill"),
  );
  assert.ok(
    resources.every((resource) => resource.path.startsWith("plugin/skills/")),
    "Azure plugin resources should stay under the filtered plugin/skills root",
  );

  const azureRbac = resources.find(
    (resource) => resource.name === "azure-rbac",
  );
  assert.ok(azureRbac, "Expected azure-rbac to be indexed");
  assert.strictEqual(azureRbac.path, "plugin/skills/azure-rbac");

  let branch = "main";
  let azureRbacFiles = [`${azureRbac.path}/SKILL.md`];
  try {
    const repo = await fetchJson(`https://api.github.com/repos/${SOURCE_REPO}`);
    branch = repo.default_branch || "main";
    const tree = await fetchJson(
      `https://api.github.com/repos/${SOURCE_REPO}/git/trees/${branch}?recursive=1`,
    );
    azureRbacFiles = tree.tree
      .map((entry) => entry.path)
      .filter((entryPath) => entryPath.startsWith(`${azureRbac.path}/`));
  } catch (error) {
    console.warn(
      "WARN GitHub API tree unavailable; verifying indexed Azure plugin content through raw URLs only",
    );
    console.warn(error instanceof Error ? error.message : String(error));
  }
  assert.ok(
    azureRbacFiles.includes(`${azureRbac.path}/SKILL.md`),
    "The indexed Azure plugin install path should contain SKILL.md upstream",
  );

  const skillText = await fetchText(
    `https://raw.githubusercontent.com/${SOURCE_REPO}/${branch}/${azureRbac.path}/SKILL.md`,
  );
  assert.match(skillText, /^---\n[\s\S]*name:\s*azure-rbac/m);

  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "resource-ninja-azure-plugin-"),
  );
  try {
    const installRoot = path.join(tempRoot, "azure-rbac");
    fs.mkdirSync(installRoot, { recursive: true });
    for (const upstreamPath of azureRbacFiles) {
      const relativePath = upstreamPath.slice(`${azureRbac.path}/`.length);
      const content = await fetchText(
        `https://raw.githubusercontent.com/${SOURCE_REPO}/${branch}/${upstreamPath}`,
      );
      const localPath = path.join(installRoot, relativePath);
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, content, "utf8");
    }
    assert.ok(
      fs.existsSync(path.join(installRoot, "SKILL.md")),
      "A lightweight install copy should create azure-rbac/SKILL.md",
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
