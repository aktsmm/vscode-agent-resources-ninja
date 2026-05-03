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
const i18nSource = fs.readFileSync(path.join(repoRoot, "src", "i18n.ts"), "utf8");
const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
const readmeJa = fs.readFileSync(path.join(repoRoot, "README_ja.md"), "utf8");

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function extractObjectKeys(source, objectName) {
  return Array.from(extractObjectBody(source, objectName).matchAll(/^\s{2}([A-Za-z0-9_]+):/gm), (entry) => entry[1]).sort();
}

function extractObjectBody(source, objectName) {
  const objectStart = source.indexOf(`const ${objectName}`);
  assert.notStrictEqual(objectStart, -1, `Missing object ${objectName}`);
  const bodyStart = source.indexOf("{", objectStart) + 1;
  const asConstEnd = source.indexOf("\n} as const;", bodyStart);
  const plainEnd = source.indexOf("\n};", bodyStart);
  const bodyEndCandidates = [asConstEnd, plainEnd].filter((index) => index !== -1);
  assert.ok(bodyEndCandidates.length > 0, `Missing end for object ${objectName}`);
  const bodyEnd = Math.min(...bodyEndCandidates);
  return source.slice(bodyStart, bodyEnd);
}

function extractObjectEntry(source, objectName, key) {
  const body = extractObjectBody(source, objectName);
  const matches = Array.from(body.matchAll(/^\s{2}([A-Za-z0-9_]+):/gm));
  const current = matches.find((match) => match[1] === key);
  assert.ok(current, `Missing ${objectName}.${key}`);
  const currentIndex = current.index;
  const next = matches.find((match) => match.index > currentIndex);
  const endIndex = next ? next.index : body.length;
  return body.slice(currentIndex, endIndex);
}

function placeholderCount(value) {
  return (value.match(/\{\d+\}/g) || []).sort().join(",");
}

function packagePlaceholderKeys() {
  return Array.from(JSON.stringify(packageJson).matchAll(/%([^%]+)%/g), (match) => match[1]).sort();
}

function maskUrlEscapes(value) {
  return value.replace(/%[0-9A-Fa-f]{2}/g, "");
}

const packageTextValues = Object.values(nls).concat(Object.values(nlsJa));
const i18nText = i18nSource;

test("package NLS English and Japanese keys match exactly", () => {
  assert.deepStrictEqual(Object.keys(nls).sort(), Object.keys(nlsJa).sort());
});

test("package JSON localization placeholders resolve in both locales", () => {
  for (const key of packagePlaceholderKeys()) {
    assert.ok(Object.hasOwn(nls, key), `Missing English package NLS key: ${key}`);
    assert.ok(Object.hasOwn(nlsJa, key), `Missing Japanese package NLS key: ${key}`);
  }
});

test("package NLS values do not contain unresolved localization placeholders", () => {
  for (const [key, value] of Object.entries(nls)) {
    assert.doesNotMatch(maskUrlEscapes(value), /%[A-Za-z0-9_.-]+%/, `Unresolved placeholder in package.nls.json ${key}`);
  }
  for (const [key, value] of Object.entries(nlsJa)) {
    assert.doesNotMatch(maskUrlEscapes(value), /%[A-Za-z0-9_.-]+%/, `Unresolved placeholder in package.nls.ja.json ${key}`);
  }
});

test("runtime i18n English and Japanese keys match exactly", () => {
  assert.deepStrictEqual(
    extractObjectKeys(i18nSource, "enMessages"),
    extractObjectKeys(i18nSource, "jaMessages"),
  );
});

test("runtime i18n placeholders match between English and Japanese", () => {
  for (const key of extractObjectKeys(i18nSource, "enMessages")) {
    const enEntry = extractObjectEntry(i18nSource, "enMessages", key);
    const jaEntry = extractObjectEntry(i18nSource, "jaMessages", key);
    assert.strictEqual(
      placeholderCount(enEntry),
      placeholderCount(jaEntry),
      `Placeholder mismatch for ${key}`,
    );
  }
});

test("command palette labels signal follow-up and destructive actions", () => {
  assert.match(nls["command.resetSettings"], /\.\.\.$/);
  assert.match(nlsJa["command.resetSettings"], /\.\.\.$/);
  const resetCommand = packageJson.contributes.commands.find(
    (command) => command.command === "resourceNinja.resetSettings",
  );
  assert.strictEqual(resetCommand.icon, "$(warning)");
  const hiddenFromPalette = new Set(
    (packageJson.contributes?.menus?.commandPalette || [])
      .filter((item) => item.when === "false")
      .map((item) => item.command),
  );
  for (const commandId of [
    "resourceNinja.uninstall",
    "resourceNinja.uninstallAll",
    "resourceNinja.uninstallMultiple",
    "resourceNinja.removeSource",
  ]) {
    assert.ok(hiddenFromPalette.has(commandId), `${commandId} should not be a top-level palette action`);
  }
});

test("GitHub token setting uses password presentation", () => {
  assert.strictEqual(
    packageJson.contributes.configuration.properties["resourceNinja.githubToken"].editPresentation,
    "password",
  );
});

