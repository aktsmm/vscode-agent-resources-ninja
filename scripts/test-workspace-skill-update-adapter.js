#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

function requireTypeScriptModule(filePath, stubs = {}) {
  const compiled = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
    fileName: filePath,
  });
  const loaded = new Module(filePath, module);
  loaded.filename = filePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(filePath));
  const original = Module._load;
  Module._load = function (request, parent, isMain) {
    return Object.hasOwn(stubs, request) ? stubs[request] : original.call(this, request, parent, isMain);
  };
  try {
    loaded._compile(compiled.outputText, filePath);
  } finally {
    Module._load = original;
  }
  return loaded.exports;
}

const src = path.join(__dirname, "..", "src");
const controller = requireTypeScriptModule(path.join(src, "workspaceSkillUpdateUi.ts"));
let japanese = false;
let provider;
let onClose;
let providerDisposed = false;
let listenerDisposed = false;
const messages = [];
const pickers = [];
const diffs = [];
const infoChoices = [];
const warningChoices = [];
const pickChoices = [];
const logs = [];

function uri(scheme, value) {
  return { scheme, fsPath: value, toString: () => `${scheme}:${value}` };
}
const vscode = {
  Uri: { from: ({ scheme, path: value }) => uri(scheme, value) },
  workspace: {
    registerTextDocumentContentProvider: (scheme, value) => {
      assert.equal(scheme, "resource-ninja-update-preview");
      provider = value;
      return { dispose: () => { providerDisposed = true; } };
    },
    onDidCloseTextDocument: (handler) => {
      onClose = handler;
      return { dispose: () => { listenerDisposed = true; } };
    },
  },
  window: {
    showInformationMessage: async (message, ...actions) => {
      messages.push({ kind: "info", message, actions });
      return infoChoices.shift();
    },
    showWarningMessage: async (message, ...actions) => {
      messages.push({ kind: "warning", message, actions });
      return warningChoices.shift();
    },
    showQuickPick: async (items, options) => {
      pickers.push({ items, options });
      const choose = pickChoices.shift();
      return choose?.(items);
    },
  },
  commands: {
    executeCommand: async (command, left, right, title) => {
      assert.equal(command, "vscode.diff");
      diffs.push({
        left, right, title,
        saved: provider.provideTextDocumentContent(left),
        staged: provider.provideTextDocumentContent(right),
      });
    },
  },
};

const { createWorkspaceSkillUpdateAdapter } = requireTypeScriptModule(
  path.join(src, "workspaceSkillUpdateAdapter.ts"),
  {
    vscode,
    "./workspaceSkillUpdateUi": controller,
    "./i18n": { isJapanese: () => japanese },
    "./logger": { logger: { warn: (...args) => logs.push(args) } },
  },
);

function reset() {
  messages.length = 0;
  pickers.length = 0;
  diffs.length = 0;
  infoChoices.length = 0;
  warningChoices.length = 0;
  pickChoices.length = 0;
  logs.length = 0;
  providerDisposed = false;
  listenerDisposed = false;
}

function fixture() {
  const item = {
    workspace: uri("file", "workspace"),
    target: uri("file", "workspace/skills/sample"),
    label: "sample",
  };
  const candidate = {
    id: "pinned-candidate",
    target: item.target,
    revision: {},
    metadata: {},
    localChanges: [{ path: "SKILL.md", kind: "modified" }],
    sharing: "unknown",
    synchronization: "unknown",
    recoveryDirectory: uri("file", "recovery"),
  };
  const calls = [];
  const context = { subscriptions: [] };
  const operations = {
    prepare: async () => { calls.push("prepare"); return { status: "ready", candidate }; },
    apply: async (value, approval, guard) => {
      calls.push({ value, approval, guard: await guard(value.target) });
      return { status: "updated", backup: uri("file", "backup") };
    },
    discard: async () => { calls.push("discard"); return "discarded"; },
    getVerifiedDiffs: async () => [
      { path: "SKILL.md", local: Buffer.from("old"), staged: Buffer.from("new") },
      { path: "added.md", staged: Buffer.from("added") },
      { path: "binary", local: Uint8Array.of(0), staged: Uint8Array.of(1) },
      { path: "invalid", local: Uint8Array.of(0xff), staged: Uint8Array.of(0xff) },
      { path: "large", local: new Uint8Array(1024 * 1024 + 1), staged: Uint8Array.of(65) },
    ],
    guard: async () => "clean",
    classifyBlocked: () => "skip",
    isRateLimit: () => false,
    isCancelled: () => false,
  };
  return { item, candidate, calls, context, operations };
}

