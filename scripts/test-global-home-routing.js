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

function normalizeConfiguredPath(value) {
  return value.replace(/\\/g, "/");
}

function isHomeRelativePath(configuredPath) {
  return normalizeConfiguredPath(configuredPath).startsWith("~/");
}

function isAbsoluteConfiguredPath(configuredPath) {
  return path.isAbsolute(normalizeConfiguredPath(configuredPath));
}

function getDefaultGlobalHomeDirectoryForPreset(preset) {
  switch (preset) {
    case "claude":
      return "~/.claude";
    case "agents":
      return "~/.agents";
    case "custom":
    case "copilot":
    default:
      return "~/.copilot";
  }
}

function getConfiguredGlobalHomeDirectory(config = {}) {
  const configuredPath = config.globalHomeDirectory?.trim();
  if (configuredPath) return configuredPath;
  return getDefaultGlobalHomeDirectoryForPreset(
    config.globalResourceHomePreset || "copilot",
  );
}

function getGlobalInstructionFileNameForPreset(preset) {
  switch (preset) {
    case "copilot":
      return "copilot-instructions.md";
    case "claude":
      return "CLAUDE.md";
    case "agents":
    case "custom":
    default:
      return "AGENTS.md";
  }
}

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
  assert.strictEqual(getGlobalInstructionFileNameForPreset("copilot"), "copilot-instructions.md");
  assert.strictEqual(getGlobalInstructionFileNameForPreset("claude"), "CLAUDE.md");
  assert.strictEqual(getGlobalInstructionFileNameForPreset("agents"), "AGENTS.md");
  assert.strictEqual(getGlobalInstructionFileNameForPreset("custom"), "AGENTS.md");
});

test("implementation exposes global instruction resolver", () => {
  assert.match(customizationPathsSource, /function getGlobalInstructionFileNameForPreset/);
  assert.match(customizationPathsSource, /case "copilot"[\s\S]*"copilot-instructions\.md"/);
  assert.match(customizationPathsSource, /case "claude"[\s\S]*"CLAUDE\.md"/);
  assert.match(customizationPathsSource, /resolveGlobalInstructionFileUri/);
  assert.match(customizationPathsSource, /getConfiguredGlobalHomeDirectory\(config\)/);
});

console.log("Global home routing tests passed");
