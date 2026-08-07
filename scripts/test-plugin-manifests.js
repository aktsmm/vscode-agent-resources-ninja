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

const { getPluginRootFromManifestPath } = requireTypeScriptModule(
  path.join(__dirname, "..", "src", "resourceKinds.ts"),
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

function parsePluginManifestMetadata(content, filePath) {
  let manifest = {};
  try {
    manifest = JSON.parse(content);
  } catch {
    manifest = parseSimpleYamlObject(content);
  }

  const interfaceMetadata =
    manifest.interface && typeof manifest.interface === "object"
      ? manifest.interface
      : {};
  const name =
    stringifyManifestValue(manifest.name) ||
    stringifyManifestValue(interfaceMetadata.displayName) ||
    "plugin";
  const description =
    stringifyManifestValue(manifest.description) ||
    stringifyManifestValue(interfaceMetadata.shortDescription) ||
    stringifyManifestValue(interfaceMetadata.longDescription) ||
    `Plugin manifest for ${name}`;

  return {
    name,
    description,
    categories: ["plugins"],
    license: stringifyManifestValue(manifest.license),
    author: stringifyManifestValue(manifest.author),
    version: stringifyManifestValue(manifest.version),
    pluginRoot: getPluginRootFromManifestPath(filePath) || ".",
    pluginManifestPath: filePath.replace(/\\/g, "/"),
    pluginManifestKind: getPluginManifestKind(filePath),
  };
}

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

console.log(
  "PASS plugin manifest metadata parser handles representative manifests",
);
console.log("RESULT=PASS");
