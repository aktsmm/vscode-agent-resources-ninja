#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");
const audit = require("./audit-resource-installability.js");

const repoRoot = path.resolve(__dirname, "..");
const INDEX_PATH = path.join(repoRoot, "resources", "skill-index.json");

function requireTypeScriptModule(filePath) {
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
  loadedModule._compile(transpiled.outputText, filePath);
  return loadedModule.exports;
}

const {
  AGENT_PLUGINS_MANIFEST_KIND,
  getAgentPluginsNameIssue,
  getPluginOwnedHookInstallFileName,
  getPluginOwnedInstallFileName,
  isHookConfigFilePath,
  sanitizeResourceInstallName,
} = requireTypeScriptModule(path.join(repoRoot, "src", "resourceKinds.ts"));

// The destination model follows getResourceTargetUri in src/skillInstaller.ts:
// skills and plugins land in a folder named after the resource, mcp.json is
// namespaced by source, non-config hooks collapse into <folder>/README.md, and
// every other file kind keeps only its basename inside the kind's directory.
function getInstallDestinationSlot(resource) {
  const kind = resource.kind || "skill";
  const remotePath = String(resource.path || "").replace(/\\/g, "/");
  const baseName = path.posix.basename(remotePath);

  if (kind === "skill") {
    return `skill:${sanitizeResourceInstallName(resource.name)}`;
  }
  if (kind === "plugin") {
    return `plugin:${sanitizeResourceInstallName(
      resource.name || resource.pluginRoot || "plugin",
    )}`;
  }
  if (kind === "mcp") {
    const normalized = baseName.replace(/^\./, "");
    return `mcp:${
      normalized.toLowerCase() === "mcp.json"
        ? `${sanitizeResourceInstallName(resource.source)}-${normalized}`
        : baseName
    }`;
  }
  if (kind === "hook") {
    if (isHookConfigFilePath(remotePath)) {
      return `hook:${getPluginOwnedHookInstallFileName({
        kind,
        source: resource.source,
        pluginRoot: resource.pluginRoot,
        resourcePath: remotePath,
        fileName: baseName,
      })}`;
    }
    return `hook:${sanitizeResourceInstallName(
      path.posix.basename(path.posix.dirname(remotePath)) || resource.name,
    )}/README.md`;
  }
  if (kind === "agent" || kind === "instruction" || kind === "prompt") {
    return `${kind}:${getPluginOwnedInstallFileName({
      kind,
      pluginRoot: resource.pluginRoot,
      fileName: baseName,
    })}`;
  }
  if (kind === "cursor-rule") {
    return `${kind}:${baseName}`;
  }
  // Unknown kinds fall through to the verbatim-path branch of getResourceTargetUri.
  return `${kind}:${remotePath}`;
}

function findCrossSourceInstallCollisions(index) {
  const sourcesBySlot = new Map();

  for (const resource of index.skills || []) {
    const slot = getInstallDestinationSlot(resource);
    if (!sourcesBySlot.has(slot)) {
      sourcesBySlot.set(slot, new Set());
    }
    sourcesBySlot.get(slot).add(resource.source);
  }

  const collisions = new Map();
  for (const [slot, sources] of sourcesBySlot) {
    if (sources.size > 1) {
      collisions.set(slot, [...sources].sort());
    }
  }

  return collisions;
}

// slot -> the sources that already ship it. Two entries from different sources
// that install to the same destination cannot be told apart once installed, so
// this list may only shrink; never add a slot to make a new collision pass.
// Grandfathered because they predate this guard and pruning them needs an index
// regeneration (network + token), which is a separate change:
// - instruction:*.instructions.md ... code-and-sorts republishes the four
//   language instruction files that github-awesome-copilot also ships.
// - skill:* ................ the same skill name is vendored by two catalogs
//   (Azure skills duplicated between microsoft-azure-skills, microsoftdocs and
//   awesome-copilot; agent skills duplicated between anthropic, aws, openai and
//   oh-my-codex forks).
const GRANDFATHERED_INSTALL_COLLISIONS = {
  "instruction:csharp.instructions.md": [
    "code-and-sorts-awesome-copilot-agents",
    "github-awesome-copilot",
  ],
  "instruction:go.instructions.md": [
    "code-and-sorts-awesome-copilot-agents",
    "github-awesome-copilot",
  ],
  "instruction:rust.instructions.md": [
    "code-and-sorts-awesome-copilot-agents",
    "github-awesome-copilot",
  ],
  "instruction:terraform.instructions.md": [
    "code-and-sorts-awesome-copilot-agents",
    "github-awesome-copilot",
  ],
  "skill:appinsights-instrumentation": [
    "github-awesome-copilot",
    "microsoft-azure-skills",
  ],
  "skill:autoresearch": ["github-awesome-copilot", "oh-my-codex"],
  "skill:azure-quotas": [
    "microsoft-azure-skills",
    "microsoftdocs-agent-skills",
  ],
  "skill:azure-reliability": [
    "microsoft-azure-skills",
    "microsoftdocs-agent-skills",
  ],
  "skill:azure-resource-visualizer": [
    "github-awesome-copilot",
    "microsoft-azure-skills",
  ],
  "skill:code-review": ["oh-my-codex", "openai-codex"],
  "skill:deploy": ["aws-agent-plugins", "microsoft-azure-skills"],
  "skill:finetuning": ["aws-agent-plugins", "microsoft-azure-skills"],
  "skill:frontend-design": ["anthropic-claude-code", "anthropics-skills"],
  "skill:webapp-testing": ["anthropics-skills", "github-awesome-copilot"],
};

