#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const providerPath = path.join(repoRoot, "src", "userResourcesProvider.ts");
const treeProviderSource = fs.readFileSync(
  path.join(repoRoot, "src", "treeProvider.ts"),
  "utf8",
);
const extensionSource = fs.readFileSync(
  path.join(repoRoot, "src", "extension.ts"),
  "utf8",
);

function requireTypeScriptModule(filePath, stubs) {
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filePath,
  }).outputText;
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
    loadedModule._compile(transpiled, filePath);
  } finally {
    Module._load = originalLoad;
  }
  return loadedModule.exports;
}

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

const vscodeStub = {
  TreeItem,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class ThemeIcon {},
  ThemeColor: class ThemeColor {},
  EventEmitter: class EventEmitter {
    event() {}
    fire() {}
  },
  Uri: { file: (fsPath) => ({ fsPath }) },
  workspace: { getConfiguration: () => ({ get: () => false }) },
};

const providerModule = requireTypeScriptModule(providerPath, {
  vscode: vscodeStub,
  "./skillIndex": {
    getResourceKindIcon: () => "file",
    getResourceKindLabel: (kind) => kind,
  },
  "./userResourceScanner": { scanUserResources: async () => [] },
  "./i18n": { isJapanese: () => false },
  "./resourceKinds": {
    getPluginIdFromPath: (value) => value?.match(/plugins[\\/]([^\\/]+)/i)?.[1],
    getResourceIdentityKeys: () => [],
    isHookConfigFilePath: () => false,
  },
  "./mcpConfigManager": {
    formatMcpLifecycleLabel: () => "",
    formatMcpLifecycleTooltipLines: () => [],
    getMcpConfigLifecycleStatus: async () => ({}),
  },
  "./hookConfigManager": {
    getHookConfigDiagnostics: async () => ({ eventCounts: {} }),
  },
});

const {
  normalizeResourceRootIdentity,
  UserResourceTreeItem,
  UserResourcesProvider,
} = providerModule;

function resource(rootFsPath, overrides = {}) {
  return {
    kind: "skill",
    name: path.basename(rootFsPath),
    description: "",
    source: "remote",
    categories: [],
    relativePath: "skills/demo/SKILL.md",
    remotePath: "skills/demo",
    fullPath: path.join(rootFsPath, "skills", "demo", "SKILL.md"),
    scope: "globalHome",
    scopeLabel: "Global Resource Home",
    tool: "Copilot",
    rootLabel: "Global Resource Home",
    rootFsPath,
    ...overrides,
  };
}

async function main() {
  assert.strictEqual(
    normalizeResourceRootIdentity("C:\\Users\\Demo\\.copilot\\", "win32"),
    normalizeResourceRootIdentity("c:/users/demo/.copilot", "win32"),
  );
  assert.notStrictEqual(
    normalizeResourceRootIdentity("/Home/Demo", "linux"),
    normalizeResourceRootIdentity("/home/demo", "linux"),
  );

  const provider = new UserResourcesProvider(undefined);
  provider.resources = [
    resource("C:\\Users\\Demo\\.copilot"),
    resource("D:\\Portable\\.copilot", { name: "other" }),
  ];
  provider.hasLoaded = true;

  const currentKind = new UserResourceTreeItem(
    "Skills",
    "1 resource",
    1,
    "kind",
    undefined,
    "globalHome",
    "skill",
    "Global Resource Home",
    undefined,
    undefined,
    "c:/users/demo/.copilot/",
  );
  const resolved = await provider.resolveCurrentGroupResources(currentKind);
  assert.deepStrictEqual(
    resolved.map((entry) => entry.rootFsPath),
    ["C:\\Users\\Demo\\.copilot"],
    "same labels must not merge different roots and Windows case must match",
  );

  const staleKind = new UserResourceTreeItem(
    "Skills",
    "stale",
    1,
    "kind",
    undefined,
    "globalHome",
    "skill",
    "Global Resource Home",
    undefined,
    undefined,
    "E:\\Old\\.copilot",
  );
  assert.strictEqual(
    await provider.resolveCurrentGroupResources(staleKind),
    undefined,
  );

  const noIdentity = new UserResourceTreeItem(
    "Skills",
    "legacy",
    1,
    "kind",
    undefined,
    "globalHome",
    "skill",
    "Global Resource Home",
  );
  assert.strictEqual(
    await provider.resolveCurrentGroupResources(noIdentity),
    undefined,
  );

  provider.resources = [
    resource("C:\\Users\\Demo\\.copilot", { isReadOnly: true }),
  ];
  assert.strictEqual(
    await provider.resolveCurrentGroupResources(currentKind),
    undefined,
  );

  assert.match(
    treeProviderSource,
    /if \(!this\.hasLoaded\) \{\s*await this\.loadWorkspaceSkills\(\);\s*this\.hasLoaded = true;\s*\}/,
    "workspace child access must load current resources even before the root row is read",
  );
  assert.match(
    treeProviderSource,
    /"workspaceResourceType"[\s\S]{0,300}?workspaceRootFsPath/,
    "workspace group rows must carry their root identity",
  );

  const groupStart = extensionSource.indexOf(
    "const reinstallResourceGroupCmd = vscode.commands.registerCommand(",
  );
  const groupEnd = extensionSource.indexOf(
    "// Command: Uninstall all skills",
    groupStart,
  );
  const groupBody = extensionSource.slice(groupStart, groupEnd);
  assert.match(groupBody, /workspaceFolders\?\.find\(/);
  assert.match(
    groupBody,
    /const currentGroup = \(await workspaceProvider\.getChildren\(\)\)\.find\(/,
  );
  assert.match(groupBody, /candidate\.resourceKind === item\.resourceKind/);
  assert.match(
    groupBody,
    /normalizeResourceRootIdentity\(candidate\.rootFsPath\)/,
  );
  assert.doesNotMatch(
    groupBody,
    /workspaceProvider\.getChildren\(item\)/,
    "a stale workspace group item must not be used as the current group",
  );

  assert.match(
    extensionSource,
    /userResourcesProvider\.resolveCurrentGroupResources\(\s*item,?\s*\)/,
    "user/global groups must resolve against current provider state",
  );

  console.log("RESULT=PASS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
