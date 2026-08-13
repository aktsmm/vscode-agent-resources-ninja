#!/usr/bin/env node

// The full-plugin index model must be checked against the shipped kind rules.
// Copies of src/resourceKinds.ts went stale here once already, so load the real
// module and keep only the helpers that src does not export.

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

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
  detectPluginChildResourceKind,
  detectResourceKindFromPath,
  getDefaultResourceCategories,
  getFallbackResourceName,
  getPluginRootFromManifestPath,
  getResourceInstallPath,
} = requireTypeScriptModule(
  path.join(__dirname, "..", "src", "resourceKinds.ts"),
);

// src/indexUpdater.ts keeps the next three private and imports vscode, so plain
// Node cannot load them from there.
function getPluginRootsFromPaths(paths) {
  return Array.from(
    new Set(
      paths
        .map((filePath) => getPluginRootFromManifestPath(filePath))
        .filter(Boolean),
    ),
  ).sort((a, b) => b.length - a.length);
}

function getRelativePathFromPluginRoot(filePath, pluginRoot) {
  const normalizedPath = String(filePath)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  if (pluginRoot === ".") return normalizedPath;
  const normalizedRoot = String(pluginRoot)
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  return normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : undefined;
}

function detectResourceKindWithPluginRoots(resourcePath, pluginRoots) {
  const kind = detectResourceKindFromPath(resourcePath);
  if (kind) return kind;
  for (const pluginRoot of pluginRoots) {
    const relativePath = getRelativePathFromPluginRoot(
      resourcePath,
      pluginRoot,
    );
    if (!relativePath) continue;
    const childKind = detectPluginChildResourceKind(relativePath);
    if (childKind) return childKind;
  }
  return undefined;
}

// Install-set shaping models the installer contract and has no src counterpart.
function createPluginInstallSet(pluginResource, childResources) {
  const installOrder = [
    pluginResource.path,
    ...childResources
      .filter((resource) => !["mcp", "hook"].includes(resource.kind))
      .map((resource) => resource.path),
    ...childResources
      .filter((resource) => ["mcp", "hook"].includes(resource.kind))
      .map((resource) => resource.path),
  ];
  return {
    id: `${pluginResource.source}-${pluginResource.name}-plugin`,
    name: `${pluginResource.name} Plugin`,
    source: pluginResource.source,
    description:
      "Full plugin managed copy. Hooks, executable assets, and MCP configuration are copied for review and are not activated automatically.",
    skills: installOrder,
    installOrder,
    pluginId: pluginResource.name,
    mode: "plugin-managed-copy",
    safetyBoundary:
      "Managed copy only; no hook execution and no MCP merge without explicit confirmation.",
  };
}

function indexTree(treePaths) {
  const pluginRoots = getPluginRootsFromPaths(treePaths);
  return treePaths
    .map((resourcePath) => {
      const kind = detectResourceKindWithPluginRoots(resourcePath, pluginRoots);
      if (!kind) return undefined;
      return {
        kind,
        name: getFallbackResourceName(resourcePath, kind),
        source: "sample-plugin-source",
        path: getResourceInstallPath(resourcePath, kind),
        categories: getDefaultResourceCategories(kind),
      };
    })
    .filter(Boolean);
}

const resources = indexTree([
  "feature-dev/.claude-plugin/plugin.json",
  "feature-dev/skills/planning/SKILL.md",
  "feature-dev/agents/code-reviewer.md",
  "feature-dev/rules/typescript.mdc",
  "feature-dev/mcp.json",
  "feature-dev/hooks/session-start/README.md",
  "feature-dev/hooks/session-start/run.sh",
]);

const plugin = resources.find((resource) => resource.kind === "plugin");
assert.ok(plugin, "Expected plugin manifest resource");
assert.strictEqual(plugin.path, "feature-dev");
assert.ok(resources.some((resource) => resource.kind === "skill"));
assert.ok(resources.some((resource) => resource.kind === "agent"));
assert.ok(resources.some((resource) => resource.kind === "cursor-rule"));
assert.ok(resources.some((resource) => resource.kind === "mcp"));
assert.ok(resources.some((resource) => resource.kind === "hook"));
assert.ok(
  !resources.some((resource) => resource.path.endsWith("run.sh")),
  "Executable hook assets should be included only by full plugin managed copy, not as standalone resources",
);

const installSet = createPluginInstallSet(
  plugin,
  resources.filter((resource) => resource !== plugin),
);
assert.strictEqual(installSet.mode, "plugin-managed-copy");
assert.match(installSet.description, /not activated automatically/);
assert.strictEqual(installSet.installOrder[0], "feature-dev");
assert.ok(
  installSet.installOrder.indexOf("feature-dev/mcp.json") >
    installSet.installOrder.indexOf("feature-dev/agents/code-reviewer.md"),
  "MCP resources should install after passive text resources",
);

console.log(
  "PASS full plugin index model keeps plugin, child resources, and safety boundary aligned",
);

// A bare manifest name marks a plugin at any depth, and the plugin root is the
// directory that holds the manifest rather than the repository root.
assert.strictEqual(
  getPluginRootFromManifestPath("plugins/foo/plugin.json"),
  "plugins/foo",
);
assert.strictEqual(getPluginRootFromManifestPath("plugin.json"), ".");
assert.strictEqual(
  getPluginRootFromManifestPath("packages/foo/gemini-extension.json"),
  "packages/foo",
);

// Copilot-format plugin children the stale copy did not know about.
assert.strictEqual(detectPluginChildResourceKind(".mcp.json"), "mcp");
assert.strictEqual(detectPluginChildResourceKind("hooks.json"), "hook");

const nestedResources = indexTree([
  "plugins/foo/plugin.json",
  "plugins/foo/.mcp.json",
  "plugins/foo/hooks.json",
]);

const nestedPlugin = nestedResources.find(
  (resource) => resource.kind === "plugin",
);
assert.ok(nestedPlugin, "Expected nested plugin manifest resource");
assert.strictEqual(nestedPlugin.path, "plugins/foo");
assert.strictEqual(nestedPlugin.name, "foo");
assert.strictEqual(
  nestedResources.find((resource) => resource.path.endsWith("/.mcp.json")).kind,
  "mcp",
);
assert.strictEqual(
  nestedResources.find((resource) => resource.path.endsWith("/hooks.json"))
    .kind,
  "hook",
);

console.log(
  "PASS nested plugin manifests keep their own root and Copilot-format children",
);
console.log("RESULT=PASS");
