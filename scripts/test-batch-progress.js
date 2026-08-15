#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

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

const { formatBatchCancellationSuffix, formatBatchFailureMessage } =
  requireTypeScriptModule(
    path.join(__dirname, "..", "src", "batchProgress.ts"),
  );

assert.strictEqual(
  formatBatchFailureMessage("Install", 2, 3, ["broken"], false),
  "Install: 2/3 succeeded, 1 failed (broken)",
);
assert.strictEqual(
  formatBatchFailureMessage("削除", 1, 5, ["a", "b", "c", "d"], true),
  "削除: 1/5 件成功、4 件失敗 (a, b, c...)",
);
assert.strictEqual(
  formatBatchCancellationSuffix(2, 5, false),
  ". Canceled with 3 unprocessed",
);
assert.strictEqual(
  formatBatchCancellationSuffix(7, 5, true),
  "。キャンセルされ、0 件は未処理です",
  "unprocessed counts must never become negative",
);

console.log("RESULT=PASS");
