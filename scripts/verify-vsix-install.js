#!/usr/bin/env node
// Release gate: install the built VSIX into an isolated profile, read it back,
// and compare the installed runtime assets with the VSIX bytes.
// Usage: node scripts/verify-vsix-install.js [path-to.vsix]

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  compareRuntimeAssets,
  readZipContents,
  runtimeAssetPaths,
} = require("./vsix-tools");

const repoRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
);
const extensionId = `${packageJson.publisher}.${packageJson.name}`;
const vsixPath = path.resolve(
  process.argv[2] ||
    path.join(
      repoRoot,
      "artifacts",
      "vsix",
      `agent-resources-ninja-${packageJson.version}.vsix`,
    ),
);

function findCodeCli() {
  const candidates =
    process.platform === "win32"
      ? [
          path.join(
            process.env.LOCALAPPDATA || "",
            "Programs",
            "Microsoft VS Code",
            "bin",
            "code.cmd",
          ),
        ]
      : [];
  return candidates.find((candidate) => fs.existsSync(candidate)) || "code";
}

function quoteForCmd(value) {
  return /[\s&()^|<>"]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function run(cli, args) {
  const windows = process.platform === "win32";
  // code.cmd needs a shell on Windows, so every part is quoted for it.
  const result = windows
    ? spawnSync(
        [cli, ...args].map(quoteForCmd).join(" "),
        { encoding: "utf8", shell: true },
      )
    : spawnSync(cli, args, { encoding: "utf8" });
  return {
    status: result.status,
    output: `${result.stdout || ""}${result.stderr || ""}`,
  };
}

function fail(message) {
  process.stderr.write(`FAIL ${message}\n`);
  process.exitCode = 1;
}

if (!fs.existsSync(vsixPath)) {
  fail(`VSIX not found: ${vsixPath}`);
} else {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "resource-ninja-vsix-"));
  const extensionsDir = path.join(sandbox, "extensions");
  const userDataDir = path.join(sandbox, "user-data");
  const cli = findCodeCli();
  try {
    const isolated = [
      "--extensions-dir",
      extensionsDir,
      "--user-data-dir",
      userDataDir,
    ];
    const install = run(cli, ["--install-extension", vsixPath, ...isolated]);
    if (install.status !== 0) {
      fail(`install failed: ${install.output.trim().slice(0, 300)}`);
    } else {
      const listed = run(cli, [
        "--list-extensions",
        "--show-versions",
        ...isolated,
      ]);
      const expected = `${extensionId}@${packageJson.version}`;
      if (!listed.output.split(/\r?\n/).some((line) => line.trim() === expected)) {
        fail(`readback did not list ${expected}`);
      } else {
        const installedRoot = path.join(
          extensionsDir,
          `${extensionId.toLowerCase()}-${packageJson.version}`,
        );
        const problems = compareRuntimeAssets(
          readZipContents(vsixPath),
          installedRoot,
          runtimeAssetPaths(packageJson),
        );
        if (problems.length > 0) {
          for (const problem of problems) {
            fail(problem);
          }
        } else {
          process.stdout.write(
            `PASS ${expected} installed in an isolated profile and its runtime assets match the VSIX\n`,
          );
        }
      }
    }
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}
