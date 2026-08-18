#!/usr/bin/env node

// Exercises the real mergeSkillIndexes from src so this test cannot drift from it.

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

const { mergeSkillIndexes } = requireTypeScriptModule(
  path.join(__dirname, "..", "src", "skillIndex.ts"),
  {
    vscode: {
      Uri: { joinPath: (base, ...segments) => ({ base, segments }) },
      workspace: { fs: {} },
      env: { language: "en" },
    },
    "./gitHubRefSafety": requireTypeScriptModule(
      path.join(__dirname, "..", "src", "gitHubRefSafety.ts"),
    ),
    "./githubFetch": {
      fetchGitHubWithOptionalAuthRetry: async () => undefined,
    },
    "./logger": {
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    },
    "./sharedResourceIndexStore": {
      loadSharedStoresIntoSkillIndex: async (_context, index) => index,
      syncSharedStoresFromSkillIndex: async () => undefined,
    },
  },
);

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("merge keeps bundled metadata and structural additions", () => {
  const localIndex = {
    version: "1.0.0",
    lastUpdated: "2026-03-01",
    sources: [
      {
        id: "microsoftdocs-agent-skills",
        name: "Old source",
        url: "https://github.com/MicrosoftDocs/Agent-Skills",
        type: "official",
        description: "old",
      },
    ],
    categories: [
      {
        id: "official",
        name: "Official",
        description: "old category",
      },
    ],
    skills: [
      {
        name: "azure-api-management",
        source: "microsoftdocs-agent-skills",
        path: "skills/azure-api-management",
        categories: ["official"],
        description: "old description",
      },
    ],
    bundles: [
      {
        id: "azure-core",
        name: "Azure Core",
        source: "microsoftdocs-agent-skills",
        description: "old bundle",
        skills: ["azure-api-management"],
      },
    ],
  };

  const bundledIndex = {
    version: "1.1.0",
    lastUpdated: "2026-03-10",
    sources: [
      {
        id: "microsoftdocs-agent-skills",
        name: "MicrosoftDocs Agent Skills (Official)",
        url: "https://github.com/MicrosoftDocs/Agent-Skills",
        type: "official",
        branch: "main",
        description: "new source",
        description_ja: "新ソース",
      },
      {
        id: "new-source",
        name: "New Source",
        url: "https://github.com/example/new-source",
        type: "community",
        description: "new source entry",
      },
    ],
    categories: [
      {
        id: "official",
        name: "Official",
        name_ja: "公式",
        description: "new category",
        description_ja: "新カテゴリ",
      },
      {
        id: "azure",
        name: "Azure",
        description: "Azure services",
      },
    ],
    skills: [
      {
        name: "azure-api-management",
        source: "microsoftdocs-agent-skills",
        path: "skills/azure-api-management",
        categories: ["official", "azure"],
        description: "new description",
        description_ja: "新説明",
        standalone: false,
        requires: ["azure-architecture"],
        bundle: "azure-core",
        license: "MIT",
        author: "Microsoft",
        version: "2.0.0",
      },
      {
        name: "new-skill",
        source: "new-source",
        path: "skills/new-skill",
        categories: ["azure"],
        description: "brand new",
      },
    ],
    bundles: [
      {
        id: "azure-core",
        name: "Azure Core",
        source: "microsoftdocs-agent-skills",
        description: "new bundle",
        description_ja: "新バンドル",
        skills: ["azure-api-management"],
        installOrder: ["azure-api-management"],
      },
    ],
  };

  const merged = mergeSkillIndexes(localIndex, bundledIndex);
  const mergedSkill = merged.skills.find(
    (skill) => skill.name === "azure-api-management",
  );

  assert.strictEqual(merged.version, "1.1.0");
  assert.strictEqual(merged.lastUpdated, "2026-03-10");
  assert.strictEqual(merged.sources.length, 2);
  assert.strictEqual(merged.categories.length, 2);
  assert.strictEqual(merged.bundles.length, 1);
  assert.strictEqual(mergedSkill.description_ja, "新説明");
  assert.deepStrictEqual(mergedSkill.categories, ["official", "azure"]);
  assert.strictEqual(mergedSkill.standalone, false);
  assert.deepStrictEqual(mergedSkill.requires, ["azure-architecture"]);
  assert.strictEqual(mergedSkill.bundle, "azure-core");
  assert.strictEqual(mergedSkill.license, "MIT");
  assert.strictEqual(mergedSkill.author, "Microsoft");
  assert.strictEqual(mergedSkill.version, "2.0.0");
  assert.strictEqual(merged.bundles[0].description_ja, "新バンドル");
});

