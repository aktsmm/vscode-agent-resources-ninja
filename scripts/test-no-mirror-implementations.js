#!/usr/bin/env node

// A test that re-implements an exported src function validates a copy, not the
// shipped code. This ratchet blocks new mirrors and only lets the known debt shrink.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");

// file -> maximum mirrored src functions still tolerated. Lower these as scripts are
// converted to load the real module; never raise one to make a new copy pass.
// A number may only go up when an existing copy becomes visible, either because src
// started exporting its counterpart or because this detector got more precise, and
// the reason must be recorded here.
const MIRROR_DEBT_BUDGET = {
  "audit-resource-installability.js": 3,
  "test-microsoft-install-e2e.js": 1,
  "test-whenToUse.js": 1,
  // Raised from 2 to 4 on 2026-08-24: the detector moved from a `function`-only
  // regex to an AST walk, so the arrow-form copies of getDefaultBranch and
  // scanRepositoryForSkills became visible. No new copy was written.
  // getFallbackResourceName keeps a generator-only dotfile fallback, and
  // getResourceKind lives in src/skillIndex.ts which cannot load outside VS Code.
  "update-preset-index.js": 4,
};

// This guard reads its own budget, so scanning itself would be self-referential.
const SELF_FILE_NAME = path.basename(__filename);

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function getExportedSrcFunctions() {
  const exported = new Map();
  const srcDir = path.join(repoRoot, "src");

  for (const fileName of fs.readdirSync(srcDir)) {
    if (!fileName.endsWith(".ts")) {
      continue;
    }
    const text = fs.readFileSync(path.join(srcDir, fileName), "utf8");
    for (const match of text.matchAll(
      /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g,
    )) {
      if (!exported.has(match[1])) {
        exported.set(match[1], fileName);
      }
    }
  }

  return exported;
}

function collectDeclaredFunctions(text, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.ES2020,
    true,
    ts.ScriptKind.JS,
  );
  const declared = [];

  // Only declaration shapes count. Object properties are how this suite writes
  // module stubs, so treating a same-named property as a copy flags hundreds of
  // legitimate stubs across the suite.
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      declared.push({ name: node.name.text, body: node });
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer))
    ) {
      declared.push({ name: node.name.text, body: node.initializer });
    }
    node.forEachChild(visit);
  };

  visit(sourceFile);
  return declared;
}

// A wrapper hands the work back by returning the same call; a same-named call
// buried elsewhere in a body is the copy doing its own work.
function delegatesToSameName(node, name) {
  const isDelegatingCall = (expression) => {
    let call = expression;
    while (call && ts.isAwaitExpression(call)) {
      call = call.expression;
    }
    return Boolean(
      call &&
      ts.isCallExpression(call) &&
      ts.isPropertyAccessExpression(call.expression) &&
      call.expression.name.text === name &&
      call.expression.expression.kind !== ts.SyntaxKind.ThisKeyword,
    );
  };

  if (ts.isArrowFunction(node) && node.body && !ts.isBlock(node.body)) {
    return isDelegatingCall(node.body);
  }

  let delegates = false;
  const visit = (child) => {
    if (delegates) {
      return;
    }
    if (ts.isReturnStatement(child) && child.expression) {
      delegates = isDelegatingCall(child.expression);
      if (delegates) {
        return;
      }
    }
    child.forEachChild(visit);
  };
  visit(node);
  return delegates;
}

function getMirrorsByFile() {
  const exported = getExportedSrcFunctions();
  const scriptsDir = path.join(repoRoot, "scripts");
  const mirrors = new Map();

  for (const fileName of fs.readdirSync(scriptsDir)) {
    if (!fileName.endsWith(".js") || fileName === SELF_FILE_NAME) {
      continue;
    }
    const filePath = path.join(scriptsDir, fileName);
    const names = [];
    for (const declaration of collectDeclaredFunctions(
      fs.readFileSync(filePath, "utf8"),
      filePath,
    )) {
      if (!exported.has(declaration.name)) {
        continue;
      }
      if (delegatesToSameName(declaration.body, declaration.name)) {
        continue;
      }
      names.push(`${declaration.name} (src/${exported.get(declaration.name)})`);
    }
    if (names.length > 0) {
      mirrors.set(fileName, names);
    }
  }

  return mirrors;
}

const mirrorsByFile = getMirrorsByFile();

test("no script introduces a new mirror of an exported src function", () => {
  const unexpected = [...mirrorsByFile.entries()].filter(
    ([fileName]) => MIRROR_DEBT_BUDGET[fileName] === undefined,
  );

  assert.deepStrictEqual(
    unexpected.map(([fileName, names]) => `${fileName}: ${names.join(", ")}`),
    [],
    "Load the real module with requireTypeScriptModule instead of re-implementing it",
  );
});

test("known mirror debt never grows", () => {
  const overBudget = [];
  for (const [fileName, budget] of Object.entries(MIRROR_DEBT_BUDGET)) {
    const actual = (mirrorsByFile.get(fileName) || []).length;
    if (actual > budget) {
      overBudget.push(`${fileName}: ${actual} > ${budget}`);
    }
  }

  assert.deepStrictEqual(overBudget, []);
});

test("the mirror debt budget has no stale entries", () => {
  const stale = [];
  for (const [fileName, budget] of Object.entries(MIRROR_DEBT_BUDGET)) {
    if (!fs.existsSync(path.join(repoRoot, "scripts", fileName))) {
      stale.push(`${fileName}: file no longer exists`);
      continue;
    }
    const actual = (mirrorsByFile.get(fileName) || []).length;
    if (actual < budget) {
      stale.push(`${fileName}: budget ${budget} but only ${actual} remain`);
    }
  }

  assert.deepStrictEqual(
    stale,
    [],
    "Lower or remove the budget entry so the ratchet keeps its value",
  );
});

console.log("\nAll mirror-implementation guard tests passed.");
