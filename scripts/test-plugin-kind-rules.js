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
  AGENT_PLUGINS_MANIFEST_KIND,
  AGENT_PLUGINS_MANIFEST_SCHEMA,
  detectResourceKindFromPath,
  detectPluginChildResourceKind,
  getAgentPluginsConformanceIssue,
  isAgentPluginsManifest,
  isIncompleteSkillContent,
  markAgentPluginsIssueDescription,
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
  ["hooks.json", "hook"],
  ["mcp.json", "mcp"],
  [".mcp.json", "mcp"],
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
  // resources/skill-index.json is written by the generator, so a generator export
  // that stops resolving to the runtime rules ships a catalog the extension then
  // disagrees with. Reuse the runtime sample list so both stay in step.
  const generator = require("./update-preset-index.js");

  const differentialPaths = [
    ...PLUGIN_CHILD_CASES.map(([relativePath]) => relativePath),
    ...PLUGIN_CHILD_CASES.map(
      ([relativePath]) => `plugins/acme/${relativePath}`,
    ),
    ...PLUGIN_CHILD_CASES.map(
      ([relativePath]) => `.github/plugins/acme/${relativePath}`,
    ),
    "demo.agent.md",
    "demo.instructions.md",
    "demo.prompt.md",
    "skills/demo/SKILL.md",
    "skills/demo/.skill-meta.json",
    "plugins/acme/.claude-plugin/plugin.json",
    "AGENTS.md",
    "CLAUDE.md",
    "GEMINI.md",
    ".github/copilot-instructions.md",
    ".codex/AGENTS.md",
  ];

  for (const resourcePath of differentialPaths) {
    assert.strictEqual(
      generator.detectPluginChildResourceKind(resourcePath),
      detectPluginChildResourceKind(resourcePath),
      `generator.detectPluginChildResourceKind("${resourcePath}")`,
    );
    assert.strictEqual(
      generator.detectResourceKindFromPath(resourcePath),
      detectResourceKindFromPath(resourcePath),
      `generator.detectResourceKindFromPath("${resourcePath}")`,
    );
  }
});

