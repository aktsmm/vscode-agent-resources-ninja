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
      esModuleInterop: true,
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

const srcDir = path.join(__dirname, "..", "src", "pluginHosts");
const types = requireTypeScriptModule(path.join(srcDir, "types.ts"));
const {
  ExecutionIntentAuthority,
  MutationExecutor,
  buildSanitizedEnvironment,
} = requireTypeScriptModule(path.join(srcDir, "executionGate.ts"), {
  "./types": types,
});

const executablePath =
  process.platform === "win32" ? "C:\\Tools\\copilot.exe" : "/usr/bin/copilot";
const cwd = process.platform === "win32" ? "C:\\repo" : "/repo";
const targetPath =
  process.platform === "win32"
    ? "C:\\Users\\demo\\.copilot"
    : "/home/demo/.copilot";

function spec(overrides = {}) {
  return {
    hostId: "copilot-cli",
    action: "install",
    scope: "user",
    executablePath,
    executableVersion: "1.0.79",
    cwd,
    argv: ["--no-color", "plugin", "install", "demo@acme"],
    environment: { HOME: targetPath, PATH: "bound-path" },
    resourceIdentity: "acme:plugins/demo:agent-plugins",
    sourceOrigin: "https://github.com/acme/plugins@main",
    resolutionMode: "host-resolved",
    targetPaths: [targetPath],
    ...overrides,
  };
}

(async () => {
  assert.deepStrictEqual(
    buildSanitizedEnvironment(
      { HOME: targetPath, PATH: "bound-path", SECRET_TOKEN: "do-not-pass" },
      ["HOME", "PATH"],
    ),
    { HOME: targetPath, PATH: "bound-path" },
  );

  const authority = new ExecutionIntentAuthority();
  const executor = new MutationExecutor(authority);
  const prepared = authority.prepare(spec());
  await assert.rejects(
    () =>
      executor.execute(
        prepared,
        async () => spec(),
        async () => true,
      ),
    /approved intent/,
  );

  const approved = authority.approve(prepared);
  let observedBeforeOperation = false;
  const result = await executor.execute(
    approved,
    async () => {
      observedBeforeOperation = true;
      return spec();
    },
    async (approvedSpec) => {
      assert.strictEqual(observedBeforeOperation, true);
      assert.deepStrictEqual(approvedSpec.argv, spec().argv);
      return "done";
    },
  );
  assert.strictEqual(result, "done");
  await assert.rejects(
    () =>
      executor.execute(
        approved,
        async () => spec(),
        async () => true,
      ),
    /already been consumed/,
  );

  for (const changed of [
    { argv: ["plugin", "uninstall", "demo@acme"] },
    { cwd: path.dirname(cwd) },
    { executableVersion: "2.0.0" },
    { environment: { HOME: targetPath, PATH: "different" } },
    { targetPaths: [path.dirname(targetPath)] },
  ]) {
    const nextPrepared = authority.prepare(spec());
    const nextApproved = authority.approve(nextPrepared);
    await assert.rejects(
      () =>
        executor.execute(
          nextApproved,
          async () => spec(changed),
          async () => true,
        ),
      /changed after approval/,
    );
  }

  assert.throws(
    () => authority.prepare(spec({ executablePath: "copilot" })),
    /must be absolute/,
  );
  console.log("RESULT=PASS");
})().catch(() => {
  process.exitCode = 1;
});
