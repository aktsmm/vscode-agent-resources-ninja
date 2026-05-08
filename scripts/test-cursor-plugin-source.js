#!/usr/bin/env node

const assert = require("assert");
const index = require("../resources/skill-index.json");

const SOURCE_ID = "cursor-official-plugins";

function findResource(kind, path) {
  return index.skills.find(
    (resource) =>
      resource.source === SOURCE_ID &&
      (resource.kind || "skill") === kind &&
      resource.path === path,
  );
}

const source = index.sources.find((entry) => entry.id === SOURCE_ID);
assert.ok(source, "Expected Cursor official plugins source to be indexed");
assert.strictEqual(source.url, "https://github.com/cursor/plugins");
assert.strictEqual(source.type, "official");

const cursorResources = index.skills.filter(
  (resource) => resource.source === SOURCE_ID,
);
assert.ok(
  cursorResources.length >= 50,
  "Expected Cursor source to index plugin manifests and child resources",
);

const kindCounts = cursorResources.reduce((counts, resource) => {
  const kind = resource.kind || "skill";
  counts[kind] = (counts[kind] || 0) + 1;
  return counts;
}, {});
assert.ok(kindCounts.plugin >= 10, "Expected Cursor plugin manifests");
assert.ok(kindCounts.skill >= 20, "Expected Cursor plugin-contained skills");
assert.ok(kindCounts.agent >= 5, "Expected Cursor plugin-contained agents");
assert.ok(kindCounts["cursor-rule"] >= 3, "Expected Cursor rules");

const createPlugin = findResource("plugin", "create-plugin");
assert.ok(createPlugin, "Expected create-plugin manifest resource");
assert.strictEqual(createPlugin.pluginRoot, "create-plugin");
assert.strictEqual(
  createPlugin.pluginManifestPath,
  "create-plugin/.cursor-plugin/plugin.json",
);
assert.strictEqual(createPlugin.pluginManifestKind, "cursor-plugin");

assert.ok(
  findResource("skill", "create-plugin/skills/create-plugin-scaffold"),
  "Expected Cursor plugin skill to be individually installable",
);
assert.ok(
  findResource("agent", "create-plugin/agents/plugin-architect.md"),
  "Expected Cursor plugin agent to be individually installable",
);
assert.ok(
  findResource("cursor-rule", "create-plugin/rules/plugin-quality-gates.mdc"),
  "Expected Cursor plugin rule to be individually installable",
);

console.log(
  "PASS Cursor official plugins are indexed as plugin manifests and individual child resources",
);
console.log("RESULT=PASS");
