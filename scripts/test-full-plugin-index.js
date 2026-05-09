#!/usr/bin/env node

const assert = require("assert");

function isPluginManifestPath(resourcePath) {
  const lowerPath = resourcePath.toLowerCase().replace(/\\/g, "/");
  return (
    lowerPath === "plugin.json" ||
    lowerPath === "gemini-extension.json" ||
    lowerPath === "apm.yml" ||
    lowerPath === "apm.yaml" ||
    /(^|\/)\.(?:claude-plugin|codex-plugin|cursor-plugin|plugin)\/(?:plugin|marketplace)\.json$/.test(
      lowerPath,
    )
  );
}

function detectResourceKindFromPath(resourcePath) {
  const lowerPath = resourcePath.toLowerCase().replace(/\\/g, "/");
  if (isPluginManifestPath(lowerPath)) return "plugin";
  if (/^(?:plugins\/[^/]+\/)?rules\/[^/]+\.mdc$/.test(lowerPath)) {
    return "cursor-rule";
  }
  if (/^plugins\/[^/]+\/agents\/[^/]+\.md$/.test(lowerPath)) return "agent";
  if (/^plugins\/[^/]+\/hooks\/[^/]+\/readme\.md$/.test(lowerPath)) {
    return "hook";
  }
  if (/^plugins\/[^/]+\/skills\/[^/]+\/skill\.md$/.test(lowerPath)) {
    return "skill";
  }
  if (
    /^plugins\/[^/]+\/(?:mcp\.json|\.vscode\/mcp\.json|mcp\/[^/]+\.json)$/.test(
      lowerPath,
    )
  ) {
    return "mcp";
  }
  if (lowerPath === "skill.md" || lowerPath.endsWith("/skill.md")) {
    return "skill";
  }
  if (/(^|\/)skills\/[^/]+\//.test(lowerPath)) return undefined;
  if (lowerPath.endsWith(".agent.md")) return "agent";
  if (lowerPath.endsWith(".instructions.md")) return "instruction";
  if (lowerPath.endsWith(".prompt.md")) return "prompt";
  if (/^(?:\.github\/)?hooks\/[^/]+\/readme\.md$/i.test(lowerPath)) {
    return "hook";
  }
  if (
    lowerPath === "mcp.json" ||
    lowerPath === ".mcp.json" ||
    lowerPath === ".vscode/mcp.json" ||
    /^(?:\.github\/)?mcp\/[^/]+\.json$/i.test(lowerPath)
  ) {
    return "mcp";
  }
  return undefined;
}

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

function detectPluginChildResourceKind(relativePath) {
  const lowerPath = relativePath.toLowerCase();
  if (/^agents\/[^/]+\.md$/.test(lowerPath)) return "agent";
  if (/^instructions\/[^/]+\.md$/.test(lowerPath)) return "instruction";
  if (/^prompts\/[^/]+\.md$/.test(lowerPath)) return "prompt";
  if (/^rules\/[^/]+\.mdc$/.test(lowerPath)) return "cursor-rule";
  if (/^hooks\/[^/]+\/readme\.md$/.test(lowerPath)) return "hook";
  if (/^(?:mcp\.json|\.vscode\/mcp\.json|mcp\/[^/]+\.json)$/.test(lowerPath)) {
    return "mcp";
  }
  if (/^skills\/[^/]+\/skill\.md$/.test(lowerPath)) return "skill";
  return undefined;
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

function getPluginRootFromManifestPath(resourcePath) {
  const normalizedPath = String(resourcePath)
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  const lowerPath = normalizedPath.toLowerCase();
  if (!isPluginManifestPath(lowerPath)) return undefined;
  if (
    lowerPath === "plugin.json" ||
    lowerPath === "gemini-extension.json" ||
    lowerPath === "apm.yml" ||
    lowerPath === "apm.yaml"
  ) {
    return ".";
  }
  const markerMatch = normalizedPath.match(
    /^(.*?)(?:^|\/)\.(?:claude-plugin|codex-plugin|cursor-plugin|plugin)\/(?:plugin|marketplace)\.json$/i,
  );
  return markerMatch ? markerMatch[1].replace(/\/+$/, "") || "." : ".";
}

function getResourceInstallPath(filePath, kind) {
  const normalizedPath = filePath.replace(/\\/g, "/");
  if (kind === "skill") return normalizedPath.replace(/\/SKILL\.md$/i, "");
  if (kind === "plugin") {
    return getPluginRootFromManifestPath(normalizedPath) || normalizedPath;
  }
  return normalizedPath;
}

function getFallbackResourceName(filePath, kind) {
  const pathParts = filePath.replace(/\\/g, "/").split("/");
  if (kind === "skill" || kind === "hook") {
    return pathParts[pathParts.length - 2] || "Unknown";
  }
  if (kind === "plugin") {
    const pluginRoot = getPluginRootFromManifestPath(filePath);
    if (pluginRoot && pluginRoot !== ".") {
      const rootParts = pluginRoot.split("/");
      return rootParts[rootParts.length - 1] || "plugin";
    }
    return "plugin";
  }
  return (pathParts[pathParts.length - 1] || "Unknown")
    .replace(/\.(agent|instructions|prompt)\.md$/i, "")
    .replace(/\.mdc$/i, "")
    .replace(/\.mcp\.json$/i, "")
    .replace(/\.json$/i, "");
}

function getDefaultResourceCategories(kind) {
  switch (kind) {
    case "plugin":
      return ["plugins"];
    case "cursor-rule":
      return ["cursor-rules"];
    case "agent":
      return ["agents"];
    case "mcp":
      return ["mcp"];
    default:
      return [];
  }
}

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

const treePaths = [
  "feature-dev/.claude-plugin/plugin.json",
  "feature-dev/skills/planning/SKILL.md",
  "feature-dev/agents/code-reviewer.md",
  "feature-dev/rules/typescript.mdc",
  "feature-dev/mcp.json",
  "feature-dev/hooks/session-start/README.md",
  "feature-dev/hooks/session-start/run.sh",
];
const pluginRoots = getPluginRootsFromPaths(treePaths);

const resources = treePaths
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
console.log("RESULT=PASS");
