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

const srcDir = path.join(__dirname, "..", "src", "pluginHosts");
const repoRoot = path.join(__dirname, "..");
const extensionSource = fs.readFileSync(
  path.join(repoRoot, "src", "extension.ts"),
  "utf8",
);
const stateSource = fs.readFileSync(
  path.join(repoRoot, "src", "pluginHosts", "state.ts"),
  "utf8",
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
);
const types = requireTypeScriptModule(path.join(srcDir, "types.ts"));
const { formatPluginHostState, resolvePluginHostChoices } =
  requireTypeScriptModule(path.join(srcDir, "recommendation.ts"), {
    "./types": types,
  });

const candidates = [
  {
    hostId: "vscode-copilot",
    supportLevel: "native",
    compatible: true,
    detected: true,
    available: true,
  },
  {
    hostId: "copilot-cli",
    supportLevel: "native",
    compatible: true,
    detected: true,
    available: true,
  },
  {
    hostId: "codex",
    supportLevel: "handoff",
    compatible: true,
    detected: true,
    available: true,
  },
];

let choices = resolvePluginHostChoices({ candidates, userDefault: "auto" });
assert.strictEqual(choices[0].hostId, "vscode-copilot");
assert.strictEqual(choices[0].recommended, true);
assert.strictEqual(choices.filter((choice) => choice.recommended).length, 1);

choices = resolvePluginHostChoices({
  candidates,
  userDefault: "copilot-cli",
});
assert.strictEqual(choices[0].hostId, "copilot-cli");
assert.strictEqual(choices[0].configuredByUser, true);
assert.strictEqual(choices[0].recommended, true);

choices = resolvePluginHostChoices({
  candidates,
  userDefault: "ask",
});
assert.strictEqual(
  choices.some((choice) => choice.recommended),
  false,
);

choices = resolvePluginHostChoices({
  candidates,
  userDefault: "auto",
  workspaceSuggestion: "copilot-cli",
});
assert.strictEqual(choices[0].hostId, "vscode-copilot");
assert.strictEqual(
  choices.find((choice) => choice.hostId === "copilot-cli")
    .suggestedByWorkspace,
  true,
);

choices = resolvePluginHostChoices({
  candidates: candidates.map((candidate) =>
    candidate.hostId === "vscode-copilot"
      ? { ...candidate, highRisk: true }
      : candidate,
  ),
  userDefault: "auto",
});
assert.strictEqual(choices[0].hostId, "copilot-cli");
assert.strictEqual(choices[0].recommended, true);
assert.strictEqual(choices[1].hostId, "vscode-copilot");
assert.strictEqual(choices[1].recommended, false);

choices = resolvePluginHostChoices({
  candidates: [
    {
      ...candidates[0],
      state: { hostId: "vscode-copilot", status: "error" },
    },
    candidates[1],
  ],
  userDefault: "auto",
});
assert.strictEqual(choices[0].hostId, "copilot-cli");
assert.strictEqual(choices[0].recommended, true);

choices = resolvePluginHostChoices({
  candidates: [
    { ...candidates[0], detected: false, available: false },
    {
      ...candidates[1],
      state: {
        hostId: "copilot-cli",
        status: "installed",
        enabled: true,
        version: "1.2.3",
      },
    },
  ],
  userDefault: "ask",
});
assert.strictEqual(choices[0].hostId, "copilot-cli");
assert.strictEqual(choices[0].recommended, false);
assert.strictEqual(
  formatPluginHostState(choices[0].state, false),
  "Installed 1.2.3 · Enabled",
);
assert.strictEqual(
  formatPluginHostState(
    { hostId: "codex", status: "installed", enabled: undefined },
    true,
  ),
  "インストール済み",
);
assert.strictEqual(
  formatPluginHostState({ hostId: "codex", status: "not-installed" }, false),
  "Not installed",
);

const pluginHostSetting =
  packageJson.contributes.configuration.properties[
    "resourceNinja.defaultPluginHost"
  ];
