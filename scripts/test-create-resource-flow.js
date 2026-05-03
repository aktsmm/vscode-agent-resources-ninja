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

const createHandlerSource = sourceBetween(
  /const createResourceHandler = async \(\) => \{/,
  /\n  const createResourceCmd = vscode\.commands\.registerCommand/,
);

const targetOptionsSource = sourceBetween(
  /const targetOptions: Array<\{/,
  /\n\s*const targetPick = await vscode\.window\.showQuickPick/,
);

test("workspace destination preview uses the resource root helper", () => {
  assert.match(targetOptionsSource, /label: isJa \? "Workspace" : "Workspace"/);
  assert.match(targetOptionsSource, /detail: getResourceRootUri\(/);
  assert.match(targetOptionsSource, /kind,\n\s*"workspace"/);
});

test("workspace destination preview no longer strips an example filename with regex", () => {
  assert.doesNotMatch(
    targetOptionsSource,
    /getCreateResourceUri\([\s\S]*"example"/,
  );
  assert.doesNotMatch(targetOptionsSource, /\.fsPath\.replace\(/);
  assert.doesNotMatch(targetOptionsSource, /example\(\?:/);
});

test("user profile target remains hidden for skills and hooks", () => {
  assert.match(
    createHandlerSource,
    /if \(kind !== "skill" && kind !== "hook"\)/,
  );
  assert.match(
    targetOptionsSource,
    /label: isJa \? "User Profile" : "User Profile"/,
  );
});

test("global resource home target previews the configured root", () => {
  assert.match(targetOptionsSource, /label: "Global Resource Home"/);
  assert.match(targetOptionsSource, /kind,\n\s*"globalHome"/);
});

test("custom target requires folder picker confirmation", () => {
  assert.match(createHandlerSource, /if \(targetPick\.scope === "custom"\)/);
  assert.match(createHandlerSource, /showOpenDialog\(\{/);
  assert.match(createHandlerSource, /canSelectFolders: true/);
  assert.match(createHandlerSource, /if \(!customRoot\) \{\n\s*return;/);
});

test("description cancellation returns without creating files", () => {
  assert.match(
    createHandlerSource,
    /const descriptionInput = await vscode\.window\.showInputBox/,
  );
  assert.match(
    createHandlerSource,
    /if \(descriptionInput === undefined\) \{\n\s*return;\n\s*\}/,
  );
});

test("blank description still uses the localized default", () => {
  assert.match(createHandlerSource, /descriptionInput\.trim\(\) \|\|/);
  assert.match(
    createHandlerSource,
    /Describe what \$\{resourceName\} is for\./,
  );
  assert.match(
    createHandlerSource,
    /\$\{resourceName\} の用途を記述してください。/,
  );
});

test("resource file creation is wrapped in a try catch", () => {
  assert.match(
    createHandlerSource,
    /try \{[\s\S]*createDirectory\([\s\S]*writeFile\(/,
  );
  assert.match(createHandlerSource, /\} catch \(error\) \{/);
});

test("creation errors are surfaced to the user", () => {
  assert.match(
    createHandlerSource,
    /const errorMessage\s*=\s*error instanceof Error \? error\.message : String\(\s*error\s*\)/,
  );
  assert.match(createHandlerSource, /showErrorMessage\(/);
  assert.match(createHandlerSource, /Failed to create resource:/);
  assert.match(createHandlerSource, /リソースを作成できませんでした:/);
});

test("creation failure exits before success message", () => {
  const catchIndex = createHandlerSource.indexOf("} catch (error) {");
  const successIndex = createHandlerSource.indexOf("showInformationMessage(");
  assert.ok(catchIndex > -1, "Missing creation catch block");
  assert.ok(successIndex > -1, "Missing success message");
  assert.ok(
    catchIndex < successIndex,
    "Creation catch should happen before success message",
  );
  assert.match(createHandlerSource.slice(catchIndex, successIndex), /return;/);
});

test("duplicate file handling still runs before write", () => {
  const statIndex = createHandlerSource.indexOf(
    "await vscode.workspace.fs.stat(resourceUri)",
  );
  const writeIndex = createHandlerSource.indexOf(
    "await vscode.workspace.fs.writeFile",
  );
  assert.ok(statIndex > -1, "Missing duplicate stat check");
  assert.ok(writeIndex > -1, "Missing writeFile call");
  assert.ok(
    statIndex < writeIndex,
    "Duplicate check should run before writing",
  );
});

test("successful creation still opens the generated document and refreshes views", () => {
  assert.match(createHandlerSource, /openTextDocument\(resourceUri\)/);
  assert.match(createHandlerSource, /showTextDocument\(doc\)/);
  assert.match(createHandlerSource, /workspaceProvider\.refresh\(\)/);
  assert.match(createHandlerSource, /userResourcesProvider\.refresh\(\)/);
});

console.log("RESULT=PASS");
