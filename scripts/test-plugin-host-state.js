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
const { collectPluginHostStates, withPluginStateTimeout } =
  requireTypeScriptModule(path.join(srcDir, "state.ts"), {
    "./types": types,
  });

(async () => {
  assert.strictEqual(
    await withPluginStateTimeout(Promise.resolve("done"), 20, "timeout"),
    "done",
  );
  assert.strictEqual(
    await withPluginStateTimeout(new Promise(() => {}), 1, "timeout"),
    "timeout",
  );

  const states = await collectPluginHostStates(
    [
      {
        hostId: "copilot-cli",
        operation: Promise.resolve({
          hostId: "copilot-cli",
          status: "installed",
          version: "1.2.3",
        }),
      },
      {
        hostId: "claude-code",
        operation: Promise.reject(new Error("probe failed")),
      },
      {
        hostId: "codex",
        operation: new Promise(() => {}),
      },
    ],
    1,
  );
  assert.strictEqual(states.get("copilot-cli").status, "installed");
  assert.deepStrictEqual(
    { ...states.get("claude-code") },
    {
      hostId: "claude-code",
      status: "error",
      reason: "probe failed",
    },
  );
  assert.deepStrictEqual(
    { ...states.get("codex") },
    {
      hostId: "codex",
      status: "error",
      reason: "Plugin state probe timed out.",
    },
  );
  console.log("RESULT=PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
