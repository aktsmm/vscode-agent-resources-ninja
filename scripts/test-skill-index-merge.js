#!/usr/bin/env node

const assert = require("assert");

function mergeSkillIndexes(localIndex, bundledIndex) {
  const localCategories = localIndex.categories || [];
  const localBundles = localIndex.bundles || [];
  const bundledCategories = bundledIndex.categories || [];
  const bundledBundles = bundledIndex.bundles || [];
  const localSourceIds = new Set(localIndex.sources.map((source) => source.id));
  const localCategoryIds = new Set(
    localCategories.map((category) => category.id),
  );
  const localBundleKeys = new Set(
    localBundles.map((bundle) => `${bundle.source}:${bundle.id}`),
  );

  const newSources = bundledIndex.sources.filter(
    (source) => !localSourceIds.has(source.id),
  );
  const newCategories = bundledCategories.filter(
    (category) => !localCategoryIds.has(category.id),
  );
  const newBundles = bundledBundles.filter(
    (bundle) => !localBundleKeys.has(`${bundle.source}:${bundle.id}`),
  );

  const updatedSources = localIndex.sources.map((localSource) => {
    const bundledSource = bundledIndex.sources.find(
      (source) => source.id === localSource.id,
    );
    if (!bundledSource) {
      return localSource;
    }

    return {
      ...localSource,
      ...bundledSource,
      description_ja:
        bundledSource.description_ja || localSource.description_ja,
    };
  });

  const updatedCategories = localCategories.map((localCategory) => {
    const bundledCategory = bundledCategories.find(
      (category) => category.id === localCategory.id,
    );
    if (!bundledCategory) {
      return localCategory;
    }

    return {
      ...localCategory,
      ...bundledCategory,
      name_ja: bundledCategory.name_ja || localCategory.name_ja,
      description_ja:
        bundledCategory.description_ja || localCategory.description_ja,
    };
  });

  const localSkillKeys = new Set(
    localIndex.skills.map((skill) => `${skill.source}:${skill.name}`),
  );
  const newSkills = bundledIndex.skills.filter(
    (skill) => !localSkillKeys.has(`${skill.source}:${skill.name}`),
  );

  const updatedSkills = localIndex.skills.map((localSkill) => {
    const bundledSkill = bundledIndex.skills.find(
      (skill) =>
        skill.name === localSkill.name && skill.source === localSkill.source,
    );
    if (!bundledSkill) {
      return localSkill;
    }

    return {
      ...localSkill,
      ...bundledSkill,
      description_ja: bundledSkill.description_ja || localSkill.description_ja,
      requires:
        bundledSkill.requires && bundledSkill.requires.length > 0
          ? bundledSkill.requires
          : localSkill.requires,
      categories:
        bundledSkill.categories.length > 0
          ? bundledSkill.categories
          : localSkill.categories,
      standalone: bundledSkill.standalone ?? localSkill.standalone,
      bundle: bundledSkill.bundle || localSkill.bundle,
      license: bundledSkill.license || localSkill.license,
      author: bundledSkill.author || localSkill.author,
      version: bundledSkill.version || localSkill.version,
    };
  });

  const updatedBundles = localBundles.map((localBundle) => {
    const bundledBundle = bundledBundles.find(
      (bundle) =>
        bundle.id === localBundle.id && bundle.source === localBundle.source,
    );
    if (!bundledBundle) {
      return localBundle;
    }

    return {
      ...localBundle,
      ...bundledBundle,
      description_ja:
        bundledBundle.description_ja || localBundle.description_ja,
    };
  });

  return {
    ...localIndex,
    version: bundledIndex.version,
    lastUpdated: bundledIndex.lastUpdated,
    sources: [...updatedSources, ...newSources],
    categories: [...updatedCategories, ...newCategories],
    skills: [...updatedSkills, ...newSkills],
    bundles:
      updatedBundles.length > 0 || newBundles.length > 0
        ? [...updatedBundles, ...newBundles]
        : localIndex.bundles,
  };
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

console.log("RESULT=PASS");
