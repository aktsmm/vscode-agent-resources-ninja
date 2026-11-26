#!/usr/bin/env node
/* global require, __dirname, console, process */
// A single reinstall must never delete the current copy before a verified replacement exists.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const srcDir = path.join(__dirname, "..", "src");

function requireTypeScriptModule(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
    fileName: filePath,
  });
  const loaded = new Module(filePath, module);
  loaded.filename = filePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(filePath));
  loaded._compile(compiled.outputText, filePath);
  return loaded.exports;
}

const policy = requireTypeScriptModule(path.join(srcDir, "singleReinstallPolicy.ts"));
const pathSafety = requireTypeScriptModule(path.join(srcDir, "pathSafety.ts"));

const kinds = [
  "skill", "agent", "instruction", "prompt", "hook", "mcp", "plugin", "cursor-rule", "reference",
];
const scopes = ["workspace", "userData", "globalHome"];

function test(name, run) {
  Promise.resolve()
    .then(run)
    .then(
      () => console.log(`PASS ${name}`),
      (error) => {
        console.error(`FAIL ${name}`);
        console.error(error);
        process.exitCode = 1;
      },
    );
}

test("only a workspace skill uses the staged replacement and plain files replace in place", () => {
  const inPlace = new Set(["agent", "prompt", "instruction", "cursor-rule"]);
  for (const kind of kinds) {
    for (const scope of scopes) {
      const decision = policy.decideSingleReinstall(kind, scope);
      if (kind === "skill" && scope === "workspace") {
        assert.deepEqual(decision, { mode: "staged" });
      } else if (inPlace.has(kind)) {
        assert.deepEqual(decision, { mode: "in-place-file" }, `${kind}/${scope}`);
      } else if (kind !== "skill") {
        assert.deepEqual(decision, { mode: "blocked", reason: "kind" }, `${kind}/${scope}`);
      } else {
        assert.deepEqual(decision, { mode: "blocked", reason: "scope" }, `${kind}/${scope}`);
      }
    }
  }
});

test("batch callers are never an explicit single reinstall", () => {
  assert.equal(policy.isExplicitSingleReinstall({}), true);
  assert.equal(policy.isExplicitSingleReinstall({ suppressSuccessMessage: false }), true);
  assert.equal(policy.isExplicitSingleReinstall({ suppressSuccessMessage: true }), false);
  assert.equal(policy.isExplicitSingleReinstall({ suppressRecoveryPrompt: true }), false);
  assert.equal(policy.isExplicitSingleReinstall({ beforeRemove: async () => undefined }), false);
});

test("a skill path claim excludes the same folder, parents and children", () => {
  const root = path.join(path.parse(process.cwd()).root, "resource-ninja-claim-test");
  const skill = path.join(root, "skills", "alpha");
  const release = pathSafety.beginSkillPathOperation(skill);
  assert.equal(typeof release, "function");
  try {
    assert.equal(pathSafety.isSkillPathBusy(skill), true);
    assert.equal(pathSafety.isSkillPathBusy(path.join(skill, "nested", "child")), true);
    assert.equal(pathSafety.isSkillPathBusy(path.join(root, "skills")), true);
    assert.equal(pathSafety.beginSkillPathOperation(skill), undefined);
    assert.equal(pathSafety.beginSkillPathOperation(path.join(skill, "nested")), undefined);
    assert.equal(pathSafety.beginSkillPathOperation(path.join(root, "skills")), undefined);
    // A sibling whose name only starts with the same letters is a different folder.
    assert.equal(pathSafety.isSkillPathBusy(path.join(root, "skills", "alpha-two")), false);
    const sibling = pathSafety.beginSkillPathOperation(path.join(root, "skills", "alpha-two"));
    assert.equal(typeof sibling, "function");
    sibling();
    if (process.platform === "win32") {
      assert.equal(pathSafety.isSkillPathBusy(skill.toUpperCase()), true);
    }
  } finally {
    release();
    release();
  }
  assert.equal(pathSafety.isSkillPathBusy(skill), false);
  const again = pathSafety.beginSkillPathOperation(skill);
  assert.equal(typeof again, "function");
  again();
  for (const invalid of ["", undefined, null, 5]) {
    assert.equal(pathSafety.beginSkillPathOperation(invalid), undefined);
    assert.equal(pathSafety.isSkillPathBusy(invalid), false);
  }
});

test("the install guard blocks only on an explicit true and never on an error", async () => {
  assert.equal(await pathSafety.isSkillInstallBlocked("/x"), false);
  pathSafety.setSkillInstallGuard(async () => true);
  assert.equal(await pathSafety.isSkillInstallBlocked("/x"), true);
  pathSafety.setSkillInstallGuard(async () => false);
  assert.equal(await pathSafety.isSkillInstallBlocked("/x"), false);
  pathSafety.setSkillInstallGuard(async () => {
    throw new Error("unknown state");
  });
  assert.equal(await pathSafety.isSkillInstallBlocked("/x"), false);
  pathSafety.setSkillInstallGuard(async () => "yes");
  assert.equal(await pathSafety.isSkillInstallBlocked("/x"), false);
  pathSafety.setSkillInstallGuard(undefined);
  assert.equal(await pathSafety.isSkillInstallBlocked("/x"), false);
});

