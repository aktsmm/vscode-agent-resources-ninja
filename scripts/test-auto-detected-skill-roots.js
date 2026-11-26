#!/usr/bin/env node
/* global require, __dirname, console, process */
// Standard skill folders are listed for display and as an explicit target only.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");

function requireTypeScriptModule(filePath, stubs) {
  const compiled = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  });
  const loaded = new Module(filePath, module);
  loaded.filename = filePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(filePath));
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad(request, parent, isMain);
  };
  try {
    loaded._compile(compiled.outputText, filePath);
  } finally {
    Module._load = originalLoad;
  }
  return loaded.exports;
}

const paths = requireTypeScriptModule(path.join(repoRoot, "src", "customizationPaths.ts"), {
  vscode: {},
  "./skillIndex": {},
});

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "resource-ninja-detect-"));
let counter = 0;
function workspace() {
  const dir = path.join(temp, `ws-${++counter}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function skill(root, ...segments) {
  const dir = path.join(root, ...segments);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: demo\n---\n");
}
const relative = (root, list) => list.map((entry) => path.relative(root, entry).replace(/\\/g, "/"));

async function test(name, run) {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

async function main() {
  await test("an empty workspace detects nothing", async () => {
    assert.deepEqual(await paths.findAutoDetectedSkillRoots(workspace(), []), []);
    assert.deepEqual(await paths.findAutoDetectedSkillRoots("relative/path", []), []);
  });

  await test("standard folders that hold a skill are detected in a fixed order", async () => {
    const root = workspace();
    skill(root, ".claude", "skills", "beta");
    skill(root, ".agents", "skills", "alpha");
    skill(root, ".github", "skills", "group", "gamma");
    fs.mkdirSync(path.join(root, ".github", "other"), { recursive: true });
    assert.deepEqual(
      relative(root, await paths.findAutoDetectedSkillRoots(root, [])),
      [".github/skills", ".agents/skills", ".claude/skills"],
    );
  });

  await test("configured roots, empty folders and a loose SKILL.md are not detected", async () => {
    const root = workspace();
    skill(root, ".github", "skills", "configured");
    fs.mkdirSync(path.join(root, ".agents", "skills"), { recursive: true });
    fs.mkdirSync(path.join(root, ".claude", "skills"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "skills", "SKILL.md"), "loose");
    const configured = [path.join(root, ".github", "skills")];
    assert.deepEqual(await paths.findAutoDetectedSkillRoots(root, configured), []);
    if (process.platform === "win32") {
      assert.deepEqual(
        await paths.findAutoDetectedSkillRoots(root, [path.join(root, ".GITHUB", "SKILLS")]),
        [],
      );
    }
  });

  await test("a folder reached through a link is never detected", async () => {
    const root = workspace();
    const outside = path.join(temp, `outside-${counter}`);
    skill(outside, "skills", "linked");
    try {
      fs.symlinkSync(path.join(outside, "skills"), path.join(root, ".agents-link"), "junction");
    } catch {
      console.log("SKIP link test: this host cannot create directory links");
      return;
    }
    fs.mkdirSync(path.join(root, ".agents"), { recursive: true });
    fs.symlinkSync(path.join(outside, "skills"), path.join(root, ".agents", "skills"), "junction");
    fs.symlinkSync(outside, path.join(root, ".claude"), "junction");
    skill(root, ".github", "skills", "real");
    fs.symlinkSync(
      path.join(outside, "skills", "linked"),
      path.join(root, ".github", "skills", "linked-child"),
      "junction",
    );
    assert.deepEqual(
      relative(root, await paths.findAutoDetectedSkillRoots(root, [])),
      [".github/skills"],
    );
  });

  await test("the setting defaults to on and honors an explicit off", () => {
    const config = (value) => ({
      get: (_key, fallback) => (value === undefined ? fallback : value),
    });
    assert.equal(paths.getConfiguredAutoDetectWorkspaceSkillRoots(config(undefined)), true);
    assert.equal(paths.getConfiguredAutoDetectWorkspaceSkillRoots(config(true)), true);
    assert.equal(paths.getConfiguredAutoDetectWorkspaceSkillRoots(config(false)), false);
  });

  await test("only display callers ask for detected folders", () => {
    const scan = fs.readFileSync(path.join(repoRoot, "src", "localSkillScanner.ts"), "utf8");
    assert.match(scan, /options\.includeAutoDetectedSkillRoots === true/);
    for (const file of ["instructionManager.ts", "skillInstaller.ts", "workspaceSkillUpdate.ts", "workspaceSkillUpdateCheck.ts"]) {
      const text = fs.readFileSync(path.join(repoRoot, "src", file), "utf8");
      assert.doesNotMatch(text, /includeAutoDetectedSkillRoots|findAutoDetectedSkillRoots/, file);
    }
    const tree = fs.readFileSync(path.join(repoRoot, "src", "treeProvider.ts"), "utf8");
    assert.match(tree, /includeAutoDetectedSkillRoots: true/);
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(temp, { recursive: true, force: true }));
