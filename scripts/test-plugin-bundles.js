#!/usr/bin/env node

const assert = require("assert");
const index = require("../resources/skill-index.json");

const pluginBundles = [
  {
    source: "microsoft-copilot-for-azure-plugin",
    bundleId: "microsoft-copilot-for-azure-plugin-skills",
    mode: "skill-only",
  },
  {
    source: "microsoft-azure-skills",
    bundleId: "microsoft-azure-skills-plugin-resources",
    mode: "skills-and-mcp",
  },
  {
    source: "aws-agent-plugins",
    bundleId: "aws-agent-plugin-skills",
    mode: "skill-only",
  },
  {
    source: "elastic-agent-skills",
    bundleId: "elastic-agent-plugin-skills",
    mode: "skill-only",
  },
];

function namesForSource(source) {
  return index.skills
    .filter((resource) => resource.source === source)
    .filter((resource) => (resource.kind || "skill") === "skill")
    .map((resource) => resource.name)
    .sort();
}

function resourceNamesForSource(source) {
  return index.skills
    .filter((resource) => resource.source === source)
    .map((resource) => resource.name)
    .sort();
}

function sorted(values) {
  return [...values].sort();
}

for (const { source, bundleId, mode } of pluginBundles) {
  const sourceInfo = index.sources.find((candidate) => candidate.id === source);
  assert.ok(sourceInfo, `Missing plugin source ${source}`);
  assert.ok(
    sourceInfo.includePaths?.length > 0,
    `Plugin source ${source} should use includePaths to avoid indexing the whole repository`,
  );

  const bundle = index.bundles.find((candidate) => candidate.id === bundleId);
  assert.ok(bundle, `Missing plugin bundle ${bundleId}`);
  assert.strictEqual(bundle.source, source);
  if (mode === "skill-only") {
    assert.match(
      bundle.description,
      /Safe skills set|Safe skill-only bundle/,
      `${bundleId} should clearly describe its safety boundary`,
    );
    assert.match(
      bundle.description,
      /hooks, MCP configuration, and executable plugin setup are not enabled automatically/,
      `${bundleId} should not imply full plugin activation`,
    );
  } else {
    assert.match(
      bundle.description,
      /Azure skills plus the Azure MCP config/,
      `${bundleId} should describe the mixed resource bundle`,
    );
    assert.match(
      bundle.description,
      /optional workspace mcp\.json merge/,
      `${bundleId} should preserve the MCP safety boundary`,
    );
  }

  const expectedNames =
    mode === "skills-and-mcp"
      ? resourceNamesForSource(source)
      : namesForSource(source);
  assert.ok(
    expectedNames.length > 0,
    `Expected indexed resources for ${source}`,
  );
  assert.deepStrictEqual(
    sorted(bundle.skills),
    expectedNames,
    `${bundleId} should include every expected indexed resource from ${source}`,
  );
  assert.deepStrictEqual(
    bundle.installOrder,
    bundle.skills,
    `${bundleId} should keep explicit installOrder aligned with skills`,
  );
}

console.log("PASS plugin-derived skill bundles are complete and safety-scoped");
console.log("RESULT=PASS");
