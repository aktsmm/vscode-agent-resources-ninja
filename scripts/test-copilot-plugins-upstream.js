#!/usr/bin/env node

const assert = require("assert");
const { loadRepositoryTree } = require("./update-preset-index.js");

const EXPECTED_PATHS = [
  ".github/plugin/marketplace.json",
  "plugins/build-perf-cpp/plugin.json",
  "plugins/build-perf-cpp/hooks/hooks.json",
  "plugins/build-perf-cpp/skills/build-performance-analysis/SKILL.md",
  "plugins/spark/skills/spark-app-template/SKILL.md",
];

(async () => {
  const repositoryTree = await loadRepositoryTree(
    "github",
    "copilot-plugins",
    "main",
  );
  const tree = repositoryTree.data;
  assert.notStrictEqual(
    tree.truncated,
    true,
    "GitHub tree must not be truncated",
  );
  const paths = new Set(tree.tree.map((entry) => entry.path));
  for (const expectedPath of EXPECTED_PATHS) {
    assert.ok(
      paths.has(expectedPath),
      `Missing upstream path: ${expectedPath}`,
    );
  }

  const marketplaceResponse = await fetch(
    "https://raw.githubusercontent.com/github/copilot-plugins/main/.github/plugin/marketplace.json",
  );
  assert.strictEqual(
    marketplaceResponse.ok,
    true,
    `Marketplace: ${marketplaceResponse.status}`,
  );
  const marketplace = await marketplaceResponse.json();
  assert.strictEqual(marketplace.name, "copilot-plugins");
  assert.ok(
    marketplace.plugins.some(
      (plugin) =>
        plugin.name === "build-perf-cpp" &&
        plugin.source === "./plugins/build-perf-cpp",
    ),
  );
  assert.ok(
    marketplace.plugins.some(
      (plugin) =>
        plugin.name === "spark" && plugin.source === "./plugins/spark",
    ),
  );
  assert.ok(
    marketplace.plugins.some(
      (plugin) =>
        plugin.name === "workiq" && plugin.source?.repo === "microsoft/work-iq",
    ),
    "External entries remain catalog metadata",
  );
  console.log("RESULT=PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
