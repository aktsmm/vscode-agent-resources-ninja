#!/usr/bin/env node

// Invocation modes (disable-model-invocation / user-invocable) decide which skills a user can
// find with the Filter and Sort picker. Both pure modules load without stubs, so the real
// implementation is exercised directly. The User-Global provider case pins that the visible
// list, its counts, and group actions all see the same filtered set.

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");

function requireTypeScriptModule(filePath, stubs = {}) {
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filePath,
  }).outputText;
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
    loadedModule._compile(transpiled, filePath);
  } finally {
    Module._load = originalLoad;
  }
  return loadedModule.exports;
}

const modeModule = requireTypeScriptModule(
  path.join(repoRoot, "src", "skillInvocationMode.ts"),
);
const optionsModule = requireTypeScriptModule(
  path.join(repoRoot, "src", "skillListOptions.ts"),
  { "./skillInvocationMode": modeModule },
);
const resourceKindsModule = requireTypeScriptModule(
  path.join(repoRoot, "src", "resourceKinds.ts"),
);

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

const wrap = (...lines) => `---\nname: a\n${lines.join("\n")}\n---\n\n# A\n`;

test("each frontmatter key maps to its own invocation mode", () => {
  const read = modeModule.readSkillInvocationFromText;
  assert.strictEqual(read(wrap()), "auto");
  assert.strictEqual(
    read(wrap("disable-model-invocation: true")),
    "explicitOnly",
  );
  assert.strictEqual(read(wrap("user-invocable: false")), "modelOnly");
  assert.strictEqual(read(wrap("disable-model-invocation: false")), "auto");
  assert.strictEqual(read(wrap("user-invocable: true")), "auto");
});

test("manual-only wins when both keys are set", () => {
  assert.strictEqual(
    modeModule.readSkillInvocationFromText(
      wrap("user-invocable: false", "disable-model-invocation: true"),
    ),
    "explicitOnly",
  );
});

test("quotes, trailing comments, CRLF and a BOM are tolerated", () => {
  const read = modeModule.readSkillInvocationFromText;
  assert.strictEqual(
    read(wrap('disable-model-invocation: "True"')),
    "explicitOnly",
  );
  assert.strictEqual(
    read(wrap("user-invocable: false # hidden from the menu")),
    "modelOnly",
  );
  assert.strictEqual(
    read("---\r\nname: a\r\ndisable-model-invocation: true\r\n---\r\n"),
    "explicitOnly",
  );
  assert.strictEqual(
    read(`\uFEFF${wrap("user-invocable: false")}`),
    "modelOnly",
  );
});

test("only top-level frontmatter keys count", () => {
  const read = modeModule.readSkillInvocationFromText;
  assert.strictEqual(
    read("# A\ndisable-model-invocation: true\n"),
    "auto",
    "a key outside the frontmatter is body text",
  );
  assert.strictEqual(
    read("---\nname: a\nmetadata:\n  user-invocable: false\n---\n"),
    "auto",
    "an indented key belongs to another mapping",
  );
  assert.strictEqual(
    read("---\nname: a\ndescription: |\n  user-invocable: false\n---\n"),
    "auto",
    "a block scalar is not the flag",
  );
  assert.strictEqual(
    read("---\nname: a\nuser-invocable: false\n"),
    "auto",
    "an unterminated frontmatter is not read",
  );
});

test("parsed index values resolve with the same rule as the local scan", () => {
  const resolve = modeModule.resolveSkillInvocationFromValues;
  assert.strictEqual(resolve({}), "auto");
  assert.strictEqual(
    resolve({ disableModelInvocation: "true" }),
    "explicitOnly",
  );
  assert.strictEqual(resolve({ userInvocable: "false" }), "modelOnly");
  assert.strictEqual(
    resolve({ disableModelInvocation: "true", userInvocable: "false" }),
    "explicitOnly",
  );
  assert.strictEqual(resolve({ disableModelInvocation: "maybe" }), "auto");
});

test("context accepts only fork", () => {
  assert.strictEqual(modeModule.parseSkillExecutionContext("fork"), "fork");
  assert.strictEqual(modeModule.parseSkillExecutionContext(" Fork "), "fork");
  assert.strictEqual(modeModule.parseSkillExecutionContext("inline"), undefined);
  assert.strictEqual(modeModule.parseSkillExecutionContext(undefined), undefined);
  // A cached or shared index is untrusted, so a non-string must not throw.
  for (const hostile of [5, {}, [], true, null]) {
    assert.strictEqual(modeModule.parseSkillExecutionContext(hostile), undefined);
  }
});

