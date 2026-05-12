const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const packageJson = require(path.join(repoRoot, "package.json"));

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${name}\n${error.stack}\n`);
    process.exitCode = 1;
  }
}

test("manifest exposes coexistence commands and settings", () => {
  const commandIds = new Set(
    (packageJson.contributes.commands || []).map((command) => command.command),
  );
  assert(commandIds.has("resourceNinja.showCoexistenceStatus"));
  assert(commandIds.has("resourceNinja.recomputeOwnership"));
  assert(commandIds.has("resourceNinja.cleanupOrphanBlock"));

  const settings = packageJson.contributes.configuration.properties;
  assert(settings["resourceNinja.coexistenceMode"]);
  assert(settings["resourceNinja.kindsExcluded"]);
  assert(settings["resourceNinja.instructionBlock.includeAgents"]);
  assert(settings["resourceNinja.instructionBlock.includeInstructions"]);
  assert(settings["resourceNinja.instructionBlock.globalHome.includeAgents"]);
  assert(
    settings["resourceNinja.instructionBlock.globalHome.includeInstructions"],
  );
  assert(settings["resourceNinja.useSharedSourcesManifest"]);
  assert(settings["resourceNinja.useSharedResourceIndex"]);
});

test("coexistence ownership prefers the broader kind set", () => {
  const coexistenceSource = fs.readFileSync(
    path.join(repoRoot, "src", "coexistence.ts"),
    "utf8",
  );
  assert.match(coexistenceSource, /function computeOwnership/);
  assert.match(coexistenceSource, /RESOURCE_NINJA_KINDS/);

  const computeOwnership = (self, sibling) => {
    if (!sibling) {
      return "self";
    }

    const selfKinds = new Set(self.kinds);
    const siblingKinds = new Set(sibling.kinds);

    const selfIsSubset = [...selfKinds].every((kind) => siblingKinds.has(kind));
    const siblingIsSubset = [...siblingKinds].every((kind) =>
      selfKinds.has(kind),
    );

    if (selfIsSubset && !siblingIsSubset) return "sibling";
    if (siblingIsSubset && !selfIsSubset) return "self";
    return self.extensionId < sibling.extensionId ? "self" : "sibling";
  };

  const self = {
    extensionId: "yamapan.agent-resources-ninja",
    version: "0.0.0",
    kinds: [
      "skill",
      "agent",
      "instruction",
      "prompt",
      "hook",
      "mcp",
      "plugin",
      "cursor-rule",
    ],
    capabilities: [],
    protocolVersion: 3,
    updatedAt: new Date().toISOString(),
  };

  const sibling = {
    extensionId: "yamapan.agent-skill-ninja",
    version: "0.0.0",
    kinds: ["skill"],
    capabilities: [],
    protocolVersion: 3,
    updatedAt: new Date().toISOString(),
  };

  assert.strictEqual(computeOwnership(self, undefined), "self");
  assert.strictEqual(computeOwnership(self, sibling), "self");
  assert.strictEqual(computeOwnership(sibling, self), "sibling");
});

test("shared marker strings are wired in source", () => {
  const instructionManagerSource = fs.readFileSync(
    path.join(repoRoot, "src", "instructionManager.ts"),
    "utf8",
  );

  assert.match(instructionManagerSource, /<!-- agent-ninja-START -->/);
  assert.match(
    instructionManagerSource,
    /Skill NINJA is owner\. Resource NINJA defers\./,
  );
  assert.match(instructionManagerSource, /setTimeout\(resolve, 200\)/);
});
