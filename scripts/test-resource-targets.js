#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

// Load the shipped rule instead of copying it; the local copy had already lost
// the metadata-sidecar exclusion that src applies.
function requireTypeScriptModule(filePath) {
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
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
  getPluginOwnedHookInstallFileName,
  getPluginOwnedInstallFileName,
  isHookConfigFilePath,
  getPluginRootFsPathFromManifestPath,
  sanitizeResourceInstallName,
} = requireTypeScriptModule(
  path.join(__dirname, "..", "src", "resourceKinds.ts"),
);

const extensionSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "extension.ts"),
  "utf8",
);

const skillInstallerSource = fs.readFileSync(
  path.join(__dirname, "..", "src", "skillInstaller.ts"),
  "utf8",
);

function globalHomeRoot(config = {}) {
  if (config.globalHomeDirectory) return config.globalHomeDirectory;
  if (config.globalResourceHomePreset === "claude") return "~/.claude";
  if (config.globalResourceHomePreset === "agents") return "~/.agents";
  return "~/.copilot";
}

function getInstallFileName(skill, fileName) {
  const pluginHookFileName = getPluginOwnedHookInstallFileName({
    kind: skill.kind,
    source: skill.source,
    pluginRoot: skill.pluginRoot,
    resourcePath: skill.path,
    fileName,
  });
  if (pluginHookFileName !== fileName) return pluginHookFileName;
  const pluginOwnedFileName = getPluginOwnedInstallFileName({
    kind: skill.kind,
    pluginRoot: skill.pluginRoot,
    fileName,
  });
  if (pluginOwnedFileName !== fileName) return pluginOwnedFileName;
  if (skill.kind !== "mcp" || !skill.source) return fileName;
  const normalizedFileName = fileName.replace(/^\./, "");
  if (normalizedFileName.toLowerCase() !== "mcp.json") return fileName;
  return `${sanitizeResourceInstallName(skill.source)}-${normalizedFileName}`;
}

function getPluginInstallRootName(skill) {
  return sanitizeResourceInstallName(
    skill.name || skill.pluginRoot || "plugin",
  );
}

function targetPath(
  workspaceRoot,
  skill,
  targetScope = "workspace",
  customRoot,
  config = {},
) {
  const normalizedRemotePath = skill.path.replace(/\\/g, "/");
  const fileName = getInstallFileName(
    skill,
    path.posix.basename(normalizedRemotePath),
  );
  const isHookConfigFile =
    skill.kind === "hook" && isHookConfigFilePath(normalizedRemotePath);
  const resourceFolderName = sanitizeResourceInstallName(
    skill.kind === "skill"
      ? skill.name
      : path.posix.basename(path.posix.dirname(normalizedRemotePath)) ||
          skill.name,
  );

  if (skill.kind === "plugin") {
    const pluginFolderName = getPluginInstallRootName(skill);
    if (targetScope === "custom")
      return path.posix.join(customRoot, pluginFolderName);
    if (targetScope === "globalHome" || targetScope === "userData") {
      return path.posix.join(
        globalHomeRoot(config),
        "plugins",
        pluginFolderName,
      );
    }
    return path.posix.join(workspaceRoot, ".github/plugins", pluginFolderName);
  }

  if (skill.kind === "cursor-rule") {
    if (targetScope === "custom") return path.posix.join(customRoot, fileName);
    if (targetScope === "globalHome" || targetScope === "userData") {
      return path.posix.join(globalHomeRoot(config), "rules", fileName);
    }
    return path.posix.join(workspaceRoot, ".cursor/rules", fileName);
  }

  if (targetScope === "custom") {
    if (skill.kind === "skill") {
      return path.posix.join(
        customRoot,
        sanitizeResourceInstallName(skill.name),
      );
    }
    if (skill.kind === "hook") {
      if (isHookConfigFile) {
        return path.posix.join(customRoot, fileName);
      }
      return path.posix.join(customRoot, resourceFolderName, "README.md");
    }
    return path.posix.join(customRoot, fileName);
  }

  if (targetScope === "globalHome") {
    const root = globalHomeRoot(config);
    if (skill.kind === "skill")
      return path.posix.join(
        root,
        "skills",
        sanitizeResourceInstallName(skill.name),
      );
    if (skill.kind === "agent")
      return path.posix.join(root, "agents", fileName);
    if (skill.kind === "instruction")
      return path.posix.join(root, "instructions", fileName);
    if (skill.kind === "prompt")
      return path.posix.join(root, "prompts", fileName);
    if (skill.kind === "mcp") return path.posix.join(root, "mcp", fileName);
    if (isHookConfigFile) return path.posix.join(root, "hooks", fileName);
    return path.posix.join(root, "hooks", resourceFolderName, "README.md");
  }

  if (targetScope === "userData") {
    const globalRoot = globalHomeRoot(config);
    if (skill.kind === "skill")
      return path.posix.join(
        globalRoot,
        "skills",
        sanitizeResourceInstallName(skill.name),
      );
    if (skill.kind === "hook") {
      if (isHookConfigFile)
        return path.posix.join(globalRoot, "hooks", fileName);
      return path.posix.join(
        globalRoot,
        "hooks",
        resourceFolderName,
        "README.md",
      );
    }
    if (skill.kind === "agent")
      return path.posix.join(
        config.userAgentsDirectory ||
          config.userPromptsDirectory ||
          "<VSCodeUser>/prompts",
        fileName,
      );
    if (skill.kind === "instruction")
      return path.posix.join(
        config.userInstructionsDirectory || "<VSCodeUser>/instructions",
        fileName,
      );
    if (skill.kind === "mcp")
      return path.posix.join(globalRoot, "mcp", fileName);
    return path.posix.join(
      config.userPromptsDirectory || "<VSCodeUser>/prompts",
      fileName,
    );
  }

  if (skill.kind === "skill") {
    return path.posix.join(
      workspaceRoot,
      ".github/skills",
      sanitizeResourceInstallName(skill.name),
    );
  }
  if (skill.kind === "agent")
    return path.posix.join(
      workspaceRoot,
      config.workspaceAgentsDirectory || ".github/agents",
      fileName,
    );
  if (skill.kind === "instruction")
    return path.posix.join(
      workspaceRoot,
      config.workspaceInstructionsDirectory || ".github/instructions",
      fileName,
    );
  if (skill.kind === "prompt")
    return path.posix.join(
      workspaceRoot,
      config.workspacePromptsDirectory || ".github/prompts",
      fileName,
    );
  if (skill.kind === "mcp")
    return path.posix.join(
      workspaceRoot,
      config.workspaceMcpDirectory || ".github/mcp",
      fileName,
    );
  if (isHookConfigFile) {
    return path.posix.join(
      workspaceRoot,
      config.workspaceHooksDirectory || ".github/hooks",
      fileName,
    );
  }
  return path.posix.join(
    workspaceRoot,
    config.workspaceHooksDirectory || ".github/hooks",
    resourceFolderName,
    "README.md",
  );
}