async function main() {
  reset();
  japanese = false;
  {
    const { item, calls, context, operations } = fixture();
    const legacy = { ...item, label: "legacy", initialRevision: {} };
    const adapter = createWorkspaceSkillUpdateAdapter(context, operations);
    await adapter.present([item, legacy]);
    assert.match(messages[0].message, /1 changed and 1 first-sync/);
    assert.match(messages[0].message, /First sync can replace local content/);
    assert.deepEqual(calls, []);
    adapter.dispose();
  }
  reset();
  japanese = false;
  {
    const { item, candidate, calls, context, operations } = fixture();
    candidate.localChanges = [];
    const adapter = createWorkspaceSkillUpdateAdapter(context, operations);
    const result = await adapter.present([item], "bulk");
    assert.deepEqual(result.map((entry) => entry.status), ["updated"]);
    assert.ok(calls.includes("prepare"));
    assert.ok(calls.some((call) => call.approval?.mode === "bulk"));
    assert.equal(messages.length, 1);
    assert.match(messages[0].message, /Updated 1/);
    adapter.dispose();
  }
  reset();
  japanese = false;
  {
    const { item, calls, context, operations } = fixture();
    const adapter = createWorkspaceSkillUpdateAdapter(context, operations);
    assert.deepEqual(await adapter.present([item]), []);
    assert.deepEqual(calls, []);
    assert.match(messages[0].message, /detection is incomplete/);
    adapter.dispose();
    assert.ok(providerDisposed && listenerDisposed);
    await assert.rejects(adapter.present([item]), /disposed/);
  }
  reset();
  japanese = true;
  {
    const { item, calls, context, operations } = fixture();
    operations.prepare = async () => {
      calls.push("prepare");
      return { status: "blocked", reason: "invalid-or-local-baseline" };
    };
    infoChoices.push("まとめて更新", "結果の詳細");
    const adapter = createWorkspaceSkillUpdateAdapter(context, operations);
    const result = await adapter.present([item]);
    assert.equal(result[0].status, "skipped");
    assert.deepEqual(calls, ["prepare"]);
    assert.ok(!messages.some((message) => message.kind === "warning"));
    assert.ok(pickers[0].items[0].detail.includes("比較基準がありません"));
    adapter.dispose();
  }
  reset();
  japanese = true;
  {
    const { item, calls, context, operations } = fixture();
    infoChoices.push("詳細", undefined);
    pickChoices.push(
      (items) => items[0],
      (items) => items.find((entry) => entry.diff?.path === "binary"),
      (items) => items.find((entry) => entry.action === "apply"),
    );
    warningChoices.push(undefined, undefined);
    const adapter = createWorkspaceSkillUpdateAdapter(context, operations);
    const result = await adapter.present([item]);
    assert.equal(result[0].reason, "not-approved");
    assert.ok(messages.some((message) => message.message.includes("バイナリ")));
    const modal = messages.find((message) => message.actions[0]?.modal);
    assert.match(modal.actions[0].detail, /ローカル編集を上書き/);
    assert.match(modal.actions[0].detail, /3 件のファイルは差分を表示できません/);
    assert.ok(calls.includes("discard"));
    assert.ok(!calls.some((call) => call.approval));
    adapter.dispose();
  }
  reset();
  japanese = false;
  {
    const { item, calls, context, operations } = fixture();
    let resolveNotification;
    const original = vscode.window.showInformationMessage;
    vscode.window.showInformationMessage = () => new Promise((resolve) => {
      resolveNotification = resolve;
    });
    const adapter = createWorkspaceSkillUpdateAdapter(context, operations);
    const pending = adapter.present([item]);
    adapter.dispose();
    resolveNotification("Update All");
    vscode.window.showInformationMessage = original;
    const result = await pending;
    assert.equal(result[0].reason, "cancelled");
    assert.ok(!calls.includes("prepare"));
  }
  reset();
  japanese = false;
  {
    const { item, candidate, calls, context, operations } = fixture();
    infoChoices.push("Details", undefined);
    pickChoices.push(
      (items) => items[0],
      (items) => items.find((entry) => entry.diff?.path === "SKILL.md"),
      (items) => items.find((entry) => entry.diff?.path === "added.md"),
      (items) => items.find((entry) => entry.diff?.path === "binary"),
      (items) => items.find((entry) => entry.diff?.path === "invalid"),
      (items) => items.find((entry) => entry.diff?.path === "large"),
      (items) => items.find((entry) => entry.action === "apply"),
    );
    warningChoices.push(undefined, undefined, undefined, "Update");
    const adapter = createWorkspaceSkillUpdateAdapter(context, operations);
    const result = await adapter.present([item]);
    assert.equal(result[0].status, "updated");
    assert.equal(diffs.length, 2);
    assert.equal(diffs[0].saved, "old");
    assert.equal(diffs[0].staged, "new");
    assert.equal(diffs[1].saved, "");
    assert.match(diffs[1].title, /absent/);
    assert.ok(messages.some((message) => message.message.includes("Binary")));
    assert.ok(messages.some((message) => message.message.includes("Invalid UTF-8")));
    assert.ok(messages.some((message) => message.message.includes("1 MiB")));
    const modal = messages.find((message) => message.actions[0]?.modal);
    assert.match(modal.actions[0].detail, /Saved local edits will be overwritten/);
    assert.match(modal.actions[0].detail, /3 file\(s\) cannot be previewed/);
    const applied = calls.find((call) => call.approval);
    assert.equal(applied.value, candidate);
    assert.deepEqual(applied.approval, {
      candidateId: "pinned-candidate", mode: "single", overwriteLocalChanges: true,
    });
    onClose({ uri: diffs[0].left });
    assert.equal(provider.provideTextDocumentContent(diffs[0].left), "Preview expired.");
    adapter.dispose();
  }
  // A file above the in-memory limit is listed without text, and carried child skills are announced.
  for (const [isJa, kept, unavailable] of [
    [false, /1 separately installed child skill\(s\) are carried over unchanged/, /1 file\(s\) cannot be previewed/],
    [true, /独立してインストールした子スキル 1 件は、そのまま新しいコピーへ引き継ぎます/, /1 件のファイルは差分を表示できません/],
  ]) {
    reset();
    japanese = isJa;
    const { item, candidate, context, operations } = fixture();
    candidate.localChanges = [];
    candidate.carriedChildren = ["child"];
    operations.getVerifiedDiffs = async () => [{ path: "huge.bin", unavailable: "large" }];
    infoChoices.push(isJa ? "詳細" : "Details", undefined);
    pickChoices.push(
      (items) => items[0],
      (items) => items.find((entry) => entry.diff?.path === "huge.bin"),
      (items) => items.find((entry) => entry.action === "apply"),
    );
    warningChoices.push(undefined, isJa ? "更新する" : "Update");
    const adapter = createWorkspaceSkillUpdateAdapter(context, operations);
    const result = await adapter.present([item]);
    assert.equal(result[0].status, "updated");
    assert.equal(diffs.length, 0, "a large file never opens a text diff");
    assert.ok(messages.some((message) => message.message.includes(isJa ? "1 MiB を超える" : "1 MiB")));
    const modal = messages.find((message) => message.actions[0]?.modal);
    assert.match(modal.actions[0].detail, kept);
    assert.match(modal.actions[0].detail, unavailable);
    assert.ok(!/ローカル編集を上書き|Saved local edits will be overwritten/.test(modal.actions[0].detail));
    adapter.dispose();
  }
  reset();
  japanese = false;
  // Each engine reason that reaches the user has its own readable text, in both languages.
  for (const [reason, english, japaneseText] of [
    ["unknown-share-status", /Could not check whether this location is shared/, /共有されているか確認できませんでした/],
    ["unsafe-or-oversize-file", /too large/, /大きすぎる/],
    ["linked-or-special-entry", /linked location/, /リンクを含む/],
    ["child-conflicts-with-upstream", /child skill/, /子スキル/],
    ["copy-verification-failed", /could not be verified; nothing was changed/, /検証に失敗/],
  ]) {
    for (const isJa of [false, true]) {
      reset();
      japanese = isJa;
      const { item, context, operations } = fixture();
      infoChoices.push(isJa ? "まとめて更新" : "Update All");
      operations.prepare = async () => ({ status: "blocked", reason });
      operations.classifyBlocked = () => "failure";
      warningChoices.push(isJa ? "結果の詳細" : "Show Results");
      const adapter = createWorkspaceSkillUpdateAdapter(context, operations);
      await adapter.present([item]);
      const detail = pickers[0].items[0].detail;
      assert.match(detail, isJa ? japaneseText : english, `${reason} (${isJa ? "ja" : "en"}): ${detail}`);
      adapter.dispose();
    }
  }
  reset();
  japanese = false;
  {
    const { item, context, operations } = fixture();
    infoChoices.push("Update All");
    operations.prepare = async () => ({ status: "blocked", reason: "secret: sensitive" });
    operations.classifyBlocked = () => "failure";
    warningChoices.push("Show Results");
    const adapter = createWorkspaceSkillUpdateAdapter(context, operations);
    const result = await adapter.present([item]);
    assert.equal(result[0].status, "failed");
    assert.ok(!JSON.stringify(messages).includes("secret: sensitive"));
    assert.ok(!JSON.stringify(logs).includes("secret: sensitive"));
    assert.ok(pickers[0].items[0].detail.includes("Safety could not be verified"));
    adapter.dispose();
  }
  reset();
  japanese = false;
  {
    const { item, candidate, calls, context, operations } = fixture();
    let attempts = 0;
    operations.prepare = async () => ++attempts === 1
      ? { status: "blocked", reason: "candidate-verification-failed" }
      : { status: "ready", candidate: { ...candidate, localChanges: [] } };
    operations.classifyBlocked = () => "failure";
    infoChoices.push("Update All");
    warningChoices.push("Retry Failed (1)");
    infoChoices.push(undefined);
    const adapter = createWorkspaceSkillUpdateAdapter(context, operations);
    const result = await adapter.present([item]);
    assert.equal(attempts, 2);
    assert.deepEqual(result.map((entry) => entry.status), ["updated"]);
    const bulk = calls.find((call) => call.approval);
    assert.equal(bulk.approval.mode, "bulk");
    // A second retry is never offered, and a rate limit is not retryable.
    assert.ok(!messages.slice(2).some((message) => message.actions.some((action) => /Retry/.test(action))));
    adapter.dispose();
  }
  reset();
  japanese = false;
  {
    const { item, context, operations } = fixture();
    operations.prepare = async () => ({ status: "blocked", reason: "prepare-failed", failureKind: "rate-limit" });
    infoChoices.push("Update All");
    warningChoices.push(undefined);
    const adapter = createWorkspaceSkillUpdateAdapter(context, operations);
    await adapter.present([item]);
    assert.ok(!messages.some((message) => message.actions.some((action) => /Retry/.test(action))));
    adapter.dispose();
  }
  console.log("PASS workspace skill update VS Code adapter");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
