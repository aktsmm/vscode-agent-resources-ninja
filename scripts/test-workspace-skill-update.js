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
  if (url.endsWith(`/contents/${remotePath}?ref=${newCommit}`)) {
    return response(Object.keys(newFiles).map((name) => ({
      name, type: "file", download_url: `https://example.invalid/${name}`,
    })));
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
childProcess.execFile = function (file, args, options, callback) {
  if (injectedShare && args.includes("-Command")) {
    queueMicrotask(() => callback(null, JSON.stringify({
      drive: 3, shares: [{ Name: injectedShareName, Path: injectedShare }],
    }), ""));
    return {};
  }
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
  assert.equal((await prepare()).status, "blocked");
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
