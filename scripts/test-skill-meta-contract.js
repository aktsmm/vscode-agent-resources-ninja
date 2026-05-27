#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const skillInstallerSource = fs.readFileSync(
  path.join(repoRoot, "src", "skillInstaller.ts"),
  "utf8",
);
const localSkillScannerSource = fs.readFileSync(
  path.join(repoRoot, "src", "localSkillScanner.ts"),
  "utf8",
);

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("SkillMeta exposes the shared coexistence metadata contracts", () => {
  assert.match(
    skillInstallerSource,
    /registrationDisabled\?: boolean/,
    "SkillMeta must keep registrationDisabled as a first-class field",
  );
  assert.match(
    skillInstallerSource,
    /remotePath\?: string; \/\/ skill-only sibling extension と共有する配布元相対パス。cross-extension index matching の契約フィールド/,
    "SkillMeta must document remotePath as a cross-extension contract",
  );
  assert.match(
    skillInstallerSource,
    /\[key: string\]: unknown;/,
    "SkillMeta should allow forward-compatible fields",
  );
});

test("installSkill preserves existing skill metadata fields on rewrite", () => {
  assert.match(
    skillInstallerSource,
    /const existingMeta = await readSkillMetaIfExists\(metaPath\);/,
  );
  assert.match(
    skillInstallerSource,
    /const meta: SkillMeta = mergeSkillMeta\(existingMeta, \{[\s\S]*customWhenToUse: existingMeta\?\.customWhenToUse,[\s\S]*\}\);/,
  );
  assert.match(
    skillInstallerSource,
    /source: normalizeSkillMetaSource\(\{[\s\S]*source: skill\.source,[\s\S]*remotePath: skill\.path,[\s\S]*\}\),/,
    "installSkill must normalize source when rewriting .skill-meta.json",
  );
  assert.match(
    skillInstallerSource,
    /remotePath: skill\.path,/,
    "installSkill must continue writing remotePath from the indexed skill path",
  );
});

test("resource install sidecar metadata normalizes source and carries plugin fields", () => {
  assert.match(
    skillInstallerSource,
    /const meta: ResourceInstallMeta = \{[\s\S]*source: normalizeSkillMetaSource\(\{[\s\S]*source: skill\.source,[\s\S]*remotePath: skill\.path,[\s\S]*\}\),/,
    "resource sidecar metadata should normalize source consistently",
  );
  assert.match(localSkillScannerSource, /pluginRoot\?: string;/);
  assert.match(localSkillScannerSource, /pluginManifestPath\?: string;/);
  assert.match(localSkillScannerSource, /pluginManifestKind\?: string;/);
  assert.match(
    localSkillScannerSource,
    /pluginRoot: installMeta\?\.pluginRoot,[\s\S]*pluginManifestPath: installMeta\?\.pluginManifestPath,[\s\S]*pluginManifestKind: installMeta\?\.pluginManifestKind,/,
    "local scanner must preserve plugin metadata from install sidecars",
  );
});

test("mergeSkillMeta keeps unknown fields while applying latest values", () => {
  assert.match(
    skillInstallerSource,
    /function mergeSkillMeta\([\s\S]*return \{[\s\S]*\.\.\.\(existingMeta \?\? \{}\),[\s\S]*\.\.\.nextMeta,[\s\S]*\};[\s\S]*\}/,
  );
});
