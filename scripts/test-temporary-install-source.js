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
  const githubFetchModule = requireTypeScriptModule(
    path.join(__dirname, "..", "src", "githubFetch.ts"),
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
            throw new Error(`ENOENT ${uri.fsPath}`);
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

  const skillContent = "---\nname: temp-skill\ndescription: temp\n---\n# temp\n";
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
      };
    }

    throw new Error(`Unexpected fetch ${url}`);
  };

  const moduleExports = requireTypeScriptModule(
    path.join(__dirname, "..", "src", "skillInstaller.ts"),
    {
      vscode: vscodeStub,
      "./skillIndex": {
        getResourceKind: (resource) => resource.kind || "skill",
        loadSkillIndex: async () => ({ sources: [] }),
        getSourceBranch: async () => {
          throw new Error("Temporary rawUrl install should not need getSourceBranch");
        },
      },
      "./i18n": {
        isJapanese: () => false,
      },
      "./githubAuth": {
        getGitHubToken: async () => undefined,
      },
      "./githubFetch": githubFetchModule,
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
        getConfiguredWorkspaceInstructionsDirectory: () => ".github/instructions",
        getConfiguredWorkspaceMcpDirectory: () => ".github/mcp",
        getConfiguredWorkspacePromptsDirectory: () => ".github/prompts",
        getRelativeSkillsPathForWorkspace: () => ".github/skills",
        resolveConfiguredUri: (_workspaceUri, configuredPath) => ({
          fsPath: path.join(workspaceRoot, configuredPath || ".github/skills"),
        }),
        resolveSkillsDirectoryUri: () => ({
          fsPath: path.join(workspaceRoot, ".github", "skills"),
        }),
      },
      "./resourceKinds": {
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

  assert.deepStrictEqual(result, {});
  assert.deepStrictEqual(deleted, []);
  assert.ok(
    directories.some((entry) => entry.endsWith(path.join(".github", "skills", "temp-skill"))),
    "Expected skill install directory creation",
  );
  assert.ok(
    writes.some(
      (entry) =>
        entry.path.endsWith(path.join(".github", "skills", "temp-skill", "SKILL.md")) &&
        entry.content === skillContent,
    ),
    "Expected downloaded SKILL.md to be written instead of fallback placeholder",
  );

  console.log("RESULT=PASS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});