function uninstallTargetPath(workspaceRoot, configuredSkillsDir, relativePath) {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  const isAbsolute = path.isAbsolute(relativePath);
  const isSkill =
    normalizedPath.toLowerCase() === "skill.md" ||
    normalizedPath.toLowerCase().endsWith("/skill.md");
  const isHook = /^(.+\/)?hooks\/[^/]+\/readme\.md$/i.test(normalizedPath);
  const isHookConfigFile = isHookConfigFilePath(normalizedPath);

  if (isAbsolute) {
    if (isSkill || isHook) {
      return path.posix.dirname(normalizedPath);
    }
    return normalizedPath;
  }

  if (isHookConfigFile) {
    return path.posix.join(workspaceRoot, normalizedPath);
  }

  if (isSkill) {
    const folderPath = normalizedPath.replace(/\/SKILL\.md$/i, "");
    const skillsRoot = configuredSkillsDir.replace(/^\/+|\/+$/g, "");
    if (folderPath === skillsRoot || folderPath.startsWith(`${skillsRoot}/`)) {
      return path.posix.join(workspaceRoot, folderPath);
    }
    return path.posix.join(workspaceRoot, skillsRoot, folderPath);
  }

  if (isHook) {
    return path.posix.dirname(path.posix.join(workspaceRoot, normalizedPath));
  }

  return path.posix.join(workspaceRoot, normalizedPath);
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

test("workspace targets are resource-kind aware", () => {
  assert.strictEqual(
    targetPath("/repo", {
      kind: "skill",
      name: "Code Tour",
      path: "skills/code-tour/SKILL.md",
    }),
    "/repo/.github/skills/code-tour",
  );
  assert.strictEqual(
    targetPath("/repo", {
      kind: "agent",
      name: "Planner",
      path: "agents/planner.agent.md",
    }),
    "/repo/.github/agents/planner.agent.md",
  );
  assert.strictEqual(
    targetPath("/repo", {
      kind: "agent",
      name: "Code Reviewer",
      path: "plugins/prp-core/agents/code-reviewer.md",
      pluginRoot: "plugins/prp-core",
    }),
    "/repo/.github/agents/prp-core-code-reviewer.md",
  );
  assert.strictEqual(
    targetPath("/repo", {
      kind: "instruction",
      name: "TS",
      path: "instructions/typescript.instructions.md",
    }),
    "/repo/.github/instructions/typescript.instructions.md",
  );
  assert.strictEqual(
    targetPath("/repo", {
      kind: "prompt",
      name: "Review",
      path: "prompts/review.prompt.md",
    }),
    "/repo/.github/prompts/review.prompt.md",
  );
  assert.strictEqual(
    targetPath("/repo", {
      kind: "hook",
      name: "Pre Review",
      path: "hooks/pre-review/README.md",
    }),
    "/repo/.github/hooks/pre-review/README.md",
  );
  assert.strictEqual(
    targetPath("/repo", {
      kind: "hook",
      name: "CLI Policy",
      path: ".github/hooks/copilot-cli-policy.json",
    }),
    "/repo/.github/hooks/copilot-cli-policy.json",
  );
  assert.strictEqual(
    targetPath("/repo", {
      kind: "hook",
      name: "Build Perf Hooks",
      source: "github-copilot-plugins",
      path: "plugins/build-perf-cpp/hooks/hooks.json",
      pluginRoot: "plugins/build-perf-cpp",
    }),
    "/repo/.github/hooks/build-perf-cpp-hooks.json",
  );
  assert.strictEqual(
    targetPath("/repo", {
      kind: "hook",
      name: "Root Hooks",
      source: "compound-engineering",
      path: "hooks.json",
      pluginRoot: ".",
    }),
    "/repo/.github/hooks/compound-engineering-hooks.json",
  );
  assert.strictEqual(
    targetPath("/repo", {
      kind: "mcp",
      name: "GitHub MCP",
      path: ".vscode/mcp.json",
    }),
    "/repo/.github/mcp/mcp.json",
  );
  assert.strictEqual(
    targetPath("/repo", {
      kind: "plugin",
      name: "Create Plugin",
      path: "create-plugin",
      pluginRoot: "create-plugin",
    }),
    "/repo/.github/plugins/create-plugin",
  );
  assert.strictEqual(
    targetPath("/repo", {
      kind: "cursor-rule",
      name: "Plugin Quality Gates",
      path: "create-plugin/rules/plugin-quality-gates.mdc",
    }),
    "/repo/.cursor/rules/plugin-quality-gates.mdc",
  );
});

test("global and user targets preserve native conventions", () => {
  assert.strictEqual(
    targetPath(
      "/repo",
      { kind: "agent", name: "Planner", path: "agents/planner.agent.md" },
      "globalHome",
    ),
    "~/.copilot/agents/planner.agent.md",
  );
  assert.strictEqual(
    targetPath(
      "/repo",
      {
        kind: "hook",
        name: "CLI Policy",
        path: ".github/hooks/copilot-cli-policy.json",
      },
      "globalHome",
    ),
    "~/.copilot/hooks/copilot-cli-policy.json",
  );
  assert.strictEqual(
    targetPath(
      "/repo",
      { kind: "prompt", name: "Review", path: "prompts/review.prompt.md" },
      "userData",
    ),
    "<VSCodeUser>/prompts/review.prompt.md",
  );
  assert.strictEqual(
    targetPath(
      "/repo",
      { kind: "agent", name: "Planner", path: "agents/planner.agent.md" },
      "userData",
    ),
    "<VSCodeUser>/prompts/planner.agent.md",
  );
  assert.strictEqual(
    targetPath(
      "/repo",
      {
        kind: "plugin",
        name: "Cursor Team Kit",
        path: "cursor-team-kit",
      },
      "globalHome",
    ),
    "~/.copilot/plugins/cursor-team-kit",
  );
  assert.strictEqual(
    targetPath(
      "/repo",
      {
        kind: "cursor-rule",
        name: "Exhaustive Switch",
        path: "cursor-team-kit/rules/typescript-exhaustive-switch.mdc",
      },
      "userData",
    ),
    "~/.copilot/rules/typescript-exhaustive-switch.mdc",
  );
  assert.strictEqual(
    targetPath(
      "/repo",
      { kind: "agent", name: "Planner", path: "agents/planner.agent.md" },
      "userData",
      undefined,
      { userAgentsDirectory: "~/custom-agents" },
    ),
    "~/custom-agents/planner.agent.md",
  );
  assert.strictEqual(
    targetPath(
      "/repo",
      {
        kind: "instruction",
        name: "TypeScript",
        path: "instructions/typescript.instructions.md",
      },
      "userData",
    ),
    "<VSCodeUser>/instructions/typescript.instructions.md",
  );
  assert.strictEqual(
    targetPath(
      "/repo",
      { kind: "hook", name: "Pre Review", path: "hooks/pre-review/README.md" },
      "userData",
    ),
    "~/.copilot/hooks/pre-review/README.md",
  );
  assert.strictEqual(
    targetPath(
      "/repo",
      {
        kind: "hook",
        name: "CLI Policy",
        path: "hooks/copilot-cli-policy.json",
      },
      "userData",
    ),
    "~/.copilot/hooks/copilot-cli-policy.json",
  );
  assert.strictEqual(
    targetPath(
      "/repo",
      { kind: "mcp", name: "GitHub MCP", path: "mcp/github.json" },
      "userData",
    ),
    "~/.copilot/mcp/github.json",
  );
});

test("configured roots override default non-skill targets", () => {
  assert.strictEqual(
    targetPath(
      "/repo",
      { kind: "agent", name: "Planner", path: "agents/planner.agent.md" },
      "workspace",
      undefined,
      { workspaceAgentsDirectory: ".config/agents" },
    ),
    "/repo/.config/agents/planner.agent.md",
  );
  assert.strictEqual(
    targetPath(
      "/repo",
      {
        kind: "instruction",
        name: "Release",
        path: "instructions/release.instructions.md",
      },
      "workspace",
      undefined,
      { workspaceInstructionsDirectory: ".rules/instructions" },
    ),
    "/repo/.rules/instructions/release.instructions.md",
  );
  assert.strictEqual(
    targetPath(
      "/repo",
      { kind: "prompt", name: "Review", path: "prompts/review.prompt.md" },
      "userData",
      undefined,
      { userPromptsDirectory: "~/custom-prompts" },
    ),
    "~/custom-prompts/review.prompt.md",
  );
  assert.strictEqual(
    targetPath(
      "/repo",
      { kind: "hook", name: "Pre Review", path: "hooks/pre-review/README.md" },
      "globalHome",
      undefined,
      { globalHomeDirectory: "~/claude-resources" },
    ),
    "~/claude-resources/hooks/pre-review/README.md",
  );
  assert.strictEqual(
    targetPath(
      "/repo",
      { kind: "skill", name: "Review PR", path: "skills/review-pr" },
      "globalHome",
      undefined,
      { globalResourceHomePreset: "claude" },
    ),
    "~/.claude/skills/review-pr",
  );
  assert.strictEqual(
    targetPath(
      "/repo",
      { kind: "agent", name: "Planner", path: "agents/planner.agent.md" },
      "globalHome",
      undefined,
      { globalResourceHomePreset: "agents" },
    ),
    "~/.agents/agents/planner.agent.md",
  );
  assert.strictEqual(
    targetPath(
      "/repo",
      { kind: "mcp", name: "GitHub MCP", path: "mcp/github.json" },
      "userData",
      undefined,
      { globalHomeDirectory: "~/custom-home" },
    ),
    "~/custom-home/mcp/github.json",
  );
});

test("custom targets keep skills and hooks directory-shaped", () => {
  assert.strictEqual(
    targetPath(
      "/repo",
      { kind: "skill", name: "Code Tour", path: "skills/code-tour/SKILL.md" },
      "custom",
      "/custom",
    ),
    "/custom/code-tour",
  );
  assert.strictEqual(
    targetPath(
      "/repo",
      { kind: "hook", name: "Pre Review", path: "hooks/pre-review/README.md" },
      "custom",
      "/custom",
    ),
    "/custom/pre-review/README.md",
  );
  assert.strictEqual(
    targetPath(
      "/repo",
      { kind: "mcp", name: "GitHub MCP", path: "mcp/github.json" },
      "custom",
      "/custom",
    ),
    "/custom/github.json",
  );
});

test("generic MCP config file names are source-prefixed to avoid collisions", () => {
  assert.strictEqual(
    targetPath("/repo", {
      kind: "mcp",
      name: "azure",
      source: "microsoft-azure-skills",
      path: ".mcp.json",
    }),
    "/repo/.github/mcp/microsoft-azure-skills-mcp.json",
  );
  assert.strictEqual(
    targetPath(
      "/repo",
      {
        kind: "mcp",
        name: "Plugin MCP",
        source: "aws-agent-plugins",
        path: "plugins/aws/mcp.json",
      },
      "globalHome",
    ),
    "~/.copilot/mcp/aws-agent-plugins-mcp.json",
  );
  assert.strictEqual(
    targetPath(
      "/repo",
      {
        kind: "mcp",
        name: "GitHub MCP",
        source: "github-awesome-copilot",
        path: "mcp/github.json",
      },
      "globalHome",
    ),
    "~/.copilot/mcp/github.json",
  );
});

test("uninstall by path avoids duplicating configured skills directory", () => {
  assert.strictEqual(
    uninstallTargetPath(
      "/repo",
      ".github/skills",
      ".github/skills/code-tour/SKILL.md",
    ),
    "/repo/.github/skills/code-tour",
  );
  assert.strictEqual(
    uninstallTargetPath("/repo", ".github/skills", "nested/code-tour/SKILL.md"),
    "/repo/.github/skills/nested/code-tour",
  );
  assert.strictEqual(
    uninstallTargetPath(
      "/repo",
      ".github/skills",
      ".github/agents/planner.agent.md",
    ),
    "/repo/.github/agents/planner.agent.md",
  );
  assert.strictEqual(
    uninstallTargetPath(
      "/repo",
      ".github/skills",
      ".github/hooks/pre-review/README.md",
    ),
    "/repo/.github/hooks/pre-review",
  );
  assert.strictEqual(
    uninstallTargetPath(
      "/repo",
      ".github/skills",
      ".github/hooks/copilot-cli-policy.json",
    ),
    "/repo/.github/hooks/copilot-cli-policy.json",
  );
  assert.strictEqual(
    uninstallTargetPath(
      "/repo",
      ".github/skills",
      "/external/agents/planner.agent.md",
    ),
    "/external/agents/planner.agent.md",
  );
  assert.strictEqual(
    uninstallTargetPath(
      "/repo",
      ".github/skills",
      "/external/hooks/pre-review/README.md",
    ),
    "/external/hooks/pre-review",
  );
  assert.strictEqual(
    uninstallTargetPath(
      "/repo",
      ".github/skills",
      "/external/hooks/copilot-cli-policy.json",
    ),
    "/external/hooks/copilot-cli-policy.json",
  );
});

// The copy this file used to carry had lost this exclusion, so pin it directly.
test("hook config detection excludes resource metadata sidecars", () => {
  test("hook deletion shares the file-backed metadata path rule", () => {
    assert.match(
      extensionSource,
      /kind === "hook" && !isFileBackedHookResourcePath\(fullPath\)/,
    );
    assert.match(
      extensionSource,
      /resource\.kind === "hook" &&\s*!isFileBackedHookResourcePath\(resource\.fullPath\)/,
    );
  });
  assert.strictEqual(
    isHookConfigFilePath("hooks/copilot-cli-policy.json"),
    true,
  );
  assert.strictEqual(
    isHookConfigFilePath(".github/hooks/copilot-cli-policy.json"),
    true,
  );
  assert.strictEqual(
    isHookConfigFilePath("hooks/pre-review/.resource-ninja.json"),
    false,
  );
  assert.strictEqual(
    isHookConfigFilePath("hooks/pre-review.resource-ninja.json"),
    false,
  );
});

test("plugin resources migrate only owned legacy files", () => {
  assert.match(
    skillInstallerSource,
    /resourceKind === "hook" && !isHookConfigFile[\s\S]*?downloadDirectory/,
  );
  assert.match(
    skillInstallerSource,
    /isHookConfigFile[\s\S]*?fetchFileContent[\s\S]*?writeFile\(\s*skillPath/,
  );
  assert.match(
    skillInstallerSource,
    /resourceKind === "hook" && !isHookConfigFilePath\(remotePath\)[\s\S]*?updateHookConfigForInstall/,
  );
  assert.match(skillInstallerSource, /removeOwnedLegacyPluginResource/);
  assert.match(
    skillInstallerSource,
    /metadata\.kind !== kind[\s\S]*?metadata\.source !==[\s\S]*?normalizeSkillMetaSource[\s\S]*?metadata\.remotePath !== skill\.path[\s\S]*?metadata\.pluginRoot !== skill\.pluginRoot/,
  );
});

// A plugin is scanned by its manifest, so a delete that stops at the manifest would
// leave the copied package behind as an orphaned directory.
test("plugin manifests resolve to the plugin root directory", () => {
  const pluginRoot = "/repo/.github/plugins/demo";
  for (const manifest of [
    "plugin.json",
    ".claude-plugin/plugin.json",
    ".codex-plugin/plugin.json",
    ".cursor-plugin/plugin.json",
    ".plugin/plugin.json",
    ".github/plugin/plugin.json",
    ".github/plugin/marketplace.json",
    ".claude-plugin/marketplace.json",
    "gemini-extension.json",
    "apm.yml",
    "apm.yaml",
  ]) {
    assert.strictEqual(
      getPluginRootFsPathFromManifestPath(`${pluginRoot}/${manifest}`),
      pluginRoot,
      `expected ${manifest} to resolve to ${pluginRoot}`,
    );
  }
});

test("plugin root resolution keeps Windows separators and the drive prefix", () => {
  assert.strictEqual(
    getPluginRootFsPathFromManifestPath(
      "D:\\repo\\.github\\plugins\\demo\\plugin.json",
    ),
    "D:\\repo\\.github\\plugins\\demo",
  );
  assert.strictEqual(
    getPluginRootFsPathFromManifestPath(
      "D:\\repo\\.github\\plugins\\demo\\.claude-plugin\\plugin.json",
    ),
    "D:\\repo\\.github\\plugins\\demo",
  );
  assert.strictEqual(
    getPluginRootFsPathFromManifestPath(
      "D:\\repo\\.github\\plugins\\demo\\.github\\plugin\\plugin.json",
    ),
    "D:\\repo\\.github\\plugins\\demo",
  );
});

test("non-manifest paths are not treated as plugin manifests", () => {
  for (const notAManifest of [
    "/repo/.github/plugins/demo/README.md",
    "/repo/.github/plugins/demo/agents/planner.agent.md",
    "/repo/.github/skills/demo/SKILL.md",
    "/repo/.github/plugins/demo/marketplace.json",
    "/repo/.github/plugins/demo/plugin.json.bak",
    // Nothing above the manifest means there is no plugin root to remove.
    "/plugin.json",
    "plugin.json",
    // `D:` is drive-RELATIVE on Windows: path.resolve would expand it to that
    // drive's current directory, so a recursive delete must never receive it.
    "D:\\plugin.json",
    "D:/plugin.json",
    "D:\\.claude-plugin\\plugin.json",
    // A filesystem root or a bare UNC share is never one plugin's folder.
    "//server/share/plugin.json",
    "\\\\server\\share\\plugin.json",
    // A relative path resolves against the process working directory, not the
    // install location, so it must never reach a recursive delete.
    "demo/plugin.json",
    "./demo/plugin.json",
  ]) {
    assert.strictEqual(
      getPluginRootFsPathFromManifestPath(notAManifest),
      undefined,
      `expected ${notAManifest} to resolve to undefined`,
    );
  }
});

test("deleteInstalledResourceByPath removes the plugin root recursively", () => {
  const startIndex = extensionSource.indexOf(
    "async function deleteInstalledResourceByPath(",
  );
  assert.ok(startIndex !== -1, "deleteInstalledResourceByPath not found");
  const body = extensionSource.slice(startIndex, startIndex + 2000);

  const resolutionIndex = body.indexOf("getPluginRootFsPathFromManifestPath(");
  // Containment alone would accept the allowed root itself as the target, which
  // a recursive delete would then wipe, so the stricter check is pinned here.
  const guardIndex = body.indexOf("isDeletableWithin(allowedRootFsPath");
  const deleteIndex = body.indexOf("vscode.workspace.fs.delete(targetUri");
  assert.ok(resolutionIndex !== -1, "plugin root is never resolved");
  assert.ok(
    guardIndex !== -1,
    "the delete must refuse a target equal to the allowed root, not only one outside it",
  );
  assert.ok(deleteIndex !== -1, "delete call is missing");

  // Deleting a directory is more dangerous than deleting a file, so the guard has
  // to see the resolved root rather than the manifest it came from.
  assert.ok(
    resolutionIndex < guardIndex && guardIndex < deleteIndex,
    "containment check must run after root resolution and before the delete",
  );
  assert.ok(
    /recursive:\s*isDirectoryTarget/.test(body),
    "plugin delete must be recursive",
  );
  assert.ok(
    /isDirectoryTarget\s*=[^;]*pluginRootFsPath !== undefined/.test(body),
    "a resolved plugin root must count as a directory target",
  );
  assert.ok(
    /targetUri\s*=\s*vscode\.Uri\.file\(\s*pluginRootFsPath \?\?/.test(body),
    "the delete target must be the resolved plugin root",
  );
  assert.ok(
    /if \(!isDirectoryTarget\) \{/.test(body),
    "sidecar delete must be skipped once the whole directory is removed",
  );
});

test("a plugin reinstall unregisters where it was and registers where it lands", () => {
  // A user-resource directory is an arbitrary configured path, but a plugin's
  // install target is fixed to the Global Home `plugins` directory for both
  // globalHome and userData, so a reinstall can move the folder.
  const pluginBranch = skillInstallerSource.slice(
    skillInstallerSource.indexOf('if (kind === "plugin") {'),
    skillInstallerSource.indexOf('if (kind === "cursor-rule") {'),
  );
  assert.ok(pluginBranch, "plugin branch of getResourceTargetUri not found");
  assert.match(
    pluginBranch,
    /targetScope === "globalHome" \|\| targetScope === "userData"[\s\S]*?joinPath\(root, "plugins", pluginFolderName\)/,
    "a userData plugin must install into the same fixed Global Home plugins directory as globalHome",
  );

  // The removal keys off the folder it actually deleted, which is the old
  // location, so the stale entry goes even when the reinstall lands elsewhere.
  const deleteStart = extensionSource.indexOf(
    "async function deleteInstalledResourceByPath(",
  );
  const deleteBody = extensionSource.slice(
    deleteStart,
    extensionSource.indexOf(
      "async function offerPluginLocationRegistration(",
      deleteStart,
    ),
  );
  assert.match(
    deleteBody,
    /unregisterPluginLocations\(\s*\[targetUri\.fsPath\],\s*path\.basename\(pluginRootFsPath\),?\s*\)/,
    "the shared delete helper must unregister the folder it removed",
  );

  const entryPoints = [
    [
      "reinstallUserResourceCmd",
      "const reinstallUserResourceCmd = vscode.commands.registerCommand(",
      "const reinstallUserResourceGroupCmd = vscode.commands.registerCommand(",
      "const installOptions = { targetScope, suppressRecoveryPrompt };",
    ],
    [
      "reinstallCmd",
      "const reinstallCmd = vscode.commands.registerCommand(",
      "const reinstallResourceGroupCmd = vscode.commands.registerCommand(",
      "const installOptions = { suppressRecoveryPrompt };",
    ],
  ];

  for (const [
    label,
    startMarker,
    endMarker,
    optionsDeclaration,
  ] of entryPoints) {
    const start = extensionSource.indexOf(startMarker);
    assert.ok(start !== -1, `${label} not found`);
    const body = extensionSource.slice(
      start,
      extensionSource.indexOf(endMarker, start),
    );
    assert.ok(
      body.includes(optionsDeclaration),
      `${label} must pin one install options object`,
    );
    // The registration target is whatever the install reported writing to. A
    // destination computed before the install goes stale the moment a setting
    // changes while the progress notification is up, and would register a folder
    // that was never created.
    assert.match(
      body,
      /installResult = await installSkill\(\s*fullSkill,\s*wsFolder\.uri,\s*context,\s*installOptions,?\s*\)/,
      `${label} must capture what the install reported`,
    );
    assert.match(
      body,
      /installResult &&\s*installWasClean\(installResult\)\s*\)\s*\{\s*await offerPluginLocationRegistration\(\[installResult\.destinationUri\]\)/,
      `${label} must re-register the destination the install reported, through the normal install path`,
    );
    assert.ok(
      !/getResourceTargetUri\(/.test(body),
      `${label} must not register a destination it computed itself`,
    );
    // A thrown install leaves the capture unset, so the registration must be
    // reachable only once there is a result.
    assert.match(
      body,
      /let installResult:[^;]*\|\s*undefined;/,
      `${label} must leave the capture unset until the install succeeds`,
    );
    // An install that could not download every file leaves a partial folder;
    // it must not be registered, and the caller must report it as a failure so
    // the group reinstall does not count it as a success.
    assert.match(
      body,
      /if \(!installWasClean\(installResult\)\) \{[\s\S]{0,400}?return false;/,
      `${label} must report an install that was not clean as a failure`,
    );
  }
});

// The batch install runs many installs under one progress notification, so the
// configuration it reads can change between iterations.
test("the batch install registers what each install reported, and only when clean", () => {
  const start = extensionSource.indexOf(
    "const installBundleCmd = vscode.commands.registerCommand(",
  );
  assert.ok(start !== -1, "installBundleCmd not found");
  const body = extensionSource.slice(
    start,
    extensionSource.indexOf(
      "const installPluginResourcesCmd = vscode.commands.registerCommand(",
      start,
    ),
  );

  assert.match(
    body,
    /const installResult = await installSkill\(/,
    "the batch must capture what each install reported",
  );
  assert.match(
    body,
    /if \(installWasClean\(installResult\)\) \{\s*installedPluginUris\.push\(installResult\.destinationUri\);/,
    "the batch must register the destination the install reported",
  );
  assert.ok(
    !/getResourceTargetUri\(/.test(body),
    "the batch must not recompute a destination after the install await",
  );
  // The per-install warning is suppressed in a batch, so an unclean install has
  // to reach the user through the batch failure summary instead.
  assert.match(
    body,
    /\} else \{\s*failed\+\+;\s*failedResources\.push\(skill\.name\);\s*\}/,
    "an install that was not clean must be counted with the batch failures",
  );
  assert.match(body, /cancellable:\s*true/);
  assert.match(body, /async \(progress, token\)/);
  assert.match(body, /if \(token\.isCancellationRequested\)/);
  assert.match(
    body,
    /completed - failed\}\/\$\{\s*completed/,
    "a partial batch summary must use the processed count as its denominator",
  );
});

test("batch reinstall commands stop between resources and report unprocessed items", () => {
  const commands = [
    [
      "reinstallUserResourceGroupCmd",
      "const reinstallUserResourceGroupCmd = vscode.commands.registerCommand(",
      "// Command: Refresh Local",
    ],
    [
      "reinstallResourceGroupCmd",
      "const reinstallResourceGroupCmd = vscode.commands.registerCommand(",
      "// Command: Uninstall all skills",
    ],
    [
      "reinstallAllCmd",
      "const reinstallAllCmd = vscode.commands.registerCommand(",
      "// Command: Reinstall single remote-installed resource",
    ],
    [
      "reinstallMultipleCmd",
      "const reinstallMultipleCmd = vscode.commands.registerCommand(",
      "// Command: Show installed skills",
    ],
  ];

  for (const [label, startMarker, endMarker] of commands) {
    const start = extensionSource.indexOf(startMarker);
    assert.ok(start !== -1, `${label} not found`);
    const body = extensionSource.slice(
      start,
      extensionSource.indexOf(endMarker, start),
    );
    assert.match(body, /cancellable:\s*true/, `${label} must be cancellable`);
    assert.match(body, /async \(progress, token\)/);
    assert.match(body, /if \(token\.isCancellationRequested\)/);
    assert.match(body, /cancelled \? completed/);
    assert.match(body, /getBatchCancellationSuffix\(completed,/);
  }
});

test("batch uninstall commands report failures and stop between skills", () => {
  const commands = [
    [
      "uninstallAllCmd",
      "const uninstallAllCmd = vscode.commands.registerCommand(",
      "// Command: Install Curated Set",
    ],
    [
      "uninstallMultipleCmd",
      "const uninstallMultipleCmd = vscode.commands.registerCommand(",
      "// Command: Reinstall multiple skills",
    ],
  ];

  for (const [label, startMarker, endMarker] of commands) {
    const start = extensionSource.indexOf(startMarker);
    assert.ok(start !== -1, `${label} not found`);
    const body = extensionSource.slice(
      start,
      extensionSource.indexOf(endMarker, start),
    );
    assert.match(body, /cancellable:\s*true/, `${label} must be cancellable`);
    assert.match(body, /async \(progress, token\)/);
    assert.match(body, /if \(token\.isCancellationRequested\)/);
    assert.match(body, /failedSkills\.push\(/);
    assert.match(body, /if \(failedSkills\.length > 0 \|\| cancelled\)/);
    assert.match(body, /cancelled \? completed/);
    assert.match(body, /getBatchFailureMessage\(/);
    assert.match(body, /getBatchCancellationSuffix\(completed,/);
    assert.ok(
      !/Deleted \$\{(?:installed|selected)\.length\} skills/.test(body),
      `${label} must not claim every requested deletion succeeded`,
    );
  }
});

test("plugin resource deletion reports partial and cancelled batches", () => {
  const start = extensionSource.indexOf(
    "const deletePluginResourcesCmd = vscode.commands.registerCommand(",
  );
  assert.ok(start !== -1, "deletePluginResourcesCmd not found");
  const body = extensionSource.slice(
    start,
    extensionSource.indexOf("// Command: Open skill folder", start),
  );

  assert.match(body, /cancellable:\s*true/);
  assert.match(body, /async \(progress, token\)/);
  assert.match(body, /if \(token\.isCancellationRequested\)/);
  assert.match(body, /failedResources\.push\(resource\.name\)/);
  assert.match(body, /const success = completed - failed/);
  assert.match(body, /if \(failedResources\.length > 0 \|\| cancelled\)/);
  assert.match(body, /cancelled \? completed : resources\.length/);
  assert.match(
    body,
    /getBatchCancellationSuffix\(completed, resources\.length\)/,
  );
});

// A single install shows the install's own warning, but the partial folder still
// must not become an active plugin location.
test("the single install registers only what a clean install reported", () => {
  const start = extensionSource.indexOf("async function installResource(");
  assert.ok(start !== -1, "installResource not found");
  const body = extensionSource.slice(
    start,
    extensionSource.indexOf(
      "const searchCmd = vscode.commands.registerCommand(",
      start,
    ),
  );

  assert.match(
    body,
    /installResult &&\s*installWasClean\(installResult\)\s*\)\s*\{\s*await offerPluginLocationRegistration\(\[installResult\.destinationUri\]\)/,
    "the single install must register the reported destination only when clean",
  );
});

// Whatever a caller checks, the fact an install was not clean has to come from
// the install result rather than a second look at the filesystem or settings.
test("every plugin registration site is gated on a clean install", () => {
  assert.match(
    extensionSource,
    /function installWasClean\(\s*installResult: InstallSkillResult \| undefined,\s*\): boolean \{\s*return !!installResult && !installResult\.errors\?\.length;/,
    "the clean-install check must read the errors the install reported",
  );

  const registrationSites = extensionSource.match(
    /offerPluginLocationRegistration\(\[[^\]]*\]\)/g,
  );
  assert.ok(
    registrationSites,
    "no single-destination registration sites found",
  );
  for (const site of registrationSites) {
    assert.strictEqual(
      site,
      "offerPluginLocationRegistration([installResult.destinationUri])",
      "a single-destination registration must come from the install result",
    );
  }

  // The batch prompt takes the collected list, which is only appended to for a
  // clean install.
  assert.match(
    extensionSource,
    /await offerPluginLocationRegistration\(installedPluginUris\);/,
    "the batch must keep its single collected prompt",
  );
  assert.strictEqual(
    (extensionSource.match(/installedPluginUris\.push\(/g) || []).length,
    1,
    "the collected batch list must have exactly one append site",
  );
});

console.log("Resource target tests passed");
