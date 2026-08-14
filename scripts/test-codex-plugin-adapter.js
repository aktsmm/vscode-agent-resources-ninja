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
  path.join(srcDir, "adapters", "codex.ts"),
  { "../types": types, "../artifact": artifact },
);

assert.strictEqual(
  adapter.getCodexAvailability({ extensionDetected: true }),
  "extension-handoff",
);
assert.strictEqual(
  adapter.getCodexAvailability({
    extensionDetected: false,
    executablePath: "/usr/bin/codex",
    nativeExecutionEnabled: true,
  }),
  "native-ready",
);
assert.deepStrictEqual(adapter.planCodexMarketplaceHandoff("acme/plugins"), [
  "plugin",
  "marketplace",
  "add",
  "acme/plugins",
]);
assert.strictEqual(adapter.CODEX_CAPABILITY.supportLevel, "native");
assert.strictEqual(adapter.CODEX_CAPABILITY.actions.includes("install"), true);

const result = artifact.createPluginArtifact({
  kind: "plugin",
  name: "demo",
  sourceId: "acme-codex",
  remotePath: "plugins/demo",
  packageRootUri: "https://github.com/acme/plugins/tree/main/plugins/demo",
  packageRootPath: "plugins/demo",
  manifestPath: "plugins/demo/.codex-plugin/plugin.json",
  manifestKind: "codex-plugin",
  source: {
    kind: "github",
    repository: "acme/plugins",
    url: "https://github.com/acme/plugins",
  },
  availability: "complete",
  resolutionMode: "host-resolved",
});
assert.strictEqual(result.ok, true);
assert.strictEqual(
  adapter.codexAdapter.supportsArtifact(result.artifact),
  true,
);
assert.deepStrictEqual(
  adapter.parseCodexMarketplaceListJson(
    JSON.stringify({
      marketplaces: [
        {
          name: "resource-ninja-test",
          root: "C:/cache/resource-ninja-test",
          marketplaceSource: {
            sourceType: "git",
            source: "https://github.com/acme/plugins.git",
          },
        },
      ],
    }),
  ),
  [
    {
      name: "resource-ninja-test",
      root: "C:/cache/resource-ninja-test",
      sourceType: "git",
      source: "https://github.com/acme/plugins.git",
    },
  ],
);
assert.deepStrictEqual(
  adapter.parseCodexPluginListJson(
    JSON.stringify({
      installed: [
        {
          pluginId: "unknown@market",
          name: "unknown",
          marketplaceName: "market",
        },
      ],
    }),
  ),
  [
    {
      pluginId: "unknown@market",
      name: "unknown",
      marketplaceName: "market",
      version: undefined,
      installed: undefined,
      enabled: undefined,
    },
  ],
);

function fakeRunner(results) {
  const calls = [];
  return {
    calls,
    async run(args) {
      calls.push([...args]);
      assert.ok(results.length, `Unexpected command: ${args.join(" ")}`);
      return results.shift();
    },
  };
}

