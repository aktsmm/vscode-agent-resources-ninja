#!/usr/bin/env node

// Regression tests for src/githubAuth.ts:
// - SecretStorage-first token resolution (secret -> env -> gh-cli -> legacy config -> none)
// - legacy config token migration into SecretStorage
// - bounded `gh auth token` exec options (timeout + windowsHide)
// - stored token deletion

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

// --- Shared mutable test state ---------------------------------------------

const SECRET_KEY = "resourceNinja.githubToken";

const secretMap = new Map();
const secretStorage = {
  get: async (key) => secretMap.get(key),
  store: async (key, value) => {
    secretMap.set(key, value);
  },
  delete: async (key) => {
    secretMap.delete(key);
  },
};

let configState = {};
let execHandler = null;
const execCalls = [];

// `gh auth token` is invoked via `await import("child_process")`, which resolves
// after the Module._load stub is restored. Monkeypatch the real singleton's exec
// so the test never shells out to a real gh CLI.
const realChildProcess = require("child_process");
const originalExec = realChildProcess.exec;
realChildProcess.exec = (command, options, callback) => {
  execCalls.push({ command, options });
  const cb = typeof options === "function" ? options : callback;
  if (typeof execHandler === "function") {
    execHandler(command, options, cb);
  } else {
    cb(new Error("no gh"), "", "");
  }
};

const vscodeStub = {
  workspace: {
    getConfiguration: (section) => {
      assert.strictEqual(
        section,
        "resourceNinja",
        "getConfiguration must use the resourceNinja section",
      );
      return {
        get: (key) => configState[key],
      };
    },
  },
};

const childProcessStub = {
  exec: (command, options, callback) => {
    execCalls.push({ command, options });
    if (typeof execHandler === "function") {
      execHandler(command, options, callback);
    } else {
      callback(new Error("no gh"), "", "");
    }
  },
};

const i18nStub = {
  messages: {
    authRequired: () => "auth required",
  },
};

const githubAuth = requireTypeScriptModule(
  path.join(__dirname, "..", "src", "githubAuth.ts"),
  {
    vscode: vscodeStub,
    "./i18n": i18nStub,
    child_process: childProcessStub,
  },
);

githubAuth.initializeGitHubAuth({ secrets: secretStorage });

// --- Test helpers -----------------------------------------------------------

function resetState() {
  secretMap.clear();
  configState = {};
  execHandler = null;
  execCalls.length = 0;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
}

const tests = [
  {
    name: "SecretStorage token wins over env and legacy config",
    run: async () => {
      secretMap.set(SECRET_KEY, "secret-tok");
      process.env.GITHUB_TOKEN = "env-tok";
      configState.githubToken = "cfg-tok";

      const result = await githubAuth.resolveGitHubToken();
      assert.strictEqual(result.source, "secret");
      assert.strictEqual(result.token, "secret-tok");
    },
  },
  {
    name: "Environment token wins over legacy config when no secret",
    run: async () => {
      process.env.GH_TOKEN = "env-tok";
      configState.githubToken = "cfg-tok";

      const result = await githubAuth.resolveGitHubToken();
      assert.strictEqual(result.source, "env");
      assert.strictEqual(result.token, "env-tok");
    },
  },
  {
    name: "Legacy config token is migrated into SecretStorage (idempotent)",
    run: async () => {
      configState.githubToken = "cfg-tok";

      const firstMigrate =
        await githubAuth.migrateConfiguredGitHubTokenToSecretStorage();
      assert.strictEqual(firstMigrate, true, "first migration should copy");
      assert.strictEqual(secretMap.get(SECRET_KEY), "cfg-tok");

      const secondMigrate =
        await githubAuth.migrateConfiguredGitHubTokenToSecretStorage();
      assert.strictEqual(
        secondMigrate,
        false,
        "second migration should be a no-op",
      );

      const result = await githubAuth.resolveGitHubToken();
      assert.strictEqual(result.source, "secret");
      assert.strictEqual(result.token, "cfg-tok");
    },
  },
  {
    name: "gh CLI token uses bounded exec options",
    run: async () => {
      execHandler = (_command, _options, callback) => {
        callback(null, "gh-tok\n", "");
      };

      const result = await githubAuth.resolveGitHubToken();
      assert.strictEqual(result.source, "gh-cli");
      assert.strictEqual(result.token, "gh-tok");
      assert.strictEqual(execCalls.length, 1, "exec should be called once");
      assert.strictEqual(execCalls[0].command, "gh auth token");
      assert.strictEqual(execCalls[0].options.timeout, 5000);
      assert.strictEqual(execCalls[0].options.windowsHide, true);
    },
  },
  {
    name: "gh CLI errors fall back to legacy config",
    run: async () => {
      configState.githubToken = "cfg-tok";
      execHandler = (_command, _options, callback) => {
        callback(new Error("gh failed"), "", "command not found");
      };

      const result = await githubAuth.resolveGitHubToken();
      assert.strictEqual(result.source, "config");
      assert.strictEqual(result.token, "cfg-tok");
    },
  },
  {
    name: "Empty gh CLI output resolves to none",
    run: async () => {
      execHandler = (_command, _options, callback) => {
        callback(null, "   \n", "");
      };

      const result = await githubAuth.resolveGitHubToken();
      assert.strictEqual(result.source, "none");
      assert.strictEqual(result.token, undefined);
    },
  },
  {
    name: "Stored token can be deleted",
    run: async () => {
      secretMap.set(SECRET_KEY, "secret-tok");
      await githubAuth.deleteStoredGitHubToken();
      assert.strictEqual(secretMap.has(SECRET_KEY), false);

      const result = await githubAuth.resolveGitHubToken();
      assert.strictEqual(result.source, "none");
    },
  },
  {
    name: "Config change syncs new token into SecretStorage",
    run: async () => {
      secretMap.set(SECRET_KEY, "old-tok");
      configState.githubToken = "new-tok";

      await githubAuth.syncConfiguredGitHubToken();
      assert.strictEqual(secretMap.get(SECRET_KEY), "new-tok");
    },
  },
  {
    name: "Clearing config token removes it from SecretStorage",
    run: async () => {
      secretMap.set(SECRET_KEY, "old-tok");
      configState.githubToken = "";

      await githubAuth.syncConfiguredGitHubToken();
      assert.strictEqual(secretMap.has(SECRET_KEY), false);

      const result = await githubAuth.resolveGitHubToken();
      assert.strictEqual(result.source, "none");
    },
  },
];

async function main() {
  let passed = 0;
  for (const test of tests) {
    resetState();
    try {
      await test.run();
      passed += 1;
      console.log(`  PASS: ${test.name}`);
    } catch (error) {
      console.error(`  FAIL: ${test.name}`);
      console.error(`    ${error.message}`);
      process.exitCode = 1;
    }
  }

  console.log(`\n${passed}/${tests.length} github-auth tests passed`);
  if (passed === tests.length) {
    console.log("RESULT=PASS");
  } else {
    console.log("RESULT=FAIL");
    process.exitCode = 1;
  }

  // Restore the monkeypatched exec so the harness leaves no global side effects.
  realChildProcess.exec = originalExec;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
