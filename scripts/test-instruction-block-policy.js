const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
);
const customizationPathsSource = fs.readFileSync(
  path.join(repoRoot, "src", "customizationPaths.ts"),
  "utf8",
);
const instructionManagerSource = fs.readFileSync(
  path.join(repoRoot, "src", "instructionManager.ts"),
  "utf8",
);

function test(name, fn) {
  try {
    fn();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${name}\n${error.stack}\n`);
    process.exitCode = 1;
  }
}

function loadCustomizationPathsExports() {
  const transpiled = ts.transpileModule(customizationPathsSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;

  const module = { exports: {} };
  const mockVscode = {
    workspace: {
      getConfiguration() {
        return {
          get() {
            return undefined;
          },
          inspect() {
            return undefined;
          },
        };
      },
    },
    Uri: {
      file(fsPath) {
        return { fsPath };
      },
      joinPath(base, ...segments) {
        return { fsPath: path.join(base.fsPath, ...segments) };
      },
    },
  };

  const localRequire = (id) => {
    if (id === "vscode") {
      return mockVscode;
    }
    if (id === "os") {
      return require("os");
    }
    if (id === "path") {
      return require("path");
    }
    throw new Error(`Unexpected require: ${id}`);
  };

  const fn = new Function("require", "module", "exports", transpiled);
  fn(localRequire, module, module.exports);
  return module.exports;
}

function createConfig(values) {
  return {
    get(key) {
      return values[key];
    },
    inspect() {
      return undefined;
    },
  };
}

const { getInstructionBlockKinds } = loadCustomizationPathsExports();

test("instruction block policy defaults to skill plus agent", () => {
  const kinds = getInstructionBlockKinds(createConfig({}), "workspace");
  assert.deepStrictEqual(kinds, ["skill", "agent"]);
});

test("instruction block policy can opt workspace instructions in", () => {
  const kinds = getInstructionBlockKinds(
    createConfig({
      "instructionBlock.includeInstructions": true,
    }),
    "workspace",
  );
  assert.deepStrictEqual(kinds, ["skill", "agent", "instruction"]);
});

test("instruction block policy can opt workspace agents out", () => {
  const kinds = getInstructionBlockKinds(
    createConfig({
      "instructionBlock.includeAgents": false,
    }),
    "workspace",
  );
  assert.deepStrictEqual(kinds, ["skill"]);
});

test("global home policy inherits workspace toggles by default", () => {
  const kinds = getInstructionBlockKinds(
    createConfig({
      "instructionBlock.includeAgents": false,
      "instructionBlock.includeInstructions": true,
    }),
    "globalHome",
  );
  assert.deepStrictEqual(kinds, ["skill", "instruction"]);
});

test("global home policy overrides workspace toggles when requested", () => {
  const kinds = getInstructionBlockKinds(
    createConfig({
      "instructionBlock.includeAgents": false,
      "instructionBlock.includeInstructions": false,
      "instructionBlock.globalHome.includeAgents": "on",
      "instructionBlock.globalHome.includeInstructions": "on",
    }),
    "globalHome",
  );
  assert.deepStrictEqual(kinds, ["skill", "agent", "instruction"]);
});

test("legacy kindsExcluded still removes agent or instruction but not skill", () => {
  const kinds = getInstructionBlockKinds(
    createConfig({
      kindsExcluded: ["skill", "agent"],
    }),
    "workspace",
  );
  assert.deepStrictEqual(kinds, ["skill"]);
});

test("legacy kindsExcluded can be ignored during sibling coexistence handling", () => {
  const kinds = getInstructionBlockKinds(
    createConfig({
      kindsExcluded: ["agent"],
    }),
    "workspace",
    { ignoreLegacyKindsExcluded: true },
  );
  assert.deepStrictEqual(kinds, ["skill", "agent"]);
});

test("instruction manager applies scope-aware instruction block kinds in shared mode", () => {
  assert.match(instructionManagerSource, /getInstructionBlockKindsForRuntime/);
  assert.match(
    instructionManagerSource,
    /skillSource\.scope,[\s\S]*siblingDetected,[\s\S]*owner/,
  );
  assert.match(
    instructionManagerSource,
    /instructionBlockKinds\.includes\(resource\.kind\)/,
  );
});

test("manifest contributes instruction block policy settings", () => {
  const config = packageJson.contributes?.configuration?.properties || {};
  assert.strictEqual(
    config["resourceNinja.instructionBlock.includeAgents"]?.default,
    true,
  );
  assert.strictEqual(
    config["resourceNinja.instructionBlock.includeInstructions"]?.default,
    false,
  );
  assert.deepStrictEqual(
    config["resourceNinja.instructionBlock.globalHome.includeAgents"]?.enum,
    ["inherit", "on", "off"],
  );
  assert.deepStrictEqual(
    config["resourceNinja.instructionBlock.globalHome.includeInstructions"]?.enum,
    ["inherit", "on", "off"],
  );
});