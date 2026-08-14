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

const srcDir = path.join(__dirname, "..", "src");
const resourceKinds = requireTypeScriptModule(
  path.join(srcDir, "resourceKinds.ts"),
);
const executable = requireTypeScriptModule(
  path.join(srcDir, "pluginHosts", "executable.ts"),
);
const {
  getCanonicalCopilotCliPluginRoot,
  findCopilotCliExecutable,
  installCopilotCliPlugin,
  parseCopilotCliPluginList,
  parseMarketplaceList,
  resolveMarketplacePluginIdentity,
  resolveMarketplacePluginIdentityFromCandidates,
  uninstallCopilotCliPlugin,
} = requireTypeScriptModule(path.join(srcDir, "copilotCliPlugins.ts"), {
  "./resourceKinds": resourceKinds,
  "./pluginHosts/executable": executable,
});

const marketplaceList = (source = "acme/plugins") =>
  `Included with GitHub Copilot:\n  ◆ copilot-plugins (GitHub: github/copilot-plugins)\n  ◆ awesome-copilot (GitHub: github/awesome-copilot)\nAdditional marketplaces:\n  ◆ acme-market (GitHub: ${source})\n`;

function command(exitCode = 0, stdout = "", stderr = "") {
  return { exitCode, stdout, stderr };
}

function runner(results) {
  const calls = [];
  return {
    calls,
    async run(args) {
      calls.push(Array.from(args));
      assert.ok(results.length, `Unexpected command: ${args.join(" ")}`);
      return results.shift();
    },
  };
}

