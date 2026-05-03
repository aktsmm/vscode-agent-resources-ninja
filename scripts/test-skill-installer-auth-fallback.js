#!/usr/bin/env node

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

async function main() {
  const traversalModule = requireTypeScriptModule(
    path.join(__dirname, "..", "src", "githubDirectoryTraversal.ts"),
  );
  const githubFetchModule = requireTypeScriptModule(
    path.join(__dirname, "..", "src", "githubFetch.ts"),
  );

  const tests = [
    {
      name: "listGitHubDirectory retries unauthenticated after auth failure for API requests",
      run: async () => {
        const fetchCalls = [];
        global.fetch = async (_url, options = {}) => {
          const headers = options.headers || {};
          fetchCalls.push(headers);

          if (fetchCalls.length === 1) {
            assert.strictEqual(
              headers.Authorization,
              "token test-token",
              "First request should use provided token",
            );
            return {
              ok: false,
              status: 403,
              json: async () => ({ message: "Forbidden" }),
            };
          }

          assert.ok(
            !headers.Authorization,
            "Retry should omit Authorization header",
          );
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                name: "SKILL.md",
                type: "file",
                download_url:
                  "https://raw.githubusercontent.com/github/awesome-copilot/main/skills/create-github-action-workflow-specification/SKILL.md",
              },
            ],
          };
        };

        const moduleExports = requireTypeScriptModule(
          path.join(__dirname, "..", "src", "skillInstaller.ts"),
          {
            vscode: {},
            "./skillIndex": {
              loadSkillIndex: async () => ({ sources: [] }),
              getSourceBranch: async () => "main",
            },
            "./i18n": {
              isJapanese: () => false,
            },
            "./githubAuth": {
              getGitHubToken: async () => undefined,
            },
            "./githubFetch": githubFetchModule,
            "./githubDirectoryTraversal": traversalModule,
            "./hookConfigManager": {
              updateHookConfigForInstall: async () => undefined,
              updateHookConfigForUninstall: async () => undefined,
            },
            "./customizationPaths": {
              resolveSkillsDirectoryUri: () => ({
                fsPath: "/tmp/.github/skills",
              }),
            },
            "./resourceKinds": {
              detectResourceKindFromPath: () => "skill",
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
          },
        );

        const { listGitHubDirectory } = moduleExports;
        assert.strictEqual(typeof listGitHubDirectory, "function");

        const entries = await listGitHubDirectory(
          "github",
          "awesome-copilot",
          "skills/create-github-action-workflow-specification",
          "main",
          "test-token",
        );

        assert.strictEqual(fetchCalls.length, 2, "Should retry exactly once");
        assert.strictEqual(entries.length, 1);
        assert.strictEqual(entries[0].name, "SKILL.md");
      },
    },
    {
      name: "fetchGitHubWithOptionalAuthRetry skips auth and retry for raw preview URLs",
      run: async () => {
        const fetchCalls = [];
        global.fetch = async (url, options = {}) => {
          fetchCalls.push({
            url,
            headers: options.headers || {},
            method: options.method,
          });
          return {
            ok: true,
            status: 200,
            text: async () => "# SKILL",
          };
        };

        const response =
          await githubFetchModule.fetchGitHubWithOptionalAuthRetry(
            "https://raw.githubusercontent.com/github/awesome-copilot/main/skills/example/SKILL.md",
            {
              accept: "text/plain",
              token: "test-token",
            },
          );

        assert.strictEqual(response.ok, true);
        assert.strictEqual(
          fetchCalls.length,
          1,
          "Raw preview fetch should not retry",
        );
        assert.ok(
          !fetchCalls[0].headers.Authorization,
          "Raw preview fetch should not attach Authorization header",
        );
      },
    },
    {
      name: "getDefaultBranch retries repo API unauthenticated after auth failure",
      run: async () => {
        const fetchCalls = [];
        global.fetch = async (url, options = {}) => {
          const method = options.method || "GET";
          const headers = options.headers || {};
          fetchCalls.push({ url, method, headers });

          if (method === "HEAD") {
            return { ok: false, status: 404 };
          }

          if (fetchCalls.filter((call) => call.method === "GET").length === 1) {
            assert.strictEqual(
              headers.Authorization,
              "token branch-token",
              "API request should use token first",
            );
            return {
              ok: false,
              status: 403,
              json: async () => ({ message: "Forbidden" }),
            };
          }

          assert.ok(
            !headers.Authorization,
            "Branch retry should omit Authorization header",
          );
          return {
            ok: true,
            status: 200,
            json: async () => ({ default_branch: "main" }),
          };
        };

        const skillIndexModule = requireTypeScriptModule(
          path.join(__dirname, "..", "src", "skillIndex.ts"),
          {
            vscode: {},
            "./githubFetch": githubFetchModule,
            "./logger": {
              logger: {
                info: () => undefined,
                warn: () => undefined,
                error: () => undefined,
              },
            },
          },
        );

        const branch = await skillIndexModule.getDefaultBranch(
          "https://github.com/example/repo-auth-retry",
          "branch-token",
          "skills/example/SKILL.md",
        );

        assert.strictEqual(branch, "main");
        const getCalls = fetchCalls.filter((call) => call.method === "GET");
        assert.strictEqual(getCalls.length, 2, "Repo API should retry once");
        const headCalls = fetchCalls.filter((call) => call.method === "HEAD");
        assert.strictEqual(
          headCalls.length,
          2,
          "Should still probe main/master before API fallback",
        );
        assert.ok(
          headCalls.every((call) => !call.headers.Authorization),
          "Raw HEAD checks should not attach Authorization header",
        );
      },
    },
  ];

  try {
    for (const test of tests) {
      await test.run();
      console.log(`PASS ${test.name}`);
    }
    console.log("RESULT=PASS");
  } catch (error) {
    console.error("FAIL auth fallback regression");
    console.error(error instanceof Error ? error.stack : error);
    process.exit(1);
  }
}

main();
