const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const fixtureRoot = path.join(
  repoRoot,
  "output_sessions",
  "coexistence-fixture",
);

const headerLines = [
  "## Agent Resources",
  "",
  "> **IMPORTANT**: Prefer resource-led reasoning over pre-training-led reasoning.",
  "> Read the relevant resource file before working on tasks covered by these resources.",
];

const resources = [
  {
    kind: "skill",
    section: "Skills",
    name: "Sample Alpha",
    source: "local",
    relativePath: ".github/skills/sample-alpha",
    linkPath: ".github/skills/sample-alpha/SKILL.md",
    description:
      "Workspace sample skill used to verify runtime exclusion behavior.",
  },
  {
    kind: "agent",
    section: "Agents",
    name: "Sample Review Agent",
    source: "local",
    relativePath: ".github/agents/sample-review.agent.md",
    linkPath: ".github/agents/sample-review.agent.md",
    description: "Sample workspace agent for shared marker coverage.",
  },
  {
    kind: "instruction",
    section: "Instructions",
    name: "Sample Style Instruction",
    source: "local",
    relativePath: ".github/instructions/sample-style.instructions.md",
    linkPath: ".github/instructions/sample-style.instructions.md",
    description:
      "Sample instruction used to verify non-skill resource listing.",
  },
  {
    kind: "prompt",
    section: "Prompts",
    name: "Sample Refactor Prompt",
    source: "local",
    relativePath: ".github/prompts/sample-refactor.prompt.md",
    linkPath: ".github/prompts/sample-refactor.prompt.md",
    description:
      "Sample prompt listed by Resource NINJA when it owns the shared block.",
  },
  {
    kind: "hook",
    section: "Hooks",
    name: "Sample Policy Hook",
    source: "local",
    relativePath: ".github/hooks/sample-policy",
    linkPath: ".github/hooks/sample-policy/README.md",
    description: "Sample hook package for shared block validation.",
  },
  {
    kind: "mcp",
    section: "MCPs",
    name: "sample-dev",
    source: "local",
    relativePath: ".github/mcp/sample-dev.json",
    linkPath: ".github/mcp/sample-dev.json",
    description: "",
  },
  {
    kind: "plugin",
    section: "Plugins",
    name: "acme",
    source: "local",
    relativePath: "plugins/acme/.plugin/plugin.json",
    linkPath: "plugins/acme/.plugin/plugin.json",
    description: "",
  },
  {
    kind: "cursor-rule",
    section: "Cursor Rules",
    name: "Safe Cursor Rule",
    source: "local",
    relativePath: "rules/safe.mdc",
    linkPath: "rules/safe.mdc",
    description:
      "Sample cursor rule discovered through workspace fallback scanning.",
  },
];

const sectionOrder = [
  "skill",
  "agent",
  "instruction",
  "prompt",
  "hook",
  "mcp",
  "plugin",
  "cursor-rule",
];

