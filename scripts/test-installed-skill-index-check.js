#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const extensionSource = fs
  .readFileSync(path.join(repoRoot, "src", "extension.ts"), "utf8")
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
    /function isIndexTrackedInstalledSkill\(meta: Pick<SkillMeta, "remotePath">\): boolean \{\n  return !!normalizeInstalledRemotePath\(meta\.remotePath\);\n\}/,
  );
  assert.match(
    extensionSource,
    /return installedMeta\n    \.filter\(\(meta\) => isIndexTrackedInstalledSkill\(meta\)\)/,
  );
});

test("indexed install lookup prefers remotePath before name/source fallback", () => {
  assert.match(
    extensionSource,
    /const matchedByRemotePath = index\.skills\.find\([\s\S]*normalizeInstalledRemotePath\(skill\.path\) === normalizedRemotePath/,
  );
  assert.match(
    extensionSource,
    /candidate\.name === meta\.name &&\n      candidate\.source === meta\.source/,
  );
});

test("startup and bulk reinstall paths share the same missing-skill collector", () => {
  const occurrences =
    extensionSource.match(/collectMissingIndexedInstalledSkills\(/g)?.length ||
    0;
  assert.ok(occurrences >= 2, "Expected missing-skill collector to be reused");
});
