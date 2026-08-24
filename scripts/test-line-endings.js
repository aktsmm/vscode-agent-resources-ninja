#!/usr/bin/env node

// Inserting an LF-only generated block into a CRLF file leaves the user with a
// mixed-ending file they then commit.

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
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

function requireTypeScriptModule(filePath) {
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  });
  const loaded = new Module(filePath, module);
  loaded.filename = filePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(filePath));
  loaded._compile(transpiled.outputText, filePath);
  return loaded.exports;
}

const {
  applyLineEnding,
  detectDominantLineEnding,
  detectUniformLineEnding,
  matchLineEnding,
} = requireTypeScriptModule(path.join(repoRoot, "src", "lineEndings.ts"));

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

test("a CRLF file keeps CRLF and an LF file keeps LF", () => {
  assert.strictEqual(detectDominantLineEnding("a\r\nb\r\nc"), "\r\n");
  assert.strictEqual(detectDominantLineEnding("a\nb\nc"), "\n");
});

test("an empty or single-line file defaults to LF", () => {
  assert.strictEqual(detectDominantLineEnding(""), "\n");
  assert.strictEqual(detectDominantLineEnding("only one line"), "\n");
});

test("a mixed file follows whichever ending it uses more", () => {
  assert.strictEqual(detectDominantLineEnding("a\r\nb\r\nc\nd"), "\r\n");
  assert.strictEqual(detectDominantLineEnding("a\r\nb\nc\nd"), "\n");
});

test("a lone carriage return is not counted as a line ending", () => {
  assert.strictEqual(detectDominantLineEnding("a\rb\nc"), "\n");
});

test("applying an ending rewrites the whole text to that ending", () => {
  assert.strictEqual(applyLineEnding("a\nb\r\nc", "\r\n"), "a\r\nb\r\nc");
  assert.strictEqual(applyLineEnding("a\r\nb\nc", "\n"), "a\nb\nc");
});

test("applying an ending twice changes nothing further", () => {
  const once = applyLineEnding("a\nb\r\nc", "\r\n");
  assert.strictEqual(applyLineEnding(once, "\r\n"), once);
});

test("an LF block inserted into a CRLF file comes back out as CRLF", () => {
  const existing = "# Title\r\n\r\nuser text\r\n";
  const generated = `${existing}\n<!-- start -->\ngenerated\n<!-- end -->\n`;
  const written = matchLineEnding(generated, existing);
  assert.ok(
    !/[^\r]\n/.test(written),
    `still mixed: ${JSON.stringify(written)}`,
  );
});

test("a uniform file reports its ending and a mixed one reports none", () => {
  assert.strictEqual(detectUniformLineEnding("a\r\nb\r\n"), "\r\n");
  assert.strictEqual(detectUniformLineEnding("a\nb\n"), "\n");
  assert.strictEqual(detectUniformLineEnding("a\r\nb\n"), undefined);
  assert.strictEqual(detectUniformLineEnding(""), undefined);
  assert.strictEqual(detectUniformLineEnding("one line"), undefined);
});

test("a mixed file keeps the lines this extension does not own", () => {
  const mixed = "user CRLF line\r\nuser LF line\nmore\r\n";
  const generated = `${mixed}<!-- start -->\ngenerated\n<!-- end -->\n`;
  assert.strictEqual(
    matchLineEnding(generated, mixed),
    generated,
    "a mixed target must not be rewritten to one ending",
  );
});

test("a new file is left as written rather than guessed at", () => {
  const generated = "<!-- start -->\ngenerated\n<!-- end -->\n";
  assert.strictEqual(matchLineEnding(generated, ""), generated);
});

test("both instruction writers only convert a uniform target file", () => {
  const guarded = instructionManagerSource.match(
    /matchLineEnding\(\s*\n?\s*(?:updateSection|upsertCatalogSection)\(/g,
  );
  assert.ok(
    guarded && guarded.length >= 2,
    `Expected the catalog and instruction writers to be wrapped, found ${guarded ? guarded.length : 0}`,
  );
  assert.doesNotMatch(
    instructionManagerSource,
    /applyLineEnding\(/,
    "The instruction writers embed user content, so they must not force an ending",
  );
});

test("the JSON config writers keep the ending their file already used", () => {
  for (const fileName of ["hookConfigManager.ts", "mcpConfigManager.ts"]) {
    const source = fs.readFileSync(
      path.join(repoRoot, "src", fileName),
      "utf8",
    );
    assert.match(
      source,
      /applyLineEnding\(\s*\n?\s*`\$\{JSON\.stringify\(mutation\.config, null, 2\)\}\\n`/,
      `${fileName} re-serializes the whole config, so it must not flip the file's endings`,
    );
    assert.match(
      source,
      /detectDominantLineEnding\(await readTextOrEmpty\(configUri\)\)/,
      `${fileName} must detect the ending from the file it is about to overwrite`,
    );
  }
});

if (failures.length > 0) {
  console.log("RESULT=FAIL");
  process.exitCode = 1;
} else {
  console.log("RESULT=PASS");
}
