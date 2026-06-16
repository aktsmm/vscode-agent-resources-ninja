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

async function main() {
  const repoRoot = path.resolve(__dirname, "..");
  const workspaceRoot = path.join(
    repoRoot,
    "output_sessions",
    "coexistence-fixture-test",
  );
  const instructionPath = path.join(workspaceRoot, "AGENTS.md");
  const skillsReadmePath = path.join(
    workspaceRoot,
    ".github",
    "skills",
    "README.md",
  );
  const files = new Map([
    [
      instructionPath,
      "# Agent Skills\n\n<!-- agent-ninja-START -->\n## Agent Skills\n\n> stale owner block\n\n<!-- agent-ninja-END -->\n",
    ],
    [
      skillsReadmePath,
      [
        "# Skills Index",
        "",
        "Manual intro that should survive cleanup.",
        "",
        "<!-- agent-ninja-START -->",
        "## Agent Skills",
        "",
        "| Skill | Description |",
        "| --- | --- |",
        "| [legacy-review](./legacy-review/SKILL.md) | stale compressed block |",
        "",
        "<!-- agent-ninja-END -->",
        "",
        "<!-- resource-ninja-catalog: skill -->",
        "# Agent Skills (Compressed Index)",
        "",
        "| Resource | Path | Description |",
        "| --- | --- | --- |",
        "| [old-ref](./old-ref/SKILL.md) | `old-ref` | old ref row |",
        "",
        "<!-- /resource-ninja-catalog: skill -->",
        "",
      ].join("\n"),
    ],
  ]);

  const directories = [];
  const deleted = [];

  const vscodeStub = {
    Uri: {
      file(fsPath) {
        return { fsPath };
      },
      joinPath(base, ...segments) {
        return { fsPath: path.join(base.fsPath, ...segments) };
      },
    },
    workspace: {
      getConfiguration() {
        return {
          get(key) {
            const values = {
              coexistenceMode: "auto",
              includeLocalResources: true,
              refCatalogFormat: "compact",
            };
            return values[key];
          },
          inspect() {
            return undefined;
          },
        };
      },
      fs: {
        async readFile(uri) {
          if (!files.has(uri.fsPath)) {
            throw new Error(`ENOENT ${uri.fsPath}`);
          }
          return Buffer.from(files.get(uri.fsPath), "utf8");
        },
        async writeFile(uri, content) {
          files.set(uri.fsPath, Buffer.from(content).toString("utf8"));
        },
        async createDirectory(uri) {
          directories.push(uri.fsPath);
        },
        async delete(uri) {
          deleted.push(uri.fsPath);
          files.delete(uri.fsPath);
        },
      },
    },
  };

  const i18nStub = {
    messages: {
      commandPaletteSearchTitle: () =>
        "Agent Resources Ninja: Search Resources",
      emptyResourceEntries: (commandTitle) =>
        `No resource entries listed yet. Use "${commandTitle}" to install workspace or global resources.`,
      emptySkillEntries: (commandTitle) =>
        `No skill entries listed yet. Use "${commandTitle}" to install workspace skills. Agents, prompts, instructions, and hooks stay in their native resource views.`,
    },
  };

  const { updateInstructionFileAtUri } = requireTypeScriptModule(
    path.join(repoRoot, "src", "instructionManager.ts"),
    {
      vscode: vscodeStub,
      "./skillInstaller": {
        getInstalledSkillsWithMeta: async () => [],
        getInstalledSkillsWithMetaFromRoot: async () => [],
      },
      "./localSkillScanner": {
        scanLocalSkills: async () => [
          {
            kind: "skill",
            name: "fresh-review",
            description: "Fresh compressed catalog row",
            source: "local",
            relativePath: ".github/skills/fresh-review",
            fullPath: path.join(
              workspaceRoot,
              ".github",
              "skills",
              "fresh-review",
              "SKILL.md",
            ),
          },
        ],
      },
      "./userResourceScanner": {
        scanUserResources: async () => [],
      },
      "./toolDetector": {
        normalizeInlineOutputFormat: (value) => value,
        resolveOutputFormat: async () => ({
          format: "ref",
          instructionFile: "AGENTS.md",
        }),
      },
      "./constants": {
        SKILL_DESCRIPTION_LIMITS: {
          MAX_TOTAL: 200,
          MAX_EACH: 100,
        },
      },
      "./customizationPaths": {
        DISABLED_INSTRUCTION_FILE: "disabled",
        DEFAULT_WORKSPACE_AGENTS_DIRECTORY: ".github/agents",
        DEFAULT_WORKSPACE_HOOKS_DIRECTORY: ".github/hooks",
        DEFAULT_WORKSPACE_INSTRUCTIONS_DIRECTORY: ".github/instructions",
        DEFAULT_WORKSPACE_MCP_DIRECTORY: ".github/mcp",
        DEFAULT_WORKSPACE_PROMPTS_DIRECTORY: ".github/prompts",
        DEFAULT_GLOBAL_HOME_DIRECTORY: "~/.copilot",
        getConfiguredCoexistenceMode: () => "auto",
        getConfiguredGlobalHomeDirectory: () => undefined,
        getConfiguredInstructionFilePath: () => "AGENTS.md",
        getConfiguredIncludeLocalResources: () => true,
        getInstructionBlockKinds: () => ["skill"],
        getConfiguredSkillsDirectory: () => ".github/skills",
        getConfiguredWorkspaceAgentsDirectory: () => undefined,
        getConfiguredWorkspaceHooksDirectory: () => undefined,
        getConfiguredWorkspaceInstructionsDirectory: () => undefined,
        getConfiguredWorkspaceMcpDirectory: () => undefined,
        getConfiguredWorkspacePromptsDirectory: () => undefined,
        isAbsoluteConfiguredPath: () => false,
        isHomeRelativePath: () => false,
        getRelativeSkillsPathForWorkspace: () => ".github/skills",
        isSameOrChildWorkspacePath: (candidatePath, rootPath) =>
          candidatePath === rootPath ||
          candidatePath.startsWith(`${rootPath}/`),
        resolveInstructionFileUri: () => ({ fsPath: instructionPath }),
        resolveConfiguredUri: (workspaceUri, configuredPath, fallbackPath) => ({
          fsPath: path.join(
            workspaceUri.fsPath,
            (configuredPath || fallbackPath || ".").replace(/\//g, path.sep),
          ),
        }),
        resolveSkillsDirectoryUri: (workspaceUri) => ({
          fsPath: path.join(workspaceUri.fsPath, ".github", "skills"),
        }),
      },
      "./coexistence": {
        getEffectiveOwner: async () => "self",
        isSiblingActive: async () => true,
      },
      "./skillIndex": {
        loadSkillIndex: async () => undefined,
        getResourceKindLabel: (kind) => kind,
      },
      "./i18n": i18nStub,
      "./logger": {
        logger: {
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
        },
      },
    },
  );

  await updateInstructionFileAtUri(
    vscodeStub.Uri.file(workspaceRoot),
    {},
    vscodeStub.Uri.file(instructionPath),
    "AGENTS.md",
  );

  const updatedCatalog = files.get(skillsReadmePath);
  assert.ok(updatedCatalog, "Expected skill catalog README to be written");
  assert.match(updatedCatalog, /# Skills Index/);
  assert.match(updatedCatalog, /Manual intro that should survive cleanup\./);
  assert.doesNotMatch(updatedCatalog, /<!-- agent-ninja-START -->/);
  assert.doesNotMatch(updatedCatalog, /legacy-review/);
  assert.match(updatedCatalog, /<!-- resource-ninja-catalog: skill -->/);
  assert.match(updatedCatalog, /# Agent Skills \(Compressed Index\)/);
  assert.match(updatedCatalog, /fresh-review/);
  assert.ok(
    directories.some((entry) => entry.endsWith(path.join(".github", "skills"))),
    "Expected catalog directory creation",
  );
  assert.deepStrictEqual(
    deleted,
    [],
    "Catalog cleanup should rewrite the README instead of deleting it when manual intro remains",
  );

  console.log("RESULT=PASS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