test("an argument hint is bounded, single-line, and never a non-string", () => {
  const normalize = modeModule.normalizeArgumentHint;
  assert.strictEqual(normalize("  [topic] | [mode]  "), "[topic] | [mode]");
  assert.strictEqual(normalize("a\nb\tc\r\nd"), "a b c d");
  assert.strictEqual(normalize("x".repeat(5000)).length, 200);
  assert.strictEqual(normalize(""), undefined);
  assert.strictEqual(normalize(" \n\t "), undefined);
  for (const hostile of [5, {}, [], true, null, undefined]) {
    assert.strictEqual(normalize(hostile), undefined);
  }
  // The rule is idempotent, so a stored value does not change on the next pass.
  const once = normalize("x\n".repeat(500));
  assert.strictEqual(normalize(once), once);
});

test("every bundled argument hint is already in its normalized form", () => {
  const index = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "resources", "skill-index.json"), "utf8"),
  );
  const drifted = index.skills
    .filter((skill) => skill.argumentHint !== undefined)
    .filter(
      (skill) => modeModule.normalizeArgumentHint(skill.argumentHint) !== skill.argumentHint,
    )
    .map((skill) => `${skill.source}/${skill.path}`);
  assert.deepStrictEqual(
    drifted,
    [],
    "regenerating the catalog would change these hints; store the normalized value",
  );
});

test("labels and icons distinguish the two restricted modes", () => {
  assert.strictEqual(modeModule.getInvocationLabelText("explicitOnly", true), "手動専用");
  assert.strictEqual(modeModule.getInvocationLabelText("modelOnly", false), "Model only");
  assert.strictEqual(modeModule.getInvocationLabelText(undefined, false), "Auto");
  assert.strictEqual(modeModule.getInvocationIconId("explicitOnly", "x"), "play-circle");
  assert.strictEqual(modeModule.getInvocationIconId("modelOnly", "x"), "hubot");
  assert.strictEqual(modeModule.getInvocationIconId("auto", "x"), "x");
  assert.strictEqual(modeModule.normalizeSkillInvocation("bogus"), "auto");
});

const catalog = [
  { name: "zeta", kind: "skill", invocation: "auto", stars: 5 },
  { name: "alpha", kind: "skill", invocation: "explicitOnly", stars: 1 },
  { name: "mid", kind: "skill", invocation: "modelOnly", stars: 9 },
  { name: "agent-one", kind: "agent" },
  { name: "unknown", kind: "skill" },
];

test("the filter narrows skills and always keeps other kinds", () => {
  const names = (filter) =>
    optionsModule
      .filterSkillsByInvocation(catalog, filter)
      .map((resource) => resource.name);
  assert.deepStrictEqual(names("all"), catalog.map((resource) => resource.name));
  assert.deepStrictEqual(names("explicitOnly"), ["alpha", "agent-one"]);
  assert.deepStrictEqual(names("modelOnly"), ["mid", "agent-one"]);
  assert.deepStrictEqual(
    names("auto"),
    ["zeta", "agent-one", "unknown"],
    "an entry with no stored mode is a plain skill",
  );
});

test("sort modes order the list without mutating the input", () => {
  const snapshot = catalog.map((resource) => resource.name);
  const names = (mode) =>
    optionsModule.sortSkills(catalog, mode).map((resource) => resource.name);
  assert.deepStrictEqual(names("default"), snapshot);
  assert.deepStrictEqual(names("name"), [
    "agent-one",
    "alpha",
    "mid",
    "unknown",
    "zeta",
  ]);
  assert.deepStrictEqual(names("stars"), [
    "mid",
    "zeta",
    "alpha",
    "agent-one",
    "unknown",
  ]);
  assert.deepStrictEqual(names("invocation"), [
    "alpha",
    "mid",
    "agent-one",
    "unknown",
    "zeta",
  ]);
  assert.deepStrictEqual(catalog.map((resource) => resource.name), snapshot);
});

test("an index with no stored mode is reported as lacking data", () => {
  assert.strictEqual(
    optionsModule.hasInvocationData([{ name: "a", kind: "skill" }]),
    false,
  );
  assert.strictEqual(
    optionsModule.hasInvocationData([
      { name: "a", kind: "skill", invocation: "auto" },
    ]),
    true,
    "auto is stored data, not a missing value",
  );
  assert.strictEqual(
    optionsModule.hasInvocationData([
      { name: "a", kind: "agent", invocation: "auto" },
    ]),
    false,
    "only skills carry the mode",
  );
});

