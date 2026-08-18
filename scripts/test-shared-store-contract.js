// Pins the parts of the shared store that are a contract with the skill-only sibling
// extension rather than a local choice. Both extensions read and write the same
// `index.lock` in the same directory, so a change here is only correct if the other
// side changes too.
//
// Source of truth: aktsmm/vscode-agent-skill-ninja v0.9.45 `src/shared-store-lock.ts`
// and `src/shared-manifest.ts`. If this test fails, decide which side is right
// before relaxing it.

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const os = require("os");
const path = require("path");
const ts = require("typescript");

function requireTypeScriptModule(filePath, stubs = {}) {
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

const repoRoot = path.resolve(__dirname, "..");
const srcDir = path.join(repoRoot, "src");

const sharedManifest = requireTypeScriptModule(
  path.join(srcDir, "sharedManifest.ts"),
  {
    vscode: {
      Uri: {
        file: (fsPath) => ({ fsPath }),
        joinPath: (base, ...segments) => ({
          fsPath: path.join(base.fsPath, ...segments),
        }),
      },
    },
    "./skillIndex": {},
  },
);

const tempDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "resource-ninja-contract-"),
);

const lock = requireTypeScriptModule(path.join(srcDir, "sharedStoreLock.ts"), {
  "./sharedManifest": {
    ...sharedManifest,
    getAgentNinjaSharedDirectoryPath: () => tempDir,
  },
  "./logger": { logger: { warn: () => {} } },
});

const sourcesStore = requireTypeScriptModule(
  path.join(srcDir, "sharedSourcesManifestStore.ts"),
  {
    "./coexistence": { SELF_EXTENSION_ID: "contract.test" },
    "./gitHubRefSafety": requireTypeScriptModule(
      path.join(srcDir, "gitHubRefSafety.ts"),
    ),
    "./sharedManifest": sharedManifest,
    "./logger": { logger: { warn: () => {} } },
    "./sharedStoreLock": lock,
  },
);

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

test("the lock file name is the one both extensions open", () => {
  assert.strictEqual(sharedManifest.SHARED_STORE_LOCK_FILE, "index.lock");
});

test("the stale windows match the sibling extension", () => {
  assert.strictEqual(sharedManifest.SHARED_STORE_LOCK_STALE_MS, 60 * 1000);
  assert.strictEqual(
    sharedManifest.SHARED_STORE_LOCK_HARD_STALE_MS,
    10 * 60 * 1000,
  );
  assert.strictEqual(sharedManifest.SHARED_STORE_LOCK_HEARTBEAT_MS, 15 * 1000);
  assert.ok(
    sharedManifest.SHARED_STORE_LOCK_HEARTBEAT_MS <
      sharedManifest.SHARED_STORE_LOCK_STALE_MS,
    "a heartbeat slower than the stale window cannot keep a lock alive",
  );
});

test("the reclaim file keeps the name the sibling cleans up", () => {
  assert.strictEqual(lock.SHARED_STORE_LOCK_RECLAIM_SUFFIX, ".reclaim-");
});

test("the sources manifest caps match the sibling extension", () => {
  // A cap stricter than the other writer's rejects a file we are not allowed to
  // repair, which stops sharing for good.
  assert.strictEqual(
    sharedManifest.SHARED_SOURCES_MANIFEST_MAX_BYTES,
    2 * 1024 * 1024,
  );
  assert.strictEqual(sourcesStore.MAX_SHARED_SOURCE_ENTRIES, 500);
});

test("a scanner name either extension may write is accepted by both", () => {
  assert.strictEqual(
    sourcesStore.FOREIGN_SCANNER_PATTERN.source,
    /^[A-Za-z0-9._-]{1,64}$/.source,
  );
  assert.ok(sourcesStore.FOREIGN_SCANNER_PATTERN.test("claude-commands"));
  assert.ok(!sourcesStore.FOREIGN_SCANNER_PATTERN.test("../../etc/passwd"));
});

test("the lock payload has exactly the four fields the sibling reads", async () => {
  let observed;
  await lock.withSharedStoreLock("contract.test", async () => {
    observed = JSON.parse(
      fs.readFileSync(path.join(tempDir, "index.lock"), "utf8"),
    );
  });

  assert.deepStrictEqual(
    Object.keys(observed).sort(),
    ["acquiredAt", "extensionId", "generation", "pid"],
    "an extra field such as a separate heartbeat stamp would make the sibling's locks look stale forever",
  );
  assert.strictEqual(typeof observed.generation, "string");
  assert.ok(observed.generation.length > 0);
});

test("a lock written before generations existed is never mistaken for ours", async () => {
  const lockPath = path.join(tempDir, "index.lock");
  fs.writeFileSync(
    lockPath,
    JSON.stringify({
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      extensionId: "legacy.sibling",
    }),
    "utf8",
  );

  // A fresh holder cannot take it, and the legacy file is left untouched.
  await assert.rejects(
    () => lock.withSharedStoreLock("contract.test", async () => undefined),
    /Failed to acquire shared store lock/,
  );
  assert.strictEqual(
    JSON.parse(fs.readFileSync(lockPath, "utf8")).extensionId,
    "legacy.sibling",
  );
  fs.rmSync(lockPath, { force: true });
});

test("the shared directory resolves where both extensions look", () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  const originalAppData = process.env.APPDATA;

  try {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });
    process.env.APPDATA = path.join("C:", "Users", "someone", "AppData");
    assert.strictEqual(
      sharedManifest.getAgentNinjaSharedDirectoryPath(),
      path.join(process.env.APPDATA, "agent-ninja"),
    );

    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
    assert.strictEqual(
      sharedManifest.getAgentNinjaSharedDirectoryPath(),
      path.join(os.homedir(), ".agent-ninja"),
    );
  } finally {
    Object.defineProperty(process, "platform", originalPlatform);
    if (originalAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = originalAppData;
    }
  }
});

test("the contract records where it came from", () => {
  const source = fs.readFileSync(
    path.join(srcDir, "sharedStoreLock.ts"),
    "utf8",
  );
  assert.match(
    source,
    /vscode-agent-skill-ninja v0\.9\.\d+/,
    "a failing contract test must say which implementation to compare against",
  );
});

async function main() {
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      console.error(`FAIL ${name}`);
      throw error;
    }
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
}

main()
  .then(() => {
    console.log("RESULT=PASS");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