test("GitHub token guidance follows least privilege", () => {
  const tokenGuidanceText = [
    nls["config.githubToken.markdownDescription"],
    nlsJa["config.githubToken.markdownDescription"],
    readme,
    readmeJa,
  ].join("\n");
  assert.doesNotMatch(tokenGuidanceText, /scopes=/);
  assert.doesNotMatch(tokenGuidanceText, /public_repo/);
  assert.doesNotMatch(tokenGuidanceText, /repo,read:org/);
  assert.doesNotMatch(tokenGuidanceText, /read:org/);
  assert.doesNotMatch(tokenGuidanceText, /Required scopes/i);
  assert.match(
    nls["config.githubToken.markdownDescription"],
    /no repository scopes are required/,
  );
  assert.match(
    nlsJa["config.githubToken.markdownDescription"],
    /リポジトリ scope は不要/,
  );
  assert.match(readme, /leave scopes unchecked/);
  assert.match(readmeJa, /scope は未選択/);
});

test("preview terminology is resource-oriented in both locales", () => {
  assert.match(extractObjectEntry(i18nSource, "enMessages", "previewTitle"), /Resource Preview/);
  assert.match(extractObjectEntry(i18nSource, "jaMessages", "previewTitle"), /リソース プレビュー/);
  assert.doesNotMatch(extractObjectEntry(i18nSource, "enMessages", "previewTitle"), /Skill Preview/);
});

test("Global Resource Home terminology is user-facing", () => {
  assert.match(extractObjectEntry(i18nSource, "enMessages", "installTargetCopilotHomeLabel"), /Global Resource Home/);
  assert.match(extractObjectEntry(i18nSource, "jaMessages", "installTargetCopilotHomeLabel"), /Global Resource Home/);
  for (const value of packageTextValues) {
    assert.doesNotMatch(value, /Copilot Home/);
  }
});

test("settings descriptions explain MCP config safety", () => {
  assert.match(nls["config.workspaceMcpDirectory.markdownDescription"], /explicitly merge compatible servers into `\.vscode\/mcp\.json`/);
  assert.match(nlsJa["config.workspaceMcpDirectory.markdownDescription"], /`\.vscode\/mcp\.json` へ明示的にマージ/);
  assert.match(nls["config.defaultInstallTarget.markdownDescription"], /keep them for review or explicitly merge compatible servers/);
  assert.match(nlsJa["config.defaultInstallTarget.markdownDescription"], /レビュー用に保持するか、互換 server を `\.vscode\/mcp\.json` へ明示的にマージ/);
});

test("settings descriptions distinguish skill index from native resource paths", () => {
  assert.match(nls["config.instructionFile.markdownDescription"], /Agent Skills index/);
  assert.match(nls["config.instructionFile.markdownDescription"], /native paths/);
  assert.match(nlsJa["config.instructionFile.markdownDescription"], /Agent Skills index/);
  assert.match(nlsJa["config.instructionFile.markdownDescription"], /ネイティブな保存先/);
});

test("settings output format copy stays professional", () => {
  const outputFormatText = [
    nls["config.outputFormat.markdownDescription"],
    nls["config.outputFormat.full"],
    nls["config.outputFormat.compact"],
    nls["config.outputFormat.legacy"],
    nlsJa["config.outputFormat.markdownDescription"],
    nlsJa["config.outputFormat.full"],
    nlsJa["config.outputFormat.compact"],
    nlsJa["config.outputFormat.legacy"],
  ].join("\n");
  assert.doesNotMatch(outputFormatText, /[🌟✅📦🕰️]/u);
  assert.doesNotMatch(outputFormatText, /\bOLD\b/);
  assert.match(outputFormatText, /compatibility mode|互換モード/);
  assert.match(outputFormatText, /Agent Skills index/);
});

test("instruction file enum descriptions match exact targets", () => {
  const instructionFileSetting =
    packageJson.contributes.configuration.properties[
      "resourceNinja.instructionFile"
    ];
  const enumEntries = instructionFileSetting.enum.map((value, index) => ({
    value,
    key: instructionFileSetting.enumDescriptions[index].replace(/%/g, ""),
  }));
  for (const { value, key } of enumEntries) {
    if (value === "none" || value === "custom") {
      continue;
    }
    assert.match(nls[key], new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(nlsJa[key], new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(nls["config.instructionFile.agents"], /Copilot CLI/);
  assert.match(nlsJa["config.instructionFile.agents"], /Copilot CLI/);
});

test("docs and package metadata avoid legacy Skill Ninja branding", () => {
  const combinedText = [
    JSON.stringify(packageJson),
    JSON.stringify(nls),
    JSON.stringify(nlsJa),
    i18nText,
    readme,
    readmeJa,
  ].join("\n");
  assert.doesNotMatch(combinedText, /Skill Ninja/i);
});

test("release-facing version info matches package version", () => {
  const version = packageJson.version;
  assert.match(nls["config.versionInfo.markdownDescription"], new RegExp(`Extension \\| \\*\\*${version.replace(/\./g, "\\.")}\\*\\*`));
  assert.match(nlsJa["config.versionInfo.markdownDescription"], new RegExp(`Extension \\| \\*\\*${version.replace(/\./g, "\\.")}\\*\\*`));
});

console.log("RESULT=PASS");
