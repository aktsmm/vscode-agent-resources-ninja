#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function test(name, run) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const contributing = read("CONTRIBUTING.md");
const runbook = read("docs/release-runbook.md");
const readme = read("README.md");
const readmeJa = read("README_ja.md");
const wrapper = read("scripts/Invoke-VsceWithPat.ps1");

function powershellBlocks(markdown) {
  return Array.from(
    markdown.matchAll(/```powershell\r?\n([\s\S]*?)\r?\n```/g),
    (match) => match[1],
  ).join("\n");
}

test("contributor and release guidance is tracked instead of hidden locally", () => {
  for (const relativePath of ["CONTRIBUTING.md", "docs/release-runbook.md"]) {
    const result = spawnSync("git", ["check-ignore", "--quiet", relativePath], {
      cwd: repoRoot,
    });
    assert.strictEqual(
      result.status,
      1,
      `${relativePath} must be available in a fresh clone`,
    );
  }
});

test("both readmes route contributors to the tracked sources of truth", () => {
  for (const text of [readme, readmeJa]) {
    assert.match(text, /\[CONTRIBUTING\.md\]\(CONTRIBUTING\.md\)/);
    assert.match(text, /\[release runbook\]\(docs\/release-runbook\.md\)/);
  }
  assert.match(
    contributing,
    /\[docs\/release-runbook\.md\]\(docs\/release-runbook\.md\)/,
  );
});

test("the tracked contributor guide carries the essential repository contracts", () => {
  for (const contract of [
    "TypeScript strict mode",
    "src/logger.ts",
    "English and Japanese package localization keys",
    "CHANGELOG.md",
    "shared-store lock payloads",
    "npm run test:resources",
    "npm test",
    "npm audit --audit-level=moderate",
  ]) {
    assert.ok(
      contributing.includes(contract),
      `Missing contributor contract: ${contract}`,
    );
  }
});

test("the runbook contains every release gate and metadata surface", () => {
  for (const command of [
    "npm run compile",
    "npm run test:resources",
    "npm run test:upstream",
    "npm test",
    "npm run audit:runtime",
    "npm audit --audit-level=moderate",
    "npm run release:vsce -- verify-pat",
    "node scripts/test-release-hygiene.js",
  ]) {
    assert.ok(runbook.includes(command), `Missing release gate: ${command}`);
  }
  for (const fileName of [
    "package.json",
    "package-lock.json",
    "package.nls.json",
    "package.nls.ja.json",
    "CHANGELOG.md",
    "release-notes-vX.Y.Z.md",
  ]) {
    assert.ok(
      runbook.includes(fileName),
      `Missing release metadata: ${fileName}`,
    );
  }
});

test("prebuilt VSIX publication always uses the PowerShell argument array", () => {
  const invalidNpmPublish =
    /^npm run release:vsce -- publish[^\r\n]*(?:\s-i\b|--packagePath\b)/m;
  assert.doesNotMatch(powershellBlocks(runbook), invalidNpmPublish);
  assert.doesNotMatch(wrapper, invalidNpmPublish);
  for (const text of [runbook, wrapper]) {
    assert.match(text, /Invoke-VsceWithPat\.ps1 -VsceArgs @\(/);
    assert.match(text, /'publish',[\s\S]*?'-i',[\s\S]*?'--skip-duplicate'/);
  }
});

test("release docs do not embed credentials or local absolute paths", () => {
  assert.doesNotMatch(runbook, /VSCE_PAT\s*=\s*[^\s`]+/);
  assert.doesNotMatch(runbook, /[A-Za-z]:\\Users\\/);
  assert.match(runbook, /Never print, commit, or paste `VSCE_PAT`/);
});

console.log("RESULT=PASS");
