const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const os = require("os");
const ts = require("typescript");

function requireTypeScriptModule(filePath) {
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
  loadedModule._compile(transpiled.outputText, filePath);
  return loadedModule.exports;
}

const {
  canExecuteWithoutShell,
  findCodexExecutable,
  findCodexExecutableProbe,
  getExecutableCandidateNames,
} = requireTypeScriptModule(
  path.join(__dirname, "..", "src", "pluginHosts", "executable.ts"),
);

assert.deepStrictEqual(
  getExecutableCandidateNames("claude", { PATHEXT: ".EXE;.CMD;.BAT" }, "win32"),
  ["claude.exe", "claude.cmd", "claude.bat"],
);
assert.deepStrictEqual(
  getExecutableCandidateNames("copilot", {}, "win32", [".exe"]),
  ["copilot.exe"],
);
assert.deepStrictEqual(getExecutableCandidateNames("codex", {}, "linux"), [
  "codex",
]);
assert.strictEqual(
  canExecuteWithoutShell("C:\\Tools\\claude.exe", "win32"),
  true,
);
assert.strictEqual(
  canExecuteWithoutShell("C:\\Tools\\claude.cmd", "win32"),
  false,
);
assert.strictEqual(canExecuteWithoutShell("/usr/bin/claude", "linux"), true);

(async () => {
  assert.strictEqual(
    await findCodexExecutable({ PATH: "" }, "linux"),
    undefined,
  );
  assert.deepStrictEqual(
    await findCodexExecutableProbe({ PATH: "" }, "win32"),
    { aliasMissing: true, reason: "not-found" },
  );

  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "resource-ninja-codex-probe-"),
  );
  try {
    const pathRoot = path.join(fixtureRoot, "path");
    fs.mkdirSync(pathRoot, { recursive: true });
    const pathExecutable = path.join(pathRoot, "codex.exe");
    fs.writeFileSync(pathExecutable, "path");
    assert.deepStrictEqual(
      await findCodexExecutableProbe(
        { PATH: pathRoot, LOCALAPPDATA: fixtureRoot },
        "win32",
        "x64",
      ),
      {
        executablePath: pathExecutable,
        source: "path",
        aliasMissing: false,
        reason: "path",
      },
    );

    fs.rmSync(pathExecutable);
    fs.writeFileSync(path.join(pathRoot, "codex.cmd"), "shim");
    const linksRoot = path.join(fixtureRoot, "Microsoft", "WinGet", "Links");
    fs.mkdirSync(linksRoot, { recursive: true });
    const linkExecutable = path.join(linksRoot, "codex.exe");
    fs.writeFileSync(linkExecutable, "link");
    assert.deepStrictEqual(
      await findCodexExecutableProbe(
        { PATH: pathRoot, LOCALAPPDATA: fixtureRoot },
        "win32",
        "x64",
      ),
      {
        executablePath: linkExecutable,
        source: "winget-link",
        aliasMissing: true,
        reason: "winget-link-not-on-path",
      },
    );

    fs.rmSync(linkExecutable);
    const packagesRoot = path.join(
      fixtureRoot,
      "Microsoft",
      "WinGet",
      "Packages",
    );
    const oldPackage = path.join(
      packagesRoot,
      "OpenAI.Codex_Microsoft.Winget.Source_old",
    );
    const newPackage = path.join(
      packagesRoot,
      "OpenAI.Codex_Microsoft.Winget.Source_new",
    );
    fs.mkdirSync(oldPackage, { recursive: true });
    fs.mkdirSync(newPackage, { recursive: true });
    const oldExecutable = path.join(
      oldPackage,
      "codex-x86_64-pc-windows-msvc.exe",
    );
    const newExecutable = path.join(
      newPackage,
      "codex-aarch64-pc-windows-msvc.exe",
    );
    fs.writeFileSync(oldExecutable, "old");
    fs.writeFileSync(newExecutable, "new");
    fs.writeFileSync(
      path.join(newPackage, "codex-command-runner.exe"),
      "helper",
    );
    fs.writeFileSync(
      path.join(newPackage, "codex-command-runner-x86_64-pc-windows-msvc.exe"),
      "helper-with-triple",
    );
    fs.writeFileSync(
      path.join(
        newPackage,
        "codex-windows-sandbox-setup-x86_64-pc-windows-msvc.exe",
      ),
      "sandbox-helper-with-triple",
    );
    const oldTime = new Date("2026-01-01T00:00:00Z");
    const newTime = new Date("2026-02-01T00:00:00Z");
    fs.utimesSync(oldExecutable, oldTime, oldTime);
    fs.utimesSync(newExecutable, newTime, newTime);
    const packageProbe = await findCodexExecutableProbe(
      { PATH: pathRoot, LOCALAPPDATA: fixtureRoot },
      "win32",
      "x64",
    );
    assert.deepStrictEqual(packageProbe, {
      executablePath: oldExecutable,
      source: "winget-package",
      aliasMissing: true,
      reason: "winget-package-no-link",
    });

    fs.rmSync(oldExecutable);
    fs.rmSync(newExecutable);
    assert.deepStrictEqual(
      await findCodexExecutableProbe(
        { PATH: pathRoot, LOCALAPPDATA: fixtureRoot },
        "win32",
        "x64",
      ),
      {
        aliasMissing: true,
        reason: "unsupported-winget-package",
      },
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
  console.log("RESULT=PASS");
})().catch(() => {
  process.exitCode = 1;
});
