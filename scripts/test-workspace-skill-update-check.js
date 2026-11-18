#!/usr/bin/env node
/* global require, __dirname, process, console */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const repo = path.resolve(__dirname, "..");
const originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
  if (name === "vscode") {
    return { Uri: { file: (fsPath) => ({ fsPath, scheme: "file" }) } };
  }
  if (name === "./githubFetch") {
    return { fetchGitHubWithOptionalAuthRetry: async () => { throw new Error("network"); } };
  }
  return originalLoad.call(this, name, parent, isMain);
};
require.extensions[".ts"] = (module_, filename) => {
  module_._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: filename,
  }).outputText, filename);
};
const { findChangedWorkspaceSkills, isDocumentInsideDirectory } = require(path.join(repo, "src", "workspaceSkillUpdateCheck.ts"));
const { RevisionPathMissingError } = require(path.join(repo, "src", "resourceRevision.ts"));
const { GitHubResponseError } = require(path.join(repo, "src", "githubResponse.ts"));
Module._load = originalLoad;

const sha = (character) => character.repeat(40);
const revision = (name, content) => ({
  owner: "octo", repo: "demo", ref: "main", remotePath: `skills/${name}`,
  commitSha: sha("a"), contentSha: sha(content), kind: "tree",
});
const skill = (name, content, extra = {}) => ({
  name, source: "octo/demo", remotePath: `skills/${name}`,
  sourceRevision: revision(name, content),
  skillFilePath: path.join("C:", "ws", ".github", "skills", name, "SKILL.md"),
  ...extra,
});
const workspace = { fsPath: path.join("C:", "ws"), scheme: "file" };
const current = { same: "1", changed: "2", gone: "3", broken: "4", limited: "5", foreign: "6" };

function dependencies(metas, overrides = {}) {
  const requests = [];
  return {
    requests,
    deps: {
      scan: async () => ({ metas, complete: true, errors: [], errorCount: 0 }),
      resolve: async (target) => {
        requests.push(target.remotePath);
        const name = target.remotePath.split("/")[1];
        if (name === "gone") { throw new RevisionPathMissingError(); }
        if (name === "broken") { throw new Error("secret detail"); }
        if (name === "limited") { throw new GitHubResponseError("rate-limit", 429, "limit"); }
        return {
          ...revision(name, current[name]),
          ref: name === "foreign" ? "other" : "main",
          commitSha: sha("b"),
        };
      },
      isRateLimit: (error) => error instanceof GitHubResponseError,
      isCancelled: () => false,
      log: () => undefined,
      ...overrides,
    },
  };
}

async function main() {
  {
    const metas = [
      skill("same", "1"),
      skill("changed", "9"),
      skill("gone", "3"),
      skill("local", "1", { source: "local" }),
      skill("legacy", "1", { sourceRevision: undefined }),
      skill("disabled", "1", { reinstallDisabled: true }),
      skill("mismatch", "1", { remotePath: "skills/elsewhere" }),
      skill("foreign", "6"),
    ];
    const { deps, requests } = dependencies(metas);
    const summary = await findChangedWorkspaceSkills([workspace], deps);
    assert.deepEqual(summary.targets.map((item) => item.label), ["changed"]);
    assert.equal(path.basename(summary.targets[0].target.fsPath), "changed");
    assert.equal(summary.upToDate, 1);
    assert.equal(summary.complete, true);
    assert.equal(summary.rateLimited, false);
    assert.deepEqual(requests.sort(), ["skills/changed", "skills/foreign", "skills/gone", "skills/same"]);
  }
  {
    const { deps } = dependencies([skill("broken", "1"), skill("changed", "9")]);
    const summary = await findChangedWorkspaceSkills([workspace], deps);
    assert.equal(summary.complete, false);
    assert.deepEqual(summary.targets.map((item) => item.label), ["changed"]);
  }
  {
    const { deps, requests } = dependencies([
      skill("limited", "1"), skill("changed", "9"),
    ]);
    const summary = await findChangedWorkspaceSkills([workspace], deps);
    assert.equal(summary.rateLimited, true);
    assert.equal(summary.complete, false);
    assert.deepEqual(requests, ["skills/limited"]);
    assert.deepEqual(summary.targets, []);
  }
  {
    const { deps } = dependencies([skill("same", "1")], {
      scan: async () => ({ metas: [skill("same", "1")], complete: false, errors: ["scan-failed"], errorCount: 1 }),
    });
    assert.equal((await findChangedWorkspaceSkills([workspace], deps)).complete, false);
  }
  {
    let cancelled = false;
    const { deps, requests } = dependencies([skill("same", "1"), skill("changed", "9")], {
      isCancelled: () => cancelled,
      resolve: async (target) => {
        cancelled = true;
        return { ...revision("same", "1"), commitSha: sha("b"), remotePath: target.remotePath };
      },
    });
    const summary = await findChangedWorkspaceSkills([workspace], deps);
    assert.equal(summary.complete, false);
    assert.equal(requests.length, 0);
  }
  {
    const dir = path.join("C:", "ws", ".github", "skills", "sample");
    assert.equal(isDocumentInsideDirectory(dir, path.join(dir, "SKILL.md")), true);
    assert.equal(isDocumentInsideDirectory(dir, path.join(dir, "..notes.md")), true);
    assert.equal(isDocumentInsideDirectory(dir, path.join(dir, "sub", "a.md")), true);
    assert.equal(isDocumentInsideDirectory(dir, dir), true);
    assert.equal(isDocumentInsideDirectory(dir, path.join(dir, "..", "other", "SKILL.md")), false);
    assert.equal(isDocumentInsideDirectory(dir, `${dir}-2${path.sep}SKILL.md`), false);
    assert.equal(isDocumentInsideDirectory(dir, path.join(dir, "..")), false);
  }
  console.log("PASS workspace skill update check");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