const sectionTitles = new Map(
  resources.map((resource) => [resource.kind, resource.section]),
);

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(relativePath, content) {
  const filePath = path.join(fixtureRoot, relativePath);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

function wrapSharedBlock(body) {
  return `<!-- agent-ninja-START -->\n${body.trim()}\n\n<!-- agent-ninja-END -->\n`;
}

function renderSharedSection(selectedResources) {
  const grouped = new Map();
  for (const resource of selectedResources) {
    const items = grouped.get(resource.kind) || [];
    items.push(resource);
    grouped.set(resource.kind, items);
  }

  const lines = [...headerLines];
  for (const kind of sectionOrder) {
    const items = grouped.get(kind);
    if (!items || items.length === 0) {
      continue;
    }
    lines.push("", `### ${sectionTitles.get(kind)}`, "");
    lines.push(
      "| Resource | Source | Path | Description |",
      "|----------|--------|------|-------------|",
    );
    for (const item of items) {
      lines.push(
        `| [${item.name}](${item.linkPath}) | ${item.source} | \`${item.relativePath}\` | ${item.description.replace(/\|/g, "\\|")} |`,
      );
    }
  }
  return wrapSharedBlock(lines.join("\n"));
}

function renderScenarioReadme(title, notes) {
  return `# ${title}\n\n${notes.join("\n\n")}\n`;
}

function createWorkspaceSettings() {
  return (
    JSON.stringify(
      {
        "resourceNinja.autoUpdateInstruction": true,
        "resourceNinja.instructionFile": "AGENTS.md",
        "resourceNinja.coexistenceMode": "auto",
        "resourceNinja.includeLocalResources": true,
        "resourceNinja.outputFormat": "full",
      },
      null,
      2,
    ) + "\n"
  );
}

function createCommonResources(baseRelativePath) {
  writeFile(
    path.join(baseRelativePath, ".github/skills/sample-alpha/SKILL.md"),
    `---\nname: "Sample Alpha"\ndescription: "Workspace sample skill used to verify runtime exclusion behavior."\n---\n\n# Sample Alpha\n\nUse this skill for coexistence fixture validation.\n`,
  );
  writeFile(
    path.join(baseRelativePath, ".github/agents/sample-review.agent.md"),
    `---\nname: "Sample Review Agent"\ndescription: "Sample workspace agent for shared marker coverage."\n---\n\n# Sample Review Agent\n`,
  );
  writeFile(
    path.join(
      baseRelativePath,
      ".github/instructions/sample-style.instructions.md",
    ),
    `---\nname: "Sample Style Instruction"\ndescription: "Sample instruction used to verify non-skill resource listing."\napplyTo: "**"\n---\n\n# Sample Style Instruction\n`,
  );
  writeFile(
    path.join(baseRelativePath, ".github/prompts/sample-refactor.prompt.md"),
    `---\nname: "Sample Refactor Prompt"\ndescription: "Sample prompt listed by Resource NINJA when it owns the shared block."\n---\n\n# Sample Refactor Prompt\n`,
  );
  writeFile(
    path.join(baseRelativePath, ".github/hooks/sample-policy/README.md"),
    `---\nname: "Sample Policy Hook"\ndescription: "Sample hook package for shared block validation."\n---\n\n# Sample Policy Hook\n`,
  );
  writeFile(
    path.join(baseRelativePath, ".github/mcp/sample-dev.json"),
    JSON.stringify(
      {
        servers: {
          sampleDev: {
            type: "stdio",
            command: "node",
            args: ["scripts/sample-dev-server.js"],
          },
        },
      },
      null,
      2,
    ) + "\n",
  );
  writeFile(
    path.join(baseRelativePath, "plugins/acme/.plugin/plugin.json"),
    JSON.stringify(
      {
        name: "Acme Plugin",
        description: "Local plugin fixture for coexistence validation.",
        version: "0.0.1",
      },
      null,
      2,
    ) + "\n",
  );
  writeFile(
    path.join(baseRelativePath, "rules/safe.mdc"),
    `---\nname: "Safe Cursor Rule"\ndescription: "Sample cursor rule discovered through workspace fallback scanning."\n---\n\n# Safe Cursor Rule\n\nAlways inspect diffs before applying patches.\n`,
  );
  writeFile(
    path.join(baseRelativePath, ".vscode/settings.json"),
    createWorkspaceSettings(),
  );
}

function buildScenarioB() {
  const scenario = "B-resources-solo";
  createCommonResources(scenario);
  writeFile(
    path.join(scenario, "AGENTS.md"),
    "# Fixture: Resource NINJA Solo\n\nResource NINJA should own the shared block and honor standalone exclusions.\n",
  );
  writeFile(
    path.join(scenario, "expected-after.md"),
    `# Fixture: Resource NINJA Solo\n\nResource NINJA should own the shared block and honor standalone exclusions.\n\n${renderSharedSection(
      resources.filter((resource) => resource.kind === "skill"),
    )}`,
  );
  writeFile(
    path.join(scenario, "README.md"),
    renderScenarioReadme("Scenario B - Resource NINJA Solo", [
      "Open this folder with only Resource NINJA installed or enabled.",
      "Run Resource NINJA: Update Instruction File.",
      "Expected result: the shared marker block is created and keeps only the mandatory `skill` row because agents and instructions are opt-in.",
    ]),
  );
}

function buildScenarioF() {
  const scenario = "F-uninstall-skill";
  createCommonResources(scenario);
  const preinstalledBlock = renderSharedSection(resources);
  writeFile(
    path.join(scenario, "AGENTS.md"),
    `# Fixture: Skill Uninstall Handoff\n\nInitial state assumes the skill-only sibling extension was active and Resource NINJA had already written a full shared block.\n\n${preinstalledBlock}`,
  );
  writeFile(
    path.join(scenario, "expected-after.md"),
    `# Fixture: Skill Uninstall Handoff\n\nInitial state assumes the skill-only sibling extension was active and Resource NINJA had already written a full shared block.\n\n${renderSharedSection(
      resources.filter((resource) => resource.kind === "skill"),
    )}`,
  );
  writeFile(
    path.join(scenario, "README.md"),
    renderScenarioReadme("Scenario F - Uninstall Skill NINJA", [
      "Open this folder with both extensions initially enabled so the pre-populated AGENTS.md represents a prior shared-block state.",
      "Disable or uninstall Skill NINJA, then run Resource NINJA: Recompute Coexistence Ownership followed by Resource NINJA: Update Instruction File.",
      "Expected result: Resource NINJA remains owner, but standalone exclusions apply again, so the shared block collapses back to the mandatory `skill` row.",
    ]),
  );
}

function buildRunbook() {
  const content = `# Resource NINJA Coexistence Fixture Walkthrough\n\nThis fixture complements the Skill NINJA fixture set with the Resource-only scenarios that cannot be produced from the subset-side repository.\n\n## Included scenarios\n\n- B-resources-solo: Resource NINJA only, shared block generated in standalone mode with the default skill-only policy.\n- F-uninstall-skill: shared block starts in a prior coexistence state, then Resource NINJA refreshes after the skill-only sibling extension is disabled or uninstalled.\n\n## Common setup\n\n1. Build or install the coexistence test VSIX for Resource NINJA.\n2. Open one scenario folder in a fresh VS Code window.\n3. Verify \`.vscode/settings.json\` was loaded for the workspace.\n4. Compare \`AGENTS.md\` against \`expected-after.md\` after the manual command sequence.\n\n## Commands used during manual validation\n\n- Resource NINJA: Show Coexistence Status\n- Resource NINJA: Recompute Coexistence Ownership\n- Resource NINJA: Update Instruction File\n- Resource NINJA: Cleanup Shared Marker Block (optional reset)\n\n## Notes\n\nThese scenarios reflect the current Resource NINJA implementation semantics: in standalone mode, the generated shared block always keeps \`skill\`. Agents and instructions are opt-in through \`instructionBlock.*\` settings, and legacy \`resourceNinja.kindsExcluded\` is only a compatibility layer for optional kinds. When the skill-only sibling extension is detected and Resource NINJA owns the shared block, those legacy exclusions are ignored at runtime.\n`;
  writeFile("run.md", content);
}

function main() {
  ensureDir(fixtureRoot);
  buildScenarioB();
  buildScenarioF();
  buildRunbook();
  process.stdout.write(`Generated coexistence fixtures at ${fixtureRoot}\n`);
}

main();
