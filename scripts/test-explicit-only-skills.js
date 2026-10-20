#!/usr/bin/env node

// A skill with `disable-model-invocation: true` is meant to be called by name.
// Listing it in the generated block invites the model to use it on its own, so
// it is left out by default. SKILL.md is the source of truth on every run.

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const os = require("os");
const path = require("path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");

function requireTypeScriptModule(filePath, stubs = {}) {
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
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) {
      return stubs[request];
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    loaded._compile(transpiled.outputText, filePath);
  } finally {
    Module._load = originalLoad;
  }
  return loaded.exports;
}

const vscodeStub = {
  Uri: { file: (fsPath) => ({ fsPath }) },
  workspace: {
    fs: {
      async readFile(uri) {
        return fs.readFileSync(uri.fsPath);
      },
    },
  },
};

const {
  parseDisableModelInvocation,
  excludeExplicitOnlySkills,
  markExplicitOnlySkillsRegistered,
} = requireTypeScriptModule(path.join(repoRoot, "src", "skillInvocation.ts"), {
  vscode: vscodeStub,
  "./skillInvocationMode": requireTypeScriptModule(
    path.join(repoRoot, "src", "skillInvocationMode.ts"),
  ),
});

const scannerSource = fs.readFileSync(
  path.join(repoRoot, "src", "localSkillScanner.ts"),
  "utf8",
);
const extensionSource = fs.readFileSync(
  path.join(repoRoot, "src", "extension.ts"),
  "utf8",
);

const failures = [];

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`FAIL ${name}: ${error && error.message}`);
  }
}

(async () => {
  await test("only an explicit true in the frontmatter marks a skill", () => {
    const wrap = (line) => `---\nname: a\n${line}\n---\n\n# A\n`;
    assert.strictEqual(
      parseDisableModelInvocation(wrap("disable-model-invocation: true")),
      true,
    );
    assert.strictEqual(
      parseDisableModelInvocation(wrap('disable-model-invocation: "True"')),
      true,
    );
    assert.strictEqual(
      parseDisableModelInvocation(
        wrap("disable-model-invocation: true # manual only"),
      ),
      true,
    );
    assert.strictEqual(
      parseDisableModelInvocation(wrap("disable-model-invocation: false")),
      false,
    );
    assert.strictEqual(
      parseDisableModelInvocation(wrap("user-invocable: false")),
      false,
    );
    assert.strictEqual(
      parseDisableModelInvocation("# A\ndisable-model-invocation: true\n"),
      false,
      "a key outside the frontmatter must not count",
    );
  });

  await test("CRLF frontmatter is read the same way", () => {
    assert.strictEqual(
      parseDisableModelInvocation(
        "---\r\nname: a\r\ndisable-model-invocation: true\r\n---\r\n",
      ),
      true,
    );
  });

  await test("a BOM, spacing, and nested or indented keys are handled", () => {
    const body = "---\nname: a\ndisable-model-invocation:true\n---\n";
    assert.strictEqual(parseDisableModelInvocation(`\uFEFF${body}`), true);
    assert.strictEqual(parseDisableModelInvocation(body), true);
    assert.strictEqual(
      parseDisableModelInvocation(
        "---\nname: a\nmetadata:\n  disable-model-invocation: true\n---\n",
      ),
      false,
      "an indented key belongs to another mapping",
    );
    assert.strictEqual(
      parseDisableModelInvocation(
        "---\nname: a\ndescription: |\n  disable-model-invocation: true\n---\n",
      ),
      false,
      "text inside a block scalar is not the flag",
    );
  });

  await test("a manual-only skill left out of the block is not shown as unregistered", () => {
    const make = () => [
      { name: "manual", disableModelInvocation: true, isRegistered: false },
      { name: "plain", isRegistered: false },
    ];

    const excluded = make();
    markExplicitOnlySkillsRegistered(excluded, false);
    assert.deepStrictEqual(
      excluded.map((skill) => skill.isRegistered),
      [true, false],
      "only the manual-only skill is treated as handled",
    );

    const included = make();
    markExplicitOnlySkillsRegistered(included, true);
    assert.deepStrictEqual(
      included.map((skill) => skill.isRegistered),
      [false, false],
      "when listing is on, registration still depends on the block",
    );
  });

  await test("the scanner applies the rule before any early return", () => {
    const body = scannerSource.slice(
      scannerSource.indexOf("async function checkRegistrationStatus"),
    );
    const applied = body.indexOf("markExplicitOnlySkillsRegistered(");
    const firstReturn = body.indexOf("return;");
    assert.ok(applied > 0, "checkRegistrationStatus must apply the rule");
    assert.ok(
      applied < firstReturn,
      "a disabled or missing instruction file must not skip the rule",
    );
    assert.match(
      scannerSource,
      /readSkillInvocationFromText\(normalizedText\)/,
    );
    assert.match(scannerSource, /disableModelInvocation: invocation === "explicitOnly"/);
  });

  await test("SKILL.md watchers regenerate output for every skill root", () => {
    const start = extensionSource.indexOf("const handleSkillMdChange");
    assert.ok(start > 0, "SKILL.md change handler is missing");
    const block = extensionSource.slice(start, start + 4000);
    assert.doesNotMatch(
      block,
      /if \(updated\)\s*\{[^}]*updateInstructionFile/,
      "regeneration must not depend on a metadata change",
    );
    assert.doesNotMatch(
      block,
      /if \(updated\s*&&/,
      "regeneration must not be gated on the metadata result",
    );
    assert.match(block, /await updateInstructionFile\(/);
    assert.match(block, /watcher\.onDidCreate\(handleSkillMdChange\)/);
    assert.match(block, /watcher\.onDidDelete\(handleSkillMdChange\)/);
    assert.match(block, /getConfiguredAdditionalSkillRoots\(config\)/);
    assert.match(block, /skillNinja\.additionalSkillRoots/);
  });

  await test("the filter re-reads SKILL.md on every call", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "explicit-only-"));
    try {
      const manual = path.join(dir, "manual.md");
      const normal = path.join(dir, "normal.md");
      fs.writeFileSync(
        manual,
        "---\nname: manual\ndisable-model-invocation: true\n---\n",
      );
      fs.writeFileSync(normal, "---\nname: normal\n---\n");
      const items = [
        { name: "manual", file: manual },
        { name: "normal", file: normal },
        { name: "missing", file: path.join(dir, "missing.md") },
        { name: "no-path", file: undefined },
      ];
      const pick = (item) => item.file;

      const excluded = await excludeExplicitOnlySkills(items, pick, false);
      assert.deepStrictEqual(
        excluded.map((item) => item.name),
        ["normal", "missing", "no-path"],
      );

      const included = await excludeExplicitOnlySkills(items, pick, true);
      assert.strictEqual(included.length, items.length);

      // Editing the file must change the next result with no metadata step.
      fs.writeFileSync(normal, "---\ndisable-model-invocation: true\n---\n");
      const afterEdit = await excludeExplicitOnlySkills(items, pick, false);
      assert.deepStrictEqual(
        afterEdit.map((item) => item.name),
        ["missing", "no-path"],
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  if (failures.length > 0) {
    console.error(`\n${failures.length} test(s) failed`);
    process.exit(1);
  }
})();
