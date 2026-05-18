#!/usr/bin/env node

const assert = require("assert");
const path = require("path");

function sanitizeResourceName(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[()[\]{}]/g, "")
    .replace(/[^a-z0-9\-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function globalHomeRoot(config = {}) {
  if (config.globalHomeDirectory) return config.globalHomeDirectory;
  if (config.globalResourceHomePreset === "claude") return "~/.claude";
  if (config.globalResourceHomePreset === "agents") return "~/.agents";
  return "~/.copilot";
}

function getInstallFileName(skill, fileName) {
  if (skill.kind !== "mcp" || !skill.source) return fileName;
  const normalizedFileName = fileName.replace(/^\./, "");
  if (normalizedFileName.toLowerCase() !== "mcp.json") return fileName;
  return `${sanitizeResourceName(skill.source)}-${normalizedFileName}`;
}

function getPluginInstallRootName(skill) {
  return sanitizeResourceName(skill.name || skill.pluginRoot || "plugin");
}

function isHookConfigFilePath(resourcePath) {
  return /(^|\/)(?:\.github\/)?hooks\/[^/]+\.json$/i.test(
    resourcePath.replace(/\\/g, "/"),
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
  const resourceFolderName = sanitizeResourceName(
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
      return path.posix.join(customRoot, sanitizeResourceName(skill.name));
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
      return path.posix.join(root, "skills", sanitizeResourceName(skill.name));
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
        sanitizeResourceName(skill.name),
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
      sanitizeResourceName(skill.name),
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

console.log("Resource target tests passed");
