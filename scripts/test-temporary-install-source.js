#!/usr/bin/env node

const assert = require("assert");
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
  const workspaceRoot = path.join("D:", "tmp", "workspace");
  const uriApi = {
    file: (fsPath) => ({ fsPath }),
    joinPath: (base, ...segments) => ({
      fsPath: path.join(base.fsPath, ...segments),
    }),
  };
  const vscodeStub = {
    Uri: uriApi,
    workspace: {
      getConfiguration: () => ({ get: () => undefined }),
      fs: {
        readFile: async (uri) => {
          const written = writes.find((entry) => entry.path === uri.fsPath);
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
        stat: async (uri) => {
          const written = writes.find((entry) => entry.path === uri.fsPath);
          if (!written) {
            throw Object.assign(new Error(`ENOENT ${uri.fsPath}`), {
              code: "ENOENT",
            });
          }
          return { size: Buffer.byteLength(written.content, "utf8") };
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
  const directoryApiUrl =
    "https://api.github.com/repos/octo/demo/contents/skills/temp-skill?ref=main";
  const rawUrl =
    "https://raw.githubusercontent.com/octo/demo/main/skills/temp-skill/SKILL.md";

  global.fetch = async (url) => {
    if (url === directoryApiUrl) {
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

    if (url === rawUrl) {
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

    throw new Error(`Unexpected fetch ${url}`);
  };

  const baselineRevision = {
    owner: "octo",
    repo: "demo",
    ref: "main",
    remotePath: "skills/temp-skill",
    commitSha: "a".repeat(40),
    contentSha: "b".repeat(40),
    kind: "tree",
  };
  let revisionFails = false;
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
        getResourceMetadataPath: () => path.join(workspaceRoot, "meta.json"),
        isHookConfigFilePath: () => false,
      },
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
          return async () => {
            if (revisionFails) {
              throw new Error("offline");
            }
            return baselineRevision;
          };
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

  // Failing to read a revision never fails the install; it just leaves no baseline.
  revisionFails = true;
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
  assert.strictEqual(
    resolverCreations,
    1,
    "installs in a short window share one resolver and its repository snapshot",
  );

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
