#!/usr/bin/env node

// Runs every scripts/test-*.js. The list is discovered at run time on purpose:
// a hard-coded list let 17 scripts stay unreachable, and an `&&` chain let a
// single failure at position 17 hide the 30 links after it. This runner never
// stops at the first failure and never skips a script silently.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const scriptsDir = path.join(repoRoot, "scripts");

// Scripts that talk to the live network and therefore cannot gate an offline
// build. Every entry needs a reason, and every entry is still reachable through
// `npm run test:upstream`. Membership was measured, not guessed: preloading a
// module that throws from fetch/http/https and running the suite leaves exactly
// these scripts failing. Passing without a token only proves anonymous access
// works, not that a script is offline-safe.
const NETWORK_TESTS = {
  "test-azure-skills-source.js":
    "compares the bundled index against the live microsoft/azure-skills tree over the network",
  "test-copilot-plugins-upstream.js":
    "compares the bundled GitHub Copilot plugins source against its live official tree and marketplace",
  "test-microsoft-install-e2e.js":
    "installs from the live MicrosoftDocs/Agent-Skills repository over the network",
};

// A hung script must not block the summary or the exit code, which is the
// failure mode an `&&` chain already hid once.
const SCRIPT_TIMEOUT_MS = 5 * 60 * 1000;

function discoverTestScripts() {
  return fs
    .readdirSync(scriptsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^test-.*\.js$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function runScript(fileName) {
  const result = spawnSync(
    process.execPath,
    [path.join(scriptsDir, fileName)],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: process.env,
      timeout: SCRIPT_TIMEOUT_MS,
    },
  );

  if (result.error) {
    process.stderr.write(
      `Failed to launch ${fileName}: ${result.error.message}\n`,
    );
    return 1;
  }

  if (result.signal) {
    process.stderr.write(
      `${fileName} was terminated by ${result.signal} (timeout is ${SCRIPT_TIMEOUT_MS} ms)\n`,
    );
    return 1;
  }

  if (typeof result.status === "number") {
    return result.status;
  }

  return 1;
}

function main() {
  const includeNetwork =
    process.argv.includes("--include-network") ||
    process.env.RESOURCE_TESTS_INCLUDE_NETWORK === "1";

  const discovered = discoverTestScripts();

  // The coverage guard lives in a child test, so a narrowed discovery would also
  // drop the guard. Assert coverage here, where nothing downstream can suppress it.
  const onDisk = fs
    .readdirSync(scriptsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^test-.*\.js$/.test(entry.name))
    .map((entry) => entry.name);
  const uncovered = onDisk.filter((fileName) => !discovered.includes(fileName));
  if (uncovered.length > 0) {
    process.stderr.write(
      `Runner discovery misses ${uncovered.length} script(s): ${uncovered.join(", ")}\n`,
    );
    process.exit(1);
  }

  const skipped = includeNetwork
    ? []
    : discovered.filter((fileName) =>
        Object.prototype.hasOwnProperty.call(NETWORK_TESTS, fileName),
      );
  const selected = discovered.filter((fileName) => !skipped.includes(fileName));

  const failures = [];

  for (const fileName of selected) {
    process.stdout.write(`\n=== RUN ${fileName} ===\n`);
    const status = runScript(fileName);
    if (status !== 0) {
      failures.push({ fileName, status });
      process.stdout.write(`=== FAIL ${fileName} (exit ${status}) ===\n`);
    }
  }

  process.stdout.write("\n=== resource test summary ===\n");

  for (const fileName of skipped) {
    process.stdout.write(`SKIP ${fileName}: ${NETWORK_TESTS[fileName]}\n`);
  }

  if (skipped.length > 0) {
    process.stdout.write(
      "Run `npm run test:upstream` to include the skipped network tests.\n",
    );
  }

  for (const failure of failures) {
    process.stdout.write(`FAIL ${failure.fileName} (exit ${failure.status})\n`);
  }

  process.stdout.write(
    `DISCOVERED=${discovered.length} TOTAL=${selected.length} PASSED=${selected.length - failures.length} FAILED=${failures.length} SKIPPED=${skipped.length}\n`,
  );

  process.exit(failures.length > 0 ? 1 : 0);
}

module.exports = { NETWORK_TESTS, discoverTestScripts };

if (require.main === module) {
  main();
}