test("merge adds new skills from existing sources", () => {
  const localIndex = {
    version: "1.0.0",
    lastUpdated: "2026-03-01",
    sources: [
      {
        id: "microsoftdocs-agent-skills",
        name: "MicrosoftDocs Agent Skills (Official)",
        url: "https://github.com/MicrosoftDocs/Agent-Skills",
        type: "official",
        description: "old source",
      },
    ],
    categories: [],
    skills: [
      {
        name: "azure-api-management",
        source: "microsoftdocs-agent-skills",
        path: "skills/azure-api-management",
        categories: [],
        description: "old skill",
      },
    ],
    bundles: [],
  };

  const bundledIndex = {
    version: "1.1.0",
    lastUpdated: "2026-03-10",
    sources: [
      {
        id: "microsoftdocs-agent-skills",
        name: "MicrosoftDocs Agent Skills (Official)",
        url: "https://github.com/MicrosoftDocs/Agent-Skills",
        type: "official",
        description: "new source",
      },
    ],
    categories: [],
    skills: [
      {
        name: "azure-api-management",
        source: "microsoftdocs-agent-skills",
        path: "skills/azure-api-management",
        categories: [],
        description: "updated skill",
      },
      {
        name: "azure-architecture",
        source: "microsoftdocs-agent-skills",
        path: "skills/azure-architecture",
        categories: ["official"],
        description: "new bundled skill",
      },
    ],
    bundles: [],
  };

  const merged = mergeSkillIndexes(localIndex, bundledIndex);
  const newSkill = merged.skills.find(
    (skill) => skill.name === "azure-architecture",
  );

  assert.strictEqual(merged.skills.length, 2);
  assert(newSkill, "Expected bundled new skill to be merged");
  assert.strictEqual(newSkill.description, "new bundled skill");
  assert.deepStrictEqual(newSkill.categories, ["official"]);
});

test("merge tolerates legacy indexes without categories or bundles", () => {
  const localIndex = {
    version: "1.0.0",
    lastUpdated: "2026-03-01",
    sources: [
      {
        id: "legacy-source",
        name: "Legacy Source",
        url: "https://github.com/example/legacy-source",
        type: "community",
        description: "legacy source",
      },
    ],
    skills: [
      {
        name: "legacy-skill",
        source: "legacy-source",
        path: "skills/legacy-skill",
        categories: [],
        description: "legacy description",
      },
    ],
  };

  const bundledIndex = {
    version: "1.1.0",
    lastUpdated: "2026-03-10",
    sources: [
      {
        id: "legacy-source",
        name: "Legacy Source",
        url: "https://github.com/example/legacy-source",
        type: "community",
        description: "bundled source",
        description_ja: "バンドル済みソース",
      },
    ],
    categories: [
      {
        id: "utility",
        name: "Utility",
        description: "Utility skills",
      },
    ],
    skills: [
      {
        name: "legacy-skill",
        source: "legacy-source",
        path: "skills/legacy-skill",
        categories: ["utility"],
        description: "bundled description",
      },
    ],
    bundles: [
      {
        id: "legacy-bundle",
        name: "Legacy Bundle",
        source: "legacy-source",
        description: "bundle",
        skills: ["legacy-skill"],
      },
    ],
  };

  const merged = mergeSkillIndexes(localIndex, bundledIndex);

  assert.strictEqual(merged.categories.length, 1);
  assert.strictEqual(merged.bundles.length, 1);
  assert.deepStrictEqual(merged.skills[0].categories, ["utility"]);
});

