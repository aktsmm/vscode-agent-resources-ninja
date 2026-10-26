const assert = require("node:assert");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

function requireTypeScriptModule(filePath, stubs = {}) {
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
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

const repoRoot = path.resolve(__dirname, "..");
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "resource-ninja-home-"));
const originalEnv = {
  USERPROFILE: process.env.USERPROFILE,
  HOME: process.env.HOME,
};
process.env.USERPROFILE = fakeHome;
process.env.HOME = fakeHome;

function write(relativePath, body) {
  const absolutePath = path.join(fakeHome, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, body, "utf8");
}

function skill(name) {
  return `---\nname: ${name}\ndescription: ${name} skill\n---\n# ${name}\n`;
}

function agent(name) {
  return `---\nname: ${name}\ndescription: ${name} agent\n---\n# ${name}\n`;
}

// ~/.copilot: the selected home, with copies and state that must stay hidden.
write(".copilot/skills/alpha/SKILL.md", skill("alpha"));
write(".copilot/skills/alpha/backup/SKILL.md", skill("alpha-nested"));
write(".copilot/agents/helper.agent.md", agent("helper"));
write(".copilot/backup/ssot-upgrade/skills/alpha/SKILL.md", skill("alpha"));
write(".copilot/backup/ssot-upgrade/agents/helper.agent.md", agent("helper"));
write(".copilot/backups/skills/beta/SKILL.md", skill("beta"));
write(".copilot/backup-2026/skills/gamma/SKILL.md", skill("gamma"));
write(".copilot/.bak/skills/gamma2/SKILL.md", skill("gamma2"));
write(".copilot/edge-cdp-profile/skills/delta/SKILL.md", skill("delta"));
write(".copilot/workspaces/w/skills/eps/SKILL.md", skill("eps"));
write(".copilot/plugin-data/p/skills/zeta/SKILL.md", skill("zeta"));
// One installed plugin that ships three manifests is still one plugin row.
for (const manifest of [
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
  ".github/plugin/plugin.json",
]) {
  write(
    `.copilot/installed-plugins/market/workiq/${manifest}`,
    '{ "name": "workiq" }\n',
  );
}

// ~/.claude and ~/.agents: other known homes.
write(".claude/skills/alpha/SKILL.md", skill("alpha"));
write(".claude/agents/claude-helper.agent.md", agent("claude-helper"));
write(".claude/plugins/cache/p/skills/plugged/SKILL.md", skill("plugged"));
write(".claude/projects/x/skills/proj/SKILL.md", skill("proj"));
write(".claude/backups/skills/old/SKILL.md", skill("old"));
write(".agents/skills/alpha/SKILL.md", skill("alpha"));

// ~/.codex: only skills are Codex resources; state and config stay hidden.
write(".codex/skills/alpha/SKILL.md", skill("alpha"));
write(".codex/skills/.system/sys-skill/SKILL.md", skill("sys-skill"));
write(".codex/agents/codex-helper.agent.md", agent("codex-helper"));
write(".codex/sessions/2026/s/skills/leak/SKILL.md", skill("leak"));
write(".codex/plugins/cache/p/skills/plugged/SKILL.md", skill("plugged"));

const FILE_TYPE = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 };

function createUri(fsPath) {
  return {
    scheme: "file",
    fsPath: path.normalize(fsPath),
    path: fsPath.replace(/\\/g, "/"),
  };
}

