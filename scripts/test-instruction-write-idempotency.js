#!/usr/bin/env node

// Rewriting identical bytes into a user's instruction file churns mtime, wakes
// file watchers and folder sync, and feeds the write race this extension already
// works around when the sibling extension edits the same file.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const instructionManagerPath = path.join(
  repoRoot,
  "src",
  "instructionManager.ts",
);
const instructionManagerSource = fs.readFileSync(
  instructionManagerPath,
  "utf8",
);

const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}: ${error && error.message}`);
  }
}

function isFileSystemWrite(node, sourceFile) {
  return (
    ts.isCallExpression(node) &&
    /workspace\.fs\.writeFile$/.test(node.expression.getText(sourceFile))
  );
}

/**
 * Every write must sit under a condition, because the condition is where the
 * "nothing changed" case gets a chance to skip the write.
 */
function findUnconditionalWrites(sourceText, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.ES2020,
    true,
  );
  const unconditional = [];
  const conditional = [];

  const visit = (node, guarded) => {
    let childGuarded = guarded;
    if (
      ts.isIfStatement(node) ||
      ts.isConditionalExpression(node) ||
      ts.isCaseClause(node)
    ) {
      childGuarded = true;
    }

    if (isFileSystemWrite(node, sourceFile)) {
      const line =
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1;
      const label = `${node.expression.getText(sourceFile)} @ line ${line}`;
      if (guarded) {
        conditional.push(label);
      } else {
        unconditional.push(label);
      }
    }

    node.forEachChild((child) => visit(child, childGuarded));
  };

  visit(sourceFile, false);
  return { unconditional, conditional };
}

test("the instruction writer never writes unconditionally", () => {
  const { unconditional, conditional } = findUnconditionalWrites(
    instructionManagerSource,
    instructionManagerPath,
  );
  assert.ok(
    conditional.length >= 4,
    `Expected the guarded writes to be found: ${conditional.join(", ")}`,
  );
  assert.deepStrictEqual(
    unconditional,
    [],
    `A write with no condition rewrites identical bytes: ${unconditional.join(", ")}`,
  );
});

test("both idempotency guards are the ones this check relies on", () => {
  assert.match(
    instructionManagerSource,
    /if \(nextContent !== onDiskContent\) \{/,
    "The ref catalog writer must compare against the bytes on disk",
  );
  assert.match(
    instructionManagerSource,
    /if \(newContent !== existingContent\) \{/,
    "The instruction file writer must compare against the content it read",
  );
});

test("the unconditional-write check is not vacuous against the real file", () => {
  const anchor = "if (newContent !== existingContent) {";
  assert.ok(
    instructionManagerSource.includes(anchor),
    "The mutation anchor is gone; this proof no longer tests the real file",
  );
  // Turning the guard into a bare block keeps the braces balanced while making
  // the write unconditional, which is exactly the regression this check blocks.
  const mutated = instructionManagerSource.replace(anchor, "{");
  const { unconditional } = findUnconditionalWrites(
    mutated,
    instructionManagerPath,
  );
  assert.ok(
    unconditional.length >= 1,
    "Removing the guard must surface an unconditional write",
  );
});

if (failures.length > 0) {
  console.log("RESULT=FAIL");
  process.exitCode = 1;
} else {
  console.log("RESULT=PASS");
}
