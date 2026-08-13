#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

// Load the shipped rules instead of copying them.
function requireTypeScriptModule(filePath) {
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  });
  const loadedModule = new Module(filePath, module);
  loadedModule.filename = filePath;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(filePath));
  loadedModule._compile(transpiled.outputText, filePath);
  return loadedModule.exports;
}

const {
  AGENT_PLUGINS_MANIFEST_KIND,
  AGENT_PLUGINS_MANIFEST_SCHEMA,
  getAgentPluginsConformanceIssue,
  getAgentPluginsManifestIssue,
  getAgentPluginsNameIssue,
  getPluginRootFromManifestPath,
  isAgentPluginsManifest,
  markAgentPluginsIssueDescription,
} = requireTypeScriptModule(
  path.join(__dirname, "..", "src", "resourceKinds.ts"),
);

// The runtime parser reaches the same implementation through indexUpdater.ts.
assert.match(
  fs.readFileSync(path.join(__dirname, "..", "src", "indexUpdater.ts"), "utf8"),
  /export \{[\s\S]{0,400}?isAgentPluginsManifest,?[\s\S]{0,400}?\} from "\.\/resourceKinds"/,
  "src/indexUpdater.ts should re-export the shared Agent Plugins detection",
);

function getPluginManifestKind(filePath) {
  const lowerPath = filePath.toLowerCase().replace(/\\/g, "/");
  if (lowerPath.endsWith(".claude-plugin/plugin.json")) return "claude-plugin";
  if (lowerPath.endsWith(".codex-plugin/plugin.json")) return "codex-plugin";
  if (lowerPath.endsWith(".cursor-plugin/plugin.json")) return "cursor-plugin";
  if (lowerPath.endsWith(".plugin/plugin.json")) return "plugin";
  if (lowerPath.endsWith("marketplace.json")) return "marketplace";
  if (lowerPath.endsWith("gemini-extension.json")) return "gemini-extension";
  if (lowerPath.endsWith("apm.yml") || lowerPath.endsWith("apm.yaml")) {
    return "apm";
  }
  if (lowerPath.endsWith("plugin.json")) return "plugin";
  return undefined;
}

