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

function loadI18n(language) {
  return requireTypeScriptModule(path.join(root, "src", "i18n.ts"), {
    vscode: {
      env: { language },
      workspace: {
        getConfiguration: () => ({
          get: (key, fallback) => (key === "language" ? language : fallback),
        }),
      },
    },
  });
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const root = path.join(__dirname, "..");
const presentation = requireTypeScriptModule(
  path.join(root, "src", "sourceIndexUpdatePresentation.ts"),
);

test("scales nested progress across all sources", () => {
  assert.strictEqual(
    presentation.scaleSourceIndexProgressIncrement(4, 50),
    12.5,
  );
  assert.strictEqual(
    presentation.scaleSourceIndexProgressIncrement(4, undefined),
    undefined,
  );
});

test("selects one final notification severity", () => {
  assert.strictEqual(
    presentation.getSourceIndexUpdateNotificationKind(0),
    "success",
  );
  assert.strictEqual(
    presentation.getSourceIndexUpdateNotificationKind(1),
    "warning",
  );
});

test("formats reset timestamps with the active locale", () => {
  const resetAt = "2026-07-29T12:30:00.000Z";
  assert.strictEqual(
    presentation.formatSourceIndexResetAt(resetAt, "ja-JP"),
    new Intl.DateTimeFormat("ja-JP", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(resetAt)),
  );
});

test("formats localized LM tool results for success and partial failure", () => {
  const base = {
    oldCount: 10,
    newCount: 12,
    oldUpdated: "2026-07-29",
    newUpdated: "2026-07-30",
    sourceStats: "3 sources",
    totalSources: 3,
    succeededCount: 3,
    failureCount: 0,
    skippedCount: 0,
    failedSources: [],
  };
  const en = presentation.formatSourceIndexUpdateToolResult(base, "en-US");
  assert.match(en, /^✅ Resource index updated\./);
  assert.match(en, /\| Resources \| 10 \| 12 \(\+2\) \|/);

  const ja = presentation.formatSourceIndexUpdateToolResult(
    {
      ...base,
      succeededCount: 1,
      failureCount: 1,
      skippedCount: 1,
      failedSources: ["GitHub"],
    },
    "ja-JP",
  );
  assert.match(
    ja,
    /^⚠️ リソースインデックスの更新結果: 1\/3 件更新、1 件失敗、1 件未試行。失敗: GitHub。/,
  );
});

test("renders complete source update notifications in Japanese and English", () => {
  const ja = loadI18n("ja").messages;
  const en = loadI18n("en").messages;

  assert.strictEqual(
    ja.staleSourceIndexPartialFailed(2, 1, 5, "Anthropic", "rate", 2),
    "ソースインデックスの更新結果: 2/5 件更新、1 件失敗、2 件未試行。失敗: Anthropic。理由: rate",
  );
  assert.strictEqual(
    en.staleSourceIndexPartialFailed(2, 1, 5, "Anthropic", "rate", 2),
    "Source index update result: 2/5 updated, 1 failed, 2 not attempted. Failed: Anthropic. Reason: rate",
  );
  assert.strictEqual(
    ja.sourceIndexUpdated("Anthropic", 10, 12, "+2"),
    "✅ Anthropic を更新しました: 10 → 12 リソース (+2)",
  );
  assert.strictEqual(
    en.sourceIndexUpdated("Anthropic", 10, 12, "+2"),
    "✅ Updated Anthropic: 10 → 12 resource(s) (+2)",
  );
});

test("keeps batch diagnostics and anonymous raw guards wired", () => {
  const extensionSource = fs.readFileSync(
    path.join(root, "src", "extension.ts"),
    "utf8",
  );
  const indexUpdaterSource = fs.readFileSync(
    path.join(root, "src", "indexUpdater.ts"),
    "utf8",
  );
  const githubFetchSource = fs.readFileSync(
    path.join(root, "src", "githubFetch.ts"),
    "utf8",
  );
  const mcpToolsSource = fs.readFileSync(
    path.join(root, "src", "mcpTools.ts"),
    "utf8",
  );
  const attachTokenFunction = githubFetchSource.match(
    /function shouldAttachGitHubToken[\s\S]*?\n}/,
  )?.[0];

  assert.match(extensionSource, /runSourceIndexUpdateBatch\(/);
  assert.match(extensionSource, /updateIndexFromSourcesWithResult\(/);
  assert.match(extensionSource, /return updateResult;/);
  assert.match(extensionSource, /\[Source Index\] \[OK\]/);
  assert.match(extensionSource, /\[Source Index\] \[FAILED\]/);
  assert.match(extensionSource, /\[Source Index\] \[SKIPPED\]/);
  assert.match(
    extensionSource,
    /else if \(action === authAction\) \{\s*await showAuthHelp\(firstFailure\.error\);\s*\}/,
  );
  assert.doesNotMatch(indexUpdaterSource, /githubFetch\(rawUrl,\s*token\)/);
  assert.ok(attachTokenFunction);
  assert.match(attachTokenFunction, /return isGitHubApiUrl\(url\)/);
  assert.doesNotMatch(attachTokenFunction, /return isRawGitHubUrl\(url\)/);
  assert.match(mcpToolsSource, /SourceIndexUpdateAllResult \| undefined/);
  assert.match(mcpToolsSource, /formatSourceIndexUpdateToolResult\(/);
  assert.doesNotMatch(mcpToolsSource, /✅ スキルインデックスを更新しました/);
});

console.log("Source index update presentation tests passed");