(async () => {
  const runner = fakeRunner([
    {
      exitCode: 0,
      stdout: JSON.stringify({ marketplaces: [] }),
      stderr: "",
    },
    { exitCode: 0, stdout: "{}", stderr: "" },
    { exitCode: 0, stdout: "{}", stderr: "" },
    {
      exitCode: 0,
      stdout: JSON.stringify({
        installed: [
          {
            pluginId: "safe-demo@resource-ninja-test",
            name: "safe-demo",
            marketplaceName: "resource-ninja-test",
            version: "1.0.0",
            installed: true,
            enabled: true,
          },
        ],
        available: [],
      }),
      stderr: "",
    },
  ]);
  assert.deepStrictEqual(
    await adapter.installCodexPlugin({
      runner,
      pluginName: "safe-demo",
      marketplaceName: "resource-ninja-test",
      marketplaceSource: "acme/plugins",
    }),
    { ok: true, marketplaceAdded: true },
  );
  assert.deepStrictEqual(runner.calls, [
    ["plugin", "marketplace", "list", "--json"],
    ["plugin", "marketplace", "add", "acme/plugins", "--json"],
    ["plugin", "add", "safe-demo@resource-ninja-test", "--json"],
    ["plugin", "list", "--json"],
  ]);
  const removeRunner = fakeRunner([
    {
      exitCode: 0,
      stdout: JSON.stringify({
        marketplaces: [
          {
            name: "resource-ninja-test",
            root: "C:/cache",
            marketplaceSource: {
              sourceType: "git",
              source: "https://github.com/acme/plugins.git",
            },
          },
        ],
      }),
      stderr: "",
    },
    { exitCode: 0, stdout: "{}", stderr: "" },
  ]);
  assert.deepStrictEqual(
    await adapter.uninstallCodexPlugin({
      runner: removeRunner,
      pluginId: "safe-demo@resource-ninja-test",
      marketplaceName: "resource-ninja-test",
      marketplaceSource: "acme/plugins",
    }),
    { ok: true },
  );

  const conflictRunner = fakeRunner([
    {
      exitCode: 0,
      stdout: JSON.stringify({
        marketplaces: [
          {
            name: "resource-ninja-test",
            root: "C:/cache",
            marketplaceSource: {
              sourceType: "git",
              source: "https://github.com/other/plugins.git",
            },
          },
        ],
      }),
      stderr: "",
    },
  ]);
  assert.strictEqual(
    (
      await adapter.uninstallCodexPlugin({
        runner: conflictRunner,
        pluginId: "safe-demo@resource-ninja-test",
        marketplaceName: "resource-ninja-test",
        marketplaceSource: "acme/plugins",
      })
    ).phase,
    "conflict",
  );

  const localSourceConflictRunner = fakeRunner([
    {
      exitCode: 0,
      stdout: JSON.stringify({
        marketplaces: [
          {
            name: "resource-ninja-test",
            root: "C:/local/plugins",
            marketplaceSource: {
              sourceType: "local",
              source: "https://github.com/acme/plugins.git",
            },
          },
        ],
      }),
      stderr: "",
    },
  ]);
  assert.strictEqual(
    (
      await adapter.uninstallCodexPlugin({
        runner: localSourceConflictRunner,
        pluginId: "safe-demo@resource-ninja-test",
        marketplaceName: "resource-ninja-test",
        marketplaceSource: "acme/plugins",
      })
    ).phase,
    "conflict",
  );

  const localRoot = path.resolve("tmp/local-marketplace");
  assert.strictEqual(
    adapter.codexMarketplaceMatches(
      { name: "resource-ninja-test", root: localRoot },
      localRoot,
    ),
    true,
  );
  const localRunner = fakeRunner([
    {
      exitCode: 0,
      stdout: JSON.stringify({
        marketplaces: [
          {
            name: "resource-ninja-test",
            root: localRoot,
          },
        ],
      }),
      stderr: "",
    },
    { exitCode: 0, stdout: "{}", stderr: "" },
    {
      exitCode: 0,
      stdout: JSON.stringify({
        installed: [
          {
            pluginId: "safe-demo@resource-ninja-test",
            name: "safe-demo",
            marketplaceName: "resource-ninja-test",
            installed: true,
            enabled: true,
          },
        ],
      }),
      stderr: "",
    },
  ]);
  const localResult = await adapter.installCodexPlugin({
    runner: localRunner,
    pluginName: "safe-demo",
    marketplaceName: "resource-ninja-test",
    marketplaceSource: localRoot,
  });
  assert.strictEqual(localResult.ok, true, JSON.stringify(localResult));

  const rollbackRunner = fakeRunner([
    {
      exitCode: 0,
      stdout: JSON.stringify({ marketplaces: [] }),
      stderr: "",
    },
    { exitCode: 0, stdout: "{}", stderr: "" },
    { exitCode: 1, stdout: "", stderr: "install failed" },
    {
      exitCode: 0,
      stdout: JSON.stringify({
        marketplaces: [
          {
            name: "resource-ninja-test",
            root: "C:/cache",
            marketplaceSource: {
              sourceType: "git",
              source: "https://github.com/acme/plugins.git",
            },
          },
        ],
      }),
      stderr: "",
    },
    { exitCode: 0, stdout: "{}", stderr: "" },
  ]);
  const rollbackResult = await adapter.installCodexPlugin({
    runner: rollbackRunner,
    pluginName: "safe-demo",
    marketplaceName: "resource-ninja-test",
    marketplaceSource: "acme/plugins",
  });
  assert.strictEqual(rollbackResult.ok, false);
  assert.strictEqual(rollbackResult.cleanup, "removed");
  console.log("RESULT=PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
