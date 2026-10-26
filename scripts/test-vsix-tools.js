#!/usr/bin/env node
// The release gates trust compareRuntimeAssets, so it must catch a changed,
// missing or extra-empty runtime asset, not just agree when nothing changed.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const {
  compareRuntimeAssets,
  findDevBuildMarkers,
  readZipBuffer,
  runtimeAssetPaths,
} = require("./vsix-tools");

function buildZip(files) {
  const parts = [];
  for (const [name, content, deflate] of files) {
    const nameBuffer = Buffer.from(name, "utf8");
    const data = Buffer.from(content);
    const stored = deflate ? zlib.deflateRawSync(data) : data;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(deflate ? 8 : 0, 8);
    header.writeUInt32LE(zlib.crc32(data), 14);
    header.writeUInt32LE(stored.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBuffer.length, 26);
    parts.push(header, nameBuffer, stored);
  }
  return Buffer.concat(parts);
}

const files = {
  "dist/extension.js": "console.log('runtime');\n",
  "package.nls.json": '{"a":"b"}\n',
  "package.nls.ja.json": '{"a":"ｂ"}\n',
  "resources/skill-index.json": '{"skills":[]}\n',
};
const archive = readZipBuffer(
  buildZip([
    ...Object.entries(files).map(([name, content], index) => [
      `extension/${name}`,
      content,
      index % 2 === 0,
    ]),
  ]),
);
const paths = runtimeAssetPaths({ main: "./dist/extension.js" });

function installedCopy(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vsix-tools-"));
  for (const [name, content] of Object.entries({ ...files, ...overrides })) {
    if (content === null) {
      continue;
    }
    const target = path.join(root, ...name.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

check("the ZIP reader returns stored and deflated entries unchanged", () => {
  for (const [name, content] of Object.entries(files)) {
    assert.strictEqual(archive.get(`extension/${name}`).toString("utf8"), content);
  }
});

check("the runtime asset list names the compiled entrypoint and data", () => {
  assert.deepStrictEqual(paths, [
    "dist/extension.js",
    "package.nls.json",
    "package.nls.ja.json",
    "resources/skill-index.json",
  ]);
});

check("an identical installed copy has no problems", () => {
  const root = installedCopy();
  try {
    assert.deepStrictEqual(compareRuntimeAssets(archive, root, paths), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

check("a changed compiled entrypoint is reported", () => {
  const root = installedCopy({ "dist/extension.js": "console.log('tampered');\n" });
  try {
    assert.deepStrictEqual(compareRuntimeAssets(archive, root, paths), [
      "dist/extension.js: installed bytes differ from the VSIX",
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

check("a missing installed asset and a missing packaged asset are reported", () => {
  const root = installedCopy({ "resources/skill-index.json": null });
  try {
    assert.deepStrictEqual(compareRuntimeAssets(archive, root, paths), [
      "resources/skill-index.json: missing from the installed copy",
    ]);
    assert.deepStrictEqual(
      compareRuntimeAssets(archive, root, ["dist/other.js"]),
      ["dist/other.js: missing from the VSIX"],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

check("a development bundle is told apart from a production bundle", () => {
  assert.deepStrictEqual(
    findDevBuildMarkers(Buffer.from("console.log(1);\n//# sourceMappingURL=extension.js.map\n")),
    ["entrypoint references a sourcemap (development build)"],
  );
  assert.deepStrictEqual(
    findDevBuildMarkers(Buffer.from(files["dist/extension.js"])),
    [],
  );
});

console.log("RESULT=PASS");
