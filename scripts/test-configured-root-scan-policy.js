const assert = require("node:assert");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");
const { minimatch } = require("minimatch");

function requireTypeScriptModule(filePath, stubs = {}) {
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

const repoRoot = path.resolve(__dirname, "..");
const scannerSource = fs.readFileSync(
  path.join(repoRoot, "src", "localSkillScanner.ts"),
  "utf8",
);
const instructionManagerSource = fs.readFileSync(
  path.join(repoRoot, "src", "instructionManager.ts"),
  "utf8",
);
const extensionSource = fs.readFileSync(
  path.join(repoRoot, "src", "extension.ts"),
  "utf8",
);
const treeProviderSource = fs.readFileSync(
  path.join(repoRoot, "src", "treeProvider.ts"),
  "utf8",
);
const customizationPathsSource = fs.readFileSync(
  path.join(repoRoot, "src", "customizationPaths.ts"),
  "utf8",
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
);

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

test("configured roots are scanned before workspace fallback", () => {
  const configuredIndex = scannerSource.indexOf(
    "const configuredCandidates = await findConfiguredWorkspaceCandidates",
  );
  const configuredParseIndex = scannerSource.indexOf(
    "const configuredSkills = await parseCandidates(configuredCandidates)",
  );
  const fallbackIndex = scannerSource.indexOf(
    "const fallbackCandidates = await findWorkspaceFallbackCandidates",
  );

  assert.ok(configuredIndex > -1, "Expected configured candidate scan");
  assert.ok(
    configuredParseIndex > configuredIndex,
    "Expected configured parse",
  );
  assert.ok(
    fallbackIndex > configuredParseIndex,
    "Workspace fallback must run after configured roots are parsed",
  );
});

test("workspace fallback is automatic only when configured roots are empty", () => {
  assert.match(
    scannerSource,
    /type WorkspaceFallbackMode = "auto" \| "always" \| "none"/,
  );
  assert.match(scannerSource, /return configuredSkills\.length === 0/);
  assert.match(
    scannerSource,
    /shouldUseWorkspaceFallback\(workspaceFallback, configuredSkills\)/,
  );
});

test("configured roots include skill and non-skill workspace directories", () => {
  assert.match(scannerSource, /getConfiguredSkillsDirectory\(config\)/);
  assert.match(scannerSource, /getConfiguredAdditionalSkillRoots\(config\)/);
  assert.match(
    scannerSource,
    /getConfiguredWorkspaceAgentsDirectory\(config\)/,
  );
  assert.match(
    scannerSource,
    /getConfiguredWorkspaceInstructionsDirectory\(config\)/,
  );
  assert.match(
    scannerSource,
    /getConfiguredWorkspacePromptsDirectory\(config\)/,
  );
  assert.match(scannerSource, /getConfiguredWorkspaceHooksDirectory\(config\)/);
  assert.match(scannerSource, /getConfiguredWorkspaceMcpDirectory\(config\)/);
});

test("additional skill roots are contributed and scanned as skill roots", () => {
  assert.match(customizationPathsSource, /getConfiguredAdditionalSkillRoots/);
  assert.match(customizationPathsSource, /isSameOrChildWorkspacePath/);
  assert.match(customizationPathsSource, /getConfiguration\("skillNinja"\)/);
  assert.match(
    scannerSource,
    /\.\.\.getConfiguredAdditionalSkillRoots\(config\)/,
  );
  assert.match(scannerSource, /detectionBase: "skills"/);
  assert.match(extensionSource, /resourceNinja\.additionalSkillRoots/);
  assert.deepStrictEqual(
    packageJson.contributes.configuration.properties[
      "resourceNinja.additionalSkillRoots"
    ].default,
    [],
  );
});

test("configured skill root checks are path-boundary aware", () => {
  assert.match(
    customizationPathsSource,
    /normalizedCandidate === normalizedRoot \|\|[\s\S]*normalizedCandidate\.startsWith\(`\$\{normalizedRoot\}\/`\)/,
  );
  assert.match(
    scannerSource,
    /isSameOrChildWorkspacePath\(relativePath, skillsDir\)/,
  );
  assert.match(
    instructionManagerSource,
    /isSameOrChildWorkspacePath\([\s\S]*ls\.relativePath,[\s\S]*workspaceRelativeSkillsDir/,
  );
  assert.match(
    treeProviderSource,
    /isSameOrChildWorkspacePath\(local\.relativePath, skillsDir\)/,
  );
  assert.doesNotMatch(scannerSource, /relativePath\.startsWith\(skillsDir\)/);
  assert.doesNotMatch(
    treeProviderSource,
    /local\.relativePath\.startsWith\(skillsDir\)/,
  );
});

test("instruction fallback is explicit and disabled by default", () => {
  assert.match(instructionManagerSource, /workspaceFallback: "always"/);
  assert.match(
    customizationPathsSource,
    /config\.get<boolean>\("includeLocalResources"\)[\s\S]*false/,
  );
  assert.strictEqual(
    packageJson.contributes.configuration.properties[
      "resourceNinja.includeLocalResources"
    ].default,
    false,
  );
});

const WORKSPACE_ROOT = path.resolve("/tmp-workspace");

function createUri(fsPath) {
  return {
    scheme: "file",
    fsPath: path.normalize(fsPath),
    path: fsPath.replace(/\\/g, "/"),
  };
}

const configStub = { get: () => undefined, inspect: () => undefined };

const vscodeStub = {
  Uri: {
    file: (value) => createUri(value),
    joinPath: (base, ...segments) =>
      createUri(path.join(base.fsPath, ...segments)),
  },
  workspace: {
    getConfiguration: () => configStub,
  },
};

const resourceKindsModule = requireTypeScriptModule(
  path.join(repoRoot, "src", "resourceKinds.ts"),
);
const {
  detectResourceKindFromPath,
  dedupePluginManifestsByRoot,
  getPluginManifestPrecedence,
  getPluginManifestScanGlobs,
} = resourceKindsModule;

const { getConfiguredWorkspaceResourceRoots } = requireTypeScriptModule(
  path.join(repoRoot, "src", "localSkillScanner.ts"),
  {
    vscode: vscodeStub,
    "./resourceKinds": resourceKindsModule,
    "./customizationPaths": requireTypeScriptModule(
      path.join(repoRoot, "src", "customizationPaths.ts"),
      { vscode: vscodeStub },
    ),
    "./logger": requireTypeScriptModule(
      path.join(repoRoot, "src", "logger.ts"),
      {
        vscode: vscodeStub,
      },
    ),
    "./instructionManager": { updateInstructionFile: () => undefined },
    "./skillInstaller": { stripSkillMetaLocalPaths: () => undefined },
  },
);

const scanRoots = getConfiguredWorkspaceResourceRoots(
  createUri(WORKSPACE_ROOT),
  configStub,
);

const PLUGIN_MANIFEST_FILES = [
  ".github/plugins/demo/plugin.json",
  ".github/plugins/gemini-demo/gemini-extension.json",
  ".github/plugins/apm-demo/apm.yml",
  ".github/plugins/marker-demo/.claude-plugin/plugin.json",
  ".github/plugins/marker-demo/.codex-plugin/marketplace.json",
];

const PLUGIN_CHILD_FILES = [
  ".github/plugins/demo/skills/demo-skill/SKILL.md",
  ".github/plugins/demo/agents/demo.agent.md",
  ".github/plugins/demo/instructions/demo.instructions.md",
  ".github/plugins/demo/prompts/demo.prompt.md",
  ".github/plugins/demo/hooks/demo.json",
  ".github/plugins/demo/.mcp.json",
];

function matchingRoots(workspaceRelativeFile) {
  const absoluteFile = path.join(WORKSPACE_ROOT, workspaceRelativeFile);
  return scanRoots.filter((root) => {
    const relativeToRoot = path
      .relative(root.rootUri.fsPath, absoluteFile)
      .replace(/\\/g, "/");
    if (!relativeToRoot || relativeToRoot.startsWith("..")) {
      return false;
    }
    return minimatch(relativeToRoot, root.glob, { dot: true });
  });
}

test("plugins directory is a configured workspace scan root", () => {
  const pluginRoots = scanRoots.filter(
    (root) => root.detectionBase === "plugins",
  );
  assert.ok(pluginRoots.length > 0, "Expected a plugins scan root");
  assert.deepStrictEqual(
    pluginRoots.map((root) => root.glob),
    getPluginManifestScanGlobs(),
  );
  for (const root of pluginRoots) {
    assert.strictEqual(
      root.rootUri.fsPath,
      path.join(WORKSPACE_ROOT, ".github", "plugins"),
    );
  }
});

test("plugins root glob matches manifests and no plugin child resource", () => {
  for (const manifest of PLUGIN_MANIFEST_FILES) {
    const roots = matchingRoots(manifest);
    assert.ok(
      roots.some((root) => root.detectionBase === "plugins"),
      `Expected the plugins root to match ${manifest}`,
    );
    const detectionPath = `plugins/${manifest.replace(".github/plugins/", "")}`;
    assert.strictEqual(
      detectResourceKindFromPath(detectionPath),
      "plugin",
      `Expected ${detectionPath} to be detected as a plugin manifest`,
    );
  }

  for (const child of PLUGIN_CHILD_FILES) {
    const roots = matchingRoots(child);
    assert.deepStrictEqual(
      roots
        .filter((root) => root.detectionBase === "plugins")
        .map((r) => r.glob),
      [],
      `Plugins root must not match the plugin child ${child}`,
    );
  }
});

test("no scan root lists the same file twice", () => {
  for (const file of [
    ...PLUGIN_MANIFEST_FILES,
    ...PLUGIN_CHILD_FILES,
    ".github/skills/normal-skill/SKILL.md",
    ".github/agents/normal.agent.md",
    ".github/mcp/normal.json",
  ]) {
    const roots = matchingRoots(file);
    assert.ok(
      roots.length <= 1,
      `${file} matched ${roots.length} scan roots: ${roots
        .map((root) => `${root.detectionBase}:${root.glob}`)
        .join(", ")}`,
    );
  }

  for (const child of PLUGIN_CHILD_FILES) {
    assert.strictEqual(
      matchingRoots(child).length,
      0,
      `${child} belongs to its plugin package and must not gain its own scan root`,
    );
  }
});

// `awslabs/agent-plugins` ships `.claude-plugin/` and `.codex-plugin/` in the same
// package, and a package may carry a root `plugin.json` beside `gemini-extension.json`,
// so the depth-1 globs match a package several times and the scan has to collapse them.
const MULTI_MANIFEST_PACKAGES = {
  "two-markers": [
    ".github/plugins/two-markers/.claude-plugin/plugin.json",
    ".github/plugins/two-markers/.codex-plugin/plugin.json",
  ],
  "root-and-gemini": [
    ".github/plugins/root-and-gemini/plugin.json",
    ".github/plugins/root-and-gemini/gemini-extension.json",
  ],
};

// The package-relative manifest each scope settled on, so the two scopes can be
// compared against each other once the recursive walk below has run.
const workspaceChosenManifests = new Map();

function toPackageRelativeManifest(manifestPath) {
  return manifestPath.replace(/^(?:\.github\/)?plugins\/[^/]+\//, "");
}

// The workspace scan is `findFiles(glob)` followed by the shared dedupe, so the glob
// match already modelled by `matchingRoots` is piped through the production helper.
function workspacePluginRows(workspaceRelativeFiles) {
  const matched = workspaceRelativeFiles.filter((file) =>
    matchingRoots(file).some((root) => root.detectionBase === "plugins"),
  );
  return dedupePluginManifestsByRoot(
    matched.map((file) => path.join(WORKSPACE_ROOT, file)),
    (fsPath) => fsPath,
  ).map((fsPath) => path.relative(WORKSPACE_ROOT, fsPath).replace(/\\/g, "/"));
}

test("the manifest precedence is stated once and prefers marker forms", () => {
  const precedence = getPluginManifestPrecedence();
  assert.ok(
    precedence.indexOf(".claude-plugin/plugin.json") <
      precedence.indexOf(".codex-plugin/plugin.json"),
    "Expected a deterministic order between marker directories",
  );
  assert.ok(
    precedence.indexOf(".codex-plugin/plugin.json") <
      precedence.indexOf("plugin.json"),
    "Marker forms must outrank root forms",
  );
  assert.ok(
    precedence.indexOf("plugin.json") <
      precedence.indexOf("gemini-extension.json"),
    "Expected a deterministic order between root manifest forms",
  );
  assert.strictEqual(
    new Set(precedence).size,
    precedence.length,
    "The precedence must not list a manifest form twice",
  );
});

test("a package with several manifests is one workspace row", () => {
  for (const [packageName, files] of Object.entries(MULTI_MANIFEST_PACKAGES)) {
    for (const file of files) {
      assert.ok(
        matchingRoots(file).some((root) => root.detectionBase === "plugins"),
        `Expected the plugins root to match ${file}`,
      );
    }
    const rows = workspacePluginRows(files);
    assert.strictEqual(
      rows.length,
      1,
      `${packageName} is one installed package and must be one row, got ${rows.join(", ")}`,
    );
    workspaceChosenManifests.set(
      packageName,
      toPackageRelativeManifest(rows[0]),
    );
  }

  assert.strictEqual(
    workspaceChosenManifests.get("two-markers"),
    ".claude-plugin/plugin.json",
  );
  assert.strictEqual(
    workspaceChosenManifests.get("root-and-gemini"),
    "plugin.json",
  );
});

test("the dedupe keeps one row per package and never merges two packages", () => {
  const rows = workspacePluginRows([
    ...MULTI_MANIFEST_PACKAGES["two-markers"],
    ...MULTI_MANIFEST_PACKAGES["root-and-gemini"],
    ...PLUGIN_MANIFEST_FILES,
  ]);
  assert.deepStrictEqual(rows.slice().sort(), [
    ".github/plugins/apm-demo/apm.yml",
    ".github/plugins/demo/plugin.json",
    ".github/plugins/gemini-demo/gemini-extension.json",
    ".github/plugins/marker-demo/.claude-plugin/plugin.json",
    ".github/plugins/root-and-gemini/plugin.json",
    ".github/plugins/two-markers/.claude-plugin/plugin.json",
  ]);
});

// The user and global scopes walk their roots recursively instead of using the
// workspace globs, so the same "a plugin is one package" rule has to be proven
// against the real walk rather than against a glob list.
const os = require("node:os");

const FIXTURE_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), "resource-ninja-plugin-walk-"),
);

