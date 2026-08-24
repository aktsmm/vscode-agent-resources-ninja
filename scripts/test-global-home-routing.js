#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
);
const nls = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.nls.json"), "utf8"),
);
const instructionManagerSource = fs.readFileSync(
  path.join(repoRoot, "src", "instructionManager.ts"),
  "utf8",
);
const customizationPathsSource = fs.readFileSync(
  path.join(repoRoot, "src", "customizationPaths.ts"),
  "utf8",
);
const resourceKindsSource = fs.readFileSync(
  path.join(repoRoot, "src", "resourceKinds.ts"),
  "utf8",
);
const userResourceScannerSource = fs.readFileSync(
  path.join(repoRoot, "src", "userResourceScanner.ts"),
  "utf8",
);

function loadCustomizationPaths() {
  const ts = require("typescript");
  const Module = require("module");
  const filePath = path.join(repoRoot, "src", "customizationPaths.ts");
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  });
  const stubs = {
    vscode: {
      workspace: { getConfiguration: () => ({ get: () => undefined }) },
      Uri: { file: (fsPath) => ({ fsPath }) },
      env: { appName: "Visual Studio Code" },
    },
    "./skillIndex": {},
  };
  const loaded = new Module(filePath, module);
  loaded.filename = filePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(filePath));
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) =>
    Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad(request, parent, isMain);
  try {
    loaded._compile(transpiled.outputText, filePath);
  } finally {
    Module._load = originalLoad;
  }
  return loaded.exports;
}

const customizationPaths = loadCustomizationPaths();

function toWorkspaceConfiguration(values = {}) {
  return {
    get: (key) => values[key],
    inspect: (key) => ({ key, globalValue: values[key] }),
  };
}

const normalizeConfiguredPath = (value) => value.replace(/\\/g, "/");
const isHomeRelativePath = (configuredPath) =>
  customizationPaths.isHomeRelativePath(configuredPath);
const isAbsoluteConfiguredPath = (configuredPath) =>
  customizationPaths.isAbsoluteConfiguredPath(configuredPath);

const getDefaultGlobalHomeDirectoryForPreset = (preset) =>
  customizationPaths.getDefaultGlobalHomeDirectoryForPreset(preset);

const getConfiguredGlobalHomeDirectory = (config = {}) =>
  customizationPaths.getConfiguredGlobalHomeDirectory(
    toWorkspaceConfiguration(config),
  );

const getGlobalInstructionFileNameForPreset = (preset) =>
  customizationPaths.getGlobalInstructionFileNameForPreset(preset);

