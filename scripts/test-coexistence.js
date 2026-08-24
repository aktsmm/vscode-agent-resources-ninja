const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const packageJson = require(path.join(repoRoot, "package.json"));

function requireTypeScriptModule(filePath, stubs = {}) {
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  });
  const loaded = new Module(filePath, module);
  loaded.filename = filePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(filePath));
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) =>
    Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad(request, parent, isMain);
  try {
    loaded._compile(transpiled.outputText, filePath);
  } finally {
    Module._load = originalLoad;
  }
  return loaded.exports;
}

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

  const { computeOwnership } = requireTypeScriptModule(
    path.join(repoRoot, "src", "coexistence.ts"),
    {
      vscode: {
        extensions: { all: [], getExtension: () => undefined },
        workspace: { getConfiguration: () => ({ get: () => undefined }) },
      },
      "./customizationPaths": { getConfiguredCoexistenceMode: () => "auto" },
      "./skillIndex": {},
      "./logger": {
        logger: {
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
        },
      },
    },
  );
  assert.strictEqual(typeof computeOwnership, "function");

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

test("coexistence fixture docs use current resource output command names", () => {
  const fixtureBuilderSource = fs.readFileSync(
    path.join(repoRoot, "scripts", "build-coexistence-fixture.js"),
    "utf8",
  );
  assert.match(fixtureBuilderSource, /Update Resource Output/);
  assert.doesNotMatch(fixtureBuilderSource, /Update Instruction File/);
});
