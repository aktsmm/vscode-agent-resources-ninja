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

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const createdChannels = [];
let shouldThrowOnAppend = false;

class Disposable {
  constructor(callback) {
    this.callback = callback;
  }

  dispose() {
    this.callback?.();
  }
}

const vscodeStub = {
  Disposable,
  window: {
    createOutputChannel(name) {
      const channel = {
        name,
        lines: [],
        disposed: false,
        appendLine(line) {
          if (shouldThrowOnAppend) {
            throw new Error("append failed");
          }
          this.lines.push(line);
        },
        dispose() {
          this.disposed = true;
        },
      };
      createdChannels.push(channel);
      return channel;
    },
  },
};

const loggerModule = requireTypeScriptModule(
  path.join(__dirname, "..", "src", "logger.ts"),
  { vscode: vscodeStub },
);

test("logger writes structured diagnostics to output channel", () => {
  const subscriptions = [];
  loggerModule.registerLogger({ subscriptions });
  loggerModule.logger.info("hello", { ok: true });
  loggerModule.logger.warn("careful");
  loggerModule.logger.error("broken", new Error("boom"));

  assert.strictEqual(createdChannels.length, 1);
  assert.deepStrictEqual(createdChannels[0].lines.slice(0, 2), [
    'hello {"ok":true}',
    "WARN: careful",
  ]);
  assert.match(createdChannels[0].lines[2], /^ERROR: broken Error: boom/);
  assert.strictEqual(subscriptions.length, 1);
});

test("logger recreates channel after disposal", () => {
  const subscriptions = [];
  loggerModule.registerLogger({ subscriptions });
  const channelBeforeDispose = createdChannels[createdChannels.length - 1];
  const countBeforeDispose = createdChannels.length;

  subscriptions[0].dispose();
  assert.strictEqual(channelBeforeDispose.disposed, true);

  loggerModule.logger.info("after dispose");
  assert.strictEqual(createdChannels.length, countBeforeDispose + 1);
  assert.deepStrictEqual(createdChannels[createdChannels.length - 1].lines, [
    "after dispose",
  ]);
});

test("logger never throws from diagnostic formatting or append", () => {
  const circular = {};
  circular.self = circular;
  assert.doesNotThrow(() => loggerModule.logger.info("circular", circular));

  shouldThrowOnAppend = true;
  assert.doesNotThrow(() => loggerModule.logger.error("append fails"));
  shouldThrowOnAppend = false;
});

console.log("Logger tests passed");
