#!/usr/bin/env node

// Guards against Source fields being silently dropped on the shared-store round trip.
// Every field on the Source interface must be enumerated at each explicit copy site.

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");

function requireTypeScriptModule(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  });

  const loadedModule = new Module(filePath, module);
  loadedModule.filename = filePath;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(filePath));
  loadedModule._compile(transpiled.outputText, filePath);
  return loadedModule.exports;
}

function parseFile(relativePath) {
  const filePath = path.join(repoRoot, relativePath);
  return ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.ES2020,
    true,
  );
}

function findNode(root, predicate) {
  let found;
  const visit = (node) => {
    if (found) {
      return;
    }
    if (predicate(node)) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function collectNodes(root, predicate) {
  const matches = [];
  const visit = (node) => {
    if (predicate(node)) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return matches;
}

function findFunction(root, name) {
  const node = findNode(
    root,
    (candidate) =>
      ts.isFunctionDeclaration(candidate) && candidate.name?.text === name,
  );
  assert.ok(node, `Expected to find function ${name} in ${root.fileName}`);
  return node;
}

function getSourceInterfaceFields() {
  const sourceFile = parseFile("src/skillIndex.ts");
  const declaration = findNode(
    sourceFile,
    (node) => ts.isInterfaceDeclaration(node) && node.name.text === "Source",
  );
  assert.ok(declaration, "Expected to find the Source interface");
  return declaration.members
    .filter((member) => ts.isPropertySignature(member) && member.name)
    .map((member) => member.name.getText(sourceFile));
}

function getSourceEntryPickFields() {
  const sourceFile = parseFile("src/sharedManifest.ts");
  const declaration = findNode(
    sourceFile,
    (node) =>
      ts.isTypeAliasDeclaration(node) && node.name.text === "SourceEntry",
  );
  assert.ok(declaration, "Expected to find the SourceEntry type alias");
  const pickKeys = declaration.type?.typeArguments?.[1];
  assert.ok(pickKeys, "Expected SourceEntry to be a Pick<Source, ...>");
  const literals = ts.isUnionTypeNode(pickKeys) ? pickKeys.types : [pickKeys];
  return literals.map((literal) => literal.literal.text);
}

function getNormalizeSourceEntryKeys() {
  const sourceFile = parseFile("src/sharedSourcesManifestStore.ts");
  const declaration = findFunction(sourceFile, "normalizeSourceEntry");
  const objectLiteral = findNode(declaration, (node) =>
    ts.isObjectLiteralExpression(node),
  );
  assert.ok(
    objectLiteral,
    "Expected normalizeSourceEntry to return an object literal",
  );
  return objectLiteral.properties
    .filter((property) => property.name)
    .map((property) => property.name.getText(sourceFile));
}

function getShouldPersistMergedIndexSourceFields() {
  const sourceFile = parseFile("src/skillIndex.ts");
  const declaration = findFunction(sourceFile, "shouldPersistMergedIndex");
  return collectNodes(
    declaration,
    (node) =>
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "localSource",
  ).map((node) => node.name.text);
}

function assertCoversSourceFields(siteName, coveredFields) {
  const missing = getSourceInterfaceFields().filter(
    (field) => !coveredFields.includes(field),
  );
  assert.deepStrictEqual(
    missing,
    [],
    `${siteName} does not carry Source field(s): ${missing.join(", ")}`,
  );
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("Source interface exposes the expected baseline fields", () => {
  const fields = getSourceInterfaceFields();
  for (const required of ["id", "name", "url", "type", "description"]) {
    assert.ok(
      fields.includes(required),
      `Source interface lost the ${required} field`,
    );
  }
});

test("SourceEntry picks every Source field", () => {
  assertCoversSourceFields(
    "src/sharedManifest.ts SourceEntry",
    getSourceEntryPickFields(),
  );
});

test("normalizeSourceEntry copies every Source field", () => {
  assertCoversSourceFields(
    "src/sharedSourcesManifestStore.ts normalizeSourceEntry",
    getNormalizeSourceEntryKeys(),
  );
});

test("shouldPersistMergedIndex compares every Source field", () => {
  assertCoversSourceFields(
    "src/skillIndex.ts shouldPersistMergedIndex",
    getShouldPersistMergedIndexSourceFields(),
  );
});

test("mergeScannedSource preserves every Source field a scan does not own", () => {
  const { mergeScannedSource } = requireTypeScriptModule(
    path.join(repoRoot, "src", "sourceUpdateReconcile.ts"),
  );

  // A scan is only authoritative for the repository facts; everything else on an
  // existing source is curated and must survive.
  const scanOwnedFields = ["url", "repoId"];
  const existing = {};
  for (const field of getSourceInterfaceFields()) {
    existing[field] = `curated-${field}`;
  }

  const merged = mergeScannedSource(existing, {
    id: "scanned-id",
    name: "scanned-name",
    url: "https://github.com/acme/scanned",
    type: "user-added",
    description: "User added repository: acme/scanned",
  });

  for (const field of getSourceInterfaceFields()) {
    if (scanOwnedFields.includes(field)) {
      continue;
    }
    assert.strictEqual(
      merged[field],
      existing[field],
      `mergeScannedSource dropped the curated Source field ${field}`,
    );
  }

  assert.strictEqual(merged.url, "https://github.com/acme/scanned");
});

test("every write of lastIndexedAt also records who indexed it", () => {
  // Freshness ignores a timestamp another extension stamped, so a scan that
  // writes the time without the writer leaves a stale attribution behind and
  // makes our own scan stop counting as our evidence.
  const offenders = [];

  for (const relativePath of [
    "src/indexUpdater.ts",
    "src/skillIndex.ts",
    "src/sourceFreshness.ts",
  ]) {
    const sourceFile = parseFile(relativePath);
    const literals = collectNodes(sourceFile, (node) =>
      ts.isObjectLiteralExpression(node),
    );

    for (const literal of literals) {
      const names = literal.properties
        .map((property) => property.name && property.name.getText())
        .filter(Boolean);
      if (names.includes("lastIndexedAt") && !names.includes("lastIndexedBy")) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(
          literal.getStart(),
        );
        offenders.push(`${relativePath}:${line + 1}`);
      }
    }
  }

  assert.deepStrictEqual(
    offenders,
    [],
    "these object literals set lastIndexedAt without lastIndexedBy",
  );
});

console.log("\nAll source field wiring tests passed.");
