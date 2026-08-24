#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const srcDir = path.join(repoRoot, "src");
const customizationPathsPath = path.join(srcDir, "customizationPaths.ts");
const customizationPathsSource = fs.readFileSync(
  customizationPathsPath,
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

function loadCustomizationPaths(sourceText, siblingSkillsDirectory) {
  const transpiled = ts.transpileModule(sourceText, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: customizationPathsPath,
  });

  const stubs = {
    vscode: {
      workspace: {
        getConfiguration: () => ({
          get: () => siblingSkillsDirectory,
        }),
      },
      Uri: { file: (fsPath) => ({ fsPath }) },
      env: { appName: "Visual Studio Code" },
    },
    "./skillIndex": {},
  };

  const loaded = new Module(customizationPathsPath, module);
  loaded.filename = customizationPathsPath;
  loaded.paths = Module._nodeModulePaths(path.dirname(customizationPathsPath));
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) =>
    Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad(request, parent, isMain);
  try {
    loaded._compile(transpiled.outputText, customizationPathsPath);
  } finally {
    Module._load = originalLoad;
  }
  return loaded.exports;
}

/**
 * `get` answers with the manifest default for an unset declared key, which is
 * exactly what hides a legacy alias.
 */
function createConfigDouble({ declaredDefaults = {}, userValues = {} } = {}) {
  const pick = (key) => {
    const entry = userValues[key];
    if (!entry) {
      return undefined;
    }
    if (entry.workspaceFolderValue !== undefined) {
      return entry.workspaceFolderValue;
    }
    if (entry.workspaceValue !== undefined) {
      return entry.workspaceValue;
    }
    return entry.globalValue;
  };

  return {
    get(key, fallback) {
      const userValue = pick(key);
      if (userValue !== undefined) {
        return userValue;
      }
      if (Object.prototype.hasOwnProperty.call(declaredDefaults, key)) {
        return declaredDefaults[key];
      }
      return fallback;
    },
    inspect(key) {
      const entry = userValues[key] || {};
      const declared = Object.prototype.hasOwnProperty.call(
        declaredDefaults,
        key,
      )
        ? declaredDefaults[key]
        : undefined;
      if (declared === undefined && !userValues[key]) {
        return undefined;
      }
      return {
        key,
        defaultValue: declared,
        globalValue: entry.globalValue,
        workspaceValue: entry.workspaceValue,
        workspaceFolderValue: entry.workspaceFolderValue,
      };
    },
  };
}

const MANIFEST_DEFAULTS = {
  includeLocalResources: false,
  autoUpdateResourcesOnUpgrade: "prompt",
  resourcesDirectory: ".github/skills",
};

function isConfigLikeReceiver(node, sourceFile) {
  if (ts.isIdentifier(node)) {
    return /config/i.test(node.text);
  }
  if (ts.isCallExpression(node)) {
    return node.expression.getText(sourceFile).endsWith("getConfiguration");
  }
  return false;
}

function collectConfigKeys(node, sourceFile, keys) {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "get" &&
    isConfigLikeReceiver(node.expression.expression, sourceFile) &&
    node.arguments.length > 0
  ) {
    const keyArgument = node.arguments[0];
    // A key held in a constant hides the alias just as well as a literal does.
    if (ts.isStringLiteral(keyArgument) || ts.isIdentifier(keyArgument)) {
      keys.add(keyArgument.text);
    }
  }
  node.forEachChild((child) => collectConfigKeys(child, sourceFile, keys));
  return keys;
}

/**
 * A fallback between two different setting keys is only correct when it reads
 * user-set values; `get` makes the second key unreachable.
 */
function findCrossKeyGetFallbacks(sourceText, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.ES2020,
    true,
  );
  const violations = [];

  const report = (left, right, shape) => {
    const leftKeys = collectConfigKeys(left, sourceFile, new Set());
    const rightKeys = collectConfigKeys(right, sourceFile, new Set());
    if (leftKeys.size === 0 || rightKeys.size === 0) {
      return;
    }
    const distinct = [...rightKeys].filter((key) => !leftKeys.has(key));
    if (distinct.length === 0) {
      return;
    }
    violations.push(
      `${path.basename(fileName)}: ${shape} ${[...leftKeys].join("|")} -> ${distinct.join("|")}`,
    );
  };

  const visit = (node) => {
    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      report(node.left, node.right, "??/||");
    }
    if (ts.isConditionalExpression(node)) {
      report(node.condition, node.whenFalse, "ternary");
      report(node.condition, node.whenTrue, "ternary");
    }
    node.forEachChild(visit);
  };

  visit(sourceFile);
  return violations;
}

// The pre-fix implementation, kept verbatim so the fixture is proven to catch it.
const LEGACY_INCLUDE_LOCAL_RESOURCES = `export function getConfiguredIncludeLocalResources(
  config: vscode.WorkspaceConfiguration,
): boolean {
  return (
    config.get<boolean>("includeLocalResources") ??
    config.get<boolean>("includeLocalSkills") ??
    false
  );
}`;

const LEGACY_AUTO_UPDATE = `export function getConfiguredAutoUpdateResourcesOnUpgrade(
  config: vscode.WorkspaceConfiguration,
): string {
  return (
    config.get<string>("autoUpdateResourcesOnUpgrade") ||
    config.get<string>("autoUpdateSkillsOnUpgrade") ||
    "prompt"
  );
}`;

