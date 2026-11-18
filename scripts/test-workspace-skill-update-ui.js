#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
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

const { presentWorkspaceSkillUpdates } = requireTypeScriptModule(
  path.join(__dirname, "..", "src", "workspaceSkillUpdateUi.ts"),
);
const uri = (value) => ({ toString: () => value });
const target = (root, name) => ({
  workspace: uri(root),
  target: uri(`${root}/${name}`),
  label: name,
});
const candidate = (item, changes = []) => ({
  id: `candidate:${item.target.toString()}`,
  target: item.target,
  revision: {},
  metadata: {},
  localChanges: changes,
  sharing: "unknown",
  synchronization: "unknown",
  recoveryDirectory: uri("transaction"),
});

function fixture() {
  const calls = [];
  const candidates = new Map();
  const ui = {
    notify: async () => undefined,
    confirmBulk: async () => true,
    chooseTarget: async () => undefined,
    getVerifiedDiffs: async (value) => {
      calls.push(["diffs", value.id]);
      return [{ path: "SKILL.md", local: Uint8Array.of(1), staged: Uint8Array.of(2) }];
    },
    showDetails: async (value, diffs) => {
      calls.push(["details", value.id, diffs]);
      return "update";
    },
    confirmSingle: async () => true,
    prepare: async (item) => {
      calls.push(["prepare", item.label]);
      return { status: "ready", candidate: candidates.get(item) || candidate(item) };
    },
    apply: async (value, approval, guard) => {
      calls.push(["apply", value.id, approval, await guard(value.target)]);
      return { status: "updated", backup: uri("backup") };
    },
    discard: async (value) => {
      calls.push(["discard", value.id]);
      return "discarded";
    },
    guard: async () => "clean",
    classifyBlocked: () => "skip",
    isRateLimit: () => false,
    isCancelled: () => false,
    report: async (outcomes) => calls.push(["report", outcomes]),
    log: (...args) => calls.push(["log", ...args]),
  };
  return { ui, calls, candidates };
}

