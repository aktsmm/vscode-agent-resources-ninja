/**
 * markdownToHtml 関数の回帰テスト（skillPreview.ts 由来）
 * 実行: node scripts/test-skill-preview-markdown.js
 *
 * HTML エスケープと href sanitize を検証するため、必ず実装本体を読み込む。
 */

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

const { markdownToHtml } = requireTypeScriptModule(
  path.join(__dirname, "..", "src", "skillPreview.ts"),
  {
    vscode: {
      Uri: { joinPath: () => ({}) },
      ViewColumn: { One: 1 },
      window: {},
      env: { language: "en" },
    },
    "./skillIndex": {
      loadSkillIndex: async () => undefined,
      getSkillGitHubUrlAsync: async () => "",
      getSourceBranch: () => "main",
      getResourceContentPath: () => "",
      getIndexResources: () => [],
      getIndexSources: () => [],
      getResourceKind: (resource) => resource.kind || "skill",
    },
    "./i18n": { default: {}, isJapanese: () => false },
    "./githubAuth": { getGitHubToken: async () => undefined },
    "./githubFetch": {
      fetchGitHubWithOptionalAuthRetry: async () => undefined,
    },
  },
);

function assertIncludes(actual, expected, message) {
  if (!actual.includes(expected)) {
    throw new Error(
      `${message}\nExpected to include: ${expected}\nActual: ${actual}`,
    );
  }
}

function runTest(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (error) {
    console.error(`❌ ${name}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

console.log("=== skillPreview markdownToHtml テスト ===");

runTest("見出しが h1/h2 に変換される", () => {
  const html = markdownToHtml("# Title\n\n## Section");
  assertIncludes(html, "<h1>Title</h1>", "H1 conversion failed");
  assertIncludes(html, "<h2>Section</h2>", "H2 conversion failed");
});

runTest("箇条書きが ul に正規化される", () => {
  const html = markdownToHtml("- A\n- B");
  assertIncludes(
    html,
    "<ul><li>A</li><li>B</li></ul>",
    "List normalization failed",
  );
});

runTest("段落が p と br に変換される", () => {
  const html = markdownToHtml("line1\nline2\n\nline3");
  assertIncludes(
    html,
    "<p>line1<br>line2</p>",
    "Paragraph line break conversion failed",
  );
  assertIncludes(html, "<p>line3</p>", "Second paragraph conversion failed");
});

runTest("javascript: リンクが無効化される", () => {
  const html = markdownToHtml("[x](javascript:alert(1))");
  assertIncludes(html, 'href="#"', "Unsafe href should be sanitized to #");
});

runTest("プロトコル相対URL(//)が無効化される", () => {
  const html = markdownToHtml("[x](//evil.example.com)");
  assertIncludes(
    html,
    'href="#"',
    "Protocol-relative URL should be sanitized to #",
  );
});

runTest("生 HTML がエスケープされる", () => {
  const html = markdownToHtml(
    '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">',
  );
  if (html.includes("<script>") || html.includes("<img")) {
    throw new Error(`Raw HTML must not survive: ${html}`);
  }
  assertIncludes(html, "&lt;script&gt;", "Angle brackets must be escaped");
  assertIncludes(html, "&quot;", "Double quotes must be escaped");
});

runTest("リンクラベルの生 HTML がエスケープされる", () => {
  const html = markdownToHtml(
    '[<img src=x onerror="alert(1)">](https://example.com)',
  );
  if (html.includes("<img")) {
    throw new Error(`Link label must not emit raw HTML: ${html}`);
  }
  assertIncludes(html, "&lt;img", "Link label must be escaped");
});

runTest("コードフェンスが pre/code に変換される", () => {
  const html = markdownToHtml("```ts\nconst x = 1;\n```");
  assertIncludes(
    html,
    '<pre><code class="language-ts">const x = 1;\n</code></pre>',
    "Code fence conversion failed",
  );
});

if (process.exitCode === 1) {
  console.error("\n❌ markdownToHtml tests failed");
} else {
  console.log("\n✅ All markdownToHtml tests passed");
}
