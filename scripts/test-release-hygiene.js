#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const repoRoot = path.resolve(__dirname, "..");
const gitignore = fs.readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
const gitattributes = fs.readFileSync(path.join(repoRoot, ".gitattributes"), "utf8");
const vscodeignore = fs.readFileSync(path.join(repoRoot, ".vscodeignore"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const packageLock = JSON.parse(fs.readFileSync(path.join(repoRoot, "package-lock.json"), "utf8"));

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function hasLine(text, line) {
  return text.split(/\r?\n/).includes(line);
}

function listRootFiles() {
  return fs.readdirSync(repoRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

function readZipEntries(filePath) {
  const buffer = fs.readFileSync(filePath);
  const entries = [];
  let offset = 0;
  const localHeader = 0x04034b50;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === localHeader) {
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const name = buffer.toString("utf8", nameStart, nameEnd);
    const dataStart = nameEnd + extraLength;
    let dataEnd = dataStart + compressedSize;
    entries.push(name);

    if (flags & 0x08) {
      const descriptorSignature = 0x08074b50;
      const descriptorOffset = buffer.indexOf(Buffer.from([0x50, 0x4b, 0x07, 0x08]), dataStart);
      assert.ok(descriptorOffset !== -1, `Missing ZIP data descriptor for ${name}`);
      dataEnd = descriptorOffset + 16;
      assert.strictEqual(buffer.readUInt32LE(descriptorOffset), descriptorSignature);
    } else if (method !== 0 && method !== 8) {
      throw new Error(`Unsupported ZIP method ${method} for ${name}`);
    } else if (method === 8) {
      zlib.inflateRawSync(buffer.subarray(dataStart, dataEnd));
    }

    offset = dataEnd;
  }
  return entries.sort();
}

test("gitignore covers local release and validation artifacts", () => {
  for (const pattern of [
    "*.vsix",
    ".vscode-test/",
    "*.log",
    "*-exit.txt",
    "*-output.txt",
    "audit-output.json",
    "compile-output.txt",
    "AGENTS.md.backup",
    "AGENTS.md",
    "*.bak-*",
    ".vscode/mcp.json.bak-*",
    ".github/*",
    "!.github/workflows/",
    "!.github/workflows/**",
    "/output_sessions/",
    "output_retro/",
    "NEXT_WORK.md",
    "PRODUCT_DIRECTION.md",
    "MIGRATION_NOTES.md",
  ]) {
    assert.ok(hasLine(gitignore, pattern), `Missing .gitignore pattern: ${pattern}`);
  }
});

test("vscodeignore excludes development and validation artifacts", () => {
  for (const pattern of [
    ".vscode/**",
    ".vscode-test/**",
    "src/**",
    "scripts/**",
    "test/**",
    "node_modules/**",
    "package-lock.json",
    "*.vsix",
    "compile-output.txt",
    "*-exit.txt",
    "*-output.txt",
    "audit-output.json",
    "AGENTS.md.backup",
    "release-notes-v*.md",
  ]) {
    assert.ok(hasLine(vscodeignore, pattern), `Missing .vscodeignore pattern: ${pattern}`);
  }
});

test("gitattributes normalizes text without corrupting binary assets", () => {
  for (const pattern of [
    "* text=auto eol=lf",
    "*.gif binary",
    "*.png binary",
    "*.svg text eol=lf",
    "*.vsix binary",
  ]) {
    assert.ok(hasLine(gitattributes, pattern), `Missing .gitattributes pattern: ${pattern}`);
  }
});

test("root has no stale backup files", () => {
  const backupFiles = listRootFiles().filter((name) => name.endsWith(".backup"));
  assert.deepStrictEqual(backupFiles, []);
});

test("package lock version matches package version", () => {
  assert.strictEqual(packageLock.version, packageJson.version);
  assert.strictEqual(packageLock.packages?.[""]?.version, packageJson.version);
});

test("existing VSIX payload stays release-minimal", () => {
  const vsixPath = path.join(repoRoot, `agent-resources-ninja-${packageJson.version}.vsix`);
  if (!fs.existsSync(vsixPath)) {
    console.log("SKIP existing VSIX payload stays release-minimal (VSIX not generated yet)");
    return;
  }
  const entries = readZipEntries(vsixPath);
  const forbiddenPrefixes = [
    "extension/.github/",
    "extension/.vscode/",
    "extension/.vscode-test/",
    "extension/docs/",
    "extension/output_retro/",
    "extension/output_sessions/",
    "extension/scripts/",
    "extension/src/",
    "extension/test/",
  ];
  const forbiddenNames = new Set([
    "extension/AGENTS.md",
    "extension/AGENTS.md.backup",
    "extension/NEXT_WORK.md",
    "extension/PRODUCT_DIRECTION.md",
    "extension/MIGRATION_NOTES.md",
    "extension/package-lock.json",
    "extension/compile-output.txt",
  ]);
  for (const entry of entries) {
    assert.ok(!forbiddenNames.has(entry), `Unexpected VSIX file: ${entry}`);
    assert.ok(!forbiddenPrefixes.some((prefix) => entry.startsWith(prefix)), `Unexpected VSIX path: ${entry}`);
    assert.ok(!entry.endsWith("-output.txt"), `Unexpected VSIX output artifact: ${entry}`);
    assert.ok(!entry.endsWith("-exit.txt"), `Unexpected VSIX exit artifact: ${entry}`);
  }
});

console.log("RESULT=PASS");
