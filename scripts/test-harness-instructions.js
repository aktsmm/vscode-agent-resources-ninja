#!/usr/bin/env node

// Install destinations and harness instructions. The pure modules are loaded as they
// are, and the AGENTS.md handling runs against real files through the same
// `HarnessFileSystem` interface the extension fills with the VS Code file system.

const assert = require("assert");
const fs = require("fs");
const fsp = require("fs/promises");
const Module = require("module");
const os = require("os");
const path = require("path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const srcDir = path.join(repoRoot, "src");

function requireTypeScriptModule(filePath, stubs = {}) {
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filePath,
  });
  const loadedModule = new Module(filePath, module);
  loadedModule.filename = filePath;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(filePath));

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) {
      return stubs[request];
    }
    return originalLoad(request, parent, isMain);
  };
  try {
    loadedModule._compile(transpiled.outputText, filePath);
  } finally {
    Module._load = originalLoad;
  }
  return loadedModule.exports;
}

const pathSafety = requireTypeScriptModule(path.join(srcDir, "pathSafety.ts"));
const destinations = requireTypeScriptModule(
  path.join(srcDir, "installDestinations.ts"),
  { "./pathSafety": pathSafety },
);
const harness = requireTypeScriptModule(
  path.join(srcDir, "harnessInstructions.ts"),
);

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

const USER_DATA = path.resolve("/users/me/AppData/Roaming/Code/User");

// ---------------------------------------------------------------------------
// Destinations
// ---------------------------------------------------------------------------

test("a folder inside the VS Code user-data folder is the legacy profile", () => {
  assert.strictEqual(
    destinations.isLegacyUserProfileLocation(
      path.join(USER_DATA, "instructions", "a.instructions.md"),
      USER_DATA,
    ),
    true,
  );
  assert.strictEqual(
    destinations.isLegacyUserProfileLocation(
      path.resolve("/users/me/.copilot/instructions/a.instructions.md"),
      USER_DATA,
    ),
    false,
    "the Copilot home is not the legacy profile",
  );
  assert.strictEqual(
    destinations.isLegacyUserProfileLocation(
      path.resolve("/users/me/AppData/Roaming/Code/User2/x.md"),
      USER_DATA,
    ),
    false,
    "a sibling folder with the same prefix is not inside",
  );
});

test("destination states separate first install, browse only and read-only", () => {
  const { classifyInstallDestination, allowsNewInstall } = destinations;
  assert.strictEqual(
    classifyInstallDestination({ hasExistingEntries: false }),
    "installable-empty",
  );
  assert.strictEqual(
    classifyInstallDestination({ hasExistingEntries: true }),
    "installable",
  );
  assert.strictEqual(
    classifyInstallDestination({ hasExistingEntries: undefined }),
    "installable",
    "an uninspectable folder is not claimed to be empty",
  );
  assert.strictEqual(
    classifyInstallDestination({
      legacyUserProfile: true,
      legacyInstallTargetEnabled: false,
      hasExistingEntries: true,
    }),
    "browse-only",
  );
  assert.strictEqual(
    classifyInstallDestination({
      legacyUserProfile: true,
      legacyInstallTargetEnabled: true,
      hasExistingEntries: true,
    }),
    "installable",
  );
  assert.strictEqual(
    classifyInstallDestination({
      readOnly: true,
      legacyUserProfile: true,
      legacyInstallTargetEnabled: true,
    }),
    "read-only",
  );
  assert.strictEqual(allowsNewInstall("browse-only"), false);
  assert.strictEqual(allowsNewInstall("read-only"), false);
  assert.strictEqual(allowsNewInstall("installable-empty"), true);
  for (const state of [
    "installable",
    "installable-empty",
    "browse-only",
    "read-only",
  ]) {
    for (const isJa of [true, false]) {
      assert.ok(destinations.getInstallDestinationStateLabel(state, isJa));
    }
  }
  assert.match(
    destinations.getInstallDestinationStateReason("browse-only", false),
    /legacyUserProfileInstallTarget/,
  );
});

