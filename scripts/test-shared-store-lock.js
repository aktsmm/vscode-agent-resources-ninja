// The shared store lock is a cross-process fence, so these cases run against a real
// temporary directory rather than a mocked filesystem. The clock, process liveness
// and generation are injected so an interleaving can be reproduced exactly.

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
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "resource-ninja-lock-"));
const lockPath = path.join(tempDir, "index.lock");

const STALE_MS = 60 * 1000;
const HARD_STALE_MS = 10 * 60 * 1000;

const sharedManifestStub = {
  getAgentNinjaSharedDirectoryPath: () => tempDir,
  SHARED_STORE_LOCK_FILE: "index.lock",
  SHARED_STORE_LOCK_STALE_MS: STALE_MS,
  SHARED_STORE_LOCK_HARD_STALE_MS: HARD_STALE_MS,
  // Long enough that no timer fires inside a test; the release path is what matters.
  SHARED_STORE_LOCK_HEARTBEAT_MS: 60 * 60 * 1000,
  SHARED_STORE_LOCK_RETRY_COUNT: 3,
  SHARED_STORE_RETRY_DELAY_MS: 5,
};

const lock = requireTypeScriptModule(
  path.join(repoRoot, "src", "sharedStoreLock.ts"),
  {
    "./sharedManifest": sharedManifestStub,
    "./logger": { logger: { warn: () => {} } },
  },
);

const OWNER = "yamapan.agent-resources-ninja";
let clock = Date.parse("2026-08-18T00:00:00.000Z");
let generationCounter = 0;

function reset(options = {}) {
  lock.resetSharedStoreLockRuntime();
  clock = Date.parse("2026-08-18T00:00:00.000Z");
  generationCounter = 0;
  for (const entry of fs.readdirSync(tempDir)) {
    fs.rmSync(path.join(tempDir, entry), { force: true, recursive: true });
  }
  lock.configureSharedStoreLockRuntime({
    now: () => clock,
    isProcessAlive: options.isProcessAlive || (() => false),
    createGeneration: () => `gen-${(generationCounter += 1)}`,
  });
}

function writeForeignLock(payload) {
  fs.writeFileSync(lockPath, JSON.stringify(payload, null, 2), "utf8");
}

function readLockFile() {
  return JSON.parse(fs.readFileSync(lockPath, "utf8"));
}

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

test("two holders never run at the same time", async () => {
  reset();
  const events = [];
  const hold = (name, delayMs) =>
    lock.withSharedStoreLock(OWNER, async () => {
      events.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      events.push(`${name}:end`);
    });

  await Promise.all([hold("first", 20), hold("second", 0)]);

  // Which one wins the race is not the contract; not overlapping is.
  assert.strictEqual(events.length, 4);
  for (let index = 0; index < events.length; index += 2) {
    const [startName, startKind] = events[index].split(":");
    const [endName, endKind] = events[index + 1].split(":");
    assert.strictEqual(startKind, "start");
    assert.strictEqual(endKind, "end");
    assert.strictEqual(
      startName,
      endName,
      `${startName} was interrupted by ${endName}`,
    );
  }
});

test("a lost lease is classified so the caller can report it, not crash", async () => {
  reset();
  let raised;
  await lock.withSharedStoreLock(OWNER, async (lease) => {
    writeForeignLock({
      pid: 999,
      acquiredAt: new Date(clock).toISOString(),
      extensionId: "someone.else",
      generation: "taken-over",
    });
    raised = await lease.assertStillOwned().catch((error) => error);
  });

  assert.strictEqual(
    lock.describeSharedStoreLockFailure(raised),
    "lease-lost",
    "the stores turn this into a paused-sync status instead of an exception",
  );
  assert.strictEqual(
    lock.describeSharedStoreLockFailure(
      new Error(lock.SHARED_STORE_LOCK_UNAVAILABLE_MESSAGE),
    ),
    "lock-unavailable",
  );
  assert.strictEqual(
    lock.describeSharedStoreLockFailure(new Error("disk on fire")),
    undefined,
    "a real fault must keep propagating",
  );
});

test("the payload carries exactly the fields the sibling extension reads", async () => {
  reset();
  let observed;
  await lock.withSharedStoreLock(OWNER, async () => {
    observed = readLockFile();
  });

  assert.deepStrictEqual(Object.keys(observed).sort(), [
    "acquiredAt",
    "extensionId",
    "generation",
    "pid",
  ]);
  assert.strictEqual(observed.extensionId, OWNER);
  assert.strictEqual(observed.generation, "gen-1");
});