test("skill folders are removed only when no operation or recovery record holds them", () => {
  const text = fs.readFileSync(path.join(srcDir, "skillInstaller.ts"), "utf8");
  for (const name of ["uninstallSkill", "uninstallSkillByPath"]) {
    const start = text.indexOf(`export async function ${name}(`);
    assert.ok(start >= 0, name);
    const body = text.slice(start, text.indexOf("\nexport async function", start + 10));
    const guard = body.indexOf("assertSkillFolderRemovable(");
    const firstDelete = body.indexOf("fs.delete(");
    assert.ok(guard >= 0 && firstDelete >= 0 && guard < firstDelete, `${name}: guard before delete`);
  }
});

function findFunctionBody(sourceFile, name) {
  let found;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(sourceFile) === name &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      found = node.initializer.body.getText(sourceFile);
    }
    if (!found) {
      node.forEachChild(visit);
    }
  };
  visit(sourceFile);
  return found;
}

test("single reinstall entries decide before anything is removed", () => {
  const text = fs.readFileSync(path.join(srcDir, "extension.ts"), "utf8");
  const sourceFile = ts.createSourceFile("extension.ts", text, ts.ScriptTarget.ES2020, true);
  const removal = /runReinstallTask\(|uninstallSkillByPath\(|uninstallSkill\(/;

  const workspaceBody = findFunctionBody(sourceFile, "reinstallResource");
  assert.ok(workspaceBody, "reinstallResource not found");
  const decide = workspaceBody.indexOf("decideSingleReinstall(");
  const staged = workspaceBody.indexOf("reinstallWorkspaceSkillInPlace(");
  const firstRemoval = workspaceBody.search(removal);
  assert.ok(decide >= 0 && staged >= 0 && firstRemoval >= 0);
  assert.ok(decide < firstRemoval, "the policy must run before the first removal");
  assert.ok(staged < firstRemoval, "the staged replacement must run before the first removal");
  assert.match(workspaceBody, /isExplicitSingleReinstall\(/);

  const userBody = findFunctionBody(sourceFile, "reinstallUserResource");
  assert.ok(userBody, "reinstallUserResource not found");
  const userDecide = userBody.indexOf("decideSingleReinstall(");
  const userRemoval = userBody.search(removal);
  assert.ok(userDecide >= 0 && userRemoval >= 0);
  assert.ok(userDecide < userRemoval, "the policy must run before the first removal");
  assert.match(userBody, /isExplicitSingleReinstall\(/);

  const inPlaceBody = findFunctionBody(sourceFile, "reinstallWorkspaceSkillInPlace");
  assert.ok(inPlaceBody, "reinstallWorkspaceSkillInPlace not found");
  assert.doesNotMatch(inPlaceBody, removal, "the staged path must never delete first");
  assert.doesNotMatch(inPlaceBody, /installSkill\(/, "the staged path must not run the installer");
  assert.match(inPlaceBody, /repair: true/);
  assert.match(inPlaceBody, /"single"/);

  // The single-file path calls the in-place helper before the first removal in both entries.
  const workspaceFile = workspaceBody.indexOf("reinstallSingleFileInPlace(");
  assert.ok(workspaceFile >= 0 && workspaceFile < firstRemoval);
  const userFile = userBody.indexOf("reinstallSingleFileInPlace(");
  assert.ok(userFile >= 0 && userFile < userRemoval);
  const fileMatch = /function reinstallSingleFileInPlace\(|async function reinstallSingleFileInPlace\(/.exec(text);
  assert.ok(fileMatch, "reinstallSingleFileInPlace not found");
  const fileEnd = text.indexOf("async function pickInstallTarget(", fileMatch.index);
  const fileBody = text.slice(fileMatch.index, fileEnd);
  assert.doesNotMatch(fileBody, removal, "the single-file path must never delete first");
  assert.doesNotMatch(fileBody, /deleteInstalledResourceByPath\(|deleteIfExists|fs\.delete\(/);
  assert.match(fileBody, /captureSingleFile\(/);
  assert.match(fileBody, /replaceSingleFile\(/);
  assert.ok(
    fileBody.indexOf("isDirty") >= 0 && fileBody.indexOf("isDirty") < fileBody.indexOf("replaceSingleFile("),
    "unsaved edits must stop the reinstall before anything is written",
  );
});

test("the skill installer claims its folder and always releases it", () => {
  const text = fs.readFileSync(path.join(srcDir, "skillInstaller.ts"), "utf8");
  const start = text.indexOf("export async function installSkill(");
  const end = text.indexOf("async function installSkillUnguarded(");
  assert.ok(start >= 0 && end > start);
  const wrapper = text.slice(start, end);
  assert.match(wrapper, /beginSkillPathOperation\(/);
  assert.match(wrapper, /finally\s*{\s*release\?\.\(\)/);
  assert.match(wrapper, /installSkillUnguarded\(/);
  assert.ok(
    wrapper.indexOf("isSkillInstallBlocked(") >= 0 &&
      wrapper.indexOf("isSkillInstallBlocked(") < wrapper.indexOf("installSkillUnguarded("),
    "the recovery guard must run before the install",
  );
  // The incomplete-download retry runs under the outer claim, so it must not re-enter the claiming entry.
  const unguarded = text.slice(end);
  const unguardedEnd = unguarded.indexOf("\nasync function isSkillContentIncomplete(");
  assert.ok(unguardedEnd > 0);
  assert.doesNotMatch(unguarded.slice(0, unguardedEnd), /[^\w.]installSkill\(/);
});
