#!/usr/bin/env node

// A test that re-implements an exported src function validates a copy, not the
// shipped code. This ratchet blocks new mirrors and only lets the known debt shrink.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");

// file -> maximum mirrored src functions still tolerated. Lower these as scripts are
// converted to load the real module; never raise one to make a new copy pass.
// A number may only go up when an existing copy becomes visible because src started
// exporting its counterpart, and the reason must be recorded here.
const MIRROR_DEBT_BUDGET = {
  "audit-resource-installability.js": 3,
  // +1 on 2026-08-07: src/resourceKinds.ts now exports detectPluginChildResourceKind.
  "test-full-plugin-index.js": 7,
  "test-global-home-routing.js": 5,
  "test-microsoft-install-e2e.js": 1,
  "test-plugin-manifests.js": 1,
  "test-resource-kinds.js": 15,
  "test-resource-targets.js": 1,
  "test-whenToUse.js": 1,
  // +1 on 2026-08-07 for the same reason; that copy is pinned to src by
  // scripts/test-plugin-kind-rules.js so it cannot drift.
  "update-preset-index.js": 11,
};

// This guard reads its own budget, so scanning itself would be self-referential.
const SELF_FILE_NAME = path.basename(__filename);

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function getExportedSrcFunctions() {
  const exported = new Map();
  const srcDir = path.join(repoRoot, "src");

  for (const fileName of fs.readdirSync(srcDir)) {
    if (!fileName.endsWith(".ts")) {
      continue;
    }
    const text = fs.readFileSync(path.join(srcDir, fileName), "utf8");
    for (const match of text.matchAll(
      /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g,
    )) {
      if (!exported.has(match[1])) {
        exported.set(match[1], fileName);
      }
    }
  }

  return exported;
}

function getMirrorsByFile() {
  const exported = getExportedSrcFunctions();
  const scriptsDir = path.join(repoRoot, "scripts");
  const mirrors = new Map();

  for (const fileName of fs.readdirSync(scriptsDir)) {
    if (!fileName.endsWith(".js") || fileName === SELF_FILE_NAME) {
      continue;
    }
    const text = fs.readFileSync(path.join(scriptsDir, fileName), "utf8");
    const names = [];
    for (const match of text.matchAll(/^\s*function\s+([A-Za-z0-9_]+)/gm)) {
      if (exported.has(match[1])) {
        names.push(`${match[1]} (src/${exported.get(match[1])})`);
      }
    }
    if (names.length > 0) {
      mirrors.set(fileName, names);
    }
  }

  return mirrors;
}

const mirrorsByFile = getMirrorsByFile();

test("no script introduces a new mirror of an exported src function", () => {
  const unexpected = [...mirrorsByFile.entries()].filter(
    ([fileName]) => MIRROR_DEBT_BUDGET[fileName] === undefined,
  );

  assert.deepStrictEqual(
    unexpected.map(([fileName, names]) => `${fileName}: ${names.join(", ")}`),
    [],
    "Load the real module with requireTypeScriptModule instead of re-implementing it",
  );
});

test("known mirror debt never grows", () => {
  const overBudget = [];
  for (const [fileName, budget] of Object.entries(MIRROR_DEBT_BUDGET)) {
    const actual = (mirrorsByFile.get(fileName) || []).length;
    if (actual > budget) {
      overBudget.push(`${fileName}: ${actual} > ${budget}`);
    }
  }

  assert.deepStrictEqual(overBudget, []);
});

test("the mirror debt budget has no stale entries", () => {
  const stale = [];
  for (const [fileName, budget] of Object.entries(MIRROR_DEBT_BUDGET)) {
    if (!fs.existsSync(path.join(repoRoot, "scripts", fileName))) {
      stale.push(`${fileName}: file no longer exists`);
      continue;
    }
    const actual = (mirrorsByFile.get(fileName) || []).length;
    if (actual < budget) {
      stale.push(`${fileName}: budget ${budget} but only ${actual} remain`);
    }
  }

  assert.deepStrictEqual(
    stale,
    [],
    "Lower or remove the budget entry so the ratchet keeps its value",
  );
});

console.log("\nAll mirror-implementation guard tests passed.");