function writeFixtureFile(relativePath, fixtureRoot = FIXTURE_ROOT) {
  const absolutePath = path.join(fixtureRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, "{}\n", "utf8");
}

const FIXTURE_FILES = [
  // Root-manifest plugin package.
  "plugins/root-form/plugin.json",
  "plugins/root-form/skills/demo/SKILL.md",
  "plugins/root-form/agents/demo.agent.md",
  "plugins/root-form/hooks/demo.json",
  "plugins/root-form/.mcp.json",
  // Marker-directory plugin package.
  "plugins/marker-form/.claude-plugin/plugin.json",
  "plugins/marker-form/skills/demo/SKILL.md",
  "plugins/marker-form/agents/demo.agent.md",
  "plugins/marker-form/hooks/demo.json",
  "plugins/marker-form/.mcp.json",
  // One package shipping two marker manifests, the way `awslabs/agent-plugins` does.
  "plugins/two-markers/.claude-plugin/plugin.json",
  "plugins/two-markers/.codex-plugin/plugin.json",
  "plugins/two-markers/skills/demo/SKILL.md",
  // One package shipping two root manifests.
  "plugins/root-and-gemini/plugin.json",
  "plugins/root-and-gemini/gemini-extension.json",
  "plugins/root-and-gemini/skills/demo/SKILL.md",
  // Sibling folder under the same plugins directory that is NOT a package.
  "plugins/not-a-plugin/skills/demo/SKILL.md",
  "plugins/not-a-plugin/agents/demo.agent.md",
  // Ordinary global-home resource roots must be untouched by the guard.
  "skills/regular/SKILL.md",
  "skills/regular/nested/EXTRA.md",
  "agents/regular.agent.md",
  // A `plugins` directory that is NOT the install directory: it sits deeper in the
  // tree, so it belongs to somebody else and must keep its recursive walk.
  "skills/nested-host/plugins/inner/plugin.json",
  "skills/nested-host/plugins/inner/SKILL.md",
  "skills/nested-host/plugins/inner/skills/deep/SKILL.md",
  // Somebody else's `plugin.json` outside a plugins directory. Collapsing here
  // would hide a skill the user still needs.
  "skills/has-foreign-manifest/plugin.json",
  "skills/has-foreign-manifest/SKILL.md",
];

