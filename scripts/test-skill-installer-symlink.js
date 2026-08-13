#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

function requireTypeScriptModule(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  });

  const loadedModule = new Module(filePath, module);
  loadedModule.filename = filePath;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(filePath));
  loadedModule._compile(transpiled.outputText, filePath);
  return loadedModule.exports;
}

const { partitionGitHubDirectoryEntries, resolveSymlinkTargetPath } =
  requireTypeScriptModule(
    path.join(__dirname, "..", "src", "githubDirectoryTraversal.ts"),
  );

const {
  isSafePathSegment,
  isContainedPath,
  isContainedPathOnPlatform,
  shouldFoldPathCase,
} = requireTypeScriptModule(path.join(__dirname, "..", "src", "pathSafety.ts"));

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function listFakeDirectory(tree, remotePath, visitedPaths = new Set()) {
  const normalizedPath = remotePath.replace(/^\/+|\/+$/g, "");
  if (visitedPaths.has(normalizedPath)) {
    throw new Error(`Symlink loop detected: ${normalizedPath}`);
  }
  visitedPaths.add(normalizedPath);

  let entry = tree[normalizedPath];
  if (!entry) {
    const symlinkPrefix = Object.keys(tree)
      .filter((candidatePath) => {
        const candidateEntry = tree[candidatePath];
        return (
          !Array.isArray(candidateEntry) &&
          candidateEntry.type === "symlink" &&
          normalizedPath.startsWith(`${candidatePath}/`)
        );
      })
      .sort((left, right) => right.length - left.length)[0];

    if (symlinkPrefix) {
      const candidateEntry = tree[symlinkPrefix];
      const suffix = normalizedPath.slice(symlinkPrefix.length + 1);
      const resolvedPrefix = resolveSymlinkTargetPath(
        symlinkPrefix,
        candidateEntry.target,
      );
      return listFakeDirectory(
        tree,
        `${resolvedPrefix}/${suffix}`,
        visitedPaths,
      );
    }
  }

  assert(entry, `Missing fake repository entry: ${normalizedPath}`);

  if (Array.isArray(entry)) {
    return entry;
  }

  if (entry.type === "symlink" && entry.target) {
    return listFakeDirectory(
      tree,
      resolveSymlinkTargetPath(normalizedPath, entry.target),
      visitedPaths,
    );
  }

  throw new Error(`Path is not a directory: ${normalizedPath}`);
}

function collectInstalledFiles(tree, remotePath, localPath, output = []) {
  const entries = listFakeDirectory(tree, remotePath);
  const { files, directoriesToTraverse } =
    partitionGitHubDirectoryEntries(entries);

  for (const entry of files) {
    output.push(path.posix.join(localPath, entry.name));
  }

  for (const entry of directoriesToTraverse) {
    collectInstalledFiles(
      tree,
      `${remotePath}/${entry.name}`,
      path.posix.join(localPath, entry.name),
      output,
    );
  }

  return output;
}

test("isSafePathSegment accepts ordinary resource file names", () => {
  for (const segment of [
    "SKILL.md",
    "my-skill",
    "a.b.c",
    "README",
    ".mcp.json",
  ]) {
    assert.strictEqual(
      isSafePathSegment(segment),
      true,
      `${JSON.stringify(segment)} must stay installable`,
    );
  }
});

test("isSafePathSegment rejects every unsafe remote entry name", () => {
  for (const segment of [
    "..",
    ".",
    "",
    "   ",
    "a/b",
    "..\\..\\evil.txt",
    "a\\b",
    "c:",
    "a\u0000b",
    "a\u0007b",
    "trailing.",
    "trailing ",
    "CON",
    "con.txt",
    "COM1",
    "lpt9.md",
    // Console devices and the superscript forms Win32 resolves to COM1/LPT1.
    "CONIN$",
    "CONOUT$",
    "conin$.txt",
    "COM\u00b9",
    "COM\u00b2.txt",
    "COM\u00b3",
    "LPT\u00b9",
    "LPT\u00b2.md",
  ]) {
    assert.strictEqual(
      isSafePathSegment(segment),
      false,
      `${JSON.stringify(segment)} must be rejected`,
    );
  }
});

test("isContainedPath accepts the root itself and nested children", () => {
  const root = path.resolve("install-root");
  assert.strictEqual(isContainedPath(root, root), true);
  assert.strictEqual(
    isContainedPath(root, path.join(root, "nested", "SKILL.md")),
    true,
  );
});