test("saved options normalize and sort modes are scoped to the view", () => {
  assert.strictEqual(optionsModule.normalizeInvocationFilter("nope"), "all");
  assert.strictEqual(
    optionsModule.normalizeInvocationFilter("modelOnly"),
    "modelOnly",
  );
  assert.deepStrictEqual(Array.from(optionsModule.getSortModes("local")), [
    "default",
    "name",
    "invocation",
  ]);
  assert.deepStrictEqual(Array.from(optionsModule.getSortModes("browse")), [
    "default",
    "name",
    "stars",
  ]);
  assert.strictEqual(
    optionsModule.normalizeSortMode(
      "stars",
      optionsModule.getSortModes("local"),
    ),
    "default",
    "stars is Browse-only",
  );
  assert.strictEqual(
    optionsModule.isViewOptionsActive({ filter: "all", sort: "default" }),
    false,
  );
  assert.strictEqual(
    optionsModule.isViewOptionsActive({ filter: "all", sort: "name" }),
    true,
  );
});

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

function createUserProvider() {
  const vscodeStub = {
    TreeItem,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: class ThemeIcon {
      constructor(id) {
        this.id = id;
      }
    },
    ThemeColor: class ThemeColor {},
    EventEmitter: class EventEmitter {
      event() {}
      fire() {}
    },
    Uri: { file: (fsPath) => ({ fsPath }) },
    workspace: { getConfiguration: () => ({ get: () => false }) },
  };
  const providerModule = requireTypeScriptModule(
    path.join(repoRoot, "src", "userResourcesProvider.ts"),
    {
      vscode: vscodeStub,
      "./skillIndex": {
        getResourceKindIcon: () => "file",
        getResourceKindLabel: (kind) => kind,
      },
      "./userResourceScanner": { scanUserResources: async () => [] },
      "./i18n": { isJapanese: () => false },
      "./resourceKinds": {
        getPluginIdFromPath: () => undefined,
        getResourceIdentityKeys: () => [],
        isHookConfigFilePath: () => false,
        mapContainedSkillParents: resourceKindsModule.mapContainedSkillParents,
      },
      "./mcpConfigManager": {
        formatMcpLifecycleLabel: () => "",
        formatMcpLifecycleTooltipLines: () => [],
        getMcpConfigLifecycleStatus: async () => ({}),
      },
      "./hookConfigManager": {
        getHookConfigDiagnostics: async () => ({ eventCounts: {} }),
      },
      "./skillInvocationMode": modeModule,
      "./skillListOptions": optionsModule,
    },
  );
  const rootFsPath = "C:\\Users\\Demo\\.copilot";
  const make = (name, kind, invocation) => ({
    kind,
    name,
    description: "",
    categories: [],
    relativePath: `${kind}s/${name}/SKILL.md`,
    fullPath: path.join(rootFsPath, `${kind}s`, name, "SKILL.md"),
    scope: "globalHome",
    scopeLabel: "Global Resource Home",
    tool: "Copilot",
    rootLabel: "Global Resource Home",
    rootFsPath,
    ...(invocation ? { invocation } : {}),
  });
  const provider = new providerModule.UserResourcesProvider(undefined);
  provider.resources = [
    make("manual", "skill", "explicitOnly"),
    make("model", "skill", "modelOnly"),
    make("plain", "skill", "auto"),
    make("helper", "agent"),
  ];
  provider.hasLoaded = true;
  return { provider, providerModule, rootFsPath };
}

