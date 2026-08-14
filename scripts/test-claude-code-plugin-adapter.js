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
  path.join(srcDir, "adapters", "claudeCode.ts"),
  { "../types": types, "../artifact": artifact },
);

assert.strictEqual(
  adapter.getClaudeCodeAvailability({
    extensionDetected: true,
    nativeExecutionEnabled: false,
  }),
  "extension-handoff",
);
assert.strictEqual(
  adapter.getClaudeCodeAvailability({
    extensionDetected: false,
    executablePath: "/usr/bin/claude",
    nativeExecutionEnabled: false,
  }),
  "cli-handoff",
);
assert.strictEqual(
  adapter.getClaudeCodeAvailability({
    extensionDetected: true,
    executablePath: "/usr/bin/claude",
    nativeExecutionEnabled: true,
  }),
  "native-ready",
);

assert.deepStrictEqual(
  adapter.parseClaudePluginListJson(
    JSON.stringify({
      plugins: [
        {
          id: "demo@acme",
          name: "demo",
          marketplace: "acme",
          scope: "project",
          version: "1.2.3",
          enabled: true,
        },
      ],
    }),
  ),
  [
    {
      id: "demo@acme",
      name: "demo",
      marketplace: "acme",
      scope: "project",
      version: "1.2.3",
      enabled: true,
    },
  ],
);
assert.strictEqual(adapter.parseClaudePluginListJson("not-json"), undefined);
assert.deepStrictEqual(
  adapter.parseClaudePluginListJson(
    JSON.stringify([
      {
        id: "safe-demo@resource-ninja-test",
        version: "1.0.0",
        scope: "user",
        enabled: true,
      },
    ]),
  ),
  [
    {
      id: "safe-demo@resource-ninja-test",
      name: "safe-demo",
      marketplace: "resource-ninja-test",
      scope: "user",
      version: "1.0.0",
      enabled: true,
    },
  ],
);
assert.deepStrictEqual(
  adapter.parseClaudeMarketplaceListJson(
    JSON.stringify([
      {
        name: "resource-ninja-test",
        source: "github",
        repo: "acme/plugins",
        installLocation: "C:/cache/resource-ninja-test",
      },
    ]),
  ),
  [
    {
      name: "resource-ninja-test",
      source: "github",
      repository: "acme/plugins",
      path: undefined,
    },
  ],
);

assert.deepStrictEqual(
  adapter.planClaudePluginInstall({
    pluginId: "demo@acme",
    marketplaceSource: "acme/plugins",
    marketplaceRegistered: false,
    scope: "local",
  }),
  {
    readonlyCommands: [["plugin", "list", "--json"]],
    mutations: [
      ["plugin", "marketplace", "add", "acme/plugins"],
      ["plugin", "install", "demo@acme", "--scope", "local"],
    ],
  },
);

