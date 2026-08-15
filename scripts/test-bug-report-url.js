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

const { BUG_REPORT_URL_MAX_LENGTH, buildBugReportUrl } =
  requireTypeScriptModule(path.join(__dirname, "..", "src", "bugReport.ts"), {
    vscode: { env: {}, Uri: { parse: (value) => value } },
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

console.log("RESULT=PASS");
