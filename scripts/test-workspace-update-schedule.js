#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

function requireTypeScriptModule(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
    fileName: filePath,
  });
  const loaded = new Module(filePath, module);
  loaded.filename = filePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(filePath));
  loaded._compile(compiled.outputText, filePath);
  return loaded.exports;
}

const { createWorkspaceUpdateSchedule } = requireTypeScriptModule(
  path.join(__dirname, "..", "src", "workspaceUpdateSchedule.ts"),
);

async function main() {
  const interval = 14 * 24 * 60 * 60 * 1000;
  let now = interval;
  let last = 1;
  let calls = 0;
  let complete = true;
  const schedule = createWorkspaceUpdateSchedule({
    getLastSuccess: () => last,
    saveLastSuccess: async (time) => {
      last = time;
    },
    check: async () => ({ complete, value: ++calls }),
    now: () => now,
  });

  assert.deepStrictEqual(await schedule.run(), { status: "not-due" });
  now++;
  assert.deepStrictEqual(await schedule.run(), {
    status: "checked",
    complete: true,
    value: 1,
  });
  assert.strictEqual(last, now);
  assert.deepStrictEqual(await schedule.run(true), {
    status: "checked",
    complete: true,
    value: 2,
  });

  now += interval;
  complete = false;
  await schedule.run();
  assert.strictEqual(last, now - interval);
  await schedule.run();
  assert.strictEqual(calls, 4);

  let resolveCheck;
  let concurrentCalls = 0;
  let saved = 0;
  const concurrent = createWorkspaceUpdateSchedule({
    getLastSuccess: () => undefined,
    saveLastSuccess: async () => {
      saved++;
    },
    check: () => {
      concurrentCalls++;
      return new Promise((resolve) => {
        resolveCheck = resolve;
      });
    },
    now: () => now,
  });
  const auto = concurrent.run();
  const manual = concurrent.run(true);
  resolveCheck({ complete: true, value: "ok" });
  assert.deepStrictEqual(await auto, await manual);
  assert.strictEqual(concurrentCalls, 1);
  assert.strictEqual(saved, 1);

  let attempts = 0;
  const failing = createWorkspaceUpdateSchedule({
    getLastSuccess: () => undefined,
    saveLastSuccess: async () => {
      throw new Error("failed check must not be recorded");
    },
    check: async () => {
      attempts++;
      throw new Error("network failure");
    },
    now: () => now,
  });
  await assert.rejects(failing.run(), /network failure/);
  await assert.rejects(failing.run(), /network failure/);
  assert.strictEqual(attempts, 2);

  let invalidCalls = 0;
  const invalidTimestamp = createWorkspaceUpdateSchedule({
    getLastSuccess: () => now + interval,
    saveLastSuccess: async () => {},
    check: async () => ({ complete: true, value: ++invalidCalls }),
    now: () => now,
  });
  assert.strictEqual((await invalidTimestamp.run()).status, "checked");
  assert.strictEqual(invalidCalls, 1);

  console.log("PASS workspace update scheduling");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
