#!/usr/bin/env node

// Reference notes are read on demand from `<global home>/references/`, never loaded
// as instructions. These cases pin the explicit opt-in, the install routing, and the
// guarantee that ordinary instructions behave exactly as before.

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const os = require("os");
const path = require("path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const srcDir = path.join(repoRoot, "src");

function requireTypeScriptModule(filePath, stubs = {}) {
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
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

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

const silentLogger = {
  logger: { info() {}, warn() {}, error() {} },
};

const resourceKinds = requireTypeScriptModule(
  path.join(srcDir, "resourceKinds.ts"),
);

// ---------------------------------------------------------------------------
// Kind detection and the explicit opt-in list
// ---------------------------------------------------------------------------

test("the dedicated directory marks top-level markdown files as references", () => {
  const { detectResourceKindFromPath } = resourceKinds;
  assert.strictEqual(
    detectResourceKindFromPath(".github/references/terminal-notes.md"),
    "reference",
  );
  // The file name is preserved and the suffix never decides the kind here.
  assert.strictEqual(
    detectResourceKindFromPath(
      ".github/references/terminal-notes.instructions.md",
    ),
    "reference",
  );
  assert.strictEqual(
    detectResourceKindFromPath(".github/references/references.json"),
    undefined,
    "the opt-in list is not a resource",
  );
  assert.strictEqual(
    detectResourceKindFromPath(".github/references/nested/notes.md"),
    undefined,
    "only top-level files in the directory count",
  );
  assert.strictEqual(
    detectResourceKindFromPath("docs/references/notes.md"),
    undefined,
    "a references folder elsewhere is not the convention",
  );
});

test("a suffix, prose, or publication metadata never makes a reference", () => {
  const { detectResourceKindFromPath } = resourceKinds;
  // Detection reads the path only, so content such as `syncToGlobal: true` has no say.
  assert.strictEqual(
    detectResourceKindFromPath(
      ".github/instructions/core/terminal-operations-notes.instructions.md",
    ),
    "instruction",
  );
  assert.strictEqual(
    detectResourceKindFromPath("notes/terminal-operations-notes.md"),
    undefined,
  );
  assert.strictEqual(
    detectResourceKindFromPath(".github/instructions/a.instructions.md"),
    "instruction",
  );
  assert.strictEqual(
    detectResourceKindFromPath("plugins/demo/instructions/rules.md"),
    "instruction",
    "plugin child kinds are unaffected",
  );
});

test("an explicit path wins over the instruction suffix, and only that exact path", () => {
  const { detectResourceKindFromPath } = resourceKinds;
  const legacyPath =
    ".github/instructions/core/terminal-operations-notes.instructions.md";
  const explicit = new Set([legacyPath]);
  assert.strictEqual(
    detectResourceKindFromPath(legacyPath, { explicitReferencePaths: explicit }),
    "reference",
  );
  assert.strictEqual(
    detectResourceKindFromPath(
      ".github/instructions/core/other.instructions.md",
      { explicitReferencePaths: explicit },
    ),
    "instruction",
  );
  assert.strictEqual(
    detectResourceKindFromPath(legacyPath.toUpperCase(), {
      explicitReferencePaths: explicit,
    }),
    "instruction",
    "a differently cased path is not the listed file",
  );
});

test("the manifest accepts only clean repository-relative markdown paths", () => {
  const { parseReferenceManifest } = resourceKinds;
  const parsed = parseReferenceManifest(
    JSON.stringify({
      references: [
        ".github/instructions/core/a.instructions.md",
        ".github/instructions/core/a.instructions.md",
        "docs/b.md",
        "../escape.md",
        "/abs/c.md",
        "C:/abs/d.md",
        "dir\\e.md",
        "dir//f.md",
        "dir/./g.md",
        "notes.json",
        "tab\tname.md",
        "",
        42,
        null,
      ],
    }),
  );
  assert.deepStrictEqual(parsed.paths, [
    ".github/instructions/core/a.instructions.md",
    "docs/b.md",
  ]);
  assert.strictEqual(parsed.rejected.length, 11);
  assert.strictEqual(parsed.error, undefined);
});

test("a manifest that is not shaped as documented opts nothing in", () => {
  const { parseReferenceManifest, MAX_REFERENCE_MANIFEST_ENTRIES } =
    resourceKinds;
  for (const content of [
    "not json",
    "[]",
    "null",
    '"text"',
    "{}",
    '{ "references": "a.md" }',
    JSON.stringify({
      references: Array.from(
        { length: MAX_REFERENCE_MANIFEST_ENTRIES + 1 },
        (_unused, index) => `docs/${index}.md`,
      ),
    }),
  ]) {
    const parsed = parseReferenceManifest(content);
    assert.deepStrictEqual(parsed.paths, [], content.slice(0, 40));
    assert.ok(parsed.error, `expected an error for ${content.slice(0, 40)}`);
  }
  assert.deepStrictEqual(
    parseReferenceManifest("\uFEFF" + '{ "references": ["a.md"] }').paths,
    ["a.md"],
    "a byte order mark is tolerated",
  );
});

// ---------------------------------------------------------------------------
// Repository scan
// ---------------------------------------------------------------------------

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    clone() {
      return response(status, body);
    },
  };
}

