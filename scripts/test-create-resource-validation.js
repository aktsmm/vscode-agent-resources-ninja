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

const nameValidationSource = sourceBetween(
  /function getCreateResourceNameValidationMessage\(/,
  /\n\}\n\nfunction getCreateResourcePathValidationMessage/,
);
const pathValidationSource = sourceBetween(
  /function getCreateResourcePathValidationMessage\(/,
  /\n\}\n\nfunction getCreateResourceDescriptionValidationMessage/,
);
const descriptionValidationSource = sourceBetween(
  /function getCreateResourceDescriptionValidationMessage\(/,
  /\n\}\n\nfunction getResourceRootUri/,
);
const createHandlerSource = sourceBetween(
  /const createResourceHandler = async \(\) => \{/,
  /\n  const createResourceCmd = vscode\.commands\.registerCommand/,
);

test("create resource validation constants are defined", () => {
  assert.match(extensionSource, /const MAX_CREATE_RESOURCE_SLUG_LENGTH = 80/);
  assert.match(
    extensionSource,
    /const MAX_CREATE_RESOURCE_DESCRIPTION_LENGTH = 1000/,
  );
  assert.match(extensionSource, /const MAX_CREATE_RESOURCE_PATH_LENGTH = 240/);
});

test("resource name validation rejects empty sanitized slugs", () => {
  assert.match(
    nameValidationSource,
    /const slug = sanitizeResourceName\(value \|\| ""\)/,
  );
  assert.match(nameValidationSource, /if \(!slug\)/);
  assert.match(nameValidationSource, /Resource name is required/);
  assert.match(nameValidationSource, /リソース名は必須です/);
});

test("resource name validation caps slug length", () => {
  assert.match(
    nameValidationSource,
    /slug\.length > MAX_CREATE_RESOURCE_SLUG_LENGTH/,
  );
  assert.match(nameValidationSource, /Resource name slug must be/);
  assert.match(nameValidationSource, /文字以内の slug/);
});

test("resource name input uses shared validation helper", () => {
  assert.match(createHandlerSource, /getCreateResourceNameValidationMessage\(/);
  assert.match(
    createHandlerSource,
    /if \(nameValidation\) \{\n\s*return nameValidation;/,
  );
});

test("resource name validation checks final destination path", () => {
  assert.match(createHandlerSource, /getCreateResourcePathValidationMessage\(/);
  assert.match(createHandlerSource, /getCreateResourceUri\(/);
  assert.match(createHandlerSource, /targetPick\.scope/);
  assert.match(createHandlerSource, /customRoot/);
});

test("path validation caps generated destination path length", () => {
  assert.match(
    pathValidationSource,
    /resourceUri\.fsPath\.length <= MAX_CREATE_RESOURCE_PATH_LENGTH/,
  );
  assert.match(pathValidationSource, /Destination path is too long/);
  assert.match(pathValidationSource, /作成先パスが長すぎます/);
});

test("description validation caps description length", () => {
  assert.match(
    descriptionValidationSource,
    /value\.length <= MAX_CREATE_RESOURCE_DESCRIPTION_LENGTH/,
  );
  assert.match(descriptionValidationSource, /Description must be/);
  assert.match(descriptionValidationSource, /説明は/);
});

test("description input uses validation helper", () => {
  assert.match(createHandlerSource, /validateInput: \(value\) =>/);
  assert.match(
    createHandlerSource,
    /getCreateResourceDescriptionValidationMessage\(value \|\| "", isJa\)/,
  );
});

test("description placeholder tells users the length limit", () => {
  assert.match(createHandlerSource, /MAX_CREATE_RESOURCE_DESCRIPTION_LENGTH/);
  assert.match(createHandlerSource, /chars max/);
  assert.match(createHandlerSource, /文字以内/);
});

test("mcp resource name placeholder is mcp-specific", () => {
  assert.match(createHandlerSource, /kind === "mcp"/);
  assert.match(createHandlerSource, /local-mcp-server/);
});

test("path length validation happens before write attempts", () => {
  const pathValidationIndex = createHandlerSource.indexOf(
    "getCreateResourcePathValidationMessage(",
  );
  const writeIndex = createHandlerSource.indexOf(
    "await vscode.workspace.fs.writeFile",
  );
  assert.ok(pathValidationIndex > -1, "Missing path length validation");
  assert.ok(writeIndex > -1, "Missing writeFile call");
  assert.ok(
    pathValidationIndex < writeIndex,
    "Path validation should happen before writeFile",
  );
});

console.log("RESULT=PASS");
