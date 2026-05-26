#!/usr/bin/env node

const assert = require("assert");
const audit = require("./audit-resource-installability.js");

async function main() {
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
    calls.some(
      (call) => call.url === "https://api.github.com/repos/octo/demo",
    ),
    "Expected default branch lookup",
  );

  const prunedIndex = audit.applyAuditFixes(index, result);
  assert.strictEqual(prunedIndex.sources[0].url, "https://github.com/octo/demo");
  assert.deepStrictEqual(
    prunedIndex.skills.map((resource) => resource.name),
    ["ok-skill"],
  );
  assert.deepStrictEqual(prunedIndex.bundles[0].skills, ["ok-skill"]);
  assert.deepStrictEqual(prunedIndex.bundles[0].installOrder, ["ok-skill"]);
  assert.strictEqual(prunedIndex.bundles[0].coreSkill, undefined);

  console.log("RESULT=PASS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});