test("the User-Global view, its counts, and group actions share one filtered set", async () => {
  const { provider, providerModule, rootFsPath } = createUserProvider();
  const skillGroup = new providerModule.UserResourceTreeItem(
    "skill",
    "",
    1,
    "kind",
    undefined,
    "globalHome",
    "skill",
    "Global Resource Home",
    undefined,
    undefined,
    rootFsPath,
  );
  const scopeItem = new providerModule.UserResourceTreeItem(
    "Global Resource Home",
    "",
    1,
    "scope",
    undefined,
    "globalHome",
    undefined,
    "Global Resource Home",
    undefined,
    undefined,
    rootFsPath,
  );

  try {
    optionsModule.setSkillViewOptions("local", {
      filter: "explicitOnly",
      sort: "default",
    });

    const kinds = await provider.getChildren(scopeItem);
    assert.deepStrictEqual(
      kinds.map((item) => `${item.label}:${item.description}`),
      ["skill:1 resources", "agent:1 resources"],
      "the skill count follows the filter and the agent group is untouched",
    );

    const children = await provider.getChildren(skillGroup);
    assert.deepStrictEqual(
      children.map((item) => item.label),
      ["manual"],
    );
    assert.match(children[0].description, /Manual only/);
    assert.strictEqual(children[0].iconPath.id, "play-circle");

    const targets = await provider.resolveCurrentGroupResources(skillGroup);
    assert.deepStrictEqual(
      targets.map((entry) => entry.name),
      ["manual"],
      "a group action must not reach skills the filter hides",
    );

    optionsModule.setSkillViewOptions("local", {
      filter: "modelOnly",
      sort: "name",
    });
    assert.deepStrictEqual(
      (await provider.getChildren(skillGroup)).map((item) => item.label),
      ["model"],
    );

    optionsModule.setSkillViewOptions("local", {
      filter: "all",
      sort: "invocation",
    });
    assert.deepStrictEqual(
      (await provider.getChildren(skillGroup)).map((item) => item.label),
      ["manual", "model", "plain"],
    );
  } finally {
    optionsModule.setSkillViewOptions("local", { filter: "all", sort: "default" });
  }
});

test("a filter that hides every resource explains itself instead of reporting none installed", async () => {
  const { provider } = createUserProvider();
  provider.resources = provider.resources.filter(
    (resource) => resource.kind === "skill" && resource.invocation === "auto",
  );
  try {
    optionsModule.setSkillViewOptions("local", {
      filter: "explicitOnly",
      sort: "default",
    });
    const root = await provider.getChildren();
    assert.strictEqual(root.length, 1);
    assert.strictEqual(root[0].contextValue, "placeholder");
    assert.match(root[0].label, /No skills match the filter/);
  } finally {
    optionsModule.setSkillViewOptions("local", { filter: "all", sort: "default" });
  }
});

function createTreeProviders() {
  const vscodeStub = {
    TreeItem,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: class ThemeIcon {
      constructor(id) {
        this.id = id;
      }
    },
    ThemeColor: class ThemeColor {},
    EventEmitter: class EventEmitter {
      event() {}
      fire() {}
    },
    Uri: { file: (fsPath) => ({ fsPath }) },
    commands: { executeCommand: async () => undefined },
    workspace: {
      workspaceFolders: undefined,
      getConfiguration: () => ({ get: (_key, fallback) => fallback }),
    },
  };
  const state = { index: undefined };
  const treeModule = requireTypeScriptModule(
    path.join(repoRoot, "src", "treeProvider.ts"),
    {
      vscode: vscodeStub,
      "./skillIndex": {
        loadSkillIndex: async () => state.index,
        getLocalizedDescription: (skill) => skill.description || "",
        getResourceKind: (resource) => resource.kind || "skill",
        getResourceKindIcon: (kind) => kind,
        getResourceKindLabel: (kind) => kind,
        getIndexBundles: (index) => index?.bundles || [],
        getIndexResources: (index) => index?.skills || [],
        getIndexSources: (index) => index?.sources || [],
      },
      "./skillInstaller": { getInstalledSkillsWithMeta: async () => [] },
      "./localSkillScanner": { scanLocalSkills: async () => [] },
      "./i18n": {
        isJapanese: () => globalThis.__testJapaneseUi === true,
        messages: {
          noResourcesFound: () => "none",
          installResourcesHint: () => "hint",
          searchCommandTitle: () => "search",
        },
      },
      "./skillPreview": { getSkillId: (skill) => skill.name },
      "./mcpConfigManager": {},
      "./hookConfigManager": {},
      "./resourceKinds": {
        getInstalledResourceKey: () => "",
        getPluginIdFromPath: () => undefined,
        getPluginPackageCandidates: () => [],
        getPluginPackageId: () => undefined,
        getPluginPackageLabel: () => undefined,
        getResourceIdentityKeys: () => [],
        isHookConfigFilePath: () => false,
        mapContainedSkillParents: resourceKindsModule.mapContainedSkillParents,
      },
      "./customizationPaths": {},
      "./skillInvocationMode": modeModule,
      "./skillListOptions": optionsModule,
    },
  );
  const context = { globalState: { get: (_key, fallback) => fallback } };
  return { treeModule, context, state };
}

