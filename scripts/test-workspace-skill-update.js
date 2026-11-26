#!/usr/bin/env node
/* global require, __dirname, Buffer, process, console, queueMicrotask */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = fs.promises;
const path = require("node:path");
const Module = require("node:module");
const childProcess = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const ts = require("typescript");

const repo = path.resolve(__dirname, "..");
const fixture = path.join(repo, `.workspace-update-test-${randomUUID()}`);
const workspace = path.join(fixture, "workspace");
const skills = path.join(workspace, ".skills");
const target = path.join(skills, "sample");
const oldCommit = "a".repeat(40);
const newCommit = "b".repeat(40);
const oldRoot = "c".repeat(40);
const newRoot = "d".repeat(40);
const oldTree = "e".repeat(40);
const newTree = "f".repeat(40);
const remotePath = "skills/sample";
const oldFiles = {
  "SKILL.md": Buffer.from("old skill\n"),
  "data.bin": Buffer.from([0, 255, 1]),
};
const newFiles = {
  "SKILL.md": Buffer.from("new skill\n"),
  "data.bin": Buffer.from([0, 255, 2]),
};
const gitBlob = (bytes) => createHash("sha1")
  .update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const oldRevision = {
  owner: "octo", repo: "demo", ref: "main", remotePath,
  commitSha: oldCommit, contentSha: oldTree, kind: "tree",
};
const initialRevision = {
  ...oldRevision, commitSha: newCommit, contentSha: newTree,
};
let corruptDownload = false;
let failDownload = false;
let unchangedRemote = false;
let executableBlob = false;
let configuredSkillsDirectory = ".skills";
let outsideFixtureTransaction;
let injectedShare;
let injectedShareName = "shared";
let injectForeignOnDownload = false;
let rateLimitPhase;
const urls = [];
const response = (value) => ({
  ok: true, status: 200,
  json: async () => value,
  arrayBuffer: async () => Uint8Array.from(value).buffer,
});
const request = async (url) => {
  urls.push(url);
  if ((rateLimitPhase === "revision-http" && url.endsWith("/commits/main")) ||
      (rateLimitPhase === "listing-http" && url.endsWith(`/contents/${remotePath}?ref=${newCommit}`)) ||
      (rateLimitPhase === "raw-http" &&
        url.startsWith(`https://raw.githubusercontent.com/octo/demo/${newCommit}/`))) {
    return new globalThis.Response("rate limit exceeded", {
      status: 429, headers: { "x-ratelimit-remaining": "0" },
    });
  }
  if ((rateLimitPhase === "revision" && url.endsWith("/commits/main")) ||
      (rateLimitPhase === "listing" && url.endsWith(`/contents/${remotePath}?ref=${newCommit}`)) ||
      ((rateLimitPhase === "raw" || rateLimitPhase === "root-rate") &&
        url.startsWith(`https://raw.githubusercontent.com/octo/demo/${newCommit}/`))) {
    throw new GitHubResponseError(
      rateLimitPhase === "root-rate" ? "other" : "rate-limit", 429,
      "private URL and sensitive failure text", undefined,
      rateLimitPhase === "root-rate" ? { rootCauseKind: "rate-limit" } : undefined,
    );
  }
  if (url.endsWith("/commits/main")) {
    return response(unchangedRemote
      ? { sha: oldCommit, commit: { tree: { sha: oldRoot } } }
      : { sha: newCommit, commit: { tree: { sha: newRoot } } });
  }
  if (url.endsWith(`/commits/${oldCommit}`)) {
    return response({ sha: oldCommit, commit: { tree: { sha: oldRoot } } });
  }
  for (const [rootSha, treeSha, files] of [
    [oldRoot, oldTree, oldFiles], [newRoot, newTree, newFiles],
  ]) {
    if (url.includes(`/git/trees/${rootSha}?recursive=1`)) {
      return response({
        sha: rootSha, truncated: false,
        tree: [
          { path: "skills", type: "tree", mode: "040000", sha: "1".repeat(40) },
          { path: remotePath, type: "tree", mode: "040000", sha: treeSha },
          ...Object.entries(files).map(([name, bytes]) => ({
            path: `${remotePath}/${name}`, type: "blob",
            mode: files === newFiles && name === "SKILL.md" && executableBlob ? "100755" : "100644",
            sha: gitBlob(bytes),
          })),
        ],
      });
    }
  }
  const listingMatch = /\/contents\/skills\/sample((?:\/[^?]+)?)\?ref=([0-9a-f]{40})$/.exec(url);
  if (listingMatch && (listingMatch[2] === newCommit || listingMatch[2] === oldCommit)) {
    const files = listingMatch[2] === newCommit ? newFiles : oldFiles;
    const base = decodeURIComponent(listingMatch[1]).replace(/^\//, "");
    const prefix = base ? `${base}/` : "";
    const seenDirectories = new Set();
    const listed = [];
    for (const name of Object.keys(files)) {
      if (!name.startsWith(prefix)) { continue; }
      const rest = name.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash < 0) {
        listed.push({ name: rest, type: "file", download_url: `https://example.invalid/${name}` });
      } else if (!seenDirectories.has(rest.slice(0, slash))) {
        seenDirectories.add(rest.slice(0, slash));
        listed.push({ name: rest.slice(0, slash), type: "dir" });
      }
    }
    return response(listed);
  }
  const oldRawPrefix = `https://raw.githubusercontent.com/octo/demo/${oldCommit}/${remotePath}/`;
  if (url.startsWith(oldRawPrefix)) {
    const bytes = oldFiles[decodeURIComponent(url.slice(oldRawPrefix.length))];
    assert.ok(bytes, `unexpected raw URL ${url}`);
    return response(bytes);
  }
  const rawPrefix = `https://raw.githubusercontent.com/octo/demo/${newCommit}/${remotePath}/`;
  if (url.startsWith(rawPrefix)) {
    if (failDownload) {
      if (injectForeignOnDownload) {
        const transaction = (await fsp.readdir(fixture)).find((name) =>
          name.startsWith(".resource-ninja-update-"));
        assert.ok(transaction);
        await fsp.writeFile(path.join(fixture, transaction, "candidate", "foreign.txt"), "preserve");
      }
      throw new Error("injected-download-failure");
    }
    const name = decodeURIComponent(url.slice(rawPrefix.length));
    const bytes = newFiles[name];
    assert.ok(bytes, `unexpected raw URL ${url}`);
    return response(corruptDownload ? Buffer.from("bad") : bytes);
  }
  throw new Error(`unexpected request ${url}`);
};

class Uri {
  constructor(fsPath) { this.fsPath = fsPath; this.scheme = "file"; }
  static file(value) { return new Uri(value); }
  static joinPath(base, ...segments) { return new Uri(path.join(base.fsPath, ...segments)); }
}
const vscode = {
  Uri,
  env: { remoteName: undefined },
  FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
  workspace: {
    workspaceFolders: [{ uri: Uri.file(workspace) }],
    getConfiguration: (section) => ({
      get: (_key, fallback) => fallback,
      inspect: (key) => section === "resourceNinja" && key === "resourcesDirectory"
        ? { workspaceFolderValue: configuredSkillsDirectory }
        : undefined,
    }),
    fs: {
    createDirectory: async (uri) => fsp.mkdir(uri.fsPath, { recursive: true }),
    writeFile: async (uri, bytes) => fsp.writeFile(uri.fsPath, bytes),
    readFile: async (uri) => fsp.readFile(uri.fsPath),
    stat: async (uri) => {
      const stat = await fsp.lstat(uri.fsPath);
      return { size: stat.size, type: stat.isFile() ? 1 : stat.isDirectory() ? 2 : 64 };
    },
    readDirectory: async (uri) => (await fsp.readdir(uri.fsPath, { withFileTypes: true }))
      .map((item) => [item.name, item.isFile() ? 1 : item.isDirectory() ? 2 : 64]),
  } },
};

