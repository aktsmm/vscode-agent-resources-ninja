#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
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

const opened = [];
const previews = [];
let nextChoice = () => undefined;

const {
  BUG_REPORT_URL_MAX_LENGTH,
  buildBugReportUrl,
  buildReinstallBatchReport,
  previewAndOpenBugReport,
} = requireTypeScriptModule(path.join(__dirname, "..", "src", "bugReport.ts"), {
  vscode: {
    env: {
      openExternal: async (uri) => {
        opened.push(uri);
        return true;
      },
    },
    Uri: { parse: (value) => value },
    window: {
      showInformationMessage: async (...args) => {
        previews.push(args);
        return nextChoice(args);
      },
    },
  },
});

const shortUrl = new URL(buildBugReportUrl("Short title", "Short body"));
assert.strictEqual(shortUrl.searchParams.get("title"), "Short title");
assert.strictEqual(shortUrl.searchParams.get("body"), "Short body");

const longBody = "外部エラー <img src=https://example.test/pixel> ".repeat(
  2_000,
);
const boundedUrlText = buildBugReportUrl("T".repeat(1_000), longBody);
assert.ok(boundedUrlText.length <= BUG_REPORT_URL_MAX_LENGTH);
const boundedUrl = new URL(boundedUrlText);
assert.strictEqual(boundedUrl.searchParams.get("title").length, 256);
assert.match(
  boundedUrl.searchParams.get("body"),
  /\[Details truncated to fit GitHub issue URL limits\.\]$/,
);
assert.ok(!boundedUrl.searchParams.get("body").endsWith("\uFFFD"));

const emojiBody = "😀".repeat(20_000);
const emojiUrl = new URL(buildBugReportUrl("Emoji boundary", emojiBody));
const truncatedEmojiBody = emojiUrl.searchParams.get("body");
assert.ok(emojiUrl.toString().length <= BUG_REPORT_URL_MAX_LENGTH);
assert.ok(!/[\uD800-\uDBFF]$/.test(truncatedEmojiBody));
assert.ok(!truncatedEmojiBody.includes("\uFFFD"));

const records = [
  {
    task: { name: "customer/secret-skill", resourceKind: "skill" },
    result: {
      success: false,
      removed: true,
      attempts: 1,
      stage: "install",
      failureKind: "auth-required",
      error: new Error("token ghp_secret in C:/private/path"),
    },
  },
  {
    task: { name: "another-private-resource", resourceKind: "token ghp_secret" },
    result: {
      success: false,
      removed: false,
      attempts: 0,
      stage: "not-started",
      failureKind: "token ghp_secret",
    },
  },
  {
    task: { name: "installed-private-resource", resourceKind: "agent" },
    result: { success: true, removed: true, attempts: 1, stage: "complete" },
  },
  {
    task: { name: "cancelled-private-resource", resourceKind: "agent" },
    result: {
      success: false,
      removed: false,
      attempts: 0,
      stage: "not-started",
      failureKind: "cancelled",
    },
  },
  {
    task: { name: "user-global-agent", resourceKind: "agent" },
    result: {
      success: false,
      removed: false,
      attempts: 1,
      stage: "C:/private/stage",
      failureKind: "not-found",
    },
  },
];
const report = buildReinstallBatchReport(records, false);
assert.strictEqual(report.title, "[Bug] Batch reinstall failure");
assert.match(report.body, /Succeeded: 1/);
assert.match(report.body, /Failed: 3/);
assert.match(report.body, /Cancelled: 1/);
assert.match(report.body, /Not started: 2/);
assert.match(report.body, /auth-required: 1/);
assert.match(report.body, /other: 1/);
assert.match(
  report.body,
  /Failed resource kinds: skill: 1, agent: 1, other: 1/,
  "failed resources are counted by a fixed kind list; free text falls into other",
);
assert.match(
  report.body,
  /Failed stages: not-started: 1, install: 1, other: 1/,
  "failed stages are counted by a fixed stage list",
);
const reportUrl = buildBugReportUrl(report.title, report.body);
assert.doesNotMatch(reportUrl, /ghp_secret|private|customer|C%3A|path/i);
assert.match(buildReinstallBatchReport(records, true).body, /成功: 1/);
assert.match(
  buildReinstallBatchReport(records, true).body,
  /失敗したリソース種別: skill: 1, agent: 1, other: 1/,
);

(async () => {
  // The draft is previewed first; declining must not open anything.
  nextChoice = () => undefined;
  assert.strictEqual(await previewAndOpenBugReport(report, false), false);
  assert.strictEqual(opened.length, 0, "no draft opens without a confirmation");
  const [message, options, openLabel] = previews[0];
  assert.strictEqual(options.modal, true);
  assert.ok(options.detail.includes(report.body), "the preview shows the exact body");
  assert.match(message, /Nothing is posted automatically/);

  nextChoice = (args) => args[2];
  assert.strictEqual(await previewAndOpenBugReport(report, false), true);
  assert.strictEqual(opened.length, 1);
  assert.strictEqual(
    new URL(opened[0]).searchParams.get("body"),
    report.body,
    "the draft equals what was previewed",
  );
  assert.strictEqual(openLabel, "Open GitHub Draft");
  console.log("RESULT=PASS");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
