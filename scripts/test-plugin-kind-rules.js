#!/usr/bin/env node

// Kind rules for plugin content must live in one place. This exercises the real
// src/resourceKinds.ts so the prefixed layout and the manifest-discovered plugin
// root can never drift apart again.

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

const {
  detectResourceKindFromPath,
  detectPluginChildResourceKind,
  isIncompleteSkillContent,
} = requireTypeScriptModule(path.join(repoRoot, "src", "resourceKinds.ts"));

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const PLUGIN_CHILD_CASES = [
  ["agents/demo.md", "agent"],
  ["instructions/demo.md", "instruction"],
  ["prompts/demo.md", "prompt"],
  ["rules/demo.mdc", "cursor-rule"],
  ["hooks/demo/README.md", "hook"],
  ["hooks/settings.json", "hook"],
  ["hooks/.skill-meta.json", undefined],
  ["mcp.json", "mcp"],
  [".vscode/mcp.json", "mcp"],
  ["mcp/demo.json", "mcp"],
  ["skills/demo/SKILL.md", "skill"],
  ["docs/readme.md", undefined],
  ["skills/demo/references/nested.md", undefined],
];

test("plugin-relative paths resolve to the documented kinds", () => {
  for (const [relativePath, expected] of PLUGIN_CHILD_CASES) {
    assert.strictEqual(
      detectPluginChildResourceKind(relativePath),
      expected,
      `detectPluginChildResourceKind("${relativePath}")`,
    );
  }
});

test("the plugins/<name>/ layout uses the same rules", () => {
  for (const prefix of ["plugins/acme/", ".github/plugins/acme/"]) {
    for (const [relativePath, expected] of PLUGIN_CHILD_CASES) {
      if (expected === undefined) {
        continue;
      }
      assert.strictEqual(
        detectResourceKindFromPath(`${prefix}${relativePath}`),
        expected,
        `detectResourceKindFromPath("${prefix}${relativePath}")`,
      );
    }
  }
});

test("plugin rules do not leak into top-level paths", () => {
  // Only the cursor-rule layout is shared between plugin and repository roots.
  assert.strictEqual(
    detectResourceKindFromPath("rules/demo.mdc"),
    "cursor-rule",
  );
  assert.strictEqual(detectResourceKindFromPath("agents/demo.md"), undefined);
  assert.strictEqual(
    detectResourceKindFromPath("instructions/demo.md"),
    undefined,
  );
  assert.strictEqual(detectResourceKindFromPath("prompts/demo.md"), undefined);
});

test("top-level suffix layouts still resolve", () => {
  assert.strictEqual(detectResourceKindFromPath("demo.agent.md"), "agent");
  assert.strictEqual(
    detectResourceKindFromPath("demo.instructions.md"),
    "instruction",
  );
  assert.strictEqual(detectResourceKindFromPath("demo.prompt.md"), "prompt");
  assert.strictEqual(
    detectResourceKindFromPath("skills/demo/SKILL.md"),
    "skill",
  );
  assert.strictEqual(
    detectResourceKindFromPath("plugins/acme/.claude-plugin/plugin.json"),
    "plugin",
  );
  assert.strictEqual(
    detectResourceKindFromPath("skills/demo/.skill-meta.json"),
    undefined,
  );
});

test("plugin child rules are declared only in src/resourceKinds.ts", () => {
  const srcDir = path.join(repoRoot, "src");
  const declarations = [];
  const patternCopies = [];

  for (const fileName of fs.readdirSync(srcDir)) {
    if (!fileName.endsWith(".ts")) {
      continue;
    }
    const text = fs.readFileSync(path.join(srcDir, fileName), "utf8");
    if (/function\s+detectPluginChildResourceKind\s*\(/.test(text)) {
      declarations.push(fileName);
    }
    if (fileName === "resourceKinds.ts") {
      continue;
    }
    // A reformatted copy still has to spell out several of the leaf layouts.
    const leafHits = [
      /\^agents\\?\//,
      /\^instructions\\?\//,
      /\^prompts\\?\//,
      /\^rules\\?\//,
    ].filter((pattern) => pattern.test(text)).length;
    if (leafHits >= 2) {
      patternCopies.push(fileName);
    }
  }

  assert.deepStrictEqual(
    declarations,
    ["resourceKinds.ts"],
    "detectPluginChildResourceKind must be declared exactly once",
  );
  assert.deepStrictEqual(
    patternCopies,
    [],
    "Import detectPluginChildResourceKind instead of re-declaring the plugin kind rules",
  );

  const indexUpdater = fs.readFileSync(
    path.join(srcDir, "indexUpdater.ts"),
    "utf8",
  );
  assert.match(
    indexUpdater,
    /detectPluginChildResourceKind,?\s*[\s\S]{0,400}?from "\.\/resourceKinds"/,
    "src/indexUpdater.ts should import the shared plugin kind rules",
  );
});

test("the preset generator agrees with the runtime kind rules", () => {
  // The generator is a standalone node script and keeps its own copy, so pin it
  // to the src implementation instead of letting the two drift.
  const generator = require("./update-preset-index.js");

  for (const [relativePath, expected] of PLUGIN_CHILD_CASES) {
    assert.strictEqual(
      generator.detectPluginChildResourceKind(relativePath),
      expected,
      `generator detectPluginChildResourceKind("${relativePath}")`,
    );
  }

  const layoutSamples = [
    "plugins/acme/agents/demo.md",
    ".github/plugins/acme/instructions/demo.md",
    "plugins/acme/rules/demo.mdc",
    "plugins/acme/mcp/demo.json",
    "rules/demo.mdc",
    "agents/demo.md",
    "demo.agent.md",
    "demo.instructions.md",
    "demo.prompt.md",
    "skills/demo/SKILL.md",
    "skills/demo/references/nested.md",
    "hooks/settings.json",
    "mcp.json",
    "docs/readme.md",
  ];

  for (const sample of layoutSamples) {
    assert.strictEqual(
      generator.detectResourceKindFromPath(sample),
      detectResourceKindFromPath(sample),
      `generator and runtime disagree on "${sample}"`,
    );
  }
});

test("incomplete skill content detection stays limited to template-only bodies", () => {
  const template = "# demo-skill\n\nA demo skill\n\nSource: octo/demo\n";
  assert.strictEqual(isIncompleteSkillContent(template), true);
  assert.strictEqual(
    isIncompleteSkillContent(template.replace(/\n/g, "\r\n")),
    true,
    "CRLF copies of the generated template must also be detected",
  );
  assert.strictEqual(isIncompleteSkillContent(""), true);
  assert.strictEqual(isIncompleteSkillContent("   \n\n"), true);

  const real = `---\nname: demo\ndescription: Demo\n---\n\n# Demo\n\n${"body ".repeat(30)}`;
  assert.strictEqual(isIncompleteSkillContent(real), false);
  assert.strictEqual(
    isIncompleteSkillContent(
      `# Demo\n\n${"Long prose without frontmatter. ".repeat(10)}\n`,
    ),
    false,
    "a real skill without frontmatter must not be flagged",
  );
});

console.log("\nAll plugin resource kind contract tests passed.");
