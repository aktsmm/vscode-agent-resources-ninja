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
const userResourceScannerSource = fs.readFileSync(
  path.join(repoRoot, "src", "userResourceScanner.ts"),
  "utf8",
);
const skillIndexSource = fs.readFileSync(
  path.join(repoRoot, "src", "skillIndex.ts"),
  "utf8",
);
const extensionSource = fs.readFileSync(
  path.join(repoRoot, "src", "extension.ts"),
  "utf8",
);
const treeProviderSource = fs.readFileSync(
  path.join(repoRoot, "src", "treeProvider.ts"),
  "utf8",
);
const userResourcesProviderSource = fs.readFileSync(
  path.join(repoRoot, "src", "userResourcesProvider.ts"),
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
  assert.match(
    skillInstallerSource,
    /incomplete\?: boolean; \/\//,
    "SkillMeta must expose incomplete as a first-class field so the sibling extension can read it",
  );
  assert.match(skillInstallerSource, /reinstallDisabled\?: boolean; \/\//);
  assert.match(skillInstallerSource, /reinstallDisabledReason\?: string;/);
  assert.match(skillInstallerSource, /reinstallDisabledAt\?: string;/);
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

test("metadata reads distinguish missing, unreadable, and invalid files", () => {
  assert.match(
    skillInstallerSource,
    /export type JsonObjectReadResult<[\s\S]*status: "loaded"[\s\S]*status: "missing"[\s\S]*status: "unreadable"[\s\S]*status: "invalid"/,
  );
  assert.match(
    skillInstallerSource,
    /if \(isFileNotFoundError\(error\)\) \{\s*return false;\s*\}\s*throw error;/,
    "existence checks must fail closed on permission, lock, and unknown errors",
  );
  assert.match(
    skillInstallerSource,
    /const existingResult\s*=\s*await readJsonObject<Partial<ResourceInstallMeta>>[\s\S]*existingResult\.status === "unreadable"[\s\S]*existingResult\.status === "invalid"[\s\S]*throw existingResult\.error/,
    "non-skill sidecars must not overwrite unreadable or invalid metadata",
  );
});

test("workspace and user scanners preserve metadata failure state", () => {
  for (const source of [localSkillScannerSource, userResourceScannerSource]) {
    assert.match(source, /metadataStatus\?: "unreadable" \| "invalid"/);
    assert.match(source, /readJsonObject<ResourceInstallMeta>/);
    assert.match(
      source,
      /installMetaResult\.status === "unreadable" \|\|[\s\S]*installMetaResult\.status === "invalid"/,
    );
  }
});

test("reinstall-disabled metadata reaches every resource view", () => {
  for (const source of [localSkillScannerSource, userResourceScannerSource]) {
    assert.match(source, /reinstallDisabled\?: boolean;/);
    assert.match(source, /reinstallDisabled: installMeta\?\.reinstallDisabled/);
    assert.match(
      source,
      /reinstallDisabledReason: installMeta\?\.reinstallDisabledReason/,
    );
    assert.match(
      source,
      /reinstallDisabledAt: installMeta\?\.reinstallDisabledAt/,
    );
  }
  assert.match(
    treeProviderSource,
    /!skill\.reinstallDisabled[\s\S]*?installedRemoteSkill/,
    "workspace rows must hide reinstall actions for disabled resources",
  );
  assert.match(
    treeProviderSource,
    /reinstallDisabled[\s\S]*?"resourceNinja\.preview"[\s\S]*?"resourceNinja\.onSkillClick"/,
    "browse double-click must preview rather than reinstall disabled resources",
  );
  assert.match(
    userResourcesProviderSource,
    /!resource\.reinstallDisabled[\s\S]*?!!resource\.remotePath/,
    "user/global rows must hide reinstall actions for disabled resources",
  );
});

test("reinstall-disabled metadata guards direct and batch commands", () => {
  assert.match(
    extensionSource,
    /function isIndexTrackedInstalledSkill\([\s\S]*?meta\.reinstallDisabled !== true/,
    "startup missing-index checks must skip disabled entries",
  );
  assert.match(
    extensionSource,
    /function isRemoteInstalledUserResource\([\s\S]*?resource\.reinstallDisabled !== true/,
  );
  assert.match(
    extensionSource,
    /if \(resource\.reinstallDisabled\) \{[\s\S]*?getReinstallDisabledMessage/,
    "direct user/global reinstall must fail closed",
  );
  assert.match(
    extensionSource,
    /if \(meta\?\.reinstallDisabled\) \{[\s\S]*?getReinstallDisabledMessage/,
    "direct workspace reinstall must re-check on-disk metadata",
  );
  assert.strictEqual(
    (
      extensionSource.match(
        /filter\(\s*\(meta\) => !meta\.reinstallDisabled,?\s*\)/g,
      ) || []
    ).length,
    2,
    "reinstall all and reinstall multiple must both filter disabled metadata",
  );
});

test("retired source metadata migrates to the canonical source", () => {
  assert.match(
    skillIndexSource,
    /"microsoft-copilot-for-azure-plugin": "microsoft-azure-skills"/,
  );
  assert.match(
    skillInstallerSource,
    /return \(source && RETIRED_SOURCE_ALIASES\[source\]\) \|\| source \|\| "unknown";/,
  );
});

test("mergeSkillMeta keeps unknown fields while applying latest values", () => {
  assert.match(
    skillInstallerSource,
    /function mergeSkillMeta\([\s\S]*const carriedOverMeta: Partial<SkillMeta> = \{ \.\.\.\(existingMeta \?\? \{\}\) \};[\s\S]*return \{[\s\S]*\.\.\.carriedOverMeta,[\s\S]*\.\.\.nextMeta,[\s\S]*\};[\s\S]*\}/,
  );
});

test("mergeSkillMeta never carries a filesystem path back from the sidecar", () => {
  assert.match(
    skillInstallerSource,
    /const SKILL_META_LOCAL_PATH_FIELDS = \[\s*"skillFilePath",\s*"relativePath",\s*\] as const;/,
    "every SkillMeta field that names a local path must be listed",
  );
  assert.match(
    skillInstallerSource,
    /for \(const field of SKILL_META_LOCAL_PATH_FIELDS\) \{\s*delete carriedOverMeta\[field\];\s*\}/,
    "the listed path fields must be dropped before the merge",
  );
});
