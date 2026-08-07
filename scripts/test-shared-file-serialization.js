#!/usr/bin/env node

// Commands, config listeners, the chat participant, and the language-model
// tools all rewrite the same shared files. Without serialization the later
// read-modify-write pass silently drops what the earlier one just added.

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
  const loadedModule = new Module(filePath, module);
  loadedModule.filename = filePath;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(filePath));
  loadedModule._compile(transpiled.outputText, filePath);
  return loadedModule.exports;
}

const { createSerialQueue } = requireTypeScriptModule(
  path.join(repoRoot, "src", "serialQueue.ts"),
);

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

// Models a read-modify-write pass over one shared file.
function createSharedFile() {
  let contents = [];
  return {
    read: async () => {
      await new Promise((resolve) => setImmediate(resolve));
      return [...contents];
    },
    write: async (next) => {
      await new Promise((resolve) => setImmediate(resolve));
      contents = next;
    },
    get value() {
      return contents;
    },
  };
}

async function run() {
  await test("interleaved writers lose an entry without the queue", async () => {
    const file = createSharedFile();
    const append = async (entry) => {
      const current = await file.read();
      await file.write([...current, entry]);
    };

    await Promise.all([append("a"), append("b")]);
    assert.strictEqual(
      file.value.length,
      1,
      "the harness must reproduce the lost-update race the queue prevents",
    );
  });

  await test("the queue keeps every entry", async () => {
    const file = createSharedFile();
    const runExclusive = createSerialQueue();
    const append = (entry) =>
      runExclusive(async () => {
        const current = await file.read();
        await file.write([...current, entry]);
      });

    await Promise.all([append("a"), append("b"), append("c")]);
    assert.deepStrictEqual(file.value, ["a", "b", "c"]);
  });

  await test("a rejected task does not stall the queue", async () => {
    const runExclusive = createSerialQueue();
    const order = [];

    const failing = runExclusive(async () => {
      order.push("failing");
      throw new Error("boom");
    });
    const following = runExclusive(async () => {
      order.push("following");
      return "ok";
    });

    await assert.rejects(failing, /boom/);
    assert.strictEqual(await following, "ok");
    assert.deepStrictEqual(order, ["failing", "following"]);
  });

  await test("every shared-file writer routes through the queue", async () => {
    const writers = [
      ["instructionManager.ts", "runInstructionFileUpdate"],
      ["hookConfigManager.ts", "runHookConfigUpdate"],
      ["mcpConfigManager.ts", "runMcpConfigUpdate"],
    ];

    for (const [fileName, queueName] of writers) {
      const source = fs.readFileSync(
        path.join(repoRoot, "src", fileName),
        "utf8",
      );
      assert.match(
        source,
        new RegExp(`const ${queueName} = createSerialQueue\\(\\)`),
        `${fileName} must own a serial queue`,
      );
      assert.match(
        source,
        new RegExp(`return ${queueName}\\(`),
        `${fileName} must route its exported update through ${queueName}`,
      );
    }
  });

  // The first version of this fix left three exported writers outside the queue.
  await test("no exported writer bypasses its queue", async () => {
    const modules = [
      ["instructionManager.ts", "runInstructionFileUpdate"],
      ["hookConfigManager.ts", "runHookConfigUpdate"],
      ["mcpConfigManager.ts", "runMcpConfigUpdate"],
    ];

    for (const [fileName, queueName] of modules) {
      const source = fs.readFileSync(
        path.join(repoRoot, "src", fileName),
        "utf8",
      );
      const lines = source.split(/\r?\n/);
      const bypasses = [];
      let currentFunction = "";
      let currentExported = false;
      let queuedFunction = false;

      // Direct writes are not the only way to touch a shared file, so keep the
      // indirect writers in the same list as `writeFile` and `delete`.
      const writeOperations =
        /vscode\.workspace\.fs\.(writeFile|delete)\(|writeJsonFile\(|createHooksJsonBackup\(|createMcpJsonBackup\(/;

      for (const line of lines) {
        const declaration = line.match(
          /^(export )?(?:async )?function ([A-Za-z0-9_]+)/,
        );
        // `export const foo = async (...) => {` is a function boundary too.
        const arrowDeclaration = line.match(
          /^(export )?const ([A-Za-z0-9_]+)(?::[^=]+)? = (?:async )?\(/,
        );
        if (declaration || arrowDeclaration) {
          const matched = declaration || arrowDeclaration;
          currentExported = Boolean(matched[1]);
          currentFunction = matched[2];
          queuedFunction = false;
        }
        if (line.includes(`${queueName}(`)) {
          queuedFunction = true;
        }
        // Private helpers are only reachable through a queued entry point, so
        // the invariant is that every exported writer routes through the queue.
        if (writeOperations.test(line) && currentExported && !queuedFunction) {
          bypasses.push(`${fileName}: ${currentFunction}`);
        }
      }

      assert.deepStrictEqual(
        bypasses,
        [],
        `route every shared-file write through ${queueName}`,
      );
    }
  });

  console.log("RESULT=PASS");
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
