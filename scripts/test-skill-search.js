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

const { searchSkills } = requireTypeScriptModule(
  path.join(__dirname, "..", "src", "skillSearch.ts"),
  {
    vscode: {},
    "./i18n": {
      isJapanese: () => false,
    },
    "./skillIndex": {
      getLocalizedDescription: (resource) => resource.description || "",
      getIndexResources: (index) =>
        Array.isArray(index?.skills) ? index.skills : [],
      getIndexSources: (index) =>
        Array.isArray(index?.sources) ? index.sources : [],
      getResourceKind: (resource) => resource.kind || "skill",
      getResourceKindIcon: (kind) => kind,
      getResourceKindLabel: (kind) => kind,
    },
  },
);

const index = {
  sources: [
    { id: "official-source", name: "Official Source", type: "official" },
    { id: "community-source", name: "Community Source", type: "community" },
    {
      id: "microsoft-copilot-for-azure-plugin",
      name: "GitHub Copilot for Azure Skills (Official)",
      type: "official",
    },
    {
      id: "microsoft-azure-skills",
      name: "Microsoft Azure Skills + MCP (Official)",
      type: "official",
    },
    { id: "awesome-source", name: "Awesome Source", type: "awesome-list" },
    {
      id: "very-long-official-source",
      name: "Very Long Official Source Name That Would Otherwise Crowd QuickPick Columns",
      type: "official",
    },
  ],
  skills: [
    {
      name: "Azure General Guidance",
      source: "official-source",
      kind: "skill",
      description: "A broad Azure reference",
      categories: ["azure"],
      path: "skills/azure-general-guidance",
    },
    {
      name: "Exact Terraform Fixer",
      source: "community-source",
      kind: "skill",
      description: "Specialized Terraform migration workflow",
      categories: ["terraform"],
      path: "skills/exact-terraform-fixer",
    },
    {
      name: "Terraform Planner",
      source: "official-source",
      kind: "agent",
      description: "Plan Terraform changes",
      categories: ["terraform"],
      path: "agents/terraform-planner.agent.md",
    },
    {
      name: "azure-rbac",
      source: "microsoft-copilot-for-azure-plugin",
      kind: "skill",
      description: "Azure RBAC guidance from embedded plugin path",
      categories: ["azure"],
      path: "plugin/skills/azure-rbac",
    },
    {
      name: "azure-rbac",
      source: "microsoft-azure-skills",
      kind: "skill",
      description: "Azure RBAC guidance from top-level distribution path",
      categories: ["azure"],
      path: "skills/azure-rbac",
    },
    {
      name: "azure-rbac",
      source: "microsoft-azure-skills",
      kind: "mcp",
      description: "MCP configuration for azure-rbac",
      categories: ["mcp"],
      path: "mcp/azure-rbac.json",
    },
    {
      name: "azure-cost",
      source: "microsoft-copilot-for-azure-plugin",
      kind: "skill",
      description: "Azure cost guidance from plugin path",
      categories: ["azure", "cost"],
      path: "plugin/skills/azure-cost",
    },
    {
      name: "azure-cost",
      source: "microsoft-azure-skills",
      kind: "skill",
      description: "Azure cost guidance from top-level path",
      categories: ["azure", "cost"],
      path: "skills/azure-cost",
    },
    {
      name: "azure-cost-helper",
      source: "awesome-source",
      kind: "skill",
      description: "Azure cost helper from awesome list",
      categories: ["azure", "cost"],
      path: "skills/azure-cost-helper",
    },
    {
      name: "cloud-plugin-path",
      source: "very-long-official-source",
      kind: "skill",
      description: "Top-level cloud plugin path guidance",
      categories: ["cloud"],
      path: "skills/cloud-plugin-path",
    },
    {
      name: "cloud-plugin-path",
      source: "awesome-source",
      kind: "skill",
      description: "Embedded plural plugins path guidance",
      categories: ["cloud"],
      path: "plugins/cloud/skills/cloud-plugin-path",
    },
  ],
};

test("search ranking prefers relevance before source type", () => {
  const results = searchSkills(index, "exact terraform");
  assert.strictEqual(results[0].skill.name, "Exact Terraform Fixer");
});

test("search can filter by resource kind", () => {
  const results = searchSkills(index, "terraform", "agent");
  assert.deepStrictEqual(
    results.map((item) => item.skill.name),
    ["Terraform Planner"],
  );
});

