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
  isDeletableWithinOnPlatform,
  isRealPathStrictlyInside,
  shouldFoldPathCase,
} = requireTypeScriptModule(path.join(__dirname, "..", "src", "pathSafety.ts"));

const {
  toPluginLocationKey,
  getPluginLocationsToRegister,
  mergePluginLocations,
  removePluginLocations,
  collectPluginLocationKeysForRemoval,
  supportsPluginLocations,
} = requireTypeScriptModule(
  path.join(__dirname, "..", "src", "pluginLocations.ts"),
);

// The production caller hands `collectPluginLocationKeysForRemoval` the real
// `isContainedPath`; binding the platform-explicit form here exercises both case
// rules from one host without reassigning `process.platform`.
const winContainment = (rootFsPath, candidateFsPath) =>
  isContainedPathOnPlatform(rootFsPath, candidateFsPath, "win32");
const posixContainment = (rootFsPath, candidateFsPath) =>
  isContainedPathOnPlatform(rootFsPath, candidateFsPath, "linux");

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

test("isDeletableWithin refuses the allowed root itself", () => {
  // A recursive delete pointed at the root would wipe every resource in it, so
  // containment alone is not a safe gate for a delete.
  const root = path.resolve("install-root", "plugins");
  for (const platform of ["win32", "linux"]) {
    assert.strictEqual(
      isDeletableWithinOnPlatform(root, root, platform),
      false,
      `${platform}: the allowed root is never a legal delete target`,
    );
    assert.strictEqual(
      isDeletableWithinOnPlatform(
        root,
        path.resolve("install-root", "plugins", "demo"),
        platform,
      ),
      true,
      `${platform}: a resource inside the root stays deletable`,
    );
    assert.strictEqual(
      isDeletableWithinOnPlatform(root, path.resolve("install-root"), platform),
      false,
      `${platform}: the parent is still refused`,
    );
  }
  assert.strictEqual(
    isDeletableWithinOnPlatform(
      root,
      path.resolve("install-root", "PLUGINS"),
      "win32",
    ),
    false,
    "a case-different spelling of the root is still the root on Windows",
  );
});