const claudeArtifact = artifact.createPluginArtifact({
  kind: "plugin",
  name: "demo",
  sourceId: "anthropic",
  remotePath: "plugins/demo",
  packageRootUri: "https://github.com/anthropic/plugins/tree/main/plugins/demo",
  packageRootPath: "plugins/demo",
  manifestPath: "plugins/demo/.claude-plugin/plugin.json",
  manifestKind: "claude-plugin",
  source: {
    kind: "github",
    repository: "anthropic/plugins",
    url: "https://github.com/anthropic/plugins",
  },
  availability: "complete",
  resolutionMode: "host-resolved",
});
assert.strictEqual(claudeArtifact.ok, true);
assert.strictEqual(
  adapter.claudeCodeAdapter.supportsArtifact(claudeArtifact.artifact),
  true,
);
assert.strictEqual(
  adapter.claudeCodeAdapter.supportsArtifact({
    ...claudeArtifact.artifact,
    availability: "incomplete",
  }),
  false,
);
assert.strictEqual(adapter.CLAUDE_CODE_CAPABILITY.supportLevel, "native");

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
    { exitCode: 0, stdout: "[]", stderr: "" },
    { exitCode: 0, stdout: "added", stderr: "" },
    { exitCode: 0, stdout: "installed", stderr: "" },
    {
      exitCode: 0,
      stdout: JSON.stringify([
        {
          id: "safe-demo@resource-ninja-test",
          version: "1.0.0",
          scope: "user",
          enabled: true,
        },
      ]),
      stderr: "",
    },
  ]);
  assert.deepStrictEqual(
    await adapter.installClaudeCodePlugin({
      runner,
      pluginName: "safe-demo",
      marketplaceName: "resource-ninja-test",
      marketplaceSource: "acme/plugins",
      scope: "user",
    }),
    { ok: true, marketplaceAdded: true },
  );
  assert.deepStrictEqual(runner.calls, [
    ["plugin", "marketplace", "list", "--json"],
    ["plugin", "marketplace", "add", "acme/plugins", "--scope", "user"],
    ["plugin", "install", "safe-demo@resource-ninja-test", "--scope", "user"],
    ["plugin", "list", "--json"],
  ]);

  const mutationRunner = fakeRunner([
    {
      exitCode: 0,
      stdout: JSON.stringify([
        {
          name: "resource-ninja-test",
          source: "github",
          repo: "acme/plugins",
        },
      ]),
      stderr: "",
    },
    { exitCode: 0, stdout: "disabled", stderr: "" },
  ]);
  assert.deepStrictEqual(
    await adapter.mutateClaudeCodePlugin({
      runner: mutationRunner,
      action: "disable",
      pluginId: "safe-demo@resource-ninja-test",
      marketplaceName: "resource-ninja-test",
      marketplaceSource: "acme/plugins",
      scope: "user",
    }),
    { ok: true },
  );

  const conflictRunner = fakeRunner([
    {
      exitCode: 0,
      stdout: JSON.stringify([
        {
          name: "resource-ninja-test",
          source: "github",
          repo: "other/plugins",
        },
      ]),
      stderr: "",
    },
  ]);
  assert.strictEqual(
    (
      await adapter.mutateClaudeCodePlugin({
        runner: conflictRunner,
        action: "uninstall",
        pluginId: "safe-demo@resource-ninja-test",
        marketplaceName: "resource-ninja-test",
        marketplaceSource: "acme/plugins",
        scope: "user",
      })
    ).phase,
    "conflict",
  );

  const localSourceConflictRunner = fakeRunner([
    {
      exitCode: 0,
      stdout: JSON.stringify([
        {
          name: "resource-ninja-test",
          source: "local",
          repo: "acme/plugins",
          path: "C:/local/plugins",
        },
      ]),
      stderr: "",
    },
  ]);
  assert.strictEqual(
    (
      await adapter.installClaudeCodePlugin({
        runner: localSourceConflictRunner,
        pluginName: "safe-demo",
        marketplaceName: "resource-ninja-test",
        marketplaceSource: "acme/plugins",
        scope: "user",
      })
    ).phase,
    "conflict",
  );

  const rollbackRunner = fakeRunner([
    { exitCode: 0, stdout: "[]", stderr: "" },
    { exitCode: 0, stdout: "added", stderr: "" },
    { exitCode: 1, stdout: "", stderr: "install failed" },
    {
      exitCode: 0,
      stdout: JSON.stringify([
        {
          name: "resource-ninja-test",
          source: "github",
          repo: "acme/plugins",
        },
      ]),
      stderr: "",
    },
    { exitCode: 0, stdout: "removed", stderr: "" },
  ]);
  const rollbackResult = await adapter.installClaudeCodePlugin({
    runner: rollbackRunner,
    pluginName: "safe-demo",
    marketplaceName: "resource-ninja-test",
    marketplaceSource: "acme/plugins",
    scope: "user",
  });
  assert.strictEqual(rollbackResult.ok, false);
  assert.strictEqual(rollbackResult.cleanup, "removed");
  console.log("RESULT=PASS");
})().catch(() => {
  process.exitCode = 1;
});
