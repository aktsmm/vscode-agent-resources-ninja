const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const scannerSource = fs.readFileSync(
  path.join(repoRoot, "src", "localSkillScanner.ts"),
  "utf8",
);
const instructionManagerSource = fs.readFileSync(
  path.join(repoRoot, "src", "instructionManager.ts"),
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
const customizationPathsSource = fs.readFileSync(
  path.join(repoRoot, "src", "customizationPaths.ts"),
  "utf8",
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
);

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

test("configured roots are scanned before workspace fallback", () => {
  const configuredIndex = scannerSource.indexOf(
    "const configuredCandidates = await findConfiguredWorkspaceCandidates",
  );
  const configuredParseIndex = scannerSource.indexOf(
    "const configuredSkills = await parseCandidates(configuredCandidates)",
  );
  const fallbackIndex = scannerSource.indexOf(
    "const fallbackCandidates = await findWorkspaceFallbackCandidates",
  );

  assert.ok(configuredIndex > -1, "Expected configured candidate scan");
  assert.ok(
    configuredParseIndex > configuredIndex,
    "Expected configured parse",
  );
  assert.ok(
    fallbackIndex > configuredParseIndex,
    "Workspace fallback must run after configured roots are parsed",
  );
});

test("workspace fallback is automatic only when configured roots are empty", () => {
  assert.match(
    scannerSource,
    /type WorkspaceFallbackMode = "auto" \| "always" \| "none"/,
  );
  assert.match(scannerSource, /return configuredSkills\.length === 0/);
  assert.match(
    scannerSource,
    /shouldUseWorkspaceFallback\(workspaceFallback, configuredSkills\)/,
  );
});

test("configured roots include skill and non-skill workspace directories", () => {
  assert.match(scannerSource, /getConfiguredSkillsDirectory\(config\)/);
  assert.match(scannerSource, /getConfiguredAdditionalSkillRoots\(config\)/);
  assert.match(
    scannerSource,
    /getConfiguredWorkspaceAgentsDirectory\(config\)/,
  );
  assert.match(
    scannerSource,
    /getConfiguredWorkspaceInstructionsDirectory\(config\)/,
  );
  assert.match(
    scannerSource,
    /getConfiguredWorkspacePromptsDirectory\(config\)/,
  );
  assert.match(scannerSource, /getConfiguredWorkspaceHooksDirectory\(config\)/);
  assert.match(scannerSource, /getConfiguredWorkspaceMcpDirectory\(config\)/);
});

test("additional skill roots are contributed and scanned as skill roots", () => {
  assert.match(customizationPathsSource, /getConfiguredAdditionalSkillRoots/);
  assert.match(customizationPathsSource, /isSameOrChildWorkspacePath/);
  assert.match(customizationPathsSource, /getConfiguration\("skillNinja"\)/);
  assert.match(
    scannerSource,
    /\.\.\.getConfiguredAdditionalSkillRoots\(config\)/,
  );
  assert.match(scannerSource, /detectionBase: "skills"/);
  assert.match(extensionSource, /resourceNinja\.additionalSkillRoots/);
  assert.deepStrictEqual(
    packageJson.contributes.configuration.properties[
      "resourceNinja.additionalSkillRoots"
    ].default,
    [],
  );
});

test("configured skill root checks are path-boundary aware", () => {
  assert.match(
    customizationPathsSource,
    /normalizedCandidate === normalizedRoot \|\|[\s\S]*normalizedCandidate\.startsWith\(`\$\{normalizedRoot\}\/`\)/,
  );
  assert.match(
    scannerSource,
    /isSameOrChildWorkspacePath\(relativePath, skillsDir\)/,
  );
  assert.match(
    instructionManagerSource,
    /isSameOrChildWorkspacePath\([\s\S]*ls\.relativePath,[\s\S]*workspaceRelativeSkillsDir/,
  );
  assert.match(
    treeProviderSource,
    /isSameOrChildWorkspacePath\(local\.relativePath, skillsDir\)/,
  );
  assert.doesNotMatch(scannerSource, /relativePath\.startsWith\(skillsDir\)/);
  assert.doesNotMatch(
    treeProviderSource,
    /local\.relativePath\.startsWith\(skillsDir\)/,
  );
});

test("instruction fallback is explicit and disabled by default", () => {
  assert.match(instructionManagerSource, /workspaceFallback: "always"/);
  assert.match(
    customizationPathsSource,
    /config\.get<boolean>\("includeLocalResources"\)[\s\S]*false/,
  );
  assert.strictEqual(
    packageJson.contributes.configuration.properties[
      "resourceNinja.includeLocalResources"
    ].default,
    false,
  );
});

console.log("Configured-root scan policy tests passed.");
