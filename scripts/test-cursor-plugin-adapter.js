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
      esModuleInterop: true,
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
const artifact = requireTypeScriptModule(path.join(srcDir, "artifact.ts"), {
  "./types": types,
});
const adapter = requireTypeScriptModule(
  path.join(srcDir, "adapters", "cursor.ts"),
  { "../types": types, "../artifact": artifact },
);

assert.strictEqual(adapter.isCursorEditor("Cursor", "cursor"), true);
assert.strictEqual(
  adapter.isCursorEditor("Visual Studio Code", "vscode"),
  false,
);
assert.strictEqual(
  adapter.getCursorLocalPluginPath("/home/demo", "review-tools"),
  path.join("/home/demo", ".cursor", "plugins", "local", "review-tools"),
);
assert.strictEqual(
  adapter.getCursorLocalPluginPath("/home/demo", "../escape"),
  undefined,
);
assert.strictEqual(adapter.CURSOR_CAPABILITY.supportLevel, "native");
assert.strictEqual(adapter.CURSOR_CAPABILITY.actions.includes("install"), true);

for (const manifestKind of ["agent-plugins", "cursor-plugin"]) {
  const result = artifact.createPluginArtifact({
    kind: "plugin",
    name: "review-tools",
    sourceId: "cursor-plugins",
    remotePath: "plugins/review-tools",
    packageRootUri: "https://github.com/cursor/plugins/tree/main/review-tools",
    packageRootPath: "review-tools",
    manifestPath:
      manifestKind === "agent-plugins"
        ? "review-tools/plugin.json"
        : "review-tools/.cursor-plugin/plugin.json",
    manifestKind,
    source: {
      kind: "github",
      repository: "cursor/plugins",
      url: "https://github.com/cursor/plugins",
    },
    availability: "complete",
    resolutionMode: "local-copy",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(
    adapter.cursorAdapter.supportsArtifact(result.artifact),
    true,
  );
}

console.log("RESULT=PASS");
