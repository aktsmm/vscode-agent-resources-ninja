#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");

function parse(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  return ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.ES2022,
    true,
  );
}

function collectCalls(sourceFile, name) {
  const calls = [];
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === name
    ) {
      calls.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return calls;
}

function objectHasProperty(node, name) {
  return (
    ts.isObjectLiteralExpression(node) &&
    node.properties.some((property) => {
      if (!property.name) {
        return false;
      }
      return property.name.getText().replace(/["']/g, "") === name;
    })
  );
}

const directRawCalls = [];
for (const relativePath of ["src/indexUpdater.ts", "src/skillPreview.ts"]) {
  const sourceFile = parse(relativePath);
  for (const call of collectCalls(
    sourceFile,
    "fetchGitHubWithOptionalAuthRetry",
  )) {
    if (call.arguments[0]?.getText(sourceFile) === "rawUrl") {
      directRawCalls.push({ relativePath, sourceFile, call });
    }
  }
}

assert.strictEqual(
  directRawCalls.length,
  3,
  "Update the expected direct raw call count when adding or removing a production route",
);
for (const { relativePath, call } of directRawCalls) {
  assert.ok(
    call.arguments[1] &&
      objectHasProperty(call.arguments[1], "authenticatedUrl"),
    `${relativePath} raw requests must pass an explicit authenticatedUrl`,
  );
}

const installer = parse("src/skillInstaller.ts");
const installerContentCalls = collectCalls(installer, "fetchFileContent");
assert.strictEqual(
  installerContentCalls.length,
  4,
  "Update the expected installer content call count when adding a route",
);
for (const call of installerContentCalls) {
  assert.ok(
    call.arguments.length >= 3,
    "Every installer raw-content call must pass an explicit Contents API URL",
  );
}

const skillIndex = parse("src/skillIndex.ts");
const rawBranchProbes = collectCalls(skillIndex, "checkUrlExists").filter(
  (call) => call.arguments[0]?.getText(skillIndex) === "rawUrl",
);
assert.strictEqual(rawBranchProbes.length, 1);
assert.strictEqual(
  rawBranchProbes[0].arguments[2]?.getText(skillIndex),
  "authenticatedUrl",
  "Branch probes must carry the exact ref into the Contents API fallback",
);

const githubFetchSource = fs.readFileSync(
  path.join(repoRoot, "src", "githubFetch.ts"),
  "utf8",
);
assert.doesNotMatch(githubFetchSource, /buildAuthenticatedContentUrl/);
assert.doesNotMatch(
  githubFetchSource,
  /options\.authenticatedUrl\s*\|\|/,
  "Raw paths are ambiguous; the fetch layer must never infer an API URL",
);

console.log(
  "PASS every internal raw-content route supplies an explicit authenticated Contents API URL",
);
console.log("RESULT=PASS");
