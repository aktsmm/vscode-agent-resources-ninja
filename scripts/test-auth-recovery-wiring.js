#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.join(__dirname, "..");
const sourceText = fs.readFileSync(
  path.join(root, "src", "extension.ts"),
  "utf8",
);
const sourceFile = ts.createSourceFile(
  "extension.ts",
  sourceText,
  ts.ScriptTarget.ES2022,
  true,
);

function visit(node, visitor) {
  visitor(node);
  ts.forEachChild(node, (child) => visit(child, visitor));
}

function isRegisterCommandCall(node) {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "registerCommand" &&
    ts.isPropertyAccessExpression(node.expression.expression) &&
    node.expression.expression.name.text === "commands" &&
    ts.isIdentifier(node.expression.expression.expression) &&
    node.expression.expression.expression.text === "vscode"
  );
}

function commandHandlers() {
  const handlers = new Map();
  visit(sourceFile, (node) => {
    if (!isRegisterCommandCall(node)) {
      return;
    }
    const [command, handler] = node.arguments;
    if (
      !ts.isStringLiteral(command) ||
      !(ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))
    ) {
      return;
    }
    handlers.set(command.text, handler);
  });
  return handlers;
}

function namedFunction(name) {
  let result;
  visit(sourceFile, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      result = node;
    }
  });
  return result;
}

function countIdentifierCalls(node, name) {
  let count = 0;
  visit(node, (child) => {
    if (
      ts.isCallExpression(child) &&
      ts.isIdentifier(child.expression) &&
      child.expression.text === name
    ) {
      count += 1;
    }
  });
  return count;
}

function countIdentifierReferences(node, name) {
  let count = 0;
  visit(node, (child) => {
    if (ts.isIdentifier(child) && child.text === name) {
      count += 1;
    }
  });
  return count;
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

const handlers = commandHandlers();

test("only approved user command handlers create an auth recovery retry gate", () => {
  const approvedCommands = [
    "resourceNinja.updateIndex",
    "resourceNinja.updateSourceIndex",
    "resourceNinja.addSource",
    "resourceNinja.webSearch",
  ];
  for (const command of approvedCommands) {
    const handler = handlers.get(command);
    assert.ok(handler, `Missing ${command} command handler`);
    assert.strictEqual(
      countIdentifierCalls(handler, "createOneShotGitHubAuthRetry"),
      1,
      `${command} must create one handler-scoped retry gate`,
    );
  }

  const diagnostic = handlers.get("resourceNinja.showGitHubAuthStatus");
  assert.ok(diagnostic, "Missing GitHub auth diagnostic command handler");
  assert.strictEqual(
    countIdentifierCalls(diagnostic, "createOneShotGitHubAuthRetry"),
    0,
    "The diagnostic command must not retry itself after recovery",
  );
});

test("update-all retains distinct partial and terminal recovery paths", () => {
  const handler = handlers.get("resourceNinja.updateIndex");
  assert.ok(handler, "Missing update index command handler");
  assert.strictEqual(
    countIdentifierCalls(handler, "retryAfterAuthRecovery"),
    2,
    "Update-all needs one retry path for partial failures and one for terminal failures",
  );
  assert.ok(
    countIdentifierReferences(handler, "failedSourceIds") >= 2,
    "Partial recovery must retain the failed source identity set",
  );
  assert.ok(
    countIdentifierReferences(handler, "initialSourceIds") >= 2,
    "Terminal recovery must retain the original source identity set",
  );
});

test("single-source recovery preserves the user-confirmed allow-empty policy", () => {
  const handler = handlers.get("resourceNinja.updateSourceIndex");
  assert.ok(handler, "Missing update source command handler");
  const handlerText = handler.getText(sourceFile);
  assert.match(
    handlerText,
    /await retryAfterAuthRecovery\(outcome,[\s\S]*?await runSourceIndexUpdate\(true\)/,
    "The allow-empty confirmation path must retry with allowEmptyResult enabled",
  );
});

test("automatic and mutating paths cannot create an auth recovery retry gate", () => {
  const startup = namedFunction("runStartupIndexMaintenance");
  const installer = namedFunction("installResource");
  assert.ok(startup, "Missing startup source-index maintenance function");
  assert.ok(installer, "Missing install resource function");
  assert.strictEqual(
    countIdentifierCalls(startup, "createOneShotGitHubAuthRetry"),
    0,
    "Startup maintenance must not retry after an account switch",
  );
  assert.strictEqual(
    countIdentifierCalls(installer, "createOneShotGitHubAuthRetry"),
    0,
    "Installation can mutate the local tree and must not retry automatically",
  );
});

console.log("RESULT=PASS");
