#!/usr/bin/env node

// A batch install that lands two resources in the same place overwrites the first one without
// a word. The destination comes from getResourceTargetUri, so the pure grouping lives apart and
// is pinned here, together with the shipped curated sets and the wiring in the pick flow.

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");

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

const { findInstallCollisions, keepFirstOfEachCollision } =
  requireTypeScriptModule(path.join(repoRoot, "src", "installCollisions.ts"));
const { sanitizeResourceInstallName } = requireTypeScriptModule(
  path.join(repoRoot, "src", "resourceKinds.ts"),
);
const extensionSource = fs.readFileSync(
  path.join(repoRoot, "src", "extension.ts"),
  "utf8",
);

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

const dest = (item) => item.to;

test("items that share a destination are grouped in selection order", () => {
  const items = [
    { name: "a", to: "/ws/skills/code-review" },
    { name: "b", to: "/ws/skills/other" },
    { name: "c", to: "/ws/skills/code-review" },
    { name: "d", to: "/ws/skills/code-review" },
  ];
  const collisions = findInstallCollisions(items, dest, true);
  assert.strictEqual(collisions.length, 1);
  assert.deepStrictEqual(
    collisions[0].items.map((item) => item.name),
    ["a", "c", "d"],
  );
  assert.deepStrictEqual(
    keepFirstOfEachCollision(items, collisions).map((item) => item.name),
    ["a", "b"],
  );
});

test("separators and trailing slashes do not hide a collision", () => {
  const items = [
    { name: "a", to: "C:\\ws\\skills\\x" },
    { name: "b", to: "C:/ws/skills/x/" },
  ];
  assert.strictEqual(findInstallCollisions(items, dest, true).length, 1);
});

test("case matters only on a case-sensitive file system", () => {
  const items = [
    { name: "a", to: "/ws/agents/Helper.agent.md" },
    { name: "b", to: "/ws/agents/helper.agent.md" },
  ];
  assert.strictEqual(findInstallCollisions(items, dest, false).length, 1);
  assert.strictEqual(findInstallCollisions(items, dest, true).length, 0);
});

test("distinct destinations and unknown destinations never collide", () => {
  const items = [
    { name: "a", to: "/ws/x" },
    { name: "b", to: "/ws/y" },
    { name: "c", to: undefined },
    { name: "d", to: undefined },
  ];
  const collisions = findInstallCollisions(items, dest, true);
  assert.deepStrictEqual(collisions, []);
  assert.deepStrictEqual(keepFirstOfEachCollision(items, collisions), items);
});

test("independent collisions are each reduced to their first item", () => {
  const items = [
    { name: "a1", to: "/p" },
    { name: "b1", to: "/q" },
    { name: "a2", to: "/p" },
    { name: "b2", to: "/q" },
    { name: "solo", to: "/r" },
  ];
  const collisions = findInstallCollisions(items, dest, true);
  assert.strictEqual(collisions.length, 2);
  assert.deepStrictEqual(
    keepFirstOfEachCollision(items, collisions).map((item) => item.name),
    ["a1", "b1", "solo"],
  );
});

test("different names fold into one folder under the install-name rule", () => {
  // The rule decides the folder, so the names a user sees can differ while the folder is shared.
  const folders = ["Code Review", "code-review", "code.review", "Code  Review"].map(
    sanitizeResourceInstallName,
  );
  assert.deepStrictEqual(new Set(folders), new Set(["code-review"]));
  const items = ["Code Review", "code-review", "other-skill"].map((name) => ({
    name,
    to: `/ws/.github/skills/${sanitizeResourceInstallName(name)}`,
  }));
  assert.strictEqual(findInstallCollisions(items, dest, true).length, 1);
});

test("a shipped curated set never installs two resources into one folder", () => {
  const index = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "resources", "skill-index.json"), "utf8"),
  );
  const offenders = [];
  for (const bundle of index.bundles || []) {
    const names = bundle.installOrder || bundle.skills || [];
    const collisions = findInstallCollisions(
      names,
      (name) => sanitizeResourceInstallName(name),
      true,
    );
    if (collisions.length > 0) {
      offenders.push(`${bundle.id}: ${collisions.map((c) => c.items.join("/")).join(", ")}`);
    }
  }
  assert.deepStrictEqual(offenders, []);
});