test("the preset generator does not re-declare the runtime kind rules", () => {
  const generator = require("./update-preset-index.js");

  assert.strictEqual(
    generator.detectPluginChildResourceKind.toString(),
    detectPluginChildResourceKind.toString(),
    "the generator must re-export src/resourceKinds.ts detectPluginChildResourceKind",
  );
  assert.strictEqual(
    generator.detectResourceKindFromPath.toString(),
    detectResourceKindFromPath.toString(),
    "the generator must re-export src/resourceKinds.ts detectResourceKindFromPath",
  );

  // A `function <name>(` scan misses `const <name> = function ...` and arrows, so
  // walk the syntax tree instead. The destructuring that imports these names from
  // src/resourceKinds.ts is the one legitimate binding form.
  const generatorPath = path.join(__dirname, "update-preset-index.js");
  const guardedNames = new Set([
    "detectPluginChildResourceKind",
    "detectResourceKindFromPath",
    "isPluginManifestPath",
    "getPluginRootFromManifestPath",
  ]);

  const sourceFile = ts.createSourceFile(
    generatorPath,
    fs.readFileSync(generatorPath, "utf8"),
    ts.ScriptTarget.ES2020,
    true,
    ts.ScriptKind.JS,
  );
  const localBindings = [];

  const isSharedRuntimeImport = (declaration) => {
    if (!declaration.initializer) {
      return false;
    }
    const initializer = declaration.initializer.getText(sourceFile);
    return (
      /requireTypeScriptModule\s*\(/.test(initializer) &&
      /resourceKinds/.test(initializer)
    );
  };

  const visit = (node) => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name &&
      guardedNames.has(node.name.text)
    ) {
      localBindings.push(`${node.name.text} (declaration)`);
    } else if (ts.isVariableDeclaration(node)) {
      if (ts.isIdentifier(node.name) && guardedNames.has(node.name.text)) {
        localBindings.push(`${node.name.text} (local variable)`);
      } else if (
        ts.isObjectBindingPattern(node.name) &&
        !isSharedRuntimeImport(node)
      ) {
        for (const element of node.name.elements) {
          if (
            ts.isIdentifier(element.name) &&
            guardedNames.has(element.name.text)
          ) {
            localBindings.push(
              `${element.name.text} (rebound by destructuring)`,
            );
          }
        }
      }
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      guardedNames.has(node.left.text)
    ) {
      localBindings.push(`${node.left.text} (assignment)`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  assert.deepStrictEqual(
    localBindings,
    [],
    "Import these names from src/resourceKinds.ts instead of re-declaring them",
  );
});

test("the preset generator agrees with the runtime manifest kinds", () => {
  // resources/skill-index.json is written by the generator, so a manifest kind that
  // only the runtime can produce would never reach the shipped index.
  const generator = require("./update-preset-index.js");

  const manifestCases = [
    {
      path: "plugins/aws-serverless/plugin.json",
      manifest: {
        $schema: AGENT_PLUGINS_MANIFEST_SCHEMA,
        name: "aws-serverless",
        version: "1.0.0",
      },
      expected: AGENT_PLUGINS_MANIFEST_KIND,
    },
    {
      path: "plugins/legacy/plugin.json",
      manifest: { name: "legacy", version: "0.1.0" },
      expected: "plugin",
    },
    {
      path: "plugins/feature-dev/.claude-plugin/plugin.json",
      manifest: {
        $schema: AGENT_PLUGINS_MANIFEST_SCHEMA,
        name: "feature-dev",
      },
      expected: "claude-plugin",
    },
    {
      // The schema alone is not a conformance claim: a spec-invalid `name` makes the
      // whole plugin invalid, so both paths must withhold the agent-plugins label.
      path: "plugins/invalid-name/plugin.json",
      manifest: {
        $schema: AGENT_PLUGINS_MANIFEST_SCHEMA,
        name: "Invalid--Name",
        version: "1.0.0",
      },
      expected: "plugin",
    },
    {
      path: "plugins/nameless/plugin.json",
      manifest: { $schema: AGENT_PLUGINS_MANIFEST_SCHEMA, version: "1.0.0" },
      expected: "plugin",
    },
    {
      // §5.4 makes a malformed `author` fatal, so the conformance label is
      // withheld even though `$schema` and `name` are both fine.
      path: "plugins/acme-tools/plugin.json",
      manifest: {
        $schema: AGENT_PLUGINS_MANIFEST_SCHEMA,
        name: "acme-tools",
        author: { name: "Acme", role: "maintainer" },
      },
      expected: "plugin",
    },
  ];

  for (const { path: manifestPath, manifest, expected } of manifestCases) {
    assert.strictEqual(
      isAgentPluginsManifest(manifestPath, manifest),
      expected === AGENT_PLUGINS_MANIFEST_KIND,
      `isAgentPluginsManifest("${manifestPath}")`,
    );
    assert.strictEqual(
      generator.parsePluginManifestMetadata(
        JSON.stringify(manifest),
        manifestPath,
      ).pluginManifestKind,
      expected,
      `generator manifest kind for "${manifestPath}"`,
    );
  }

  assert.strictEqual(
    generator.parsePluginManifestMetadata(
      JSON.stringify(manifestCases[0].manifest),
      manifestCases[0].path,
    ).description,
    "Agent Plugins 1.0.0 manifest for aws-serverless",
  );
});

test("the preset generator marks non-conformant manifests exactly as the runtime does", () => {
  // The description is the only surface an end user sees, so a marker that differs
  // between the shipped catalog and a live Update Index would tell two stories.
  const generator = require("./update-preset-index.js");

  const markerCases = [
    {
      path: "plugins/acme-tools/plugin.json",
      manifest: {
        $schema: AGENT_PLUGINS_MANIFEST_SCHEMA,
        name: "acme-tools",
        author: { name: "Acme", role: "maintainer" },
      },
    },
    {
      path: "plugins/invalid-name/plugin.json",
      manifest: {
        $schema: AGENT_PLUGINS_MANIFEST_SCHEMA,
        name: "Invalid--Name",
        description: "Acme tools",
      },
    },
    {
      path: "plugins/bad-keywords/plugin.json",
      manifest: {
        $schema: AGENT_PLUGINS_MANIFEST_SCHEMA,
        name: "bad-keywords",
        description: "Acme tools",
        keywords: ["acme", 7],
      },
    },
  ];

  for (const { path: manifestPath, manifest } of markerCases) {
    const issue = getAgentPluginsConformanceIssue(manifestPath, manifest);
    assert.notStrictEqual(
      issue,
      undefined,
      `"${manifestPath}" must be reported as non-conformant`,
    );
    const expected = markAgentPluginsIssueDescription(
      manifest.description || `Plugin manifest for ${manifest.name}`,
      issue,
    );
    assert.strictEqual(
      generator.parsePluginManifestMetadata(
        JSON.stringify(manifest),
        manifestPath,
      ).description,
      expected,
      `generator description marker for "${manifestPath}"`,
    );
  }

  // The runtime parser needs `vscode`, so pin it to the same shared helpers by
  // source instead of copying their behaviour here.
  const indexUpdater = fs.readFileSync(
    path.join(repoRoot, "src", "indexUpdater.ts"),
    "utf8",
  );
  assert.match(
    indexUpdater,
    /getAgentPluginsConformanceIssue\(filePath, manifest\)/,
    "the runtime must derive the issue from the shared helper",
  );
  assert.match(
    indexUpdater,
    /markAgentPluginsIssueDescription\(/,
    "the runtime must build the description marker with the shared helper",
  );
});

test("the generator keeps the parsed manifest kind when it builds the resource", () => {
  // Parsing alone is not enough: the resource object is assembled from both the
  // parsed metadata and the path-derived plugin info. Only the parser can see
  // `$schema`, so letting the path-derived info win here silently downgrades
  // agent-plugins to plugin on its way into resources/skill-index.json.
  const generator = require("./update-preset-index.js");

  const manifestPath = "plugins/aws-serverless/plugin.json";
  const manifestContent = JSON.stringify({
    $schema: AGENT_PLUGINS_MANIFEST_SCHEMA,
    name: "aws-serverless",
    version: "1.0.0",
  });

  const pluginInfo = generator
    .getPluginManifestInfoByRoot([
      manifestPath,
      "plugins/aws-serverless/skills/demo/SKILL.md",
    ])
    .get("plugins/aws-serverless");
  assert.strictEqual(
    pluginInfo.pluginManifestKind,
    "plugin",
    "the path-derived info cannot see $schema, which is why it must not win",
  );

  const skillInfo = generator.parsePluginManifestMetadata(
    manifestContent,
    manifestPath,
  );
  assert.deepStrictEqual(
    generator.resolveResourcePluginFields("plugin", skillInfo, pluginInfo),
    {
      pluginRoot: "plugins/aws-serverless",
      pluginManifestPath: manifestPath,
      pluginManifestKind: AGENT_PLUGINS_MANIFEST_KIND,
    },
  );

  // Child resources still inherit the manifest info discovered from the tree.
  const childSkillInfo = { name: "demo", description: "Demo" };
  assert.deepStrictEqual(
    generator.resolveResourcePluginFields("skill", childSkillInfo, pluginInfo),
    {
      pluginRoot: "plugins/aws-serverless",
      pluginManifestPath: manifestPath,
      pluginManifestKind: "plugin",
    },
  );
  assert.deepStrictEqual(
    generator.resolveResourcePluginFields("skill", childSkillInfo, undefined),
    {},
  );
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
