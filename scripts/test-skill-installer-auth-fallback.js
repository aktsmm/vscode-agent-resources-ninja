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

  const tests = [
    {
      name: "listGitHubDirectory retries unauthenticated after auth failure for API requests",
      run: async () => {
        const fetchCalls = [];
        global.fetch = async (url, options = {}) => {
          const headers = options.headers || {};
          fetchCalls.push({ url, headers });

          if (fetchCalls.length === 1) {
            assert.strictEqual(
              headers.Authorization,
              "token test-token",
              "First request should use provided token",
            );
            return new Response(JSON.stringify({ message: "Forbidden" }), {
              status: 403,
              headers: { "content-type": "application/json" },
            });
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
              loadSkillIndex: async () => ({ sources: [] }),
              getSourceBranch: async () => "main",
            },
            "./i18n": {
              isJapanese: () => false,
            },
            "./githubAuth": {
              getGitHubToken: async () => undefined,
              hasClearableGitHubToken: async () => false,
            },
            "./githubFetch": githubFetchModule,
            "./githubResponse": githubResponseModule,
            "./githubCredentialBlocklist": githubCredentialBlocklistModule,
            "./githubDirectoryTraversal": traversalModule,
            "./hookConfigManager": {
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
              getConfiguredWorkspaceInstructionsDirectory: () =>
                ".github/instructions",
              getConfiguredWorkspaceMcpDirectory: () => ".github/mcp",
              getConfiguredWorkspacePromptsDirectory: () => ".github/prompts",
              getRelativeSkillsPathForWorkspace: () => ".github/skills",
              isSameOrChildWorkspacePath: (candidatePath, rootPath) =>
                candidatePath === rootPath ||
                candidatePath.startsWith(`${rootPath}/`),
              resolveConfiguredUri: () => ({ fsPath: "/tmp/resource" }),
              resolveSkillsDirectoryUri: () => ({
                fsPath: "/tmp/.github/skills",
              }),
            },
            "./resourceKinds": {
              ...requireTypeScriptModule(
                path.join(__dirname, "..", "src", "resourceKinds.ts"),
                {},
              ),
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
            "./bugReport": {
              openBugReport: async () => undefined,
            },
          },
        );

        const { listGitHubDirectory } = moduleExports;
        assert.strictEqual(typeof listGitHubDirectory, "function");

        const entries = await listGitHubDirectory(
          "github",
          "awesome-copilot",
          "skills/create-github-action-workflow-specification",
          "feature/x y",
          "test-token",
        );

        assert.strictEqual(fetchCalls.length, 2, "Should retry exactly once");
        assert.strictEqual(
          fetchCalls[0].url,
          "https://api.github.com/repos/github/awesome-copilot/contents/skills/create-github-action-workflow-specification?ref=feature%2Fx%20y",
        );
        assert.strictEqual(entries.length, 1);
        assert.strictEqual(entries[0].name, "SKILL.md");
      },
    },
    {
      name: "fetchGitHubWithOptionalAuthRetry keeps public raw requests anonymous",
      run: async () => {
        const fetchCalls = [];
        global.fetch = async (url, options = {}) => {
          fetchCalls.push({
            url,
            headers: options.headers || {},
            method: options.method,
            redirect: options.redirect,
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
          "Public raw fetch should not retry",
        );
        assert.ok(
          !fetchCalls[0].headers.Authorization,
          "Public raw fetch should not attach Authorization header",
        );
      },
    },
    {
      name: "fetchGitHubWithOptionalAuthRetry uses Contents API after a private raw 404",
      run: async () => {
        const fetchCalls = [];
        global.fetch = async (url, options = {}) => {
          fetchCalls.push({
            url,
            headers: options.headers || {},
            redirect: options.redirect,
          });
          return fetchCalls.length === 1
            ? { ok: false, status: 404 }
            : { ok: true, status: 200 };
        };

        const response =
          await githubFetchModule.fetchGitHubWithOptionalAuthRetry(
            "https://raw.githubusercontent.com/owner/private-repo/main/SKILL.md",
            {
              accept: "text/plain",
              token: "test-token",
              authenticatedUrl:
                "https://api.github.com/repos/owner/private-repo/contents/SKILL.md?ref=main",
            },
          );

        assert.strictEqual(response.status, 200);
        assert.strictEqual(fetchCalls.length, 2, "Should retry exactly once");
        assert.strictEqual(
          fetchCalls[0].headers.Authorization,
          undefined,
          "First raw request should be anonymous",
        );
        assert.strictEqual(
          fetchCalls[1].headers.Authorization,
          "token test-token",
          "Private Contents API retry should use the token",
        );
        assert.strictEqual(
          fetchCalls[1].url,
          "https://api.github.com/repos/owner/private-repo/contents/SKILL.md?ref=main",
        );
      },
    },
    {
      name: "fetchGitHubWithOptionalAuthRetry stops after a missing raw retry",
      run: async () => {
        const fetchCalls = [];
        global.fetch = async (url, options = {}) => {
          fetchCalls.push({
            url,
            headers: options.headers || {},
            redirect: options.redirect,
          });
          return { ok: false, status: 404 };
        };

        const response =
          await githubFetchModule.fetchGitHubWithOptionalAuthRetry(
            "https://raw.githubusercontent.com/owner/private-repo/main/missing.md",
            {
              accept: "text/plain",
              token: "test-token",
              authenticatedUrl:
                "https://api.github.com/repos/owner/private-repo/contents/missing.md?ref=main",
            },
          );

        assert.strictEqual(response.status, 404);
        assert.strictEqual(fetchCalls.length, 2, "Should stop after one retry");
        assert.strictEqual(fetchCalls[0].headers.Authorization, undefined);
        assert.strictEqual(
          fetchCalls[1].headers.Authorization,
          "token test-token",
        );
        assert.strictEqual(
          fetchCalls[1].url,
          "https://api.github.com/repos/owner/private-repo/contents/missing.md?ref=main",
        );
      },
    },
    {
      name: "fetchGitHubWithOptionalAuthRetry does not treat lookalike hosts as raw",
      run: async () => {
        const fetchCalls = [];
        global.fetch = async (url, options = {}) => {
          fetchCalls.push({ url, options });
          return { ok: false, status: 404 };
        };

        await githubFetchModule.fetchGitHubWithOptionalAuthRetry(
          "https://raw.githubusercontent.com.example/owner/repo/main/SKILL.md",
          {
            accept: "text/plain",
            token: "test-token",
          },
        );

        assert.strictEqual(
          fetchCalls.length,
          1,
          "Lookalike raw host should not enter the authenticated raw retry",
        );
        assert.strictEqual(
          fetchCalls[0].options.headers.Authorization,
          undefined,
          "Lookalike raw host must not receive an Authorization header",
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
            return new Response(JSON.stringify({ message: "Forbidden" }), {
              status: 403,
              headers: { "content-type": "application/json" },
            });
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
            "./gitHubRefSafety": requireTypeScriptModule(
              path.join(__dirname, "..", "src", "gitHubRefSafety.ts"),
              {},
            ),
            "./githubFetch": githubFetchModule,
            "./logger": {
              logger: {
                info: () => undefined,
                warn: () => undefined,
                error: () => undefined,
              },
            },
            "./sharedResourceIndexStore": {
              loadSharedStoresIntoSkillIndex: async (index) => index,
              syncSharedStoresFromSkillIndex: async () => undefined,
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
          4,
          "Should probe raw and authenticated Contents API for main/master",
        );
        const rawHeadCalls = headCalls.filter((call) =>
          call.url.startsWith("https://raw.githubusercontent.com/"),
        );
        const apiHeadCalls = headCalls.filter((call) =>
          call.url.startsWith("https://api.github.com/"),
        );
        assert.strictEqual(rawHeadCalls.length, 2);
        assert.strictEqual(apiHeadCalls.length, 2);
        assert.ok(
          rawHeadCalls.every((call) => !call.headers.Authorization),
          "Raw HEAD checks should not attach Authorization header",
        );
        assert.ok(
          apiHeadCalls.every(
            (call) => call.headers.Authorization === "token branch-token",
          ),
          "Private Contents API HEAD checks should use Authorization",
        );
      },
    },
    {
      name: "getDefaultBranch expires only an unverified fallback",
      run: async () => {
        let now = 1_000;
        let apiAvailable = false;
        const fetchCalls = [];
        global.fetch = async (url, options = {}) => {
          fetchCalls.push({
            url: String(url),
            method: options.method || "GET",
          });
          if (options.method === "HEAD") {
            return new Response("Not Found", { status: 404 });
          }
          return apiAvailable
            ? new Response(JSON.stringify({ default_branch: "trunk" }), {
                status: 200,
                headers: { "content-type": "application/json" },
              })
            : new Response("Unavailable", { status: 404 });
        };

        const skillIndexModule = requireTypeScriptModule(
          path.join(__dirname, "..", "src", "skillIndex.ts"),
          {
            vscode: {},
            "./gitHubRefSafety": requireTypeScriptModule(
              path.join(__dirname, "..", "src", "gitHubRefSafety.ts"),
              {},
            ),
            "./githubFetch": githubFetchModule,
            "./logger": {
              logger: {
                info: () => undefined,
                warn: () => undefined,
                error: () => undefined,
              },
            },
            "./sharedResourceIndexStore": {
              loadSharedStoresIntoSkillIndex: async (index) => index,
              syncSharedStoresFromSkillIndex: async () => undefined,
            },
          },
        );
        const repoUrl = "https://github.com/example/repo-negative-ttl";
        const readBranch = () =>
          skillIndexModule.getDefaultBranch(
            repoUrl,
            undefined,
            "skills/example/SKILL.md",
            () => now,
          );

        assert.strictEqual(await readBranch(), "main");
        const callsAfterFallback = fetchCalls.length;
        apiAvailable = true;
        assert.strictEqual(await readBranch(), "main");
        assert.strictEqual(
          fetchCalls.length,
          callsAfterFallback,
          "the short-lived fallback should prevent an immediate retry storm",
        );

        now += skillIndexModule.DEFAULT_BRANCH_NEGATIVE_CACHE_TTL_MS;
        assert.strictEqual(await readBranch(), "trunk");
        const callsAfterRecovery = fetchCalls.length;
        now += skillIndexModule.DEFAULT_BRANCH_NEGATIVE_CACHE_TTL_MS * 10;
        assert.strictEqual(await readBranch(), "trunk");
        assert.strictEqual(
          fetchCalls.length,
          callsAfterRecovery,
          "a branch confirmed by the API should remain positively cached",
        );
      },
    },
    {
      name: "getDefaultBranch expires a fallback from missing API branch data",
      run: async () => {
        let now = 5_000;
        let apiBranch;
        let fetchCount = 0;
        global.fetch = async (_url, options = {}) => {
          fetchCount++;
          if (options.method === "HEAD") {
            return new Response("Not Found", { status: 404 });
          }
          return new Response(JSON.stringify({ default_branch: apiBranch }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        };

        const skillIndexModule = requireTypeScriptModule(
          path.join(__dirname, "..", "src", "skillIndex.ts"),
          {
            vscode: {},
            "./gitHubRefSafety": requireTypeScriptModule(
              path.join(__dirname, "..", "src", "gitHubRefSafety.ts"),
              {},
            ),
            "./githubFetch": githubFetchModule,
            "./logger": {
              logger: {
                info: () => undefined,
                warn: () => undefined,
                error: () => undefined,
              },
            },
            "./sharedResourceIndexStore": {
              loadSharedStoresIntoSkillIndex: async (index) => index,
              syncSharedStoresFromSkillIndex: async () => undefined,
            },
          },
        );
        const repoUrl = "https://github.com/example/repo-empty-api-branch";
        const readBranch = () =>
          skillIndexModule.getDefaultBranch(
            repoUrl,
            undefined,
            "skills/example/SKILL.md",
            () => now,
          );

        assert.strictEqual(await readBranch(), "main");
        const callsAfterFallback = fetchCount;
        apiBranch = "trunk";
        assert.strictEqual(await readBranch(), "main");
        assert.strictEqual(fetchCount, callsAfterFallback);

        now += skillIndexModule.DEFAULT_BRANCH_NEGATIVE_CACHE_TTL_MS;
        assert.strictEqual(await readBranch(), "trunk");
        assert.ok(fetchCount > callsAfterFallback);
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
