#!/usr/bin/env node
/**
 * Regression: GitHub Contents API の directory listing が失敗しても、
 * `<remotePath>/SKILL.md` を raw URL から直接取得して復旧する。
 *
 * 検証ポイント:
 *  1. public raw は匿名で取得する
 *  2. private content は匿名 raw 404 の後だけ token 付き Contents API で復旧する
 *  3. 取得失敗（HTTP エラー）時は false を返し、template fallback に委ねる
 *  4. skill 404 は認証状態に応じた復旧導線を出し、suppression 時は UI を出さない
 *
 * 注: 復旧経路でも `.skill-meta.json` は呼び出し側で無条件に保存されるため、
 *     復旧成否に関わらず meta 保存は構造的に保証される。
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");
const ts = require("typescript");

/**
 * stubs を差し込みつつ TypeScript モジュールを require する簡易ハーネス。
 * （test-skill-installer-auth-fallback.js と同じ方式）
 */
function requireTypeScriptModule(tsFilePath, stubs) {
  const source = fs.readFileSync(tsFilePath, "utf-8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: tsFilePath,
  }).outputText;

  const moduleObj = new Module(tsFilePath, module);
  moduleObj.filename = tsFilePath;
  moduleObj.paths = Module._nodeModulePaths(path.dirname(tsFilePath));

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (stubs && Object.prototype.hasOwnProperty.call(stubs, request)) {
      return stubs[request];
    }
    return originalLoad(request, parent, isMain);
  };

  try {
    moduleObj._compile(transpiled, tsFilePath);
  } finally {
    Module._load = originalLoad;
  }

  return moduleObj.exports;
}

function makeUri(fsPath) {
  return {
    fsPath,
    toString: () => fsPath,
  };
}

function createVscodeStub(writes, options = {}) {
  const deleted = options.deleted || [];
  const errorMessages = options.errorMessages || [];
  const executedCommands = options.executedCommands || [];
  const createdDirectories = options.createdDirectories || [];
  const existingDirectories = new Set(options.existingDirectories || []);
  return {
    version: "test",
    extensions: {
      getExtension: () => ({ packageJSON: { version: "test" } }),
    },
    Uri: {
      joinPath: (base, ...segments) =>
        makeUri([base.fsPath, ...segments].join("/")),
      file: (p) => makeUri(p),
    },
    workspace: {
      getConfiguration: () => ({ get: () => undefined }),
      fs: {
        createDirectory: async (uri) => {
          createdDirectories.push(uri.fsPath);
        },
        delete: async (uri) => {
          deleted.push(uri.fsPath);
          for (const key of writes.keys()) {
            if (key === uri.fsPath || key.startsWith(`${uri.fsPath}/`)) {
              writes.delete(key);
            }
          }
        },
        writeFile: async (uri, content) => {
          writes.set(uri.fsPath, Buffer.from(content).toString("utf-8"));
        },
        stat: async (uri) => {
          const content = writes.get(uri.fsPath);
          if (content !== undefined) {
            return { size: Buffer.byteLength(content, "utf-8") };
          }
          if (existingDirectories.has(uri.fsPath)) {
            return { size: 0 };
          }
          throw new Error("not found");
        },
        readDirectory: async (uri) => {
          const normalizedParent = uri.fsPath
            .replace(/\\/g, "/")
            .replace(/\/$/, "");
          const entries = new Map();
          for (const writtenPath of writes.keys()) {
            const normalizedPath = writtenPath.replace(/\\/g, "/");
            if (!normalizedPath.startsWith(`${normalizedParent}/`)) {
              continue;
            }
            const relativePath = normalizedPath.slice(
              normalizedParent.length + 1,
            );
            const name = relativePath.split("/")[0];
            if (name) {
              entries.set(name, 1);
            }
          }
          return [...entries.entries()];
        },
      },
    },
    window: {
      showErrorMessage: async (...args) => {
        errorMessages.push(args);
        return options.errorMessageChoice;
      },
      showWarningMessage: async (...args) => {
        (options.warningMessages || []).push(args);
        return options.warningMessageChoice;
      },
    },
    commands: {
      executeCommand: async (...args) => {
        executedCommands.push(args);
      },
    },
  };
}

