#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..");
const extensionSource = fs
  .readFileSync(path.join(repoRoot, "src", "extension.ts"), "utf8")
  .replace(/\r\n?/g, "\n");
const skillInstallerSource = fs
  .readFileSync(path.join(repoRoot, "src", "skillInstaller.ts"), "utf8")
  .replace(/\r\n?/g, "\n");

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("local and reinstall-disabled skills are excluded from index-missing checks", () => {
  assert.match(
    extensionSource,
    /function isIndexTrackedInstalledSkill\([\s\S]*?"remotePath" \| "reinstallDisabled"[\s\S]*?meta\.reinstallDisabled !== true[\s\S]*?normalizeInstalledRemotePath\(meta\.remotePath\)/,
  );
  assert.match(
    extensionSource,
    /return installedMeta\s*\.filter\(\(meta\) => isIndexTrackedInstalledSkill\(meta\)\)/,
  );
});

test("indexed install lookup does not replace a recorded path by name", () => {
  const lookup = extensionSource.match(
    /function findIndexedSkillForInstalledMeta\([\s\S]*?\n\}/,
  )?.[0];
  assert.ok(lookup, "installed skill lookup not found");
  assert.match(
    lookup,
    /if \(normalizedRemotePath\) \{\s*return resources\.find\([\s\S]*skill\.source === meta\.source[\s\S]*normalizeInstalledRemotePath\(skill\.path\) === normalizedRemotePath/,
  );
  assert.match(
    lookup,
    /candidate\.name === meta\.name &&\s*candidate\.source === meta\.source/,
  );
  assert.match(
    extensionSource,
    /const skill = findIndexedSkillForInstalledMeta\(index, item\.meta\);/,
    "multiple reinstall must use the same path identity check",
  );
  const singleReinstall = extensionSource.slice(
    extensionSource.indexOf("const reinstallResource = async ("),
    extensionSource.indexOf(
      "const reinstallCmd = vscode.commands.registerCommand(",
    ),
  );
  assert.doesNotMatch(
    singleReinstall,
    /getResourceKind\(s\) === resourceKind &&\s*s\.name === resourceName/,
    "single reinstall must not replace a recorded path by name",
  );
});

test("indexed install lookup distinguishes old and renamed paths", () => {
  const normalize = extensionSource.match(
    /function normalizeInstalledRemotePath\([\s\S]*?\n\}/,
  )?.[0];
  const lookup = extensionSource.match(
    /function findIndexedSkillForInstalledMeta\([\s\S]*?\n\}/,
  )?.[0];
  assert.ok(normalize && lookup, "production matching functions not found");
  const code = ts.transpileModule(
    `${normalize}\n${lookup}\nfindIndexedSkillForInstalledMeta;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  const findIndexedSkill = vm.runInNewContext(code, {
    getIndexResources: (index) => index.skills,
    getResourceKind: (resource) => resource.kind || "skill",
  });

  const renamed = { name: "demo", source: "repo", path: "skills/new" };
  const otherSource = { name: "demo", source: "other", path: "skills/old" };
  const index = { skills: [renamed, otherSource] };
  assert.strictEqual(
    findIndexedSkill(index, {
      name: "demo",
      source: "repo",
      remotePath: "skills/old",
    }),
    undefined,
    "a renamed index entry must not authorize removing the old installation",
  );
  assert.strictEqual(
    findIndexedSkill(index, {
      name: "demo",
      source: "repo",
      remotePath: "skills/new",
    }),
    renamed,
    "the actual new path must resolve after installation under that path",
  );
  assert.strictEqual(
    findIndexedSkill(
      { skills: [otherSource] },
      {
        name: "demo",
        source: "repo",
        remotePath: "skills/old",
      },
    ),
    undefined,
    "a matching path from a different source must not authorize removal",
  );
});

test("startup and bulk reinstall paths share the same missing-skill collector", () => {
  const occurrences =
    extensionSource.match(/collectMissingIndexedInstalledSkills\(/g)?.length ||
    0;
  assert.ok(occurrences >= 2, "Expected missing-skill collector to be reused");
});

test("upgrade remote-skill count excludes local skills and requires remotePath", () => {
  assert.match(
    extensionSource,
    /function isRemoteInstalledSkillMeta\([\s\S]*meta\.reinstallDisabled !== true[\s\S]*!!normalizeInstalledRemotePath\(meta\.remotePath\)[\s\S]*meta\.source !== "unknown"[\s\S]*meta\.source !== "local"/,
  );
  assert.match(
    extensionSource,
    /const remoteSkillCount = installedSkills\.filter\(\(s\) =>\s*isRemoteInstalledSkillMeta\(s\),\s*\)\.length;/,
  );
});

test("metadata-less personal skills are normalized to local source", () => {
  assert.match(
    skillInstallerSource,
    /export function normalizeSkillMetaSource\([\s\S]*if \(!remotePath && \(!source \|\| source === "unknown"\)\) \{\s*return "local";/,
  );
  assert.match(
    skillInstallerSource,
    /meta\.source = normalizeSkillMetaSource\(meta\);/,
  );
  assert.match(
    skillInstallerSource,
    /const normalizedSource = normalizeSkillMetaSource\(meta\);/,
  );
  assert.match(
    skillInstallerSource,
    /source: normalizeSkillMetaSource\(\{\}\),/,
  );
});

test("manual metadata bootstrap uses the same local-source normalization", () => {
  assert.match(extensionSource, /source: normalizeSkillMetaSource\(\{\}\),/);
});
