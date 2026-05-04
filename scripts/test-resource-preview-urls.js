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

const skillIndexModule = requireTypeScriptModule(
  path.join(__dirname, "..", "src", "skillIndex.ts"),
  {
    vscode: {},
    "./githubFetch": {
      createGitHubHeaders: () => ({}),
      fetchGitHubWithOptionalAuthRetry: async () => ({ ok: false }),
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
  getResourceContentPath,
  getSkillGitHubUrl,
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

console.log("RESULT=PASS");