function assertNoNewInstallCollisions() {
  const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
  const collisions = findCrossSourceInstallCollisions(index);

  const unexpected = [...collisions.entries()]
    .filter(([slot, sources]) => {
      const allowed = GRANDFATHERED_INSTALL_COLLISIONS[slot];
      return !allowed || allowed.join(",") !== sources.join(",");
    })
    .map(([slot, sources]) => `${slot} <- ${sources.join(", ")}`)
    .sort();

  assert.deepStrictEqual(
    unexpected,
    [],
    "Two sources install to the same destination; namespace or drop one of them",
  );

  const stale = Object.keys(GRANDFATHERED_INSTALL_COLLISIONS)
    .filter((slot) => !collisions.has(slot))
    .sort();

  assert.deepStrictEqual(
    stale,
    [],
    "Remove the grandfathered entry so the ratchet keeps its value",
  );
}

// The `agent-plugins` manifest kind claims Agent Plugins 1.0.0 conformance, and a
// conformant client rejects a plugin whose `name` breaks the spec. Shipping such an
// entry would offer an install that the user's client silently refuses to load.
function assertShippedAgentPluginsNamesAreValid() {
  const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));

  const invalid = (index.skills || [])
    .filter(
      (resource) =>
        resource.pluginManifestKind === AGENT_PLUGINS_MANIFEST_KIND &&
        getAgentPluginsNameIssue(resource.name) !== undefined,
    )
    .map(
      (resource) =>
        `${resource.source}:${resource.path} name "${resource.name}" is ${getAgentPluginsNameIssue(
          resource.name,
        )}`,
    )
    .sort();

  assert.deepStrictEqual(
    invalid,
    [],
    "An agent-plugins entry must carry a specification-valid name; record it as a plain plugin instead",
  );
}

