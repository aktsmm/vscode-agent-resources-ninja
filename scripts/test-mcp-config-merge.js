#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(repoRoot, "src", "mcpConfig.ts"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    strict: true,
  },
}).outputText;
const moduleObject = { exports: {} };
vm.runInNewContext(output, {
  exports: moduleObject.exports,
  module: moduleObject,
  require,
  console,
  Object,
  JSON,
  Set,
  Error,
});

const { getMcpConfigConflictServerKeys, mergeMcpConfig } = moduleObject.exports;

function assertJsonEqual(actual, expected) {
  assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected));
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("merge converts mcpServers resources into VS Code servers", () => {
  const result = mergeMcpConfig(undefined, {
    mcpServers: {
      github: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"] },
    },
  });

  assert.strictEqual(result.changed, true);
  assertJsonEqual(result.addedServers, ["github"]);
  assertJsonEqual(Object.keys(result.config.servers), ["github"]);
  assert.ok(!Object.hasOwn(result.config, "mcpServers"));
});

test("merge keeps existing server unless overwrite is confirmed", () => {
  const existing = { servers: { github: { command: "old" } } };
  const recommended = { mcpServers: { github: { command: "new" } } };
  const result = mergeMcpConfig(existing, recommended);

  assert.strictEqual(result.changed, false);
  assertJsonEqual(result.skippedServers, ["github"]);
  assertJsonEqual(result.config.servers.github, { command: "old" });
});

test("merge overwrites existing server only for confirmed keys", () => {
  const existing = { servers: { github: { command: "old" }, azure: { command: "az" } } };
  const recommended = { servers: { github: { command: "new" }, azure: { command: "new-az" } } };
  const result = mergeMcpConfig(existing, recommended, ["github"]);

  assert.strictEqual(result.changed, true);
  assertJsonEqual(result.overwrittenServers, ["github"]);
  assertJsonEqual(result.skippedServers, ["azure"]);
  assertJsonEqual(result.config.servers.github, { command: "new" });
  assertJsonEqual(result.config.servers.azure, { command: "az" });
});

test("merge adds non-conflicting inputs and skips duplicate ids", () => {
  const existing = {
    servers: {},
    inputs: [{ id: "token", type: "promptString", description: "Existing" }],
  };
  const recommended = {
    servers: { github: { command: "npx" } },
    inputs: [
      { id: "token", type: "promptString", description: "New" },
      { id: "org", type: "promptString", description: "Org" },
    ],
  };
  const result = mergeMcpConfig(existing, recommended);

  assertJsonEqual(result.addedInputs, ["org"]);
  assertJsonEqual(result.skippedInputs, ["token"]);
  assert.strictEqual(result.config.inputs.length, 2);
});

test("conflict detection reports existing server keys", () => {
  const conflicts = getMcpConfigConflictServerKeys(
    { servers: { github: { command: "old" } } },
    { mcpServers: { github: { command: "new" }, azure: { command: "az" } } },
  );
  assertJsonEqual(conflicts, ["github"]);
});

test("merge rejects resources without MCP servers", () => {
  assert.throws(
    () => mergeMcpConfig(undefined, { inputs: [] }),
    /must contain servers or mcpServers/,
  );
});

console.log("RESULT=PASS");
