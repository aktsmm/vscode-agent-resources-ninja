#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const os = require("os");
const path = require("path");
const ts = require("typescript");

const originalLoad = Module._load;

function installTypeScriptRequireHook() {
  require.extensions[".ts"] = function compileTypeScript(module, filePath) {
    const source = fs.readFileSync(filePath, "utf8");
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
      fileName: filePath,
    });
    module._compile(transpiled.outputText, filePath);
  };
}

function createVscodeStub() {
  class Uri {
    constructor(fsPath) {
      this.fsPath = path.normalize(fsPath);
    }

    static file(filePath) {
      return new Uri(filePath);
    }

    static joinPath(baseUri, ...segments) {
      return new Uri(path.join(baseUri.fsPath, ...segments));
    }
  }

  return {
    Uri,
    workspace: {
      fs: {
        async stat(uri) {
          return fs.promises.stat(uri.fsPath);
        },
        async readFile(uri) {
          return fs.promises.readFile(uri.fsPath);
        },
        async writeFile(uri, content) {
          await fs.promises.mkdir(path.dirname(uri.fsPath), {
            recursive: true,
          });
          return fs.promises.writeFile(uri.fsPath, content);
        },
      },
    },
  };
}

function loadModules() {
  installTypeScriptRequireHook();
  const vscodeStub = createVscodeStub();
  Module._load = function load(request, parent, isMain) {
    if (request === "vscode") {
      return vscodeStub;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  return {
    vscode: vscodeStub,
    hookConfig: require(path.join(__dirname, "..", "src", "hookConfig.ts")),
    hookConfigManager: require(
      path.join(__dirname, "..", "src", "hookConfigManager.ts"),
    ),
  };
}

function test(name, fn) {
  Promise.resolve()
    .then(fn)
    .then(() => console.log(`PASS ${name}`))
    .catch((error) => {
      console.error(`FAIL ${name}`);
      console.error(error);
      process.exitCode = 1;
    });
}

function commandList(config, eventName) {
  return config.hooks[eventName].map((entry) => entry.bash || entry.command);
}

const {
  vscode,
  hookConfig: {
    getKnownRecommendedHookConfig,
    mergeHookConfig,
    removeHookConfig,
    extractRecommendedHookConfigFromReadme,
  },
  hookConfigManager: {
    getHookConfigDiagnostics,
    restoreHookConfigFromBackup,
    updateHookConfigForInstall,
    updateHookConfigForUninstall,
  },
} = loadModules();

test("first hook install creates hooks config from known fallback", () => {
  const result = mergeHookConfig(
    undefined,
    getKnownRecommendedHookConfig("secrets-scanner"),
    "secrets-scanner",
    ".github/hooks/secrets-scanner",
  );

  assert.strictEqual(result.changed, true);
  assert.deepStrictEqual(result.addedByEvent, { sessionEnd: 1 });
  assert.strictEqual(result.config.version, 1);
  assert.deepStrictEqual(commandList(result.config, "sessionEnd"), [
    ".github/hooks/secrets-scanner/scan-secrets.sh",
  ]);
});

test("existing hooks config is appended without losing unrelated settings", () => {
  const existing = {
    version: 7,
    custom: { keep: true },
    hooks: {
      sessionEnd: [
        {
          type: "command",
          bash: ".github/hooks/secrets-scanner/scan-secrets.sh",
          env: { SCAN_MODE: "block" },
        },
      ],
    },
  };

  const result = mergeHookConfig(
    existing,
    getKnownRecommendedHookConfig("session-logger"),
    "session-logger",
    ".github/hooks/session-logger",
  );

  assert.strictEqual(result.config.version, 7);
  assert.deepStrictEqual(result.config.custom, { keep: true });
  assert.deepStrictEqual(result.addedByEvent, {
    sessionStart: 1,
    userPromptSubmitted: 1,
    sessionEnd: 1,
  });
  assert.deepStrictEqual(commandList(result.config, "sessionEnd"), [
    ".github/hooks/secrets-scanner/scan-secrets.sh",
    ".github/hooks/session-logger/log-session-end.sh",
  ]);
});

test("reinstall is idempotent and preserves user-edited values", () => {
  const existing = {
    version: 1,
    hooks: {
      sessionEnd: [
        {
          type: "command",
          bash: ".github/hooks/secrets-scanner/scan-secrets.sh",
          cwd: ".",
          env: { SCAN_MODE: "block", SCAN_SCOPE: "staged" },
          timeoutSec: 99,
        },
      ],
    },
  };

  const result = mergeHookConfig(
    existing,
    getKnownRecommendedHookConfig("secrets-scanner"),
    "secrets-scanner",
    ".github/hooks/secrets-scanner",
  );

  assert.strictEqual(result.changed, false);
  assert.strictEqual(result.config.hooks.sessionEnd.length, 1);
  assert.deepStrictEqual(result.config.hooks.sessionEnd[0].env, {
    SCAN_MODE: "block",
    SCAN_SCOPE: "staged",
  });
});

test("sessionEnd order keeps scanner before logger", () => {
  const existing = {
    version: 1,
    hooks: {
      sessionEnd: [
        {
          type: "command",
          bash: ".github/hooks/session-logger/log-session-end.sh",
        },
      ],
    },
  };

  const result = mergeHookConfig(
    existing,
    getKnownRecommendedHookConfig("secrets-scanner"),
    "secrets-scanner",
    ".github/hooks/secrets-scanner",
  );

  assert.deepStrictEqual(commandList(result.config, "sessionEnd"), [
    ".github/hooks/secrets-scanner/scan-secrets.sh",
    ".github/hooks/session-logger/log-session-end.sh",
  ]);
  assert.deepStrictEqual(result.reorderedEvents, ["sessionEnd"]);
});

test("uninstall removes only the target hook entry", () => {
  const existing = {
    version: 1,
    hooks: {
      sessionEnd: [
        {
          type: "command",
          bash: ".github/hooks/secrets-scanner/scan-secrets.sh",
        },
        {
          type: "command",
          bash: ".github/hooks/session-logger/log-session-end.sh",
        },
      ],
    },
  };

  const result = removeHookConfig(
    existing,
    getKnownRecommendedHookConfig("secrets-scanner"),
    "secrets-scanner",
    ".github/hooks/secrets-scanner",
  );

  assert.deepStrictEqual(result.removedByEvent, { sessionEnd: 1 });
  assert.deepStrictEqual(commandList(result.config, "sessionEnd"), [
    ".github/hooks/session-logger/log-session-end.sh",
  ]);
});

test("README JSON block can be used as fallback recommendation", () => {
  const fromReadme = extractRecommendedHookConfigFromReadme(`
# Custom Hook

\`\`\`json
{
  "version": 1,
  "hooks": {
    "postToolUse": [
      { "type": "command", "bash": "hooks/custom-hook/run.sh" }
    ]
  }
}
\`\`\`
`);

  const result = mergeHookConfig(
    undefined,
    fromReadme,
    "custom-hook",
    ".github/hooks/custom-hook",
  );

  assert.deepStrictEqual(commandList(result.config, "postToolUse"), [
    ".github/hooks/custom-hook/run.sh",
  ]);
});

test("unsupported existing event shape fails closed", () => {
  assert.throws(
    () =>
      mergeHookConfig(
        { version: 1, hooks: { sessionEnd: { bad: true } } },
        getKnownRecommendedHookConfig("secrets-scanner"),
        "secrets-scanner",
        ".github/hooks/secrets-scanner",
      ),
    /hooks\.sessionEnd must be an array/,
  );
});

test("invalid root hooks.json is backed up and not overwritten", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ninja-hooks-"));
  const rootUri = vscode.Uri.file(tempRoot);
  const hookDir = path.join(tempRoot, ".github", "hooks", "secrets-scanner");
  await fs.promises.mkdir(hookDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(hookDir, "README.md"),
    "# Secrets Scanner\n",
  );
  await fs.promises.writeFile(path.join(tempRoot, "hooks.json"), "{ bad json");

  await assert.rejects(
    () =>
      updateHookConfigForInstall(
        rootUri,
        vscode.Uri.file(path.join(hookDir, "README.md")),
      ),
    /Failed to parse hooks\.json/,
  );

  const files = await fs.promises.readdir(tempRoot);
  assert(files.some((file) => file.startsWith("hooks.json.bak-")));
  assert.strictEqual(
    await fs.promises.readFile(path.join(tempRoot, "hooks.json"), "utf8"),
    "{ bad json",
  );
});

test("uninstall writes backup and can restore hooks.json after later failures", async () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "ninja-hooks-restore-"),
  );
  const rootUri = vscode.Uri.file(tempRoot);
  const hookDir = path.join(tempRoot, ".github", "hooks", "session-logger");
  const readmePath = path.join(hookDir, "README.md");
  await fs.promises.mkdir(hookDir, { recursive: true });
  await fs.promises.writeFile(readmePath, "# Session Logger\n");

  await updateHookConfigForInstall(rootUri, vscode.Uri.file(readmePath));
  const beforeUninstall = await fs.promises.readFile(
    path.join(tempRoot, "hooks.json"),
    "utf8",
  );

  const result = await updateHookConfigForUninstall(
    rootUri,
    vscode.Uri.file(readmePath),
  );
  assert.ok(result.changed);
  assert.ok(result.backupUri, "uninstall should keep a backup for rollback");
  assert.ok(fs.existsSync(result.backupUri.fsPath));

  const restored = await restoreHookConfigFromBackup(result);
  assert.strictEqual(restored, true);
  assert.strictEqual(
    await fs.promises.readFile(path.join(tempRoot, "hooks.json"), "utf8"),
    beforeUninstall,
  );
});

