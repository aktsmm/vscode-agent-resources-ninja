#!/usr/bin/env node

// User-visible behaviour has to be documented before it ships, and this repository
// keeps CHANGELOG entries bilingual. These checks are cheap and catch the common slips.

const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const changelog = fs.readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
);

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function getSections() {
  const lines = changelog.split(/\r?\n/);
  const sections = [];
  let current;

  for (const line of lines) {
    const heading = line.match(/^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?/);
    if (heading) {
      current = { version: heading[1], date: heading[2], entries: [] };
      sections.push(current);
      continue;
    }
    if (current && /^- /.test(line)) {
      current.entries.push(line);
    }
  }

  return sections;
}

const sections = getSections();

function getVersionSection(text, version) {
  const normalized = text.replace(/\r\n/g, "\n");
  const start = normalized.indexOf(`## [${version}]`);
  if (start < 0) return undefined;
  const next = normalized.indexOf("\n## [", start + 1);
  return normalized.slice(start, next < 0 ? undefined : next).trimEnd();
}

test("the changelog keeps an Unreleased section at the top", () => {
  assert.ok(sections.length > 0, "CHANGELOG has no version sections");
  assert.strictEqual(
    sections[0].version,
    "Unreleased",
    "The first section must be [Unreleased]",
  );
  assert.strictEqual(
    sections[0].date,
    undefined,
    "The Unreleased section must not carry a release date",
  );
});

test("released sections carry a date and are unique", () => {
  const seen = new Set();
  for (const section of sections.slice(1)) {
    assert.match(
      section.version,
      /^\d+\.\d+\.\d+$/,
      `Unexpected version heading "${section.version}"`,
    );
    assert.ok(
      section.date,
      `Released section ${section.version} is missing its date`,
    );
    assert.ok(
      !seen.has(section.version),
      `Version ${section.version} appears more than once`,
    );
    seen.add(section.version);
  }
});

// Compares by the first differing part so 0.3.0 sorts above 0.2.40.
function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);

  for (
    let index = 0;
    index < Math.max(leftParts.length, rightParts.length);
    index += 1
  ) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

test("released versions are listed newest first", () => {
  const released = sections.slice(1).map((section) => section.version);

  for (let index = 1; index < released.length; index += 1) {
    assert.ok(
      compareVersions(released[index - 1], released[index]) > 0,
      `${released[index - 1]} should be listed after ${released[index]}`,
    );
  }
});

test("the version comparison orders release trains correctly", () => {
  assert.ok(compareVersions("0.3.0", "0.2.40") > 0);
  assert.ok(compareVersions("0.2.10", "0.2.9") > 0);
  assert.ok(compareVersions("1.0.0", "0.99.99") > 0);
  assert.strictEqual(compareVersions("0.2.40", "0.2.40"), 0);
});

test("unreleased work is not written into a published section", () => {
  const publishedIndex = changelog.indexOf(`## [${packageJson.version}]`);
  const unreleasedIndex = changelog.indexOf("## [Unreleased]");
  assert.ok(
    unreleasedIndex >= 0 && unreleasedIndex < publishedIndex,
    "Unreleased entries must stay above the published sections",
  );
});

// A forgotten version bump only shows up at publish time, so pin the newest
// released heading to package.json here instead.
test("the newest released section matches the package version", () => {
  const newestReleased = sections[1];
  assert.ok(newestReleased, "CHANGELOG has no released section");
  assert.strictEqual(
    newestReleased.version,
    packageJson.version,
    `CHANGELOG newest release ${newestReleased.version} does not match package.json ${packageJson.version}`,
  );
});

test("the current or latest tagged release section is immutable", () => {
  const taggedVersions = execFileSync("git", ["tag", "--list", "v*"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split(/\r?\n/)
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))
    .map((tag) => tag.slice(1))
    .sort(compareVersions)
    .reverse();
  const version = taggedVersions.includes(packageJson.version)
    ? packageJson.version
    : taggedVersions[0];
  assert.ok(version, "Expected at least one release tag");
  const tag = `v${version}`;
  const taggedChangelog = execFileSync("git", ["show", `${tag}:CHANGELOG.md`], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.strictEqual(
    getVersionSection(changelog, version),
    getVersionSection(taggedChangelog, version),
    `Released section ${version} differs from ${tag}; put new work under [Unreleased]`,
  );
});

test("release-facing documents carry no replacement characters", () => {
  const guardedFiles = [
    "CHANGELOG.md",
    "README.md",
    "README_ja.md",
    "package.nls.json",
    "package.nls.ja.json",
  ];

  for (const fileName of guardedFiles) {
    const text = fs.readFileSync(path.join(repoRoot, fileName), "utf8");
    const index = text.indexOf("\uFFFD");
    assert.strictEqual(
      index,
      -1,
      `${fileName} contains U+FFFD near: ${JSON.stringify(
        text.slice(Math.max(0, index - 40), index + 40),
      )}`,
    );
  }
});

test("every entry is bilingual", () => {
  const monolingual = [];
  for (const section of sections) {
    for (const entry of section.entries) {
      const hasJapanese = /[\u3040-\u30ff\u4e00-\u9faf]/.test(entry);
      const hasSeparator = entry.includes(" / ");
      if (!hasJapanese || !hasSeparator) {
        monolingual.push(`[${section.version}] ${entry.slice(0, 70)}...`);
      }
    }
  }

  assert.deepStrictEqual(
    monolingual,
    [],
    "CHANGELOG entries use the `English / 日本語` format",
  );
});

console.log("\nAll changelog hygiene tests passed.");
