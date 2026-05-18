#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
);
const nls = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.nls.json"), "utf8"),
);
const nlsJa = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.nls.ja.json"), "utf8"),
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

function viewWelcomeItems() {
  return packageJson.contributes?.viewsWelcome || [];
}

function itemFor(viewId) {
  const item = viewWelcomeItems().find((entry) => entry.view === viewId);
  assert.ok(item, `Missing viewsWelcome item for ${viewId}`);
  return item;
}

function nlsKeyFor(item) {
  const match = item.contents.match(/^%([^%]+)%$/);
  assert.ok(
    match,
    `viewsWelcome contents should use NLS placeholder: ${item.view}`,
  );
  return match[1];
}

function localizedContent(viewId, locale = "en") {
  const key = nlsKeyFor(itemFor(viewId));
  const source = locale === "ja" ? nlsJa : nls;
  assert.ok(Object.hasOwn(source, key), `Missing ${locale} NLS key: ${key}`);
  return source[key];
}

function commandLinks(content) {
  return Array.from(
    content.matchAll(/\]\(command:([^)]+)\)/g),
    (match) => match[1],
  );
}

function contributedCommands() {
  return new Set(
    (packageJson.contributes?.commands || []).map((command) => command.command),
  );
}

function assertHasCommands(viewId, expectedCommands) {
  const links = commandLinks(localizedContent(viewId));
  for (const command of expectedCommands) {
    assert.ok(links.includes(command), `${viewId} should link ${command}`);
  }
}

const workspaceView = "resourceNinja.installedView";
const userView = "resourceNinja.userResourcesView";
const remoteView = "resourceNinja.browseView";

test("every resource view has a welcome entry", () => {
  const views = new Set(
    packageJson.contributes.views["resource-ninja"].map((view) => view.id),
  );
  const welcomeViews = new Set(viewWelcomeItems().map((entry) => entry.view));
  for (const viewId of [workspaceView, userView, remoteView]) {
    assert.ok(views.has(viewId), `Missing contributed view: ${viewId}`);
    assert.ok(welcomeViews.has(viewId), `Missing welcome view: ${viewId}`);
  }
});

test("welcome entries use localized placeholders", () => {
  for (const item of viewWelcomeItems()) {
    assert.match(item.contents, /^%viewsWelcome\.[^%]+%$/);
  }
});

test("welcome NLS keys exist in English and Japanese", () => {
  for (const item of viewWelcomeItems()) {
    const key = nlsKeyFor(item);
    assert.ok(Object.hasOwn(nls, key), `Missing English key ${key}`);
    assert.ok(Object.hasOwn(nlsJa, key), `Missing Japanese key ${key}`);
  }
});

test("welcome command links resolve to contributed commands", () => {
  const commands = contributedCommands();
  for (const viewId of [workspaceView, userView, remoteView]) {
    for (const locale of ["en", "ja"]) {
      for (const command of commandLinks(localizedContent(viewId, locale))) {
        assert.ok(
          commands.has(command),
          `Unknown command link ${command} in ${viewId} ${locale}`,
        );
      }
    }
  }
});

test("welcome entries provide at least three next actions", () => {
  for (const viewId of [workspaceView, userView, remoteView]) {
    assert.ok(
      commandLinks(localizedContent(viewId)).length >= 3,
      `${viewId} should expose at least three actions`,
    );
    assert.ok(
      commandLinks(localizedContent(viewId, "ja")).length >= 3,
      `${viewId} ja should expose at least three actions`,
    );
  }
});

test("workspace welcome links to search create and output open action", () => {
  assertHasCommands(workspaceView, [
    "resourceNinja.search",
    "resourceNinja.createResource",
    "resourceNinja.openInstructionFile",
  ]);
});

test("user global welcome links to create output open action built-in toggle and settings", () => {
  assertHasCommands(userView, [
    "resourceNinja.createResource",
    "resourceNinja.openGlobalInstructionFile",
    "resourceNinja.showBuiltInResources",
    "resourceNinja.openSettings",
  ]);
});

test("remote welcome links to search update index and add source", () => {
  assertHasCommands(remoteView, [
    "resourceNinja.search",
    "resourceNinja.updateIndex",
    "resourceNinja.addSource",
  ]);
});

test("welcome entries avoid destructive actions", () => {
  const forbidden = /delete|uninstall|reset|remove|trash/i;
  for (const viewId of [workspaceView, userView, remoteView]) {
    for (const locale of ["en", "ja"]) {
      const content = localizedContent(viewId, locale);
      assert.doesNotMatch(
        content,
        forbidden,
        `${viewId} ${locale} should not surface destructive wording`,
      );
      assert.ok(
        !commandLinks(content).some((command) => forbidden.test(command)),
        `${viewId} ${locale} should not link destructive commands`,
      );
    }
  }
});

test("welcome text is resource-oriented and not skill-only", () => {
  for (const viewId of [workspaceView, userView, remoteView]) {
    assert.doesNotMatch(
      localizedContent(viewId),
      /skill-only|skills only|Skill Ninja/i,
    );
    assert.doesNotMatch(
      localizedContent(viewId, "ja"),
      /skill-only|Skill Ninja/i,
    );
  }
});

test("user welcome names Global Resource Home", () => {
  assert.match(localizedContent(userView), /Global Resource Home/);
  assert.match(localizedContent(userView, "ja"), /Global Resource Home/);
});

test("remote welcome explains bundled or GitHub sources", () => {
  assert.match(
    localizedContent(remoteView),
    /bundled.*GitHub|GitHub.*bundled/i,
  );
  assert.match(localizedContent(remoteView, "ja"), /GitHub/);
});

test("welcome content stays compact for empty-state UI", () => {
  for (const viewId of [workspaceView, userView, remoteView]) {
    for (const locale of ["en", "ja"]) {
      const content = localizedContent(viewId, locale);
      assert.ok(
        content.length <= 360,
        `${viewId} ${locale} welcome content is too long`,
      );
      for (const line of content.split(/\r?\n/)) {
        assert.ok(
          line.length <= 140,
          `${viewId} ${locale} welcome line is too long: ${line}`,
        );
      }
    }
  }
});

console.log("RESULT=PASS");