function createVscodeStub(preset, overrides = {}) {
  const config = {
    get: (key) =>
      key === "globalResourceHomePreset" ? preset : overrides[key],
    inspect: () => undefined,
  };
  return {
    Uri: {
      file: (value) => createUri(value),
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
}

function loadScanner(preset, overrides) {
  const vscodeStub = createVscodeStub(preset, overrides);
  const resourceKindsModule = requireTypeScriptModule(
    path.join(repoRoot, "src", "resourceKinds.ts"),
  );
  return requireTypeScriptModule(
    path.join(repoRoot, "src", "userResourceScanner.ts"),
    {
      vscode: vscodeStub,
      "./resourceKinds": resourceKindsModule,
      "./skillIndex": {},
      "./customizationPaths": requireTypeScriptModule(
        path.join(repoRoot, "src", "customizationPaths.ts"),
        { vscode: vscodeStub },
      ),
      "./i18n": { isJapanese: () => false },
      "./logger": {
        logger: {
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
        },
      },
      "./userDataPaths": {
        getVsCodeUserDataPath: () => path.join(fakeHome, "user-data"),
      },
      "./skillInvocationMode": requireTypeScriptModule(
        path.join(repoRoot, "src", "skillInvocationMode.ts"),
      ),
      "./skillInstaller": {
        stripSkillMetaLocalPaths: () => undefined,
        readJsonObject: async () => ({ status: "missing" }),
      },
    },
  );
}

function relativePaths(resources) {
  return resources
    .map((resource) =>
      path.relative(fakeHome, resource.fullPath).replace(/\\/g, "/"),
    )
    .sort();
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

async function main() {
  const { scanUserResources } = loadScanner("copilot");

  await asyncTest(
    "the selected home hides backup copies and state directories",
    async () => {
      const resources = await scanUserResources(undefined, false);
      assert.deepStrictEqual(
        relativePaths(resources.filter((resource) => resource.kind !== "plugin")),
        [
          ".copilot/agents/helper.agent.md",
          ".copilot/skills/alpha/SKILL.md",
          ".copilot/skills/alpha/backup/SKILL.md",
        ],
      );
      assert.ok(resources.every((resource) => !resource.isReadOnly));
    },
  );

  await asyncTest(
    "a plugin with several manifests is listed once",
    async () => {
      const resources = await scanUserResources(undefined, false);
      assert.strictEqual(
        resources.filter((resource) => resource.kind === "plugin").length,
        1,
      );
    },
  );

  await asyncTest(
    "a backup folder below a skill is still scanned",
    async () => {
      const resources = await scanUserResources(undefined, false);
      assert.ok(
        relativePaths(resources).includes(
          ".copilot/skills/alpha/backup/SKILL.md",
        ),
      );
    },
  );

  await asyncTest(
    "other homes are opt-in and keep the selected-home callers unchanged",
    async () => {
      const resources = await scanUserResources(undefined, false, {});
      assert.ok(
        relativePaths(resources).every((file) => file.startsWith(".copilot/")),
      );
    },
  );

  await asyncTest(
    "other homes list only resource folders as read-only groups",
    async () => {
      const resources = await scanUserResources(undefined, false, {
        includeAlternateGlobalHomes: true,
      });
      const files = relativePaths(resources);
      assert.deepStrictEqual(
        files.filter((file) => !file.startsWith(".copilot/")),
        [
          ".agents/skills/alpha/SKILL.md",
          ".claude/agents/claude-helper.agent.md",
          ".claude/skills/alpha/SKILL.md",
          ".codex/skills/.system/sys-skill/SKILL.md",
          ".codex/skills/alpha/SKILL.md",
        ],
      );
      const alternates = resources.filter(
        (resource) => resource.isAlternateGlobalHome,
      );
      assert.strictEqual(alternates.length, 5);
      for (const resource of alternates) {
        assert.strictEqual(resource.isReadOnly, true);
        assert.strictEqual(resource.scope, "globalHome");
      }
      assert.deepStrictEqual(
        Array.from(new Set(alternates.map((resource) => resource.scopeLabel)))
          .sort(),
        [
          "Claude-compatible (~/.claude)",
          "Codex (~/.codex)",
          "Open agent resources (~/.agents)",
        ],
      );
      assert.ok(
        resources.some(
          (resource) => resource.scopeLabel === "GitHub Copilot CLI (~/.copilot)",
        ),
        "the selected home is named by tool and root",
      );
    },
  );

  await asyncTest(
    "the same skill in four homes stays four resources",
    async () => {
      const resources = await scanUserResources(undefined, false, {
        includeAlternateGlobalHomes: true,
      });
      const alphas = resources.filter(
        (resource) =>
          resource.kind === "skill" &&
          resource.name === "alpha" &&
          /skills[\\/]alpha[\\/]SKILL\.md$/.test(resource.fullPath),
      );
      assert.strictEqual(alphas.length, 4);
      assert.strictEqual(
        new Set(alphas.map((resource) => resource.rootFsPath)).size,
        4,
      );
    },
  );

  await asyncTest(
    "a selected non-default home is not listed twice as an alternate",
    async () => {
      const { scanUserResources: scanWithClaude } = loadScanner("claude");
      const resources = await scanWithClaude(undefined, false, {
        includeAlternateGlobalHomes: true,
      });
      const files = relativePaths(resources);
      assert.ok(files.includes(".claude/skills/alpha/SKILL.md"));
      assert.ok(
        files.every((file) => !file.startsWith(".claude/backups/")),
        "backups under the selected home stay hidden too",
      );
      const selectedClaude = resources.filter(
        (resource) =>
          resource.fullPath.includes(`${path.sep}.claude${path.sep}`) &&
          resource.isAlternateGlobalHome,
      );
      assert.strictEqual(selectedClaude.length, 0);
      assert.ok(files.includes(".copilot/skills/alpha/SKILL.md"));
    },
  );
  await asyncTest(
    "a Codex home chosen as the selected home is not listed twice",
    async () => {
      const { scanUserResources: scanWithCodex } = loadScanner("custom", {
        globalHomeDirectory: "~/.codex",
      });
      const resources = await scanWithCodex(undefined, false, {
        includeAlternateGlobalHomes: true,
      });
      const codexSkills = resources.filter(
        (resource) =>
          resource.kind === "skill" &&
          resource.fullPath.includes(`${path.sep}.codex${path.sep}`) &&
          /skills[\\/]alpha[\\/]SKILL\.md$/.test(resource.fullPath),
      );
      assert.strictEqual(codexSkills.length, 1);
      assert.ok(!codexSkills[0].isAlternateGlobalHome);
      assert.ok(
        resources.some(
          (resource) =>
            resource.isAlternateGlobalHome &&
            resource.fullPath.includes(`${path.sep}.copilot${path.sep}`),
        ),
        "the other known homes still appear as alternates",
      );
    },
  );
}

main()
  .then(() => console.log("RESULT=PASS"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    fs.rmSync(fakeHome, { recursive: true, force: true });
  });