test("isContainedPath rejects prefix siblings, parents, and traversal", () => {
  const root = path.resolve("install-root", "b");
  assert.strictEqual(
    isContainedPath(root, path.resolve("install-root", "bcd")),
    false,
    "a sibling that merely shares a prefix is not contained",
  );
  assert.strictEqual(
    isContainedPath(root, path.resolve("install-root")),
    false,
    "the parent is not contained",
  );
  assert.strictEqual(
    isContainedPath(root, `${root}${path.sep}..${path.sep}..${path.sep}x`),
    false,
    "traversal out of the root is not contained",
  );
});

test("the case-folding policy follows the platform", () => {
  assert.strictEqual(shouldFoldPathCase("win32"), true);
  assert.strictEqual(shouldFoldPathCase("linux"), false);
  assert.strictEqual(shouldFoldPathCase("darwin"), false);
});

test("both platform branches of containment run on this host", () => {
  const root = path.resolve("Install-Root");
  const child = path.join(root, "Nested", "SKILL.md");
  const differentlyCasedChild = child.toLowerCase();

  for (const platform of ["win32", "linux"]) {
    assert.strictEqual(
      isContainedPathOnPlatform(root, child, platform),
      true,
      `an exact-case child stays contained on ${platform}`,
    );
    assert.strictEqual(
      isContainedPathOnPlatform(
        root,
        `${root}${path.sep}..${path.sep}..${path.sep}x`,
        platform,
      ),
      false,
      `traversal escapes the root on ${platform}`,
    );
  }

  assert.strictEqual(
    isContainedPathOnPlatform(root, differentlyCasedChild, "win32"),
    true,
    "win32 compares case-insensitively",
  );
  assert.strictEqual(
    isContainedPathOnPlatform(root, differentlyCasedChild, "linux"),
    false,
    "a case-sensitive platform treats a differently cased path as outside",
  );
  assert.strictEqual(
    isContainedPath(root, child),
    true,
    "the two-argument form keeps working on the host platform",
  );
});

test("resolveSymlinkTargetPath handles parent segments and backslashes", () => {
  assert.strictEqual(
    resolveSymlinkTargetPath(
      "skills/example/linked-assets",
      "..\\shared-assets",
    ),
    "skills/shared-assets",
  );
});

test("partitionGitHubDirectoryEntries keeps symlink directories in traversal", () => {
  const { files, directoriesToTraverse } = partitionGitHubDirectoryEntries([
    { name: "SKILL.md", type: "file", download_url: "https://raw/skill" },
    { name: "docs", type: "dir", download_url: null },
    {
      name: "linked-assets",
      type: "symlink",
      download_url: "https://raw/linked-assets",
      target: "../shared-assets",
    },
    {
      name: "README.md",
      type: "file",
      download_url: "https://raw/readme",
      target: "../README.md",
    },
  ]);

  assert.deepStrictEqual(
    files.map((entry) => entry.name),
    ["SKILL.md", "README.md"],
  );
  assert.deepStrictEqual(
    directoriesToTraverse.map((entry) => entry.name),
    ["docs", "linked-assets"],
  );
});

test("recursive traversal installs files from symlinked directories", () => {
  const fakeTree = {
    "skills/example": [
      { name: "SKILL.md", type: "file", download_url: "https://raw/skill" },
      {
        name: "linked-assets",
        type: "symlink",
        download_url: "https://raw/linked-assets",
        target: "../shared-assets",
      },
    ],
    "skills/example/linked-assets": {
      name: "linked-assets",
      type: "symlink",
      download_url: "https://raw/linked-assets",
      target: "../shared-assets",
    },
    "skills/shared-assets": [
      {
        name: "reference.md",
        type: "file",
        download_url: "https://raw/reference",
      },
      { name: "nested", type: "dir", download_url: null },
    ],
    "skills/shared-assets/nested": [
      {
        name: "guide.md",
        type: "file",
        download_url: "https://raw/guide",
      },
    ],
  };

  const installedFiles = collectInstalledFiles(
    fakeTree,
    "skills/example",
    ".github/skills/example",
  );

  assert.deepStrictEqual(installedFiles.sort(), [
    ".github/skills/example/SKILL.md",
    ".github/skills/example/linked-assets/nested/guide.md",
    ".github/skills/example/linked-assets/reference.md",
  ]);
});

console.log("RESULT=PASS");