function buildPreFixSource() {
  const currentIncludeLocal = customizationPathsSource.match(
    /export function getConfiguredIncludeLocalResources\([\s\S]*?\n\}/,
  );
  const currentAutoUpdate = customizationPathsSource.match(
    /export function getConfiguredAutoUpdateResourcesOnUpgrade\([\s\S]*?\n\}/,
  );
  assert.ok(
    currentIncludeLocal && currentAutoUpdate,
    "Could not locate the alias resolvers in src/customizationPaths.ts",
  );
  return customizationPathsSource
    .replace(currentIncludeLocal[0], LEGACY_INCLUDE_LOCAL_RESOURCES)
    .replace(currentAutoUpdate[0], LEGACY_AUTO_UPDATE);
}

const current = loadCustomizationPaths(customizationPathsSource, undefined);
const preFixSource = buildPreFixSource();
const preFix = loadCustomizationPaths(preFixSource, undefined);

test("a legacy boolean alias survives the manifest default", () => {
  const config = createConfigDouble({
    declaredDefaults: MANIFEST_DEFAULTS,
    userValues: { includeLocalSkills: { globalValue: true } },
  });
  assert.strictEqual(current.getConfiguredIncludeLocalResources(config), true);
  assert.strictEqual(
    preFix.getConfiguredIncludeLocalResources(config),
    false,
    "This case must fail on the pre-fix implementation, or it proves nothing",
  );
});

test("the current boolean key wins even when it is set to false", () => {
  const config = createConfigDouble({
    declaredDefaults: MANIFEST_DEFAULTS,
    userValues: {
      includeLocalResources: { globalValue: false },
      includeLocalSkills: { workspaceValue: true },
    },
  });
  assert.strictEqual(current.getConfiguredIncludeLocalResources(config), false);
});

test("an unset boolean falls back to the manifest default", () => {
  const config = createConfigDouble({ declaredDefaults: MANIFEST_DEFAULTS });
  assert.strictEqual(current.getConfiguredIncludeLocalResources(config), false);
});

test("a legacy string alias survives the manifest default", () => {
  const config = createConfigDouble({
    declaredDefaults: MANIFEST_DEFAULTS,
    userValues: { autoUpdateSkillsOnUpgrade: { globalValue: "always" } },
  });
  assert.strictEqual(
    current.getConfiguredAutoUpdateResourcesOnUpgrade(config),
    "always",
  );
  assert.strictEqual(
    preFix.getConfiguredAutoUpdateResourcesOnUpgrade(config),
    "prompt",
    "This case must fail on the pre-fix implementation, or it proves nothing",
  );
});

test("the current string key wins over the legacy key", () => {
  const config = createConfigDouble({
    declaredDefaults: MANIFEST_DEFAULTS,
    userValues: {
      autoUpdateResourcesOnUpgrade: { globalValue: "never" },
      autoUpdateSkillsOnUpgrade: { workspaceValue: "always" },
    },
  });
  assert.strictEqual(
    current.getConfiguredAutoUpdateResourcesOnUpgrade(config),
    "never",
  );
});

test("an unset string falls back to the manifest default", () => {
  const config = createConfigDouble({ declaredDefaults: MANIFEST_DEFAULTS });
  assert.strictEqual(
    current.getConfiguredAutoUpdateResourcesOnUpgrade(config),
    "prompt",
  );
});

// No `resourceNinja` setting declares `scope: "resource"` today, so the folder
// branch is forward-looking rather than reachable in the shipped manifest.
test("the resolver prefers folder scope, then workspace, then user", () => {
  const allScopes = createConfigDouble({
    declaredDefaults: MANIFEST_DEFAULTS,
    userValues: {
      resourcesDirectory: {
        globalValue: "user/skills",
        workspaceValue: "workspace/skills",
        workspaceFolderValue: "folder/skills",
      },
    },
  });
  assert.strictEqual(
    current.getConfiguredSkillsDirectory(allScopes),
    "folder/skills",
  );

  const withoutFolder = createConfigDouble({
    declaredDefaults: MANIFEST_DEFAULTS,
    userValues: {
      resourcesDirectory: {
        globalValue: "user/skills",
        workspaceValue: "workspace/skills",
      },
    },
  });
  assert.strictEqual(
    current.getConfiguredSkillsDirectory(withoutFolder),
    "workspace/skills",
  );

  assert.strictEqual(
    preFix.getConfiguredSkillsDirectory(allScopes),
    "folder/skills",
    "The shared resolver is expected to be identical in both loads",
  );
});

test("a legacy directory alias still resolves when the current key is unset", () => {
  const config = createConfigDouble({
    declaredDefaults: MANIFEST_DEFAULTS,
    userValues: { skillsDirectory: { workspaceValue: "legacy/skills" } },
  });
  assert.strictEqual(
    current.getConfiguredSkillsDirectory(config),
    "legacy/skills",
  );
});

test("no source file falls back between two different setting keys", () => {
  const violations = fs
    .readdirSync(srcDir)
    .filter((name) => name.endsWith(".ts"))
    .flatMap((name) =>
      findCrossKeyGetFallbacks(
        fs.readFileSync(path.join(srcDir, name), "utf8"),
        path.join(srcDir, name),
      ),
    );
  assert.deepStrictEqual(
    violations,
    [],
    `A manifest default makes the second key unreachable: ${violations.join(", ")}`,
  );
});

test("the cross-key check is not vacuous against the real file", () => {
  const violations = findCrossKeyGetFallbacks(
    preFixSource,
    customizationPathsPath,
  );
  assert.strictEqual(
    violations.length,
    2,
    `Expected both pre-fix resolvers to be flagged, got: ${violations.join(", ")}`,
  );
});

if (failures.length > 0) {
  console.log("RESULT=FAIL");
  process.exitCode = 1;
} else {
  console.log("RESULT=PASS");
}
