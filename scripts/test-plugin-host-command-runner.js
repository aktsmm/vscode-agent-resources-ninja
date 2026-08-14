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
const gate = requireTypeScriptModule(path.join(srcDir, "executionGate.ts"), {
  "./types": types,
});
const runnerModule = requireTypeScriptModule(
  path.join(srcDir, "commandRunner.ts"),
  { "./types": types, "./executionGate": gate },
);

const pluginHostSources = [];
function collectTypeScriptFiles(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectTypeScriptFiles(entryPath);
    else if (entry.name.endsWith(".ts")) pluginHostSources.push(entryPath);
  }
}
collectTypeScriptFiles(srcDir);
for (const filePath of pluginHostSources) {
  const source = fs.readFileSync(filePath, "utf8");
  if (path.basename(filePath) === "commandRunner.ts") {
    assert.match(source, /from "child_process"/);
  } else {
    assert.doesNotMatch(source, /from "child_process"/);
  }
}
assert.doesNotMatch(
  fs.readFileSync(
    path.join(__dirname, "..", "src", "copilotCliPlugins.ts"),
    "utf8",
  ),
  /from "child_process"/,
);

const executable =
  process.platform === "win32" ? "C:\\Tools\\claude.exe" : "/usr/bin/claude";
const cwd = process.platform === "win32" ? "C:\\repo" : "/repo";
const calls = [];
const authority = new gate.ExecutionIntentAuthority();
const executor = new gate.MutationExecutor(authority);
const approved = ["plugin", "install", "demo@market", "--scope", "user"];
const readonly = ["plugin", "list", "--json"];
const runner = runnerModule.createApprovedCommandRunner({
  authority,
  executor,
  hostId: "claude-code",
  action: "install",
  scope: "user",
  executablePath: executable,
  executableVersion: "2.1.229",
  cwd,
  environment: { PATH: "bound" },
  resourceIdentity: "demo",
  sourceOrigin: "local-fixture",
  resolutionMode: "host-resolved",
  targetPaths: [cwd],
  readonlyCommands: [readonly],
  mutationCommands: [approved],
  resolveRealPath: async (value) => value,
  readExecutableVersion: async () => "2.1.229",
  runProcess: async (executablePath, args, options) => {
    calls.push({ executablePath, args: [...args], options });
    return { exitCode: 0, stdout: "ok", stderr: "" };
  },
});

(async () => {
  assert.strictEqual((await runner.run(readonly)).exitCode, 0);
  assert.strictEqual((await runner.run(approved)).exitCode, 0);
  assert.match((await runner.run(approved)).error, /not approved/);
  assert.match(
    (await runner.run(["plugin", "uninstall", "demo@market"])).error,
    /not approved/,
  );
  assert.strictEqual(calls.length, 2);

  const swapped = runnerModule.createApprovedCommandRunner({
    authority,
    executor,
    hostId: "claude-code",
    action: "install",
    scope: "user",
    executablePath: executable,
    executableVersion: "2.1.229",
    cwd,
    environment: { PATH: "bound" },
    resourceIdentity: "demo",
    sourceOrigin: "local-fixture",
    resolutionMode: "host-resolved",
    targetPaths: [cwd],
    readonlyCommands: [],
    mutationCommands: [approved],
    resolveRealPath: async () => `${executable}.replaced`,
    readExecutableVersion: async () => "2.1.229",
    runProcess: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });
  assert.match((await swapped.run(approved)).error, /changed after approval/);

  const versionChanged = runnerModule.createApprovedCommandRunner({
    authority,
    executor,
    hostId: "claude-code",
    action: "install",
    scope: "user",
    executablePath: executable,
    executableVersion: "2.1.229",
    cwd,
    environment: { PATH: "bound" },
    resourceIdentity: "demo",
    sourceOrigin: "local-fixture",
    resolutionMode: "host-resolved",
    targetPaths: [cwd],
    readonlyCommands: [],
    mutationCommands: [approved],
    resolveRealPath: async (value) => value,
    readExecutableVersion: async () => "2.1.230",
    runProcess: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  });
  assert.match(
    (await versionChanged.run(approved)).error,
    /changed after approval/,
  );
  console.log("RESULT=PASS");
})().catch(() => {
  process.exitCode = 1;
});