test("the plugin and curated-set pick checks destinations before it asks to install", () => {
  const flowStart = extensionSource.indexOf(
    "const pickedItems = await vscode.window.showQuickPick(selectableItems",
  );
  assert.ok(flowStart > 0, "the multi-select pick must exist");
  const flow = extensionSource.slice(flowStart, flowStart + 9000);
  const resolveAt = flow.indexOf("resolveBatchInstallCollisions(");
  const confirmAt = flow.indexOf("showInformationMessage(");
  const installAt = flow.indexOf("await installSkill(");
  assert.ok(resolveAt > 0, "the pick flow must resolve collisions");
  assert.ok(
    resolveAt < confirmAt && confirmAt < installAt,
    "collisions are resolved before the confirmation and before any install",
  );
  assert.match(
    extensionSource,
    /getResourceTargetUri\(workspaceUri, config, skill, installTarget\)/,
    "the destination must come from the same function the installer uses",
  );
  assert.match(
    flow,
    /const selectedItems = await resolveBatchInstallCollisions\(/,
    "everything after the pick must use the reduced list",
  );
});

test("Browse multi-select does not turn the selection array into another command's argument", () => {
  assert.match(
    extensionSource,
    /createTreeView\(\s*"resourceNinja\.browseView",\s*\{[^}]*canSelectMany: true/,
    "Browse is the multi-select view",
  );
  for (const id of ["installedView", "userResourcesView"]) {
    assert.doesNotMatch(
      extensionSource,
      new RegExp(`createTreeView\\(\\s*"resourceNinja\\.${id}",\\s*\\{[^}]*canSelectMany`),
      `${id} stays single-select`,
    );
  }

  // With several rows selected, VS Code passes the selection as a second argument. A handler that
  // reads a second parameter as options or a target would misread it.
  const pkg = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
  );
  const browseCommands = new Set(
    (pkg.contributes.menus["view/item/context"] || [])
      .filter((entry) => /view == resourceNinja\.browseView/.test(entry.when))
      .map((entry) => entry.command),
  );
  assert.ok(browseCommands.size > 0);
  const offenders = [];
  for (const id of browseCommands) {
    if (id === "resourceNinja.installSelectedResources") {
      continue; // reads the selection on purpose
    }
    const match = extensionSource.match(
      new RegExp(`registerCommand\\(\\s*"${id.replace(/\./g, "\\.")}",\\s*(async\\s*)?\\(([^)]*)\\)`),
    );
    if (!match) {
      continue; // a named handler, checked below
    }
    const parameters = match[2].split(",").filter((part) => part.trim());
    if (parameters.length > 1) {
      offenders.push(`${id}: (${match[2].trim()})`);
    }
  }
  assert.deepStrictEqual(offenders, []);

  const normalize = extensionSource.match(
    /function normalizeReinstallCommandOptions\([\s\S]*?\r?\n  \}/,
  );
  assert.ok(normalize, "reinstall options are normalized in one place");
  assert.match(
    normalize[0],
    /Array\.isArray\(value\)/,
    "the reinstall command takes options as its second argument, so an array must not count",
  );
});

test("the three bulk-install entry points share one confirmation flow", () => {
  for (const id of [
    "resourceNinja.installSelectedResources",
    "resourceNinja.installMultiple",
    "resourceNinja.installSourceResources",
  ]) {
    const start = extensionSource.indexOf(`"${id}"`);
    assert.ok(start > 0, `${id} must be registered`);
    assert.match(
      extensionSource.slice(start, start + 2200),
      /installResourceBatch\(/,
      `${id} installs through the shared batch flow`,
    );
  }
  const batch = extensionSource.match(
    /async function installResourceBatch\([\s\S]*?\r?\n  \}\r?\n\r?\n  \/\*\* 候補の一覧/,
  );
  assert.ok(batch, "the shared batch flow must exist");
  const body = batch[0];
  assert.ok(
    body.indexOf("resolveBatchInstallCollisions(") < body.indexOf("{ modal: true }") &&
      body.indexOf("{ modal: true }") < body.indexOf("await installSkill("),
    "destinations are checked, then confirmed, then installed",
  );
  assert.match(body, /isSkillInstalled/, "installed resources are left out");
});

async function main() {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${name}`);
      console.error(error instanceof Error ? error.stack : String(error));
    }
  }
  if (failed > 0) {
    process.exitCode = 1;
    return;
  }
  console.log("RESULT=PASS");
}

main();
