#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function activationEvents() {
  return packageJson.activationEvents || [];
}

function commands() {
  return packageJson.contributes?.commands || [];
}

function views() {
  return packageJson.contributes?.views?.["resource-ninja"] || [];
}

function chatParticipants() {
  return packageJson.contributes?.chatParticipants || [];
}

function languageModelTools() {
  return packageJson.contributes?.languageModelTools || [];
}

function assertHasActivation(event) {
  assert.ok(activationEvents().includes(event), `Missing activation event: ${event}`);
}

test("activation avoids startup activation", () => {
  assert.ok(!activationEvents().includes("onStartupFinished"));
  assert.ok(!activationEvents().includes("*"));
});

test("view activation relies on VS Code contribution auto-activation", () => {
  for (const view of views()) {
    assert.ok(!activationEvents().includes(`onView:${view.id}`));
  }
});

test("command activation relies on VS Code contribution auto-activation", () => {
  for (const command of commands()) {
    assert.ok(!activationEvents().includes(`onCommand:${command.command}`));
  }
});

test("chat participant activates when invoked", () => {
  for (const participant of chatParticipants()) {
    assertHasActivation(`onChatParticipant:${participant.id}`);
  }
});

test("every language model tool activates when invoked", () => {
  for (const tool of languageModelTools()) {
    assertHasActivation(`onLanguageModelTool:${tool.name}`);
  }
});

test("activation events do not redundantly list contributed commands", () => {
  assert.ok(!activationEvents().some((entry) => entry.startsWith("onCommand:")));
});

test("activation events do not redundantly list contributed views", () => {
  assert.ok(!activationEvents().some((entry) => entry.startsWith("onView:")));
});

test("activation events do not reference unknown chat participants", () => {
  const contributed = new Set(chatParticipants().map((participant) => participant.id));
  for (const event of activationEvents().filter((entry) => entry.startsWith("onChatParticipant:"))) {
    const participant = event.slice("onChatParticipant:".length);
    assert.ok(contributed.has(participant), `Unknown chat participant activation: ${participant}`);
  }
});

test("activation events do not reference unknown language model tools", () => {
  const contributed = new Set(languageModelTools().map((tool) => tool.name));
  for (const event of activationEvents().filter((entry) => entry.startsWith("onLanguageModelTool:"))) {
    const tool = event.slice("onLanguageModelTool:".length);
    assert.ok(contributed.has(tool), `Unknown language model tool activation: ${tool}`);
  }
});

test("activation events are unique", () => {
  assert.strictEqual(new Set(activationEvents()).size, activationEvents().length);
});

test("resource namespace activation remains scoped", () => {
  for (const event of activationEvents()) {
    if (event.startsWith("onLanguageModelTool:")) {
      assert.match(event, /^onLanguageModelTool:resourceNinja_/);
    }
  }
});

test("hidden context-menu commands are contributed for VS Code auto-activation", () => {
  const hiddenCommands = new Set(
    (packageJson.contributes?.menus?.commandPalette || [])
      .filter((item) => item.when === "false")
      .map((item) => item.command),
  );
  const contributedCommands = new Set(commands().map((command) => command.command));
  for (const command of hiddenCommands) {
    assert.ok(contributedCommands.has(command), `Hidden command is not contributed: ${command}`);
  }
});

test("global instruction toolbar entry points are contributed", () => {
  const contributedCommands = new Set(commands().map((command) => command.command));
  const contributedViews = new Set(views().map((view) => view.id));
  assert.ok(contributedCommands.has("resourceNinja.openGlobalInstructionFile"));
  assert.ok(contributedCommands.has("resourceNinja.updateGlobalInstruction"));
  assert.ok(contributedViews.has("resourceNinja.userResourcesView"));
});

test("activation covers explicit agent-mode entry points", () => {
  const contributedCommands = new Set(commands().map((command) => command.command));
  const contributedViews = new Set(views().map((view) => view.id));
  assert.ok(contributedViews.has("resourceNinja.browseView"));
  assert.ok(contributedCommands.has("resourceNinja.search"));
  assertHasActivation("onLanguageModelTool:resourceNinja_search");
  assertHasActivation("onChatParticipant:resources");
});

console.log("RESULT=PASS");
