#!/usr/bin/env node
// The revision baseline decides whether a resource is skipped, so a wrong
// "unchanged" is the failure that matters: it must only come from an identical
// content id under an identical source, and anything unknown must update.

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

function requireTypeScriptModule(filePath, stubs = {}) {
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
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    return Object.prototype.hasOwnProperty.call(stubs, request)
      ? stubs[request]
      : originalLoad(request, parent, isMain);
  };
  try {
    loadedModule._compile(transpiled.outputText, filePath);
  } finally {
    Module._load = originalLoad;
  }
  return loadedModule.exports;
}

class FakeGitHubResponseError extends Error {
  constructor(kind, status, message) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.isFake = true;
  }
}

const revision = requireTypeScriptModule(
  path.join(__dirname, "..", "src", "resourceRevision.ts"),
  {
    "./githubFetch": { fetchGitHubWithOptionalAuthRetry: async () => undefined },
    "./githubResponse": {
      GitHubResponseError: FakeGitHubResponseError,
      isGitHubResponseError: (error) => error instanceof FakeGitHubResponseError,
      createGitHubResponseError: (response) =>
        new FakeGitHubResponseError("other", response.status, "http"),
    },
  },
);

const sha = (character) => character.repeat(40);
const COMMIT = sha("a");
const ROOT = sha("b");
const SKILL_TREE = sha("c");
const FILE_BLOB = sha("d");

function fakeGitHub(options = {}) {
  const calls = [];
  const request = async (url) => {
    calls.push(url);
    const respond = (body, status = 200) => ({
      ok: status < 400,
      status,
      headers: new Map(),
      json: async () => body,
      text: async () => "",
    });
    if (url.endsWith("/commits/main")) {
      return respond({ sha: COMMIT, commit: { tree: { sha: ROOT } } });
    }
    if (url.includes(`/git/trees/${ROOT}`)) {
      const recursive = url.includes("recursive=1");
      const entries = options.truncated
        ? recursive
          ? []
          : [{ path: "skills", sha: sha("e"), type: "tree", mode: "040000" }]
        : [
            { path: "skills", sha: sha("e"), type: "tree", mode: "040000" },
            { path: "skills/alpha", sha: SKILL_TREE, type: "tree", mode: "040000" },
            { path: "agents", sha: sha("f"), type: "tree", mode: "040000" },
            { path: "agents/helper.agent.md", sha: FILE_BLOB, type: "blob", mode: "100644" },
          ];
      return respond({
        sha: ROOT,
        truncated: options.truncated === true && recursive,
        tree: entries,
      });
    }
    if (url.includes(`/git/trees/${sha("e")}`)) {
      return respond({
        sha: sha("e"),
        truncated: false,
        tree: [{ path: "alpha", sha: SKILL_TREE, type: "tree", mode: "040000" }],
      });
    }
    return respond({}, 404);
  };
  return { request, calls };
}

const target = (remotePath) => ({
  owner: "Acme",
  repo: "Resources",
  branch: "main",
  remotePath,
});

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

test("a skill folder resolves to its tree id at the branch commit", async () => {
  const { request } = fakeGitHub();
  const resolve = revision.createRevisionResolver(undefined, undefined, request);
  assert.deepStrictEqual(await resolve(target("skills/alpha")), {
    owner: "acme",
    repo: "resources",
    ref: "main",
    remotePath: "skills/alpha",
    commitSha: COMMIT,
    contentSha: SKILL_TREE,
    kind: "tree",
  });
});

test("a single file resolves to its blob id", async () => {
  const { request } = fakeGitHub();
  const resolved = await revision.createRevisionResolver(
    undefined,
    undefined,
    request,
  )(target("agents/helper.agent.md"));
  assert.strictEqual(resolved.kind, "blob");
  assert.strictEqual(resolved.contentSha, FILE_BLOB);
});

test("a batch over one branch shares one commit and tree snapshot", async () => {
  const { request, calls } = fakeGitHub();
  const resolve = revision.createRevisionResolver(undefined, undefined, request);
  await Promise.all([
    resolve(target("skills/alpha")),
    resolve(target("agents/helper.agent.md")),
    resolve(target("skills")),
  ]);
  assert.strictEqual(calls.length, 2, "one commit request and one tree request");
});

test("a truncated listing is walked one level at a time", async () => {
  const { request } = fakeGitHub({ truncated: true });
  const resolved = await revision.createRevisionResolver(
    undefined,
    undefined,
    request,
  )(target("skills/alpha"));
  assert.strictEqual(resolved.contentSha, SKILL_TREE);
});

test("a path that no longer exists is reported, not guessed", async () => {
  const { request } = fakeGitHub();
  await assert.rejects(
    () =>
      revision.createRevisionResolver(undefined, undefined, request)(
        target("skills/gone"),
      ),
    (error) => error.name === "RevisionPathMissingError",
  );
});

test("invalid targets and malformed responses are rejected", async () => {
  const { request } = fakeGitHub();
  const resolve = revision.createRevisionResolver(undefined, undefined, request);
  await assert.rejects(() => resolve({ ...target("skills/alpha"), owner: "a/b" }));
  await assert.rejects(() => resolve(target("../etc")));
  const bad = revision.createRevisionResolver(undefined, undefined, async () => ({
    ok: true,
    status: 200,
    json: async () => ({ sha: "nope" }),
    text: async () => "",
  }));
  await assert.rejects(() => bad(target("skills/alpha")), /Unable to resolve/);
});

test("a cancelled check stops before any request", async () => {
  const { request, calls } = fakeGitHub();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () =>
      revision.createRevisionResolver(undefined, controller.signal, request)(
        target("skills/alpha"),
      ),
    (error) => error.name === "AbortError",
  );
  assert.strictEqual(calls.length, 0);
});

const current = {
  owner: "acme",
  repo: "resources",
  ref: "main",
  remotePath: "skills/alpha",
  commitSha: COMMIT,
  contentSha: SKILL_TREE,
  kind: "tree",
};

test("only an identical content id under the same source is unchanged", () => {
  assert.strictEqual(revision.classifyRevision(current, current), "unchanged");
  assert.strictEqual(
    revision.classifyRevision({ ...current, commitSha: sha("9") }, current),
    "unchanged",
    "a newer commit that did not touch the folder is still unchanged",
  );
  assert.strictEqual(
    revision.classifyRevision({ ...current, contentSha: sha("9") }, current),
    "changed",
  );
});

test("an unknown or foreign baseline is never treated as unchanged", () => {
  for (const baseline of [
    undefined,
    null,
    "text",
    {},
    { ...current, contentSha: "short" },
    { ...current, kind: "other" },
    { ...current, owner: "../x" },
  ]) {
    assert.strictEqual(revision.classifyRevision(baseline, current), "no-baseline");
  }
  for (const foreign of [
    { ...current, repo: "other" },
    { ...current, ref: "dev" },
    { ...current, remotePath: "skills/beta" },
    { ...current, kind: "blob" },
  ]) {
    assert.strictEqual(
      revision.classifyRevision(foreign, current),
      "different-source",
    );
  }
});

test("a parsed baseline is normalized and carries only the known fields", () => {
  const parsed = revision.parseSourceRevision({
    ...current,
    commitSha: COMMIT.toUpperCase(),
    extra: "ignored",
  });
  assert.strictEqual(parsed.commitSha, COMMIT);
  assert.ok(!("extra" in parsed));
});

(async () => {
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      console.error(`FAIL ${name}`);
      console.error(error);
      process.exitCode = 1;
    }
  }
  if (!process.exitCode) {
    console.log("RESULT=PASS");
  }
})();