const browseIndex = (withInvocation) => ({
  version: "1",
  lastUpdated: "2026-01-01",
  sources: [{ id: "src", name: "Src", type: "official" }],
  categories: [],
  skills: [
    {
      name: "zeta",
      source: "src",
      path: "skills/zeta",
      kind: "skill",
      stars: 2,
      ...(withInvocation ? { invocation: "auto" } : {}),
    },
    {
      name: "alpha",
      source: "src",
      path: "skills/alpha",
      kind: "skill",
      stars: 7,
      ...(withInvocation ? { invocation: "explicitOnly" } : {}),
    },
    { name: "helper", source: "src", path: "agents/helper", kind: "agent" },
  ],
});

async function openSource(provider) {
  const root = await provider.getChildren();
  const source = root.find((item) => item.contextValue === "source");
  assert.ok(source, "the source row should be listed");
  return { root, source };
}

async function openSkillRows(provider, source) {
  const kinds = await provider.getChildren(source);
  const skillKind = kinds.find((item) => item.resourceKind === "skill");
  return skillKind ? provider.getChildren(skillKind) : [];
}

test("Browse filters skills, keeps other kinds, and sorts only when asked", async () => {
  const { treeModule, context, state } = createTreeProviders();
  state.index = browseIndex(true);
  const provider = new treeModule.BrowseSkillsProvider(context);

  try {
    let { source } = await openSource(provider);
    assert.strictEqual(source.description, "3 resources");
    assert.deepStrictEqual(
      (await openSkillRows(provider, source)).map((item) => item.label),
      ["zeta", "alpha"],
      "default keeps the index order",
    );

    optionsModule.setSkillViewOptions("browse", {
      filter: "explicitOnly",
      sort: "default",
    });
    ({ source } = await openSource(provider));
    assert.strictEqual(
      source.description,
      "2 resources",
      "the source count follows the filter; the agent stays",
    );
    const rows = await openSkillRows(provider, source);
    assert.deepStrictEqual(
      rows.map((item) => item.label),
      ["alpha"],
    );
    assert.match(rows[0].description, /Manual only/);
    assert.strictEqual(rows[0].iconPath.id, "play-circle");

    optionsModule.setSkillViewOptions("browse", {
      filter: "all",
      sort: "stars",
    });
    ({ source } = await openSource(provider));
    assert.deepStrictEqual(
      (await openSkillRows(provider, source)).map((item) => item.label),
      ["alpha", "zeta"],
    );

    optionsModule.setSkillViewOptions("browse", {
      filter: "all",
      sort: "name",
    });
    ({ source } = await openSource(provider));
    assert.deepStrictEqual(
      (await openSkillRows(provider, source)).map((item) => item.label),
      ["alpha", "zeta"],
    );
  } finally {
    optionsModule.setSkillViewOptions("browse", { filter: "all", sort: "default" });
  }
});

test("Browse tells an unrefreshed index apart from a filter with no match", async () => {
  const { treeModule, context, state } = createTreeProviders();
  try {
    optionsModule.setSkillViewOptions("browse", {
      filter: "explicitOnly",
      sort: "default",
    });

    state.index = browseIndex(false);
    const stale = new treeModule.BrowseSkillsProvider(context);
    const staleRoot = await stale.getChildren();
    assert.strictEqual(staleRoot[0].contextValue, "placeholder");
    assert.match(staleRoot[0].label, /no invocation-mode data/);

    state.index = browseIndex(true);
    state.index.skills = state.index.skills.filter(
      (skill) => skill.invocation !== "explicitOnly",
    );
    const fresh = new treeModule.BrowseSkillsProvider(context);
    const freshRoot = await fresh.getChildren();
    assert.strictEqual(freshRoot[0].contextValue, "placeholder");
    assert.match(freshRoot[0].label, /No skills match the filter/);
  } finally {
    optionsModule.setSkillViewOptions("browse", { filter: "all", sort: "default" });
  }
});