function createIndexUpdater() {
  const githubResponse = requireTypeScriptModule(
    path.join(srcDir, "githubResponse.ts"),
  );
  const githubCredentialBlocklist = requireTypeScriptModule(
    path.join(srcDir, "githubCredentialBlocklist.ts"),
  );
  const githubFetch = requireTypeScriptModule(
    path.join(srcDir, "githubFetch.ts"),
    {
      "./githubResponse": githubResponse,
      "./githubCredentialBlocklist": githubCredentialBlocklist,
      "./logger": silentLogger,
      "./githubAuth": { resolveGitHubTokenAfterFailure: async () => undefined },
    },
  );
  const realSourceFreshness = requireTypeScriptModule(
    path.join(srcDir, "sourceFreshness.ts"),
  );
  const warnings = [];
  const moduleExports = requireTypeScriptModule(
    path.join(srcDir, "indexUpdater.ts"),
    {
      vscode: {
        Uri: { joinPath: (base, ...segments) => ({ fsPath: path.join(base.fsPath, ...segments) }) },
        env: { language: "en" },
        workspace: {
          getConfiguration: () => ({ get: () => undefined }),
          fs: { createDirectory: async () => undefined, writeFile: async () => undefined },
        },
        window: {
          showInformationMessage: async () => undefined,
          showErrorMessage: async () => undefined,
        },
      },
      "./gitHubRefSafety": requireTypeScriptModule(
        path.join(srcDir, "gitHubRefSafety.ts"),
      ),
      "./skillIndex": {
        getResourceKind: (resource) => resource.kind || "skill",
        createBundleKey: (bundle) => `${bundle.source}:${bundle.id}`,
        normalizeGitHubRepoUrl: (url) => url.trim().replace(/\/$/, ""),
        saveSkillIndex: async () => undefined,
      },
      "./githubAuth": {
        getGitHubToken: async () => undefined,
        checkGitHubAuth: async () => ({ authenticated: true }),
      },
      "./authRecovery": { recoverSelectedGhCliAccount: async () => ({ recovered: false }) },
      "./resourceKinds": resourceKinds,
      "./constants": {
        LICENSE_EXTRACTION: { FILE_NAMES: ["LICENSE"], SCAN_LENGTH: 2000 },
        INDEX_LIMITS: { SHORT_DESCRIPTION: 200, PREVIEW_LENGTH: 200 },
      },
      "./i18n": {
        messages: {
          authRequired: () => "auth",
          updatingSource: (name) => `Updating ${name}`,
          sourceIndexResourcesUpdatedProgress: (count) => `${count}`,
        },
      },
      "./retiredSources": requireTypeScriptModule(path.join(srcDir, "retiredSources.ts")),
      "./sharedResourceIndexStore": {
        shouldRunSharedScan: async () => true,
        updateSharedScanMetadata: async () => undefined,
        readSharedResourceIndex: async () => undefined,
        loadSharedStoresIntoSkillIndex: async (_context, index) => index,
        syncSharedStoresFromSkillIndex: async () => undefined,
      },
      "./sourceFreshness": {
        ...realSourceFreshness,
        stampIndexedSources: (sources) => sources,
      },
      "./coexistence": { SELF_EXTENSION_ID: "yamapan.agent-resources-ninja" },
      "./logger": {
        logger: {
          info() {},
          warn: (message) => warnings.push(String(message)),
          error() {},
        },
      },
      "./githubFetch": githubFetch,
      "./githubResponse": githubResponse,
      "./githubCredentialBlocklist": githubCredentialBlocklist,
      "./sourceUpdateReconcile": requireTypeScriptModule(
        path.join(srcDir, "sourceUpdateReconcile.ts"),
      ),
      "./indexDataNormalization": requireTypeScriptModule(
        path.join(srcDir, "indexDataNormalization.ts"),
      ),
      "./skillInvocationMode": requireTypeScriptModule(
        path.join(srcDir, "skillInvocationMode.ts"),
      ),
    },
  );
  return { moduleExports, warnings };
}

