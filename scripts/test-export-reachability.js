#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const srcDir = path.join(repoRoot, "src");
const entryPath = path.join(srcDir, "extension.ts");
const targetFiles = new Set([
  path.join(srcDir, "authRecovery.ts"),
  path.join(srcDir, "githubAuth.ts"),
  path.join(srcDir, "sharedStoreLock.ts"),
]);

// These exports exist solely to make environment-dependent behavior executable
// in tests. Every exception needs a concrete reason; production helpers do not
// belong here.
const TEST_SEAM_ALLOWLIST = new Map([
  [
    "sharedStoreLock.ts:configureSharedStoreLockRuntime",
    "injects clock, process liveness, and generation state into lock tests",
  ],
  [
    "sharedStoreLock.ts:resetSharedStoreLockRuntime",
    "restores the injected shared-lock runtime after each test",
  ],
]);

function parseFile(filePath) {
  return ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.ES2022,
    true,
  );
}

function resolveRelativeModule(containingFile, moduleName) {
  if (!moduleName.startsWith(".")) {
    return undefined;
  }
  const base = path.resolve(path.dirname(containingFile), moduleName);
  for (const candidate of [`${base}.ts`, path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function collectProductionGraph() {
  const graph = new Map();
  const pending = [entryPath];
  while (pending.length > 0) {
    const filePath = pending.pop();
    if (!filePath || graph.has(filePath)) {
      continue;
    }
    const sourceFile = parseFile(filePath);
    graph.set(filePath, sourceFile);
    for (const statement of sourceFile.statements) {
      if (
        !ts.isImportDeclaration(statement) &&
        !ts.isExportDeclaration(statement)
      ) {
        continue;
      }
      const moduleName = statement.moduleSpecifier;
      if (!moduleName || !ts.isStringLiteral(moduleName)) {
        continue;
      }
      const resolved = resolveRelativeModule(filePath, moduleName.text);
      if (resolved && !graph.has(resolved)) {
        pending.push(resolved);
      }
    }
  }
  return graph;
}

function hasExportModifier(node) {
  return Boolean(
    ts
      .getModifiers(node)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  );
}

function collectRuntimeExports(sourceFile) {
  const exports = [];
  for (const statement of sourceFile.statements) {
    if (!hasExportModifier(statement)) {
      continue;
    }
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name
    ) {
      exports.push({ name: statement.name.text, declaration: statement });
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          exports.push({ name: declaration.name.text, declaration });
        }
      }
    }
  }
  return exports;
}

function countIdentifierReferences(root, name, excludedNode) {
  let count = 0;
  const visit = (node) => {
    if (node === excludedNode) {
      return;
    }
    if (ts.isIdentifier(node) && node.text === name) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return count;
}

function collectImportedAliases(sourceFile, targetPath, exportName) {
  const aliases = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) {
      continue;
    }
    const moduleName = statement.moduleSpecifier;
    if (!ts.isStringLiteral(moduleName)) {
      continue;
    }
    if (
      resolveRelativeModule(sourceFile.fileName, moduleName.text) !== targetPath
    ) {
      continue;
    }
    if (statement.importClause?.isTypeOnly) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (
          !element.isTypeOnly &&
          (element.propertyName?.text ?? element.name.text) === exportName
        ) {
          aliases.push({
            kind: "named",
            name: element.name.text,
            declaration: element,
          });
        }
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) {
      aliases.push({
        kind: "namespace",
        name: bindings.name.text,
        declaration: bindings,
      });
    }
  }
  return aliases;
}

function countNamespaceMemberReferences(root, namespaceName, exportName) {
  let count = 0;
  const visit = (node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === namespaceName &&
      node.name.text === exportName
    ) {
      count += 1;
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === namespaceName &&
      ts.isStringLiteral(node.argumentExpression) &&
      node.argumentExpression.text === exportName
    ) {
      count += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return count;
}

function isProductionReachable(graph, targetPath, exported) {
  const targetSource = graph.get(targetPath);
  if (!targetSource) {
    return false;
  }
  if (
    countIdentifierReferences(
      targetSource,
      exported.name,
      exported.declaration,
    ) > 0
  ) {
    return true;
  }
  for (const sourceFile of graph.values()) {
    if (sourceFile.fileName === targetPath) {
      continue;
    }
    for (const alias of collectImportedAliases(
      sourceFile,
      targetPath,
      exported.name,
    )) {
      if (
        alias.kind === "namespace"
          ? countNamespaceMemberReferences(
              sourceFile,
              alias.name,
              exported.name,
            ) > 0
          : countIdentifierReferences(
              sourceFile,
              alias.name,
              alias.declaration,
            ) > 0
      ) {
        return true;
      }
    }
  }
  return false;
}

const syntheticConsumerPath = path.join(srcDir, "syntheticConsumer.ts");
const namespaceFixture = ts.createSourceFile(
  syntheticConsumerPath,
  'import * as auth from "./githubAuth"; auth.getGitHubToken(); auth["checkGitHubAuth"]();',
  ts.ScriptTarget.ES2022,
  true,
);
const namespaceAliases = collectImportedAliases(
  namespaceFixture,
  path.join(srcDir, "githubAuth.ts"),
  "getGitHubToken",
);
assert.strictEqual(namespaceAliases.length, 1);
assert.strictEqual(namespaceAliases[0].kind, "namespace");
assert.strictEqual(
  countNamespaceMemberReferences(
    namespaceFixture,
    namespaceAliases[0].name,
    "getGitHubToken",
  ),
  1,
);
assert.strictEqual(
  countNamespaceMemberReferences(
    namespaceFixture,
    namespaceAliases[0].name,
    "checkGitHubAuth",
  ),
  1,
);

const typeOnlyFixture = ts.createSourceFile(
  syntheticConsumerPath,
  'import type { getGitHubToken } from "./githubAuth"; type TokenGetter = typeof getGitHubToken;',
  ts.ScriptTarget.ES2022,
  true,
);
assert.deepStrictEqual(
  collectImportedAliases(
    typeOnlyFixture,
    path.join(srcDir, "githubAuth.ts"),
    "getGitHubToken",
  ),
  [],
);

const graph = collectProductionGraph();
const unreachable = [];
const staleAllowlist = new Set(TEST_SEAM_ALLOWLIST.keys());

for (const targetPath of targetFiles) {
  assert.ok(
    graph.has(targetPath),
    `${path.basename(targetPath)} is not reachable from extension.ts`,
  );
  const sourceFile = graph.get(targetPath);
  for (const exported of collectRuntimeExports(sourceFile)) {
    const key = `${path.basename(targetPath)}:${exported.name}`;
    if (isProductionReachable(graph, targetPath, exported)) {
      continue;
    }
    if (TEST_SEAM_ALLOWLIST.has(key)) {
      staleAllowlist.delete(key);
      continue;
    }
    unreachable.push(key);
  }
}

assert.deepStrictEqual(
  unreachable,
  [],
  `Runtime exports without a production consumer: ${unreachable.join(", ")}`,
);
assert.deepStrictEqual(
  [...staleAllowlist],
  [],
  "Remove stale test-seam exceptions when an export gains a production consumer or disappears",
);

console.log(
  "PASS selected auth and lock runtime exports are production-reachable or documented test seams",
);
console.log("RESULT=PASS");
