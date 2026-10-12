const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const ts = require("typescript");

function requireTypeScriptModule(filePath, stubs = {}, transformers) {
  const loadedModule = new Module(filePath, module);
  loadedModule.filename = filePath;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(filePath));
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    return Object.hasOwn(stubs, request)
      ? stubs[request]
      : originalLoad(request, parent, isMain);
  };
  try {
    loadedModule._compile(
      ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
        fileName: filePath,
        transformers,
      }).outputText,
      filePath,
    );
  } finally {
    Module._load = originalLoad;
  }
  return loadedModule.exports;
}

const manager = requireTypeScriptModule(
  path.join(__dirname, "..", "src", "gitignoreManager.ts"),
  {
    "./logger": { logger: { warn() {} } },
  },
);
const temporary = fs.mkdtempSync(
  path.join(os.tmpdir(), "resource-ninja-ignore-"),
);
const uri = (fsPath) => ({ fsPath, scheme: "file" });
let enabled = true;
const workspace = {
  isTrusted: true,
  textDocuments: [],
  getWorkspaceFolder: () => ({ uri: uri(temporary) }),
  getConfiguration(section) {
    assert.strictEqual(section, "resourceNinja");
    return { get: () => enabled };
  },
};
async function verifyInventoryOrdering(implementation, root, next) {
  let current = [root];
  let releaseSave;
  let notifySave;
  let saveCount = 0;
  const ready = new Promise((resolve) => {
    notifySave = resolve;
  });
  const seen = [];
  const events = [];
  const inventory = implementation.createGitignoreInventory({
    initialRoots: [],
    currentRoots: () => current,
    reconcile: async (roots, previous) => {
      events.push("reconcile");
      seen.push(...previous);
      return roots;
    },
    save: async () => {
      const ordinal = saveCount++;
      events.push(`save-${ordinal}-start`);
      if (ordinal === 0) {
        const blocked = new Promise((resolve) => {
          releaseSave = resolve;
        });
        notifySave();
        await blocked;
      }
      events.push(`save-${ordinal}-end`);
    },
    onFailure: () => {
      events.push("unexpected-failure");
    },
  });
  const first = inventory.remember(root);
  await ready;
  const intermediate = uri(path.join(temporary, "intermediate"));
  current = [next];
  const pending = inventory.synchronize();
  const remember = inventory.remember(intermediate);
  try {
    await Promise.resolve();
    assert.deepStrictEqual(
      events,
      ["save-0-start"],
      "inventory must serialize operations behind pending saves",
    );
    assert.strictEqual(
      seen.length,
      0,
      "reconcile must not start before the pending save finishes",
    );
    releaseSave();
    await Promise.all([first, pending, remember]);
    assert.deepStrictEqual(
      events,
      [
        "save-0-start",
        "save-0-end",
        "reconcile",
        "save-1-start",
        "save-1-end",
        "reconcile",
        "save-2-start",
        "save-2-end",
      ],
      "inventory operation order must be deterministic",
    );
    assert(seen.includes(intermediate));
  } finally {
    releaseSave();
    await Promise.allSettled([first, pending, remember]);
  }
}
async function main() {
  try {
    const sibling =
      "# Agent Skills Ninja START\r\n/sibling/\r\n# Agent Skills Ninja END\r\n";
    const original = "\uFEFFuser-rule\r\n" + sibling;
    const updated = manager.updateIgnoreBlock(original, ["/remote/"]);
    assert(updated.startsWith(original));
    assert.strictEqual(
      manager.updateIgnoreBlock(updated, []),
      original + "\r\n",
    );
    assert.strictEqual(
      manager.updateIgnoreBlock(updated, ["/remote/"]),
      updated,
    );
    for (const owner of ["Agent Skills Ninja", "Agent Resources Ninja"]) {
      for (const bad of [
        `# ${owner} START\n`,
        `# ${owner} END\n`,
        `# ${owner} START\n# ${owner} END\n# ${owner} START\n# ${owner} END\n`,
        `# ${owner} START\n# ${owner === "Agent Skills Ninja" ? "Agent Resources Ninja" : "Agent Skills Ninja"} START\n`,
      ]) {
        assert.throws(() => manager.updateIgnoreBlock(bad, []));
      }
    }
    assert.throws(() => manager.escapeIgnorePath("../unsafe"));
    const patterns = manager.buildSkillIgnorePatterns([
      { relativePath: "remote", external: true, metadata: true },
      {
        relativePath: "remote/.hidden/local",
        external: false,
        metadata: false,
      },
      { relativePath: "local", external: false, metadata: true },
    ]);
    assert(!patterns.includes("/remote/"));
    assert(patterns.includes("/remote/.skill-meta.json"));
    const root = uri(path.join(temporary, "skills"));
    fs.mkdirSync(path.join(root.fsPath, "remote"), { recursive: true });
    fs.writeFileSync(path.join(root.fsPath, "remote", "SKILL.md"), "remote");
    fs.writeFileSync(
      path.join(root.fsPath, "remote", ".skill-meta.json"),
      JSON.stringify({
        name: "remote",
        source: "test",
        remotePath: "skills/remote",
      }),
    );
    const ignore = path.join(root.fsPath, ".gitignore");
    fs.writeFileSync(ignore, original);
    assert.strictEqual(
      (await manager.synchronizeSkillGitignore(root, workspace)).status,
      "updated",
    );
    const managed = fs.readFileSync(ignore);
    assert(managed.toString().includes("/remote/"));
    workspace.textDocuments = [{ isDirty: true, uri: uri(ignore) }];
    enabled = false;
    assert.strictEqual(
      (await manager.synchronizeSkillGitignore(root, workspace)).reason,
      "dirty",
    );
    assert(managed.equals(fs.readFileSync(ignore)));
    workspace.textDocuments = [];
    const nativeFs = require("fs/promises");
    const rename = nativeFs.rename;
    nativeFs.rename = async () => {
      throw Object.assign(new Error("injected"), { code: "EPERM" });
    };
    try {
      assert.strictEqual(
        (await manager.synchronizeSkillGitignore(root, workspace)).reason,
        "io-failure",
      );
      assert(managed.equals(fs.readFileSync(ignore)));
    } finally {
      nativeFs.rename = rename;
    }
    assert(
      !fs
        .readdirSync(root.fsPath)
        .some((name) => name.endsWith(".tmp") || name.endsWith(".lock")),
    );
    assert.strictEqual(
      (await manager.synchronizeSkillGitignore(root, workspace)).status,
      "updated",
    );
    assert(fs.readFileSync(ignore, "utf8").includes(sibling));
    assert(
      !fs
        .readFileSync(ignore, "utf8")
        .includes("# Agent Resources Ninja START"),
    );
    enabled = true;
    await manager.synchronizeSkillGitignore(root, workspace);
    const next = uri(path.join(temporary, "next"));
    fs.mkdirSync(next.fsPath);
    await manager.reconcileSkillGitignores([next], [root], workspace);
    assert(
      !fs
        .readFileSync(ignore, "utf8")
        .includes("# Agent Resources Ninja START"),
    );
    const baseline = fs.readFileSync(ignore);
    const open = nativeFs.open;
    nativeFs.open = async (...args) => {
      const handle = await open(...args);
      if (!String(args[0]).endsWith(".tmp")) {
        return handle;
      }
      return {
        writeFile: async () => {
          await handle.writeFile("partial");
          throw new Error("Injected partial write");
        },
        sync: () => handle.sync(),
        close: () => handle.close(),
      };
    };
    try {
      assert.strictEqual(
        (await manager.synchronizeSkillGitignore(root, workspace)).status,
        "failed",
      );
      assert(baseline.equals(fs.readFileSync(ignore)));
    } finally {
      nativeFs.open = open;
    }
    assert(
      !fs
        .readdirSync(root.fsPath)
        .some((name) => name.endsWith(".tmp") || name.endsWith(".lock")),
    );
    const lockPath = path.join(root.fsPath, manager.GITIGNORE_LOCK_NAME);
    fs.writeFileSync(lockPath, "other-owner");
    assert.strictEqual(
      (await manager.synchronizeSkillGitignore(root, workspace)).reason,
      "busy",
    );
    assert.strictEqual(fs.readFileSync(lockPath, "utf8"), "other-owner");
    assert(baseline.equals(fs.readFileSync(ignore)));
    fs.unlinkSync(lockPath);
    const hiddenLocal = path.join(root.fsPath, "remote", ".hidden", "local");
    fs.mkdirSync(hiddenLocal, { recursive: true });
    fs.writeFileSync(path.join(hiddenLocal, "SKILL.md"), "local");
    await manager.synchronizeSkillGitignore(root, workspace);
    assert(!fs.readFileSync(ignore, "utf8").includes("\r\n/remote/\r\n"));
    assert(
      fs.readFileSync(ignore, "utf8").includes("/remote/.skill-meta.json"),
    );
    fs.rmSync(path.join(root.fsPath, "remote", ".hidden"), { recursive: true });
    const linkTarget = path.join(temporary, "link-target");
    fs.mkdirSync(linkTarget);
    fs.symlinkSync(
      linkTarget,
      path.join(root.fsPath, "remote", "link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await manager.synchronizeSkillGitignore(root, workspace);
    assert(!fs.readFileSync(ignore, "utf8").includes("\r\n/remote/\r\n"));
    fs.rmSync(path.join(root.fsPath, "remote", "link"));
    fs.writeFileSync(ignore, Buffer.from([0xff]));
    assert.strictEqual(
      (await manager.synchronizeSkillGitignore(root, workspace)).status,
      "failed",
    );
    assert.deepStrictEqual(fs.readFileSync(ignore), Buffer.from([0xff]));
    fs.writeFileSync(ignore, baseline);
    const metadataPath = path.join(root.fsPath, "remote", ".skill-meta.json");
    const metadata = fs.readFileSync(metadataPath);
    fs.writeFileSync(metadataPath, "{");
    assert.strictEqual(
      (await manager.synchronizeSkillGitignore(root, workspace)).reason,
      "invalid-metadata",
    );
    assert(baseline.equals(fs.readFileSync(ignore)));
    fs.writeFileSync(metadataPath, metadata);
    workspace.isTrusted = false;
    assert.strictEqual(
      (await manager.synchronizeSkillGitignore(root, workspace)).reason,
      "out-of-scope",
    );
    workspace.isTrusted = true;
    await verifyInventoryOrdering(manager, root, next);
    let mutations = 0;
    const concurrentManager = requireTypeScriptModule(
      path.join(__dirname, "..", "src", "gitignoreManager.ts"),
      { "./logger": { logger: { warn() {} } } },
      {
        before: [
          (context) => (sourceFile) => {
            const visit = (node) => {
              if (
                ts.isCallExpression(node) &&
                ts.isPropertyAccessExpression(node.expression) &&
                ts.isIdentifier(node.expression.expression) &&
                node.expression.expression.text === "queue" &&
                node.expression.name.text === "then" &&
                node.arguments.length === 1 &&
                ts.isIdentifier(node.arguments[0]) &&
                node.arguments[0].text === "operation"
              ) {
                mutations++;
                return context.factory.createCallExpression(
                  node.arguments[0],
                  undefined,
                  [],
                );
              }
              return ts.visitEachChild(node, visit, context);
            };
            return ts.visitNode(sourceFile, visit);
          },
        ],
      },
    );
    assert.strictEqual(
      mutations,
      1,
      "mutation must change the production enqueue call",
    );
    await assert.rejects(
      () => verifyInventoryOrdering(concurrentManager, root, next),
      /inventory must serialize/,
    );
    console.log(
      "PASS gitignore manager: ownership, dirty/rename protection, cleanup, inventory ordering and mutation probe",
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