test("the bundled preset does not overwrite runtime-resolved repository facts", () => {
  const localIndex = {
    version: "1.0.0",
    lastUpdated: "2026-03-01",
    sources: [
      {
        id: "acme-demo",
        name: "Acme Demo",
        url: "https://github.com/acme/demo",
        type: "community",
        repoId: 4242,
        lastIndexedAt: "2026-08-01T00:00:00.000Z",
        description: "local",
      },
    ],
    categories: [],
    skills: [],
    bundles: [],
  };

  const bundledIndex = {
    version: "1.1.0",
    lastUpdated: "2026-03-10",
    sources: [
      {
        id: "acme-demo",
        name: "Acme Demo (curated)",
        url: "https://github.com/acme/demo",
        type: "community",
        description: "curated",
        description_ja: "キュレーション済み",
      },
    ],
    categories: [],
    skills: [],
    bundles: [],
  };

  const merged = mergeSkillIndexes(localIndex, bundledIndex);
  const mergedSource = merged.sources[0];

  assert.strictEqual(mergedSource.repoId, 4242);
  assert.strictEqual(mergedSource.lastIndexedAt, "2026-08-01T00:00:00.000Z");
  assert.strictEqual(mergedSource.name, "Acme Demo (curated)");
  assert.strictEqual(mergedSource.description_ja, "キュレーション済み");
});

test("a followed rename survives the bundled preset, but an unverified source takes the preset URL", () => {
  const bundledSources = [
    {
      id: "acme-demo",
      name: "Acme Demo",
      url: "https://github.com/acme/old-name",
      type: "community",
      description: "curated",
    },
  ];
  const makeIndex = (sources) => ({
    version: "1.0.0",
    lastUpdated: "2026-03-01",
    sources,
    categories: [],
    skills: [],
    bundles: [],
  });

  const verified = mergeSkillIndexes(
    makeIndex([
      {
        id: "acme-demo",
        name: "Acme Demo",
        url: "https://github.com/acme/new-name",
        type: "community",
        repoId: 4242,
        description: "local",
      },
    ]),
    { ...makeIndex(bundledSources), version: "1.1.0" },
  );
  assert.strictEqual(
    verified.sources[0].url,
    "https://github.com/acme/new-name",
    "a scan-followed rename must not be reverted by the bundled preset",
  );

  const unverified = mergeSkillIndexes(
    makeIndex([
      {
        id: "acme-demo",
        name: "Acme Demo",
        url: "https://github.com/acme/stale",
        type: "community",
        description: "local",
      },
    ]),
    { ...makeIndex(bundledSources), version: "1.1.0" },
  );
  assert.strictEqual(
    unverified.sources[0].url,
    "https://github.com/acme/old-name",
    "a source without a recorded identity should take the bundled preset URL",
  );
});

test("a retired preset source is dropped only when it has no resources left", () => {
  const localIndex = {
    version: "1.0.0",
    lastUpdated: "2026-03-01",
    sources: [
      {
        id: "retired-empty",
        name: "Retired Empty",
        url: "https://github.com/acme/retired-empty",
        type: "official",
        description: "retired",
      },
      {
        id: "retired-with-resources",
        name: "Retired With Resources",
        url: "https://github.com/acme/retired-with-resources",
        type: "official",
        description: "retired",
      },
      {
        id: "retired-with-bundle",
        name: "Retired With Bundle",
        url: "https://github.com/acme/retired-with-bundle",
        type: "official",
        description: "retired",
      },
      {
        id: "user-empty",
        name: "User Empty",
        url: "https://github.com/acme/user-empty",
        type: "user-added",
        description: "user",
      },
    ],
    categories: [],
    skills: [
      {
        name: "kept-skill",
        source: "retired-with-resources",
        path: "skills/kept-skill",
        categories: [],
        description: "kept",
      },
    ],
    bundles: [
      {
        id: "kept-bundle",
        name: "Kept Bundle",
        source: "retired-with-bundle",
        description: "bundle",
        skills: [],
      },
    ],
  };

  const bundledIndex = {
    version: "1.1.0",
    lastUpdated: "2026-03-10",
    sources: [],
    categories: [],
    skills: [],
    bundles: [],
  };

  const merged = mergeSkillIndexes(localIndex, bundledIndex);

  assert.deepStrictEqual(
    Array.from(merged.sources.map((source) => source.id)),
    ["retired-with-resources", "retired-with-bundle", "user-empty"],
    "only a retired preset source without resources or bundles should be dropped",
  );
});