function loadInstaller(writes, options = {}) {
  const srcDir = path.join(__dirname, "..", "src");

  // githubFetch は実装をそのまま使い、復旧経路が共通 helper を通ることを検証する。
  const githubResponse = requireTypeScriptModule(
    path.join(srcDir, "githubResponse.ts"),
    {},
  );
  const githubFetch = requireTypeScriptModule(
    path.join(srcDir, "githubFetch.ts"),
    {
      "./githubResponse": githubResponse,
      "./logger": { logger: { info() {}, warn() {}, error() {} } },
      "./githubAuth": {
        resolveGitHubTokenAfterFailure: async () => undefined,
      },
    },
  );

  return requireTypeScriptModule(path.join(srcDir, "skillInstaller.ts"), {
    vscode: createVscodeStub(writes, options),
    "./githubFetch": githubFetch,
    "./skillIndex": {
      loadSkillIndex: async () => options.skillIndex || { sources: [] },
      getSourceBranch: async (source) => source.branch || "main",
      getResourceKind: (resource) => resource.kind || "skill",
    },
    "./i18n": {
      isJapanese: () => false,
      messages: {
        skillDownloadNotFoundNoAuth: (name) =>
          `Skill "${name}" was not found. Private repositories require GitHub authentication.`,
        skillDownloadNotFoundWithAuth: (name) =>
          `Skill "${name}" was not found. GitHub authentication may not have Contents: read access.`,
        openSettings: () => "Open Settings",
        actionUpdateIndex: () => "Update Index",
        actionReportBug: () => "Report Bug",
        actionClearStoredGitHubToken: () => "Clear Stored Token",
      },
    },
    "./githubAuth": {
      getGitHubToken: async () => options.token,
      hasStoredGitHubToken: async () => false,
      resolveGitHubToken: async () => ({
        token: options.token,
        source: options.token ? "secret" : "none",
      }),
    },
    "./githubDirectoryTraversal": {
      partitionGitHubDirectoryEntries: () => ({ files: [], directories: [] }),
      resolveSymlinkTargetPath: () => undefined,
    },
    "./hookConfigManager": {
      restoreHookConfigFromBackup: async () => undefined,
      updateHookConfigForInstall: async () => undefined,
      updateHookConfigForUninstall: async () => undefined,
    },
    "./mcpConfigManager": {
      updateMcpConfigForInstall: async () => undefined,
    },
    "./customizationPaths": {
      DEFAULT_GLOBAL_HOME_DIRECTORY: "~/.copilot",
      getConfiguredGlobalHomeDirectory: () => "~/.copilot",
      getConfiguredSkillsDirectory: () => ".github/skills",
      getConfiguredUserAgentsDirectory: () => "",
      getConfiguredUserInstructionsDirectory: () => "",
      getConfiguredUserPromptsDirectory: () => "",
      getConfiguredWorkspaceAgentsDirectory: () => ".github/agents",
      getConfiguredWorkspaceHooksDirectory: () => ".github/hooks",
      getConfiguredWorkspaceInstructionsDirectory: () => ".github/instructions",
      getConfiguredWorkspaceMcpDirectory: () => ".github/mcp",
      getConfiguredWorkspacePromptsDirectory: () => ".github/prompts",
      getRelativeSkillsPathForWorkspace: () => ".github/skills",
      isSameOrChildWorkspacePath: (candidatePath, rootPath) =>
        candidatePath === rootPath || candidatePath.startsWith(`${rootPath}/`),
      resolveConfiguredUri: () => makeUri("/tmp/resource"),
      resolveSkillsDirectoryUri: () => makeUri("/tmp/.github/skills"),
    },
    "./resourceKinds": {
      detectResourceKindFromPath: () => "skill",
      getPluginRootFromManifestPath: () => undefined,
      getResourceMetadataPath: (resourcePath) =>
        `${resourcePath}.resource-meta.json`,
      isHookConfigFilePath: () => false,
    },
    "./userDataPaths": {
      getCopilotHomePath: () => "/tmp/.copilot",
      getVsCodeUserDataPath: () => "/tmp/vscode-user-data",
    },
    "./logger": {
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      },
    },
    "./bugReport": {
      openBugReport: async (...args) => {
        (options.bugReports || []).push(args);
      },
    },
  });
}