const originalLoad = Module._load;
const originalTsLoader = require.extensions[".ts"];
const originalExecFile = childProcess.execFile;
// Each prepare asks PowerShell for the logical-disk type and shares (about 5 s here), which
// made this script run past the suite's 5-minute limit. The first query stays real so the
// actual PowerShell path is exercised once; later ones return the same local-disk answer.
let realShareQueryDone = false;
let shareQueryFailures = 0;
childProcess.execFile = function (file, args, options, callback) {
  const isShareQuery = Array.isArray(args) && args.includes("-Command");
  if (shareQueryFailures > 0 && isShareQuery) {
    shareQueryFailures--;
    queueMicrotask(() => callback(Object.assign(new Error("Command failed: timed out"), { killed: true }), "", ""));
    return {};
  }
  if (injectedShare && isShareQuery) {
    queueMicrotask(() => callback(null, JSON.stringify({
      drive: 3, shares: [{ Name: injectedShareName, Path: injectedShare }],
    }), ""));
    return {};
  }
  if (!injectedShare && realShareQueryDone && isShareQuery) {
    queueMicrotask(() => callback(null, JSON.stringify({ drive: 3, shares: [] }), ""));
    return {};
  }
  if (isShareQuery) { realShareQueryDone = true; }
  return originalExecFile.call(this, file, args, options, callback);
};
const hookedExecFile = childProcess.execFile;
hookedExecFile[require("node:util").promisify.custom] = (...args) =>
  new Promise((resolve, reject) => hookedExecFile(...args, (error, stdout, stderr) =>
    error ? reject(error) : resolve({ stdout, stderr })));
const unused = new Set([
  "./skillIndex", "./i18n", "./githubAuth", "./githubCredentialBlocklist",
  "./userDataPaths", "./pluginLocations",
  "./gitignoreManager", "./bugReport", "./hookConfigManager", "./mcpConfigManager",
]);
Module._load = function (name, parent, isMain) {
  if (name === "vscode") { return vscode; }
  if (name === "./githubFetch") { return { fetchGitHubWithOptionalAuthRetry: request }; }
  if (name === "./logger") { return { logger: { info() {}, warn() {}, error() {} } }; }
  if (name === "./skillIndex") { return { RETIRED_SOURCE_ALIASES: {} }; }
  if (unused.has(name)) { return {}; }
  return originalLoad.call(this, name, parent, isMain);
};
require.extensions[".ts"] = (loaded, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  loaded._compile(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText, filename);
};
const update = require(path.join(repo, "src", "workspaceSkillUpdate.ts"));
const pathSafety = require(path.join(repo, "src", "pathSafety.ts"));
const { GitHubResponseError } = require(path.join(repo, "src", "githubResponse.ts"));
childProcess.execFile = originalExecFile;
Module._load = originalLoad;
if (originalTsLoader) { require.extensions[".ts"] = originalTsLoader; }
else { delete require.extensions[".ts"]; }

const meta = () => ({
  name: "sample", source: "octo/demo", remotePath, description: "kept",
  categories: [], sourceRevision: oldRevision,
});
async function reset() {
  await fsp.rm(fixture, { recursive: true, force: true });
  await fsp.mkdir(target, { recursive: true });
  for (const [name, bytes] of Object.entries(oldFiles)) {
    await fsp.mkdir(path.dirname(path.join(target, name)), { recursive: true });
    await fsp.writeFile(path.join(target, name), bytes);
  }
  await fsp.writeFile(path.join(target, ".skill-meta.json"), JSON.stringify(meta()));
  urls.length = 0;
  corruptDownload = false;
  failDownload = false;
  injectForeignOnDownload = false;
  rateLimitPhase = undefined;
  unchangedRemote = false;
  executableBlob = false;
}
let roots = () => [Uri.file(skills)];
const prepare = (options = {}) => update.prepareWorkspaceSkillUpdate({
  workspace: Uri.file(workspace), target: Uri.file(target),
  getSkillsRoots: async () => roots(),
  ...options,
});
const approve = (candidate, options = {}) => ({
  candidateId: candidate.id, mode: "single", ...options,
});
const bytesAt = (name) => fsp.readFile(path.join(target, name));