test("realpath containment rejects links outside and unresolved links", () => {
  const fixtureRoot = fs.mkdtempSync(
    path.join(require("os").tmpdir(), "resource-ninja-path-safety-"),
  );
  const allowedRoot = path.join(fixtureRoot, "allowed");
  const outsideRoot = path.join(fixtureRoot, "outside");
  fs.mkdirSync(allowedRoot);
  fs.mkdirSync(outsideRoot);

  try {
    assert.strictEqual(
      isRealPathStrictlyInside(
        allowedRoot,
        path.join(allowedRoot, "missing", "SKILL.md"),
      ),
      true,
      "a not-yet-created descendant projects below the allowed root",
    );
    assert.strictEqual(
      isRealPathStrictlyInside(allowedRoot, allowedRoot),
      false,
      "the root itself is never a strictly contained target",
    );

    const outsideLink = path.join(allowedRoot, "outside-link");
    fs.symlinkSync(outsideRoot, outsideLink, "junction");
    assert.strictEqual(
      isRealPathStrictlyInside(
        allowedRoot,
        path.join(outsideLink, "payload.txt"),
      ),
      false,
      "an intermediate junction must not escape the allowed root",
    );

    const brokenLink = path.join(allowedRoot, "broken-link");
    fs.symlinkSync(
      path.join(fixtureRoot, "missing-target"),
      brokenLink,
      "junction",
    );
    assert.strictEqual(
      isRealPathStrictlyInside(
        allowedRoot,
        path.join(brokenLink, "payload.txt"),
      ),
      false,
      "a link whose real target cannot be resolved must be rejected",
    );
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
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

test("toPluginLocationKey normalizes separators and trailing slashes", () => {
  assert.strictEqual(
    toPluginLocationKey("d:\\repo\\.github\\plugins\\my-plugin"),
    "d:/repo/.github/plugins/my-plugin",
  );
  assert.strictEqual(
    toPluginLocationKey("d:\\repo\\.github\\plugins\\my-plugin\\"),
    "d:/repo/.github/plugins/my-plugin",
  );
  assert.strictEqual(
    toPluginLocationKey("/home/user/.copilot/plugins/My-Plugin//"),
    "/home/user/.copilot/plugins/My-Plugin",
  );
});

test("toPluginLocationKey keeps a drive root addressable", () => {
  assert.strictEqual(
    toPluginLocationKey("D:\\"),
    "D:/",
    "stripping the separator would turn a drive root into a drive-relative path",
  );
  assert.strictEqual(toPluginLocationKey("D:/"), "D:/");
  assert.strictEqual(toPluginLocationKey("/"), "/");
});

test("supportsPluginLocations gates the feature on VS Code 1.116 or newer", () => {
  assert.strictEqual(supportsPluginLocations("1.116.0"), true);
  assert.strictEqual(supportsPluginLocations("1.115.9"), false);
  assert.strictEqual(supportsPluginLocations("1.133.0"), true);
  assert.strictEqual(supportsPluginLocations("1.99.3"), false);
  assert.strictEqual(
    supportsPluginLocations("1.9.0"),
    false,
    "minor versions must compare numerically: lexically '1.9' sorts after '1.116'",
  );
  assert.strictEqual(supportsPluginLocations("2.0.0"), true);
  assert.strictEqual(supportsPluginLocations("1.116.0-insider"), true);
});

test("supportsPluginLocations fails closed on an unusable version string", () => {
  assert.strictEqual(supportsPluginLocations(""), false);
  assert.strictEqual(supportsPluginLocations("not-a-version"), false);
  assert.strictEqual(supportsPluginLocations(undefined), false);
  assert.strictEqual(supportsPluginLocations(1.116), false);
});

test("mergePluginLocations enables listed keys and preserves the rest", () => {
  const existing = {
    "d:/repo/.github/plugins/unrelated-disabled": false,
    "d:/repo/.github/plugins/previously-disabled": false,
    "d:/repo/.github/plugins/kept": true,
  };
  const merged = mergePluginLocations(existing, [
    "d:/repo/.github/plugins/previously-disabled",
    "d:/repo/.github/plugins/added",
  ]);

  assert.strictEqual(
    merged["d:/repo/.github/plugins/unrelated-disabled"],
    false,
    "an entry the user disabled and did not ask to register stays disabled",
  );
  assert.strictEqual(
    merged["d:/repo/.github/plugins/previously-disabled"],
    true,
    "a listed key is forced to true, otherwise the success message would be a lie",
  );
  assert.deepStrictEqual(merged, {
    "d:/repo/.github/plugins/unrelated-disabled": false,
    "d:/repo/.github/plugins/previously-disabled": true,
    "d:/repo/.github/plugins/kept": true,
    "d:/repo/.github/plugins/added": true,
  });
  assert.notStrictEqual(merged, existing, "merge should return a new object");
  assert.strictEqual(
    existing["d:/repo/.github/plugins/previously-disabled"],
    false,
    "merge must not mutate the value it was handed",
  );
});

test("an own __proto__ entry survives a merge and a removal", () => {
  // `JSON.parse` produces an OWN `__proto__` property. Plain assignment into a
  // fresh object hits the prototype setter instead and drops it, which the next
  // settings write would delete from the user's real chat.pluginLocations.
  const existing = JSON.parse(
    '{"__proto__":false,"d:/repo/.github/plugins/kept":true}',
  );
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(existing, "__proto__"),
    true,
    "fixture must carry an own __proto__ property",
  );

  const merged = mergePluginLocations(existing, [
    "d:/repo/.github/plugins/added",
  ]);
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(merged, "__proto__"),
    true,
    "merge must copy an own __proto__ entry instead of dropping it",
  );
  assert.strictEqual(
    Object.getOwnPropertyDescriptor(merged, "__proto__").value,
    false,
  );
  assert.strictEqual(Object.getPrototypeOf(merged), Object.prototype);
  assert.strictEqual(
    JSON.parse(JSON.stringify(merged))["d:/repo/.github/plugins/added"],
    true,
  );

  const remaining = removePluginLocations(existing, [
    "d:/repo/.github/plugins/kept",
  ]);
  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(remaining, "__proto__"),
    true,
    "removal must copy an own __proto__ entry instead of dropping it",
  );
});

