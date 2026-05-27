#!/usr/bin/env node

const path = require("path");
const { spawnSync } = require("child_process");

const repoRoot = path.resolve(__dirname, "..");
const vscodeTestCliPath = path.join(
  repoRoot,
  "node_modules",
  "@vscode",
  "test-cli",
  "out",
  "bin.mjs",
);

function checkWindowsUpdateMutex() {
  if (process.platform !== "win32") {
    return { held: false };
  }

  const command =
    "$mutex = $null; try { $mutex = [System.Threading.Mutex]::OpenExisting('vscode-updating'); Write-Output 'held' } catch [System.Threading.WaitHandleCannotBeOpenedException] { Write-Output 'clear' } finally { if ($mutex) { $mutex.Dispose() } }";

  const probe = spawnSync("pwsh", ["-NoProfile", "-Command", command], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (probe.error) {
    return {
      held: false,
      warning: `Failed to probe vscode-updating mutex: ${probe.error.message}`,
    };
  }

  const output = `${probe.stdout || ""}\n${probe.stderr || ""}`;
  return { held: /held/i.test(output) };
}

const mutexState = checkWindowsUpdateMutex();

if (mutexState.warning) {
  process.stderr.write(`${mutexState.warning}\n`);
}

if (mutexState.held) {
  process.stderr.write(
    [
      "Blocked: VS Code updater mutex 'vscode-updating' is currently held.",
      "Skipping Extension Host smoke launch to avoid the known Windows popup / EPIPE path.",
      "Retry npm test after VS Code update activity finishes.",
    ].join("\n") + "\n",
  );
  process.exit(2);
}

const result = spawnSync(process.execPath, [vscodeTestCliPath], {
  cwd: repoRoot,
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  process.stderr.write(
    `Failed to launch vscode-test: ${result.error.message}\n`,
  );
  process.exit(1);
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