test("the Installed view filters skills only and recomputes without a rescan", async () => {
  const { treeModule } = createTreeProviders();
  const provider = new treeModule.WorkspaceSkillsProvider({ fsPath: "C:\\ws" });
  const entry = (name, kind, invocation) => ({
    kind,
    name,
    description: "",
    relativePath: `${kind}s/${name}`,
    fullPath: `C:\\ws\\${kind}s\\${name}\\SKILL.md`,
    isInstalled: true,
    isRegistered: true,
    ...(invocation ? { invocation } : {}),
  });
  provider.workspaceSkills = [
    entry("plain", "skill", "auto"),
    entry("manual", "skill", "explicitOnly"),
    entry("helper", "agent"),
  ];
  provider.hasLoaded = true;
  const rows = async (kind) => {
    const groups = await provider.getChildren();
    const group = groups.find((item) => item.resourceKind === kind);
    return group ? (await provider.getChildren(group)).map((item) => item.label) : [];
  };

  try {
    assert.deepStrictEqual(
      (await rows("skill")).map((label) => label.replace(/^\S+ /, "")),
      ["plain", "manual"],
    );

    optionsModule.setSkillViewOptions("local", {
      filter: "explicitOnly",
      sort: "default",
    });
    assert.deepStrictEqual(
      (await rows("skill")).map((label) => label.replace(/^\S+ /, "")),
      ["manual"],
    );
    assert.strictEqual((await rows("agent")).length, 1, "agents are not filtered");
    assert.strictEqual(
      provider.getWorkspaceSkills().length,
      3,
      "the raw list other features read stays complete",
    );

    optionsModule.setSkillViewOptions("local", {
      filter: "modelOnly",
      sort: "default",
    });
    const root = await provider.getChildren();
    assert.strictEqual(root[0].contextValue, "placeholder");
    assert.match(root[0].label, /No skills match the filter/);
  } finally {
    optionsModule.setSkillViewOptions("local", { filter: "all", sort: "default" });
  }
});

test("the Installed view shows a skill inside another skill under its parent", async () => {
  const { treeModule } = createTreeProviders();
  const provider = new treeModule.WorkspaceSkillsProvider({ fsPath: "C:\\ws" });
  const skill = (name, directory, invocation) => ({
    kind: "skill",
    name,
    description: "",
    relativePath: directory,
    fullPath: `C:\\ws\\${directory.replace(/\//g, "\\")}\\SKILL.md`,
    isInstalled: true,
    isRegistered: true,
    invocation,
  });
  provider.workspaceSkills = [
    skill("deploy-model", ".github/skills/deploy-model", "auto"),
    skill("capacity", ".github/skills/deploy-model/capacity", "explicitOnly"),
    skill("plain", ".github/skills/plain", "auto"),
  ];
  provider.hasLoaded = true;
  const names = (items) =>
    items.map((item) => item.label.replace(/^\S+ /, "")).sort();
  const skillGroup = async () =>
    (await provider.getChildren()).find((item) => item.resourceKind === "skill");

  try {
    const group = await skillGroup();
    const top = await provider.getChildren(group);
    assert.deepStrictEqual(names(top), ["deploy-model", "plain"]);
    const parent = top.find((item) => item.skill.name === "deploy-model");
    assert.strictEqual(parent.collapsibleState, 1, "the parent expands");
    assert.match(parent.description, /1 contained/, "the parent row says how many skills it holds");
    globalThis.__testJapaneseUi = true;
    try {
      const japaneseParent = (await provider.getChildren(group)).find(
        (item) => item.skill.name === "deploy-model",
      );
      assert.match(japaneseParent.description, /内包スキル 1 件/);
    } finally {
      globalThis.__testJapaneseUi = false;
    }
    assert.doesNotMatch(
      top.find((item) => item.skill.name === "plain").description,
      /contained/,
    );
    assert.strictEqual(
      top.find((item) => item.skill.name === "plain").collapsibleState,
      0,
    );
    const children = await provider.getChildren(parent);
    assert.deepStrictEqual(names(children), ["capacity"]);
    assert.strictEqual(
      provider.getParent(children[0]),
      parent,
      "reveal walks from the contained skill to its parent",
    );

    optionsModule.setSkillViewOptions("local", {
      filter: "explicitOnly",
      sort: "default",
    });
    assert.deepStrictEqual(
      names(await provider.getChildren(await skillGroup())),
      ["capacity"],
      "a contained skill stays visible at the top level when its parent is filtered out",
    );
  } finally {
    optionsModule.setSkillViewOptions("local", { filter: "all", sort: "default" });
  }
});

async function main() {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${name}`);
      console.error(error instanceof Error ? error.stack : String(error));
    }
  }
  if (failed > 0) {
    process.exitCode = 1;
    return;
  }
  console.log("RESULT=PASS");
}

main();
