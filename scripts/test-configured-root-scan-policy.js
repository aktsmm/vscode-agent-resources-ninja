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
