#!/usr/bin/env node

const assert = require("assert");
const { createHash } = require("node:crypto");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

// Revision lookups are not part of this test and must never reach the network.
const offlineRevisionStub = {
  createRevisionResolver: () => async () => {
    throw new Error("revision lookup is not part of this test");
  },
  classifyRevision: () => "no-baseline",
};

function requireTypeScriptModule(filePath, stubs = {}) {
  stubs = { "./resourceRevision": offlineRevisionStub, ...stubs };
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

async function main() {
  const githubResponseModule = requireTypeScriptModule(
    path.join(__dirname, "..", "src", "githubResponse.ts"),
  );
  const githubCredentialBlocklistModule = requireTypeScriptModule(
    path.join(__dirname, "..", "src", "githubCredentialBlocklist.ts"),
  );
  const githubFetchModule = requireTypeScriptModule(
    path.join(__dirname, "..", "src", "githubFetch.ts"),
    {
      "./githubResponse": githubResponseModule,
      "./githubCredentialBlocklist": githubCredentialBlocklistModule,
      "./logger": { logger: { info() {}, warn() {}, error() {} } },
      "./githubAuth": {
        resolveGitHubTokenAfterFailure: async () => undefined,
      },
    },
  );
  const traversalModule = requireTypeScriptModule(
    path.join(__dirname, "..", "src", "githubDirectoryTraversal.ts"),
  );

  const writes = [];
  const directories = [];
  const deleted = [];
  const extraEntries = new Map();
  const workspaceRoot = path.join("D:", "tmp", "workspace");
  const uriApi = {
    file: (fsPath) => ({ fsPath }),
    joinPath: (base, ...segments) => ({
      fsPath: path.join(base.fsPath, ...segments),
    }),
  };
  const vscodeStub = {
    Uri: uriApi,
    FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
    workspace: {
      getConfiguration: () => ({ get: () => undefined }),
      fs: {
        readFile: async (uri) => {
          const written = writes.findLast((entry) => entry.path === uri.fsPath);
          if (!written) {
            throw Object.assign(new Error(`ENOENT ${uri.fsPath}`), {
              code: "ENOENT",
            });
          }
          return Buffer.from(written.content, "utf8");
        },
        createDirectory: async (uri) => {
          directories.push(uri.fsPath);
        },
        writeFile: async (uri, content) => {
          writes.push({
            path: uri.fsPath,
            content: Buffer.from(content).toString("utf8"),
          });
        },
        delete: async (uri) => {
          deleted.push(uri.fsPath);
        },
        readDirectory: async (uri) => {
          const entries = new Map();
          for (const directory of directories) {
            if (path.dirname(directory) === uri.fsPath) {
              entries.set(path.basename(directory), 2);
            }
          }
          for (const written of writes) {
            if (path.dirname(written.path) === uri.fsPath) {
              entries.set(path.basename(written.path), 1);
            }
          }
          for (const [name, type] of extraEntries.get(uri.fsPath) || []) {
            entries.set(name, type);
          }
          return [...entries];
        },
        stat: async (uri) => {
          const written = writes.findLast((entry) => entry.path === uri.fsPath);
          if (!written) {
            throw Object.assign(new Error(`ENOENT ${uri.fsPath}`), {
              code: "ENOENT",
            });
          }
          return { size: Buffer.byteLength(written.content, "utf8"), type: 1 };
        },
      },
    },
    window: {
      showWarningMessage: async () => undefined,
      showErrorMessage: async () => undefined,
    },
    commands: {
      executeCommand: async () => undefined,
    },
  };

  const skillContent =
    "---\nname: temp-skill\ndescription: temp\n---\n# temp\n";
  const agentContent = "---\ndescription: helper\n---\nAgent instructions\n";
  const directoryApiUrl =
    "https://api.github.com/repos/octo/demo/contents/skills/temp-skill?ref=main";
  const rawUrl =
    "https://raw.githubusercontent.com/octo/demo/main/skills/temp-skill/SKILL.md";
  const commitSha = "a".repeat(40);
  const pinnedDirectoryUrl = directoryApiUrl.replace("ref=main", `ref=${commitSha}`);
  const pinnedRawUrl = rawUrl.replace("/main/", `/${commitSha}/`);
  const fetchCalls = [];
  let limitedUrl;

  global.fetch = async (url) => {
    fetchCalls.push(url);
    if (url === limitedUrl) {
      return new Response("rate limit exceeded", {
        status: 429,
        headers: { "x-ratelimit-remaining": "0" },
      });
    }
    if (url === directoryApiUrl || url === pinnedDirectoryUrl) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          {
            name: "SKILL.md",
            type: "file",
            download_url: rawUrl,
          },
        ],
      };
    }

    if (url === rawUrl || url === pinnedRawUrl) {
      return {
        ok: true,
        status: 200,
        text: async () => skillContent,
        arrayBuffer: async () => {
          const bytes = Buffer.from(skillContent, "utf-8");
          return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          );
        },
      };
    }

    if (url === `https://raw.githubusercontent.com/octo/demo/${commitSha}/agents/helper.agent.md`) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => {
          const bytes = Buffer.from(agentContent, "utf8");
          return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          );
        },
      };
    }

    throw new Error(`Unexpected fetch ${url}`);
  };

  const baselineRevision = {
    owner: "octo",
    repo: "demo",
    ref: "main",
    remotePath: "skills/temp-skill",
    commitSha,
    contentSha: "b".repeat(40),
    kind: "tree",
  };
  const skillBytes = Buffer.from(skillContent);
  const skillBlobSha = createHash("sha1")
    .update(`blob ${skillBytes.length}\0`)
    .update(skillBytes)
    .digest("hex");
  let manifest = [{ path: "SKILL.md", sha: skillBlobSha, mode: "100644" }];
  let selectedRevision = baselineRevision;
  let revisionFails = false;
  let revisionError;
  let resolverCreations = 0;
  const moduleExports = requireTypeScriptModule(
    path.join(__dirname, "..", "src", "skillInstaller.ts"),
    {
      vscode: vscodeStub,
      "./gitHubRefSafety": requireTypeScriptModule(
        path.join(__dirname, "..", "src", "gitHubRefSafety.ts"),
        {},
      ),
      "./pathSafety": requireTypeScriptModule(
        path.join(__dirname, "..", "src", "pathSafety.ts"),
        {},
      ),
      "./pluginLocations": requireTypeScriptModule(
        path.join(__dirname, "..", "src", "pluginLocations.ts"),
        {},
      ),
      "./skillIndex": {
        getResourceKind: (resource) => resource.kind || "skill",
        loadSkillIndex: async () => ({ sources: [] }),
        getSourceBranch: async () => {
          throw new Error(
            "Temporary rawUrl install should not need getSourceBranch",
          );
        },
        RETIRED_SOURCE_ALIASES: {
          "microsoft-copilot-for-azure-plugin": "microsoft-azure-skills",
        },
      },
      "./i18n": {
        isJapanese: () => false,
      },
      "./githubAuth": {
        getGitHubToken: async () => undefined,
        hasClearableGitHubToken: async () => false,
      },
      "./githubFetch": githubFetchModule,
      "./githubCredentialBlocklist": githubCredentialBlocklistModule,
      "./githubResponse": githubResponseModule,
      "./githubDirectoryTraversal": traversalModule,
      "./customizationPaths": {
        DEFAULT_GLOBAL_HOME_DIRECTORY: "~/.copilot",
        getConfiguredSkillsDirectory: () => ".github/skills",
        getConfiguredGlobalHomeDirectory: () => "~/.copilot",
        getConfiguredUserAgentsDirectory: () => ".github/agents",
        getConfiguredUserInstructionsDirectory: () => ".github/instructions",
        getConfiguredUserPromptsDirectory: () => ".github/prompts",
        getConfiguredWorkspaceAgentsDirectory: () => ".github/agents",
        getConfiguredWorkspaceHooksDirectory: () => ".github/hooks",
        getConfiguredWorkspaceInstructionsDirectory: () =>
          ".github/instructions",
        getConfiguredWorkspaceMcpDirectory: () => ".github/mcp",
        getConfiguredWorkspacePromptsDirectory: () => ".github/prompts",
        getRelativeSkillsPathForWorkspace: () => ".github/skills",
        isSameOrChildWorkspacePath: (candidatePath, rootPath) =>
          candidatePath === rootPath ||
          candidatePath.startsWith(`${rootPath}/`),
        resolveConfiguredUri: (_workspaceUri, configuredPath) => ({
          fsPath: path.join(workspaceRoot, configuredPath || ".github/skills"),
        }),
        resolveSkillsDirectoryUri: () => ({
          fsPath: path.join(workspaceRoot, ".github", "skills"),
        }),
      },
      "./resourceKinds": {
        ...requireTypeScriptModule(
          path.join(__dirname, "..", "src", "resourceKinds.ts"),
          {},
        ),
        detectResourceKindFromPath: () => "skill",
        getPluginRootFromManifestPath: () => undefined,
        isHookConfigFilePath: () => false,
      },
      ...require("./destination-test-stubs")(requireTypeScriptModule, path.join(__dirname, "..")),
      "./userDataPaths": {
        getVsCodeUserDataPath: () => path.join(workspaceRoot, "user-data"),
      },
      "./logger": {
        logger: {
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
        },
      },
      "./bugReport": {
        openBugReport: async () => undefined,
      },
      "./hookConfigManager": {
        updateHookConfigForInstall: async () => undefined,
        updateHookConfigForUninstall: async () => undefined,
      },
      "./mcpConfigManager": {
        updateMcpConfigForInstall: async () => undefined,
      },
      "./resourceRevision": {
        ...requireTypeScriptModule(
          path.join(__dirname, "..", "src", "resourceRevision.ts"),
          {
            "./githubFetch": githubFetchModule,
            "./githubResponse": githubResponseModule,
          },
        ),
        createRevisionResolver: () => {
          resolverCreations++;
          const resolver = async () => {
            if (revisionError) {
              throw revisionError;
            }
            if (revisionFails) {
              throw new Error("offline");
            }
            return selectedRevision;
          };
          resolver.listFiles = async () => manifest;
          return resolver;
        },
      },
      "./gitignoreManager": {
        synchronizeSkillGitignore: async () => ({ status: "skipped" }),
      },
    },
  );

  const result = await moduleExports.installSkill(
    {
      name: "temp-skill",
      source: "octo/demo",
      path: "skills/temp-skill",
      categories: [],
      description: "temp",
      url: "https://github.com/octo/demo/tree/main/skills/temp-skill",
      rawUrl,
    },
    uriApi.file(workspaceRoot),
    { globalStorageUri: uriApi.file(path.join(workspaceRoot, ".storage")) },
    { suppressRecoveryPrompt: true },
  );

  assert.deepStrictEqual(Object.keys(result), ["destinationUri"]);
  assert.ok(
    result.destinationUri.fsPath.endsWith(
      path.join(".github", "skills", "temp-skill"),
    ),
    "the install must report the directory it actually wrote to",
  );
  assert.deepStrictEqual(deleted, []);
  assert.ok(
    directories.some((entry) =>
      entry.endsWith(path.join(".github", "skills", "temp-skill")),
    ),
    "Expected skill install directory creation",
  );
  assert.ok(
    writes.some(
      (entry) =>
        entry.path.endsWith(
          path.join(".github", "skills", "temp-skill", "SKILL.md"),
        ) && entry.content === skillContent,
    ),
    "Expected downloaded SKILL.md to be written instead of fallback placeholder",
  );

  // The baseline recorded with the install is what a later changed-only update compares against.
  const metaWrites = () =>
    writes.filter((entry) => entry.path.endsWith(".skill-meta.json"));
  assert.deepStrictEqual(
    JSON.parse(metaWrites().at(-1).content).sourceRevision,
    baselineRevision,
    "a complete install records the revision it was read at",
  );
  assert.deepStrictEqual(
    fetchCalls,
    [pinnedDirectoryUrl, pinnedRawUrl],
    "ignore a mutable download URL advertised by a pinned directory listing",
  );

  const installTarget = result.destinationUri.fsPath;
  const installAgain = () => moduleExports.installSkill(
    {
      name: "temp-skill",
      source: "octo/demo",
      path: "skills/temp-skill",
      categories: [],
      description: "temp",
      url: "https://github.com/octo/demo/tree/main/skills/temp-skill",
      rawUrl,
    },
    uriApi.file(workspaceRoot),
    { globalStorageUri: uriApi.file(path.join(workspaceRoot, ".storage")) },
    { suppressRecoveryPrompt: true },
  );
  const hasBaseline = () =>
    "sourceRevision" in JSON.parse(metaWrites().at(-1).content);

  manifest = [
    { path: "SKILL.md", sha: skillBlobSha, mode: "100644" },
    { path: "omitted.txt", sha: "c".repeat(40), mode: "100644" },
  ];
  await installAgain();
  assert.ok(!hasBaseline(), "an omitted remote file cannot produce a baseline");

  manifest = [{ path: "SKILL.md", sha: "c".repeat(40), mode: "100644" }];
  await installAgain();
  assert.ok(!hasBaseline(), "mismatched downloaded bytes cannot produce a baseline");

  manifest = [{ path: "SKILL.md", sha: skillBlobSha, mode: "100755" }];
  await installAgain();
  assert.ok(hasBaseline(), "an executable-mode file with verified bytes keeps its baseline");

  manifest = [{ path: "SKILL.md", sha: skillBlobSha, mode: "100644" }];
  extraEntries.set(installTarget, [["local-link", 64]]);
  await installAgain();
  assert.ok(!hasBaseline(), "an existing symlink cannot produce a baseline");
  extraEntries.delete(installTarget);

  // Failing to read a revision never fails the install; it just leaves no baseline.
  revisionFails = true;
  fetchCalls.length = 0;
  await moduleExports.installSkill(
    {
      name: "temp-skill",
      source: "octo/demo",
      path: "skills/temp-skill",
      categories: [],
      description: "temp",
      url: "https://github.com/octo/demo/tree/main/skills/temp-skill",
      rawUrl,
    },
    uriApi.file(workspaceRoot),
    { globalStorageUri: uriApi.file(path.join(workspaceRoot, ".storage")) },
    { suppressRecoveryPrompt: true },
  );
  assert.ok(
    !("sourceRevision" in JSON.parse(metaWrites().at(-1).content)),
    "an unreadable revision leaves no stale baseline behind",
  );
  assert.deepStrictEqual(fetchCalls, [directoryApiUrl, rawUrl]);
  assert.strictEqual(
    resolverCreations,
    1,
    "installs in a short window share one resolver and its repository snapshot",
  );

  revisionFails = false;
  const agentBytes = Buffer.from(agentContent);
  const agentBlobSha = createHash("sha1")
    .update(`blob ${agentBytes.length}\0`)
    .update(agentBytes)
    .digest("hex");
  selectedRevision = {
    ...baselineRevision,
    remotePath: "agents/helper.agent.md",
    contentSha: agentBlobSha,
    kind: "blob",
  };
  fetchCalls.length = 0;
  const agent = {
    kind: "agent",
    name: "helper",
    source: "octo/demo",
    path: "agents/helper.agent.md",
    categories: [],
    description: "helper",
    url: "https://github.com/octo/demo/blob/main/agents/helper.agent.md",
  };
  await moduleExports.installSkill(
    agent,
    uriApi.file(workspaceRoot),
    { globalStorageUri: uriApi.file(path.join(workspaceRoot, ".storage")) },
    { suppressRecoveryPrompt: true },
  );
  const agentMetadata = () =>
    JSON.parse(
      writes.findLast((entry) =>
        entry.path.endsWith("helper.agent.md.resource-ninja.json"),
      ).content,
    );
  assert.deepStrictEqual(agentMetadata().sourceRevision, selectedRevision);
  assert.deepStrictEqual(fetchCalls, [
    `https://raw.githubusercontent.com/octo/demo/${commitSha}/agents/helper.agent.md`,
  ]);
  selectedRevision = { ...selectedRevision, contentSha: "c".repeat(40) };
  await moduleExports.installSkill(
    agent,
    uriApi.file(workspaceRoot),
    { globalStorageUri: uriApi.file(path.join(workspaceRoot, ".storage")) },
    { suppressRecoveryPrompt: true },
  );
  assert.ok(
    !("sourceRevision" in agentMetadata()),
    "a mismatched standalone file cannot inherit a previous baseline",
  );
  selectedRevision = baselineRevision;

  revisionError = new githubResponseModule.GitHubResponseError(
    "rate-limit",
    429,
    "limited",
  );
  fetchCalls.length = 0;
  const beforeRevisionLimit = writes.length;
  await assert.rejects(() => installAgain(), (error) => error.kind === "rate-limit");
  assert.deepStrictEqual(fetchCalls, [], "a revision rate limit must not fall back to a branch request");
  assert.strictEqual(writes.length, beforeRevisionLimit);
  revisionError = undefined;

  for (const blockedUrl of [pinnedDirectoryUrl, pinnedRawUrl]) {
    limitedUrl = blockedUrl;
    fetchCalls.length = 0;
    const metaCount = metaWrites().length;
    await assert.rejects(() => installAgain(), (error) => error.kind === "rate-limit");
    assert.strictEqual(metaWrites().length, metaCount, "a rate-limited install must not write new metadata");
    assert.strictEqual(fetchCalls.at(-1), blockedUrl, "no recovery request follows a rate limit");
  }
  limitedUrl = undefined;

  // A changed-only update skips a skill only when the baseline provably equals upstream.
  const skillForCheck = {
    name: "temp-skill",
    source: "octo/demo",
    path: "skills/temp-skill",
    categories: [],
    description: "temp",
    url: "https://github.com/octo/demo/tree/main/skills/temp-skill",
    rawUrl,
  };
  const context = { globalStorageUri: uriApi.file(path.join(workspaceRoot, ".storage")) };
  const upstream = async () => baselineRevision;
  const status = (baseline, resolver = upstream, skill = skillForCheck) =>
    moduleExports.checkSkillRevisionStatus(skill, baseline, context, resolver);
  assert.strictEqual(await status(baselineRevision), "unchanged");
  assert.strictEqual(
    await status({ ...baselineRevision, contentSha: "c".repeat(40) }),
    "changed",
  );
  assert.strictEqual(await status(undefined), "no-baseline");
  assert.strictEqual(
    await status({ ...baselineRevision, repo: "other" }),
    "different-source",
  );
  assert.strictEqual(
    await status(baselineRevision, async () => {
      throw new Error("offline");
    }),
    "unknown",
    "a failed read is never taken as unchanged",
  );
  await assert.rejects(
    () => status(baselineRevision, async () => {
      throw new githubResponseModule.GitHubResponseError("rate-limit", 429, "limited");
    }),
    (error) => error.kind === "rate-limit",
    "a revision rate limit must reach the batch controller",
  );
  assert.strictEqual(
    await status(baselineRevision, upstream, { ...skillForCheck, kind: "agent" }),
    "unknown",
    "only skills have a folder baseline in this release",
  );

  // A skill with no recorded upstream is local-only, never a failure candidate.
  assert.strictEqual(moduleExports.isLocalInstalledSkillMeta({}), true);
  assert.strictEqual(moduleExports.isLocalInstalledSkillMeta({ source: "local" }), true);
  assert.strictEqual(moduleExports.isLocalInstalledSkillMeta({ source: "unknown" }), true);
  assert.strictEqual(
    moduleExports.isLocalInstalledSkillMeta({ source: "unknown", remotePath: "skills/a" }),
    false,
    "a recorded remote path keeps the skill eligible",
  );
  assert.strictEqual(
    moduleExports.isLocalInstalledSkillMeta({ source: "octo-demo", remotePath: "skills/a" }),
    false,
  );
  assert.strictEqual(
    moduleExports.isLocalInstalledSkillMeta({ source: "octo-demo" }),
    false,
    "a named source without a path is deferred, not local",
  );

  console.log("RESULT=PASS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