test("getPluginLocationsToRegister reports only the keys that need a write", () => {
  const existing = {
    "d:/repo/.github/plugins/enabled": true,
    "d:/repo/.github/plugins/disabled": false,
  };
  assert.deepStrictEqual(
    getPluginLocationsToRegister(existing, ["d:/repo/.github/plugins/enabled"]),
    [],
    "an already enabled key needs no prompt and no write",
  );
  assert.deepStrictEqual(
    getPluginLocationsToRegister(existing, [
      "d:/repo/.github/plugins/enabled",
      "d:/repo/.github/plugins/disabled",
      "d:/repo/.github/plugins/missing",
    ]),
    ["d:/repo/.github/plugins/disabled", "d:/repo/.github/plugins/missing"],
  );
  assert.deepStrictEqual(getPluginLocationsToRegister(undefined, ["any"]), [
    "any",
  ]);
});

test("mergePluginLocations tolerates a missing or malformed setting value", () => {
  const keys = ["d:/repo/.github/plugins/added"];
  const expected = { "d:/repo/.github/plugins/added": true };
  assert.deepStrictEqual(mergePluginLocations(undefined, keys), expected);
  assert.deepStrictEqual(mergePluginLocations(null, keys), expected);
  assert.deepStrictEqual(mergePluginLocations("not-an-object", keys), expected);
});

test("removePluginLocations drops only the listed keys", () => {
  const existing = {
    "d:/repo/.github/plugins/gone": true,
    "d:/repo/.github/plugins/disabled": false,
    "d:/repo/.github/plugins/unrelated": true,
  };
  const remaining = removePluginLocations(existing, [
    "d:/repo/.github/plugins/gone",
    "d:/repo/.github/plugins/never-registered",
  ]);

  assert.deepStrictEqual(remaining, {
    "d:/repo/.github/plugins/disabled": false,
    "d:/repo/.github/plugins/unrelated": true,
  });
  assert.deepStrictEqual(removePluginLocations(undefined, ["any"]), {});
});

