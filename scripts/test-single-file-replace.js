#!/usr/bin/env node
/* global require, __dirname, Buffer, console, process */
// A single-file reinstall keeps the current copy until the replacement is written, and puts it back on failure.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

function requireTypeScriptModule(filePath) {
  const compiled = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filePath,
  });
  const loaded = new Module(filePath, module);
  loaded.filename = filePath;
  loaded.paths = Module._nodeModulePaths(path.dirname(filePath));
  loaded._compile(compiled.outputText, filePath);
  return loaded.exports;
}

const replace = requireTypeScriptModule(path.join(__dirname, "..", "src", "singleFileReplace.ts"));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "resource-ninja-single-file-"));
const backups = path.join(temp, "backups");
let counter = 0;

function fixture(withMetadata = true) {
  const dir = path.join(temp, `case-${++counter}`);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, "demo.agent.md");
  const metadata = `${target}.resource-ninja.json`;
  fs.writeFileSync(target, "old agent\n");
  if (withMetadata) {
    fs.writeFileSync(metadata, '{"installedAt":"old"}');
  }
  return { target, metadata };
}
const text = (location) => fs.readFileSync(location, "utf8");
const backupCount = () => (fs.existsSync(backups) ? fs.readdirSync(backups).length : 0);

async function test(name, run) {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

async function capture(files) {
  const result = await replace.captureSingleFile(files.target, files.metadata);
  assert.equal(result.status, "captured");
  return result.snapshot;
}

async function main() {
  await test("a clean replacement keeps no backup", async () => {
    const files = fixture();
    const snapshot = await capture(files);
    const result = await replace.replaceSingleFile(snapshot, backups, async () => {
      fs.writeFileSync(files.target, "new agent\n");
      fs.writeFileSync(files.metadata, '{"installedAt":"new"}');
      return true;
    });
    assert.deepEqual(result, { status: "updated" });
    assert.equal(text(files.target), "new agent\n");
    assert.equal(backupCount(), 0);
  });

  await test("a failure after the file was overwritten restores the file and its metadata", async () => {
    const files = fixture();
    const snapshot = await capture(files);
    const result = await replace.replaceSingleFile(snapshot, backups, async () => {
      fs.writeFileSync(files.target, "half written");
      fs.writeFileSync(files.metadata, "garbage");
      throw new Error("download failed after writing");
    });
    assert.deepEqual(result, { status: "restored" });
    assert.equal(text(files.target), "old agent\n");
    assert.equal(text(files.metadata), '{"installedAt":"old"}');
    assert.equal(backupCount(), 0);
  });

  await test("an incomplete result restores too, and a missing sidecar stays missing", async () => {
    const files = fixture(false);
    const snapshot = await capture(files);
    const result = await replace.replaceSingleFile(snapshot, backups, async () => {
      fs.writeFileSync(files.target, "partial");
      fs.writeFileSync(files.metadata, "created by the failed install");
      return false;
    });
    assert.deepEqual(result, { status: "restored" });
    assert.equal(text(files.target), "old agent\n");
    assert.equal(fs.existsSync(files.metadata), false);
  });

  await test("a failure before any write changes nothing", async () => {
    const files = fixture();
    const snapshot = await capture(files);
    const result = await replace.replaceSingleFile(snapshot, backups, async () => false);
    assert.deepEqual(result, { status: "restored" });
    assert.equal(text(files.target), "old agent\n");
    assert.equal(text(files.metadata), '{"installedAt":"old"}');
  });

  await test("a copy that cannot be restored keeps a backup and reports where", async () => {
    const files = fixture();
    const snapshot = await capture(files);
    const result = await replace.replaceSingleFile(snapshot, backups, async () => {
      fs.rmSync(files.target);
      fs.mkdirSync(files.target);
      return false;
    });
    assert.equal(result.status, "restore-failed");
    assert.equal(text(path.join(result.backup, "resource")), "old agent\n");
    assert.equal(text(path.join(result.backup, "metadata")), '{"installedAt":"old"}');
  });

  await test("a change after the check stops the reinstall before the replacement runs", async () => {
    const files = fixture();
    const snapshot = await capture(files);
    fs.writeFileSync(files.target, "edited meanwhile");
    let ran = false;
    const result = await replace.replaceSingleFile(snapshot, backups, async () => {
      ran = true;
      return true;
    });
    assert.deepEqual(result, { status: "changed" });
    assert.equal(ran, false);
    assert.equal(text(files.target), "edited meanwhile");

    const second = fixture();
    const secondSnapshot = await capture(second);
    fs.writeFileSync(second.metadata, '{"installedAt":"other window"}');
    assert.deepEqual(
      await replace.replaceSingleFile(secondSnapshot, backups, async () => { ran = true; return true; }),
      { status: "changed" },
    );
    assert.equal(ran, false);
  });

  await test("unsafe or missing files are refused at capture time", async () => {
    const files = fixture();
    const missing = await replace.captureSingleFile(path.join(temp, "nope.md"), path.join(temp, "nope.md.resource-ninja.json"));
    assert.deepEqual(missing, { status: "refused", reason: "not-a-file" });
    const large = await replace.captureSingleFile(files.target, files.metadata, 3);
    assert.deepEqual(large, { status: "refused", reason: "too-large" });
    const folder = await replace.captureSingleFile(temp, files.metadata);
    assert.deepEqual(folder, { status: "refused", reason: "not-a-file" });
    const link = path.join(temp, "link.agent.md");
    try {
      fs.symlinkSync(files.target, link, "file");
    } catch {
      console.log("SKIP link case: this host cannot create file links");
      return;
    }
    assert.deepEqual(await replace.captureSingleFile(link, `${link}.resource-ninja.json`), {
      status: "refused",
      reason: "linked",
    });
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(temp, { recursive: true, force: true }));