async function main() {
  assertNoNewInstallCollisions();
  assertShippedAgentPluginsNamesAreValid();

  assert.deepStrictEqual(
    audit.resolveSourceFilter(["--sources", "pai-packs, octo-demo"], {
      RESOURCE_NINJA_SOURCES: "ignored-source",
    }),
    ["pai-packs", "octo-demo"],
    "CLI source filter should override the environment",
  );
  assert.deepStrictEqual(
    audit.resolveSourceFilter([], {
      RESOURCE_NINJA_SOURCES: "pai-packs",
    }),
    ["pai-packs"],
    "RESOURCE_NINJA_SOURCES should scope the audit when CLI is absent",
  );
  assert.deepStrictEqual(
    audit.resolveSourceFilter(["--sources=octo-demo"], {}),
    ["octo-demo"],
  );
  assert.throws(
    () => audit.resolveSourceFilter(["--sources"], {}),
    /--sources requires/,
    "empty --sources must not fall back to a full audit",
  );
  assert.throws(
    () => audit.resolveSourceFilter(["--sources=,"], {}),
    /requires at least one source ID/,
    "separator-only --sources must not fall back to a full audit",
  );
  assert.throws(
    () => audit.resolveSourceFilter([], { RESOURCE_NINJA_SOURCES: " " }),
    /requires at least one source ID/,
    "empty RESOURCE_NINJA_SOURCES must not fall back to a full audit",
  );

  assert.strictEqual(
    audit.normalizeGitHubRepoUrl(
      "https://github.com/octo/demo/tree/main/skills/example",
    ),
    "https://github.com/octo/demo",
  );
  assert.strictEqual(
    audit.normalizeGitHubRepoUrl(
      "https://github.com/octo/demo/blob/main/README.md",
    ),
    "https://github.com/octo/demo",
  );

  const index = {
    version: "1.0.0",
    lastUpdated: "2026-05-26",
    sources: [
      {
        id: "octo-demo",
        name: "demo",
        url: "https://github.com/octo/demo/tree/main/skills",
        type: "user-added",
        description: "demo",
      },
    ],
    skills: [
      {
        name: "ok-skill",
        source: "octo-demo",
        path: "skills/ok-skill",
        categories: [],
        description: "ok",
      },
      {
        name: "missing-skill",
        source: "octo-demo",
        path: "skills/missing-skill",
        categories: [],
        description: "missing",
      },
    ],
    bundles: [
      {
        id: "octo-demo-bundle",
        name: "demo bundle",
        source: "octo-demo",
        description: "demo bundle",
        skills: ["ok-skill", "missing-skill"],
        installOrder: ["ok-skill", "missing-skill"],
        coreSkill: "missing-skill",
      },
    ],
    categories: [],
  };

  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET" });

    if (url === "https://api.github.com/repos/octo/demo") {
      return {
        ok: true,
        status: 200,
        json: async () => ({ default_branch: "main" }),
      };
    }

    if (
      url ===
      "https://raw.githubusercontent.com/octo/demo/main/skills/ok-skill/SKILL.md"
    ) {
      return { ok: true, status: 200 };
    }

    if (
      url ===
      "https://raw.githubusercontent.com/octo/demo/main/skills/missing-skill/SKILL.md"
    ) {
      return { ok: false, status: 404 };
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  const result = await audit.auditIndexInstallability(index, {
    fetchImpl,
    token: undefined,
  });
  assert.deepStrictEqual(result.normalizedSourceUrls, [
    {
      id: "octo-demo",
      from: "https://github.com/octo/demo/tree/main/skills",
      to: "https://github.com/octo/demo",
    },
  ]);
  assert.strictEqual(result.findings.length, 1);
  assert.strictEqual(result.findings[0].type, "unreachable");
  assert.strictEqual(result.findings[0].path, "skills/missing-skill");
  assert.strictEqual(
    result.findings[0].rawUrl,
    "https://raw.githubusercontent.com/octo/demo/main/skills/missing-skill/SKILL.md",
  );
  assert.ok(
    calls.some((call) => call.url === "https://api.github.com/repos/octo/demo"),
    "Expected default branch lookup",
  );

  const prunedIndex = audit.applyAuditFixes(index, result);
  assert.strictEqual(
    prunedIndex.sources[0].url,
    "https://github.com/octo/demo",
  );
  assert.deepStrictEqual(
    prunedIndex.skills.map((resource) => resource.name),
    ["ok-skill"],
  );
  assert.deepStrictEqual(prunedIndex.bundles[0].skills, ["ok-skill"]);
  assert.deepStrictEqual(prunedIndex.bundles[0].installOrder, ["ok-skill"]);
  assert.strictEqual(prunedIndex.bundles[0].coreSkill, undefined);

  const scopedIndex = {
    ...index,
    sources: [
      ...index.sources,
      {
        id: "other-source",
        name: "other",
        url: "https://github.com/octo/other/tree/main/resources",
        type: "user-added",
        description: "must not be audited",
      },
    ],
    skills: [
      index.skills[0],
      {
        name: "other-skill",
        source: "other-source",
        path: "skills/other-skill",
        categories: [],
        description: "must not be audited",
      },
    ],
    bundles: [],
  };
  const scopedCalls = [];
  const scopedResult = await audit.auditIndexInstallability(scopedIndex, {
    sourceIds: ["octo-demo"],
    fetchImpl: async (url) => {
      scopedCalls.push(url);
      if (url === "https://api.github.com/repos/octo/demo") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ default_branch: "main" }),
        };
      }
      if (
        url ===
        "https://raw.githubusercontent.com/octo/demo/main/skills/ok-skill/SKILL.md"
      ) {
        return { ok: true, status: 200 };
      }
      throw new Error(`Scoped audit fetched an unselected source: ${url}`);
    },
  });
  assert.deepStrictEqual(scopedResult.auditedSourceIds, ["octo-demo"]);
  assert.deepStrictEqual(scopedResult.findings, []);
  assert.ok(
    scopedCalls.every((url) => !url.includes("octo/other")),
    "scoped audit must not fetch unselected sources",
  );
  assert.deepStrictEqual(scopedResult.normalizedSourceUrls, [
    {
      id: "octo-demo",
      from: "https://github.com/octo/demo/tree/main/skills",
      to: "https://github.com/octo/demo",
    },
  ]);

  await assert.rejects(
    audit.auditIndexInstallability(scopedIndex, {
      sourceIds: ["missing-source"],
      fetchImpl: async () => {
        throw new Error("unknown source must fail before fetch");
      },
    }),
    /Unknown source ID\(s\): missing-source/,
    "unknown source IDs must not silently audit zero or all resources",
  );

  const scopedFixedIndex = audit.applyAuditFixes(scopedIndex, scopedResult);
  assert.strictEqual(
    scopedFixedIndex.sources.find((source) => source.id === "other-source").url,
    "https://github.com/octo/other/tree/main/resources",
    "scoped apply must not normalize an unselected source URL",
  );

  console.log("RESULT=PASS");
}

module.exports = {
  findCrossSourceInstallCollisions,
  getInstallDestinationSlot,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
}
