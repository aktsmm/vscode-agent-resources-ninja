#!/usr/bin/env node

// Exercises the real path helpers from src so this test cannot pass against a stale copy.

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

const { getVsCodeUserPromptsPath, getCopilotHomePath } =
  requireTypeScriptModule(
    path.join(__dirname, "..", "src", "userDataPaths.ts"),
  );

function normalize(value) {
  return value.replace(/\\/g, "/");
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

test("resolves macOS stable user prompts path", () => {
  assert.strictEqual(
    normalize(
      getVsCodeUserPromptsPath({
        platform: "darwin",
        homeDir: "/Users/alice",
        env: { APPDATA: "C:/Users/alice/AppData/Roaming" },
      }),
    ),
    "/Users/alice/Library/Application Support/Code/User/prompts",
  );
});

test("resolves macOS insiders user prompts path", () => {
  assert.strictEqual(
    normalize(
      getVsCodeUserPromptsPath({
        platform: "darwin",
        homeDir: "/Users/alice",
        appName: "Visual Studio Code - Insiders",
      }),
    ),
    "/Users/alice/Library/Application Support/Code - Insiders/User/prompts",
  );
});

test("resolves VSCodium user prompts path", () => {
  assert.strictEqual(
    normalize(
      getVsCodeUserPromptsPath({
        platform: "darwin",
        homeDir: "/Users/alice",
        appName: "VSCodium",
      }),
    ),
    "/Users/alice/Library/Application Support/VSCodium/User/prompts",
  );
});

test("resolves Windows APPDATA path", () => {
  assert.strictEqual(
    normalize(
      getVsCodeUserPromptsPath({
        platform: "win32",
        homeDir: "C:/Users/alice",
        env: { APPDATA: "C:/Users/alice/AppData/Roaming" },
      }),
    ),
    "C:/Users/alice/AppData/Roaming/Code/User/prompts",
  );
});

test("falls back to Windows roaming path without APPDATA", () => {
  assert.strictEqual(
    normalize(
      getVsCodeUserPromptsPath({
        platform: "win32",
        homeDir: "C:/Users/alice",
        env: {},
      }),
    ),
    "C:/Users/alice/AppData/Roaming/Code/User/prompts",
  );
});

test("resolves Linux XDG_CONFIG_HOME path", () => {
  assert.strictEqual(
    normalize(
      getVsCodeUserPromptsPath({
        platform: "linux",
        homeDir: "/home/alice",
        env: { XDG_CONFIG_HOME: "/tmp/config" },
      }),
    ),
    "/tmp/config/Code/User/prompts",
  );
});

test("resolves Linux default config path", () => {
  assert.strictEqual(
    normalize(
      getVsCodeUserPromptsPath({
        platform: "linux",
        homeDir: "/home/alice",
        env: {},
      }),
    ),
    "/home/alice/.config/Code/User/prompts",
  );
});

test("resolves Copilot home consistently", () => {
  assert.strictEqual(
    normalize(getCopilotHomePath({ homeDir: "/Users/alice" })),
    "/Users/alice/.copilot",
  );
});

console.log("User data path tests passed");
