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
const vscodeAdapter = requireTypeScriptModule(
  path.join(srcDir, "adapters", "vscodeCopilot.ts"),
  { "../types": types, "../artifact": artifact },
);
const cliAdapter = requireTypeScriptModule(
  path.join(srcDir, "adapters", "copilotCli.ts"),
  { "../types": types, "../artifact": artifact },
);
const claudeAdapter = requireTypeScriptModule(
  path.join(srcDir, "adapters", "claudeCode.ts"),
  { "../types": types, "../artifact": artifact },
);
const codexAdapter = requireTypeScriptModule(
  path.join(srcDir, "adapters", "codex.ts"),
  { "../types": types, "../artifact": artifact },
);
const cursorAdapter = requireTypeScriptModule(
  path.join(srcDir, "adapters", "cursor.ts"),
  { "../types": types, "../artifact": artifact },
);
const registryModule = requireTypeScriptModule(
  path.join(srcDir, "registry.ts"),
  {
    "./adapters/vscodeCopilot": vscodeAdapter,
    "./adapters/copilotCli": cliAdapter,
    "./adapters/claudeCode": claudeAdapter,
    "./adapters/codex": codexAdapter,
    "./adapters/cursor": cursorAdapter,
    "./types": types,
  },
);

function verifiedMarketplace(overrides = {}) {
  const identity = artifact.createVerifiedMarketplaceIdentity({
    manifestContent: JSON.stringify({
      name: "acme-market",
      plugins: [{ name: "demo", source: "plugins/demo" }],
    }),
    manifestSourceUrl:
      "https://raw.githubusercontent.com/acme/plugins/main/.github/plugin/marketplace.json",
    sourceRepository: "acme/plugins",
    pluginRoot: "plugins/demo",
    ...overrides,
  });
  assert.ok(identity);
  return identity;
}

assert.strictEqual(
  artifact.createVerifiedMarketplaceIdentity({
    manifestContent: JSON.stringify({
      name: "acme-market",
      plugins: [{ name: "demo", source: "plugins/demo" }],
    }),
    manifestSourceUrl:
      "https://raw.githubusercontent.com/other/plugins/main/marketplace.json",
    sourceRepository: "acme/plugins",
    pluginRoot: "plugins/demo",
  }),
  undefined,
);

function completeArtifact(overrides = {}) {
  const result = artifact.createPluginArtifact({
    kind: "plugin",
    name: "demo",
    sourceId: "acme-plugins",
    remotePath: "plugins/demo",
    packageRootUri: "https://github.com/acme/plugins/tree/main/plugins/demo",
    packageRootPath: "plugins/demo",
    manifestPath: "plugins/demo/plugin.json",
    manifestKind: "agent-plugins",
    source: {
      kind: "github",
      repository: "acme/plugins",
      url: "https://github.com/acme/plugins",
      ref: "main",
    },
    availability: "complete",
    resolutionMode: "host-resolved",
    ...overrides,
  });
  assert.strictEqual(result.ok, true);
  return result.artifact;
}

assert.strictEqual(
  artifact.createPluginArtifact({ kind: "skill", name: "demo" }).ok,
  false,
);
assert.strictEqual(
  artifact.createPluginArtifact({
    kind: "plugin",
    name: "catalog",
    sourceId: "acme",
    packageRootUri: "https://github.com/acme/plugins",
    manifestPath: ".claude-plugin/marketplace.json",
    manifestKind: "marketplace",
  }).ok,
  false,
);

const complete = completeArtifact();
assert.strictEqual(artifact.isNativeInstallCandidate(complete), true);
assert.strictEqual(
  artifact.isNativeInstallCandidate(
    completeArtifact({ availability: "incomplete" }),
  ),
  false,
);
assert.strictEqual(
  artifact.isNativeInstallCandidate(
    completeArtifact({ source: { kind: "unknown", label: "acme" } }),
  ),
  false,
);

const registry = registryModule.createBaselinePluginHostRegistry();
assert.deepStrictEqual(
  registry.list().map((adapter) => adapter.capability.id),
  ["vscode-copilot", "copilot-cli", "claude-code", "codex", "cursor"],
);
assert.strictEqual(
  registry.get("claude-code").capability.supportLevel,
  "native",
);
assert.strictEqual(registry.get("codex").capability.supportLevel, "native");
assert.strictEqual(registry.get("cursor").capability.supportLevel, "native");
assert.strictEqual(
  registry.get("vscode-copilot").supportsArtifact(complete),
  true,
);
assert.strictEqual(
  registry.get("copilot-cli").supportsArtifact(complete),
  false,
);
assert.strictEqual(
  registry.get("copilot-cli").supportsArtifact(
    completeArtifact({
      marketplace: verifiedMarketplace(),
    }),
  ),
  true,
);
assert.strictEqual(
  registry.get("copilot-cli").supportsArtifact(
    completeArtifact({
      resolutionMode: "local-copy",
      marketplace: verifiedMarketplace(),
    }),
  ),
  false,
);
assert.strictEqual(
  registry.get("copilot-cli").supportsArtifact(
    completeArtifact({
      marketplace: verifiedMarketplace({
        sourceRepository: "other/plugins",
        manifestSourceUrl:
          "https://raw.githubusercontent.com/other/plugins/main/.github/plugin/marketplace.json",
      }),
    }),
  ),
  false,
);
assert.strictEqual(
  artifact.createPluginArtifact({
    kind: "plugin",
    name: "demo",
    sourceId: "acme-plugins",
    packageRootUri: "https://github.com/acme/plugins/tree/main/plugins/demo",
    packageRootPath: "plugins/demo",
    manifestPath: "plugins/demo/plugin.json",
    manifestKind: "agent-plugins",
    marketplace: {
      marketplaceName: "forged-market",
      pluginName: "demo",
      sourceRepository: "acme/plugins",
      pluginRoot: "plugins/demo",
    },
  }).ok,
  false,
);

assert.throws(
  () =>
    new registryModule.PluginHostRegistry().register({
      capability: {
        id: "gemini-cli",
        displayName: "Gemini CLI",
        supportLevel: "native",
        surfaces: ["cli"],
        actions: ["install"],
        scopes: ["user"],
        acceptedManifestKinds: ["claude-plugin"],
      },
      supportsArtifact: () => true,
    }),
  /not enabled/,
);

console.log("RESULT=PASS");
