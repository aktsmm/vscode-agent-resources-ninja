const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

function requireTypeScriptModule(filePath, stubs = {}) {
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  });
  const loadedModule = new Module(filePath, module);
  loadedModule.filename = filePath;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(filePath));
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) {
      return stubs[request];
    }
    return originalLoad(request, parent, isMain);
  };
  try {
    loadedModule._compile(transpiled.outputText, filePath);
  } finally {
    Module._load = originalLoad;
  }
  return loadedModule.exports;
}

const srcDir = path.join(__dirname, "..", "src", "pluginHosts");
const types = requireTypeScriptModule(path.join(srcDir, "types.ts"));
const evaluated = requireTypeScriptModule(
  path.join(srcDir, "evaluatedHosts.ts"),
  { "./types": types },
);

assert.strictEqual(evaluated.GEMINI_CLI_EVALUATION.supportLevel, "unsupported");
assert.strictEqual(
  evaluated.GEMINI_CLI_EVALUATION.acceptedManifestKinds.includes(
    "gemini-extension",
  ),
  true,
);
assert.strictEqual(evaluated.CLINE_CLI_EVALUATION.supportLevel, "unsupported");
assert.deepStrictEqual(
  evaluated.CLINE_CLI_EVALUATION.acceptedManifestKinds,
  [],
);
assert.strictEqual(
  evaluated.PORTABLE_RESOURCES_EVALUATION.supportLevel,
  "resources-only",
);
for (const capability of evaluated.EVALUATED_FUTURE_HOSTS) {
  assert.strictEqual(capability.actions.includes("install"), false);
}

console.log("RESULT=PASS");
