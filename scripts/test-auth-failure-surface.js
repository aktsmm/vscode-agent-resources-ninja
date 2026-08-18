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

const repoRoot = path.resolve(__dirname, "..");
const vscodeStub = {
  env: { language: "ja" },
  workspace: {
    getConfiguration: () => ({ get: (_key, fallback) => fallback }),
  },
};
const i18n = requireTypeScriptModule(path.join(repoRoot, "src", "i18n.ts"), {
  vscode: vscodeStub,
});
const githubResponse = requireTypeScriptModule(
  path.join(repoRoot, "src", "githubResponse.ts"),
);

const japaneseRateLimitMessage = i18n.messages.rateLimitExceeded();
assert.ok(
  japaneseRateLimitMessage,
  "Japanese rate-limit message must not be empty",
);
assert.strictEqual(
  githubResponse.isGitHubAuthFailureMessage(japaneseRateLimitMessage),
  true,
  "Japanese rate-limit message must route to authentication help",
);

vscodeStub.env.language = "en";
const englishRateLimitMessage = i18n.messages.rateLimitExceeded();
assert.ok(
  englishRateLimitMessage,
  "English rate-limit message must not be empty",
);
assert.strictEqual(
  githubResponse.isGitHubAuthFailureMessage(englishRateLimitMessage),
  true,
  "English rate-limit message must route to authentication help",
);
assert.strictEqual(
  githubResponse.isGitHubAuthFailureMessage("Failed to parse local manifest"),
  false,
  "unrelated failures must keep the normal error surface",
);
assert.strictEqual(
  githubResponse.containsHttpStatus("HTTP 404: Not Found", 404),
  true,
);
assert.strictEqual(
  githubResponse.containsHttpStatus("Error (404).", 404),
  true,
);
assert.strictEqual(
  githubResponse.containsHttpStatus("Wrote 4041 bytes", 404),
  false,
);
assert.strictEqual(
  githubResponse.containsHttpStatus("Skill not found: azure-404-helper", 404),
  false,
);
assert.strictEqual(
  githubResponse.containsHttpStatus(
    "HTTP 500: Server Error (URL: https://example.test/404/file)",
    404,
  ),
  false,
);
assert.strictEqual(
  githubResponse.isGitHubAuthFailureMessage("Local write forbidden"),
  false,
);

const extensionSource = fs.readFileSync(
  path.join(repoRoot, "src", "extension.ts"),
  "utf8",
);
assert.ok(
  !/errorMessage\.includes\("(?:rate limit|authentication|403)"\)/.test(
    extensionSource,
  ),
  "extension commands must use the centralized authentication classifier",
);

console.log("RESULT=PASS");