for (const relativePath of FIXTURE_FILES) {
  writeFixtureFile(relativePath);
}

// A case-insensitive filesystem serves the install directory under any casing, so the
// guard has to fire on `Plugins` too. This lives in its own root because `plugins` and
// `Plugins` are the same directory on Windows.
const CASED_FIXTURE_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), "resource-ninja-plugin-case-"),
);

const CASED_FIXTURE_FILES = [
  "Plugins/cased-form/plugin.json",
  "Plugins/cased-form/skills/demo/SKILL.md",
  "Plugins/cased-form/agents/demo.agent.md",
];

for (const relativePath of CASED_FIXTURE_FILES) {
  writeFixtureFile(relativePath, CASED_FIXTURE_ROOT);
}

const FILE_TYPE = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };

function toFileType(dirent) {
  return dirent.isDirectory() ? FILE_TYPE.Directory : FILE_TYPE.File;
}

const walkVscodeStub = {
  ...vscodeStub,
  FileType: FILE_TYPE,
  workspace: {
    ...vscodeStub.workspace,
    fs: {
      stat: async (uri) => ({
        type: fs.statSync(uri.fsPath).isDirectory()
          ? FILE_TYPE.Directory
          : FILE_TYPE.File,
      }),
      readDirectory: async (uri) =>
        fs
          .readdirSync(uri.fsPath, { withFileTypes: true })
          .map((dirent) => [dirent.name, toFileType(dirent)]),
    },
  },
};

