// Shared VSIX helpers for the release gates (hygiene test, install/readback gate).
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

function readZipBuffer(buffer) {
  const entries = new Map();
  let offset = 0;
  const localHeader = 0x04034b50;
  while (
    offset + 30 <= buffer.length &&
    buffer.readUInt32LE(offset) === localHeader
  ) {
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const name = buffer.toString("utf8", nameStart, nameEnd);
    const dataStart = nameEnd + extraLength;
    let compressedDataEnd = dataStart + compressedSize;
    let dataEnd = compressedDataEnd;

    if (flags & 0x08) {
      const descriptorSignature = 0x08074b50;
      const descriptorOffset = buffer.indexOf(
        Buffer.from([0x50, 0x4b, 0x07, 0x08]),
        dataStart,
      );
      assert.ok(
        descriptorOffset !== -1,
        `Missing ZIP data descriptor for ${name}`,
      );
      compressedDataEnd = descriptorOffset;
      dataEnd = descriptorOffset + 16;
      assert.strictEqual(
        buffer.readUInt32LE(descriptorOffset),
        descriptorSignature,
      );
    } else if (method !== 0 && method !== 8) {
      throw new Error(`Unsupported ZIP method ${method} for ${name}`);
    }

    const compressed = buffer.subarray(dataStart, compressedDataEnd);
    entries.set(
      name,
      method === 8 ? zlib.inflateRawSync(compressed) : Buffer.from(compressed),
    );

    offset = dataEnd;
  }
  return entries;
}

function readZipContents(filePath) {
  return readZipBuffer(fs.readFileSync(filePath));
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * The files an installed copy must carry byte for byte from the VSIX: the
 * compiled entrypoint and the data it reads at runtime. package.json is left
 * out because VS Code rewrites it with install metadata.
 */
function runtimeAssetPaths(packageJson) {
  const main = String(packageJson.main || "")
    .replace(/^\.\//, "")
    .replace(/\\/g, "/");
  return [
    main,
    "package.nls.json",
    "package.nls.ja.json",
    "resources/skill-index.json",
  ].filter(Boolean);
}

/** Returns one message per runtime asset that is missing or differs between the VSIX entries and a directory. */
function compareRuntimeAssets(archive, installedRoot, relativePaths) {
  const problems = [];
  for (const relativePath of relativePaths) {
    const packaged = archive.get(`extension/${relativePath}`);
    if (!packaged) {
      problems.push(`${relativePath}: missing from the VSIX`);
      continue;
    }
    const installedPath = path.join(installedRoot, ...relativePath.split("/"));
    if (!fs.existsSync(installedPath)) {
      problems.push(`${relativePath}: missing from the installed copy`);
      continue;
    }
    if (sha256(fs.readFileSync(installedPath)) !== sha256(packaged)) {
      problems.push(`${relativePath}: installed bytes differ from the VSIX`);
    }
  }
  return problems;
}

/** A development bundle points at its sourcemap; a production package must not. */
function findDevBuildMarkers(entrypoint) {
  const text = entrypoint.toString("utf8");
  return /\/\/# sourceMappingURL=/.test(text)
    ? ["entrypoint references a sourcemap (development build)"]
    : [];
}

module.exports = {
  compareRuntimeAssets,
  findDevBuildMarkers,
  readZipBuffer,
  readZipContents,
  runtimeAssetPaths,
  sha256,
};