test("empty search respects resource kind filter", () => {
  const results = searchSkills(index, "", "agent");
  assert.deepStrictEqual(
    results.map((item) => item.skill.name),
    ["Terraform Planner"],
  );
});

test("duplicate skill names prefer top-level distribution paths", () => {
  const results = searchSkills(index, "azure-rbac", "skill");
  assert.strictEqual(results[0].skill.source, "microsoft-azure-skills");
  assert.strictEqual(results[0].skill.path, "skills/azure-rbac");
  assert.strictEqual(
    results[1].skill.source,
    "microsoft-copilot-for-azure-plugin",
  );
});

test("duplicate skill names show friendly source names", () => {
  const results = searchSkills(index, "azure-rbac", "skill");
  assert.match(results[0].description, /Microsoft Azure Skills \+ MCP/);
  assert.match(results[1].description, /GitHub Copilot for Azure Skills/);
});

test("duplicate skill names include source id and path detail", () => {
  const results = searchSkills(index, "azure-rbac", "skill");
  assert.match(results[0].detail, /Source: microsoft-azure-skills/);
  assert.match(results[0].detail, /Path: skills\/azure-rbac/);
  assert.match(results[1].detail, /Path: plugin\/skills\/azure-rbac/);
});

test("unique resource names do not add duplicate disambiguation detail", () => {
  const results = searchSkills(index, "exact terraform", "skill");
  assert.doesNotMatch(results[0].detail, /Source:/);
  assert.doesNotMatch(results[0].detail, /Path:/);
});

test("duplicate detection is scoped by resource kind", () => {
  const results = searchSkills(index, "azure-rbac", "mcp");
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].skill.kind, "mcp");
  assert.doesNotMatch(results[0].detail, /Source:/);
});

test("empty search also prefers top-level paths for same-name resources", () => {
  const results = searchSkills(index, "", "skill");
  const azureRbacResults = results.filter(
    (item) => item.skill.name === "azure-rbac",
  );
  assert.strictEqual(azureRbacResults[0].skill.path, "skills/azure-rbac");
  assert.strictEqual(
    azureRbacResults[1].skill.path,
    "plugin/skills/azure-rbac",
  );
});

test("same-score official results beat awesome-list results", () => {
  const results = searchSkills(index, "azure-cost", "skill");
  assert.strictEqual(results[0].skill.source, "microsoft-azure-skills");
  assert.strictEqual(
    results[1].skill.source,
    "microsoft-copilot-for-azure-plugin",
  );
  assert.strictEqual(results[2].skill.source, "awesome-source");
});

test("source display falls back to source id when source metadata is missing", () => {
  const missingSourceIndex = {
    sources: [],
    skills: [
      {
        name: "unknown-source-skill",
        source: "unknown-source",
        kind: "skill",
        description: "Unknown source test",
        categories: [],
        path: "skills/unknown-source-skill",
      },
    ],
  };
  const results = searchSkills(missingSourceIndex, "unknown-source-skill");
  assert.match(results[0].description, /unknown-source/);
});

test("duplicate path detail is absent when duplicate falls outside visible kind filter", () => {
  const results = searchSkills(index, "azure-rbac", "mcp");
  assert.strictEqual(results[0].skill.path, "mcp/azure-rbac.json");
  assert.doesNotMatch(results[0].detail, /Path:/);
});

test("duplicate details preserve category tags", () => {
  const results = searchSkills(index, "azure-rbac", "skill");
  assert.match(results[0].detail, /#azure/);
  assert.match(results[0].detail, /Path: skills\/azure-rbac/);
});

test("plural plugins paths are treated as embedded plugin paths", () => {
  const results = searchSkills(index, "cloud-plugin-path", "skill");
  assert.strictEqual(results[0].skill.path, "skills/cloud-plugin-path");
  assert.strictEqual(
    results[1].skill.path,
    "plugins/cloud/skills/cloud-plugin-path",
  );
});

test("long source names are shortened in QuickPick descriptions", () => {
  const results = searchSkills(index, "cloud-plugin-path", "skill");
  assert.match(results[0].description, /\.\.\./);
  assert.ok(
    results[0].description.length <
      "$(repo) Very Long Official Source Name That Would Otherwise Crowd QuickPick Columns · skill"
        .length,
  );
});

console.log("RESULT=PASS");
