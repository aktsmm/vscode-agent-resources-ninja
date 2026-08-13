#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

const bundledIndex = require(
  path.join(__dirname, "..", "resources", "skill-index.json"),
);

// Load the shipped rules instead of copying them, so the checks cannot pass
// against a stale duplicate. src/resourceKinds.ts only imports types.
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

// Only bind what the assertions exercise; an unused import could go undefined
// after a rename and still let the file pass.
const {
  detectPluginChildResourceKind,
  detectResourceKindFromPath,
  getBuiltInResourceDedupeKey,
  getBuiltInResourceSourceLabel,
  getFallbackResourceName,
  getPluginPackageCandidates,
  getPluginPackageId,
  getPluginRootFromManifestPath,
  getResourceInstallPath,
  getResourceMetadataPath,
  getSkillRootDirectoriesFromPaths,
  isBuiltInResourcePath,
  isNestedResourcePathUnderSkillRoot,
  shouldReplaceBuiltInResourcePath,
} = requireTypeScriptModule(
  path.join(__dirname, "..", "src", "resourceKinds.ts"),
);

function getIndexedResourcePathsFromTree(paths) {
  const skillRootDirectories = getSkillRootDirectoriesFromPaths(paths);
  return paths.filter((resourcePath) => {
    const kind = detectResourceKindFromPath(resourcePath);
    return (
      !!kind &&
      !isNestedResourcePathUnderSkillRoot(
        resourcePath,
        kind,
        skillRootDirectories,
      )
    );
  });
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

test("detects skill folders", () => {
  assert.strictEqual(
    detectResourceKindFromPath("skills/code-tour/SKILL.md"),
    "skill",
  );
  assert.strictEqual(
    getResourceInstallPath("skills/code-tour/SKILL.md", "skill"),
    "skills/code-tour",
  );
  assert.strictEqual(
    getFallbackResourceName("skills/code-tour/SKILL.md", "skill"),
    "code-tour",
  );
});

test("detects product-native instruction files", () => {
  assert.strictEqual(
    detectResourceKindFromPath("copilot-instructions.md"),
    "instruction",
  );
  assert.strictEqual(
    detectResourceKindFromPath(".github/copilot-instructions.md"),
    "instruction",
  );
  assert.strictEqual(detectResourceKindFromPath("CLAUDE.md"), "instruction");
  assert.strictEqual(detectResourceKindFromPath("AGENTS.md"), "instruction");
  assert.strictEqual(
    detectResourceKindFromPath(".codex/AGENTS.md"),
    "instruction",
  );
  assert.strictEqual(
    detectResourceKindFromPath(".gemini/GEMINI.md"),
    "instruction",
  );
});

test("detects awesome-copilot agents", () => {
  assert.strictEqual(
    detectResourceKindFromPath("agents/repo-architect.agent.md"),
    "agent",
  );
  assert.strictEqual(
    detectResourceKindFromPath("prompts/repo-architect.agent.md"),
    "agent",
  );
  assert.strictEqual(
    getFallbackResourceName("agents/repo-architect.agent.md", "agent"),
    "repo-architect",
  );
});

test("detects raw plugin resources", () => {
  assert.strictEqual(
    detectResourceKindFromPath("plugins/partners/agents/terraform.md"),
    "agent",
  );
  assert.strictEqual(
    detectResourceKindFromPath("plugins/napkin/skills/napkin/SKILL.md"),
    "skill",
  );
  assert.strictEqual(
    detectResourceKindFromPath("plugins/example/hooks/session-end/README.md"),
    "hook",
  );
  assert.strictEqual(
    detectResourceKindFromPath("plugins/example/.vscode/mcp.json"),
    "mcp",
  );
});

test("detects plugin manifests and Cursor rules", () => {
  assert.strictEqual(
    detectResourceKindFromPath(".claude-plugin/plugin.json"),
    "plugin",
  );
  assert.strictEqual(
    detectResourceKindFromPath(".codex-plugin/plugin.json"),
    "plugin",
  );
  assert.strictEqual(
    detectResourceKindFromPath(".cursor-plugin/marketplace.json"),
    "plugin",
  );
  assert.strictEqual(
    detectResourceKindFromPath(
      "plugins/feature-dev/.claude-plugin/plugin.json",
    ),
    "plugin",
  );
  assert.strictEqual(
    detectResourceKindFromPath("gemini-extension.json"),
    "plugin",
  );
  assert.strictEqual(detectResourceKindFromPath("apm.yml"), "plugin");
  assert.strictEqual(
    getResourceInstallPath(
      "plugins/feature-dev/.claude-plugin/plugin.json",
      "plugin",
    ),
    "plugins/feature-dev",
  );
  assert.strictEqual(
    getResourceInstallPath(".claude-plugin/plugin.json", "plugin"),
    ".",
  );
  assert.strictEqual(
    detectResourceKindFromPath("rules/typescript-exhaustive-switch.mdc"),
    "cursor-rule",
  );
  assert.strictEqual(
    detectResourceKindFromPath("plugins/team-kit/rules/no-inline-imports.mdc"),
    "cursor-rule",
  );
  assert.strictEqual(
    detectResourceKindFromPath(".github/plugins/team-kit/agents/ci-watcher.md"),
    "agent",
  );
  assert.strictEqual(
    detectResourceKindFromPath(
      ".github/plugins/team-kit/rules/no-inline-imports.mdc",
    ),
    "cursor-rule",
  );
  assert.strictEqual(
    detectResourceKindFromPath(".github/plugins/team-kit/mcp.json"),
    "mcp",
  );
  assert.strictEqual(
    getFallbackResourceName(
      "rules/typescript-exhaustive-switch.mdc",
      "cursor-rule",
    ),
    "typescript-exhaustive-switch",
  );
});

test("detects Agent Plugins 1.0.0 layouts at any depth", () => {
  assert.strictEqual(
    detectResourceKindFromPath("plugins/foo/plugin.json"),
    "plugin",
  );
  assert.strictEqual(
    getPluginRootFromManifestPath("plugins/foo/plugin.json"),
    "plugins/foo",
  );
  assert.strictEqual(getPluginRootFromManifestPath("plugin.json"), ".");
  assert.strictEqual(
    getPluginRootFromManifestPath("plugins/foo/.claude-plugin/plugin.json"),
    "plugins/foo",
  );
  assert.strictEqual(
    getPluginRootFromManifestPath("gemini-extension.json"),
    ".",
  );
  assert.strictEqual(
    getPluginRootFromManifestPath("x/y/gemini-extension.json"),
    "x/y",
  );
  assert.strictEqual(getPluginRootFromManifestPath("apm.yml"), ".");
  assert.strictEqual(getPluginRootFromManifestPath("x/apm.yml"), "x");

  assert.strictEqual(
    detectResourceKindFromPath("plugins/foo/.mcp.json"),
    "mcp",
  );
  assert.strictEqual(
    detectResourceKindFromPath("plugins/foo/hooks.json"),
    "hook",
  );
  assert.strictEqual(
    detectResourceKindFromPath("plugins/foo/skills/bar/SKILL.md"),
    "skill",
  );
  assert.strictEqual(
    detectPluginChildResourceKind("skills/bar/SKILL.md"),
    "skill",
  );
  // Agent Plugins 1.0.0 only exposes the immediate child directory of skills/.
  assert.strictEqual(
    detectPluginChildResourceKind("skills/bar/references/SKILL.md"),
    undefined,
    "Agent Plugins skills must not recurse below the immediate child directory",
  );
});

test("groups plugin packages from manifests and child resources", () => {
  const resources = [
    {
      kind: "plugin",
      name: "superpowers",
      source: "obra-superpowers",
      path: ".",
      pluginRoot: ".",
      pluginManifestPath: ".codex-plugin/plugin.json",
      pluginManifestKind: "codex-plugin",
    },
    {
      kind: "skill",
      name: "brainstorming",
      source: "obra-superpowers",
      path: "skills/brainstorming",
    },
    {
      kind: "plugin",
      name: "cursor-plugins",
      source: "cursor-official-plugins",
      path: ".",
      pluginRoot: ".",
      pluginManifestPath: ".cursor-plugin/marketplace.json",
      pluginManifestKind: "marketplace",
    },
    {
      kind: "plugin",
      name: "create-plugin",
      source: "cursor-official-plugins",
      path: "create-plugin",
      pluginRoot: "create-plugin",
      pluginManifestPath: "create-plugin/.cursor-plugin/plugin.json",
      pluginManifestKind: "cursor-plugin",
    },
    {
      kind: "agent",
      name: "plugin-architect",
      source: "cursor-official-plugins",
      path: "create-plugin/agents/plugin-architect.md",
    },
  ];
  const packages = getPluginPackageCandidates(resources);

  assert.ok(
    packages.some(
      (pkg) => pkg.id === "obra-superpowers:." && pkg.label === "superpowers",
    ),
    "Root plugin package should be created from non-marketplace manifest",
  );
  assert.ok(
    packages.some(
      (pkg) =>
        pkg.id === "cursor-official-plugins:create-plugin" &&
        pkg.label === "create-plugin",
    ),
    "Subdirectory plugin package should be created from pluginRoot",
  );
  assert.ok(
    !packages.some((pkg) => pkg.id === "cursor-official-plugins:."),
    "Marketplace root manifest should not swallow an entire source as one plugin",
  );
  assert.strictEqual(
    getPluginPackageId(resources[1], packages),
    "obra-superpowers:.",
    "Root plugin skills should be marked as part of the source-level plugin",
  );
  assert.strictEqual(
    getPluginPackageId(resources[4], packages),
    "cursor-official-plugins:create-plugin",
    "Plugin child agents should be marked as part of their plugin package",
  );
});

test("detects instructions and prompts", () => {
  assert.strictEqual(
    detectResourceKindFromPath("instructions/typescript.instructions.md"),
    "instruction",
  );
  assert.strictEqual(
    detectResourceKindFromPath(
      ".github/instructions/typescript.instructions.md",
    ),
    "instruction",
  );
  assert.strictEqual(
    detectResourceKindFromPath("prompts/review.prompt.md"),
    "prompt",
  );
  assert.strictEqual(
    detectResourceKindFromPath(".github/prompts/review.prompt.md"),
    "prompt",
  );
});

test("does not count nested files inside skill folders as standalone resources", () => {
  assert.strictEqual(
    detectResourceKindFromPath("skills/code-tour/prompts/review.prompt.md"),
    undefined,
  );
  assert.strictEqual(
    detectResourceKindFromPath(
      ".github/skills/code-tour/agents/helper.agent.md",
    ),
    undefined,
  );
  assert.strictEqual(
    detectResourceKindFromPath(
      ".github/skills/code-tour/instructions/helper.instructions.md",
    ),
    undefined,
  );
  assert.strictEqual(
    detectResourceKindFromPath(".github/skills/code-tour/hooks/pre/README.md"),
    undefined,
  );
});

test("does not index non-skill resources nested under detected skill roots", () => {
  assert.deepStrictEqual(
    getIndexedResourcePathsFromTree([
      "book-writing-workspace/SKILL.md",
      "book-writing-workspace/templates/outline.prompt.md",
      "book-writing-workspace/templates/review.instructions.md",
      "prompts/standalone.prompt.md",
      "agents/standalone.agent.md",
    ]),
    [
      "book-writing-workspace/SKILL.md",
      "prompts/standalone.prompt.md",
      "agents/standalone.agent.md",
    ],
  );
});

test("keeps standalone resources visible when SKILL.md is at repository root", () => {
  assert.deepStrictEqual(
    getIndexedResourcePathsFromTree([
      "SKILL.md",
      "helper.prompt.md",
      "setup.agent.md",
    ]),
    ["SKILL.md", "helper.prompt.md", "setup.agent.md"],
  );
});

test("detects VS Code session skills as built-in resources", () => {
  assert.strictEqual(
    isBuiltInResourcePath(
      ".vscode-test/vscode-win32-x64-archive-1.117.0/10c8e557c8/resources/app/out/vs/sessions/skills/commit/SKILL.md",
    ),
    true,
  );
  assert.strictEqual(
    isBuiltInResourcePath(".github/skills/commit/SKILL.md"),
    false,
  );
});

test("detects Copilot Chat bundled prompt skills as built-in resources", () => {
  assert.strictEqual(
    isBuiltInResourcePath(
      ".vscode-test/extensions/github.copilot-chat-0.45.1/assets/prompts/skills/create-agent/SKILL.md",
    ),
    true,
  );
  assert.strictEqual(
    isBuiltInResourcePath(
      "C:/Users/alice/.vscode/extensions/github.copilot-chat-0.99.0/assets/prompts/skills/create-prompt/SKILL.md",
    ),
    true,
  );
  assert.strictEqual(
    isBuiltInResourcePath(
      ".vscode-test/manual-local-launch/extensions-test-code/github.copilot-chat-0.45.1/assets/prompts/skills/create-prompt/SKILL.md",
    ),
    true,
  );
  assert.strictEqual(
    isBuiltInResourcePath(
      ".vscode-test/vscode-win32-x64-archive-1.117.0/10c8e557c8/resources/app/extensions/copilot/assets/prompts/skills/create-skill/SKILL.md",
    ),
    true,
  );
  assert.strictEqual(
    isBuiltInResourcePath(
      ".vscode-test/vscode-win32-x64-archive-1.117.0/10c8e557c8/resources/app/extensions/TypeScriptTeam.jsts-chat-features/skills/typescript-setup/SKILL.md",
    ),
    true,
  );
  assert.strictEqual(
    isBuiltInResourcePath(
      ".vscode-test/vscode-win32-x64-archive-1.117.0/10c8e557c8/resources/app/node_modules/@github/copilot/builtin-skills/customize-cloud-agent/SKILL.md",
    ),
    true,
  );
  assert.strictEqual(
    isBuiltInResourcePath(
      "pkg/universal/1.0.36/builtin-skills/customize-cloud-agent/SKILL.md",
    ),
    true,
  );
  assert.strictEqual(
    isBuiltInResourcePath("skills/receipt-ocr/SKILL.md"),
    false,
  );
});

test("detects Copilot Chat generated agents as built-in resources", () => {
  assert.strictEqual(
    isBuiltInResourcePath(
      ".vscode-test/manual-local-launch/user-data-start/User/globalStorage/github.copilot-chat/ask-agent/Ask.agent.md",
    ),
    true,
  );
  assert.strictEqual(
    isBuiltInResourcePath(
      "C:/Users/alice/AppData/Roaming/Code/User/globalStorage/github.copilot-chat/explore-agent/Explore.agent.md",
    ),
    true,
  );
  assert.strictEqual(
    isBuiltInResourcePath(".github/agents/Plan.agent.md"),
    false,
  );
  assert.strictEqual(
    isBuiltInResourcePath(
      "C:/Users/alice/.vscode/extensions/ms-azuretools.vscode-azure-github-copilot-1.0.201-win32-x64/resources/agents/azure-iac-exporter.agent.md",
    ),
    false,
  );
});

test("detects future Copilot built-in resource layouts defensively", () => {
  assert.strictEqual(
    isBuiltInResourcePath(
      "C:/Users/alice/AppData/Roaming/Code/User/globalStorage/github.copilot-chat/new-mode/Future.agent.md",
    ),
    true,
  );
  assert.strictEqual(
    isBuiltInResourcePath(
      "pkg/universal/2.5.0/builtin-agents/future/Future.agent.md",
    ),
    true,
  );
  assert.strictEqual(
    isBuiltInResourcePath(
      "pkg/universal/2.5.0/builtin-prompts/future.prompt.md",
    ),
    true,
  );
  assert.strictEqual(
    isBuiltInResourcePath(".github/agents/future.agent.md"),
    false,
  );
});

test("labels built-in resource origins", () => {
  assert.strictEqual(
    getBuiltInResourceSourceLabel(
      "C:/Users/alice/AppData/Roaming/Code/User/globalStorage/github.copilot-chat/plan-agent/Plan.agent.md",
    ),
    "GitHub Copilot Chat",
  );
  assert.strictEqual(
    getBuiltInResourceSourceLabel(
      "pkg/universal/1.0.36/builtin-skills/customize-cloud-agent/SKILL.md",
    ),
    "GitHub Copilot CLI",
  );
  assert.strictEqual(
    getBuiltInResourceSourceLabel(
      ".vscode-test/vscode-win32-x64-archive-1.117.0/10c8e557c8/resources/app/out/vs/sessions/skills/commit/SKILL.md",
    ),
    "VS Code",
  );
});

test("deduplicates built-in resources by kind and name", () => {
  assert.strictEqual(
    getBuiltInResourceDedupeKey({ kind: "skill", name: "agent-customization" }),
    getBuiltInResourceDedupeKey({ kind: "skill", name: "Agent-Customization" }),
  );
  assert.strictEqual(
    shouldReplaceBuiltInResourcePath(
      ".vscode-test/extensions/github.copilot-chat-0.45.1/assets/prompts/skills/create-agent/SKILL.md",
      ".vscode-test/vscode-win32-x64-archive-1.117.0/10c8e557c8/resources/app/extensions/copilot/assets/prompts/skills/create-agent/SKILL.md",
    ),
    true,
  );
  assert.strictEqual(
    shouldReplaceBuiltInResourcePath(
      "pkg/universal/1.0.24/builtin-skills/customize-cloud-agent/SKILL.md",
      "pkg/universal/1.0.36/builtin-skills/customize-cloud-agent/SKILL.md",
    ),
    true,
  );
  assert.strictEqual(
    shouldReplaceBuiltInResourcePath(
      "pkg/universal/1.0.1/builtin-prompts/create.prompt.md",
      "pkg/universal/1.0.2/builtin-prompts/create.prompt.md",
    ),
    true,
  );
  assert.strictEqual(
    shouldReplaceBuiltInResourcePath(
      "pkg/universal/1.0.2/builtin-prompts/create.prompt.md",
      "pkg/universal/1.0.1/builtin-prompts/create.prompt.md",
    ),
    false,
  );
  assert.strictEqual(
    shouldReplaceBuiltInResourcePath(
      "/app/resources/app/extensions/example/skills/create/SKILL.md",
      "/app/resources/app/extensions/copilot/assets/prompts/skills/create/SKILL.md",
    ),
    true,
  );
  assert.strictEqual(
    shouldReplaceBuiltInResourcePath(
      "builtin-agents/nested/Ask.agent.md",
      "builtin-agents/Ask.agent.md",
    ),
    true,
  );
});

test("detects hook entry readmes and Copilot CLI hook configs", () => {
  assert.strictEqual(
    detectResourceKindFromPath("hooks/pre-review/README.md"),
    "hook",
  );
  assert.strictEqual(
    detectResourceKindFromPath(".github/hooks/pre-review/README.md"),
    "hook",
  );
  assert.strictEqual(
    detectResourceKindFromPath("hooks/copilot-cli-policy.json"),
    "hook",
  );
  assert.strictEqual(
    detectResourceKindFromPath(".github/hooks/copilot-cli-policy.json"),
    "hook",
  );
  assert.strictEqual(
    getFallbackResourceName("hooks/copilot-cli-policy.json", "hook"),
    "copilot-cli-policy",
  );
  assert.strictEqual(
    detectResourceKindFromPath(
      "hooks/copilot-cli-policy.json.resource-ninja.json",
    ),
    undefined,
  );
  assert.strictEqual(detectResourceKindFromPath("docs/README.md"), undefined);
});

test("detects MCP config resources without auto-activation paths", () => {
  assert.strictEqual(detectResourceKindFromPath("mcp.json"), "mcp");
  assert.strictEqual(detectResourceKindFromPath("mcp-config.json"), "mcp");
  assert.strictEqual(detectResourceKindFromPath(".mcp.json"), "mcp");
  assert.strictEqual(detectResourceKindFromPath(".vscode/mcp.json"), "mcp");
  assert.strictEqual(
    detectResourceKindFromPath(".github/mcp/github-server.json"),
    "mcp",
  );
  assert.strictEqual(detectResourceKindFromPath("package.json"), undefined);
});

test("normalizes windows paths", () => {
  assert.strictEqual(
    detectResourceKindFromPath(".github\\agents\\planner.agent.md"),
    "agent",
  );
  assert.strictEqual(
    detectResourceKindFromPath(".github\\hooks\\pre-review\\README.md"),
    "hook",
  );
  assert.strictEqual(
    detectResourceKindFromPath(".github\\mcp\\github-server.json"),
    "mcp",
  );
  assert.strictEqual(
    getResourceInstallPath("skills\\code-tour\\SKILL.md", "skill"),
    "skills/code-tour",
  );
});

test("resource metadata sidecars sit next to installed resources", () => {
  assert.strictEqual(
    getResourceMetadataPath(
      ".github/instructions/bicep-code-best-practices.instructions.md",
      "instruction",
    ),
    ".github/instructions/bicep-code-best-practices.instructions.md.resource-ninja.json",
  );
  assert.strictEqual(
    getResourceMetadataPath(".github/hooks/pre-review/README.md", "hook"),
    ".github/hooks/pre-review/.resource-ninja.json",
  );
  assert.strictEqual(
    getResourceMetadataPath(".github/mcp/github-server.json", "mcp"),
    ".github/mcp/github-server.json.resource-ninja.json",
  );
  assert.strictEqual(
    getResourceMetadataPath(".github/skills/code-tour/SKILL.md", "skill"),
    ".github/skills/code-tour/.skill-meta.json",
  );
  assert.strictEqual(
    getResourceMetadataPath(".github/plugins/superpowers", "plugin"),
    ".github/plugins/superpowers/.resource-ninja.json",
  );
});

test("bundled awesome-copilot index includes non-skill resources", () => {
  const resources = bundledIndex.skills.filter(
    (resource) => resource.source === "github-awesome-copilot",
  );
  const counts = resources.reduce((acc, resource) => {
    const kind = resource.kind || "skill";
    acc[kind] = (acc[kind] || 0) + 1;
    return acc;
  }, {});

  assert.ok(counts.skill > 0, "Expected skills from github/awesome-copilot");
  assert.ok(counts.agent > 0, "Expected agents from github/awesome-copilot");
  assert.ok(
    counts.instruction > 0,
    "Expected instructions from github/awesome-copilot",
  );
  assert.ok(counts.hook > 0, "Expected hooks from github/awesome-copilot");
});

test("bundled official product presets use filtered resource roots", () => {
  const skillOnlyExpectedCounts = {
    "google-gemini-cli": 11,
    "openai-codex": 10,
    "cline-official": 1,
  };

  for (const [sourceId, expectedCount] of Object.entries(
    skillOnlyExpectedCounts,
  )) {
    const resources = bundledIndex.skills.filter(
      (resource) => resource.source === sourceId,
    );
    assert.strictEqual(
      resources.length,
      expectedCount,
      `Unexpected resource count for ${sourceId}`,
    );
    assert.ok(
      resources.every((resource) => (resource.kind || "skill") === "skill"),
      `${sourceId} should currently contribute skills only`,
    );
  }

  const pluginSourceExpectations = {
    "aws-agent-plugins": { total: 40, skills: 28, plugins: 9, hooks: 3 },
    "elastic-agent-skills": { total: 71, skills: 66, plugins: 5 },
    "anthropic-claude-code": {
      total: 42,
      skills: 10,
      agents: 15,
      plugins: 12,
      hooks: 5,
    },
  };

  for (const [sourceId, expected] of Object.entries(pluginSourceExpectations)) {
    const resources = bundledIndex.skills.filter(
      (resource) => resource.source === sourceId,
    );
    const counts = resources.reduce((acc, resource) => {
      const kind = resource.kind || "skill";
      acc[kind] = (acc[kind] || 0) + 1;
      return acc;
    }, {});
    assert.strictEqual(
      resources.length,
      expected.total,
      `Unexpected resource count for ${sourceId}`,
    );
    assert.strictEqual(counts.skill || 0, expected.skills);
    assert.strictEqual(counts.plugin || 0, expected.plugins);
    if (expected.agents !== undefined) {
      assert.strictEqual(counts.agent || 0, expected.agents);
    }
    if (expected.hooks !== undefined) {
      assert.strictEqual(counts.hook || 0, expected.hooks);
    }
  }

  const excludedPathFragments = [
    "packages/cli/src/commands/extensions/examples",
    "packages/sdk/test-data",
    "codex-rs/skills/src/assets/samples",
    ".claude/commands/",
    ".claude-plugin/",
    ".codex-plugin/",
  ];
  for (const resource of bundledIndex.skills) {
    for (const fragment of excludedPathFragments) {
      assert.ok(
        !resource.path.includes(fragment),
        `Preset index should not include sample/internal path ${resource.path}`,
      );
    }
  }
});

test("bundled resources respect source include and exclude path filters", () => {
  for (const source of bundledIndex.sources) {
    const includePaths = (source.includePaths || []).map((item) =>
      item
        .replace(/\\/g, "/")
        .replace(/^\/+|\/+$/g, "")
        .toLowerCase(),
    );
    const excludePaths = (source.excludePaths || []).map((item) =>
      item
        .replace(/\\/g, "/")
        .replace(/^\/+|\/+$/g, "")
        .toLowerCase(),
    );
    if (includePaths.length === 0 && excludePaths.length === 0) {
      continue;
    }

    const resources = bundledIndex.skills.filter(
      (resource) => resource.source === source.id,
    );
    for (const resource of resources) {
      const resourcePath = String(
        resource.pluginManifestPath || resource.path || "",
      )
        .replace(/\\/g, "/")
        .toLowerCase();
      assert.ok(
        includePaths.length === 0 ||
          includePaths.some(
            (prefix) =>
              resourcePath === prefix || resourcePath.startsWith(`${prefix}/`),
          ),
        `${source.id} resource should match includePaths: ${resource.path}`,
      );
      assert.ok(
        !excludePaths.some(
          (prefix) =>
            resourcePath === prefix || resourcePath.startsWith(`${prefix}/`),
        ),
        `${source.id} resource should not match excludePaths: ${resource.path}`,
      );
    }
  }
});

test("bundled curated copilot source includes prompts and instructions", () => {
  const resources = bundledIndex.skills.filter(
    (resource) => resource.source === "code-and-sorts-awesome-copilot-agents",
  );
  const counts = resources.reduce((acc, resource) => {
    const kind = resource.kind || "skill";
    acc[kind] = (acc[kind] || 0) + 1;
    return acc;
  }, {});

  assert.strictEqual(resources.length, 34);
  assert.strictEqual(counts.agent, 4);
  assert.strictEqual(counts.instruction, 23);
  assert.strictEqual(counts.prompt, 3);
  assert.strictEqual(counts.skill, 4);
});

test("bundled index does not contain display-equivalent duplicate resources", () => {
  const seen = new Map();
  for (const resource of bundledIndex.skills) {
    const pluginId = String(resource.path || "").match(
      /^plugins\/([^/]+)\//,
    )?.[1];
    const description = String(resource.description || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
    const key = [
      pluginId ? `plugin:${pluginId}` : "resource",
      resource.source,
      resource.kind || "skill",
      String(resource.name || "")
        .trim()
        .toLowerCase(),
      description || String(resource.path || "").toLowerCase(),
    ].join(":");
    assert.ok(
      !seen.has(key),
      `Duplicate display resource ${resource.source}:${resource.name} at ${resource.path} and ${seen.get(key)}`,
    );
    seen.set(key, resource.path);
  }
});

console.log("Resource kind tests passed");
