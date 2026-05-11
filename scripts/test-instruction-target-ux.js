#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const extensionSource = fs
  .readFileSync(path.join(repoRoot, "src", "extension.ts"), "utf8")
  .replace(/\r\n?/g, "\n");
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

function sourceBetween(startPattern, endPattern) {
  const start = extensionSource.search(startPattern);
  assert.notStrictEqual(start, -1, `Missing start pattern: ${startPattern}`);
  const remainder = extensionSource.slice(start);
  const end = remainder.search(endPattern);
  assert.notStrictEqual(end, -1, `Missing end pattern: ${endPattern}`);
  return remainder.slice(0, end);
}

const instructionTargetHelperSource = sourceBetween(
  /function getInstructionTargetLabel\(/,
  /\n\}\n\nfunction sanitizeResourceName/,
);
const editWhenToUseSource = sourceBetween(
  /const editWhenToUseCmd = vscode\.commands\.registerCommand\(/,
  /\n\s*async function pickInstallTarget/,
);
const updateInstructionSource = sourceBetween(
  /const updateInstructionCmd = vscode\.commands\.registerCommand\(/,
  /\n\s*async function openInstructionFileForScope\(/,
);
const openInstructionSource = sourceBetween(
  /const openInstructionFileCmd = vscode\.commands\.registerCommand\(/,
  /\n\s*\/\/ Command: Open settings/,
);
const openInstructionScopeSource = sourceBetween(
  /async function openInstructionFileForScope\(/,
  /\n\s*\/\/ Command: Open settings/,
);

test("instruction target helper uses configured instruction file", () => {
  assert.match(
    instructionTargetHelperSource,
    /getConfiguredInstructionFilePath\(config\)/,
  );
});

test("instruction target helper handles disabled sync target", () => {
  assert.match(instructionTargetHelperSource, /DISABLED_INSTRUCTION_FILE/);
  assert.match(instructionTargetHelperSource, /isJa \? "無効" : "disabled"/);
});

test("instruction target enabled helper rejects disabled target", () => {
  assert.match(
    instructionTargetHelperSource,
    /function isInstructionTargetEnabled\(/,
  );
  assert.match(
    instructionTargetHelperSource,
    /getConfiguredInstructionFilePath\(config\) !== DISABLED_INSTRUCTION_FILE/,
  );
});

test("edit when-to-use prompt uses instruction target helper", () => {
  assert.match(
    editWhenToUseSource,
    /const instructionTarget = getInstructionTargetLabel\(/,
  );
  assert.match(editWhenToUseSource, /getInstructionTargetLabel\(config, isJapanese\(\)\)/);
});

test("edit when-to-use prompt avoids hardcoded AGENTS wording", () => {
  assert.doesNotMatch(editWhenToUseSource, /shown in AGENTS\.md/);
  assert.doesNotMatch(editWhenToUseSource, /AGENTS\.md に表示/);
});

test("edit when-to-use prompt explains generated instruction block", () => {
  assert.match(editWhenToUseSource, /generated instruction block/);
  assert.match(editWhenToUseSource, /生成される instruction block/);
});

test("edit when-to-use prompt shows current target", () => {
  assert.match(editWhenToUseSource, /target: \$\{instructionTarget\}/);
  assert.match(editWhenToUseSource, /同期先: \$\{instructionTarget\}/);
});

test("edit when-to-use prompt handles disabled sync target", () => {
  assert.match(editWhenToUseSource, /const instructionTargetEnabled = isInstructionTargetEnabled\(config\)/);
  assert.match(editWhenToUseSource, /Instruction file sync target is disabled/);
  assert.match(editWhenToUseSource, /インストラクションファイル同期先は無効です/);
});

test("edit when-to-use prompt distinguishes automatic update disabled", () => {
  assert.match(editWhenToUseSource, /const autoUpdateInstruction =/);
  assert.match(editWhenToUseSource, /autoUpdateInstruction"\) !== false/);
  assert.match(editWhenToUseSource, /Automatic instruction updates are disabled/);
  assert.match(editWhenToUseSource, /自動更新は無効です/);
  assert.match(editWhenToUseSource, /Update Instruction File to refresh \$\{instructionTarget\}/);
});

test("edit when-to-use still preserves reset-to-default guidance", () => {
  assert.match(editWhenToUseSource, /leave empty to reset to default/);
  assert.match(editWhenToUseSource, /空にするとデフォルトに戻ります/);
});

test("edit when-to-use only auto-updates enabled instruction targets", () => {
  assert.match(editWhenToUseSource, /const shouldUpdateInstructionIndex =/);
  assert.match(editWhenToUseSource, /instructionTargetEnabled && autoUpdateInstruction/);
  assert.match(editWhenToUseSource, /if \(shouldUpdateInstructionIndex\) \{/);
});

test("edit when-to-use success distinguishes metadata-only save", () => {
  assert.match(editWhenToUseSource, /Saved description metadata/);
  assert.match(editWhenToUseSource, /説明メタデータを保存しました/);
  assert.match(editWhenToUseSource, /refreshed \$\{instructionTarget\}/);
  assert.match(editWhenToUseSource, /\$\{instructionTarget\} を更新しました/);
  assert.match(editWhenToUseSource, /Automatic instruction updates are disabled; run Update Instruction File/);
  assert.match(editWhenToUseSource, /Instruction file sync target is disabled/);
});

test("update instruction success includes configured target", () => {
  assert.match(
    updateInstructionSource,
    /const instructionTarget = getInstructionTargetLabel\(/,
  );
  assert.match(
    updateInstructionSource,
    /Instruction file updated: \$\{instructionTarget\}/,
  );
  assert.match(
    updateInstructionSource,
    /インストラクションファイルを更新しました: \$\{instructionTarget\}/,
  );
});

test("update instruction does not report success for disabled target", () => {
  assert.match(updateInstructionSource, /if \(!isInstructionTargetEnabled\(config\)\) \{/);
  assert.match(updateInstructionSource, /Instruction file sync is disabled in settings/);
  assert.match(updateInstructionSource, /resourceNinja\.openSettings/);
  assert.match(updateInstructionSource, /return;/);
  assert.doesNotMatch(updateInstructionSource, /Instruction file updated: disabled/);
});

test("update instruction error stays target-neutral", () => {
  assert.match(updateInstructionSource, /Failed to update instruction file:/);
  assert.match(
    updateInstructionSource,
    /インストラクションファイルの更新に失敗しました:/,
  );
  assert.doesNotMatch(updateInstructionSource, /AGENTS\.md/);
});

test("open instruction file flow still shows resolved path", () => {
  assert.match(
    openInstructionScopeSource,
    /resolveInstructionFileUri\(workspaceFolder\.uri, config\)/,
  );
  assert.match(openInstructionScopeSource, /fileUri\.fsPath/);
});

test("global instruction target helper uses global resolver", () => {
  assert.match(instructionTargetHelperSource, /function getGlobalInstructionTargetLabel\(/);
  assert.match(instructionTargetHelperSource, /resolveGlobalInstructionFileUri\(workspaceUri, config\)/);
});

test("workspace open instruction command stays workspace scoped", () => {
  assert.match(openInstructionScopeSource, /resourceNinja\.openInstructionFile/);
  assert.match(openInstructionScopeSource, /openInstructionFileForScope\("workspace"\)/);
  assert.match(openInstructionScopeSource, /resolveInstructionFileUri\(workspaceFolder\.uri, config\)/);
});

test("global open instruction command uses global home scope", () => {
  assert.match(openInstructionScopeSource, /resourceNinja\.openGlobalInstructionFile/);
  assert.match(openInstructionScopeSource, /openInstructionFileForScope\("globalHome"\)/);
  assert.match(openInstructionScopeSource, /resolveGlobalInstructionFileUri\(workspaceFolder\.uri, config\)/);
  assert.match(openInstructionScopeSource, /getGlobalInstructionTargetLabel\(workspaceFolder\.uri, config\)/);
});

test("workspace and global view toolbars open different instruction targets", () => {
  const titleMenus = packageJson.contributes?.menus?.["view/title"] || [];
  const commandForWhen = (when) =>
    titleMenus.filter((item) => item.when === when).map((item) => item.command);
  assert.ok(
    commandForWhen("view == resourceNinja.installedView").includes(
      "resourceNinja.openInstructionFile",
    ),
  );
  assert.ok(
    commandForWhen("view == resourceNinja.userResourcesView").includes(
      "resourceNinja.openGlobalInstructionFile",
    ),
  );
  assert.ok(
    !commandForWhen("view == resourceNinja.userResourcesView").includes(
      "resourceNinja.openInstructionFile",
    ),
  );
});

test("workspace and global view toolbars update different instruction targets", () => {
  const titleMenus = packageJson.contributes?.menus?.["view/title"] || [];
  const commandForWhen = (when) =>
    titleMenus.filter((item) => item.when === when).map((item) => item.command);
  assert.ok(
    commandForWhen("view == resourceNinja.installedView").includes(
      "resourceNinja.updateInstruction",
    ),
  );
  assert.ok(
    commandForWhen("view == resourceNinja.userResourcesView").includes(
      "resourceNinja.updateGlobalInstruction",
    ),
  );
  assert.ok(
    !commandForWhen("view == resourceNinja.userResourcesView").includes(
      "resourceNinja.updateInstruction",
    ),
  );
});

test("global update instruction command uses global resolver", () => {
  assert.match(updateInstructionSource, /resourceNinja\.updateGlobalInstruction/);
  assert.match(updateInstructionSource, /resolveGlobalInstructionFileUri\(\s*workspaceFolder\.uri,\s*config,\s*\)/);
  assert.match(updateInstructionSource, /updateInstructionFileAtUri\(/);
  assert.match(updateInstructionSource, /getGlobalInstructionTargetLabel\(\s*workspaceFolder\.uri,\s*config,\s*\)/);
});

test("global open instruction command is hidden from command palette", () => {
  const hiddenCommands = new Set(
    (packageJson.contributes?.menus?.commandPalette || [])
      .filter((item) => item.when === "false")
      .map((item) => item.command),
  );
  assert.ok(hiddenCommands.has("resourceNinja.openGlobalInstructionFile"));
  assert.ok(hiddenCommands.has("resourceNinja.updateGlobalInstruction"));
});

test("global instruction command titles identify global target", () => {
  const commands = Object.fromEntries(
    (packageJson.contributes?.commands || []).map((command) => [
      command.command,
      command.title,
    ]),
  );
  assert.strictEqual(
    commands["resourceNinja.openInstructionFile"],
    "%command.openInstructionFile%",
  );
  assert.strictEqual(
    commands["resourceNinja.updateInstruction"],
    "%command.updateInstruction%",
  );
  assert.strictEqual(
    commands["resourceNinja.openGlobalInstructionFile"],
    "%command.openGlobalInstructionFile%",
  );
  assert.strictEqual(
    commands["resourceNinja.updateGlobalInstruction"],
    "%command.updateGlobalInstruction%",
  );
  assert.match(nls["command.openGlobalInstructionFile"], /Global Instruction File/);
  assert.match(nls["command.updateGlobalInstruction"], /Global Instruction File/);
  assert.match(nlsJa["command.openGlobalInstructionFile"], /Global のインストラクションファイル/);
  assert.match(nlsJa["command.updateGlobalInstruction"], /Global のインストラクションファイル/);
});

test("instruction file setting exposes non-default targets", () => {
  const instructionFile =
    packageJson.contributes?.configuration?.properties?.[
      "resourceNinja.instructionFile"
    ];
  for (const target of [
    "~/.copilot/copilot-instructions.md",
    ".github/copilot-instructions.md",
    ".github/instructions/SkillList.instructions.md",
    "CLAUDE.md",
    ".cursor/rules/skills.mdc",
    ".windsurfrules",
    ".clinerules",
  ]) {
    assert.ok(
      instructionFile?.enum?.includes(target),
      `Missing target: ${target}`,
    );
  }
});

test("localized command labels use instruction file terminology", () => {
  assert.match(nls["command.openInstructionFile"], /Instruction File/);
  assert.match(
    nlsJa["command.openInstructionFile"],
    /インストラクションファイル/,
  );
  assert.match(nls["command.updateInstruction"], /Instruction File/);
  assert.match(
    nlsJa["command.updateInstruction"],
    /インストラクションファイル/,
  );
});

console.log("RESULT=PASS");
