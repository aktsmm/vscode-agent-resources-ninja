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

function sourceBetween(startPattern, endPattern) {
  const start = extensionSource.search(startPattern);
  assert.notStrictEqual(start, -1, `Missing start pattern: ${startPattern}`);
  const remainder = extensionSource.slice(start);
  const end = remainder.search(endPattern);
  assert.notStrictEqual(end, -1, `Missing end pattern: ${endPattern}`);
  return remainder.slice(0, end);
}

const templateSource = sourceBetween(
  /function getCreateResourceTemplate\(/,
  /\n\}\n\nexport async function activate|\n\}\n\nexport function activate|\n\}\n\nfunction activate/,
);

const createHandlerSource = sourceBetween(
  /const createResourceHandler = async \(\) => \{/,
  /\n  const createResourceCmd = vscode\.commands\.registerCommand/,
);

test("template text normalization removes CR and NUL", () => {
  assert.match(
    extensionSource,
    /function normalizeTemplateText\(value: string\)/,
  );
  assert.match(extensionSource, /replace\(\/\\r\\n\?\/g, "\\n"\)/);
  assert.match(extensionSource, /split\(String\.fromCharCode\(0\)\)/);
  assert.match(extensionSource, /\.join\(""\)/);
});

test("frontmatter scalars are JSON quoted for YAML safety", () => {
  assert.match(extensionSource, /function yamlString\(value: string\)/);
  assert.match(extensionSource, /return JSON\.stringify/);
  assert.match(extensionSource, /replace\(\/\\s\+\/g, " "\)/);
});

test("markdown body text falls back to a useful placeholder", () => {
  assert.match(extensionSource, /function markdownText\(value: string\)/);
  assert.match(extensionSource, /TODO: Describe this resource\./);
});

test("mcp server key has a safe fallback", () => {
  assert.match(extensionSource, /function getMcpServerKey\(name: string\)/);
  assert.match(extensionSource, /sanitizeResourceName\(name\) \|\| "server"/);
});

test("agent template quotes description frontmatter", () => {
  assert.match(
    templateSource,
    /const frontmatterDescription = yamlString\(description\)/,
  );
  assert.match(templateSource, /description: \$\{frontmatterDescription\}/);
  assert.doesNotMatch(
    templateSource,
    /case "agent":[\s\S]*description: \$\{description\}/,
  );
});

test("prompt template quotes description frontmatter", () => {
  assert.match(
    templateSource,
    /case "prompt":[\s\S]*description: \$\{frontmatterDescription\}/,
  );
  assert.doesNotMatch(
    templateSource,
    /case "prompt":[\s\S]*description: \$\{description\}/,
  );
});

test("skill template quotes name and description frontmatter", () => {
  assert.match(templateSource, /const frontmatterName = yamlString\(name\)/);
  assert.match(templateSource, /name: \$\{frontmatterName\}/);
  assert.match(templateSource, /description: \$\{frontmatterDescription\}/);
  assert.doesNotMatch(templateSource, /name: \$\{name\}/);
});

test("instruction template uses sanitized body description", () => {
  assert.match(
    templateSource,
    /case "instruction":[\s\S]*\$\{bodyDescription\}/,
  );
  assert.doesNotMatch(
    templateSource,
    /case "instruction":[\s\S]*\$\{description\}/,
  );
});

test("hook template uses sanitized body description", () => {
  assert.match(templateSource, /case "hook":[\s\S]*\$\{bodyDescription\}/);
  assert.doesNotMatch(templateSource, /case "hook":[\s\S]*\$\{description\}/);
});

test("mcp template JSON-escapes the server key", () => {
  assert.match(templateSource, /JSON\.stringify\(getMcpServerKey\(name\)\)/);
  assert.doesNotMatch(templateSource, /"\$\{sanitizeResourceName\(name\)\}"/);
});

test("resource name validation rejects empty sanitized slugs", () => {
  assert.match(
    extensionSource,
    /function getCreateResourceNameValidationMessage\(/,
  );
  assert.match(
    extensionSource,
    /const slug = sanitizeResourceName\(value \|\| ""\)/,
  );
  assert.match(extensionSource, /if \(!slug\)/);
  assert.match(createHandlerSource, /getCreateResourceNameValidationMessage\(/);
  assert.match(extensionSource, /Resource name is required/);
});

test("created content uses sanitized slug and normalized description", () => {
  assert.match(
    createHandlerSource,
    /const slug = sanitizeResourceName\(resourceName\)/,
  );
  assert.match(
    createHandlerSource,
    /getCreateResourceTemplate\(kind, slug, description\)/,
  );
});

test("resource creation still writes UTF-8 files", () => {
  assert.match(createHandlerSource, /Buffer\.from\(content, "utf8"\)/);
});

console.log("RESULT=PASS");
