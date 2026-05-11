#!/usr/bin/env node

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

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const skillIndexModule = requireTypeScriptModule(
  path.join(__dirname, "..", "src", "skillIndex.ts"),
  {
    vscode: {},
    "./githubFetch": {
      createGitHubHeaders: () => ({}),
      fetchGitHubWithOptionalAuthRetry: async () => ({ ok: false }),
    },
    "./sharedResourceIndexStore": {
      loadSharedStoresIntoSkillIndex: async (index) => index,
      syncSharedStoresFromSkillIndex: async () => undefined,
    },
    "./logger": {
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    },
  },
);

const {
  buildGitHubResourceUrl,
  getResourceContentPath,
  getSkillGitHubUrl,
  getSkillGitHubUrlAsync,
  getSkillRawUrl,
  isResourceFilePath,
} = skillIndexModule;

const sources = [
  {
    id: "github-awesome-copilot",
    name: "GitHub Awesome Copilot",
    url: "https://github.com/github/awesome-copilot",
    type: "official",
    branch: "main",
    description: "GitHub Awesome Copilot",
  },
  {
    id: "cursor-official-plugins",
    name: "Cursor Plugins",
    url: "https://github.com/cursor/plugins",
    type: "official",
    branch: "main",
    description: "Cursor Plugins",
  },
];

const bundledIndex = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "resources", "skill-index.json"),
    "utf8",
  ),
);

function resource(overrides) {
  return {
    name: overrides.name || "resource",
    source: "github-awesome-copilot",
    path: overrides.path,
    kind: overrides.kind,
    categories: [],
    description: "",
  };
}

test("MCP config preview uses the JSON file path directly", () => {
  const mcp = resource({
    kind: "mcp",
    name: "mcp",
    path: ".vscode/mcp.json",
  });
  assert.strictEqual(isResourceFilePath(mcp.path), true);
  assert.strictEqual(getResourceContentPath(mcp), ".vscode/mcp.json");
  assert.strictEqual(
    getSkillRawUrl(mcp, sources),
    "https://raw.githubusercontent.com/github/awesome-copilot/main/.vscode/mcp.json",
  );
  assert.strictEqual(
    getSkillGitHubUrl(mcp, sources),
    "https://github.com/github/awesome-copilot/blob/main/.vscode/mcp.json",
  );
});

test("bundled MCP resources avoid raw JSON descriptions", () => {
  const mcpResources = bundledIndex.skills.filter(
    (entry) => entry.kind === "mcp",
  );
  assert.ok(mcpResources.length > 0, "Expected bundled MCP resources");
  for (const entry of mcpResources) {
    assert.doesNotMatch(entry.description || "", /^\s*[{}]\s*$/);
    assert.match(entry.description || "", /MCP configuration/);
  }
});

test("single-file resources use blob and raw file paths", () => {
  const agent = resource({
    kind: "agent",
    name: "agent",
    path: "agents/example.agent.md",
  });
  assert.strictEqual(getResourceContentPath(agent), "agents/example.agent.md");
  assert.strictEqual(
    getSkillRawUrl(agent, sources),
    "https://raw.githubusercontent.com/github/awesome-copilot/main/agents/example.agent.md",
  );
  assert.strictEqual(
    getSkillGitHubUrl(agent, sources),
    "https://github.com/github/awesome-copilot/blob/main/agents/example.agent.md",
  );
});

test("prompt and hook resources also use their file paths directly", () => {
  const prompt = resource({
    kind: "prompt",
    name: "prompt",
    path: "prompts/example.prompt.md",
  });
  const hook = resource({
    kind: "hook",
    name: "hook",
    path: "hooks/example/README.md",
  });

  assert.strictEqual(
    getSkillRawUrl(prompt, sources),
    "https://raw.githubusercontent.com/github/awesome-copilot/main/prompts/example.prompt.md",
  );
  assert.strictEqual(
    getSkillGitHubUrl(prompt, sources),
    "https://github.com/github/awesome-copilot/blob/main/prompts/example.prompt.md",
  );
  assert.strictEqual(
    getSkillRawUrl(hook, sources),
    "https://raw.githubusercontent.com/github/awesome-copilot/main/hooks/example/README.md",
  );
  assert.strictEqual(
    getSkillGitHubUrl(hook, sources),
    "https://github.com/github/awesome-copilot/blob/main/hooks/example/README.md",
  );
});

test("directory skills still preview SKILL.md and open as tree", () => {
  const skill = resource({
    kind: "skill",
    name: "skill",
    path: "skills/example",
  });
  assert.strictEqual(isResourceFilePath(skill.path), false);
  assert.strictEqual(getResourceContentPath(skill), "skills/example/SKILL.md");
  assert.strictEqual(
    getSkillRawUrl(skill, sources),
    "https://raw.githubusercontent.com/github/awesome-copilot/main/skills/example/SKILL.md",
  );
  assert.strictEqual(
    getSkillGitHubUrl(skill, sources),
    "https://github.com/github/awesome-copilot/tree/main/skills/example",
  );
});