test("hook diagnostics report missing root config and script warnings", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ninja-hooks-diag-"));
  const rootUri = vscode.Uri.file(tempRoot);
  const hookDir = path.join(tempRoot, ".github", "hooks", "session-logger");
  await fs.promises.mkdir(hookDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(hookDir, "README.md"),
    "# Session Logger\n",
  );

  const diagnostics = await getHookConfigDiagnostics(
    rootUri,
    vscode.Uri.file(path.join(hookDir, "README.md")),
  );

  assert.strictEqual(diagnostics.status, "notConfigured");
  assert.strictEqual(diagnostics.source, "known");
  assert.deepStrictEqual(diagnostics.eventCounts, {
    sessionStart: 1,
    userPromptSubmitted: 1,
    sessionEnd: 1,
  });
  assert.ok(
    diagnostics.warnings.some((warning) => /Missing script/.test(warning)),
  );
});

test("hook diagnostics report configured root config", async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ninja-hooks-diag-"));
  const rootUri = vscode.Uri.file(tempRoot);
  const hookDir = path.join(tempRoot, ".github", "hooks", "secrets-scanner");
  await fs.promises.mkdir(hookDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(hookDir, "README.md"),
    "# Secrets Scanner\n",
  );
  await fs.promises.writeFile(
    path.join(hookDir, "scan-secrets.sh"),
    "#!/usr/bin/env bash\n",
  );
  await updateHookConfigForInstall(
    rootUri,
    vscode.Uri.file(path.join(hookDir, "README.md")),
  );

  const diagnostics = await getHookConfigDiagnostics(
    rootUri,
    vscode.Uri.file(path.join(hookDir, "README.md")),
  );

  assert.strictEqual(diagnostics.status, "configured");
  assert.deepStrictEqual(diagnostics.missingByEvent, {});
  assert.deepStrictEqual(diagnostics.warnings, []);
});

process.on("beforeExit", () => {
  if (!process.exitCode) {
    console.log("RESULT=PASS");
  }
});