test("a lock whose owner is gone and whose age is past the window is reclaimed", async () => {
  reset({ isProcessAlive: () => false });
  writeForeignLock({
    pid: 424242,
    acquiredAt: new Date(clock - STALE_MS - 1000).toISOString(),
    extensionId: "someone.else",
    generation: "foreign",
  });

  let entered = false;
  await lock.withSharedStoreLock(OWNER, async (lease) => {
    entered = true;
    assert.strictEqual(readLockFile().generation, lease.generation);
    assert.notStrictEqual(lease.generation, "foreign");
  });

  assert.ok(entered, "the reclaiming process must get the lock");
  assert.strictEqual(fs.existsSync(lockPath), false, "and release it after");
});

test("a live owner keeps its lock through the soft window", async () => {
  reset({ isProcessAlive: () => true });
  writeForeignLock({
    pid: 424242,
    acquiredAt: new Date(clock - STALE_MS - 1000).toISOString(),
    extensionId: "someone.else",
    generation: "foreign",
  });

  await assert.rejects(
    () => lock.withSharedStoreLock(OWNER, async () => undefined),
    /Failed to acquire shared store lock/,
  );
  assert.strictEqual(
    readLockFile().generation,
    "foreign",
    "a paused but living process must not be overtaken",
  );
});

test("a lock past the hard window is reclaimed even from a living pid", async () => {
  reset({ isProcessAlive: () => true });
  writeForeignLock({
    pid: 424242,
    acquiredAt: new Date(clock - HARD_STALE_MS - 1000).toISOString(),
    extensionId: "someone.else",
    generation: "foreign",
  });

  let entered = false;
  await lock.withSharedStoreLock(OWNER, async () => {
    entered = true;
  });
  assert.ok(entered, "a reused pid must not wedge the store forever");
});

test("an owner that lost the lock can neither commit nor delete the new one", async () => {
  reset();
  let assertion;
  await lock.withSharedStoreLock(OWNER, async (lease) => {
    assert.strictEqual(lease.generation, "gen-1");
    await lease.assertStillOwned();

    // Someone else reclaimed and took the lock while we were working.
    writeForeignLock({
      pid: 999,
      acquiredAt: new Date(clock).toISOString(),
      extensionId: "someone.else",
      generation: "taken-over",
    });

    assertion = lease
      .assertStillOwned()
      .then(() => undefined)
      .catch((error) => error);
    const error = await assertion;
    assert.ok(error, "committing after losing the lease must fail");
    assert.strictEqual(error.name, "SharedStoreLeaseLostError");
    assert.throws(() => lease.assertHeld(), /lease was lost/);
  });

  assert.strictEqual(
    readLockFile().generation,
    "taken-over",
    "releasing must not delete a lock we no longer own",
  );
});

test("an unreadable lock is only reclaimed once it is older than the window", async () => {
  reset();
  fs.writeFileSync(lockPath, "{ not json", "utf8");
  // mtime is compared against the injected clock, not the wall clock.
  const recent = new Date(clock);
  fs.utimesSync(lockPath, recent, recent);

  await assert.rejects(
    () => lock.withSharedStoreLock(OWNER, async () => undefined),
    /Failed to acquire shared store lock/,
  );

  const old = new Date(clock - STALE_MS - 60 * 1000);
  fs.utimesSync(lockPath, old, old);
  let entered = false;
  await lock.withSharedStoreLock(OWNER, async () => {
    entered = true;
  });
  assert.ok(
    entered,
    "leftovers from a half-written lock must not be permanent",
  );
});

test("a heartbeat cannot bring a released lock back", async () => {
  reset();
  await lock.withSharedStoreLock(OWNER, async () => undefined);
  assert.strictEqual(fs.existsSync(lockPath), false);

  // Nothing is scheduled once the holder returned, so the file stays gone.
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.strictEqual(fs.existsSync(lockPath), false);
});

test("staging and reclaim leftovers are not left in the shared directory", async () => {
  reset({ isProcessAlive: () => false });
  writeForeignLock({
    pid: 424242,
    acquiredAt: new Date(clock - HARD_STALE_MS - 1000).toISOString(),
    extensionId: "someone.else",
    generation: "foreign",
  });

  await lock.withSharedStoreLock(OWNER, async () => undefined);
  assert.deepStrictEqual(
    fs.readdirSync(tempDir),
    [],
    "no staging, refresh or reclaim file may survive the run",
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
  lock.resetSharedStoreLockRuntime();
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