async function main() {
  await reset();
  {
    const transaction = path.join(fixture, ".resource-ninja-update-recovery");
    const backup = path.join(transaction, "backup");
    await fsp.mkdir(transaction);
    await fsp.rename(target, backup);
    const identity = process.platform === "win32" ? target.toLowerCase() : target;
    const record = path.join(fixture, `.resource-ninja-recovery-${createHash("sha256").update(identity).digest("hex")}.json`);
    const value = { version: 1, workspace, target, transaction, backup };
    await fsp.writeFile(record, JSON.stringify(value));
    const discovered = await update.findWorkspaceRecoveryRecords(Uri.file(workspace));
    assert.ok(discovered.records.some((entry) => entry.record === record && entry.backup === backup), JSON.stringify(discovered));
    // A fresh install into the same skill folder is blocked while the record exists.
    const pendingOptions = { workspace: Uri.file(workspace), target: Uri.file(target), getSkillsRoots: async () => roots() };
    assert.equal(await update.hasPendingSkillRecovery(pendingOptions), true);
    assert.equal(await update.hasPendingSkillRecovery({ ...pendingOptions, target: Uri.file(path.join(skills, "other")) }), false);
    assert.equal(await update.hasPendingSkillRecovery({ ...pendingOptions, target: Uri.file(path.join(fixture, "outside", "x")) }), false);
    assert.equal(fs.existsSync(target), false);
    assert.equal(fs.existsSync(backup), true);
    assert.equal(JSON.parse(await fsp.readFile(record, "utf8")).target, target);

    await fsp.writeFile(record, JSON.stringify({ ...value, backup: path.join(fixture, "foreign") }));
    const rejected = await update.findWorkspaceRecoveryRecords(Uri.file(workspace));
    assert.ok(!rejected.records.some((entry) => entry.record === record));
    assert.equal(rejected.incomplete, true);
    assert.equal(fs.existsSync(backup), true);

    await fsp.writeFile(record, JSON.stringify({ ...value, workspace: path.join(fixture, "other") }));
    const otherWorkspace = await update.findWorkspaceRecoveryRecords(Uri.file(workspace));
    assert.ok(!otherWorkspace.records.some((entry) => entry.record === record));

    for (const invalid of ["{", "x".repeat(64 * 1024 + 1), JSON.stringify({ ...value, workspace: "." })]) {
      await fsp.writeFile(record, invalid);
      const unreadable = await update.findWorkspaceRecoveryRecords(Uri.file(workspace));
      assert.equal(unreadable.incomplete, true);
      assert.ok(!unreadable.records.some((entry) => entry.record === record));
      assert.equal(fs.existsSync(backup), true);
    }

    await fsp.writeFile(record, JSON.stringify(value));
    const originalOpen = fsp.open;
    fsp.open = async (location, ...args) => {
      if (location === record) { throw new Error("injected-record-read-failure"); }
      return originalOpen(location, ...args);
    };
    try {
      const unreadable = await update.findWorkspaceRecoveryRecords(Uri.file(workspace));
      assert.equal(unreadable.incomplete, true);
      assert.ok(!unreadable.records.some((entry) => entry.record === record));
    } finally { fsp.open = originalOpen; }
  }
  await reset();
  vscode.env.remoteName = "ssh-remote";
  let hostResult = await prepare();
  assert.equal(hostResult.status, "blocked");
  assert.equal(hostResult.reason, "remote-extension-host");
  assert.equal(urls.length, 0);
  vscode.env = {};
  hostResult = await prepare();
  assert.equal(hostResult.status, "blocked");
  assert.equal(hostResult.reason, "unknown-extension-host");
  vscode.env = { remoteName: undefined };

  if (process.platform === "win32") {
    // A cold or slow share query gets one more try; a second failure is a readable, fail-closed reason.
    await reset();
    shareQueryFailures = 1;
    const retried = await prepare();
    assert.equal(retried.status, "ready", `one failed share query is retried: ${retried.reason}`);
    assert.equal(shareQueryFailures, 0);
    await update.discardWorkspaceSkillUpdate(retried.candidate);
    await reset();
    shareQueryFailures = 2;
    const unknownShare = await prepare();
    assert.equal(unknownShare.status, "blocked");
    assert.equal(unknownShare.reason, "unknown-share-status");
    assert.equal(shareQueryFailures, 0);
    assert.deepEqual(await bytesAt("SKILL.md"), oldFiles["SKILL.md"], "nothing is changed");
  }

  await reset();
  let result = await prepare();
  assert.equal(result.status, "ready", result.reason);
  let candidate = result.candidate;
  assert.deepEqual(candidate.localChanges, []);
  assert.equal(candidate.synchronization, "unknown");
  assert.equal(candidate.sharing, "unknown");
  assert.equal(candidate.metadata.description, "kept");
  assert.ok(urls.some((url) => url.includes(`?ref=${newCommit}`)));
  assert.ok(!urls.some((url) => url.includes("/main/")));
  assert.deepEqual(await update.listWorkspaceSkillUpdateFiles(candidate), [
    { path: "SKILL.md", local: true, staged: true },
    { path: "data.bin", local: true, staged: true },
  ]);
  assert.deepEqual(Buffer.from(await update.readWorkspaceSkillUpdateFile(candidate, "local", "data.bin")), oldFiles["data.bin"]);
  assert.deepEqual(Buffer.from(await update.readWorkspaceSkillUpdateFile(candidate, "staged", "data.bin")), newFiles["data.bin"]);
  for (const invalid of ["../data.bin", "./SKILL.md", "sub\\file", "x//file", "/SKILL.md", ".skill-meta.json"]) {
    await assert.rejects(update.readWorkspaceSkillUpdateFile(candidate, "staged", invalid));
  }
  assert.equal((await update.applyWorkspaceSkillUpdate(candidate, {
    candidateId: "unapproved", mode: "single",
  })).status, "blocked");
  assert.deepEqual(await bytesAt("SKILL.md"), oldFiles["SKILL.md"]);
  const applied = await update.applyWorkspaceSkillUpdate(candidate, approve(candidate));
  assert.equal(applied.status, "updated", applied.reason);
  assert.deepEqual(await bytesAt("data.bin"), newFiles["data.bin"]);
  const nextMeta = JSON.parse(await bytesAt(".skill-meta.json"));
  assert.equal(nextMeta.sourceRevision.commitSha, newCommit);
  assert.equal(nextMeta.description, "kept");
  assert.equal(applied.backup, undefined);
  assert.deepEqual((await fsp.readdir(fixture)).sort(), ["workspace"]);
  assert.deepEqual((await fsp.readdir(skills)), ["sample"]);
  assert.equal((await update.applyWorkspaceSkillUpdate(candidate, approve(candidate))).status, "blocked");
  await assert.rejects(update.listWorkspaceSkillUpdateFiles(candidate));

  // An install or update holding the folder, a parent or a child stops the apply before any write.
  await reset();
  result = await prepare();
  assert.equal(result.status, "ready", result.reason);
  candidate = result.candidate;
  for (const claimed of [path.dirname(target), path.join(target, "nested"), target]) {
    const release = pathSafety.beginSkillPathOperation(claimed);
    assert.ok(release, claimed);
    const busy = await update.applyWorkspaceSkillUpdate(candidate, approve(candidate));
    assert.equal(busy.status, "blocked");
    assert.equal(busy.reason, "update-in-progress");
    assert.deepEqual(await bytesAt("SKILL.md"), oldFiles["SKILL.md"]);
    assert.equal(await update.discardWorkspaceSkillUpdate(candidate), "preserved");
    release();
  }
  assert.equal((await update.applyWorkspaceSkillUpdate(candidate, approve(candidate))).status, "updated");
  assert.equal(pathSafety.isSkillPathBusy(target), false);

  // An explicit reinstall can restore upstream even when the baseline already matches it.
  await reset();
  unchangedRemote = true;
  await fsp.writeFile(path.join(target, "SKILL.md"), "edited\n");
  assert.equal((await prepare()).status, "unchanged");
  result = await prepare({ forceReplace: true });
  assert.equal(result.status, "ready", result.reason);
  candidate = result.candidate;
  assert.deepEqual(candidate.localChanges, [{ path: "SKILL.md", kind: "modified" }]);
  assert.equal((await update.applyWorkspaceSkillUpdate(candidate, approve(candidate))).status, "blocked");
  assert.deepEqual(await bytesAt("SKILL.md"), Buffer.from("edited\n"));
  const forced = await update.applyWorkspaceSkillUpdate(candidate, approve(candidate, { overwriteLocalChanges: true }));
  assert.equal(forced.status, "updated", forced.reason);
  assert.deepEqual(await bytesAt("SKILL.md"), oldFiles["SKILL.md"]);
  assert.ok(forced.backup, "overwritten local edits keep the old copy");
  await reset();
  unchangedRemote = true;
  assert.equal((await prepare({ forceReplace: true })).status, "unchanged");

  await reset();
  const legacyMeta = { ...meta() };
  delete legacyMeta.sourceRevision;
  await fsp.writeFile(path.join(target, ".skill-meta.json"), JSON.stringify(legacyMeta));
  result = await prepare();
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "invalid-or-local-baseline");
  assert.deepEqual(await bytesAt("SKILL.md"), oldFiles["SKILL.md"]);

  await reset();
  await fsp.writeFile(path.join(target, "SKILL.md"), newFiles["SKILL.md"]);
  await fsp.writeFile(path.join(target, "data.bin"), newFiles["data.bin"]);
  await fsp.writeFile(path.join(target, ".skill-meta.json"), JSON.stringify(legacyMeta));
  result = await prepare({
    initialRevision,
    sourceId: "octo/demo",
  });
  assert.equal(result.status, "ready", result.reason);
  candidate = result.candidate;
  assert.deepEqual(candidate.localChanges, []);
  const firstSync = await update.applyWorkspaceSkillUpdate(
    candidate,
    approve(candidate, { mode: "bulk" }),
  );
  assert.equal(firstSync.status, "updated", firstSync.reason);
  assert.equal(JSON.parse(await bytesAt(".skill-meta.json")).sourceRevision.commitSha, newCommit);
  assert.deepEqual(await bytesAt("SKILL.md"), newFiles["SKILL.md"]);

  await reset();
  const previousSkill = newFiles["SKILL.md"];
  try {
    newFiles["SKILL.md"] = Buffer.from(
      "---\nname: sample\ndescription: Updated description\n---\n\n# Sample\n\n## When to Use\nUse for updated tasks.\n",
    );
    await fsp.writeFile(path.join(target, "SKILL.md"), newFiles["SKILL.md"]);
    await fsp.writeFile(path.join(target, "data.bin"), newFiles["data.bin"]);
    await fsp.writeFile(path.join(target, ".skill-meta.json"), JSON.stringify({
      ...legacyMeta,
      customWhenToUse: "Keep my custom text",
    }));
    result = await prepare({ initialRevision, sourceId: "octo/demo" });
    assert.equal(result.status, "ready", result.reason);
    const synced = await update.applyWorkspaceSkillUpdate(
      result.candidate,
      approve(result.candidate, { mode: "bulk" }),
    );
    assert.equal(synced.status, "updated", synced.reason);
    const syncedMeta = JSON.parse(await bytesAt(".skill-meta.json"));
    assert.equal(syncedMeta.description, "Updated description");
    assert.equal(syncedMeta.whenToUse, "Use for updated tasks.");
    assert.equal(syncedMeta.customWhenToUse, "Keep my custom text");
  } finally {
    newFiles["SKILL.md"] = previousSkill;
  }

  await reset();
  const originalReadFile = vscode.workspace.fs.readFile;
  vscode.workspace.fs.readFile = async (uri) => {
    if (uri.fsPath.includes(`${path.sep}candidate${path.sep}SKILL.md`)) {
      throw new Error("injected-staged-metadata-read-failure");
    }
    return originalReadFile(uri);
  };
  try {
    result = await prepare();
    assert.notEqual(result.status, "ready");
    assert.deepEqual(await bytesAt("SKILL.md"), oldFiles["SKILL.md"]);
    assert.equal(JSON.parse(await bytesAt(".skill-meta.json")).description, "kept");
  } finally {
    vscode.workspace.fs.readFile = originalReadFile;
  }

  await reset();
  await fsp.writeFile(path.join(target, ".skill-meta.json"), JSON.stringify(legacyMeta));
  result = await prepare({
    initialRevision,
    sourceId: "octo/demo",
  });
  assert.equal(result.status, "ready", result.reason);
  assert.deepEqual(
    result.candidate.localChanges.map((item) => `${item.path}:${item.kind}`).sort(),
    ["SKILL.md:modified", "data.bin:modified"].sort(),
  );
  candidate = result.candidate;
  assert.equal(candidate.firstSync, true);
  assert.equal((await update.applyWorkspaceSkillUpdate(candidate, approve(candidate, { mode: "bulk" }))).status, "blocked");
  const firstSyncEdited = await update.applyWorkspaceSkillUpdate(candidate, approve(candidate, { overwriteLocalChanges: true }));
  assert.equal(firstSyncEdited.status, "updated");
  assert.equal(firstSyncEdited.backup, undefined);
  assert.deepEqual(await bytesAt("SKILL.md"), newFiles["SKILL.md"]);
  assert.deepEqual(await fsp.readdir(fixture), ["workspace"]);

  await reset();
  await fsp.writeFile(path.join(target, ".skill-meta.json"), JSON.stringify(legacyMeta));
  result = await prepare({ initialRevision, sourceId: "octo/demo" });
  candidate = result.candidate;
  {
    const original = fsp.copyFile;
    let attempts = 0;
    fsp.copyFile = async (...args) => {
      if (++attempts === 2) { throw new Error("injected-copy-once"); }
      return original(...args);
    };
    try {
      const rolledBack = await update.applyWorkspaceSkillUpdate(candidate, approve(candidate, { overwriteLocalChanges: true }));
      assert.equal(rolledBack.status, "rolled-back");
      assert.equal(rolledBack.backup, undefined);
      assert.deepEqual(await bytesAt("SKILL.md"), oldFiles["SKILL.md"]);
      assert.deepEqual(await fsp.readdir(fixture), ["workspace"]);
    } finally { fsp.copyFile = original; }
  }

  await reset();
  await fsp.writeFile(path.join(target, ".skill-meta.json"), JSON.stringify(legacyMeta));
  result = await prepare({ initialRevision, sourceId: "octo/demo" });
  candidate = result.candidate;
  {
    const original = fsp.rmdir;
    fsp.rmdir = async (location, ...args) => {
      if (path.basename(location) === "candidate") { throw new Error("injected-cleanup-failure"); }
      return original(location, ...args);
    };
    try {
      const retained = await update.applyWorkspaceSkillUpdate(candidate, approve(candidate, { overwriteLocalChanges: true }));
      assert.equal(retained.status, "updated");
      assert.equal(retained.backup.fsPath, candidate.recoveryDirectory.fsPath);
      assert.deepEqual(await bytesAt("SKILL.md"), newFiles["SKILL.md"]);
      assert.deepEqual(await fsp.readFile(path.join(retained.backup.fsPath, "backup", "SKILL.md")), oldFiles["SKILL.md"]);
    } finally { fsp.rmdir = original; }
  }

  await reset();
  result = await prepare();
  candidate = result.candidate;
  vscode.env.remoteName = "wsl";
  const remoteApply = await update.applyWorkspaceSkillUpdate(candidate, approve(candidate));
  assert.equal(remoteApply.status, "blocked");
  assert.equal(remoteApply.reason, "remote-extension-host");
  assert.deepEqual(await bytesAt("SKILL.md"), oldFiles["SKILL.md"]);
  vscode.env.remoteName = undefined;
  await update.discardWorkspaceSkillUpdate(candidate);

  await reset();
  await fsp.unlink(path.join(target, "data.bin"));
  const blobPath = `${remotePath}/SKILL.md`;
  await fsp.writeFile(path.join(target, ".skill-meta.json"), JSON.stringify({
    ...meta(),
    remotePath: blobPath,
    sourceRevision: {
      ...oldRevision, remotePath: blobPath, kind: "blob",
      contentSha: gitBlob(oldFiles["SKILL.md"]),
    },
  }));
  result = await prepare();
  assert.equal(result.status, "ready", result.reason);
  candidate = result.candidate;
  assert.deepEqual(candidate.localChanges, []);
  assert.equal((await update.applyWorkspaceSkillUpdate(candidate, approve(candidate))).status, "updated");
  assert.deepEqual(await bytesAt("SKILL.md"), newFiles["SKILL.md"]);

  await reset();
  await fsp.unlink(path.join(target, "data.bin"));
  await fsp.writeFile(path.join(target, ".skill-meta.json"), JSON.stringify({
    ...meta(),
    remotePath: blobPath,
    sourceRevision: {
      ...oldRevision, remotePath: blobPath, kind: "blob",
      contentSha: gitBlob(oldFiles["SKILL.md"]),
    },
  }));
  executableBlob = true;
  result = await prepare();
  assert.equal(result.status, "ready", result.reason);
  assert.equal((await update.applyWorkspaceSkillUpdate(result.candidate, approve(result.candidate))).status, "updated");
  assert.deepEqual(await bytesAt("SKILL.md"), newFiles["SKILL.md"]);

  await reset();
  await fsp.writeFile(path.join(target, "data.bin"), Buffer.from([8, 0, 255]));
  unchangedRemote = true;
  result = await prepare();
  assert.equal(result.status, "unchanged");
  assert.deepEqual(result.localChanges, [{ path: "data.bin", kind: "modified" }]);
  assert.equal(result.metadata.description, "kept");
  assert.ok(!urls.some((url) => url.includes("/contents/")));

  await reset();
  await fsp.writeFile(path.join(target, "data.bin"), Buffer.from([0, 255, 3]));
  await fsp.unlink(path.join(target, "SKILL.md"));
  await fsp.writeFile(path.join(target, "extra.bin"), Buffer.from([0]));
  await fsp.mkdir(path.join(target, "empty"));
  result = await prepare();
  assert.equal(result.status, "ready", result.reason);
  candidate = result.candidate;
  assert.deepEqual(candidate.localChanges.map((item) => `${item.path}:${item.kind}`).sort(),
    ["SKILL.md:deleted", "data.bin:modified", "empty/:added", "extra.bin:added"].sort());
  assert.deepEqual(await update.listWorkspaceSkillUpdateFiles(candidate), [
    { path: "SKILL.md", local: false, staged: true },
    { path: "data.bin", local: true, staged: true },
    { path: "extra.bin", local: true, staged: false },
  ]);
  assert.deepEqual(Buffer.from(await update.readWorkspaceSkillUpdateFile(candidate, "local", "extra.bin")), Buffer.from([0]));
  await assert.rejects(update.readWorkspaceSkillUpdateFile(candidate, "local", "SKILL.md"));
  assert.equal((await update.applyWorkspaceSkillUpdate(candidate, approve(candidate, {
    mode: "bulk", overwriteLocalChanges: true,
  }))).status, "blocked");
  assert.equal((await update.applyWorkspaceSkillUpdate(candidate, approve(candidate))).status, "blocked");
  const overwritten = await update.applyWorkspaceSkillUpdate(candidate, approve(candidate, {
    overwriteLocalChanges: true,
  }));
  assert.equal(overwritten.status, "updated");
  assert.deepEqual(await fsp.readFile(path.join(overwritten.backup.fsPath, "data.bin")), Buffer.from([0, 255, 3]));
  assert.deepEqual(await fsp.readFile(path.join(overwritten.backup.fsPath, "extra.bin")), Buffer.from([0]));
  assert.equal((await fsp.readdir(candidate.recoveryDirectory.fsPath)).join(), "backup");

  await reset();
  result = await prepare();
  candidate = result.candidate;
  assert.equal((await update.applyWorkspaceSkillUpdate(candidate, approve(candidate),
    async () => "dirty")).status, "blocked");
  assert.equal((await update.applyWorkspaceSkillUpdate(candidate, approve(candidate),
    async () => "unknown")).status, "blocked");
  await fsp.writeFile(path.join(target, ".skill-meta.json"), JSON.stringify({ ...meta(), description: "changed" }));
  assert.equal((await update.applyWorkspaceSkillUpdate(candidate, approve(candidate))).status, "blocked");
  assert.deepEqual(await bytesAt("SKILL.md"), oldFiles["SKILL.md"]);
  await update.discardWorkspaceSkillUpdate(candidate);

  await reset();
  result = await prepare();
  candidate = result.candidate;
  let guardCalls = 0;
  const guard = async () => ++guardCalls === 2 ? "dirty" : "clean";
  assert.equal((await update.applyWorkspaceSkillUpdate(candidate, approve(candidate), guard)).status, "blocked");
  assert.deepEqual(await bytesAt("SKILL.md"), oldFiles["SKILL.md"]);
  await update.discardWorkspaceSkillUpdate(candidate);

  // A brief lock on the recovery record (antivirus, indexer) must not undo a finished switch.
  for (const code of ["EBUSY", "EPERM", "EACCES"]) {
    await reset();
    result = await prepare();
    candidate = result.candidate;
    const realUnlink = fsp.unlink;
    let lockedCalls = 0;
    fsp.unlink = async (location, ...rest) => {
      if (path.basename(String(location)).startsWith(".resource-ninja-recovery-") && ++lockedCalls <= 2) {
        throw Object.assign(new Error(`transient ${code}`), { code });
      }
      return realUnlink(location, ...rest);
    };
    let locked;
    try { locked = await update.applyWorkspaceSkillUpdate(candidate, approve(candidate)); }
    finally { fsp.unlink = realUnlink; }
    assert.equal(locked.status, "updated", `${code}: ${locked.reason}`);
    assert.equal(lockedCalls, 3, `${code}: retried until the record could be removed`);
    assert.deepEqual(await bytesAt("SKILL.md"), newFiles["SKILL.md"]);
    assert.ok(!(await fsp.readdir(fixture)).some((name) => name.startsWith(".resource-ninja-recovery-")), "the record is gone");
  }
  // A lock that never clears, or any other error, is not retried without bound.
  {
    await reset();
    result = await prepare();
    candidate = result.candidate;
    const realUnlink = fsp.unlink;
    let calls = 0;
    fsp.unlink = async (location, ...rest) => {
      if (path.basename(String(location)).startsWith(".resource-ninja-recovery-")) {
        calls++;
        throw Object.assign(new Error("locked"), { code: "EBUSY" });
      }
      return realUnlink(location, ...rest);
    };
    let stuck;
    try { stuck = await update.applyWorkspaceSkillUpdate(candidate, approve(candidate)); }
    finally { fsp.unlink = realUnlink; }
    assert.ok(calls >= 2 && calls <= 12, `bounded retries: ${calls}`);
    assert.notEqual(stuck.status, "blocked");
    for (const name of (await fsp.readdir(fixture)).filter((entry) => entry.startsWith(".resource-ninja-recovery-"))) {
      await fsp.rm(path.join(fixture, name), { force: true });
    }
  }

  await reset();
  result = await prepare();
  candidate = result.candidate;
  guardCalls = 0;
  const lateGuard = async () => ++guardCalls === 3 ? "dirty" : "clean";
  const lateResult = await update.applyWorkspaceSkillUpdate(candidate, approve(candidate), lateGuard);
  assert.equal(lateResult.status, "recovery-required");
  assert.deepEqual(await fsp.readFile(path.join(lateResult.backup.fsPath, "SKILL.md")), oldFiles["SKILL.md"]);
  const recordName = (await fsp.readdir(fixture)).find((name) => name.startsWith(".resource-ninja-recovery-"));
  assert.ok(recordName);
  const record = JSON.parse(await fsp.readFile(path.join(fixture, recordName), "utf8"));
  assert.equal(record.target, target);
  assert.equal(record.backup, lateResult.backup.fsPath);
  await fsp.mkdir(target);
  const pending = await prepare();
  assert.equal(pending.status, "blocked");
  assert.equal(pending.reason, "pending-recovery");
  assert.equal(pending.directory.fsPath, lateResult.backup.fsPath.replace(/[\\/]backup$/, ""));
  assert.deepEqual(await fsp.readdir(target), []);

  await reset();
  result = await prepare();
  candidate = result.candidate;
  const stageFile = path.join(candidate.recoveryDirectory.fsPath, "candidate", "SKILL.md");
  await fsp.writeFile(stageFile, "external change");
  await assert.rejects(update.listWorkspaceSkillUpdateFiles(candidate));
  await assert.rejects(update.readWorkspaceSkillUpdateFile(candidate, "local", "data.bin"));
  assert.equal((await update.applyWorkspaceSkillUpdate(candidate, approve(candidate))).status, "blocked");
  assert.equal(await update.discardWorkspaceSkillUpdate(candidate), "preserved");
  assert.equal(await fsp.readFile(stageFile, "utf8"), "external change");
  assert.deepEqual(await bytesAt("SKILL.md"), oldFiles["SKILL.md"]);

  await reset();
  result = await prepare();
  candidate = result.candidate;
  const replacementStageFile = path.join(candidate.recoveryDirectory.fsPath, "candidate", "SKILL.md");
  const replacementBytes = await fsp.readFile(replacementStageFile);
  await fsp.rename(replacementStageFile, `${replacementStageFile}.old`);
  await fsp.writeFile(replacementStageFile, replacementBytes);
  await fsp.unlink(`${replacementStageFile}.old`);
  await assert.rejects(update.listWorkspaceSkillUpdateFiles(candidate));
  assert.equal(await update.discardWorkspaceSkillUpdate(candidate), "preserved");

  await reset();
  result = await prepare();
  candidate = result.candidate;
  const localFile = path.join(target, "data.bin");
  await fsp.rename(localFile, `${localFile}.old`);
  await fsp.writeFile(localFile, oldFiles["data.bin"]);
  await fsp.unlink(`${localFile}.old`);
  await assert.rejects(update.listWorkspaceSkillUpdateFiles(candidate));
  assert.equal((await update.applyWorkspaceSkillUpdate(candidate, approve(candidate))).status, "blocked");
  await update.discardWorkspaceSkillUpdate(candidate);

  await reset();
  result = await prepare();
  assert.equal(result.status, "ready", result.reason);
  candidate = result.candidate;
  const duringReadFile = path.join(candidate.recoveryDirectory.fsPath, "candidate", "data.bin");
  const originalRead = fsp.readFile;
  let stageReads = 0;
  fsp.readFile = async (location, ...args) => {
    const bytes = await originalRead(location, ...args);
    if (location === duringReadFile && ++stageReads === 2) {
      await fsp.writeFile(duringReadFile, Buffer.from([4, 5]));
    }
    return bytes;
  };
  try { await assert.rejects(update.readWorkspaceSkillUpdateFile(candidate, "staged", "data.bin")); }
  finally { fsp.readFile = originalRead; }
  assert.equal(await update.discardWorkspaceSkillUpdate(candidate), "preserved");

  await reset();
  result = await prepare();
  candidate = result.candidate;
  await fsp.writeFile(path.join(target, "data.bin"), Buffer.from([1, 2]));
  await assert.rejects(update.listWorkspaceSkillUpdateFiles(candidate));
  await assert.rejects(update.readWorkspaceSkillUpdateFile(candidate, "staged", "data.bin"));
  await update.discardWorkspaceSkillUpdate(candidate);

  await reset();
  result = await prepare();
  candidate = result.candidate;
  const savedRename = fsp.rename;
  fsp.rename = async () => { throw new Error("injected-rename-failure"); };
  let renameFailure;
  try { renameFailure = await update.applyWorkspaceSkillUpdate(candidate, approve(candidate)); }
  finally { fsp.rename = savedRename; }
  assert.equal(renameFailure.status, "blocked");
  assert.equal((await fsp.readdir(fixture)).filter((name) => name.startsWith(".resource-ninja-recovery-")).length, 0);
  assert.deepEqual(await bytesAt("SKILL.md"), oldFiles["SKILL.md"]);
  assert.equal(await update.discardWorkspaceSkillUpdate(candidate), "discarded");

  await reset();
  result = await prepare();
  candidate = result.candidate;
  await fsp.writeFile(path.join(target, "data.bin"), Buffer.from([9]));
  assert.equal((await update.applyWorkspaceSkillUpdate(candidate, approve(candidate))).status, "blocked");
  assert.deepEqual(await bytesAt("data.bin"), Buffer.from([9]));
  await update.discardWorkspaceSkillUpdate(candidate);

  await reset();
  corruptDownload = true;
  result = await prepare();
  assert.equal(result.status, "cleanup-required");
  assert.ok(result.directory.fsPath);
  assert.ok(result.cleanupReason);
  assert.deepEqual(await bytesAt("SKILL.md"), oldFiles["SKILL.md"]);
  await reset();
  failDownload = true;
  injectForeignOnDownload = true;
  result = await prepare();
  assert.equal(result.status, "cleanup-required");
  assert.equal(await fsp.readFile(path.join(result.directory.fsPath, "candidate", "foreign.txt"), "utf8"), "preserve");
  assert.deepEqual(await bytesAt("SKILL.md"), oldFiles["SKILL.md"]);

  for (const phase of ["revision", "listing", "raw", "root-rate",
    "revision-http", "listing-http", "raw-http"]) {
    await reset();
    rateLimitPhase = phase;
    result = await prepare();
    assert.equal(result.status, phase.startsWith("revision") ? "blocked" : "cleanup-required");
    assert.equal(result.failureKind, "rate-limit");
    assert.equal(result.reason, "rate-limit");
    assert.ok(!JSON.stringify(result).includes("sensitive failure text"));
    if (phase === "raw" || phase === "root-rate" || phase === "raw-http") {
      assert.equal(urls.filter((url) => url.startsWith("https://raw.githubusercontent.com/")).length, 1);
    }
    assert.deepEqual(await bytesAt("SKILL.md"), oldFiles["SKILL.md"]);
  }

  await reset();
  const savedMkdir = fsp.mkdir;
  const savedRmdir = fsp.rmdir;
  fsp.mkdir = async (location, ...args) => {
    if (path.basename(location) === "candidate") { throw new Error("injected-stage-failure"); }
    return savedMkdir(location, ...args);
  };
  fsp.rmdir = async (location, ...args) => {
    if (path.basename(location).startsWith(".resource-ninja-update-")) {
      throw new Error("injected-cleanup-failure");
    }
    return savedRmdir(location, ...args);
  };
  try { result = await prepare(); }
  finally { fsp.mkdir = savedMkdir; fsp.rmdir = savedRmdir; }
  assert.equal(result.status, "cleanup-required");
  assert.equal(result.reason, "prepare-failed");
  assert.equal(result.cleanupReason, "cleanup-failed");
  assert.equal((await fsp.stat(result.directory.fsPath)).isDirectory(), true);

  await reset();
  const locallyEdited = Buffer.from([8, 0, 255, 7]);
  await fsp.writeFile(path.join(target, "data.bin"), locallyEdited);
  await fsp.writeFile(path.join(target, "local.txt"), "local content");
  const originalMetadata = await bytesAt(".skill-meta.json");
  result = await prepare();
  candidate = result.candidate;
  const originalCopy = fsp.copyFile;
  let copies = 0;
  fsp.copyFile = async (...args) => {
    if (++copies === 2) { throw new Error("injected-copy-once"); }
    return originalCopy(...args);
  };
  let failure;
  try {
    failure = await update.applyWorkspaceSkillUpdate(candidate, approve(candidate, {
      overwriteLocalChanges: true,
    }));
  } finally { fsp.copyFile = originalCopy; }
  assert.equal(failure.status, "rolled-back", failure.reason);
  assert.equal(failure.reason, "apply-failed");
  assert.deepEqual(await bytesAt("SKILL.md"), oldFiles["SKILL.md"]);
  assert.deepEqual(await bytesAt("data.bin"), locallyEdited);
  assert.equal(await fsp.readFile(path.join(target, "local.txt"), "utf8"), "local content");
  assert.deepEqual(await bytesAt(".skill-meta.json"), originalMetadata);
  assert.deepEqual(await fsp.readFile(path.join(failure.backup.fsPath, ".skill-meta.json")), originalMetadata);

  await reset();
  result = await prepare();
  candidate = result.candidate;
  copies = 0;
  fsp.copyFile = async (...args) => {
    if (++copies === 2) {
      await fsp.writeFile(path.join(target, "foreign.txt"), "preserve");
      throw new Error("injected-conflict");
    }
    return originalCopy(...args);
  };
  try { failure = await update.applyWorkspaceSkillUpdate(candidate, approve(candidate)); }
  finally { fsp.copyFile = originalCopy; }
  assert.equal(failure.status, "recovery-required");
  assert.equal(await fsp.readFile(path.join(target, "foreign.txt"), "utf8"), "preserve");
  assert.deepEqual(await fsp.readFile(path.join(failure.backup.fsPath, "SKILL.md")), oldFiles["SKILL.md"]);

  await reset();
  result = await prepare();
  candidate = result.candidate;
  const displaced = path.join(fixture, "displaced");
  fsp.copyFile = async () => {
    await fsp.rename(target, displaced);
    await fsp.mkdir(target);
    await fsp.writeFile(path.join(target, "foreign.txt"), "new owner");
    throw new Error("identity-conflict");
  };
  try { failure = await update.applyWorkspaceSkillUpdate(candidate, approve(candidate)); }
  finally { fsp.copyFile = originalCopy; }
  assert.equal(failure.status, "recovery-required");
  assert.equal(await fsp.readFile(path.join(target, "foreign.txt"), "utf8"), "new owner");
  assert.deepEqual(await fsp.readFile(path.join(failure.backup.fsPath, "SKILL.md")), oldFiles["SKILL.md"]);

  await reset();
  result = await prepare();
  candidate = result.candidate;
  fsp.copyFile = async () => {
    await fsp.writeFile(path.join(candidate.recoveryDirectory.fsPath, "backup", "data.bin"), "external edit");
    throw new Error("backup-conflict");
  };
  try { failure = await update.applyWorkspaceSkillUpdate(candidate, approve(candidate)); }
  finally { fsp.copyFile = originalCopy; }
  assert.equal(failure.status, "recovery-required");
  assert.equal(await fsp.readFile(path.join(failure.backup.fsPath, "data.bin"), "utf8"), "external edit");

  await reset();
  result = await prepare();
  candidate = result.candidate;
  copies = 0;
  fsp.copyFile = async (...args) => {
    if (++copies === 1) {
      await originalCopy(...args);
      throw new Error("injected-ambiguous-copy");
    }
    return originalCopy(...args);
  };
  try { failure = await update.applyWorkspaceSkillUpdate(candidate, approve(candidate)); }
  finally { fsp.copyFile = originalCopy; }
  assert.equal(failure.status, "recovery-required");
  assert.deepEqual(await fsp.readFile(path.join(failure.backup.fsPath, "SKILL.md")), oldFiles["SKILL.md"]);

  await reset();
  result = await prepare();
  candidate = result.candidate;
  fsp.copyFile = async () => { throw new Error("injected-copy-failure"); };
  try { failure = await update.applyWorkspaceSkillUpdate(candidate, approve(candidate)); }
  finally { fsp.copyFile = originalCopy; }
  assert.equal(failure.status, "recovery-required");
  assert.deepEqual(await fsp.readFile(path.join(failure.backup.fsPath, "SKILL.md")), oldFiles["SKILL.md"]);
  assert.equal(JSON.parse(await fsp.readFile(path.join(failure.backup.fsPath, ".skill-meta.json"))).sourceRevision.commitSha, oldCommit);

  await reset();
  result = await prepare();
  candidate = result.candidate;
  fsp.copyFile = async (...args) => {
    await originalCopy(...args);
    if (args[1] === path.join(target, ".skill-meta.json")) {
      await fsp.writeFile(path.join(target, "SKILL.md"), "changed after copy");
    }
  };
  try { failure = await update.applyWorkspaceSkillUpdate(candidate, approve(candidate)); }
  finally { fsp.copyFile = originalCopy; }
  assert.equal(failure.status, "recovery-required");
  assert.equal(failure.reason, "post-switch-verification-failed");
  assert.deepEqual(await fsp.readFile(path.join(failure.backup.fsPath, "SKILL.md")), oldFiles["SKILL.md"]);

  await reset();
  result = await prepare();
  candidate = result.candidate;
  const originalRename = fsp.rename;
  fsp.rename = async (...args) => {
    await originalRename(...args);
    if (args[0] === target) {
      await fsp.mkdir(target);
      await fsp.writeFile(path.join(target, "foreign.txt"), "preserve");
    }
  };
  try { failure = await update.applyWorkspaceSkillUpdate(candidate, approve(candidate)); }
  finally { fsp.rename = originalRename; }
  assert.equal(failure.status, "recovery-required");
  assert.equal(await fsp.readFile(path.join(target, "foreign.txt"), "utf8"), "preserve");
  assert.deepEqual(await fsp.readFile(path.join(failure.backup.fsPath, "SKILL.md")), oldFiles["SKILL.md"]);

  await reset();
  roots = () => [Uri.file(workspace)];
  result = await prepare();
  assert.equal(result.status, "ready", result.reason);
  candidate = result.candidate;
  assert.equal((await fsp.readdir(workspace)).filter((name) =>
    name.startsWith(".resource-ninja-update-")).length, 0);
  assert.equal((await fsp.readdir(fixture)).filter((name) =>
    name.startsWith(".resource-ninja-update-")).length, 1);
  roots = () => [Uri.file(fixture)];
  assert.equal((await update.applyWorkspaceSkillUpdate(candidate, approve(candidate))).status, "blocked");
  assert.deepEqual(await bytesAt("SKILL.md"), oldFiles["SKILL.md"]);
  await update.discardWorkspaceSkillUpdate(candidate);

  await reset();
  configuredSkillsDirectory = fixture;
  roots = () => [];
  result = await prepare();
  assert.equal(result.status, "ready", result.reason);
  candidate = result.candidate;
  outsideFixtureTransaction = candidate.recoveryDirectory.fsPath;
  assert.equal(path.dirname(candidate.recoveryDirectory.fsPath), repo);
  assert.equal(await update.discardWorkspaceSkillUpdate(candidate), "discarded");
  configuredSkillsDirectory = ".skills";
  roots = () => [Uri.file(skills)];

  await reset();
  roots = () => [Uri.file(path.parse(workspace).root)];
  result = await prepare();
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "no-safe-transaction-location");
  assert.deepEqual(await bytesAt("SKILL.md"), oldFiles["SKILL.md"]);

  await reset();
  roots = () => [Uri.file(skills)];
  if (process.platform === "win32") {
    injectedShare = workspace;
    try {
      result = await prepare();
      assert.equal(result.status, "blocked");
      assert.equal(result.reason, "shared-location");
    } finally { injectedShare = undefined; }
    // Only the stock Users share is exempt; a custom share that happens to use the name is not.
    injectedShare = workspace;
    injectedShareName = "Users";
    try {
      result = await prepare();
      assert.equal(result.status, "blocked");
      assert.equal(result.reason, "shared-location");
    } finally { injectedShare = undefined; injectedShareName = "shared"; }
  }
  await reset();
  const originalSync = process.env.OneDrive;
  process.env.OneDrive = workspace;
  try { assert.equal((await prepare()).status, "blocked"); }
  finally {
    if (originalSync === undefined) { delete process.env.OneDrive; }
    else { process.env.OneDrive = originalSync; }
  }
  await reset();
  roots = () => undefined;
  assert.equal((await prepare()).status, "blocked");

  await reset();
  roots = () => [Uri.file(skills)];
  await fsp.writeFile(path.join(target, ".skill-meta.json"), JSON.stringify({
    ...meta(), remotePath: "elsewhere",
  }));
  assert.equal((await prepare()).status, "blocked");

  await reset();
  const linkPath = path.join(target, "linked");
  await fsp.symlink(skills, linkPath, "junction");
  assert.equal((await prepare()).status, "blocked");

  await reset();
  await fsp.link(path.join(target, "data.bin"), path.join(target, "hardlink"));
  const hardLinked = await prepare();
  assert.equal(hardLinked.status, "blocked");
  assert.equal(hardLinked.reason, "linked-or-special-entry", "a hard link is not reported as a size problem");

  // --- Files above the in-memory hashing threshold (20 MiB) are no longer refused ---
  {
    const mib = 1024 * 1024;
    const big = (fill) => Buffer.alloc(21 * mib, fill);
    oldFiles["big.bin"] = big(1);
    newFiles["big.bin"] = big(2);
    try {
      await reset();
      result = await prepare();
      assert.equal(result.status, "ready", `a 21 MiB file must not block the update: ${result.reason}`);
      candidate = result.candidate;
      assert.deepEqual(candidate.localChanges, []);
      const listed = await update.listWorkspaceSkillUpdateFiles(candidate);
      const bigEntry = listed.find((entry) => entry.path === "big.bin");
      assert.ok(bigEntry && bigEntry.large === true && bigEntry.identical === false, JSON.stringify(bigEntry));
      const smallEntry = listed.find((entry) => entry.path === "data.bin");
      assert.ok(smallEntry && !smallEntry.large);
      await assert.rejects(update.readWorkspaceSkillUpdateFile(candidate, "local", "big.bin"));
      const bigUpdate = await update.applyWorkspaceSkillUpdate(candidate, approve(candidate, { mode: "bulk" }));
      assert.equal(bigUpdate.status, "updated", bigUpdate.reason);
      assert.ok((await bytesAt("big.bin")).equals(newFiles["big.bin"]));
      assert.deepEqual((await fsp.readdir(fixture)).sort(), ["workspace"]);

      // A same-size edit of a large file is a saved local edit, found by hashing against upstream.
      await reset();
      const edited = big(1);
      edited[0] = 9;
      await fsp.writeFile(path.join(target, "big.bin"), edited);
      result = await prepare();
      assert.equal(result.status, "ready", result.reason);
      assert.deepEqual(result.candidate.localChanges, [{ path: "big.bin", kind: "modified" }]);
      assert.equal((await update.applyWorkspaceSkillUpdate(result.candidate, approve(result.candidate, { mode: "bulk" }))).status, "blocked");
      assert.ok((await bytesAt("big.bin")).equals(edited), "the large edit is untouched without approval");
      const overwritten = await update.applyWorkspaceSkillUpdate(result.candidate, approve(result.candidate, { overwriteLocalChanges: true }));
      assert.equal(overwritten.status, "updated", overwritten.reason);
      assert.ok(overwritten.backup, "overwritten edits keep the old copy");
      assert.ok((await fsp.readFile(path.join(overwritten.backup.fsPath, "big.bin"))).equals(edited));

      // The same size and the same modification time are not a change between snapshots, but the
      // content is checked once more against what was reviewed right before the switch. A file time
      // cannot be restored exactly from Node, so the time of this one file is frozen instead.
      await reset();
      const realLstat = fsp.lstat;
      fsp.lstat = async (location, options) => {
        const stat = await realLstat(location, options);
        return options?.bigint && String(location).endsWith("big.bin")
          ? Object.create(stat, { mtimeNs: { value: 1n } })
          : stat;
      };
      try {
        result = await prepare();
        assert.equal(result.status, "ready", result.reason);
        const bigPath = path.join(target, "big.bin");
        const sneaky = big(1);
        sneaky[5] = 7;
        await fsp.writeFile(bigPath, sneaky);
        const sneakyApply = await update.applyWorkspaceSkillUpdate(result.candidate, approve(result.candidate, { mode: "bulk" }));
        assert.equal(sneakyApply.status, "blocked", "a content change that kept size and time must still stop the switch");
        assert.ok((await bytesAt("big.bin")).equals(sneaky));
        await update.discardWorkspaceSkillUpdate(result.candidate);
      } finally { fsp.lstat = realLstat; }

      // A copy that fails its byte check is still ours, so the switch is rolled back, not left half-built.
      await reset();
      result = await prepare();
      assert.equal(result.status, "ready", result.reason);
      const realCopy = fsp.copyFile;
      let corruptedCopies = 0;
      fsp.copyFile = async (...args) => {
        await realCopy(...args);
        if (String(args[1]).replace(/\\/g, "/").endsWith("/sample/big.bin") && ++corruptedCopies === 1) {
          await fsp.writeFile(args[1], Buffer.from([9]), { flag: "r+" });
        }
      };
      let unverified;
      try { unverified = await update.applyWorkspaceSkillUpdate(result.candidate, approve(result.candidate, { mode: "bulk" })); }
      finally { fsp.copyFile = realCopy; }
      assert.equal(unverified.status, "rolled-back", unverified.reason);
      assert.ok((await bytesAt("big.bin")).equals(oldFiles["big.bin"]), "the previous copy is back");
      assert.ok(unverified.backup, "the old copy is kept after a rolled-back switch");
      assert.ok((await fsp.readFile(path.join(unverified.backup.fsPath, "big.bin"))).equals(oldFiles["big.bin"]));
      await update.discardWorkspaceSkillUpdate(result.candidate);

      // An unchanged large file is not an update: nothing is staged.
      await reset();
      unchangedRemote = true;
      assert.equal((await prepare()).status, "unchanged");
      unchangedRemote = false;

      // Above the absolute cap the update is still refused, before anything is written.
      await reset();
      await fsp.writeFile(path.join(target, "huge.bin"), Buffer.alloc(0));
      await fsp.truncate(path.join(target, "huge.bin"), 101 * mib);
      result = await prepare();
      assert.equal(result.status, "blocked");
      assert.equal(result.reason, "unsafe-or-oversize-file");
      assert.deepEqual(await bytesAt("SKILL.md"), oldFiles["SKILL.md"]);

      // The install-time baseline check streams a large file instead of declining to verify it.
      const installer = require(path.join(repo, "src", "skillInstaller.ts"));
      const verifyDirectory = path.join(fixture, "verify");
      await fsp.rm(verifyDirectory, { recursive: true, force: true });
      await fsp.mkdir(verifyDirectory, { recursive: true });
      const verifyFiles = { "SKILL.md": Buffer.from("verify\n"), "big.bin": big(3) };
      for (const [name, bytes] of Object.entries(verifyFiles)) {
        await fsp.writeFile(path.join(verifyDirectory, name), bytes);
      }
      await fsp.writeFile(path.join(verifyDirectory, ".skill-meta.json"), "{}");
      const listing = Object.entries(verifyFiles).map(([name, bytes]) => ({ path: name, sha: gitBlob(bytes), mode: "100644" }));
      const verifyRevision = { ...oldRevision, kind: "tree" };
      const verify = () => installer.directoryMatchesRevision(
        Uri.file(verifyDirectory), verifyRevision, { listFiles: async () => listing }, ".skill-meta.json");
      assert.equal(await verify(), true, "a 21 MiB file that matches its Git object verifies");
      const corrupted = big(3);
      corrupted[corrupted.length - 1] = 4;
      await fsp.writeFile(path.join(verifyDirectory, "big.bin"), corrupted);
      assert.equal(await verify(), false, "a same-size change is not a match");
      await fsp.writeFile(path.join(verifyDirectory, "big.bin"), Buffer.alloc(0));
      await fsp.truncate(path.join(verifyDirectory, "big.bin"), 101 * mib);
      assert.equal(await verify(), false, "a file above the absolute cap is not verified");
      await fsp.rm(verifyDirectory, { recursive: true, force: true });
    } finally {
      delete oldFiles["big.bin"];
      delete newFiles["big.bin"];
    }
  }

  // --- Independent child skills are carried into the new copy, not treated as local edits ---
  {
    const writeChild = async (name, files, metadata = { name, source: "other/repo", remotePath: `skills/${name}` }) => {
      const dir = path.join(target, ...name.split("/"));
      await fsp.mkdir(dir, { recursive: true });
      for (const [file, bytes] of Object.entries(files)) {
        await fsp.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
        await fsp.writeFile(path.join(dir, file), bytes);
      }
      if (metadata) { await fsp.writeFile(path.join(dir, ".skill-meta.json"), JSON.stringify(metadata)); }
    };
    await reset();
    await writeChild("child", { "SKILL.md": "child skill\n", "refs/data.txt": "child data\n", "payload.bin": Buffer.from([0, 255, 3]) });
    result = await prepare();
    assert.equal(result.status, "ready", result.reason);
    candidate = result.candidate;
    assert.deepEqual(candidate.localChanges, [], "an independent child is not a local edit");
    assert.deepEqual(candidate.carriedChildren, ["child"]);
    const files = (await update.listWorkspaceSkillUpdateFiles(candidate)).map((entry) => entry.path);
    assert.ok(files.includes("child/SKILL.md"));
    const childBulk = await update.applyWorkspaceSkillUpdate(candidate, approve(candidate, { mode: "bulk" }));
    assert.equal(childBulk.status, "updated", childBulk.reason);
    assert.deepEqual(await bytesAt("SKILL.md"), newFiles["SKILL.md"]);
    assert.equal((await bytesAt("child/SKILL.md")).toString(), "child skill\n");
    assert.equal((await bytesAt("child/refs/data.txt")).toString(), "child data\n");
    assert.deepEqual(await bytesAt("child/payload.bin"), Buffer.from([0, 255, 3]));
    assert.equal(JSON.parse(await bytesAt("child/.skill-meta.json")).name, "child");
    assert.deepEqual((await fsp.readdir(fixture)).sort(), ["workspace"], "the old copy is removed once the child is verified in place");

    // A folder without a valid sidecar, or with only a SKILL.md, stays an ordinary local addition.
    for (const [label, metadata, fileSet] of [
      ["no sidecar", null, { "SKILL.md": "x\n" }],
      ["sidecar without name", { source: "other/repo" }, { "SKILL.md": "x\n" }],
      ["sidecar without a SKILL.md", { name: "c", source: "other/repo" }, { "notes.txt": "x\n" }],
    ]) {
      await reset();
      await writeChild("child", fileSet, metadata);
      result = await prepare();
      assert.equal(result.status, "ready", `${label}: ${result.reason}`);
      assert.ok(result.candidate.localChanges.length > 0, `${label} must stay a local addition`);
      assert.ok(!result.candidate.carriedChildren?.length, label);
      await update.discardWorkspaceSkillUpdate(result.candidate);
    }

    // A child of the same path as an upstream folder is compared normally, never carried.
    oldFiles["bundled/SKILL.md"] = Buffer.from("bundled old\n");
    newFiles["bundled/SKILL.md"] = Buffer.from("bundled new\n");
    try {
      await reset();
      await writeChild("bundled", { "SKILL.md": "bundled old\n" }, { name: "bundled", source: "octo/demo", remotePath });
      result = await prepare();
      assert.equal(result.status, "ready", result.reason);
      assert.ok(!result.candidate.carriedChildren?.length);
      assert.ok(result.candidate.localChanges.some((change) => change.path === "bundled/.skill-meta.json" && change.kind === "added"));
      await update.discardWorkspaceSkillUpdate(result.candidate);
    } finally {
      delete oldFiles["bundled/SKILL.md"];
      delete newFiles["bundled/SKILL.md"];
    }

    // A child that changes after the review stops the switch; a child with a link is refused up front.
    await reset();
    await writeChild("child", { "SKILL.md": "child skill\n" });
    result = await prepare();
    assert.equal(result.status, "ready", result.reason);
    await fsp.writeFile(path.join(target, "child", "SKILL.md"), "edited after review\n");
    assert.equal((await update.applyWorkspaceSkillUpdate(result.candidate, approve(result.candidate, { mode: "bulk" }))).status, "blocked");
    assert.equal((await bytesAt("child/SKILL.md")).toString(), "edited after review\n");
    await update.discardWorkspaceSkillUpdate(result.candidate);
    await reset();
    await writeChild("child", { "SKILL.md": "child skill\n" });
    await fsp.symlink(skills, path.join(target, "child", "linked"), "junction");
    assert.equal((await prepare()).status, "blocked");

    // A child under a folder that upstream no longer has cannot be placed in the new copy: stop early.
    oldFiles["gone/SKILL.md"] = Buffer.from("gone\n");
    try {
      await reset();
      await writeChild("gone/child", { "SKILL.md": "child skill\n" });
      result = await prepare();
      assert.equal(result.status, "blocked");
      assert.equal(result.reason, "child-conflicts-with-upstream");
      assert.equal((await bytesAt("gone/child/SKILL.md")).toString(), "child skill\n");
      assert.deepEqual((await fsp.readdir(fixture)).sort(), ["workspace"], "nothing is staged");
    } finally {
      delete oldFiles["gone/SKILL.md"];
    }

    // A failed switch restores the child along with the rest.
    await reset();
    await writeChild("child", { "SKILL.md": "child skill\n", "refs/data.txt": "child data\n" });
    result = await prepare();
    assert.equal(result.status, "ready", result.reason);
    const originalCopyFile = fsp.copyFile;
    let copies = 0;
    fsp.copyFile = async (...args) => {
      if (String(args[1]).replace(/\\/g, "/").includes("/sample/child/") && ++copies === 1) {
        throw new Error("injected-copy-failure");
      }
      return originalCopyFile(...args);
    };
    let failed;
    try { failed = await update.applyWorkspaceSkillUpdate(result.candidate, approve(result.candidate, { mode: "bulk" })); }
    finally { fsp.copyFile = originalCopyFile; }
    assert.equal(failed.status, "rolled-back", failed.reason);
    assert.deepEqual(await bytesAt("SKILL.md"), oldFiles["SKILL.md"]);
    assert.equal((await bytesAt("child/refs/data.txt")).toString(), "child data\n");
  }
  console.log("workspace skill update tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (outsideFixtureTransaction && path.dirname(outsideFixtureTransaction) === repo &&
      path.basename(outsideFixtureTransaction).startsWith(".resource-ninja-update-")) {
    await fsp.rm(outsideFixtureTransaction, { recursive: true, force: true });
  }
  await fsp.rm(fixture, { recursive: true, force: true });
});
