#!/usr/bin/env node

const assert = require("assert");
const index = require("../resources/skill-index.json");

const SOURCE_ID = "github-copilot-plugins";
const source = index.sources.find((entry) => entry.id === SOURCE_ID);
assert.ok(source, "Expected GitHub Copilot plugins source");
assert.strictEqual(source.url, "https://github.com/github/copilot-plugins");
assert.strictEqual(source.type, "official");
assert.deepStrictEqual(source.includePaths, [".github/plugin/", "plugins/"]);

const resources = index.skills.filter(
  (resource) => resource.source === SOURCE_ID,
);
assert.strictEqual(
  resources.length,
  5,
  "Expected exactly the five physical resources",
);
assert.deepStrictEqual(
  resources.reduce((counts, resource) => {
    const kind = resource.kind || "skill";
    counts[kind] = (counts[kind] || 0) + 1;
    return counts;
  }, {}),
  { plugin: 2, skill: 2, hook: 1 },
);

function find(kind, resourcePath) {
  return resources.find(
    (resource) =>
      (resource.kind || "skill") === kind && resource.path === resourcePath,
  );
}

const marketplace = find("plugin", ".");
assert.strictEqual(marketplace.pluginManifestKind, "marketplace");
assert.strictEqual(
  marketplace.pluginManifestPath,
  ".github/plugin/marketplace.json",
);
assert.ok(
  !resources.some((resource) =>
    String(resource.pluginManifestPath || "").startsWith(".claude-plugin/"),
  ),
  "Compatibility marketplace must not be indexed twice",
);

for (const resourcePath of [
  "plugins/build-perf-cpp/skills/build-performance-analysis",
  "plugins/build-perf-cpp/hooks/hooks.json",
]) {
  const resource = resources.find(
    (candidate) => candidate.path === resourcePath,
  );
  assert.ok(resource, `Missing ${resourcePath}`);
  assert.strictEqual(resource.pluginRoot, "plugins/build-perf-cpp");
  assert.strictEqual(
    resource.pluginManifestPath,
    "plugins/build-perf-cpp/plugin.json",
  );
  assert.strictEqual(resource.pluginManifestKind, "plugin");
}

const hook = find("hook", "plugins/build-perf-cpp/hooks/hooks.json");
assert.strictEqual(hook.name, "build-perf-cpp-hooks");
assert.strictEqual(hook.description, "Hook configuration for build-perf-cpp");

const spark = find("skill", "plugins/spark/skills/spark-app-template");
assert.ok(spark, "Expected Spark skill");
assert.strictEqual(spark.pluginManifestKind, "marketplace");

for (const externalName of ["workiq", "advanced-security", "fabric-skills"]) {
  assert.ok(
    !resources.some((resource) => resource.name === externalName),
    `External marketplace entry ${externalName} must not become a fake local resource`,
  );
}

console.log("RESULT=PASS");