test("stored GitHub URLs keep their route while updating the branch", () => {
  const skill = resource({
    kind: "skill",
    name: "humanize-writing",
    path: "humanize-writing",
  });
  skill.source = "agent-skills";
  skill.url =
    "https://github.com/aktsmm/Agent-Skills/blob/main/humanize-writing/";

  const legacySources = [
    {
      id: "agent-skills",
      name: "Agent Skills",
      url: "https://github.com/aktsmm/Agent-Skills",
      type: "user-added",
      branch: "master",
      description: "Agent Skills",
    },
  ];

  assert.strictEqual(
    getSkillGitHubUrl(skill, legacySources),
    "https://github.com/aktsmm/Agent-Skills/blob/master/humanize-writing/",
  );
});

test("plugin manifests preview the manifest and open the plugin root", () => {
  const plugin = resource({
    kind: "plugin",
    name: "create-plugin",
    path: "create-plugin",
  });
  plugin.source = "cursor-official-plugins";
  plugin.pluginRoot = "create-plugin";
  plugin.pluginManifestPath = "create-plugin/.cursor-plugin/plugin.json";

  assert.strictEqual(
    getResourceContentPath(plugin),
    "create-plugin/.cursor-plugin/plugin.json",
  );
  assert.strictEqual(
    getSkillRawUrl(plugin, sources),
    "https://raw.githubusercontent.com/cursor/plugins/main/create-plugin/.cursor-plugin/plugin.json",
  );
  assert.strictEqual(
    getSkillGitHubUrl(plugin, sources),
    "https://github.com/cursor/plugins/tree/main/create-plugin",
  );
});

test("root marketplace plugin previews manifest without SKILL.md fallback", () => {
  const marketplace = resource({
    kind: "plugin",
    name: "cursor-plugins",
    path: ".",
  });
  marketplace.source = "cursor-official-plugins";
  marketplace.pluginRoot = ".";
  marketplace.pluginManifestPath = ".cursor-plugin/marketplace.json";

  assert.strictEqual(
    getResourceContentPath(marketplace),
    ".cursor-plugin/marketplace.json",
  );
  assert.strictEqual(
    getSkillRawUrl(marketplace, sources),
    "https://raw.githubusercontent.com/cursor/plugins/main/.cursor-plugin/marketplace.json",
  );
  assert.strictEqual(
    getSkillGitHubUrl(marketplace, sources),
    "https://github.com/cursor/plugins/tree/main",
  );
});

test("Cursor rules preview raw mdc files directly", () => {
  const cursorRule = resource({
    kind: "cursor-rule",
    name: "plugin-quality-gates",
    path: "create-plugin/rules/plugin-quality-gates.mdc",
  });
  cursorRule.source = "cursor-official-plugins";

  assert.strictEqual(
    getResourceContentPath(cursorRule),
    "create-plugin/rules/plugin-quality-gates.mdc",
  );
  assert.strictEqual(
    getSkillRawUrl(cursorRule, sources),
    "https://raw.githubusercontent.com/cursor/plugins/main/create-plugin/rules/plugin-quality-gates.mdc",
  );
  assert.strictEqual(
    getSkillGitHubUrl(cursorRule, sources),
    "https://github.com/cursor/plugins/blob/main/create-plugin/rules/plugin-quality-gates.mdc",
  );
});

test("resource URL builder handles file and directory paths consistently", () => {
  assert.strictEqual(
    buildGitHubResourceUrl(
      "https://github.com/github/awesome-copilot",
      "main",
      { kind: "prompt", path: "prompts/example.prompt.md" },
    ),
    "https://github.com/github/awesome-copilot/blob/main/prompts/example.prompt.md",
  );
  assert.strictEqual(
    buildGitHubResourceUrl(
      "https://github.com/github/awesome-copilot",
      "main",
      { kind: "skill", path: "skills/example" },
    ),
    "https://github.com/github/awesome-copilot/tree/main/skills/example",
  );
});

(async () => {
  await testAsync(
    "async GitHub URL resolution probes master and preserves stored route",
    async () => {
      const originalFetch = global.fetch;
      global.fetch = async (url) => ({
        ok:
          typeof url === "string" &&
          url ===
            "https://raw.githubusercontent.com/aktsmm/Agent-Skills/master/humanize-writing/SKILL.md",
      });

      try {
        const skill = resource({
          kind: "skill",
          name: "humanize-writing",
          path: "humanize-writing",
        });
        skill.source = "agent-skills";
        skill.url =
          "https://github.com/aktsmm/Agent-Skills/blob/main/humanize-writing/";

        const legacySources = [
          {
            id: "agent-skills",
            name: "Agent Skills",
            url: "https://github.com/aktsmm/Agent-Skills",
            type: "user-added",
            description: "Agent Skills",
          },
        ];

        assert.strictEqual(
          await getSkillGitHubUrlAsync(skill, legacySources),
          "https://github.com/aktsmm/Agent-Skills/blob/master/humanize-writing/",
        );
      } finally {
        global.fetch = originalFetch;
      }
    },
  );

  console.log("RESULT=PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
