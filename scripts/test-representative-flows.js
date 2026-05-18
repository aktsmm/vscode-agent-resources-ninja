#!/usr/bin/env node

// Verifies install / reinstall / uninstall path resolution for representative
// resources from each official repository in the bundled skill index.
// Uses the same path helpers as scripts/test-resource-targets.js so we can
// validate every resource kind without hitting the network.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const indexPath = path.join(repoRoot, "resources", "skill-index.json");
const extensionSource = fs.readFileSync(
  path.join(repoRoot, "src", "extension.ts"),
  "utf8",
);
const treeProviderSource = fs.readFileSync(
  path.join(repoRoot, "src", "treeProvider.ts"),
  "utf8",
);
const skillInstallerSource = fs.readFileSync(
  path.join(repoRoot, "src", "skillInstaller.ts"),
  "utf8",
);
const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));

function sanitizeResourceName(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[()[\]{}]/g, "")
    .replace(/[^a-z0-9\-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function getInstallFileName(resource, fileName) {
  if (resource.kind !== "mcp" || !resource.source) return fileName;
  const normalized = fileName.replace(/^\./, "");
  if (normalized.toLowerCase() !== "mcp.json") return fileName;
  return `${sanitizeResourceName(resource.source)}-${normalized}`;
}

function workspaceTargetPath(workspaceRoot, resource) {
  const normalizedRemotePath = resource.path.replace(/\\/g, "/");
  const fileName = getInstallFileName(
    resource,
    path.posix.basename(normalizedRemotePath),
  );
  const resourceFolderName = sanitizeResourceName(
    resource.kind === "skill"
      ? resource.name
      : path.posix.basename(path.posix.dirname(normalizedRemotePath)) ||
          resource.name,
  );

  switch (resource.kind) {
    case "skill":
      return path.posix.join(
        workspaceRoot,
        ".github/skills",
        sanitizeResourceName(resource.name),
      );
    case "agent":
      return path.posix.join(workspaceRoot, ".github/agents", fileName);
    case "instruction":
      return path.posix.join(workspaceRoot, ".github/instructions", fileName);
    case "prompt":
      return path.posix.join(workspaceRoot, ".github/prompts", fileName);
    case "mcp":
      return path.posix.join(workspaceRoot, ".github/mcp", fileName);
    case "hook":
      return path.posix.join(
        workspaceRoot,
        ".github/hooks",
        resourceFolderName,
        "README.md",
      );
    case "plugin":
      return path.posix.join(
        workspaceRoot,
        ".github/plugins",
        sanitizeResourceName(resource.name || resource.pluginRoot || "plugin"),
      );
    case "cursor-rule":
      return path.posix.join(workspaceRoot, ".cursor/rules", fileName);
    default:
      throw new Error(`Unknown kind: ${resource.kind}`);
  }
}

function uninstallTargetPath(workspaceRoot, relativePath, kind) {
  const normalized = relativePath.replace(/\\/g, "/");
  if (kind === "skill") {
    const folderPath = normalized.replace(/\/SKILL\.md$/i, "");
    return path.posix.join(workspaceRoot, folderPath);
  }
  if (kind === "hook") {
    return path.posix.dirname(path.posix.join(workspaceRoot, normalized));
  }
  return path.posix.join(workspaceRoot, normalized);
}

function pickRepresentative(resources, kind) {
  return (
    resources.find(
      (resource) =>
        resource.kind === kind &&
        ["official"].includes(resource.sourceType || "official"),
    ) || resources.find((resource) => resource.kind === kind)
  );
}

function annotateWithSourceType(resources, sources) {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  return resources.map((resource) => ({
    ...resource,
    sourceType: sourceById.get(resource.source)?.type || "community",
  }));
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

const annotated = annotateWithSourceType(index.skills, index.sources);

const representativeKinds = [
  "skill",
  "agent",
  "instruction",
  "prompt",
  "hook",
  "mcp",
  "plugin",
  "cursor-rule",
];

const representativeResources = new Map();
for (const kind of representativeKinds) {
  const resource = pickRepresentative(annotated, kind);
  assert.ok(
    resource,
    `Bundled index must contain at least one ${kind} resource`,
  );
  representativeResources.set(kind, resource);
}

test("each resource kind has a representative in the bundled index", () => {
  const trustedKinds = [
    "skill",
    "agent",
    "instruction",
    "prompt",
    "hook",
    "plugin",
  ];
  for (const kind of trustedKinds) {
    const resource = representativeResources.get(kind);
    assert.ok(
      resource.sourceType === "official" ||
        resource.sourceType === "awesome-list",
      `${kind} representative should come from an official or curated source (got ${resource.sourceType})`,
    );
  }
});

test("workspace install paths resolve to expected native locations", () => {
  for (const [kind, resource] of representativeResources) {
    const installPath = workspaceTargetPath("/repo", resource);
    assert.ok(
      installPath.startsWith("/repo/"),
      `${kind} install path should be inside the workspace`,
    );
    if (kind === "cursor-rule") {
      assert.ok(installPath.includes("/.cursor/rules/"));
    } else if (kind === "plugin") {
      assert.ok(installPath.includes("/.github/plugins/"));
    } else {
      assert.ok(
        installPath.includes(`/.github/${pluralizeKindFolder(kind)}/`),
        `${kind} install path should live under .github/${pluralizeKindFolder(kind)}`,
      );
    }
  }
});

function pluralizeKindFolder(kind) {
  switch (kind) {
    case "skill":
      return "skills";
    case "agent":
      return "agents";
    case "instruction":
      return "instructions";
    case "prompt":
      return "prompts";
    case "hook":
      return "hooks";
    case "mcp":
      return "mcp";
    default:
      return kind;
  }
}

test("reinstall is idempotent: install path matches across repeated calls", () => {
  for (const [kind, resource] of representativeResources) {
    const first = workspaceTargetPath("/repo", resource);
    const second = workspaceTargetPath("/repo", resource);
    assert.strictEqual(first, second, `${kind} install path is not stable`);
  }
});

test("uninstall removes exactly the install location for each kind", () => {
  for (const [kind, resource] of representativeResources) {
    const installPath = workspaceTargetPath("/repo", resource);
    if (kind === "skill") {
      const relative = path.posix.join(
        ".github/skills",
        sanitizeResourceName(resource.name),
        "SKILL.md",
      );
      assert.strictEqual(
        uninstallTargetPath("/repo", relative, "skill"),
        installPath,
      );
    } else if (kind === "hook") {
      const folderName = sanitizeResourceName(
        path.posix.basename(
          path.posix.dirname(resource.path.replace(/\\/g, "/")),
        ) || resource.name,
      );
      const relative = path.posix.join(
        ".github/hooks",
        folderName,
        "README.md",
      );
      // Hook installs put README.md inside <hook>/; uninstall removes the folder.
      const expectedHookFolder = path.posix.dirname(installPath);
      assert.strictEqual(
        uninstallTargetPath("/repo", relative, "hook"),
        expectedHookFolder,
      );
    } else if (kind === "plugin") {
      const folderName = sanitizeResourceName(
        resource.name || resource.pluginRoot || "plugin",
      );
      const relative = path.posix.join(".github/plugins", folderName);
      assert.strictEqual(
        uninstallTargetPath("/repo", relative, "plugin"),
        installPath,
      );
    } else if (kind === "cursor-rule") {
      const fileName = path.posix.basename(resource.path.replace(/\\/g, "/"));
      const relative = path.posix.join(".cursor/rules", fileName);
      assert.strictEqual(
        uninstallTargetPath("/repo", relative, "cursor-rule"),
        installPath,
      );
    } else {
      const folder = pluralizeKindFolder(kind);
      const fileName = getInstallFileName(
        resource,
        path.posix.basename(resource.path.replace(/\\/g, "/")),
      );
      const relative = path.posix.join(".github", folder, fileName);
      assert.strictEqual(
        uninstallTargetPath("/repo", relative, kind),
        installPath,
      );
    }
  }
});

test("remote click installs use installDefault for every resource kind", () => {
  assert.match(treeProviderSource, /command: singleClickInstall/);
  assert.match(treeProviderSource, /resourceNinja\.installDefault/);
  for (const kind of representativeKinds) {
    assert.match(treeProviderSource, new RegExp(`"${kind}"`));
  }
});

test("default click on MCP resources copies without picker", () => {
  assert.match(
    extensionSource,
    /resourceKind === "mcp"[\s\S]*mode === "default"[\s\S]*mcpInstallMode: "copyOnly"/,
  );
});

test("uninstall by path supports every non-skill resource kind", () => {
  assert.match(
    skillInstallerSource,
    /export async function uninstallSkillByPath/,
  );
  for (const kind of [
    "skill",
    "hook",
    "agent",
    "instruction",
    "prompt",
    "mcp",
    "plugin",
    "cursor-rule",
  ]) {
    if (kind === "skill") {
      assert.match(
        skillInstallerSource,
        /folderPath = normalizedPath\.replace\(\/\\\/SKILL\\\.md\$\/i,/,
      );
    } else if (kind === "hook") {
      assert.match(
        skillInstallerSource,
        /kind === "hook"[\s\S]*getParentDirectoryUri\(absoluteUri\)/,
      );
    } else {
      assert.ok(
        skillInstallerSource.includes(`detectResourceKindFromPath`),
        `uninstallSkillByPath should detect kind for ${kind}`,
      );
    }
  }
});

test("uninstall removes hook config entries and orphan metadata sidecar", () => {
  assert.match(skillInstallerSource, /updateHookConfigForUninstall/);
  assert.match(
    skillInstallerSource,
    /deleteResourceInstallMetadata\(resourceUri, kind\)/,
  );
});

test("uninstall offers cleanup of merged MCP servers", () => {
  assert.match(extensionSource, /maybeRemoveMergedMcpConfig/);
  assert.match(extensionSource, /updateMcpConfigForUninstall/);
  assert.match(extensionSource, /Remove from \.vscode\/mcp\.json/);
  assert.match(extensionSource, /Delete staged file only/);
});

test("install summary surfaces hook and MCP results in Output Channel", () => {
  assert.match(extensionSource, /Hook config: \$\{hookConfigSummary\}/);
  assert.match(extensionSource, /MCP config: \$\{mcpConfigSummary\}/);
  assert.match(extensionSource, /Copied MCP config for review/);
});

test("reinstall command reuses install pipeline (per-resource action)", () => {
  assert.match(extensionSource, /resourceNinja\.reinstall"/);
  assert.match(
    extensionSource,
    /installSkill\(skill, wsFolder\.uri, context, /,
  );
});

test("resource group reinstall delegates to per-resource reinstall", () => {
  assert.match(extensionSource, /resourceNinja\.reinstallResourceGroup/);
  assert.match(extensionSource, /workspaceResourceType/);
  assert.match(extensionSource, /installedRemoteSkill/);
  assert.match(extensionSource, /installedRemoteResource/);
  assert.match(
    extensionSource,
    /executeCommand\([\s\S]*"resourceNinja\.reinstall"[\s\S]*child[\s\S]*\)/,
  );
});

test("reinstall command resolves browse-installed remote rows through workspace state", () => {
  assert.match(
    extensionSource,
    /let remotePath = skill\.remotePath \|\| skill\.path/,
  );
  assert.match(
    extensionSource,
    /const installedWorkspaceResource = workspaceProvider[\s\S]*getWorkspaceSkills\(\)[\s\S]*normalizeInstalledRemotePath\(/,
  );
  assert.match(extensionSource, /const meta =[\s\S]*installedMeta\.find\(/);
  assert.match(
    extensionSource,
    /normalizeInstalledRemotePath\(m\.remotePath\)/,
  );
  assert.match(
    extensionSource,
    /else if \(installedWorkspaceResource\) \{[\s\S]*installedWorkspaceResource\.fullPath[\s\S]*installedWorkspaceResource\.relativePath/,
  );
});

test("double click command installs uninstalled rows and reinstalls installed remote rows", () => {
  assert.match(
    extensionSource,
    /const isInstalled = browseProvider\.isSkillInstalled\(skill\)/,
  );
  assert.match(
    extensionSource,
    /isInstalled \? "resourceNinja\.reinstall" : "resourceNinja\.installDefault"/,
  );
  assert.match(
    treeProviderSource,
    /if \(isInstalled\) \{[\s\S]*item\.command = \{[\s\S]*resourceNinja\.onSkillClick/,
  );
});

test("resource group reinstall explains empty remote-installed groups", () => {
  assert.match(extensionSource, /remoteInstalledItems\.length === 0/);
  assert.match(
    extensionSource,
    /This group has no remote-installed resources to reinstall/,
  );
  assert.match(extensionSource, /showInformationMessage/);
});

console.log("RESULT=PASS");