test("a default of userData never silently lands somewhere else", () => {
  const { decideDefaultUserDataTarget } = destinations;
  assert.strictEqual(
    decideDefaultUserDataTarget({
      aliasesGlobalHome: false,
      legacyUserProfile: true,
      legacyInstallTargetEnabled: false,
    }),
    "reselect",
  );
  assert.strictEqual(
    decideDefaultUserDataTarget({
      aliasesGlobalHome: false,
      legacyUserProfile: true,
      legacyInstallTargetEnabled: true,
    }),
    "use-user-profile",
  );
  assert.strictEqual(
    decideDefaultUserDataTarget({
      aliasesGlobalHome: true,
      legacyUserProfile: false,
      legacyInstallTargetEnabled: false,
    }),
    "use-global-home-alias",
    "kinds without a user-data folder keep their documented alias",
  );
  assert.strictEqual(
    decideDefaultUserDataTarget({
      aliasesGlobalHome: false,
      legacyUserProfile: false,
      legacyInstallTargetEnabled: false,
    }),
    "use-user-profile",
    "a folder the user configured outside user-data is an explicit choice",
  );
});

test("a reinstall may only write back inside the root of the removed copy", () => {
  const { isReinstallDestinationInOriginalRoot } = destinations;
  const root = path.resolve("/home/me/.copilot");
  assert.strictEqual(
    isReinstallDestinationInOriginalRoot(
      root,
      path.join(root, "skills", "demo"),
    ),
    true,
  );
  assert.strictEqual(
    isReinstallDestinationInOriginalRoot(
      path.join(USER_DATA, "agents"),
      path.join(USER_DATA, "prompts", "a.agent.md"),
    ),
    false,
    "an agent found in User/agents would otherwise move to User/prompts",
  );
});

// ---------------------------------------------------------------------------
// Harness locations
// ---------------------------------------------------------------------------

test("harness destinations resolve to the documented folders", () => {
  const ws = path.resolve("/work/project");
  const home = path.resolve("/home/me");
  const dir = (scope, env = {}) =>
    harness.getHarnessInstructionDirectory(scope, ws, env, home);
  assert.strictEqual(dir("claudeRules"), path.join(ws, ".claude", "rules"));
  assert.strictEqual(
    dir("claudeUserRules"),
    path.join(home, ".claude", "rules"),
  );
  assert.strictEqual(dir("codexInstructions"), path.join(ws, "instructions"));
  assert.strictEqual(
    dir("codexUserInstructions"),
    path.join(home, ".codex", "instructions"),
  );
  assert.strictEqual(
    dir("codexUserInstructions", { CODEX_HOME: path.resolve("/data/codex") }),
    path.join(path.resolve("/data/codex"), "instructions"),
    "CODEX_HOME is respected",
  );
  assert.strictEqual(
    harness.getCodexGuidanceFiles("codexInstructions", ws, {}, home)
      .agentsPath,
    path.join(ws, "AGENTS.md"),
  );
  assert.strictEqual(
    harness.getCodexGuidanceFiles("codexUserInstructions", ws, {}, home)
      .overridePath,
    path.join(home, ".codex", "AGENTS.override.md"),
  );
  assert.strictEqual(harness.isHarnessInstallScope("workspace"), false);
  assert.strictEqual(harness.isHarnessInstallScope("claudeRules"), true);
  assert.strictEqual(harness.isPersonalHarnessScope("claudeRules"), false);
  assert.strictEqual(harness.isPersonalHarnessScope("codexUserInstructions"), true);
});

// ---------------------------------------------------------------------------
// Codex: the managed block
// ---------------------------------------------------------------------------

const { CODEX_INSTRUCTIONS_MARKERS: MARKERS } = harness;