async function test(name, body) {
  try {
    await body();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

(async () => {
  await test("canonical plugin root comes from the real plugin manifest", () => {
    assert.strictEqual(
      getCanonicalCopilotCliPluginRoot({
        kind: "plugin",
        pluginRoot: "plugins/demo",
        pluginManifestPath: "plugins/demo/.claude-plugin/plugin.json",
        pluginManifestKind: "claude-plugin",
      }),
      "plugins/demo",
    );
    assert.strictEqual(
      getCanonicalCopilotCliPluginRoot({
        kind: "plugin",
        pluginRoot: "plugins/other",
        pluginManifestPath: "plugins/demo/.claude-plugin/plugin.json",
        pluginManifestKind: "claude-plugin",
      }),
      undefined,
    );
    assert.strictEqual(
      getCanonicalCopilotCliPluginRoot({
        kind: "plugin",
        pluginRoot: ".",
        pluginManifestPath: ".claude-plugin/marketplace.json",
        pluginManifestKind: "marketplace",
      }),
      undefined,
    );
  });

  await test("marketplace identity matches root and subdirectory plugins", () => {
    const content = JSON.stringify({
      name: "acme-market",
      plugins: [
        { name: "root-plugin", source: "." },
        { name: "demo", source: "./plugins/demo" },
        {
          name: "object-demo",
          source: {
            source: "github",
            repo: "Acme/Plugins",
            path: "plugins/object-demo",
          },
        },
      ],
    });
    assert.deepStrictEqual(
      { ...resolveMarketplacePluginIdentity(content, ".", "acme/plugins") },
      {
        marketplaceName: "acme-market",
        pluginName: "root-plugin",
        pluginRoot: ".",
        ownerRepo: "acme/plugins",
      },
    );
    assert.strictEqual(
      resolveMarketplacePluginIdentity(content, "plugins/demo", "acme/plugins")
        .pluginName,
      "demo",
    );
    assert.strictEqual(
      resolveMarketplacePluginIdentity(
        content,
        "plugins/object-demo",
        "acme/plugins",
      ).pluginName,
      "object-demo",
    );
  });

  await test("unsafe and ambiguous marketplace entries are rejected", () => {
    for (const source of ["", "../demo", "/demo", "C:/demo", 42]) {
      const content = JSON.stringify({
        name: "acme-market",
        plugins: [{ name: "demo", source }],
      });
      assert.strictEqual(
        resolveMarketplacePluginIdentity(content, "demo", "acme/plugins"),
        undefined,
      );
    }
    assert.strictEqual(
      resolveMarketplacePluginIdentity(
        JSON.stringify({
          name: "acme-market",
          plugins: [{ name: "evil@other-market", source: "plugins/demo" }],
        }),
        "plugins/demo",
        "acme/plugins",
      ),
      undefined,
    );
    assert.strictEqual(
      resolveMarketplacePluginIdentity(
        JSON.stringify({
          name: "acme-market",
          plugins: [
            { name: "one", source: "plugins/demo" },
            { name: "two", source: "plugins/demo" },
          ],
        }),
        "plugins/demo",
        "acme/plugins",
      ),
      undefined,
    );
  });

  await test("all official marketplace candidates resolve to one identity", () => {
    const unrelated = JSON.stringify({
      name: "other-market",
      plugins: [{ name: "other", source: "plugins/other" }],
    });
    const matching = JSON.stringify({
      name: "acme-market",
      plugins: [{ name: "demo", source: "plugins/demo" }],
    });
    assert.strictEqual(
      resolveMarketplacePluginIdentityFromCandidates(
        [unrelated, matching],
        "plugins/demo",
        "acme/plugins",
      ).pluginName,
      "demo",
    );
    const conflicting = JSON.stringify({
      name: "second-market",
      plugins: [{ name: "demo", source: "plugins/demo" }],
    });
    assert.strictEqual(
      resolveMarketplacePluginIdentityFromCandidates(
        [matching, conflicting],
        "plugins/demo",
        "acme/plugins",
      ),
      undefined,
    );
  });

  await test("marketplace list parser preserves exact GitHub identity", () => {
    const parsed = parseMarketplaceList(marketplaceList());
    assert.strictEqual(parsed.recognized, true);
    assert.deepStrictEqual(
      { ...parsed.registrations.find((item) => item.name === "acme-market") },
      {
        name: "acme-market",
        sourceKind: "GitHub",
        source: "acme/plugins",
        ownerRepo: "acme/plugins",
      },
    );
    assert.strictEqual(parseMarketplaceList("new output").recognized, false);
  });

  await test("plugin list parser preserves exact installed identity", () => {
    assert.deepStrictEqual(
      parseCopilotCliPluginList(
        "Installed plugins:\n  • demo@acme-market (v1.2.3)\n",
      ).map((state) => ({ ...state })),
      [{ id: "demo@acme-market", version: "1.2.3", enabled: undefined }],
    );
    assert.deepStrictEqual(
      parseCopilotCliPluginList(
        "No plugins installed.\nUse 'copilot plugin install <source>'.",
      ),
      [],
    );
    assert.strictEqual(parseCopilotCliPluginList("unknown output"), undefined);
  });

  const identity = {
    marketplaceName: "acme-market",
    pluginName: "demo",
    pluginRoot: "plugins/demo",
    ownerRepo: "acme/plugins",
  };

  await test("pre-registered exact marketplace installs without add", async () => {
    const fake = runner([command(0, marketplaceList()), command(0)]);
    const result = await installCopilotCliPlugin(identity, fake);
    assert.deepStrictEqual(
      { ...result },
      { ok: true, marketplaceAdded: false },
    );
    assert.deepStrictEqual(fake.calls, [
      ["--no-color", "plugin", "marketplace", "list"],
      ["--no-color", "plugin", "install", "demo@acme-market"],
    ]);
  });

  await test("same marketplace name from another repo blocks mutation", async () => {
    const fake = runner([command(0, marketplaceList("other/plugins"))]);
    const result = await installCopilotCliPlugin(identity, fake);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.phase, "conflict");
    assert.strictEqual(fake.calls.length, 1);
  });

  await test("unrecognized list blocks mutation", async () => {
    const fake = runner([command(0, "unknown format")]);
    const result = await installCopilotCliPlugin(identity, fake);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.phase, "list");
    assert.strictEqual(fake.calls.length, 1);
  });

  await test("new marketplace is verified before plugin install", async () => {
    const builtIns = marketplaceList().replace(
      /Additional marketplaces:[\s\S]*/,
      "",
    );
    const fake = runner([
      command(0, builtIns),
      command(0),
      command(0, marketplaceList()),
      command(0),
    ]);
    const result = await installCopilotCliPlugin(identity, fake);
    assert.deepStrictEqual({ ...result }, { ok: true, marketplaceAdded: true });
    assert.deepStrictEqual(fake.calls[1], [
      "--no-color",
      "plugin",
      "marketplace",
      "add",
      "acme/plugins",
    ]);
  });

  await test("add failure does not claim or clean marketplace", async () => {
    const builtIns = marketplaceList().replace(
      /Additional marketplaces:[\s\S]*/,
      "",
    );
    const fake = runner([command(0, builtIns), command(1, "", "add failed")]);
    const result = await installCopilotCliPlugin(identity, fake);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.phase, "add");
    assert.deepStrictEqual({ ...result.cleanup }, { status: "not-needed" });
    assert.strictEqual(fake.calls.length, 2);
  });

  await test("post-add verification failure cleans an exactly owned marketplace", async () => {
    const builtIns = marketplaceList().replace(
      /Additional marketplaces:[\s\S]*/,
      "",
    );
    const fake = runner([
      command(0, builtIns),
      command(0),
      command(1, "", "verification failed"),
      command(0, marketplaceList()),
      command(0),
    ]);
    const result = await installCopilotCliPlugin(identity, fake);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.phase, "verify");
    assert.deepStrictEqual({ ...result.cleanup }, { status: "removed" });
  });

  await test("install failure removes only an exactly owned marketplace", async () => {
    const builtIns = marketplaceList().replace(
      /Additional marketplaces:[\s\S]*/,
      "",
    );
    const fake = runner([
      command(0, builtIns),
      command(0),
      command(0, marketplaceList()),
      command(1, "", "install failed"),
      command(0, marketplaceList()),
      command(0),
    ]);
    const result = await installCopilotCliPlugin(identity, fake);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.phase, "install");
    assert.deepStrictEqual({ ...result.cleanup }, { status: "removed" });
    assert.deepStrictEqual(fake.calls.at(-1), [
      "--no-color",
      "plugin",
      "marketplace",
      "remove",
      "acme-market",
    ]);
  });

  await test("cleanup skips a marketplace replaced by another process", async () => {
    const builtIns = marketplaceList().replace(
      /Additional marketplaces:[\s\S]*/,
      "",
    );
    const fake = runner([
      command(0, builtIns),
      command(0),
      command(0, marketplaceList()),
      command(1, "", "install failed"),
      command(0, marketplaceList("other/plugins")),
    ]);
    const result = await installCopilotCliPlugin(identity, fake);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.cleanup.status, "skipped");
    assert.strictEqual(fake.calls.length, 5);
  });

  await test("cleanup failure remains distinct from the install failure", async () => {
    const builtIns = marketplaceList().replace(
      /Additional marketplaces:[\s\S]*/,
      "",
    );
    const fake = runner([
      command(0, builtIns),
      command(0),
      command(0, marketplaceList()),
      command(1, "", "install failed"),
      command(0, marketplaceList()),
      command(1, "", "remove failed"),
    ]);
    const result = await installCopilotCliPlugin(identity, fake);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "install failed");
    assert.deepStrictEqual(
      { ...result.cleanup },
      {
        status: "failed",
        reason: "remove failed",
      },
    );
  });

  await test("pre-existing marketplace is never cleaned after install failure", async () => {
    const fake = runner([
      command(0, marketplaceList()),
      command(1, "", "install failed"),
    ]);
    const result = await installCopilotCliPlugin(identity, fake);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual({ ...result.cleanup }, { status: "not-needed" });
    assert.strictEqual(fake.calls.length, 2);
  });

  await test("uninstall delegates exact marketplace identity", async () => {
    const fake = runner([command(0, marketplaceList()), command(0)]);
    const result = await uninstallCopilotCliPlugin(identity, fake);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(fake.calls, [
      ["--no-color", "plugin", "marketplace", "list"],
      ["--no-color", "plugin", "uninstall", "demo@acme-market"],
    ]);
  });

  await test("uninstall blocks a repointed marketplace alias", async () => {
    const fake = runner([command(0, marketplaceList("other/plugins"))]);
    const result = await uninstallCopilotCliPlugin(identity, fake);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.phase, "conflict");
    assert.strictEqual(fake.calls.length, 1);
  });

  await test("missing PATH reports Copilot CLI as unavailable", async () => {
    assert.strictEqual(await findCopilotCliExecutable({ PATH: "" }), undefined);
  });
})().catch(() => {
  process.exitCode = 1;
});