function normalizeFsPathForCompare(fsPath) {
  return path
    .normalize(fsPath)
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function isSameOrInside(baseFsPath, targetFsPath) {
  const base = normalizeFsPathForCompare(baseFsPath);
  const target = normalizeFsPathForCompare(targetFsPath);
  return target === base || target.startsWith(`${base}/`);
}

function isGlobalInstructionTarget({
  workspaceFsPath,
  globalHomeFsPath,
  instructionFsPath,
  instructionPath,
}) {
  if (isSameOrInside(globalHomeFsPath, instructionFsPath)) return true;
  if (isHomeRelativePath(instructionPath)) return true;
  return (
    isAbsoluteConfiguredPath(instructionPath) &&
    !isSameOrInside(workspaceFsPath, instructionFsPath)
  );
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("copilot preset resolves to ~/.copilot", () => {
  assert.strictEqual(
    getConfiguredGlobalHomeDirectory({ globalResourceHomePreset: "copilot" }),
    "~/.copilot",
  );
});

test("claude preset resolves to ~/.claude", () => {
  assert.strictEqual(
    getConfiguredGlobalHomeDirectory({ globalResourceHomePreset: "claude" }),
    "~/.claude",
  );
});

test("agents preset resolves to ~/.agents", () => {
  assert.strictEqual(
    getConfiguredGlobalHomeDirectory({ globalResourceHomePreset: "agents" }),
    "~/.agents",
  );
});

test("custom preset without override falls back predictably", () => {
  assert.strictEqual(
    getConfiguredGlobalHomeDirectory({ globalResourceHomePreset: "custom" }),
    "~/.copilot",
  );
});

test("non-empty override wins over preset", () => {
  assert.strictEqual(
    getConfiguredGlobalHomeDirectory({
      globalResourceHomePreset: "claude",
      globalHomeDirectory: "~/agent-resources",
    }),
    "~/agent-resources",
  );
});

test("home-relative Copilot CLI instruction target stays global with claude home", () => {
  assert.strictEqual(
    isGlobalInstructionTarget({
      workspaceFsPath: "C:/repo/project",
      globalHomeFsPath: "C:/Users/alice/.claude",
      instructionFsPath: "C:/Users/alice/.copilot/copilot-instructions.md",
      instructionPath: "~/.copilot/copilot-instructions.md",
    }),
    true,
  );
});

test("root AGENTS.md target stays workspace scoped", () => {
  assert.strictEqual(
    isGlobalInstructionTarget({
      workspaceFsPath: "C:/repo/project",
      globalHomeFsPath: "C:/Users/alice/.copilot",
      instructionFsPath: "C:/repo/project/AGENTS.md",
      instructionPath: "AGENTS.md",
    }),
    false,
  );
});

test("repository copilot instructions target stays workspace scoped", () => {
  assert.strictEqual(
    isGlobalInstructionTarget({
      workspaceFsPath: "C:/repo/project",
      globalHomeFsPath: "C:/Users/alice/.copilot",
      instructionFsPath: "C:/repo/project/.github/copilot-instructions.md",
      instructionPath: ".github/copilot-instructions.md",
    }),
    false,
  );
});

test("absolute custom target outside workspace is global scoped", () => {
  assert.strictEqual(
    isGlobalInstructionTarget({
      workspaceFsPath: "C:/repo/project",
      globalHomeFsPath: "C:/Users/alice/.copilot",
      instructionFsPath: "D:/agent-shared/AGENTS.md",
      instructionPath: "D:/agent-shared/AGENTS.md",
    }),
    true,
  );
});

test("absolute custom target inside workspace remains workspace scoped", () => {
  assert.strictEqual(
    isGlobalInstructionTarget({
      workspaceFsPath: "C:/repo/project",
      globalHomeFsPath: "C:/Users/alice/.copilot",
      instructionFsPath: "C:/repo/project/docs/AGENTS.md",
      instructionPath: "C:/repo/project/docs/AGENTS.md",
    }),
    false,
  );
});

test("mixed separators still match inside global home", () => {
  assert.strictEqual(
    isSameOrInside(
      "C:\\Users\\alice\\.copilot",
      "C:/Users/alice/.copilot/skills/review/SKILL.md",
    ),
    true,
  );
});

test("mixed case paths still match inside global home", () => {
  assert.strictEqual(
    isSameOrInside(
      "C:/Users/Alice/.Copilot",
      "c:/users/alice/.copilot/skills/review/SKILL.md",
    ),
    true,
  );
});

test("trailing slash base paths do not break inside checks", () => {
  assert.strictEqual(
    isSameOrInside(
      "C:/Users/alice/.copilot/",
      "C:/Users/alice/.copilot/skills/review/SKILL.md",
    ),
    true,
  );
});

test("sibling prefix is not treated as inside", () => {
  assert.strictEqual(
    isSameOrInside(
      "C:/Users/alice/.copilot",
      "C:/Users/alice/.copilot-backup/skills/review/SKILL.md",
    ),
    false,
  );
});

test("manifest exposes expected global home presets", () => {
  const config = packageJson.contributes.configuration.properties;
  assert.deepStrictEqual(
    config["resourceNinja.globalResourceHomePreset"].enum,
    ["copilot", "claude", "agents", "custom"],
  );
});

test("manifest exposes Copilot CLI local instruction target", () => {
  const config = packageJson.contributes.configuration.properties;
  assert.ok(
    config["resourceNinja.instructionFile"].enum.includes(
      "~/.copilot/copilot-instructions.md",
    ),
  );
});

test("settings copy explains override precedence", () => {
  assert.match(
    nls["config.globalHomeDirectory.markdownDescription"],
    /overrides the selected/,
  );
});

test("implementation uses global instruction target classification", () => {
  assert.match(instructionManagerSource, /function isGlobalInstructionTarget/);
  assert.match(
    instructionManagerSource,
    /isHomeRelativePath\(instructionPath\)/,
  );
  assert.match(
    instructionManagerSource,
    /!isSameOrInside\(workspaceUri, instructionUri\)/,
  );
});

test("implementation keeps known preset defaults centralized", () => {
  assert.match(customizationPathsSource, /case "claude"[\s\S]*"~\/\.claude"/);
  assert.match(customizationPathsSource, /case "agents"[\s\S]*"~\/\.agents"/);
});

test("global instruction file names follow product-native presets", () => {
  assert.strictEqual(
    getGlobalInstructionFileNameForPreset("copilot"),
    "copilot-instructions.md",
  );
  assert.strictEqual(
    getGlobalInstructionFileNameForPreset("claude"),
    "CLAUDE.md",
  );
  assert.strictEqual(
    getGlobalInstructionFileNameForPreset("agents"),
    "AGENTS.md",
  );
  assert.strictEqual(
    getGlobalInstructionFileNameForPreset("custom"),
    "AGENTS.md",
  );
});

test("implementation exposes global instruction resolver", () => {
  assert.match(
    customizationPathsSource,
    /function getGlobalInstructionFileNameForPreset/,
  );
  assert.match(
    customizationPathsSource,
    /case "copilot"[\s\S]*"copilot-instructions\.md"/,
  );
  assert.match(customizationPathsSource, /case "claude"[\s\S]*"CLAUDE\.md"/);
  assert.match(customizationPathsSource, /resolveGlobalInstructionFileUri/);
  assert.match(
    customizationPathsSource,
    /getConfiguredGlobalHomeDirectory\(config\)/,
  );
});

test("resource detection includes product-native instruction files", () => {
  assert.match(resourceKindsSource, /isNativeInstructionFilePath/);
  assert.match(resourceKindsSource, /copilot-instructions\.md/);
  assert.match(resourceKindsSource, /\.codex\/agents\.md/);
  assert.match(resourceKindsSource, /\.gemini\/gemini\.md/);
});

test("resource detection includes Copilot CLI hook and MCP config files", () => {
  assert.match(resourceKindsSource, /isHookConfigFilePath/);
  assert.match(resourceKindsSource, /hooks\\\/\[\^\/\]\+\\\.json/);
  assert.match(resourceKindsSource, /mcp-config\.json/);
  assert.match(resourceKindsSource, /isResourceMetadataSidecarPath/);
});

test("global home scan prioritizes resource directories before runtime noise", () => {
  assert.match(userResourceScannerSource, /RESOURCE_DIRECTORY_NAMES/);
  assert.match(userResourceScannerSource, /"skills"/);
  assert.match(userResourceScannerSource, /"instructions"/);
  assert.match(userResourceScannerSource, /"hooks"/);
  assert.match(
    userResourceScannerSource,
    /prioritizeResourceDirectories:[\s\S]*root\.scope === "globalHome"/,
  );
});

test("global home scope labels expose selected product root", () => {
  assert.match(userResourceScannerSource, /function getGlobalHomeToolLabel/);
  assert.match(userResourceScannerSource, /GitHub Copilot CLI/);
  assert.match(userResourceScannerSource, /Custom resource home/);
});

test("global home scan skips Copilot CLI runtime directories", () => {
  assert.match(
    userResourceScannerSource,
    /GLOBAL_HOME_RUNTIME_DIRECTORY_NAMES/,
  );
  assert.match(userResourceScannerSource, /"logs"/);
  assert.match(userResourceScannerSource, /"session-state"/);
  // `repos` holds Copilot cloud-agent git worktrees whose `.github/skills/**`
  // would otherwise leak into the global-home tree.
  assert.match(userResourceScannerSource, /"repos"/);
  assert.match(
    userResourceScannerSource,
    /skipRuntimeDirectories:[\s\S]*root\.scope === "globalHome"/,
  );
});

console.log("Global home routing tests passed");
