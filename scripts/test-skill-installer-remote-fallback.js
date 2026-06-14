#!/usr/bin/env node
/**
 * Regression: GitHub Contents API の directory listing が失敗しても、
 * `<remotePath>/SKILL.md` を raw URL から直接取得して復旧する。
 *
 * 検証ポイント:
 *  1. raw URL から実体の SKILL.md を取得して書き込み、true を返す
 *  2. raw.githubusercontent.com には token を付けない（SAML/classic PAT 403 回避）
 *  3. 取得失敗（HTTP エラー）時は false を返し、template fallback に委ねる
 *  4. 短すぎる内容（<=100 bytes）は実体とみなさず false を返す
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

function createVscodeStub(writes) {
  return {
    Uri: {
      joinPath: (base, ...segments) =>
        makeUri([base.fsPath, ...segments].join("/")),
      file: (p) => makeUri(p),
    },
    workspace: {
      fs: {
        writeFile: async (uri, content) => {
          writes.set(uri.fsPath, Buffer.from(content).toString("utf-8"));
        },
        stat: async () => {
          throw new Error("not found");
        },
      },
    },
  };
}

function loadInstaller(writes) {
  const srcDir = path.join(__dirname, "..", "src");

  // githubFetch は実装をそのまま使う（raw URL に token を付けない挙動を検証するため）。
  const githubFetch = requireTypeScriptModule(
    path.join(srcDir, "githubFetch.ts"),
    {},
  );

  return requireTypeScriptModule(path.join(srcDir, "skillInstaller.ts"), {
    vscode: createVscodeStub(writes),
    "./githubFetch": githubFetch,
    "./skillIndex": {
      loadSkillIndex: async () => ({ sources: [] }),
      getSourceBranch: async () => "main",
      getResourceKind: () => "skill",
    },
    "./i18n": { isJapanese: () => false },
    "./githubAuth": { getGitHubToken: async () => undefined },
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
      resolveConfiguredUri: () => makeUri("/tmp/resource"),
      resolveSkillsDirectoryUri: () => makeUri("/tmp/.github/skills"),
    },
    "./resourceKinds": {
      detectResourceKindFromPath: () => "skill",
      getPluginRootFromManifestPath: () => undefined,
      getResourceMetadataPath: () => undefined,
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
    "./bugReport": { openBugReport: async () => undefined },
  });
}

async function run() {
  const writes = new Map();
  const installer = loadInstaller(writes);
  const { recoverPrimarySkillMdFromRaw } = installer;

  assert.strictEqual(
    typeof recoverPrimarySkillMdFromRaw,
    "function",
    "recoverPrimarySkillMdFromRaw must be exported",
  );

  const realSkillMd = `---\nname: cloud-run-basics\ndescription: Deploy to Cloud Run\n---\n\n# Cloud Run Basics\n\n${"detailed content ".repeat(20)}`;

  const originalFetch = global.fetch;
  let passed = 0;

  try {
    // --- Test 1: raw 復旧成功 + raw に token を付けない ---
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
      assert.ok(
        !authValue,
        "raw.githubusercontent.com must NOT receive an Authorization header",
      );

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

    // --- Test 2: HTTP エラー時は false（template fallback へ委譲） ---
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

    // --- Test 3: 短すぎる内容は実体とみなさない ---
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

    // --- Test 4: remotePath の前後スラッシュを正規化 ---
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
  } finally {
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete global.fetch;
    }
  }

  console.log(
    `PASS: test-skill-installer-remote-fallback.js (${passed}/4 cases)`,
  );
}

run().catch((error) => {
  console.error("FAIL: test-skill-installer-remote-fallback.js");
  console.error(error);
  process.exit(1);
});