test("plugin location removal follows the registered keys, not a path shape", () => {
  const existing = {
    "d:/custom/target/my-plugin": true,
    "d:/repo/.github/plugins/my-plugin": true,
    "d:/repo/.github/plugins/other-plugin": true,
    "/home/user/.copilot/plugins/hand-added": false,
  };

  assert.deepStrictEqual(
    collectPluginLocationKeysForRemoval(
      existing,
      [
        "d:\\custom\\target\\my-plugin\\skills\\demo\\SKILL.md",
        "d:\\custom\\target\\my-plugin\\agents\\demo.agent.md",
      ],
      "my-plugin",
      winContainment,
    ),
    ["d:/custom/target/my-plugin"],
    "a custom install target has no plugins/ segment but is still registered",
  );

  assert.deepStrictEqual(
    collectPluginLocationKeysForRemoval(
      existing,
      ["d:\\repo\\.github\\plugins\\my-plugin\\skills\\demo\\SKILL.md"],
      "my-plugin",
      winContainment,
    ),
    ["d:/repo/.github/plugins/my-plugin"],
    "a sibling plugin and a hand-added entry must survive",
  );

  assert.deepStrictEqual(
    collectPluginLocationKeysForRemoval(
      existing,
      ["d:\\elsewhere\\not-registered\\SKILL.md", ""],
      "my-plugin",
      winContainment,
    ),
    [],
    "nothing outside the registered keys is ever removed",
  );

  assert.deepStrictEqual(
    collectPluginLocationKeysForRemoval(
      { "d:/repo": true, "d:/repo/.github/plugins/my-plugin": true },
      ["d:\\repo\\.github\\plugins\\my-plugin\\skills\\demo\\SKILL.md"],
      "my-plugin",
      winContainment,
    ),
    ["d:/repo/.github/plugins/my-plugin"],
    "a registered ancestor such as a workspace root that is itself a plugin must survive",
  );

  // The upward walk stops at the nearest ancestor carrying the plugin folder
  // name. A repeated folder name higher up is a different folder, so a
  // registered entry there is unrelated to this delete.
  assert.deepStrictEqual(
    collectPluginLocationKeysForRemoval(
      {
        "/repo/foo": true,
        "/repo/foo/.github/plugins/foo": true,
      },
      ["/repo/foo/.github/plugins/foo/skills/demo/SKILL.md"],
      "foo",
      posixContainment,
    ),
    ["/repo/foo/.github/plugins/foo"],
    "only the plugin package is removed when an ancestor repeats its name",
  );

  const repeatedName = {
    "/repo/foo": true,
    "/repo/foo/.github/plugins/foo": true,
  };
  assert.deepStrictEqual(
    removePluginLocations(
      repeatedName,
      collectPluginLocationKeysForRemoval(
        repeatedName,
        ["/repo/foo/.github/plugins/foo/agents/demo.agent.md"],
        "foo",
        posixContainment,
      ),
    ),
    { "/repo/foo": true },
    "the same-named ancestor keeps its registration",
  );

  // The package itself may be unregistered while the same-named ancestor is
  // registered; the walk must still stop at the package rather than climbing to
  // the first entry that happens to match.
  assert.deepStrictEqual(
    collectPluginLocationKeysForRemoval(
      { "/repo/foo": true },
      ["/repo/foo/.github/plugins/foo/skills/demo/SKILL.md"],
      "foo",
      posixContainment,
    ),
    [],
    "an unregistered package must not fall through to a same-named ancestor",
  );

  const remaining = removePluginLocations(
    existing,
    collectPluginLocationKeysForRemoval(
      existing,
      ["d:\\custom\\target\\my-plugin\\skills\\demo\\SKILL.md"],
      "my-plugin",
      winContainment,
    ),
  );
  assert.deepStrictEqual(remaining, {
    "d:/repo/.github/plugins/my-plugin": true,
    "d:/repo/.github/plugins/other-plugin": true,
    "/home/user/.copilot/plugins/hand-added": false,
  });
});

// The uninstall paths hand the shared `unregisterPluginLocations` helper the
// plugin root itself plus its folder name, which is a different input shape
// from the per-resource paths the plugin-group delete collects.
test("shared plugin unregistration keys off the deleted plugin root", () => {
  const existing = {
    "d:/repo/.github/plugins/my-plugin": true,
    "d:/repo/.github/plugins/other-plugin": true,
    "d:/custom/target/moved-plugin": true,
    "/home/user/.copilot/plugins/hand-added": false,
  };

  const removedKeys = collectPluginLocationKeysForRemoval(
    existing,
    ["d:\\repo\\.github\\plugins\\my-plugin"],
    "my-plugin",
    winContainment,
  );
  assert.deepStrictEqual(removedKeys, ["d:/repo/.github/plugins/my-plugin"]);
  assert.deepStrictEqual(removePluginLocations(existing, removedKeys), {
    "d:/repo/.github/plugins/other-plugin": true,
    "d:/custom/target/moved-plugin": true,
    "/home/user/.copilot/plugins/hand-added": false,
  });

  // A `custom` install target has no `plugins/` segment, so only the setting can
  // say the removed folder was registered.
  const customKeys = collectPluginLocationKeysForRemoval(
    existing,
    ["d:\\custom\\target\\moved-plugin\\"],
    "moved-plugin",
    winContainment,
  );
  assert.deepStrictEqual(customKeys, ["d:/custom/target/moved-plugin"]);
  assert.deepStrictEqual(
    removePluginLocations(existing, customKeys)[
      "d:/repo/.github/plugins/my-plugin"
    ],
    true,
    "an unrelated plugin entry must survive a custom-target removal",
  );

  // A folder that was never registered must not take a same-named entry with it.
  assert.deepStrictEqual(
    collectPluginLocationKeysForRemoval(
      existing,
      ["d:\\elsewhere\\my-plugin"],
      "my-plugin",
      winContainment,
    ),
    [],
  );
});