const { collectMarkdownFiles } = requireTypeScriptModule(
  path.join(repoRoot, "src", "userResourceScanner.ts"),
  {
    vscode: walkVscodeStub,
    "./resourceKinds": resourceKindsModule,
    "./skillIndex": {},
    "./customizationPaths": requireTypeScriptModule(
      path.join(repoRoot, "src", "customizationPaths.ts"),
      { vscode: walkVscodeStub },
    ),
    "./i18n": { isJapanese: () => false },
    "./userDataPaths": { getVsCodeUserDataPath: () => FIXTURE_ROOT },
    "./skillInstaller": { stripSkillMetaLocalPaths: () => undefined },
  },
);

async function collectFixtureRelativePaths(fixtureRoot = FIXTURE_ROOT) {
  const collected = await collectMarkdownFiles(createUri(fixtureRoot), false);
  return collected
    .map((uri) => path.relative(fixtureRoot, uri.fsPath).replace(/\\/g, "/"))
    .sort();
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

async function runWalkTests() {
  const collected = await collectFixtureRelativePaths();

  await asyncTest("user walk stops at a root-manifest plugin package", () => {
    assert.ok(
      collected.includes("plugins/root-form/plugin.json"),
      "Expected the plugin manifest to still be collected",
    );
    const leaked = collected.filter(
      (file) =>
        file.startsWith("plugins/root-form/") &&
        file !== "plugins/root-form/plugin.json",
    );
    assert.deepStrictEqual(
      leaked,
      [],
      "A plugin package's children must not be collected individually",
    );
  });

  await asyncTest("user walk stops at a marker-form plugin package", () => {
    assert.ok(
      collected.includes("plugins/marker-form/.claude-plugin/plugin.json"),
      "Expected the marker-directory manifest to still be collected",
    );
    const leaked = collected.filter(
      (file) =>
        file.startsWith("plugins/marker-form/") &&
        file !== "plugins/marker-form/.claude-plugin/plugin.json",
    );
    assert.deepStrictEqual(
      leaked,
      [],
      "A marker-form plugin package's children must not be collected individually",
    );
  });

  await asyncTest(
    "the collected manifests are the manifests src accepts",
    () => {
      for (const manifest of [
        "plugins/root-form/plugin.json",
        "plugins/marker-form/.claude-plugin/plugin.json",
      ]) {
        assert.strictEqual(
          detectResourceKindFromPath(manifest),
          "plugin",
          `Expected ${manifest} to be detected as a plugin manifest`,
        );
      }
    },
  );

  await asyncTest(
    "a sibling that is not a plugin package is still walked",
    () => {
      assert.deepStrictEqual(
        collected.filter((file) => file.startsWith("plugins/not-a-plugin/")),
        [
          "plugins/not-a-plugin/agents/demo.agent.md",
          "plugins/not-a-plugin/skills/demo/SKILL.md",
        ],
        "The guard must only prune directories that hold a plugin manifest",
      );
    },
  );

  await asyncTest(
    "a package shipping several manifests is one user row per package",
    () => {
      for (const [packageName, expectedManifest] of [
        ["two-markers", ".claude-plugin/plugin.json"],
        ["root-and-gemini", "plugin.json"],
      ]) {
        const rows = collected.filter((file) =>
          file.startsWith(`plugins/${packageName}/`),
        );
        assert.deepStrictEqual(
          rows,
          [`plugins/${packageName}/${expectedManifest}`],
          `${packageName} ships several accepted manifests and must still be one row`,
        );
      }
    },
  );

  await asyncTest("both scopes settle on the same manifest", () => {
    for (const packageName of ["two-markers", "root-and-gemini"]) {
      const userRow = collected.find((file) =>
        file.startsWith(`plugins/${packageName}/`),
      );
      assert.strictEqual(
        toPackageRelativeManifest(userRow),
        workspaceChosenManifests.get(packageName),
        `The workspace and user scopes must pick the same manifest for ${packageName}`,
      );
    }
  });

  await asyncTest(
    "a plugins directory deeper in the tree is still walked",
    () => {
      assert.deepStrictEqual(
        collected.filter((file) => file.startsWith("skills/nested-host/")),
        [
          "skills/nested-host/plugins/inner/SKILL.md",
          "skills/nested-host/plugins/inner/plugin.json",
          "skills/nested-host/plugins/inner/skills/deep/SKILL.md",
        ],
        "Only `<scanRoot>/plugins/<name>/` is an installed package; a nested `plugins` belongs to somebody else",
      );
    },
  );

  await asyncTest(
    "a differently cased Plugins directory is collapsed",
    async () => {
      assert.deepStrictEqual(
        await collectFixtureRelativePaths(CASED_FIXTURE_ROOT),
        ["Plugins/cased-form/plugin.json"],
        "A case-insensitive filesystem can serve the install directory as `Plugins`",
      );
    },
  );

  await asyncTest(
    "a foreign plugin.json outside a plugins directory prunes nothing",
    () => {
      assert.ok(
        collected.includes("skills/has-foreign-manifest/SKILL.md"),
        "A `plugin.json` that is somebody else's config must not hide the resources beside it",
      );
    },
  );

  await asyncTest("non-plugin resource roots keep their recursive walk", () => {
    assert.deepStrictEqual(
      collected.filter(
        (file) => file.startsWith("skills/") || file.startsWith("agents/"),
      ),
      [
        "agents/regular.agent.md",
        "skills/has-foreign-manifest/SKILL.md",
        "skills/has-foreign-manifest/plugin.json",
        "skills/nested-host/plugins/inner/SKILL.md",
        "skills/nested-host/plugins/inner/plugin.json",
        "skills/nested-host/plugins/inner/skills/deep/SKILL.md",
        "skills/regular/SKILL.md",
        "skills/regular/nested/EXTRA.md",
      ],
    );
  });
}

function removeFixtureRoots() {
  fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  fs.rmSync(CASED_FIXTURE_ROOT, { recursive: true, force: true });
}

runWalkTests()
  .then(() => {
    removeFixtureRoots();
    console.log("Configured-root scan policy tests passed.");
  })
  .catch((error) => {
    removeFixtureRoots();
    console.error(error);
    process.exitCode = 1;
  });
