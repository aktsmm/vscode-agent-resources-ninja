// Verifies the GitHub owner / repo / ref rules that guard everything the shared
// store can steer. The real module is loaded rather than re-stated here, so the
// test cannot drift away from the code it protects.

const assert = require("assert");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

function requireTypeScriptModule(filePath) {
  const source = require("fs").readFileSync(filePath, "utf8");
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

const repoRoot = path.resolve(__dirname, "..");
const {
  isSafeGitHubOwner,
  isSafeGitHubRepo,
  isSafeGitHubRepositoryUrl,
  isSafeGitRef,
  encodeGitRefForPath,
} = requireTypeScriptModule(path.join(repoRoot, "src", "gitHubRefSafety.ts"));

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

test("an owner that is a dot segment is refused", () => {
  assert.strictEqual(isSafeGitHubOwner("."), false);
  assert.strictEqual(isSafeGitHubOwner(".."), false);
  assert.strictEqual(isSafeGitHubOwner("a/b"), false);
  assert.strictEqual(isSafeGitHubOwner(""), false);
  assert.strictEqual(isSafeGitHubOwner(undefined), false);
});

test("every owner in the bundled catalog is accepted", () => {
  const index = require(path.join(repoRoot, "resources", "skill-index.json"));
  const owners = (index.sources || [])
    .map((entry) => /^https:\/\/github\.com\/([^/]+)\//.exec(entry.url || ""))
    .filter(Boolean)
    .map((match) => match[1]);

  assert.ok(
    owners.length > 0,
    "the bundled catalog must yield owners to check",
  );
  const refused = owners.filter((owner) => !isSafeGitHubOwner(owner));
  assert.deepStrictEqual(
    refused,
    [],
    "tightening the owner rule must not reject a source we ship",
  );
});

test("a repository may start with a dot but may not be one", () => {
  assert.strictEqual(isSafeGitHubRepo(".github"), true);
  assert.strictEqual(isSafeGitHubRepo("."), false);
  assert.strictEqual(isSafeGitHubRepo(".."), false);
});

test("only a plain two-segment GitHub repository URL is accepted", () => {
  assert.strictEqual(
    isSafeGitHubRepositoryUrl("https://github.com/acme/tools"),
    true,
  );
  assert.strictEqual(
    isSafeGitHubRepositoryUrl("https://github.com/../tools"),
    false,
  );
  assert.strictEqual(
    isSafeGitHubRepositoryUrl("https://github.com/acme/.."),
    false,
  );
  assert.strictEqual(
    isSafeGitHubRepositoryUrl("https://github.com/acme/tools/tree/main"),
    false,
  );
  assert.strictEqual(
    isSafeGitHubRepositoryUrl("http://github.com/acme/tools"),
    false,
  );
  assert.strictEqual(
    isSafeGitHubRepositoryUrl("https://evil.example.com/acme/tools"),
    false,
  );
});

test("a ref that could climb out of the repository is refused", () => {
  for (const ref of [
    "..",
    "../../other/repo/main",
    "a/../../b",
    "%2e%2e/x",
    "%2f",
    "/main",
    "main/",
    "a//b",
    "main\u0007",
    "main branch",
    "main~1",
    "ref^0",
    "a:b",
    "a?b",
    "a*b",
    "a[b",
    "a\\b",
    'a"b',
    "a<b",
    "a>b",
    "a|b",
    "main@{1}",
    "main.",
    ".hidden",
    "a/.hidden",
    "main.lock",
    "a/b.lock",
    "",
  ]) {
    assert.strictEqual(isSafeGitRef(ref), false, `must refuse ${ref}`);
  }
});

test("an ordinary branch name stays usable", () => {
  for (const ref of [
    "main",
    "master",
    "development",
    "feature/x",
    "release/1.0",
    "a/b/c",
    "v1.2.3",
    "fix-123",
    "user.name/topic",
  ]) {
    assert.strictEqual(isSafeGitRef(ref), true, `must accept ${ref}`);
  }
});

test("a ref longer than the git limit is refused", () => {
  assert.strictEqual(isSafeGitRef("a".repeat(255)), true);
  assert.strictEqual(isSafeGitRef("a".repeat(256)), false);
});

test("encoding a ref escapes each segment but keeps the separators", () => {
  assert.strictEqual(encodeGitRefForPath("feature/x"), "feature/x");
  assert.strictEqual(encodeGitRefForPath("a b"), "a%20b");
  assert.strictEqual(encodeGitRefForPath("a/b c"), "a/b%20c");
  assert.strictEqual(encodeGitRefForPath("%2e%2e"), "%252e%252e");
  assert.strictEqual(encodeGitRefForPath(".."), "..");
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

if (failed > 0) {
  process.exitCode = 1;
} else {
  console.log("RESULT=PASS");
}