async function main() {
  const a = target("workspace-a", "one");
  const b = target("workspace-b", "one");
  {
    const { ui, calls } = fixture();
    assert.deepEqual(await presentWorkspaceSkillUpdates([a], ui), []);
    assert.deepEqual(calls, []);
  }
  {
    const { ui, calls, candidates } = fixture();
    ui.notify = async () => "bulk";
    candidates.set(b, candidate(b, [{ path: "SKILL.md", kind: "modified" }]));
    const result = await presentWorkspaceSkillUpdates([a, b], ui);
    assert.deepEqual(result.map((item) => item.status), ["updated", "skipped"]);
    assert.equal(result[1].reason, "local-changes");
    const applies = calls.filter((entry) => entry[0] === "apply");
    assert.equal(applies.length, 1);
    assert.deepEqual(applies[0][2], { candidateId: candidate(a).id, mode: "bulk" });
    assert.ok(calls.some((entry) => entry[0] === "discard" && entry[1] === candidate(b).id));
  }
  {
    const { ui, calls, candidates } = fixture();
    const edited = candidate(b, [{ path: "SKILL.md", kind: "modified" }]);
    candidates.set(b, edited);
    ui.notify = async () => "details";
    ui.chooseTarget = async (remaining) => remaining[1] || remaining[0];
    ui.confirmSingle = async (value) => value === edited;
    const result = await presentWorkspaceSkillUpdates([a, b], ui);
    assert.deepEqual(result.map((item) => item.status), ["updated", "skipped"]);
    assert.equal(result[0].target, b);
    const apply = calls.find((entry) => entry[0] === "apply");
    assert.deepEqual(apply[2], {
      candidateId: edited.id,
      mode: "single",
      overwriteLocalChanges: true,
    });
    assert.equal(calls.find((entry) => entry[0] === "details")[2][0].path, "SKILL.md");
    assert.ok(calls.some((entry) => entry[0] === "discard" && entry[1] === candidate(a).id));
  }
  {
    const { ui, calls } = fixture();
    ui.notify = async () => "details";
    ui.chooseTarget = async (remaining) => remaining[0];
    ui.getVerifiedDiffs = async () => { throw new Error("snapshot changed"); };
    const result = await presentWorkspaceSkillUpdates([a], ui);
    assert.equal(result[0].status, "failed");
    assert.ok(calls.some((entry) => entry[0] === "discard"));
    assert.ok(calls.some((entry) => entry[0] === "log"));
    assert.ok(!calls.some((entry) => entry[0] === "apply"));
  }
  {
    const { ui, calls } = fixture();
    ui.notify = async () => "bulk";
    ui.guard = async () => "unknown";
    const result = await presentWorkspaceSkillUpdates([a], ui);
    assert.equal(result[0].reason, "dirty-or-unknown");
    assert.ok(!calls.some((entry) => entry[0] === "prepare"));
  }
  {
    const { ui, calls } = fixture();
    ui.notify = async () => "bulk";
    ui.confirmBulk = async () => false;
    assert.deepEqual(await presentWorkspaceSkillUpdates([a], ui), []);
    assert.ok(!calls.some((entry) => entry[0] === "prepare"));
  }
  {
    const { ui, calls } = fixture();
    let cancelled = false;
    ui.notify = async () => "bulk";
    ui.isCancelled = () => cancelled;
    ui.apply = async () => {
      cancelled = true;
      return { status: "updated", backup: uri("backup") };
    };
    const result = await presentWorkspaceSkillUpdates([a, b], ui);
    assert.deepEqual(result.map((item) => item.status), ["updated", "skipped"]);
    assert.equal(result[1].reason, "cancelled");
    assert.equal(calls.filter((entry) => entry[0] === "prepare").length, 1);
  }
  {
    const { ui, calls } = fixture();
    let guardCount = 0;
    ui.notify = async () => "bulk";
    ui.guard = async () => (++guardCount === 1 ? "clean" : "dirty");
    ui.apply = async (value, approval, guard) => {
      assert.equal(await guard(value.target), "dirty");
      return { status: "blocked", reason: "dirty-or-unknown-document" };
    };
    const result = await presentWorkspaceSkillUpdates([a], ui);
    assert.equal(result[0].reason, "dirty-or-unknown-document");
    assert.ok(calls.some((entry) => entry[0] === "discard"));
  }
  {
    const { ui, calls } = fixture();
    ui.notify = async () => "bulk";
    ui.apply = async () => ({ status: "recovery-required", reason: "unsafe", backup: uri("backup") });
    const result = await presentWorkspaceSkillUpdates([a, b], ui);
    assert.equal(result[0].status, "recovery-required");
    assert.equal(result[1].reason, "recovery-required");
    assert.equal(calls.filter((entry) => entry[0] === "prepare").length, 1);
    assert.ok(!calls.some((entry) => entry[0] === "discard"));
  }
  {
    const { ui, calls } = fixture();
    ui.notify = async () => "bulk";
    ui.prepare = async () => ({ status: "ready", candidate: candidate(b) });
    ui.discard = async () => "preserved";
    const result = await presentWorkspaceSkillUpdates([a], ui);
    assert.deepEqual(result.map((item) => item.status), ["recovery-required"]);
    assert.ok(!calls.some((entry) => entry[0] === "apply"));
  }
  {
    const { ui, calls } = fixture();
    ui.notify = async () => "bulk";
    ui.prepare = async (item) => {
      calls.push(["prepare", item.label]);
      return { status: "blocked", reason: "prepare-failed", failureKind: "rate-limit" };
    };
    ui.classifyBlocked = () => "skip";
    const result = await presentWorkspaceSkillUpdates([a, b], ui);
    assert.deepEqual(result.map((item) => item.status), ["failed", "skipped"]);
    assert.ok(result.every((item) => item.reason === "rate-limit"));
    assert.equal(calls.filter((entry) => entry[0] === "prepare").length, 1);
  }
  {
    const { ui } = fixture();
    ui.notify = async () => "bulk";
    ui.prepare = async () => ({
      status: "cleanup-required",
      reason: "download-failed",
      failureKind: "other",
      cleanupReason: "foreign-entry",
      directory: uri("transaction"),
    });
    const result = await presentWorkspaceSkillUpdates([a, b], ui);
    assert.equal(result[0].status, "recovery-required");
    assert.equal(result[0].reason, "foreign-entry");
    assert.equal(result[1].reason, "recovery-required");
  }
  {
    const { ui, calls } = fixture();
    ui.notify = async () => "bulk";
    ui.prepare = async (item) => {
      calls.push(["prepare", item.label]);
      return item === a
        ? { status: "blocked", reason: "pending-recovery", failureKind: "other", directory: uri("retained") }
        : { status: "ready", candidate: candidate(item) };
    };
    const result = await presentWorkspaceSkillUpdates([a, b], ui);
    assert.deepEqual(result.map((item) => item.status), ["recovery-required", "updated"]);
    assert.equal(result[0].recoveryDirectory.toString(), "retained");
  }
  console.log("PASS workspace skill update UI controller");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