async function scanRepository(files) {
  const { moduleExports, warnings } = createIndexUpdater();
  const rawRequests = [];
  global.fetch = async (url) => {
    if (url === "https://api.github.com/repos/octo/notes") {
      return response(200, { default_branch: "main" });
    }
    if (
      url ===
      "https://api.github.com/repos/octo/notes/git/trees/main?recursive=1"
    ) {
      return response(200, {
        tree: Object.keys(files).map((filePath) => ({
          path: filePath,
          type: "blob",
        })),
      });
    }
    const prefix = "https://raw.githubusercontent.com/octo/notes/main/";
    if (url.startsWith(prefix)) {
      const filePath = decodeURIComponent(url.slice(prefix.length));
      rawRequests.push(filePath);
      return Object.prototype.hasOwnProperty.call(files, filePath)
        ? response(200, files[filePath])
        : response(404, "Not Found");
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
  const result = await moduleExports.addSource(
    { globalStorageUri: { fsPath: path.join(os.tmpdir(), "reference-scan") } },
    {
      version: "1.0.0",
      lastUpdated: "2026-11-19",
      sources: [],
      skills: [],
      categories: [],
      bundles: [],
    },
    "https://github.com/octo/notes",
  );
  return { skills: result.index.skills, rawRequests, warnings };
}

const NOTE_WITH_PUBLICATION_METADATA =
  "---\nname: legacy-notes\ndescription: Legacy mirror note\nsyncToGlobal: true\n---\n# Notes\n";

test("a scan separates opted-in references from ordinary instructions", async () => {
  const { skills, rawRequests, warnings } = await scanRepository({
    ".github/references/terminal-ops.md": "# Terminal ops\n\nNotes.\n",
    ".github/references/nested/ignored.md": "# Ignored\n",
    ".github/references/references.json": JSON.stringify({
      references: [
        ".github/instructions/core/legacy-notes.instructions.md",
        ".github/instructions/core/missing.instructions.md",
        "../escape.md",
      ],
    }),
    ".github/instructions/core/legacy-notes.instructions.md":
      NOTE_WITH_PUBLICATION_METADATA,
    ".github/instructions/core/plain.instructions.md":
      "---\nname: plain\ndescription: Plain instruction\nsyncToGlobal: true\n---\n# Plain\n",
    ".github/instructions/core/reference-notes.instructions.md":
      "# Notes\n\nThis file is only read on demand when needed.\n",
  });

  const byPath = new Map(skills.map((skill) => [skill.path, skill]));
  assert.strictEqual(
    byPath.get(".github/references/terminal-ops.md")?.kind,
    "reference",
  );
  assert.strictEqual(
    byPath.get(".github/references/terminal-ops.md")?.name,
    "terminal-ops",
  );
  assert.strictEqual(
    byPath.get(".github/instructions/core/legacy-notes.instructions.md")?.kind,
    "reference",
    "a legacy mirror path opted in through references.json",
  );
  for (const instructionPath of [
    ".github/instructions/core/plain.instructions.md",
    ".github/instructions/core/reference-notes.instructions.md",
  ]) {
    assert.strictEqual(
      byPath.get(instructionPath)?.kind,
      "instruction",
      `${instructionPath} must stay an instruction: neither syncToGlobal, prose, nor its name opts it in`,
    );
  }
  assert.strictEqual(byPath.has(".github/references/references.json"), false);
  assert.strictEqual(byPath.has(".github/references/nested/ignored.md"), false);
  assert.strictEqual(byPath.size, 4);

  assert.strictEqual(
    rawRequests.filter((filePath) => filePath.endsWith("references.json"))
      .length,
    1,
    "the opt-in list is fetched once",
  );
  assert.ok(
    warnings.some((message) => message.includes("missing.instructions.md")),
    "an entry that is not in the tree is logged and ignored",
  );
});

test("a repository without the opt-in list costs no extra request", async () => {
  const { skills, rawRequests } = await scanRepository({
    ".github/instructions/core/plain.instructions.md":
      "---\nname: plain\ndescription: Plain\n---\n# Plain\n",
  });
  assert.deepStrictEqual(
    skills.map((skill) => skill.kind),
    ["instruction"],
  );
  assert.ok(
    rawRequests.every((filePath) => !filePath.endsWith("references.json")),
  );
});

test("an unreadable opt-in list changes nothing", async () => {
  const { skills } = await scanRepository({
    ".github/references/references.json": "{ not json",
    ".github/instructions/core/legacy-notes.instructions.md":
      NOTE_WITH_PUBLICATION_METADATA,
  });
  assert.deepStrictEqual(
    skills.map((skill) => skill.kind),
    ["instruction"],
  );
});

// ---------------------------------------------------------------------------
// Install routing
// ---------------------------------------------------------------------------

function makeUri(fsPath) {
  return { fsPath, toString: () => fsPath };
}

// The installer builds some URIs with Uri.file, which normalizes separators on Windows.
function fileKey(uri) {
  return uri.fsPath.replace(/\\/g, "/");
}

function createInstaller(files, options = {}) {
  const logs = [];
  const vscodeStub = {
    version: "test",
    env: { language: "en" },
    extensions: { getExtension: () => ({ packageJSON: { version: "test" } }) },
    Uri: {
      joinPath: (base, ...segments) =>
        makeUri(path.posix.join(base.fsPath, ...segments)),
      file: (fsPath) => makeUri(fsPath),
    },
    workspace: {
      getConfiguration: () => ({ get: (_key, fallback) => fallback }),
      fs: {
        createDirectory: async () => undefined,
        delete: async (uri) => {
          files.delete(fileKey(uri));
        },
        writeFile: async (uri, content) => {
          files.set(fileKey(uri), Buffer.from(content).toString("utf-8"));
        },
        rename: async (from, to, options) => {
          if (!options?.overwrite && files.has(fileKey(to))) {
            throw Object.assign(new Error("destination exists"), { code: "FileExists" });
          }
          files.set(fileKey(to), files.get(fileKey(from)));
          files.delete(fileKey(from));
        },
        readFile: async (uri) => {
          if (!files.has(fileKey(uri))) {
            throw Object.assign(new Error("not found"), { code: "ENOENT" });
          }
          return Buffer.from(files.get(fileKey(uri)), "utf-8");
        },
        stat: async (uri) => {
          if (!files.has(fileKey(uri))) {
            throw Object.assign(new Error("not found"), { code: "ENOENT" });
          }
          return { size: Buffer.byteLength(files.get(fileKey(uri))) };
        },
        readDirectory: async () => [],
      },
    },
    window: {
      showErrorMessage: async () => undefined,
      showWarningMessage: async () => undefined,
    },
    commands: { executeCommand: async () => undefined },
  };
  const githubResponse = requireTypeScriptModule(
    path.join(srcDir, "githubResponse.ts"),
  );
  const githubCredentialBlocklist = requireTypeScriptModule(
    path.join(srcDir, "githubCredentialBlocklist.ts"),
  );
  const githubFetch = requireTypeScriptModule(
    path.join(srcDir, "githubFetch.ts"),
    {
      "./githubResponse": githubResponse,
      "./githubCredentialBlocklist": githubCredentialBlocklist,
      "./logger": silentLogger,
      "./githubAuth": { resolveGitHubTokenAfterFailure: async () => undefined },
    },
  );
  const installer = requireTypeScriptModule(
    path.join(srcDir, "skillInstaller.ts"),
    {
      vscode: vscodeStub,
      "./i18n": requireTypeScriptModule(path.join(srcDir, "i18n.ts"), {
        vscode: vscodeStub,
      }),
      "./resourceKinds": resourceKinds,
      "./resourceRevision": {
        createRevisionResolver: () => async () => {
          throw new Error("revision lookup is not part of this test");
        },
        classifyRevision: () => "no-baseline",
        matchesGitBlob: () => false,
      },
      "./pathSafety": requireTypeScriptModule(path.join(srcDir, "pathSafety.ts")),
      "./gitHubRefSafety": requireTypeScriptModule(
        path.join(srcDir, "gitHubRefSafety.ts"),
      ),
      "./pluginLocations": requireTypeScriptModule(
        path.join(srcDir, "pluginLocations.ts"),
      ),
      "./githubFetch": githubFetch,
      "./githubResponse": githubResponse,
      "./githubCredentialBlocklist": githubCredentialBlocklist,
      "./skillIndex": {
        loadSkillIndex: async () => ({ sources: [] }),
        getSourceBranch: async () => "main",
        getResourceKind: (resource) => resource.kind || "skill",
        RETIRED_SOURCE_ALIASES: {},
      },
      "./githubAuth": {
        getGitHubToken: async () => undefined,
        hasClearableGitHubToken: async () => false,
        resolveGitHubToken: async () => ({ token: undefined, source: "none" }),
      },
      "./githubDirectoryTraversal": {
        partitionGitHubDirectoryEntries: () => ({ files: [], directories: [] }),
        resolveSymlinkTargetPath: () => undefined,
      },
      "./hookConfigManager": {},
      "./mcpConfigManager": {},
      "./gitignoreManager": {
        synchronizeSkillGitignore: async () => ({ status: "skipped" }),
      },
      "./customizationPaths": {
        DEFAULT_GLOBAL_HOME_DIRECTORY: "~/.copilot",
        getConfiguredGlobalHomeDirectory: () => "~/.copilot",
        getConfiguredSkillsDirectory: () => ".github/skills",
        getConfiguredUserAgentsDirectory: () => "",
        getConfiguredUserInstructionsDirectory: () => "",
        getConfiguredUserPromptsDirectory: () => "",
        getConfiguredWorkspaceAgentsDirectory: () => "",
        getConfiguredWorkspaceHooksDirectory: () => "",
        getConfiguredWorkspaceInstructionsDirectory: () => "",
        getConfiguredWorkspaceMcpDirectory: () => "",
        getConfiguredWorkspacePromptsDirectory: () => "",
        getConfiguredAdditionalSkillRoots: () => [],
        getRelativeSkillsPathForWorkspace: () => ".github/skills",
        resolveConfiguredUri: (_workspaceUri, configured, fallback) => {
          const value = configured || fallback;
          return makeUri(
            value.startsWith("~/")
              ? `/home/user/${value.slice(2)}`
              : `/ws/${value}`,
          );
        },
        resolveSkillsDirectoryUri: () => makeUri("/ws/.github/skills"),
      },
      ...require("./destination-test-stubs")(requireTypeScriptModule, repoRoot),
      // The same in-memory files back the AGENTS.md handling when a test asks for it.
      ...(options.harnessFileSystem
        ? {
            "./harnessInstructionsFs": {
              createVsCodeHarnessFileSystem: () => options.harnessFileSystem,
            },
          }
        : {}),
      "./userDataPaths": {
        getVsCodeUserDataPath: () => "/user-data",
      },
      "./logger": {
        logger: {
          info: (...args) => logs.push(args.join(" ")),
          warn: (...args) => logs.push(args.join(" ")),
          error: (...args) => logs.push(args.join(" ")),
        },
      },
      "./bugReport": { openBugReport: async () => undefined },
    },
  );
  return { installer, vscodeStub };
}

const REFERENCE_BODY = "# Terminal operations\n\nOn-demand notes.\n";

function referenceSkill(overrides = {}) {
  return {
    kind: "reference",
    name: "terminal-operations-notes",
    source: "octo/notes",
    path: ".github/instructions/core/terminal-operations-notes.instructions.md",
    categories: ["references"],
    description: "Terminal notes",
    ...overrides,
  };
}

function stubRawDownload(body) {
  const requested = [];
  global.fetch = async (url) => {
    requested.push(url);
    const bytes = Buffer.from(body, "utf-8");
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => body,
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  };
  return requested;
}

const WORKSPACE = makeUri("/ws");
const REFERENCE_TARGET =
  "/home/user/.copilot/references/terminal-operations-notes.instructions.md";

test("a reference resolves only to the global home and keeps its exact file name", () => {
  const { installer, vscodeStub } = createInstaller(new Map());
  const config = vscodeStub.workspace.getConfiguration();
  for (const targetScope of ["globalHome", "userData"]) {
    assert.strictEqual(
      installer.getResourceTargetUri(WORKSPACE, config, referenceSkill(), {
        targetScope,
      }).fsPath,
      REFERENCE_TARGET,
      targetScope,
    );
  }
  assert.strictEqual(
    installer.getResourceTargetUri(
      WORKSPACE,
      config,
      referenceSkill({ path: ".github/references/plain.md" }),
      { targetScope: "globalHome" },
    ).fsPath,
    "/home/user/.copilot/references/plain.md",
  );
});

test("a reference refuses the workspace and custom scopes instead of falling back", () => {
  const { installer, vscodeStub } = createInstaller(new Map());
  const config = vscodeStub.workspace.getConfiguration();
  for (const options of [
    {},
    { targetScope: "workspace" },
    { targetScope: "custom", customTargetUri: makeUri("/elsewhere") },
  ]) {
    assert.throws(
      () =>
        installer.getResourceTargetUri(WORKSPACE, config, referenceSkill(), options),
      /can only be installed to the Global Resource Home \(~\/\.copilot\/references\)/,
      JSON.stringify(options),
    );
  }
});

test("a reference whose file name is not a safe markdown name is refused", () => {
  const { installer, vscodeStub } = createInstaller(new Map());
  const config = vscodeStub.workspace.getConfiguration();
  for (const badPath of [".github/references/notes.txt", ".github/references/.."]) {
    assert.throws(
      () =>
        installer.getResourceTargetUri(
          WORKSPACE,
          config,
          referenceSkill({ path: badPath }),
          { targetScope: "globalHome" },
        ),
      /Unsafe reference file name/,
      badPath,
    );
  }
});

test("ordinary instructions still install to the instructions directories", () => {
  const { installer, vscodeStub } = createInstaller(new Map());
  const config = vscodeStub.workspace.getConfiguration();
  const instruction = {
    kind: "instruction",
    name: "terminal-operations-notes",
    source: "octo/notes",
    path: ".github/instructions/core/terminal-operations-notes.instructions.md",
    categories: [],
    description: "",
  };
  assert.strictEqual(
    installer.getResourceTargetUri(WORKSPACE, config, instruction, {})
      .fsPath,
    "/ws/.github/instructions/terminal-operations-notes.instructions.md",
  );
  assert.strictEqual(
    installer.getResourceTargetUri(WORKSPACE, config, instruction, {
      targetScope: "globalHome",
    }).fsPath,
    "/home/user/.copilot/instructions/terminal-operations-notes.instructions.md",
  );
});

test("installing a reference writes the bytes and a sidecar under references/", async () => {
  const files = new Map();
  const { installer } = createInstaller(files);
  const requested = stubRawDownload(REFERENCE_BODY);

  const result = await installer.installSkill(
    referenceSkill(),
    WORKSPACE,
    {},
    { targetScope: "globalHome", suppressRecoveryPrompt: true },
  );

  assert.strictEqual(result.destinationUri.fsPath, REFERENCE_TARGET);
  assert.strictEqual(files.get(REFERENCE_TARGET), REFERENCE_BODY);
  assert.deepStrictEqual(
    [...files.keys()].sort(),
    [REFERENCE_TARGET, `${REFERENCE_TARGET}.resource-ninja.json`],
    "nothing is written outside references/",
  );
  const sidecar = JSON.parse(files.get(`${REFERENCE_TARGET}.resource-ninja.json`));
  assert.strictEqual(sidecar.kind, "reference");
  assert.strictEqual(sidecar.source, "octo/notes");
  assert.ok(
    requested[0].includes(
      "/octo/notes/main/.github/instructions/core/terminal-operations-notes.instructions.md",
    ),
  );
});

test("installing a reference in the workspace scope writes nothing", async () => {
  const files = new Map();
  const { installer } = createInstaller(files);
  stubRawDownload(REFERENCE_BODY);
  await assert.rejects(
    installer.installSkill(referenceSkill(), WORKSPACE, {}, {
      targetScope: "workspace",
      suppressRecoveryPrompt: true,
    }),
    /Workspace and custom folders are not supported/,
  );
  assert.strictEqual(files.size, 0);
});

test("the Japanese refusal is localized", () => {
  const { installer, vscodeStub } = createInstaller(new Map());
  vscodeStub.env.language = "ja";
  assert.throws(
    () =>
      installer.getResourceTargetUri(
        WORKSPACE,
        vscodeStub.workspace.getConfiguration(),
        referenceSkill(),
        { targetScope: "workspace" },
      ),
    /グローバル リソース.*にだけインストールできます/,
  );
});

test("an existing reference is never silently overwritten, including one from the same source", async () => {
  const sidecarPath = `${REFERENCE_TARGET}.resource-ninja.json`;
  const attempt = async (seed) => {
    const files = new Map(seed);
    const { installer } = createInstaller(files);
    stubRawDownload(REFERENCE_BODY);
    let error;
    try {
      await installer.installSkill(referenceSkill(), WORKSPACE, {}, {
        targetScope: "globalHome",
        suppressRecoveryPrompt: true,
      });
    } catch (caught) {
      error = caught;
    }
    return { files, error };
  };

  const handWritten = await attempt([[REFERENCE_TARGET, "my own notes"]]);
  assert.match(handWritten.error?.message ?? "", /already holds a file/);
  assert.strictEqual(handWritten.files.get(REFERENCE_TARGET), "my own notes");

  const otherSource = await attempt([
    [REFERENCE_TARGET, "other source notes"],
    [sidecarPath, JSON.stringify({ kind: "reference", source: "someone/else" })],
  ]);
  assert.match(otherSource.error?.message ?? "", /already holds a file/);
  assert.strictEqual(otherSource.files.get(REFERENCE_TARGET), "other source notes");

  const brokenSidecar = await attempt([
    [REFERENCE_TARGET, "kept"],
    [sidecarPath, "{ not json"],
  ]);
  assert.match(brokenSidecar.error?.message ?? "", /already holds a file/);
  assert.strictEqual(brokenSidecar.files.get(REFERENCE_TARGET), "kept");

  const sameSource = await attempt([
    [REFERENCE_TARGET, "older copy"],
    [sidecarPath, JSON.stringify({ kind: "reference", source: "octo/notes" })],
  ]);
  assert.match(sameSource.error?.message ?? "", /already holds a file/);
  assert.strictEqual(sameSource.files.get(REFERENCE_TARGET), "older copy");
});

test("an orphaned reference sidecar is not overwritten", async () => {
  const sidecar = `${REFERENCE_TARGET}.resource-ninja.json`;
  const files = new Map([[sidecar, "other metadata"]]);
  const { installer } = createInstaller(files);
  const requested = stubRawDownload(REFERENCE_BODY);
  await assert.rejects(
    installer.installSkill(referenceSkill(), WORKSPACE, {}, { targetScope: "globalHome" }),
  );
  assert.strictEqual(files.get(sidecar), "other metadata");
  assert.strictEqual(files.has(REFERENCE_TARGET), false);
  assert.strictEqual(requested.length, 0);
});

test("a sidecar created during download is preserved and the partial install is reported", async () => {
  const sidecar = `${REFERENCE_TARGET}.resource-ninja.json`;
  const files = new Map();
  const { installer } = createInstaller(files);
  stubRawDownload(REFERENCE_BODY);
  const fetchDownload = global.fetch;
  global.fetch = async (...args) => {
    const response = await fetchDownload(...args);
    files.set(sidecar, "other metadata");
    return response;
  };
  await assert.rejects(
    installer.installSkill(referenceSkill(), WORKSPACE, {}, { targetScope: "globalHome" }),
    /could not be saved/,
  );
  assert.strictEqual(files.get(sidecar), "other metadata");
  assert.strictEqual(files.get(REFERENCE_TARGET), REFERENCE_BODY);
  assert.ok([...files.keys()].every((key) => !key.endsWith(".tmp")));
});

test("a sidecar created at final rename is preserved and the partial install is reported", async () => {
  const sidecar = `${REFERENCE_TARGET}.resource-ninja.json`;
  const files = new Map();
  const { installer, vscodeStub } = createInstaller(files);
  const rename = vscodeStub.workspace.fs.rename;
  vscodeStub.workspace.fs.rename = async (from, to, options) => {
    if (fileKey(to) === sidecar) {
      assert.strictEqual(options.overwrite, false);
      files.set(sidecar, "concurrent metadata");
    }
    return rename(from, to, options);
  };
  stubRawDownload(REFERENCE_BODY);
  await assert.rejects(
    installer.installSkill(referenceSkill(), WORKSPACE, {}, { targetScope: "globalHome" }),
    /could not be saved/,
  );
  assert.strictEqual(files.get(sidecar), "concurrent metadata");
  assert.strictEqual(files.get(REFERENCE_TARGET), REFERENCE_BODY);
  assert.ok([...files.keys()].every((key) => !key.endsWith(".tmp")));
});

test("a reference that appears during download is preserved", async () => {
  const files = new Map();
  const { installer } = createInstaller(files);
  stubRawDownload(REFERENCE_BODY);
  const fetch = global.fetch;
  global.fetch = async (...args) => {
    const result = await fetch(...args);
    files.set(REFERENCE_TARGET, "concurrent edit");
    return result;
  };
  await assert.rejects(
    installer.installSkill(referenceSkill(), WORKSPACE, {}, {
      targetScope: "globalHome",
      suppressRecoveryPrompt: true,
    }),
  );
  assert.strictEqual(files.get(REFERENCE_TARGET), "concurrent edit");
  assert.deepStrictEqual([...files.keys()], [REFERENCE_TARGET]);
});

test("reference reinstall refuses a different resolved destination", async () => {
  const files = new Map();
  const { installer } = createInstaller(files);
  stubRawDownload(REFERENCE_BODY);
  await assert.rejects(
    installer.installSkill(referenceSkill(), WORKSPACE, {}, {
      targetScope: "globalHome",
      expectedReferenceTarget: makeUri("/other/references/terminal-operations-notes.instructions.md"),
      suppressRecoveryPrompt: true,
    }),
    /destination changed/,
  );
  assert.strictEqual(files.size, 0);
});

test("an earlier instruction copy is neither moved nor removed", async () => {
  const instructionCopy =
    "/home/user/.copilot/instructions/terminal-operations-notes.instructions.md";
  const files = new Map([[instructionCopy, "old instruction copy"]]);
  const { installer } = createInstaller(files);
  stubRawDownload(REFERENCE_BODY);
  await installer.installSkill(referenceSkill(), WORKSPACE, {}, {
    targetScope: "globalHome",
    suppressRecoveryPrompt: true,
  });
  assert.strictEqual(files.get(instructionCopy), "old instruction copy");
  assert.strictEqual(files.get(REFERENCE_TARGET), REFERENCE_BODY);
});

// ---------------------------------------------------------------------------
// Installed-resource scan under the global home
// ---------------------------------------------------------------------------

const FILE_TYPE = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };

test("the global home scan lists references/ separately from instructions", async () => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "reference-home-"));
  const originalEnv = {
    USERPROFILE: process.env.USERPROFILE,
    HOME: process.env.HOME,
  };
  process.env.USERPROFILE = fakeHome;
  process.env.HOME = fakeHome;
  try {
    const write = (relativePath, body) => {
      const absolutePath = path.join(fakeHome, relativePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, body, "utf8");
    };
    write(
      ".copilot/references/terminal-notes.instructions.md",
      "---\nname: terminal-notes\ndescription: Terminal notes\nsyncToGlobal: true\n---\n# Notes\n",
    );
    write(".copilot/references/plain.md", "# Plain reference\n");
    write(".copilot/references/plain.md.resource-ninja.json", '{ "kind": "reference" }');
    write(
      ".copilot/instructions/real.instructions.md",
      "---\nname: real\ndescription: Real instruction\n---\n# Real\n",
    );

    const createUri = (fsPath) => ({
      scheme: "file",
      fsPath: path.normalize(fsPath),
      path: fsPath.replace(/\\/g, "/"),
    });
    const config = {
      get: (key) => (key === "globalResourceHomePreset" ? "copilot" : undefined),
      inspect: () => undefined,
    };
    const vscodeStub = {
      Uri: {
        file: createUri,
        joinPath: (base, ...segments) =>
          createUri(path.join(base.fsPath, ...segments)),
      },
      FileType: FILE_TYPE,
      env: { appName: "Visual Studio Code", appRoot: path.join(fakeHome, "app") },
      extensions: { all: [] },
      workspace: {
        getConfiguration: () => config,
        openTextDocument: async (uri) => {
          const text = fs.readFileSync(uri.fsPath, "utf8");
          return { getText: () => text };
        },
        fs: {
          stat: async (uri) => ({
            type: fs.statSync(uri.fsPath).isDirectory()
              ? FILE_TYPE.Directory
              : FILE_TYPE.File,
          }),
          readDirectory: async (uri) =>
            fs
              .readdirSync(uri.fsPath, { withFileTypes: true })
              .map((dirent) => [
                dirent.name,
                dirent.isDirectory() ? FILE_TYPE.Directory : FILE_TYPE.File,
              ]),
        },
      },
    };
    const { scanUserResources } = requireTypeScriptModule(
      path.join(srcDir, "userResourceScanner.ts"),
      {
        vscode: vscodeStub,
        "./resourceKinds": resourceKinds,
        "./skillIndex": {},
        "./customizationPaths": requireTypeScriptModule(
          path.join(srcDir, "customizationPaths.ts"),
          { vscode: vscodeStub },
        ),
        "./i18n": { isJapanese: () => false },
        "./logger": silentLogger,
        ...require("./destination-test-stubs")(requireTypeScriptModule, repoRoot),
        "./userDataPaths": {
          getVsCodeUserDataPath: () => path.join(fakeHome, "user-data"),
        },
        "./skillInvocationMode": requireTypeScriptModule(
          path.join(srcDir, "skillInvocationMode.ts"),
        ),
        "./skillInstaller": {
          stripSkillMetaLocalPaths: () => undefined,
          readJsonObject: async () => ({ status: "missing" }),
        },
      },
    );

    const resources = await scanUserResources(undefined, false);
    const summary = resources
      .map((resource) => [
        path.relative(fakeHome, resource.fullPath).replace(/\\/g, "/"),
        resource.kind,
        resource.scope,
      ])
      .sort((a, b) => a[0].localeCompare(b[0]));
    assert.deepStrictEqual(summary, [
      [".copilot/instructions/real.instructions.md", "instruction", "globalHome"],
      [".copilot/references/plain.md", "reference", "globalHome"],
      [".copilot/references/terminal-notes.instructions.md", "reference", "globalHome"],
    ]);
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Generated instruction output
// ---------------------------------------------------------------------------

test("generated instruction blocks never include references", () => {
  const vscodeStub = {
    workspace: { getConfiguration: () => ({ get: () => undefined }) },
  };
  const { getInstructionBlockKinds } = requireTypeScriptModule(
    path.join(srcDir, "customizationPaths.ts"),
    { vscode: vscodeStub },
  );
  const everythingOn = {
    get: (key) => (key === "kindsExcluded" ? [] : true),
  };
  for (const scope of ["workspace", "globalHome"]) {
    const kinds = getInstructionBlockKinds(everythingOn, scope);
    assert.ok(kinds.includes("instruction"), scope);
    assert.strictEqual(kinds.includes("reference"), false, scope);
  }

  const instructionManagerSource = fs.readFileSync(
    path.join(srcDir, "instructionManager.ts"),
    "utf8",
  );
  const kindOrder = instructionManagerSource.match(
    /const RESOURCE_KIND_ORDER: ResourceKind\[\] = \[([\s\S]*?)\];/,
  );
  assert.ok(kindOrder, "RESOURCE_KIND_ORDER not found");
  assert.strictEqual(
    kindOrder[1].includes('"reference"'),
    false,
    "reference notes must stay out of every generated catalog",
  );
});

// ---------------------------------------------------------------------------
// Instructions for Codex and Claude Code, through the real installer
// ---------------------------------------------------------------------------

function createMapHarnessFileSystem(files) {
  const key = (fsPath) => fsPath.replace(/\\/g, "/");
  return {
    readText: async (fsPath) => files.get(key(fsPath)),
    writeTextAtomic: async (fsPath, text) => {
      files.set(key(fsPath), text);
    },
    exists: async (fsPath) => files.has(key(fsPath)),
    listFileNames: async (directory) =>
      [...files.keys()]
        .filter((entry) => path.posix.dirname(entry) === key(directory))
        .map((entry) => path.posix.basename(entry)),
    remove: async (fsPath) => {
      files.delete(key(fsPath));
    },
    isDirty: async () => false,
  };
}

function instructionSkill(overrides = {}) {
  return {
    kind: "instruction",
    name: "ts-rules",
    source: "octo/notes",
    path: ".github/instructions/ts-rules.instructions.md",
    categories: [],
    description: "",
    ...overrides,
  };
}

const TS_RULE =
  '---\nname: ts-rules\ndescription: TypeScript\napplyTo: "**/*.ts"\n---\n# TS\n';
const CODEX_FILE = "/ws/instructions/ts-rules.instructions.md";
const CLAUDE_FILE = "/ws/.claude/rules/ts-rules.instructions.md";

function installForHarness(files, body, scope, extra = {}) {
  const { installer, vscodeStub } = createInstaller(files, {
    harnessFileSystem: createMapHarnessFileSystem(files),
  });
  stubRawDownload(body);
  return {
    vscodeStub,
    run: () =>
      installer.installSkill(instructionSkill(), WORKSPACE, {}, {
        targetScope: scope,
        suppressRecoveryPrompt: true,
        ...extra,
      }),
    installer,
  };
}

test("a Codex install keeps the file as is and links the folder once", async () => {
  const files = new Map([["/ws/AGENTS.md", "# Mine\n\nhand written\n"]]);
  const { run } = installForHarness(files, TS_RULE, "codexInstructions");

  const first = await run();
  assert.strictEqual(fileKey(first.destinationUri), CODEX_FILE);
  assert.strictEqual(files.get(CODEX_FILE), TS_RULE, "applyTo stays in the file");
  assert.strictEqual(first.harnessLink.action, "append");
  const agents = files.get("/ws/AGENTS.md");
  assert.ok(agents.startsWith("# Mine\n\nhand written\n"));
  assert.strictEqual(agents.split("resource-ninja-instructions-START").length - 1, 1);
  assert.ok(!agents.includes("ts-rules"), "the block never lists files");

  const second = await run();
  assert.strictEqual(second.harnessLink.action, "unchanged");
  assert.strictEqual(files.get("/ws/AGENTS.md"), agents, "a reinstall adds no second block");
});

test("a Claude install writes the converted rule and edits neither AGENTS.md nor CLAUDE.md", async () => {
  const files = new Map();
  const { run } = installForHarness(files, TS_RULE, "claudeRules");

  const result = await run();
  assert.strictEqual(fileKey(result.destinationUri), CLAUDE_FILE);
  const written = files.get(CLAUDE_FILE);
  assert.match(written, /paths:\n {2}- "\*\*\/\*\.ts"/);
  assert.ok(!/applyTo/.test(written.replace(/# Converted from applyTo:.*\n/, "")));
  assert.ok(written.endsWith("---\n# TS\n"));
  assert.strictEqual(files.has("/ws/AGENTS.md"), false);
  assert.strictEqual(files.has("/ws/CLAUDE.md"), false);
  assert.strictEqual(result.harnessLink, undefined);
  assert.ok(files.has(`${CLAUDE_FILE}.resource-ninja.json`));
});

test("an instruction Claude cannot take as is writes nothing until always-on is chosen", async () => {
  const body = "# Rules\n\nNo applyTo here.\n";
  const files = new Map();
  const first = installForHarness(files, body, "claudeRules");
  await assert.rejects(first.run(), (error) => {
    return error.name === "HarnessInstructionDeferredError" && error.reason === "no-applyTo";
  });
  assert.strictEqual(files.size, 0, "no file and no sidecar");

  const second = installForHarness(files, body, "claudeRules", {
    claudeAlwaysOnWhenDeferred: true,
  });
  await second.run();
  assert.strictEqual(files.get(CLAUDE_FILE), body);
});

test("an AGENTS.override.md keeps AGENTS.md untouched while the install still lands", async () => {
  const files = new Map([["/ws/AGENTS.override.md", "# Override\n"]]);
  const { run } = installForHarness(files, TS_RULE, "codexInstructions");

  const result = await run();
  assert.strictEqual(result.harnessLink.action, "blocked");
  assert.strictEqual(result.harnessLink.blockedReason, "override-file");
  assert.strictEqual(files.has("/ws/AGENTS.md"), false);
  assert.strictEqual(files.get("/ws/AGENTS.override.md"), "# Override\n");
  assert.strictEqual(files.get(CODEX_FILE), TS_RULE);
});

test("a failed file write takes the new AGENTS.md link back out", async () => {
  const files = new Map();
  const { run, vscodeStub } = installForHarness(files, TS_RULE, "codexInstructions");
  vscodeStub.workspace.fs.writeFile = async (uri, content) => {
    if (fileKey(uri) === CODEX_FILE) {
      throw new Error("disk full");
    }
    files.set(fileKey(uri), Buffer.from(content).toString("utf-8"));
  };

  await assert.rejects(run(), /disk full/);
  assert.strictEqual(files.has("/ws/AGENTS.md"), false, "the block that only this install added is gone");
  assert.strictEqual(files.has(CODEX_FILE), false);
  assert.deepStrictEqual([...files.keys()], []);
});

test("a failed file write leaves a pre-existing AGENTS.md exactly as it was", async () => {
  const original = "# Mine\n\nhand written\n";
  const files = new Map([["/ws/AGENTS.md", original]]);
  const { run, vscodeStub } = installForHarness(files, TS_RULE, "codexInstructions");
  vscodeStub.workspace.fs.writeFile = async (uri, content) => {
    if (fileKey(uri) === CODEX_FILE) {
      throw new Error("disk full");
    }
    files.set(fileKey(uri), Buffer.from(content).toString("utf-8"));
  };

  await assert.rejects(run(), /disk full/);
  assert.strictEqual(files.get("/ws/AGENTS.md"), original);
});

test("destinations for other agents accept instructions only", () => {
  const { installer, vscodeStub } = createInstaller(new Map());
  const config = vscodeStub.workspace.getConfiguration();
  for (const kind of ["agent", "prompt", "skill", "hook", "mcp"]) {
    for (const scope of ["claudeRules", "codexInstructions"]) {
      assert.throws(
        () =>
          installer.getResourceTargetUri(
            WORKSPACE,
            config,
            instructionSkill({ kind, path: "x/y.md" }),
            { targetScope: scope },
          ),
        /accept instructions only/,
        `${kind} ${scope}`,
      );
    }
  }
  assert.strictEqual(
    fileKey(
      installer.getResourceTargetUri(WORKSPACE, config, instructionSkill(), {
        targetScope: "claudeRules",
      }),
    ),
    CLAUDE_FILE,
  );
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
      console.error(error);
    }
  }
  console.log(`RESULT=${failed === 0 ? "PASS" : "FAIL"}`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main();