function stripYamlInlineComment(value) {
  return value.replace(/\s+#.*$/, "").trim();
}

function unquoteYamlValue(value) {
  return value.trim().replace(/^["']|["']$/g, "");
}

function parseSimpleYamlObject(content) {
  const values = {};
  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    if (!match) continue;
    values[match[1]] = unquoteYamlValue(stripYamlInlineComment(match[2]));
  }
  return values;
}

function stringifyManifestValue(value) {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value && typeof value === "object") {
    const parts = [value.name, value.url, value.email]
      .map((part) => (typeof part === "string" ? part.trim() : ""))
      .filter(Boolean);
    return parts.length
      ? parts.join(" <") + (parts.length > 1 ? ">" : "")
      : undefined;
  }
  return undefined;
}

// The shipped resources/skill-index.json is produced by this exact function, so
// assert against it rather than a copy that could stay green while it breaks.
const { parsePluginManifestMetadata } = require("./update-preset-index.js");

const superpowersCodex = parsePluginManifestMetadata(
  JSON.stringify({
    name: "superpowers",
    version: "5.1.0",
    description:
      "An agentic skills framework & software development methodology.",
    author: { name: "Jesse Vincent", url: "https://github.com/obra" },
    license: "MIT",
    skills: "./skills/",
    interface: { displayName: "Superpowers" },
  }),
  ".codex-plugin/plugin.json",
);
assert.strictEqual(superpowersCodex.name, "superpowers");
assert.strictEqual(superpowersCodex.pluginRoot, ".");
assert.strictEqual(superpowersCodex.pluginManifestKind, "codex-plugin");
assert.strictEqual(superpowersCodex.version, "5.1.0");
assert.strictEqual(superpowersCodex.license, "MIT");

const claudePlugin = parsePluginManifestMetadata(
  JSON.stringify({
    name: "feature-dev",
    description: "Feature development workflow",
    version: "1.0.0",
  }),
  "plugins/feature-dev/.claude-plugin/plugin.json",
);
assert.strictEqual(claudePlugin.pluginRoot, "plugins/feature-dev");
assert.strictEqual(claudePlugin.pluginManifestKind, "claude-plugin");

const geminiExtension = parsePluginManifestMetadata(
  JSON.stringify({
    name: "superpowers",
    description: "Core skills library",
    contextFileName: "GEMINI.md",
  }),
  "gemini-extension.json",
);
assert.strictEqual(geminiExtension.pluginManifestKind, "gemini-extension");
assert.strictEqual(geminiExtension.pluginRoot, ".");

const apmManifest = parsePluginManifestMetadata(
  "name: azure-skills\ndescription: Azure Skills Plugin\nversion: 1.2.3\n",
  "apm.yml",
);
assert.strictEqual(apmManifest.name, "azure-skills");
assert.strictEqual(apmManifest.description, "Azure Skills Plugin");
assert.strictEqual(apmManifest.pluginManifestKind, "apm");

const agentPlugin = parsePluginManifestMetadata(
  JSON.stringify({
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    name: "aws-serverless",
    version: "1.0.0",
  }),
  "plugins/aws-serverless/plugin.json",
);
assert.strictEqual(agentPlugin.pluginManifestKind, "agent-plugins");
assert.strictEqual(agentPlugin.pluginRoot, "plugins/aws-serverless");
assert.strictEqual(
  agentPlugin.description,
  "Agent Plugins 1.0.0 manifest for aws-serverless",
);

const copilotPlugin = parsePluginManifestMetadata(
  JSON.stringify({ name: "legacy", version: "0.1.0" }),
  "plugins/legacy/plugin.json",
);
assert.strictEqual(copilotPlugin.pluginManifestKind, "plugin");
assert.strictEqual(copilotPlugin.description, "Plugin manifest for legacy");

// Agent Plugins 1.0.0 requires `name`, and a conformant client rejects the whole
// plugin when it breaks the rules, so the label may not be granted without it.
for (const validName of [
  "my-plugin",
  "acme.tools",
  "lint3r",
  "a",
  "a".repeat(64),
]) {
  assert.strictEqual(
    getAgentPluginsNameIssue(validName),
    undefined,
    `"${validName}" is a specification-valid Agent Plugins name`,
  );
}

for (const invalidName of [
  "My-Plugin",
  "-start",
  "end-",
  "has--double",
  "too.many..dots",
  "",
  "a".repeat(65),
  42,
  undefined,
]) {
  assert.notStrictEqual(
    getAgentPluginsNameIssue(invalidName),
    undefined,
    `${JSON.stringify(invalidName)} must be rejected as an Agent Plugins name`,
  );
}

assert.strictEqual(getAgentPluginsNameIssue(undefined), "missing");
assert.strictEqual(getAgentPluginsNameIssue(42), "not a string");

const invalidNameAgentPlugin = parsePluginManifestMetadata(
  JSON.stringify({
    $schema: AGENT_PLUGINS_MANIFEST_SCHEMA,
    name: "Invalid--Name",
    version: "1.0.0",
  }),
  "plugins/invalid-name/plugin.json",
);
assert.strictEqual(invalidNameAgentPlugin.pluginManifestKind, "plugin");
assert.strictEqual(
  isAgentPluginsManifest("plugins/invalid-name/plugin.json", {
    $schema: AGENT_PLUGINS_MANIFEST_SCHEMA,
    name: "Invalid--Name",
  }),
  false,
);
assert.strictEqual(
  isAgentPluginsManifest("plugins/aws-serverless/plugin.json", {
    $schema: AGENT_PLUGINS_MANIFEST_SCHEMA,
    name: "aws-serverless",
  }),
  true,
);

// A manifest with no `name` at all is a hard spec violation, so the synthesized
// fallback name must not come with the conformance label.
const namelessAgentPlugin = parsePluginManifestMetadata(
  JSON.stringify({ $schema: AGENT_PLUGINS_MANIFEST_SCHEMA, version: "1.0.0" }),
  "plugins/nameless/plugin.json",
);
assert.strictEqual(namelessAgentPlugin.pluginManifestKind, "plugin");
assert.notStrictEqual(namelessAgentPlugin.name, undefined);

// Agent Plugins 1.0.0 §5.2-§5.4: the manifest rules a conformant client treats as
// fatal must all be checked, or the `agent-plugins` label overclaims conformance.
const ACCEPTED_MANIFESTS = [
  ["minimal", { name: "acme" }],
  [
    "every permitted field",
    {
      $schema: AGENT_PLUGINS_MANIFEST_SCHEMA,
      name: "acme",
      version: "1.0.0",
      description: "Acme tools",
      author: {
        name: "Acme",
        email: "dev@acme.test",
        url: "https://acme.test",
      },
      homepage: "https://acme.test",
      repository: "https://github.com/acme/tools",
      license: "MIT",
      keywords: ["acme", "tools"],
      extensions: { "acme.example": { anything: [1, 2, 3] } },
    },
  ],
  // §5.2: an unknown top-level field is reported and ignored, never fatal.
  ["an unknown top-level field", { name: "acme", unknownField: { a: 1 } }],
  // §5.2 / §8.1: a non-object `extensions` is ignored, and member contents are
  // never validated.
  ["a non-object extensions", { name: "acme", extensions: "not-an-object" }],
  // §5.3: these MUST NOT be rejected on format alone.
  ["a non-semver version", { name: "acme", version: "v1-rolling" }],
  ["a non-SPDX license", { name: "acme", license: "see LICENSE.txt" }],
  ["a non-URL homepage", { name: "acme", homepage: "acme dot test" }],
  ["a non-email author.email", { name: "acme", author: { email: "acme" } }],
  ["a non-URL author.url", { name: "acme", author: { url: "acme" } }],
  ["an empty keywords array", { name: "acme", keywords: [] }],
];

for (const [label, manifest] of ACCEPTED_MANIFESTS) {
  assert.strictEqual(
    getAgentPluginsManifestIssue(manifest),
    undefined,
    `getAgentPluginsManifestIssue must accept ${label}`,
  );
}

const REJECTED_MANIFESTS = [
  ["a non-string version", { version: 1 }, '"version" must be a string'],
  [
    "a non-string description",
    { description: ["a"] },
    '"description" must be a string',
  ],
  ["a non-string license", { license: 42 }, '"license" must be a string'],
  ["a non-string homepage", { homepage: null }, '"homepage" must be a string'],
  [
    "a non-string repository",
    { repository: { url: "https://acme.test" } },
    '"repository" must be a string',
  ],
  [
    "keywords that is not an array",
    { keywords: "acme" },
    '"keywords" must be an array of strings',
  ],
  [
    "keywords containing a non-string",
    { keywords: ["acme", 7] },
    '"keywords[1]" must be a string',
  ],
  [
    "an author that is not an object",
    { author: "Acme" },
    '"author" must be an object',
  ],
  [
    "an author array",
    { author: [{ name: "Acme" }] },
    '"author" must be an object',
  ],
  [
    "an author with an extra field",
    { author: { name: "Acme", role: "maintainer" } },
    '"author.role" is not a permitted field',
  ],
  [
    "an author whose email is not a string",
    { author: { email: 42 } },
    '"author.email" must be a string',
  ],
];

for (const [label, manifest, expectedIssue] of REJECTED_MANIFESTS) {
  assert.strictEqual(
    getAgentPluginsManifestIssue({ name: "acme", ...manifest }),
    expectedIssue,
    `getAgentPluginsManifestIssue must reject ${label}`,
  );
}

// End to end through the real parser the generator exports: a malformed `author`
// is fatal, so the label is withheld and the reason reaches the description.
const malformedAuthorManifest = {
  $schema: AGENT_PLUGINS_MANIFEST_SCHEMA,
  name: "acme-tools",
  version: "1.0.0",
  author: { name: "Acme", role: "maintainer" },
};
const malformedAuthorPath = "plugins/acme-tools/plugin.json";
assert.strictEqual(
  isAgentPluginsManifest(malformedAuthorPath, malformedAuthorManifest),
  false,
);
const malformedAuthorPlugin = parsePluginManifestMetadata(
  JSON.stringify(malformedAuthorManifest),
  malformedAuthorPath,
);
assert.strictEqual(malformedAuthorPlugin.pluginManifestKind, "plugin");
assert.strictEqual(
  malformedAuthorPlugin.description,
  '[Agent Plugins 1.0.0: "author.role" is not a permitted field] Plugin manifest for acme-tools',
);

// The marker is prepended, so the row builders that truncate from the end keep it.
assert.strictEqual(
  markAgentPluginsIssueDescription("Acme tools", undefined),
  "Acme tools",
);
assert.ok(
  malformedAuthorPlugin.description.startsWith("[Agent Plugins 1.0.0: "),
  "the marker must lead the description so end-truncation cannot drop it",
);

// A future Agent Plugins schema version is an exact-string miss, so it stays a
// plain plugin and carries no marker.
const futureSchemaPlugin = parsePluginManifestMetadata(
  JSON.stringify({
    $schema: "https://agent-plugins.org/schemas/2.0.0/plugin.schema.json",
    name: "acme-tools",
    author: { name: "Acme", role: "maintainer" },
  }),
  "plugins/future/plugin.json",
);
assert.strictEqual(futureSchemaPlugin.pluginManifestKind, "plugin");
assert.strictEqual(
  futureSchemaPlugin.description,
  "Plugin manifest for acme-tools",
);
assert.strictEqual(
  getAgentPluginsConformanceIssue("plugins/future/plugin.json", {
    $schema: "https://agent-plugins.org/schemas/2.0.0/plugin.schema.json",
    name: "acme-tools",
  }),
  undefined,
);

console.log(
  "PASS plugin manifest metadata parser handles representative manifests",
);
console.log("RESULT=PASS");