test("the managed block is created, appended and left alone when current", () => {
  const created = harness.planCodexInstructionsLink(undefined, {
    overrideExists: false,
  });
  assert.strictEqual(created.action, "create");
  assert.ok(created.nextText.includes(MARKERS.start));
  assert.ok(created.nextText.includes("[instructions/](./instructions/)"));
  assert.ok(!/\.instructions\.md/.test(created.nextText), "no per-file list");

  const handWritten = "# Team rules\n\nRun the linter.\n";
  const appended = harness.planCodexInstructionsLink(handWritten, {
    overrideExists: false,
  });
  assert.strictEqual(appended.action, "append");
  assert.ok(appended.nextText.startsWith("# Team rules\n\nRun the linter.\n\n"));

  const again = harness.planCodexInstructionsLink(appended.nextText, {
    overrideExists: false,
  });
  assert.strictEqual(again.action, "unchanged");
  assert.strictEqual(again.nextText, appended.nextText);
  assert.strictEqual(
    appended.nextText.split(MARKERS.start).length - 1,
    1,
    "applying twice never duplicates the block",
  );
});

test("text outside the markers is preserved byte for byte, including CRLF", () => {
  const before = `# Top\r\n\r\nkeep me\r\n\r\n${MARKERS.start}\r\nold text\r\n${MARKERS.end}\r\n\r\n## After\r\nkeep me too\r\n`;
  const plan = harness.planCodexInstructionsLink(before, {
    overrideExists: false,
  });
  assert.strictEqual(plan.action, "update");
  assert.ok(plan.nextText.startsWith("# Top\r\n\r\nkeep me\r\n\r\n"));
  assert.ok(plan.nextText.endsWith("\r\n\r\n## After\r\nkeep me too\r\n"));
  assert.ok(!plan.nextText.includes("old text"));
  assert.ok(!/[^\r]\n/.test(plan.nextText), "the file keeps one line ending style");
});

test("an override file or damaged markers stop the change without a write", () => {
  const blocked = harness.planCodexInstructionsLink("# Rules\n", {
    overrideExists: true,
  });
  assert.strictEqual(blocked.action, "blocked");
  assert.strictEqual(blocked.blockedReason, "override-file");
  assert.strictEqual(blocked.nextText, "# Rules\n");

  for (const damaged of [
    `${MARKERS.start}\nno end\n`,
    `${MARKERS.end}\n${MARKERS.start}\n`,
    `${MARKERS.start}\na\n${MARKERS.end}\n${MARKERS.start}\nb\n${MARKERS.end}\n`,
  ]) {
    const plan = harness.planCodexInstructionsLink(damaged, {
      overrideExists: false,
    });
    assert.strictEqual(plan.action, "blocked", damaged);
    assert.strictEqual(plan.blockedReason, "malformed-markers");
    assert.strictEqual(plan.nextText, damaged);
    assert.strictEqual(harness.removeCodexInstructionsLink(damaged).changed, false);
  }
});

test("removal takes out only the managed block", () => {
  const handWritten = "# Team rules\n\nRun the linter.\n";
  const withBlock = harness.planCodexInstructionsLink(handWritten, {
    overrideExists: false,
  }).nextText;
  const removed = harness.removeCodexInstructionsLink(withBlock);
  assert.strictEqual(removed.changed, true);
  assert.strictEqual(removed.nextText, handWritten);
  assert.strictEqual(removed.empty, false);

  const onlyBlock = harness.planCodexInstructionsLink(undefined, {
    overrideExists: false,
  }).nextText;
  const emptied = harness.removeCodexInstructionsLink(onlyBlock);
  assert.strictEqual(emptied.empty, true, "a file that held only the block");

  const sandwiched = `# A\n\n${harness.renderCodexInstructionsBlock()}\n\n# B\n`;
  assert.strictEqual(
    harness.removeCodexInstructionsLink(sandwiched).nextText,
    "# A\n\n# B\n",
  );
  assert.strictEqual(
    harness.removeCodexInstructionsLink("# nothing managed\n").changed,
    false,
  );
});

// ---------------------------------------------------------------------------
// Codex: real files
// ---------------------------------------------------------------------------

