#!/usr/bin/env node

// The bundled preset index and a runtime source update must produce the same
// resource set, so the generator may only accept scanners it actually implements.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const { assertSupportedSourceScanners } = require("./update-preset-index.js");

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function getRuntimeSourceScanners() {
  const filePath = path.join(repoRoot, "src", "skillIndex.ts");
  const sourceFile = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, "utf8"),
    ts.ScriptTarget.ES2020,
    true,
  );

  let declaration;
  const visit = (node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === "SourceScanner") {
      declaration = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  assert.ok(declaration, "Expected to find the SourceScanner type alias");
  const members = ts.isUnionTypeNode(declaration.type)
    ? declaration.type.types
    : [declaration.type];
  return members.map((member) => member.literal.text);
}

test("the preset index only declares scanners the generator implements", () => {
  const index = JSON.parse(
    fs.readFileSync(
      path.join(repoRoot, "resources", "skill-index.json"),
      "utf8",
    ),
  );

  assertSupportedSourceScanners(index, "resources/skill-index.json");
});

test("the generator rejects a scanner it cannot honor", () => {
  assert.throws(
    () =>
      assertSupportedSourceScanners(
        {
          sources: [
            { id: "acme-demo", scanner: "top-level-dirs" },
            { id: "acme-other" },
          ],
        },
        "test index",
      ),
    (error) => {
      assert.match(error.message, /acme-demo \(scanner: top-level-dirs\)/);
      assert.doesNotMatch(error.message, /acme-other/);
      return true;
    },
  );
});

test("every non-default runtime scanner is rejected until the generator implements it", () => {
  const runtimeScanners = getRuntimeSourceScanners();
  const generatorSource = fs.readFileSync(
    path.join(repoRoot, "scripts", "update-preset-index.js"),
    "utf8",
  );

  assert.ok(
    runtimeScanners.includes("auto"),
    "The runtime scanner union should keep an explicit auto value",
  );
  for (const scanner of runtimeScanners) {
    if (scanner === "auto") {
      continue;
    }
    assert.doesNotThrow(
      () =>
        assertSupportedSourceScanners(
          { sources: [{ id: "probe" }] },
          "probe index",
        ),
      "the default scan must always stay supported",
    );
    assert.throws(
      () =>
        assertSupportedSourceScanners(
          { sources: [{ id: "probe", scanner }] },
          "probe index",
        ),
      new RegExp(scanner),
      `Scanner "${scanner}" is neither implemented nor rejected by the preset generator`,
    );
  }

  assert.match(
    generatorSource,
    /GENERATOR_SUPPORTED_SCANNERS/,
    "The generator should keep an explicit supported-scanner list",
  );
});

console.log("\nAll preset scanner contract tests passed.");
