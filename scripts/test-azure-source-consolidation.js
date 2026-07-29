#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const index = require("../resources/skill-index.json");

const retiredSourceId = "microsoft-copilot-for-azure-plugin";
const canonicalSourceId = "microsoft-azure-skills";

assert.ok(
  !index.sources.some((source) => source.id === retiredSourceId),
  "Retired Azure plugin source must not be bundled",
);
assert.ok(
  !index.skills.some((resource) => resource.source === retiredSourceId),
  "Retired Azure plugin resources must not remain in the index",
);
assert.ok(
  !(index.bundles || []).some(
    (bundle) =>
      bundle.source === retiredSourceId ||
      bundle.id === "microsoft-copilot-for-azure-plugin-skills",
  ),
  "Retired Azure plugin bundle must not remain in the index",
);

const canonicalSource = index.sources.find(
  (source) => source.id === canonicalSourceId,
);
assert.ok(canonicalSource, "Canonical Microsoft Azure source should be bundled");
assert.deepStrictEqual(canonicalSource.includePaths, [
  "skills/",
  ".mcp.json",
  "plugin.json",
  ".claude-plugin/",
  ".cursor-plugin/",
  "gemini-extension.json",
]);

const canonicalResources = index.skills.filter(
  (resource) => resource.source === canonicalSourceId,
);
assert.ok(
  canonicalResources.some((resource) => (resource.kind || "skill") === "skill"),
  "Canonical Azure source should retain skills",
);
assert.ok(
  canonicalResources.some((resource) => resource.kind === "plugin"),
  "Canonical Azure source should retain its plugin manifest",
);
assert.ok(
  canonicalResources.some((resource) => resource.kind === "mcp"),
  "Canonical Azure source should retain its MCP config",
);

const installerSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "skillInstaller.ts"),
  "utf8",
);
assert.match(
  installerSource,
  /"microsoft-copilot-for-azure-plugin": "microsoft-azure-skills"/,
  "Installed metadata from the retired source should migrate to the canonical source",
);

console.log(
  "PASS retired Azure plugin source is consolidated into the canonical Azure source",
);
console.log("RESULT=PASS");