function createNodeFileSystem(options = {}) {
  const calls = { writes: [], removed: [] };
  return {
    calls,
    async readText(fsPath) {
      try {
        return await fsp.readFile(fsPath, "utf8");
      } catch (error) {
        if (error.code === "ENOENT") return undefined;
        throw error;
      }
    },
    async writeTextAtomic(fsPath, text) {
      if (options.failWrite) {
        throw new Error("simulated failure before the swap");
      }
      const staged = `${fsPath}.${process.pid}.tmp`;
      await fsp.writeFile(staged, text, "utf8");
      await fsp.rename(staged, fsPath);
      calls.writes.push(fsPath);
    },
    async exists(fsPath) {
      return fs.existsSync(fsPath);
    },
    async listFileNames(directory) {
      try {
        return (await fsp.readdir(directory, { withFileTypes: true }))
          .filter((entry) => entry.isFile())
          .map((entry) => entry.name);
      } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
      }
    },
    async remove(fsPath) {
      calls.removed.push(fsPath);
      await fsp.rm(fsPath, { force: true });
    },
    async isDirty(fsPath) {
      return options.dirty === fsPath;
    },
  };
}

async function withWorkspace(fn) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "rn-harness-"));
  try {
    await fn(root);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

test("install, reinstall and removal keep AGENTS.md consistent on real files", async () => {
  await withWorkspace(async (root) => {
    const files = harness.getCodexGuidanceFiles("codexInstructions", root, {}, root);
    const fileSystem = createNodeFileSystem();
    await fsp.writeFile(files.agentsPath, "# Mine\n\nhand written\n");

    const first = await harness.applyCodexInstructionsLink(fileSystem, files);
    assert.strictEqual(first.action, "append");
    const afterFirst = await fsp.readFile(files.agentsPath, "utf8");
    assert.ok(afterFirst.startsWith("# Mine\n\nhand written\n"));

    // A reinstall finds the block in place and writes nothing.
    const writesBefore = fileSystem.calls.writes.length;
    const second = await harness.applyCodexInstructionsLink(fileSystem, files);
    assert.strictEqual(second.action, "unchanged");
    assert.strictEqual(fileSystem.calls.writes.length, writesBefore);

    // Two instructions in the folder: removing one keeps the block.
    await fsp.mkdir(files.instructionsDirectory, { recursive: true });
    const a = path.join(files.instructionsDirectory, "a.instructions.md");
    const b = path.join(files.instructionsDirectory, "b.instructions.md");
    await fsp.writeFile(a, "a");
    await fsp.writeFile(b, "b");
    await fsp.writeFile(`${a}.resource-ninja.json`, "{}");
    await fsp.rm(a);
    assert.strictEqual(
      await harness.reconcileCodexInstructionsLinkAfterRemoval(fileSystem, a),
      "kept-in-use",
    );
    assert.ok((await fsp.readFile(files.agentsPath, "utf8")).includes(MARKERS.start));

    // Removing the last one takes out only the block; the hand-written text stays.
    await fsp.rm(b);
    assert.strictEqual(
      await harness.reconcileCodexInstructionsLinkAfterRemoval(fileSystem, b),
      "removed",
    );
    assert.strictEqual(
      await fsp.readFile(files.agentsPath, "utf8"),
      "# Mine\n\nhand written\n",
    );
  });
});

test("an AGENTS.md that held only the block is removed with it", async () => {
  await withWorkspace(async (root) => {
    const files = harness.getCodexGuidanceFiles("codexInstructions", root, {}, root);
    const fileSystem = createNodeFileSystem();
    await harness.applyCodexInstructionsLink(fileSystem, files);
    await fsp.mkdir(files.instructionsDirectory, { recursive: true });
    const only = path.join(files.instructionsDirectory, "only.instructions.md");
    assert.strictEqual(
      await harness.reconcileCodexInstructionsLinkAfterRemoval(fileSystem, only),
      "removed-file",
    );
    assert.strictEqual(fs.existsSync(files.agentsPath), false);
  });
});

test("a hand-written link is never removed because the markers prove ownership", async () => {
  await withWorkspace(async (root) => {
    const files = harness.getCodexGuidanceFiles("codexInstructions", root, {}, root);
    const fileSystem = createNodeFileSystem();
    const text = "# Mine\n\nSee [instructions/](./instructions/).\n";
    await fsp.writeFile(files.agentsPath, text);
    const gone = path.join(files.instructionsDirectory, "x.instructions.md");
    assert.strictEqual(
      await harness.reconcileCodexInstructionsLinkAfterRemoval(fileSystem, gone),
      "not-managed",
    );
    assert.strictEqual(await fsp.readFile(files.agentsPath, "utf8"), text);
    // A folder that is not named `instructions` is not ours either.
    assert.strictEqual(
      await harness.reconcileCodexInstructionsLinkAfterRemoval(
        fileSystem,
        path.join(root, "docs", "x.md"),
      ),
      "not-managed",
    );
  });
});

test("a failed write keeps the original, and a dirty or changed file stops the update", async () => {
  await withWorkspace(async (root) => {
    const files = harness.getCodexGuidanceFiles("codexInstructions", root, {}, root);
    const original = "# Mine\n\nprecious\n";
    await fsp.writeFile(files.agentsPath, original);

    await assert.rejects(
      harness.applyCodexInstructionsLink(
        createNodeFileSystem({ failWrite: true }),
        files,
      ),
      /simulated failure/,
    );
    assert.strictEqual(await fsp.readFile(files.agentsPath, "utf8"), original);

    await assert.rejects(
      harness.applyCodexInstructionsLink(
        createNodeFileSystem({ dirty: files.agentsPath }),
        files,
      ),
      (error) => error.name === "HarnessLinkConflictError" && error.reason === "dirty-document",
    );
    assert.strictEqual(await fsp.readFile(files.agentsPath, "utf8"), original);

    const racing = createNodeFileSystem();
    const realRead = racing.readText;
    let reads = 0;
    racing.readText = async (fsPath) => {
      reads += 1;
      const text = await realRead(fsPath);
      // Someone else edits the file after the plan read it and before the swap re-reads it.
      if (reads === 1) {
        await fsp.writeFile(fsPath, `${text}edited elsewhere\n`);
      }
      return text;
    };
    await assert.rejects(
      harness.applyCodexInstructionsLink(racing, files),
      (error) => error.reason === "changed-during-update",
    );
    assert.strictEqual(
      await fsp.readFile(files.agentsPath, "utf8"),
      `${original}edited elsewhere\n`,
      "the other edit is not overwritten",
    );
  });
});

test("an override file leaves AGENTS.md untouched on disk", async () => {
  await withWorkspace(async (root) => {
    const files = harness.getCodexGuidanceFiles("codexInstructions", root, {}, root);
    await fsp.writeFile(files.agentsPath, "# Mine\n");
    await fsp.writeFile(files.overridePath, "# Override\n");
    const fileSystem = createNodeFileSystem();
    const plan = await harness.applyCodexInstructionsLink(fileSystem, files);
    assert.strictEqual(plan.action, "blocked");
    assert.strictEqual(fileSystem.calls.writes.length, 0);
    assert.strictEqual(await fsp.readFile(files.agentsPath, "utf8"), "# Mine\n");
    assert.strictEqual(await fsp.readFile(files.overridePath, "utf8"), "# Override\n");
  });
});

// ---------------------------------------------------------------------------
// Claude Code: applyTo -> paths
// ---------------------------------------------------------------------------

function convert(text, options) {
  return harness.convertInstructionForClaudeRule(text, options);
}

test("applyTo becomes paths only when the meaning is the same", () => {
  const { convertApplyToForClaude } = harness;
  assert.deepStrictEqual(convertApplyToForClaude("**/*.ts, **/*.tsx"), {
    status: "scoped",
    paths: ["**/*.ts", "**/*.tsx"],
  });
  assert.deepStrictEqual(convertApplyToForClaude("src/**/*.{ts,tsx}"), {
    status: "scoped",
    paths: ["src/**/*.{ts,tsx}"],
  });
  assert.deepStrictEqual(
    convertApplyToForClaude("*.py"),
    { status: "scoped", paths: ["/*.py"] },
    "VS Code `*.py` is the root only; Claude `*.py` would match everywhere",
  );
  assert.deepStrictEqual(convertApplyToForClaude("src/*.py"), {
    status: "scoped",
    paths: ["src/*.py"],
  });
  assert.deepStrictEqual(convertApplyToForClaude("**"), { status: "always" });
  assert.deepStrictEqual(convertApplyToForClaude("**/*"), { status: "always" });
  for (const unsupported of [
    "docs",
    "README.md",
    "!**/*.test.ts",
    "/abs/path/*.ts",
    "../outside/*.ts",
    "src/[ab]/*.ts",
    "src/**/*.(ts|js)",
    "src/**/*.t?",
    "a/{b,{c,d}}/*.ts",
    "{a,b}/{c,d}/{e,f}/*.ts",
    "a,,b",
    "src\\*.ts",
    "has space/*.ts",
    "{unbalanced",
    "",
  ]) {
    assert.strictEqual(
      convertApplyToForClaude(unsupported).status,
      "unsupported",
      unsupported,
    );
  }
});

test("a converted rule keeps the body and records where paths came from", () => {
  const source =
    '---\nname: ts rules\ndescription: Use for TypeScript\napplyTo: "**/*.ts,**/*.tsx"\n---\n# Rules\n\nBe strict.\n';
  const result = convert(source);
  assert.strictEqual(result.status, "converted");
  assert.strictEqual(result.mode, "scoped");
  assert.deepStrictEqual(result.paths, ["**/*.ts", "**/*.tsx"]);
  assert.ok(result.content.endsWith("---\n# Rules\n\nBe strict.\n"));
  assert.ok(!/^applyTo:/m.test(result.content));
  assert.match(result.content, /name: ts rules/);
  assert.match(result.content, /paths:\n  - "\*\*\/\*\.ts"\n  - "\*\*\/\*\.tsx"\n---/);
  assert.match(result.content, /# Converted from applyTo: \*\*\/\*\.ts,\*\*\/\*\.tsx/);
});

test("a missing or unclear applyTo is held back, never widened to always-on", () => {
  const cases = {
    "no front matter": ["# Rules\n\nbody\n", "no-applyTo"],
    "no applyTo": ["---\nname: x\n---\nbody\n", "no-applyTo"],
    "description only": ["---\ndescription: Use when testing\n---\nbody\n", "no-applyTo"],
    "list value": ["---\napplyTo:\n  - a/*.ts\n  - b/*.ts\n---\nbody\n", "unsupported-applyTo"],
    "block scalar": ["---\napplyTo: |\n  a/*.ts\n---\nbody\n", "unsupported-applyTo"],
    "flow list": ["---\napplyTo: [a/*.ts]\n---\nbody\n", "unsupported-applyTo"],
    negation: ['---\napplyTo: "!a/*.ts"\n---\nbody\n', "unsupported-applyTo"],
    "duplicate keys": ["---\napplyTo: a/*.ts\napplyTo: b/*.ts\n---\nbody\n", "unsupported-applyTo"],
    "paths and applyTo": ["---\napplyTo: a/*.ts\npaths:\n  - b\n---\nbody\n", "unsupported-applyTo"],
    unterminated: ["---\napplyTo: a/*.ts\nbody without end\n", "invalid-frontmatter"],
  };
  for (const [label, [text, reason]] of Object.entries(cases)) {
    const result = convert(text);
    assert.strictEqual(result.status, "deferred", label);
    assert.strictEqual(result.reason, reason, label);
  }
});

test("always-on is a separate explicit choice", () => {
  const optIn = { alwaysOnWhenDeferred: true };
  const plain = convert("# Rules\n\nbody\n", optIn);
  assert.strictEqual(plain.status, "converted");
  assert.strictEqual(plain.mode, "always");
  assert.strictEqual(plain.content, "# Rules\n\nbody\n");

  const dropped = convert("---\nname: x\napplyTo: !a\n---\nbody\n", optIn);
  assert.strictEqual(dropped.mode, "always");
  assert.ok(!dropped.content.includes("applyTo"));
  assert.ok(dropped.content.includes("name: x"));

  // Still refused when the file cannot be reduced safely.
  const list = convert("---\napplyTo:\n  - a\n---\nbody\n", optIn);
  assert.strictEqual(list.status, "deferred");

  const explicitAll = convert('---\napplyTo: "**"\n---\nbody\n');
  assert.strictEqual(explicitAll.status, "converted");
  assert.strictEqual(explicitAll.mode, "always");
  assert.strictEqual(explicitAll.content, "body\n", "`**` means every file");
});

test("a rule that already uses paths passes through unchanged", () => {
  const native = "---\npaths:\n  - src/**/*.ts\n---\nbody\n";
  const result = convert(native);
  assert.strictEqual(result.status, "converted");
  assert.strictEqual(result.mode, "native");
  assert.strictEqual(result.content, native);
});

test("the byte-order mark and CRLF line endings survive a conversion", () => {
  const source = "\uFEFF---\r\napplyTo: src/*.ts\r\n---\r\nbody\r\n";
  const result = convert(source);
  assert.strictEqual(result.status, "converted");
  assert.ok(result.content.startsWith("\uFEFF---\r\n"));
  assert.ok(!/[^\r]\n/.test(result.content));
  assert.ok(result.content.endsWith("---\r\nbody\r\n"));
});

// ---------------------------------------------------------------------------
// Preview text
// ---------------------------------------------------------------------------

test("the preview states the destination, the AGENTS.md change and the limits", () => {
  const files = harness.getCodexGuidanceFiles(
    "codexInstructions",
    path.resolve("/work/project"),
    {},
    path.resolve("/home/me"),
  );
  const plan = harness.planCodexInstructionsLink(undefined, {
    overrideExists: false,
  });
  const text = harness.formatHarnessInstallPreview({
    scope: "codexInstructions",
    destinationDirectory: files.instructionsDirectory,
    fileNames: ["a.instructions.md"],
    codex: { files, plan },
    isJa: false,
  });
  assert.ok(text.includes(files.instructionsDirectory));
  assert.ok(text.includes(files.agentsPath));
  assert.ok(text.includes(`+ ${MARKERS.start}`));
  assert.match(text, /not loaded automatically/);
  assert.ok(!/personal location/.test(text));

  const personal = harness.formatHarnessInstallPreview({
    scope: "claudeUserRules",
    destinationDirectory: "/home/me/.claude/rules",
    fileNames: ["a.instructions.md"],
    isJa: false,
  });
  assert.match(personal, /every project/);
  assert.match(personal, /CLAUDE\.md is not edited/);

  const blocked = harness.formatHarnessInstallPreview({
    scope: "codexInstructions",
    destinationDirectory: files.instructionsDirectory,
    fileNames: ["a.instructions.md"],
    codex: {
      files,
      plan: harness.planCodexInstructionsLink("# x\n", { overrideExists: true }),
    },
    isJa: false,
  });
  assert.match(blocked, /AGENTS\.override\.md exists/);
});

test("the preview is complete in Japanese for every AGENTS.md outcome", () => {
  const files = harness.getCodexGuidanceFiles(
    "codexUserInstructions",
    path.resolve("/work/project"),
    {},
    path.resolve("/home/me"),
  );
  const current = harness.planCodexInstructionsLink(undefined, {
    overrideExists: false,
  }).nextText;
  const plans = {
    create: harness.planCodexInstructionsLink(undefined, { overrideExists: false }),
    append: harness.planCodexInstructionsLink("# x\n", { overrideExists: false }),
    update: harness.planCodexInstructionsLink(
      `${MARKERS.start}\nold\n${MARKERS.end}\n`,
      { overrideExists: false },
    ),
    unchanged: harness.planCodexInstructionsLink(current, { overrideExists: false }),
    override: harness.planCodexInstructionsLink("# x\n", { overrideExists: true }),
    malformed: harness.planCodexInstructionsLink(`${MARKERS.start}\n`, {
      overrideExists: false,
    }),
  };
  for (const [label, plan] of Object.entries(plans)) {
    const text = harness.formatHarnessInstallPreview({
      scope: "codexUserInstructions",
      destinationDirectory: files.instructionsDirectory,
      fileNames: ["a.instructions.md"],
      codex: { files, plan },
      isJa: true,
    });
    assert.match(text, /保存先:/, label);
    assert.match(text, /注意:/, label);
    assert.match(text, /個人用の保存先/, label);
    assert.ok(!/Destination:|Note:/.test(text), `${label}: no English labels`);
  }
  const written = ["create", "append", "update"].map((label) =>
    harness.formatHarnessInstallPreview({
      scope: "codexInstructions",
      destinationDirectory: files.instructionsDirectory,
      fileNames: ["a.instructions.md"],
      codex: { files, plan: plans[label] },
      isJa: true,
    }),
  );
  for (const text of written) {
    assert.ok(text.includes(`+ ${MARKERS.start}`), "the added block is shown");
    assert.match(text, /管理ブロック外の本文は変更しません/);
  }
});

// ---------------------------------------------------------------------------
// Wiring that the unit tests above cannot see
// ---------------------------------------------------------------------------

const extensionSource = fs.readFileSync(path.join(srcDir, "extension.ts"), "utf8");
const installerSource = fs.readFileSync(path.join(srcDir, "skillInstaller.ts"), "utf8");
const scannerSource = fs.readFileSync(path.join(srcDir, "userResourceScanner.ts"), "utf8");

test("the picker, the default and the create flow honor the legacy profile setting", () => {
  assert.match(extensionSource, /offerUserProfile =[\s\S]{0,160}allowsNewInstall\(userDataState\)/);
  assert.match(extensionSource, /decideDefaultUserDataTarget\(\{/);
  assert.match(extensionSource, /legacyProfileDefaultReselect/);
  assert.match(
    extensionSource,
    /isLegacyUserProfileLocation\(\s*userProfileRoot\.fsPath,[\s\S]{0,200}getConfiguredLegacyUserProfileInstallTarget\(config\)/,
  );
  // Both pickers that take a batch hand over the whole selection so a mixed batch
  // never receives an instruction-only destination.
  assert.match(extensionSource, /pickInstallTarget\(installable\[0\], installable\)/);
  assert.match(
    extensionSource,
    /pickInstallTarget\(\s*pickedItems\[0\]\.skill,\s*pickedItems\.map/,
  );
  assert.match(
    extensionSource,
    /selection\.every\(\(entry\) => getResourceKind\(entry\) === "instruction"\)/,
  );
});

test("a reinstall refuses before it removes anything when the destination moves", () => {
  const start = extensionSource.indexOf("const reinstallUserResource = async (");
  const body = extensionSource.slice(start, start + 9000);
  const guard = body.indexOf("isReinstallDestinationInOriginalRoot(");
  const removal = body.indexOf("deleteInstalledResourceByPath(");
  assert.ok(guard !== -1 && removal !== -1, "guard and removal both exist");
  assert.ok(guard < removal, "the guard runs before the removal is defined");
  assert.match(body.slice(guard - 600, guard + 900), /createUnstartedReinstallRecord\(/);
});

test("harness installs settle conversion and the link before the file is written", () => {
  const prepare = installerSource.indexOf("prepareHarnessInstructionContent(\n              skill,");
  const write = installerSource.indexOf("await vscode.workspace.fs.writeFile(skillPath, content);");
  assert.ok(prepare !== -1 && write !== -1);
  assert.ok(prepare < write, "conversion and the AGENTS.md link come first");
  assert.match(installerSource, /harnessPrepared\?\.transformed \? undefined : baselineRevision/);
  assert.match(installerSource, /reconcileCodexInstructionsLinkAfterRemoval\(\s*createVsCodeHarnessFileSystem\(\)/);
  // Harness scopes accept instructions only.
  assert.match(installerSource, /accept instructions only/);
});

test("the scanner marks every root with an install state", () => {
  assert.match(scannerSource, /installAvailability: classifyInstallDestination\(\{\s*legacyUserProfile: isLegacyUserProfileLocation\(/);
  assert.match(scannerSource, /installAvailability: "read-only" as const/);
  assert.match(scannerSource, /installAvailability: isReadOnly \? "read-only" : root\.installAvailability/);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${name}`);
      console.error(error);
    }
  }
  if (failed > 0) {
    process.exitCode = 1;
  }
})();