test("a retired preset source is consolidated only for resources the successor already ships", () => {
  const localIndex = {
    version: "1.0.0",
    lastUpdated: "2026-03-01",
    sources: [
      {
        id: "microsoft-copilot-for-azure-plugin",
        name: "Retired Azure Plugin",
        url: "https://github.com/microsoft/GitHub-Copilot-for-Azure",
        type: "official",
        description: "retired",
      },
      {
        id: "microsoft-azure-skills",
        name: "Microsoft Azure Skills",
        url: "https://github.com/microsoft/azure-skills",
        type: "official",
        description: "canonical",
      },
    ],
    categories: [],
    skills: [
      {
        name: "azure-quota",
        source: "microsoft-copilot-for-azure-plugin",
        path: "plugin/skills/azure-quota",
        categories: [],
        description: "duplicated by the successor",
      },
      {
        name: "legacy-only",
        source: "microsoft-copilot-for-azure-plugin",
        path: "plugin/skills/legacy-only",
        categories: [],
        description: "no successor counterpart",
      },
      {
        name: "azure-quota",
        source: "microsoft-azure-skills",
        path: "skills/azure-quota",
        categories: [],
        description: "canonical copy",
      },
    ],
    bundles: [],
  };

  const bundledIndex = {
    version: "1.1.0",
    lastUpdated: "2026-03-10",
    sources: [localIndex.sources[1]],
    categories: [],
    skills: [localIndex.skills[2]],
    bundles: [],
  };

  const merged = mergeSkillIndexes(localIndex, bundledIndex);

  assert.deepStrictEqual(
    Array.from(
      merged.skills.map((skill) => `${skill.source}:${skill.name}`),
    ).sort(),
    [
      "microsoft-azure-skills:azure-quota",
      "microsoft-copilot-for-azure-plugin:legacy-only",
    ],
    "only the resource the successor already ships should be dropped",
  );
  assert.deepStrictEqual(
    Array.from(merged.sources.map((source) => source.id)),
    ["microsoft-copilot-for-azure-plugin", "microsoft-azure-skills"],
    "a retired source that still holds an exclusive resource must stay",
  );
});

test("a retired source id owned by a user-added source is never consolidated", () => {
  const localIndex = {
    version: "1.0.0",
    lastUpdated: "2026-03-01",
    sources: [
      {
        id: "microsoft-copilot-for-azure-plugin",
        name: "My Fork",
        url: "https://github.com/acme/my-fork",
        type: "user-added",
        description: "user",
      },
      {
        id: "microsoft-azure-skills",
        name: "Microsoft Azure Skills",
        url: "https://github.com/microsoft/azure-skills",
        type: "official",
        description: "canonical",
      },
    ],
    categories: [],
    skills: [
      {
        name: "azure-quota",
        source: "microsoft-copilot-for-azure-plugin",
        path: "skills/azure-quota",
        categories: [],
        description: "user copy",
      },
      {
        name: "azure-quota",
        source: "microsoft-azure-skills",
        path: "skills/azure-quota",
        categories: [],
        description: "canonical copy",
      },
    ],
    bundles: [],
  };

  const bundledIndex = {
    version: "1.1.0",
    lastUpdated: "2026-03-10",
    sources: [localIndex.sources[1]],
    categories: [],
    skills: [localIndex.skills[1]],
    bundles: [],
  };

  const merged = mergeSkillIndexes(localIndex, bundledIndex);

  assert.strictEqual(merged.skills.length, 2);
  assert.deepStrictEqual(
    Array.from(merged.sources.map((source) => source.id)),
    ["microsoft-copilot-for-azure-plugin", "microsoft-azure-skills"],
  );
});

test("the local scan timestamp survives a merge", () => {
  const makeIndex = (extra) => ({
    version: "1.0.0",
    lastUpdated: "2026-03-01",
    sources: [],
    categories: [],
    skills: [],
    bundles: [],
    ...extra,
  });

  const merged = mergeSkillIndexes(
    makeIndex({ lastScannedAt: "2026-08-17T04:05:06.000Z" }),
    makeIndex({ version: "1.1.0", lastUpdated: "2026-03-10" }),
  );

  assert.strictEqual(merged.lastScannedAt, "2026-08-17T04:05:06.000Z");
  assert.strictEqual(merged.lastUpdated, "2026-03-10");
});

console.log("RESULT=PASS");
