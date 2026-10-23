#!/usr/bin/env node
// Drives the registered language model tools (install / uninstall / localize)
// with stubbed collaborators: the behavior under test is target selection and
// the "ambiguous or existing => change nothing" contract, not the installer.

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");

function loadTs(filePath, stubs = {}) {
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  });
  const loaded = new Module(filePath, module);
  loaded.filename = filePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(filePath));
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) {
      return stubs[request];
    }
    return originalLoad(request, parent, isMain);
  };
  try {
    loaded._compile(transpiled.outputText, filePath);
  } finally {
    Module._load = originalLoad;
  }
  return loaded.exports;
}

const calls = { install: [], uninstall: [], save: [] };
const existingPaths = new Set();
const resources = [];
let localResources = [];

class TextPart {
  constructor(value) {
    this.value = value;
  }
}
class ToolResult {
  constructor(parts) {
    this.content = parts;
  }
}
const uri = (p) => ({
  fsPath: p,
  path: p,
  toString: () => p,
});
const tools = {};
const vscodeStub = {
  lm: {
    registerTool: (name, tool) => {
      tools[name] = tool;
      return { dispose() {} };
    },
  },
  LanguageModelToolResult: ToolResult,
  LanguageModelTextPart: TextPart,
  Uri: {
    file: uri,
    joinPath: (base, ...parts) => uri([base.fsPath, ...parts].join("/")),
  },
  workspace: {
    workspaceFolders: [{ uri: uri("/ws") }],
    getConfiguration: () => ({ get: () => false }),
    asRelativePath: (u) => String(u.fsPath).replace(/^\/ws\//, ""),
    fs: {
      stat: async (u) => {
        if (!existingPaths.has(u.fsPath)) {
          throw new Error("ENOENT");
        }
        return {};
      },
    },
  },
  commands: { executeCommand: async () => undefined },
};

const skillIndexStub = {
  loadSkillIndex: async () => ({ sources: [], skills: resources }),
  saveSkillIndex: async (_context, index) => calls.save.push(index),
  getLocalizedDescription: (r) => r.description,
  getIndexResources: (index) => index.skills,
  getIndexSources: () => [],
  getResourceKind: (r) => r.kind || "skill",
  getResourceKindLabel: (kind) => kind,
};

const { registerMcpTools } = loadTs(path.join(root, "src", "mcpTools.ts"), {
  vscode: vscodeStub,
  "./skillIndex": skillIndexStub,
  "./skillInstaller": {
    installSkill: async (skill) => {
      calls.install.push(skill);
      const destination = uri(`/ws/.github/skills/${skill.name}`);
      existingPaths.add(`${destination.fsPath}/SKILL.md`);
      return { destinationUri: destination };
    },
    getResourceTargetUri: (_ws, _config, skill) =>
      uri(`/ws/.github/skills/${skill.name}`),
    getInstalledSkills: async () => [],
    uninstallSkillByPath: async (relativePath) => {
      calls.uninstall.push(relativePath);
      return {};
    },
  },
  "./hookConfigManager": { formatHookConfigUpdateSummary: () => "" },
  "./instructionManager": {
    escapeMarkdownTableText: (v) => String(v),
    INCOMPLETE_ROW_MARKER: "!",
    isInstructionFileUpdateFailure: () => false,
    updateInstructionFile: async () => ({ status: "unchanged" }),
  },
  "./customizationPaths": { getConfiguredInstructionFilePath: () => "none" },
  "./indexUpdater": {
    searchGitHub: async () => [],
    addSource: async () => undefined,
    removeSource: async () => undefined,
    getGitHubAuthFailureReason: () => "",
  },
  "./i18n": { isJapanese: () => false },
  "./githubResponse": { isGitHubResponseError: () => false },
  "./githubAuth": { getGitHubToken: async () => undefined },
  "./logger": { logger: { info() {}, warn() {}, error() {} } },
  "./localSkillScanner": { scanLocalSkills: async () => localResources },
  "./sourceIndexUpdatePresentation": {
    formatSourceIndexUpdateToolResult: () => "",
    getIndexedResourceChanges: () => [],
  },
  "./mcpResourceSelection": loadTs(
    path.join(root, "src", "mcpResourceSelection.ts"),
  ),
});

registerMcpTools({ subscriptions: [] });

const run = async (name, input) => {
  const result = await tools[name].invoke({ input }, {});
  return result.content.map((part) => part.value).join("\n");
};

function reset() {
  calls.install.length = 0;
  calls.uninstall.length = 0;
  calls.save.length = 0;
  existingPaths.clear();
  // The tools cache the index object, so the same array is refilled in place.
  resources.splice(0, resources.length,
    { name: "review", source: "acme/public", path: "skills/review/SKILL.md", description: "pub" },
    { name: "review", source: "acme/private", path: "skills/review/SKILL.md", description: "priv" },
    { name: "solo-helper", source: "acme/public", path: "skills/solo-helper/SKILL.md", description: "solo" },
  );
  localResources = [
    { name: "review", kind: "skill", relativePath: ".github/skills/review/SKILL.md", fullPath: "/ws/.github/skills/review" },
    { name: "review", kind: "skill", relativePath: ".claude/skills/review/SKILL.md", fullPath: "/ws/.claude/skills/review" },
    { name: "solo-helper", kind: "skill", relativePath: ".github/skills/solo-helper/SKILL.md", fullPath: "/ws/.github/skills/solo-helper" },
  ];
}

let failures = 0;
async function test(name, fn) {
  reset();
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

(async () => {
  await test("install: a same-name resource in two sources installs nothing", async () => {
    const text = await run("resourceNinja_install", { resourceName: "review" });
    assert.match(text, /Multiple resources match/);
    assert.strictEqual(calls.install.length, 0);
  });

  await test("install: source and path pick exactly one resource", async () => {
    const text = await run("resourceNinja_install", {
      resourceName: "review",
      source: "acme/private",
      path: "skills/review/SKILL.md",
    });
    assert.match(text, /Installed \*\*review\*\*/);
    assert.deepStrictEqual(calls.install.map((r) => r.source), ["acme/private"]);
  });

  await test("install: a partial name is never installed", async () => {
    const text = await run("resourceNinja_install", { resourceName: "helper" });
    assert.match(text, /not found/);
    assert.match(text, /solo-helper/);
    assert.strictEqual(calls.install.length, 0);
  });

  await test("install: an existing destination is not overwritten without consent", async () => {
    existingPaths.add("/ws/.github/skills/solo-helper");
    const refused = await run("resourceNinja_install", { resourceName: "solo-helper" });
    assert.match(refused, /already exists/);
    assert.strictEqual(calls.install.length, 0);
    const allowed = await run("resourceNinja_install", {
      resourceName: "solo-helper",
      overwrite: true,
    });
    assert.match(allowed, /Installed \*\*solo-helper\*\*/);
    assert.strictEqual(calls.install.length, 1);
  });

  await test("install: a success report without the written file is a failure", async () => {
    // The stub only records the file for installs; remove it again to simulate a lost write.
    const original = existingPaths.add.bind(existingPaths);
    existingPaths.add = () => existingPaths;
    try {
      const text = await run("resourceNinja_install", { resourceName: "solo-helper" });
      assert.match(text, /expected file was not found/);
    } finally {
      existingPaths.add = original;
    }
  });

  await test("install: non-string input is ignored, not coerced", async () => {
    const text = await run("resourceNinja_install", { resourceName: 42 });
    assert.match(text, /resourceName is required/);
    assert.strictEqual(calls.install.length, 0);
  });

  await test("uninstall: a same-name pair deletes nothing until a path is given", async () => {
    const text = await run("resourceNinja_uninstall", { resourceName: "review" });
    assert.match(text, /Multiple workspace resources match/);
    assert.strictEqual(calls.uninstall.length, 0);
    await run("resourceNinja_uninstall", {
      resourceName: "review",
      path: ".claude\\skills\\review\\SKILL.md",
    });
    assert.deepStrictEqual(calls.uninstall, [".claude/skills/review/SKILL.md"]);
  });

  await test("uninstall: a partial name deletes nothing", async () => {
    const text = await run("resourceNinja_uninstall", { resourceName: "helper" });
    assert.match(text, /Nothing was removed/);
    assert.strictEqual(calls.uninstall.length, 0);
  });

  await test("localize: a same-name pair is not edited until source and path are given", async () => {
    const refused = await run("resourceNinja_localize", {
      resourceName: "review",
      description_ja: "レビュー",
    });
    assert.match(refused, /Multiple resources match/);
    assert.strictEqual(calls.save.length, 0);
    assert.strictEqual(resources[0].description_ja, undefined);
    assert.strictEqual(resources[1].description_ja, undefined);

    await run("resourceNinja_localize", {
      resourceName: "review",
      source: "acme/private",
      path: "skills/review/SKILL.md",
      description_ja: "レビュー",
    });
    assert.strictEqual(resources[0].description_ja, undefined);
    assert.strictEqual(resources[1].description_ja, "レビュー");
  });

  await test("install: a partial name with disagreeing ids is 'not found', not 'multiple'", async () => {
    const text = await run("resourceNinja_install", {
      resourceName: "review-x",
      path: "skills/other",
    });
    assert.doesNotMatch(text, /Multiple resources match/);
    assert.match(text, /not found/);
    assert.strictEqual(calls.install.length, 0);
  });

  await test("an unknown kind stops every writing tool instead of widening the target", async () => {
    for (const name of [
      "resourceNinja_install",
      "resourceNinja_uninstall",
      "resourceNinja_localize",
    ]) {
      const text = await run(name, {
        resourceName: "solo-helper",
        kind: "agents",
        description_ja: "x",
      });
      assert.match(text, /Unknown kind "agents"/, name);
    }
    assert.strictEqual(calls.install.length, 0);
    assert.strictEqual(calls.uninstall.length, 0);
    assert.strictEqual(calls.save.length, 0);
  });

  await test("uninstall: the absolute path and a SKILL.md path select the same resource", async () => {
    await run("resourceNinja_uninstall", {
      resourceName: "solo-helper",
      path: "/ws/.github/skills/solo-helper",
    });
    await run("resourceNinja_uninstall", {
      resourceName: "solo-helper",
      path: ".github/skills/solo-helper/SKILL.md",
    });
    assert.deepStrictEqual(calls.uninstall, [
      ".github/skills/solo-helper/SKILL.md",
      ".github/skills/solo-helper/SKILL.md",
    ]);
  });

  if (failures > 0) {
    console.error(`${failures} test(s) failed`);
    process.exit(1);
  }
})();
