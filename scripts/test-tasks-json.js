#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const tasksJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, ".vscode", "tasks.json"), "utf8"),
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

test("pwsh tasks declare an explicit invocation mode", () => {
  const pwshTasks = (tasksJson.tasks || []).filter((task) =>
    ["pwsh", "powershell"].includes(String(task.command || "").toLowerCase()),
  );

  for (const task of pwshTasks) {
    assert.ok(Array.isArray(task.args), `${task.label} must declare args`);
    assert.ok(task.args.length > 0, `${task.label} must declare at least one arg`);
    assert.ok(
      ["-Command", "-File", "-CommandWithArgs"].includes(task.args[0]),
      `${task.label} must start with -Command, -File, or -CommandWithArgs`,
    );
  }
});