assert.strictEqual(pluginHostSetting.default, "auto");
assert.deepStrictEqual(pluginHostSetting.enum, [
  "auto",
  "ask",
  "vscode-copilot",
  "copilot-cli",
  "claude-code",
  "codex",
  "cursor",
]);
assert.match(extensionSource, /cursorCompatible && cursorDetected/);
assert.match(extensionSource, /isCursorEditor\(vscode\.env\.appName/);
const cursorHandoffStart = extensionSource.indexOf(
  "async function installPluginInCursor",
);
const cursorHandoffEnd = extensionSource.indexOf(
  "async function installResource",
  cursorHandoffStart,
);
assert.ok(cursorHandoffStart >= 0 && cursorHandoffEnd > cursorHandoffStart);
const cursorHandoffSource = extensionSource.slice(
  cursorHandoffStart,
  cursorHandoffEnd,
);
assert.match(cursorHandoffSource, /workspace\.fs\.createDirectory/);
assert.match(cursorHandoffSource, /fingerprintDirectory/);
assert.match(cursorHandoffSource, /pluginMutationExecutor\.execute/);
assert.match(
  extensionSource,
  /const userDefault = pluginHostSetting\?\.globalValue \?\? "auto"/,
);
assert.match(
  extensionSource,
  /workspaceSuggestion =\s*pluginHostSetting\?\.workspaceFolderValue \?\?\s*pluginHostSetting\?\.workspaceValue/,
);
assert.doesNotMatch(extensionSource, /picked:\s*choice\.recommended/);
assert.match(
  extensionSource,
  /destination\.value === "copilotCli"\) \{\s*return installPluginInCopilotCli\(skill\)/,
);
assert.match(
  extensionSource,
  /\.\.\.\(claudeCompatible &&[\s\S]*?claudeDetected &&[\s\S]*?stateIdentity/,
);
assert.match(
  extensionSource,
  /\.\.\.\(codexCompatible &&[\s\S]*?codexDetected &&[\s\S]*?stateIdentity/,
);
assert.match(
  extensionSource,
  /supportLevel: claudeNativeExecutable[\s\S]*?"native" as const/,
);
assert.match(
  extensionSource,
  /supportLevel: codexExecutable[\s\S]*?"native" as const/,
);
assert.match(extensionSource, /installClaudeCodePlugin\(/);
assert.match(extensionSource, /installCodexPlugin\(/);
assert.match(extensionSource, /createGatedPluginHostRunner\(/);
assert.match(extensionSource, /CURSOR_PLUGIN_RECEIPTS_KEY/);
assert.match(extensionSource, /async function probeVsCodePluginState/);
assert.match(
  extensionSource,
  /probeVsCodePluginState[\s\S]*?scanLocalSkills[\s\S]*?scanUserResources/,
);
assert.doesNotMatch(
  extensionSource.slice(
    extensionSource.indexOf("async function probeVsCodePluginState"),
    extensionSource.indexOf("async function runPluginHostReadOnly"),
  ),
  /browseProvider\.isSkillInstalled/,
);
assert.match(
  extensionSource,
  /get<boolean>\("plugins\.enabled", true\) !== false/,
);
assert.match(stateSource, /Promise\.allSettled/);
assert.match(stateSource, /withPluginStateTimeout\([\s\S]*?operation\.catch/);
assert.match(stateSource, /Plugin state probe timed out/);
assert.match(stateSource, /operation\.catch\(\(error\)/);
assert.match(extensionSource, /collectPluginHostStates\(probes, 12_000\)/);
assert.match(extensionSource, /formatPluginHostState\(choice\.state/);
assert.match(extensionSource, /const isInstalled = choice\.state\?\.status/);
for (const action of [
  "copilotCliUninstall",
  "claudeCodeManage",
  "codexManage",
  "cursorUninstall",
]) {
  assert.ok(
    extensionSource.includes(action),
    `Missing installed action ${action}`,
  );
}
assert.match(extensionSource, /async function pickInstalledRemotePlugin/);
assert.match(extensionSource, /installedIds\.includes\(pluginId\)/);
assert.match(extensionSource, /resolvedCandidates = await Promise\.allSettled/);
assert.match(
  extensionSource,
  /resolveCopilotCliPluginIdentity\(plugin\),\s*12_000/,
);
assert.match(extensionSource, /state\.installed !== false/);
assert.match(extensionSource, /const vscodeCompatible =/);
assert.match(extensionSource, /\.\.\.\(vscodeCompatible/);
assert.doesNotMatch(extensionSource, /installedNames\.has\(resource\.name\)/);
assert.match(extensionSource, /pluginMarketplaceCache/);
assert.match(extensionSource, /findCodexExecutableProbe\(\)/);
assert.match(extensionSource, /formatCodexExecutableReason/);
assert.match(extensionSource, /Codex CLI fallback:/);
assert.match(extensionSource, /loggedCodexFallbacks/);
assert.match(extensionSource, /function logCodexFallback/);
assert.match(extensionSource, /CODEX_REPAIR_COMMAND/);
assert.match(extensionSource, /resourceNinja\.copyCodexRepairCommand/);
assert.match(extensionSource, /process\.platform !== "win32"/);
assert.match(
  extensionSource,
  /process\.platform === "win32" \? \[repairAction\] : \[\]/,
);
assert.match(extensionSource, /expiresAt: Date\.now\(\) \+ 30_000/);
assert.match(extensionSource, /stateIdentity && copilotCliExecutable/);
assert.match(extensionSource, /stateIdentity \|\| !claudeNativeExecutable/);
assert.match(extensionSource, /stateIdentity \|\| !codexExecutable/);
assert.match(
  extensionSource,
  /manifest\.\$schema === AGENT_PLUGINS_MANIFEST_SCHEMA/,
);
assert.match(
  extensionSource,
  /Skipped chat\.pluginLocations for non-Agent-Plugin package/,
);
assert.match(
  extensionSource,
  /pluginPackageResolved =\s*!!skill\.pluginRoot &&\s*!!skill\.pluginManifestPath/,
);
assert.match(
  extensionSource,
  /incomplete\?: boolean \}\)\.incomplete !== true/,
);
assert.match(extensionSource, /pluginSourceResolved/);
assert.match(extensionSource, /Claude Code marketplace identity unavailable/);
assert.match(
  extensionSource,
  /\.\.\.\(claudeExtensionDetected \? \[openAction\] : \[\]\)/,
);

console.log("RESULT=PASS");
