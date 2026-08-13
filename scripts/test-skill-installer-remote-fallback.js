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
  const resourceKindsModule = requireTypeScriptModule(
    path.join(srcDir, "resourceKinds.ts"),
    {},
  );

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
    "./pathSafety": requireTypeScriptModule(
      path.join(srcDir, "pathSafety.ts"),
      {},
    ),
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
      ...resourceKindsModule,
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

/**
 * Windows 相当の Uri を再現するハーネス。
 * - joinPath は本物と同じ `path.posix.join` セマンティクスで URI path を伸ばす
 * - fsPath は `/` を `\` に変換するので、entry.name 内のバックスラッシュがそのまま
 *   区切り文字になる（実機で escape が成立する条件）
 * - filesystem stub は `path.win32.normalize` した実際の書き込み先を記録するので、
 *   ガードが無ければ root の外への書き込みがそのまま観測される
 */
function makeWindowsUri(uriPath) {
  return {
    path: uriPath,
    get fsPath() {
      const windowsPath = uriPath.replace(/\//g, "\\");
      return /^\\[A-Za-z]:/.test(windowsPath)
        ? windowsPath.slice(1)
        : windowsPath;
    },
    toString: () => uriPath,
  };
}

/** Splits a recorded write path into the segments below `parentPath`. */
function recordedChildSegments(recordedPath, parentPath) {
  const prefix = `${parentPath}${path.win32.sep}`;
  if (!recordedPath.startsWith(prefix)) {
    return undefined;
  }
  return recordedPath.slice(prefix.length).split(path.win32.sep);
}

function hasRecordedChild(recorded, parentPath) {
  for (const recordedPath of recorded.writes.keys()) {
    if (recordedChildSegments(recordedPath, parentPath)) {
      return true;
    }
  }
  return false;
}

/** `[name, FileType]` pairs, matching what `workspace.fs.readDirectory` returns. */
function listRecordedChildren(recorded, parentPath) {
  const children = new Map();
  for (const recordedPath of recorded.writes.keys()) {
    const segments = recordedChildSegments(recordedPath, parentPath);
    if (!segments || !segments[0]) {
      continue;
    }
    children.set(segments[0], segments.length > 1 ? 2 : 1);
  }
  return [...children.entries()];
}

function loadWindowsInstaller(recorded) {
  const srcDir = path.join(__dirname, "..", "src");
  const realDestination = (uri) => path.win32.normalize(uri.fsPath);
  const resourceKindsModule = requireTypeScriptModule(
    path.join(srcDir, "resourceKinds.ts"),
    {},
  );

  const githubResponse = requireTypeScriptModule(
    path.join(srcDir, "githubResponse.ts"),
    {},
  );
  const githubFetch = requireTypeScriptModule(
    path.join(srcDir, "githubFetch.ts"),
    {
      "./githubResponse": githubResponse,
      "./logger": { logger: { info() {}, warn() {}, error() {} } },
      "./githubAuth": { resolveGitHubTokenAfterFailure: async () => undefined },
    },
  );

  const vscodeStub = {
    version: "test",
    env: { appName: "Visual Studio Code" },
    extensions: { getExtension: () => ({ packageJSON: { version: "test" } }) },
    FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
    Uri: {
      joinPath: (base, ...segments) =>
        makeWindowsUri(path.posix.join(base.path, ...segments)),
      file: (fsPath) =>
        makeWindowsUri(`/${fsPath.replace(/\\/g, "/").replace(/^\/+/, "")}`),
    },
    workspace: {
      getConfiguration: () => ({ get: () => undefined }),
      fs: {
        createDirectory: async (uri) => {
          recorded.directories.push(realDestination(uri));
        },
        delete: async (uri) => {
          recorded.deleted.push(realDestination(uri));
        },
        writeFile: async (uri, content) => {
          recorded.writes.set(
            realDestination(uri),
            Buffer.from(content).toString("utf-8"),
          );
        },
        readFile: async (uri) => {
          const content = recorded.writes.get(realDestination(uri));
          if (content === undefined) {
            throw new Error("not found");
          }
          return Buffer.from(content, "utf-8");
        },
        stat: async (uri) => {
          const target = realDestination(uri);
          const content = recorded.writes.get(target);
          if (content !== undefined) {
            return { size: Buffer.byteLength(content, "utf-8"), type: 1 };
          }
          // Install tests keep the default: only written files exist. Scan tests
          // opt in so a directory holding a recorded write also resolves.
          if (recorded.enumerateWrites && hasRecordedChild(recorded, target)) {
            return { size: 0, type: 2 };
          }
          throw new Error("not found");
        },
        readDirectory: async (uri) => {
          if (!recorded.enumerateWrites) {
            return [];
          }
          return listRecordedChildren(recorded, realDestination(uri));
        },
      },
    },
    window: {
      showErrorMessage: async () => undefined,
      showWarningMessage: async () => undefined,
    },
    commands: { executeCommand: async () => undefined },
  };

  return requireTypeScriptModule(path.join(srcDir, "skillInstaller.ts"), {
    vscode: vscodeStub,
    "./pathSafety": requireTypeScriptModule(
      path.join(srcDir, "pathSafety.ts"),
      {},
    ),
    "./githubFetch": githubFetch,
    "./githubDirectoryTraversal": requireTypeScriptModule(
      path.join(srcDir, "githubDirectoryTraversal.ts"),
      {},
    ),
    "./skillIndex": {
      loadSkillIndex: async () => ({
        sources: [
          {
            id: "traversal-source",
            url: "https://github.com/owner/evil-repo",
            branch: "main",
          },
        ],
      }),
      getSourceBranch: async () => "main",
      getResourceKind: () => "skill",
    },
    "./i18n": { isJapanese: () => false, messages: {} },
    "./githubAuth": {
      getGitHubToken: async () => undefined,
      hasStoredGitHubToken: async () => false,
      resolveGitHubToken: async () => ({ token: undefined, source: "none" }),
    },
    "./hookConfigManager": {
      restoreHookConfigFromBackup: async () => undefined,
      updateHookConfigForInstall: async () => undefined,
      updateHookConfigForUninstall: async () => undefined,
    },
    "./mcpConfigManager": { updateMcpConfigForInstall: async () => undefined },
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
      isSameOrChildWorkspacePath: () => true,
      resolveConfiguredUri: () => makeWindowsUri("/C:/ws/.github/skills"),
      resolveSkillsDirectoryUri: () => makeWindowsUri("/C:/ws/.github/skills"),
    },
    "./resourceKinds": {
      ...resourceKindsModule,
      detectResourceKindFromPath: () => "skill",
      getPluginRootFromManifestPath: () => undefined,
      getResourceMetadataPath: (resourcePath) =>
        `${resourcePath}.resource-meta.json`,
      isHookConfigFilePath: () => false,
    },
    "./userDataPaths": {
      getCopilotHomePath: () => "C:\\Users\\test\\.copilot",
      getVsCodeUserDataPath: () => "C:\\Users\\test\\AppData\\Roaming\\Code",
    },
    "./logger": {
      logger: {
        info: () => undefined,
        warn: (...args) => recorded.warnings.push(args.join(" ")),
        error: () => undefined,
      },
    },
    "./bugReport": { openBugReport: async () => undefined },
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

    // --- Test 14: 悪意ある entry.name は install root の外へ書けない ---
    {
      const recorded = {
        writes: new Map(),
        directories: [],
        deleted: [],
        warnings: [],
      };
      const { installSkill, isSkillInstallIncompleteError } =
        loadWindowsInstaller(recorded);

      const listing = [
        { name: "SKILL.md", type: "file", download_url: "https://raw/skill" },
        {
          name: "..\\..\\..\\evil.txt",
          type: "file",
          download_url: "https://raw/evil",
        },
        { name: "CON", type: "file", download_url: "https://raw/con" },
        {
          name: "..\\..\\..\\evil-dir",
          type: "dir",
          download_url: null,
        },
      ];

      const fetchedUrls = [];
      global.fetch = async (url) => {
        fetchedUrls.push(url);
        if (url.startsWith("https://api.github.com/")) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => (url.includes("evil-dir") ? [] : listing),
            text: async () => "",
          };
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => realSkillMd,
        };
      };

      let thrown;
      try {
        await installSkill(
          {
            name: "traversal-demo",
            source: "traversal-source",
            path: "skills/traversal-demo",
            categories: [],
            description: "Traversal demo",
          },
          makeWindowsUri("/C:/ws"),
          {},
        );
      } catch (error) {
        thrown = error;
      }

      assert.strictEqual(
        isSkillInstallIncompleteError(thrown),
        true,
        "a rejected dependent file must not be reported as a clean install",
      );

      const installRoot = "C:\\ws\\.github\\skills\\traversal-demo";
      assert.deepStrictEqual(
        [...recorded.writes.keys()].sort(),
        [`${installRoot}\\.skill-meta.json`, `${installRoot}\\SKILL.md`],
        "only the safe entry and its metadata may be written",
      );

      // The raw-URL recovery path would also produce SKILL.md, so assert the
      // safe entry actually came through the directory listing.
      assert.ok(
        fetchedUrls.includes("https://raw/skill"),
        "the safe entry must be downloaded through its directory-listing download_url",
      );
      assert.deepStrictEqual(
        fetchedUrls.filter((url) =>
          url.startsWith("https://raw.githubusercontent.com/"),
        ),
        [],
        "the safe entry must not depend on the raw-URL recovery path",
      );
      assert.strictEqual(
        recorded.writes.get(`${installRoot}\\SKILL.md`),
        realSkillMd,
        "the safe entry must be written with the content the listing pointed at",
      );
      assert.strictEqual(
        JSON.parse(recorded.writes.get(`${installRoot}\\.skill-meta.json`))
          .incomplete,
        true,
        "the stored metadata must record the resource as incomplete",
      );

      const touched = [...recorded.writes.keys(), ...recorded.directories];
      const outside = touched.filter(
        (target) =>
          target !== installRoot &&
          !target.startsWith(`${installRoot}${path.win32.sep}`),
      );
      assert.deepStrictEqual(
        outside,
        [],
        `nothing may be written outside ${installRoot}`,
      );

      assert.ok(
        recorded.warnings.some((line) => line.includes("..\\..\\..\\evil.txt")),
        "the rejected entry name must be logged",
      );
      passed++;
    }

    // --- Test 15: リモート由来の .skill-meta.json は保存メタデータに入らない ---
    {
      const recorded = {
        writes: new Map(),
        directories: [],
        deleted: [],
        warnings: [],
      };
      const { installSkill } = loadWindowsInstaller(recorded);

      const installRoot = "C:\\ws\\.github\\skills\\meta-demo";
      const metaFilePath = `${installRoot}\\.skill-meta.json`;
      const attackerPath = "C:\\Users\\victim\\Documents";

      // 以前のインストールで持ち込まれた sidecar が既に置かれている状態。
      recorded.writes.set(
        metaFilePath,
        JSON.stringify({
          name: "meta-demo",
          source: "traversal-source",
          description: "Metadata demo",
          categories: [],
          installedAt: "2020-01-01T00:00:00.000Z",
          customWhenToUse: "user edited note",
          skillFilePath: `${attackerPath}\\SKILL.md`,
          relativePath: "..\\..\\..\\victim",
        }),
      );

      const listing = [
        { name: "SKILL.md", type: "file", download_url: "https://raw/skill" },
        {
          name: ".skill-meta.json",
          type: "file",
          download_url: "https://raw/remote-meta",
        },
      ];

      global.fetch = async (url) => {
        if (url.startsWith("https://api.github.com/")) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => listing,
            text: async () => "",
          };
        }
        if (url === "https://raw/remote-meta") {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () =>
              JSON.stringify({
                name: "meta-demo",
                skillFilePath: `${attackerPath}\\SKILL.md`,
              }),
          };
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => realSkillMd,
        };
      };

      const result = await installSkill(
        {
          name: "meta-demo",
          source: "traversal-source",
          path: "skills/meta-demo",
          categories: [],
          description: "Metadata demo",
        },
        makeWindowsUri("/C:/ws"),
        {},
      );

      assert.deepStrictEqual(
        result,
        {},
        "a sanitized sidecar must not make the install incomplete",
      );

      const storedMeta = JSON.parse(recorded.writes.get(metaFilePath));
      assert.strictEqual(
        Object.prototype.hasOwnProperty.call(storedMeta, "skillFilePath"),
        false,
        "a remote-supplied skillFilePath must never reach the stored metadata",
      );
      assert.strictEqual(
        Object.prototype.hasOwnProperty.call(storedMeta, "relativePath"),
        false,
        "a remote-supplied relativePath must never reach the stored metadata",
      );
      assert.strictEqual(
        storedMeta.customWhenToUse,
        "user edited note",
        "additive non-path fields must still survive the merge",
      );
      assert.strictEqual(storedMeta.name, "meta-demo");
      assert.ok(
        recorded.warnings.some((line) => line.includes(".skill-meta.json")),
        "the skipped remote sidecar must be logged",
      );
      passed++;
    }

    // --- Test 16: ディスク上の .skill-meta.json が主張するパスは走査結果に持ち込まれない ---
    {
      const recorded = {
        writes: new Map(),
        directories: [],
        deleted: [],
        warnings: [],
        // このテストだけ recorded.writes を実ファイルシステムとして列挙させる。
        enumerateWrites: true,
      };
      const { getInstalledSkillsWithMetaFromRoot } =
        loadWindowsInstaller(recorded);

      const skillsRoot = "C:\\ws\\.github\\skills";
      const installRoot = `${skillsRoot}\\poisoned-demo`;
      const attackerPath = "C:\\ws\\src";

      recorded.writes.set(`${installRoot}\\SKILL.md`, realSkillMd);
      // 攻撃者の repository が置いた（あるいは backup から戻った）sidecar が
      // 既にディスク上にある状態。走査より前に write 済みなので、
      // download 時の skip では防げない。
      recorded.writes.set(
        `${installRoot}\\.skill-meta.json`,
        JSON.stringify({
          name: "poisoned-demo",
          source: "traversal-source",
          description: "Poisoned demo",
          categories: [],
          installedAt: "2020-01-01T00:00:00.000Z",
          skillFilePath: `${attackerPath}\\SKILL.md`,
          relativePath: "..\\..\\..\\victim",
        }),
      );

      const metas = await getInstalledSkillsWithMetaFromRoot(
        makeWindowsUri("/C:/ws/.github/skills"),
      );

      assert.strictEqual(metas.length, 1, "the scan must find the resource");
      assert.strictEqual(
        metas[0].skillFilePath,
        `${installRoot}\\SKILL.md`,
        "skillFilePath must be where the scan actually found SKILL.md",
      );
      assert.strictEqual(
        metas[0].relativePath,
        "poisoned-demo",
        "relativePath must be where the scan actually found the folder",
      );
      assert.ok(
        !metas.some(
          (meta) =>
            meta.skillFilePath === `${attackerPath}\\SKILL.md` ||
            meta.relativePath === "..\\..\\..\\victim",
        ),
        "no scanned resource may carry a path taken from the sidecar content",
      );
      assert.strictEqual(
        metas[0].name,
        "poisoned-demo",
        "non-path fields must still be read from the sidecar",
      );
      passed++;
    }

    // --- Test 17: 自前 sidecar 名だけを skip し、同名でないファイルは入れる ---
    {
      const recorded = {
        writes: new Map(),
        directories: [],
        deleted: [],
        warnings: [],
      };
      const { installSkill } = loadWindowsInstaller(recorded);

      const installRoot = "C:\\ws\\.github\\skills\\sidecar-demo";
      const payloadContent = '{"payload":"needed by the resource"}';

      const listing = [
        { name: "SKILL.md", type: "file", download_url: "https://raw/skill" },
        {
          name: ".skill-meta.json",
          type: "file",
          download_url: "https://raw/own-skill-meta",
        },
        {
          name: ".resource-ninja.json",
          type: "file",
          download_url: "https://raw/own-resource-ninja",
        },
        {
          name: "payload.resource-ninja.json",
          type: "file",
          download_url: "https://raw/payload",
        },
      ];

      global.fetch = async (url) => {
        if (url.startsWith("https://api.github.com/")) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => listing,
            text: async () => "",
          };
        }
        if (url === "https://raw/payload") {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () => payloadContent,
          };
        }
        if (url.startsWith("https://raw/own-")) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            text: async () => '{"skillFilePath":"C:\\\\ws\\\\src\\\\SKILL.md"}',
          };
        }
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => realSkillMd,
        };
      };

      const result = await installSkill(
        {
          name: "sidecar-demo",
          source: "traversal-source",
          path: "skills/sidecar-demo",
          categories: [],
          description: "Sidecar demo",
        },
        makeWindowsUri("/C:/ws"),
        {},
      );

      assert.deepStrictEqual(
        result,
        {},
        "skipping only our own sidecars must not make the install incomplete",
      );
      assert.strictEqual(
        recorded.writes.get(`${installRoot}\\payload.resource-ninja.json`),
        payloadContent,
        "a repository file that merely ends with .resource-ninja.json must be installed",
      );
      assert.strictEqual(
        recorded.writes.has(`${installRoot}\\.resource-ninja.json`),
        false,
        "the exact .resource-ninja.json sidecar name must still be skipped",
      );
      assert.strictEqual(
        JSON.parse(recorded.writes.get(`${installRoot}\\.skill-meta.json`))
          .skillFilePath,
        undefined,
        "the exact .skill-meta.json sidecar name must still be skipped",
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
    `PASS: test-skill-installer-remote-fallback.js (${passed}/24 cases)`,
  );
}

run().catch((error) => {
  console.error("FAIL: test-skill-installer-remote-fallback.js");
  console.error(error);
  process.exit(1);
});