// `uninstallSkill` deletes `<skillsRoot>/<name>` without looking at the resource
// kind, and the skills root is configurable, so it hands the shared helper a
// folder that is usually a skill and occasionally a plugin.
test("skill-shaped deletes are a no-op for plugin unregistration", () => {
  const existing = {
    "d:/repo/.github/plugins/my-plugin": true,
    "d:/repo/.github/skills/demo": true,
  };

  assert.deepStrictEqual(
    collectPluginLocationKeysForRemoval(
      existing,
      ["d:\\repo\\.github\\skills\\my-skill"],
      "my-skill",
      winContainment,
    ),
    [],
    "removing a plain skill folder must not touch chat.pluginLocations",
  );

  // With the skills directory configured as `.github/plugins`, the skill name IS
  // the plugin folder name, and the entry has to go with the folder.
  assert.deepStrictEqual(
    collectPluginLocationKeysForRemoval(
      existing,
      ["d:\\repo\\.github\\plugins\\my-plugin"],
      "my-plugin",
      winContainment,
    ),
    ["d:/repo/.github/plugins/my-plugin"],
  );
});

// `uninstallSkill` recursively deletes `<skillsRoot>/<name>` with no kind check
// and the skills root is configurable, so with the skills directory set to
// `.github` a "skill" named `plugins` removes every plugin folder underneath it.
// The caller cannot name those folders, so descendant matching is unbounded.
test("deleting a directory removes every plugin location registered inside it", () => {
  const existing = {
    "/repo/.github/plugins/alpha": true,
    "/repo/.github/plugins/beta": false,
    "/repo/.github/plugins/nested/gamma": true,
    // Shares the `/repo/.github/plugins` prefix but is a different folder.
    "/repo/.github/pluginsX/delta": true,
    "/repo/.github/skills/demo": true,
    "/elsewhere/plugins/epsilon": true,
  };

  const removed = collectPluginLocationKeysForRemoval(
    existing,
    ["/repo/.github/plugins"],
    "plugins",
    posixContainment,
  );
  assert.deepStrictEqual(
    Array.from(removed).sort(),
    [
      "/repo/.github/plugins/alpha",
      "/repo/.github/plugins/beta",
      "/repo/.github/plugins/nested/gamma",
    ],
    "every entry inside the deleted directory is stale, whatever it is named",
  );
  assert.deepStrictEqual(removePluginLocations(existing, removed), {
    "/repo/.github/pluginsX/delta": true,
    "/repo/.github/skills/demo": true,
    "/elsewhere/plugins/epsilon": true,
  });

  // Upwards matching is unchanged: a deleted file still takes out the package it
  // lived in, and nothing else.
  assert.deepStrictEqual(
    collectPluginLocationKeysForRemoval(
      existing,
      ["/repo/.github/plugins/alpha/skills/demo/SKILL.md"],
      "alpha",
      posixContainment,
    ),
    ["/repo/.github/plugins/alpha"],
    "deleting a file inside a plugin package still removes that package's key",
  );
});

test("descendant matching folds case only where the platform does", () => {
  const existing = {
    "/repo/.github/plugins/alpha": true,
    "/Repo/.github/Plugins/beta": true,
  };

  assert.deepStrictEqual(
    Array.from(
      collectPluginLocationKeysForRemoval(
        existing,
        ["/repo/.github/plugins"],
        "plugins",
        winContainment,
      ),
    ).sort(),
    ["/Repo/.github/Plugins/beta", "/repo/.github/plugins/alpha"],
    "on Windows a case-differing entry is the same folder and must go",
  );

  assert.deepStrictEqual(
    collectPluginLocationKeysForRemoval(
      existing,
      ["/repo/.github/plugins"],
      "plugins",
      posixContainment,
    ),
    ["/repo/.github/plugins/alpha"],
    "on a case-sensitive platform a case-differing entry is a different folder",
  );
});

console.log("RESULT=PASS");
