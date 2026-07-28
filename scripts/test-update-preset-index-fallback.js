#!/usr/bin/env node

const assert = require("assert");
const path = require("path");
const updater = require("./update-preset-index.js");

async function main() {
  assert.strictEqual(updater.shouldUseGitTreeFallback(403), true);
  assert.strictEqual(updater.shouldUseGitTreeFallback(429), true);
  assert.strictEqual(updater.shouldUseGitTreeFallback(404), false);
  assert.strictEqual(updater.shouldUseGitTreeFallback(500), false);

  const gitCalls = [];
  const removed = [];
  const tempRoot = path.join("C:", "temp", "resource-ninja-index-test");
  const tree = updater.readRepositoryTreeWithGit(
    "https://github.com/octo/demo.git",
    "main",
    {
      execFileSync(command, args, options) {
        gitCalls.push({ command, args, options });
        if (args.includes("ls-tree")) {
          return "skills/demo/SKILL.md\0plugin.json\0";
        }
        return "";
      },
      mkdtempSync() {
        return tempRoot;
      },
      rmSync(target, options) {
        removed.push({ target, options });
      },
    },
  );

  assert.deepStrictEqual(tree, {
    tree: [
      { path: "skills/demo/SKILL.md", type: "blob" },
      { path: "plugin.json", type: "blob" },
    ],
    truncated: false,
  });
  assert.strictEqual(gitCalls.length, 2);
  assert.deepStrictEqual(gitCalls[0].args.slice(0, 3), [
    "-c",
    "credential.helper=",
    "clone",
  ]);
  assert.ok(gitCalls[0].args.includes("--no-checkout"));
  assert.ok(gitCalls[0].args.includes("--filter=blob:none"));
  assert.strictEqual(gitCalls[0].options.env.GIT_TERMINAL_PROMPT, "0");
  assert.strictEqual(gitCalls[0].options.shell, undefined);
  assert.deepStrictEqual(removed, [
    { target: tempRoot, options: { recursive: true, force: true } },
  ]);

  const failedCloneCleanup = [];
  assert.throws(
    () =>
      updater.readRepositoryTreeWithGit(
        "https://github.com/octo/missing.git",
        "main",
        {
          execFileSync() {
            throw new Error("clone failed");
          },
          mkdtempSync() {
            return tempRoot;
          },
          rmSync(target, options) {
            failedCloneCleanup.push({ target, options });
          },
        },
      ),
    /clone failed/,
  );
  assert.deepStrictEqual(failedCloneCleanup, [
    { target: tempRoot, options: { recursive: true, force: true } },
  ]);

  const fallbackCalls = [];
  const fallback = await updater.loadRepositoryTree("octo", "demo", "main", {
    async githubFetch(url) {
      fallbackCalls.push({ type: "fetch", url });
      return { ok: false, status: 403 };
    },
    readRepositoryTreeWithGit(repoUrl, branch) {
      fallbackCalls.push({ type: "git", repoUrl, branch });
      return tree;
    },
  });
  assert.deepStrictEqual(fallback, { data: tree, branch: "main" });
  assert.deepStrictEqual(fallbackCalls, [
    {
      type: "fetch",
      url: "https://api.github.com/repos/octo/demo/git/trees/main?recursive=1",
    },
    {
      type: "git",
      repoUrl: "https://github.com/octo/demo.git",
      branch: "main",
    },
  ]);

  const synchronizedBundles = updater.synchronizeSourceBundles(
    [
      {
        id: "all-resources",
        source: "demo",
        skills: ["stale"],
        installOrder: ["stale"],
        coreSkill: "stale",
        syncWithSource: true,
        syncResourceKinds: ["skill", "mcp"],
      },
      {
        id: "curated",
        source: "demo",
        skills: ["selected"],
        syncWithSource: false,
      },
    ],
    [
      { source: "demo", name: "skill", kind: "skill" },
      { source: "demo", name: "config", kind: "mcp" },
      { source: "demo", name: "manifest", kind: "plugin" },
      { source: "demo", name: "hook", kind: "hook" },
      { source: "other", name: "unrelated", kind: "skill" },
    ],
  );
  assert.deepStrictEqual(synchronizedBundles[0].skills, ["skill", "config"]);
  assert.deepStrictEqual(synchronizedBundles[0].installOrder, [
    "skill",
    "config",
  ]);
  assert.strictEqual(synchronizedBundles[0].coreSkill, undefined);
  assert.deepStrictEqual(synchronizedBundles[1].skills, ["selected"]);

  console.log("RESULT=PASS");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
