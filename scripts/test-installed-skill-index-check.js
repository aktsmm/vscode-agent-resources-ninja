#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

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

test("local skills without remotePath are excluded from index-missing checks", () => {
  assert.match(
    extensionSource,
    /function isIndexTrackedInstalledSkill\(\s*meta: Pick<SkillMeta, "remotePath">,\s*\): boolean \{\s*return !!normalizeInstalledRemotePath\(meta\.remotePath\);\s*\}/,
  );
  assert.match(
    extensionSource,
    /return installedMeta\s*\.filter\(\(meta\) => isIndexTrackedInstalledSkill\(meta\)\)/,
  );
});

test("indexed install lookup prefers remotePath before name/source fallback", () => {
  assert.match(
    extensionSource,
    /const matchedByRemotePath = index\.skills\.find\([\s\S]*normalizeInstalledRemotePath\(skill\.path\) === normalizedRemotePath/,
  );
  assert.match(
    extensionSource,
    /candidate\.name === meta\.name &&\s*candidate\.source === meta\.source/,
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
    /function isRemoteInstalledSkillMeta\([\s\S]*!!normalizeInstalledRemotePath\(meta\.remotePath\)[\s\S]*meta\.source !== "unknown"[\s\S]*meta\.source !== "local"/,
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