async function run() {
  const writes = new Map();
  const installer = loadInstaller(writes);
  const { normalizeSkillMetaSource, recoverPrimarySkillMdFromRaw } = installer;

  assert.strictEqual(
    typeof recoverPrimarySkillMdFromRaw,
    "function",
    "recoverPrimarySkillMdFromRaw must be exported",
  );

  const realSkillMd = `---\nname: cloud-run-basics\ndescription: Deploy to Cloud Run\n---\n\n# Cloud Run Basics\n\n${"detailed content ".repeat(20)}`;

  const originalFetch = global.fetch;
  let passed = 0;

  try {
    // --- Test 1: retired source metadata は canonical source へ移行 ---
    {
      assert.strictEqual(
        normalizeSkillMetaSource({
          source: "microsoft-copilot-for-azure-plugin",
          remotePath: "plugin/skills/azure-cost",
        }),
        "microsoft-azure-skills",
      );
      passed++;
    }

    // --- Test 2: public raw 復旧成功 + 初回は匿名 ---
    {
      writes.clear();
      const requested = [];
      global.fetch = async (url, options) => {
        requested.push({ url, headers: options && options.headers });
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => realSkillMd,
        };
      };

      const skillPath = makeUri("/tmp/.github/skills/cloud-run-basics");
      const result = await recoverPrimarySkillMdFromRaw(
        skillPath,
        "google",
        "skills",
        "main",
        "skills/cloud/cloud-run-basics",
        "secret-token",
      );

      assert.strictEqual(result, true, "should return true on recovery");
      assert.strictEqual(requested.length, 1, "should fetch exactly once");
      assert.strictEqual(
        requested[0].url,
        "https://raw.githubusercontent.com/google/skills/main/skills/cloud/cloud-run-basics/SKILL.md",
        "should hit the raw SKILL.md URL",
      );

      const headers = requested[0].headers || {};
      const authValue =
        headers.Authorization ||
        headers.authorization ||
        (typeof headers.get === "function" && headers.get("Authorization"));
      assert.ok(!authValue, "public raw request must remain anonymous");

      const written = writes.get(
        "/tmp/.github/skills/cloud-run-basics/SKILL.md",
      );
      assert.ok(written, "SKILL.md must be written");
      assert.ok(
        written.includes("Cloud Run Basics"),
        "written SKILL.md must be the real content, not a template",
      );
      passed++;
    }

    // --- Test 2: private content は匿名 raw 404 後に Contents API で復旧 ---
    {
      writes.clear();
      const requested = [];
      global.fetch = async (url, options = {}) => {
        requested.push({
          url,
          headers: options.headers || {},
          redirect: options.redirect,
        });
        return requested.length === 1
          ? {
              ok: false,
              status: 404,
              statusText: "Not Found",
              text: async () => "not found",
            }
          : {
              ok: true,
              status: 200,
              statusText: "OK",
              text: async () => realSkillMd,
            };
      };

      const skillPath = makeUri("/tmp/.github/skills/private-skill");
      const result = await recoverPrimarySkillMdFromRaw(
        skillPath,
        "owner",
        "private-repo",
        "main",
        "skills/private-skill",
        "private-token",
      );

      assert.strictEqual(result, true);
      assert.strictEqual(requested.length, 2);
      assert.strictEqual(requested[0].headers.Authorization, undefined);
      assert.strictEqual(
        requested[1].headers.Authorization,
        "token private-token",
      );
      assert.strictEqual(
        requested[1].url,
        "https://api.github.com/repos/owner/private-repo/contents/skills/private-skill/SKILL.md?ref=main",
      );
      assert.ok(
        writes.has("/tmp/.github/skills/private-skill/SKILL.md"),
        "authenticated Contents API recovery should write SKILL.md",
      );
      passed++;
    }

    // --- Test 3: HTTP エラー時は false（template fallback へ委譲） ---
    {
      writes.clear();
      global.fetch = async () => ({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: async () => "forbidden",
      });

      const skillPath = makeUri("/tmp/.github/skills/cloud-run-basics");
      const result = await recoverPrimarySkillMdFromRaw(
        skillPath,
        "google",
        "skills",
        "main",
        "skills/cloud/cloud-run-basics",
        undefined,
      );

      assert.strictEqual(result, false, "should return false on HTTP error");
      assert.strictEqual(
        writes.size,
        0,
        "must not write SKILL.md when raw fetch fails",
      );
      passed++;
    }

    // --- Test 4: 短すぎる内容は実体とみなさない ---
    {
      writes.clear();
      global.fetch = async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => "tiny",
      });

      const skillPath = makeUri("/tmp/.github/skills/cloud-run-basics");
      const result = await recoverPrimarySkillMdFromRaw(
        skillPath,
        "google",
        "skills",
        "main",
        "skills/cloud/cloud-run-basics",
        undefined,
      );

      assert.strictEqual(
        result,
        false,
        "should return false for too-short content",
      );
      assert.strictEqual(
        writes.size,
        0,
        "must not write SKILL.md for too-short content",
      );
      passed++;
    }

    // --- Test 5: remotePath の前後スラッシュを正規化 ---
    {
      writes.clear();
      const requested = [];
      global.fetch = async (url, options) => {
        requested.push({ url, headers: options && options.headers });
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => realSkillMd,
        };
      };

      const skillPath = makeUri("/tmp/.github/skills/cloud-run-basics");
      const result = await recoverPrimarySkillMdFromRaw(
        skillPath,
        "google",
        "skills",
        "main",
        "/skills/cloud/cloud-run-basics/",
        undefined,
      );

      assert.strictEqual(result, true, "should recover with slashy remotePath");
      assert.strictEqual(
        requested[0].url,
        "https://raw.githubusercontent.com/google/skills/main/skills/cloud/cloud-run-basics/SKILL.md",
        "leading/trailing slashes in remotePath must be normalized",
      );
      passed++;
    }

    const privateSourceIndex = {
      sources: [
        {
          id: "private-source",
          url: "https://github.com/owner/private-repo",
          branch: "main",
        },
      ],
    };
    const privateSkill = {
      name: "private-demo",
      source: "private-source",
      path: "skills/private-demo.md",
      categories: [],
      description: "Private demo skill",
    };

    // --- Test 6: token なし 404 は cleanup 後に設定導線を出す ---
    {
      writes.clear();
      const deleted = [];
      const errorMessages = [];
      const executedCommands = [];
      const { installSkill } = loadInstaller(writes, {
        skillIndex: privateSourceIndex,
        deleted,
        errorMessages,
        executedCommands,
        errorMessageChoice: "Open Settings",
      });
      global.fetch = async () => ({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "not found",
      });

      await assert.rejects(
        installSkill(privateSkill, makeUri("/tmp/workspace"), {}),
        /Skill not found: private-demo/,
      );
      assert.strictEqual(
        deleted.length,
        1,
        "failed install must be cleaned up",
      );
      assert.strictEqual(errorMessages.length, 1);
      assert.match(errorMessages[0][0], /Private repositories require/);
      assert.deepStrictEqual(errorMessages[0].slice(1), [
        "Open Settings",
        "Update Index",
        "Report Bug",
      ]);
      assert.deepStrictEqual(executedCommands, [
        ["workbench.action.openSettings", "resourceNinja.githubToken"],
      ]);
      passed++;
    }

    // --- Test 7: suppression 時は directory 404 でも cleanup のみ ---
    {
      writes.clear();
      const deleted = [];
      const errorMessages = [];
      const executedCommands = [];
      const bugReports = [];
      const { installSkill } = loadInstaller(writes, {
        skillIndex: privateSourceIndex,
        deleted,
        errorMessages,
        executedCommands,
        bugReports,
      });
      global.fetch = async () => ({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      await assert.rejects(
        installSkill(
          { ...privateSkill, path: "skills/private-demo" },
          makeUri("/tmp/workspace"),
          {},
          { suppressRecoveryPrompt: true },
        ),
        /Skill not found: private-demo/,
      );
      assert.strictEqual(
        deleted.length,
        1,
        "suppressed failure must be cleaned up",
      );
      assert.deepStrictEqual(errorMessages, []);
      assert.deepStrictEqual(executedCommands, []);
      assert.deepStrictEqual(bugReports, []);
      passed++;
    }

    // --- Test 8: token あり 404 の bug report に秘密値を含めない ---
    {
      writes.clear();
      const token = "test-token-must-not-leak";
      const errorMessages = [];
      const bugReports = [];
      const { installSkill } = loadInstaller(writes, {
        skillIndex: privateSourceIndex,
        token,
        errorMessages,
        bugReports,
        errorMessageChoice: "Report Bug",
      });
      global.fetch = async () => ({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "not found",
      });

      await assert.rejects(
        installSkill(privateSkill, makeUri("/tmp/workspace"), {}),
        /Skill not found: private-demo/,
      );
      assert.match(errorMessages[0][0], /Contents: read access/);
      assert.strictEqual(bugReports.length, 1);
      const [issueTitle, issueBody] = bugReports[0];
      assert.match(issueTitle, /Skill not found: private-demo/);
      assert.match(issueBody, /GitHub Authentication: configured/);
      assert.match(issueBody, /Contents: read access/);
      assert.strictEqual(issueBody.includes(token), false);
      passed++;
    }

    // --- Test 9: non-skill file resource も共通 raw helper を利用する ---
    {
      writes.clear();
      const requested = [];
      const { installSkill } = loadInstaller(writes, {
        skillIndex: privateSourceIndex,
        token: "agent-token",
      });
      global.fetch = async (url, options = {}) => {
        requested.push({
          url,
          headers: options.headers || {},
          redirect: options.redirect,
        });
        return requested.length === 1
          ? {
              ok: false,
              status: 404,
              statusText: "Not Found",
              text: async () => "not found",
            }
          : {
              ok: true,
              status: 200,
              statusText: "OK",
              text: async () => "---\nname: private-agent\n---\nAgent body\n",
            };
      };

      const result = await installSkill(
        {
          name: "private-agent",
          kind: "agent",
          source: "private-source",
          path: "agents/private-agent.agent.md",
          categories: [],
          description: "Private agent",
        },
        makeUri("/tmp/workspace"),
        {},
      );

      assert.deepStrictEqual(result, {});
      assert.strictEqual(requested.length, 2);
      assert.strictEqual(requested[0].headers.Authorization, undefined);
      assert.strictEqual(
        requested[1].headers.Authorization,
        "token agent-token",
      );
      assert.strictEqual(
        requested[1].url,
        "https://api.github.com/repos/owner/private-repo/contents/agents/private-agent.agent.md?ref=main",
      );
      assert.strictEqual(
        writes.get("/tmp/resource/private-agent.agent.md"),
        "---\nname: private-agent\n---\nAgent body\n",
      );
      assert.ok(
        [...writes.keys()].some(
          (writtenPath) =>
            writtenPath.replace(/\\/g, "/") ===
            "/tmp/resource/private-agent.agent.md.resource-meta.json",
        ),
        "non-skill install should retain sidecar metadata",
      );
      passed++;
    }

    // --- Test 10: failed non-skill install cleans a newly created parent ---
    {
      writes.clear();
      const deleted = [];
      const createdDirectories = [];
      const { installSkill } = loadInstaller(writes, {
        skillIndex: privateSourceIndex,
        deleted,
        createdDirectories,
      });
      global.fetch = async () => ({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "not found",
      });

      await assert.rejects(
        installSkill(
          {
            name: "missing-agent",
            kind: "agent",
            source: "private-source",
            path: "agents/missing-agent.agent.md",
            categories: [],
            description: "Missing agent",
          },
          makeUri("/tmp/workspace"),
          {},
        ),
        /HTTP 404/,
      );
      assert.ok(createdDirectories.includes("/tmp/resource"));
      assert.ok(
        deleted.includes("/tmp/resource"),
        "new empty parent directory should be removed",
      );
      assert.strictEqual(writes.size, 0);
      passed++;
    }

    // --- Test 11: failed non-skill install preserves an existing parent ---
    {
      writes.clear();
      const deleted = [];
      const { installSkill } = loadInstaller(writes, {
        skillIndex: privateSourceIndex,
        deleted,
        existingDirectories: ["/tmp/resource"],
      });
      global.fetch = async () => ({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "not found",
      });

      await assert.rejects(
        installSkill(
          {
            name: "missing-agent",
            kind: "agent",
            source: "private-source",
            path: "agents/missing-agent.agent.md",
            categories: [],
            description: "Missing agent",
          },
          makeUri("/tmp/workspace"),
          {},
        ),
        /HTTP 404/,
      );
      assert.strictEqual(
        deleted.includes("/tmp/resource"),
        false,
        "pre-existing parent directory must be preserved",
      );
      passed++;
    }

    // --- Test 12: unresolved non-skill source creates no filesystem artifact ---
    {
      writes.clear();
      const createdDirectories = [];
      const { installSkill } = loadInstaller(writes, {
        skillIndex: { sources: [] },
        createdDirectories,
      });

      await assert.rejects(
        installSkill(
          {
            name: "unknown-agent",
            kind: "agent",
            source: "unknown-source",
            path: "agents/unknown.agent.md",
            categories: [],
            description: "Unknown agent",
          },
          makeUri("/tmp/workspace"),
          {},
        ),
        /Source not found for agent/,
      );
      assert.deepStrictEqual(createdDirectories, []);
      assert.strictEqual(writes.size, 0);
      passed++;
    }

    // --- Test 13: failed plugin install removes its newly created root ---
    {
      writes.clear();
      const deleted = [];
      const { installSkill } = loadInstaller(writes, {
        skillIndex: privateSourceIndex,
        deleted,
      });
      global.fetch = async () => ({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({ message: "Not Found" }),
      });

      await assert.rejects(
        installSkill(
          {
            name: "private-plugin",
            kind: "plugin",
            source: "private-source",
            path: "plugin/.plugin/plugin.json",
            pluginRoot: "plugin",
            pluginManifestPath: "plugin/.plugin/plugin.json",
            categories: [],
            description: "Private plugin",
          },
          makeUri("/tmp/workspace"),
          {},
        ),
        /Failed to list directory: 404/,
      );
      const normalizedDeleted = deleted.map((entry) =>
        entry.replace(/\\/g, "/"),
      );
      assert.ok(
        normalizedDeleted.includes(
          "/tmp/workspace/.github/plugins/private-plugin",
        ),
        "new plugin root should be removed after a fatal listing failure",
      );
      passed++;
    }

    // --- Test 14: failed hook install removes its newly created folder ---
    {
      writes.clear();
      const deleted = [];
      const { installSkill } = loadInstaller(writes, {
        skillIndex: privateSourceIndex,
        deleted,
      });
      global.fetch = async () => ({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({ message: "Not Found" }),
      });

      await assert.rejects(
        installSkill(
          {
            name: "private-hook",
            kind: "hook",
            source: "private-source",
            path: "hooks/private-hook/README.md",
            categories: [],
            description: "Private hook",
          },
          makeUri("/tmp/workspace"),
          {},
        ),
        /Failed to list directory: 404/,
      );
      assert.ok(
        deleted
          .map((entry) => entry.replace(/\\/g, "/"))
          .includes("/tmp/resource/private-hook"),
        "new hook resource folder should be removed after a fatal listing failure",
      );
      passed++;
    }

    // --- Test 15: failed reinstall preserves an existing non-skill file ---
    {
      writes.clear();
      writes.set(
        "/tmp/resource/existing-agent.agent.md",
        "existing agent content",
      );
      const deleted = [];
      const { installSkill } = loadInstaller(writes, {
        skillIndex: privateSourceIndex,
        deleted,
        existingDirectories: ["/tmp/resource"],
      });
      global.fetch = async () => ({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "not found",
      });

      await assert.rejects(
        installSkill(
          {
            name: "existing-agent",
            kind: "agent",
            source: "private-source",
            path: "agents/existing-agent.agent.md",
            categories: [],
            description: "Existing agent",
          },
          makeUri("/tmp/workspace"),
          {},
        ),
        /HTTP 404/,
      );
      assert.strictEqual(
        writes.get("/tmp/resource/existing-agent.agent.md"),
        "existing agent content",
      );
      assert.strictEqual(
        deleted
          .map((entry) => entry.replace(/\\/g, "/"))
          .includes("/tmp/resource/existing-agent.agent.md"),
        false,
        "pre-existing resource file must not be deleted",
      );
      passed++;
    }

    // --- Test 16: cleanup preserves a newly created but non-empty parent ---
    {
      writes.clear();
      writes.set("/tmp/resource/concurrent.txt", "concurrent content");
      const deleted = [];
      const { installSkill } = loadInstaller(writes, {
        skillIndex: privateSourceIndex,
        deleted,
      });
      global.fetch = async () => ({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "not found",
      });

      await assert.rejects(
        installSkill(
          {
            name: "missing-agent",
            kind: "agent",
            source: "private-source",
            path: "agents/missing-agent.agent.md",
            categories: [],
            description: "Missing agent",
          },
          makeUri("/tmp/workspace"),
          {},
        ),
        /HTTP 404/,
      );
      assert.strictEqual(
        deleted.includes("/tmp/resource"),
        false,
        "non-empty parent directory must not be deleted",
      );
      assert.strictEqual(
        writes.get("/tmp/resource/concurrent.txt"),
        "concurrent content",
      );
      passed++;
    }

    // --- Test 11: template だけの install は成功として返さない ---
    {
      writes.clear();
      const warnings = [];
      const { installSkill, isSkillInstallIncompleteError } = loadInstaller(
        writes,
        {
          skillIndex: privateSourceIndex,
          warningMessages: warnings,
        },
      );
      global.fetch = async () => ({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "boom",
      });

      let thrown;
      try {
        await installSkill(privateSkill, makeUri("/tmp/workspace"), {});
      } catch (error) {
        thrown = error;
      }

      assert.ok(thrown, "a template-only install must not resolve");
      assert.strictEqual(isSkillInstallIncompleteError(thrown), true);
      assert.strictEqual(thrown.skillName, "private-demo");

      const metaPath = [...writes.keys()].find((key) =>
        key.endsWith(".skill-meta.json"),
      );
      assert.ok(metaPath, "install metadata must still be written");
      assert.strictEqual(JSON.parse(writes.get(metaPath)).incomplete, true);
      assert.strictEqual(
        warnings.some((args) => /was not installed correctly/.test(args[0])),
        true,
        "an interactive install must surface the recovery dialog",
      );
      passed++;
    }

    // --- Test 12: bulk 経路は dialog を出さずに例外だけ返す ---
    {
      writes.clear();
      const warnings = [];
      const { installSkill, isSkillInstallIncompleteError } = loadInstaller(
        writes,
        {
          skillIndex: privateSourceIndex,
          warningMessages: warnings,
        },
      );
      global.fetch = async () => ({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "boom",
      });

      let thrown;
      try {
        await installSkill(
          privateSkill,
          makeUri("/tmp/workspace"),
          {},
          { suppressRecoveryPrompt: true },
        );
      } catch (error) {
        thrown = error;
      }

      assert.strictEqual(isSkillInstallIncompleteError(thrown), true);
      assert.deepStrictEqual(warnings, []);
      passed++;
    }

    // --- Test 13: 入れ直しに成功したら incomplete フラグが消える ---
    {
      writes.clear();
      const { installSkill } = loadInstaller(writes, {
        skillIndex: privateSourceIndex,
      });
      global.fetch = async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => realSkillMd,
      });

      const result = await installSkill(
        privateSkill,
        makeUri("/tmp/workspace"),
        {},
      );

      assert.deepStrictEqual(result, {});
      const metaPath = [...writes.keys()].find((key) =>
        key.endsWith(".skill-meta.json"),
      );
      assert.ok(metaPath, "install metadata must be written");
      assert.strictEqual(
        Object.prototype.hasOwnProperty.call(
          JSON.parse(writes.get(metaPath)),
          "incomplete",
        ),
        false,
        "a healthy install must not keep the incomplete flag",
      );
      passed++;
    }
  } finally {
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete global.fetch;
    }
  }

  console.log(
    `PASS: test-skill-installer-remote-fallback.js (${passed}/20 cases)`,
  );
}

run().catch((error) => {
  console.error("FAIL: test-skill-installer-remote-fallback.js");
  console.error(error);
  process.exit(1);
});
