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
  const secondAuto = concurrent.run();
  resolveCheck({ complete: true, value: "ok" });
  assert.deepStrictEqual(await auto, await secondAuto);
  assert.strictEqual(concurrentCalls, 1);
  assert.strictEqual(saved, 1);

  let releasePassive;
  const scopes = [];
  let overlapSaved = 0;
  const overlapping = createWorkspaceUpdateSchedule({
    getLastSuccess: () => undefined,
    saveLastSuccess: async () => { overlapSaved++; },
    check: async (includeMissingBaseline, signal) => {
      scopes.push({ includeMissingBaseline, signal });
      if (!includeMissingBaseline) {
        await new Promise((resolve) => { releasePassive = resolve; });
      }
      return { complete: true, value: includeMissingBaseline };
    },
    now: () => now,
  });
  const passive = overlapping.run();
  const controller = new AbortController();
  const manual = overlapping.run(true, true, controller.signal);
  releasePassive();
  assert.strictEqual((await passive).value, false);
  assert.strictEqual((await manual).value, true);
  assert.deepStrictEqual(scopes.map((entry) => entry.includeMissingBaseline), [false, true]);
  assert.strictEqual(scopes[1].signal, controller.signal);
  assert.strictEqual(overlapSaved, 2);

  let releasePendingCheck;
  let queuedManualCalls = 0;
  let queuedManualSaved = 0;
  const queuedManualSchedule = createWorkspaceUpdateSchedule({
    getLastSuccess: () => undefined,
    saveLastSuccess: async () => { queuedManualSaved++; },
    check: async (includeMissingBaseline) => {
      queuedManualCalls++;
      if (!includeMissingBaseline) {
        await new Promise((resolve) => { releasePendingCheck = resolve; });
      }
      return { complete: true, value: includeMissingBaseline };
    },
    now: () => now,
  });
  const pendingPassive = queuedManualSchedule.run();
  const cancelledManualController = new AbortController();
  const cancelledManual = queuedManualSchedule.run(
    true,
    true,
    cancelledManualController.signal,
  );
  cancelledManualController.abort();
  let timeout;
  try {
    assert.deepStrictEqual(
      await Promise.race([
        cancelledManual,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error("queued cancellation did not settle")), 1000);
        }),
      ]),
      { status: "cancelled" },
    );
  } finally {
    clearTimeout(timeout);
  }
  assert.strictEqual(queuedManualCalls, 1);
  assert.strictEqual(queuedManualSaved, 0);
  releasePendingCheck();
  assert.strictEqual((await pendingPassive).status, "checked");
  assert.strictEqual(queuedManualSaved, 1);

  let releaseSave;
  const savingController = new AbortController();
  const savingSchedule = createWorkspaceUpdateSchedule({
    getLastSuccess: () => undefined,
    saveLastSuccess: () => new Promise((resolve) => { releaseSave = resolve; }),
    check: async () => ({ complete: true, value: "ignored" }),
    now: () => now,
  });
  const saving = savingSchedule.run(true, true, savingController.signal);
  await Promise.resolve();
  savingController.abort();
  releaseSave();
  assert.deepStrictEqual(await saving, { status: "cancelled" });

  const cancelled = new AbortController();
  let cancelledSave = 0;
  const cancelledSchedule = createWorkspaceUpdateSchedule({
    getLastSuccess: () => undefined,
    saveLastSuccess: async () => { cancelledSave++; },
    check: async () => {
      cancelled.abort();
      return { complete: true, value: "ignored" };
    },
    now: () => now,
  });
  assert.deepStrictEqual(await cancelledSchedule.run(true, true, cancelled.signal), { status: "cancelled" });
  assert.strictEqual(cancelledSave, 0);

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

  const manualSync = createWorkspaceUpdateSchedule({
    getLastSuccess: () => undefined,
    saveLastSuccess: async () => {},
    check: async (includeMissingBaseline) => ({
      complete: true,
      value: includeMissingBaseline,
    }),
    now: () => now,
  });
  assert.deepStrictEqual(await manualSync.run(), {
    status: "checked",
    complete: true,
    value: false,
  });
  assert.deepStrictEqual(await manualSync.run(true, true), {
    status: "checked",
    complete: true,
    value: true,
  });

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
