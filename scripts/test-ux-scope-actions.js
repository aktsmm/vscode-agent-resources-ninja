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
const extensionSource = fs.readFileSync(
  path.join(repoRoot, "src", "extension.ts"),
  "utf8",
);
const treeProviderSource = fs.readFileSync(
  path.join(repoRoot, "src", "treeProvider.ts"),
  "utf8",
);
const userResourcesProviderSource = fs.readFileSync(
  path.join(repoRoot, "src", "userResourcesProvider.ts"),
  "utf8",
);
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

function titleMenuCommandsFor(viewId) {
  return (packageJson.contributes?.menus?.["view/title"] || [])
    .filter((item) => item.when === `view == ${viewId}`)
    .map((item) => item.command);
}

function itemMenuHas(command, when) {
  return (packageJson.contributes?.menus?.["view/item/context"] || []).some(
    (item) => item.command === command && item.when === when,
  );
}

test("all resource views expose settings", () => {
  for (const viewId of [
    "resourceNinja.installedView",
    "resourceNinja.userResourcesView",
    "resourceNinja.browseView",
  ]) {
    assert.ok(
      titleMenuCommandsFor(viewId).includes("resourceNinja.openSettings"),
    );
  }
});

test("all resource views expose create resource", () => {
  for (const viewId of [
    "resourceNinja.installedView",
    "resourceNinja.userResourcesView",
    "resourceNinja.browseView",
  ]) {
    assert.ok(
      titleMenuCommandsFor(viewId).includes("resourceNinja.createResource"),
    );
  }
});

test("instruction index actions are scoped to workspace and global views", () => {
  assert.ok(
    titleMenuCommandsFor("resourceNinja.installedView").includes(
      "resourceNinja.openInstructionFile",
    ),
  );
  assert.ok(
    titleMenuCommandsFor("resourceNinja.userResourcesView").includes(
      "resourceNinja.openGlobalInstructionFile",
    ),
  );
  assert.ok(
    !titleMenuCommandsFor("resourceNinja.userResourcesView").includes(
      "resourceNinja.openInstructionFile",
    ),
  );
  for (const command of [
    "resourceNinja.openInstructionFile",
    "resourceNinja.openGlobalInstructionFile",
    "resourceNinja.updateInstruction",
    "resourceNinja.updateGlobalInstruction",
  ]) {
    assert.ok(
      !titleMenuCommandsFor("resourceNinja.browseView").includes(command),
    );
  }
  assert.ok(
    titleMenuCommandsFor("resourceNinja.installedView").includes(
      "resourceNinja.updateInstruction",
    ),
  );
  assert.ok(
    titleMenuCommandsFor("resourceNinja.userResourcesView").includes(
      "resourceNinja.updateGlobalInstruction",
    ),
  );
  assert.ok(
    !titleMenuCommandsFor("resourceNinja.userResourcesView").includes(
      "resourceNinja.updateInstruction",
    ),
  );
});

test("workspace bulk skill commands are labeled as workspace scoped", () => {
  assert.strictEqual(
    nls["command.reinstallAll"],
    "Reinstall All Workspace Skills",
  );
  assert.strictEqual(
    nls["command.uninstallAll"],
    "Uninstall All Workspace Skills",
  );
  assert.strictEqual(
    nlsJa["command.reinstallAll"],
    "ワークスペース skill をすべて再インストール",
  );
  assert.strictEqual(
    nlsJa["command.uninstallAll"],
    "ワークスペース skill をすべて削除",
  );
});

test("workspace reinstall is a per-resource inline action", () => {
  const titleCommands = titleMenuCommandsFor("resourceNinja.installedView");
  assert.ok(!titleCommands.includes("resourceNinja.reinstallAll"));
  assert.ok(
    itemMenuHas(
      "resourceNinja.reinstall",
      "view == resourceNinja.installedView && (viewItem == installedRemoteSkill || viewItem == installedRemoteResource)",
    ),
  );
  assert.strictEqual(nls["command.reinstall"], "Reinstall Resource");
  assert.strictEqual(nlsJa["command.reinstall"], "リソースを再インストール");
});

test("workspace resource kind groups expose bulk reinstall action", () => {
  assert.ok(
    itemMenuHas(
      "resourceNinja.reinstallResourceGroup",
      "view == resourceNinja.installedView && viewItem == workspaceResourceType",
    ),
  );
  assert.strictEqual(
    nls["command.reinstallResourceGroup"],
    "Reinstall Resource Group",
  );
  assert.strictEqual(
    nlsJa["command.reinstallResourceGroup"],
    "リソースグループを再インストール",
  );
  assert.match(extensionSource, /resourceNinja\.reinstallResourceGroup/);
  assert.match(extensionSource, /workspaceResourceType/);
});

test("user global resources expose reinstall actions", () => {
  assert.ok(
    itemMenuHas(
      "resourceNinja.reinstallUserResource",
      "view == resourceNinja.userResourcesView && viewItem == userRemoteResource",
    ),
  );
  assert.ok(
    itemMenuHas(
      "resourceNinja.reinstallUserResourceGroup",
      "view == resourceNinja.userResourcesView && (viewItem == kind || viewItem == plugin)",
    ),
  );
  assert.strictEqual(
    nls["command.reinstallUserResource"],
    "Reinstall User / Global Resource",
  );
  assert.strictEqual(
    nlsJa["command.reinstallUserResource"],
    "ユーザー / グローバル リソースを再インストール",
  );
  assert.match(userResourcesProviderSource, /userRemoteResource/);
  assert.match(extensionSource, /resourceNinja\.reinstallUserResource/);
  assert.match(extensionSource, /resourceNinja\.reinstallUserResourceGroup/);
});

test("bundle-facing language is install set language", () => {
  assert.strictEqual(nls["command.installBundle"], "Install Curated Set");
  assert.strictEqual(
    nlsJa["command.installBundle"],
    "おすすめセットをインストール",
  );
  assert.match(treeProviderSource, /Curated Install Sets/);
  assert.match(treeProviderSource, /おすすめまとめインストール/);
  assert.match(treeProviderSource, /formatResourceKindCountSummary/);
  assert.doesNotMatch(extensionSource, /Select Bundle Resources/);
  assert.doesNotMatch(extensionSource, /Bundle インストール対象/);
});

test("plugin resources install is a separate visible action", () => {
  assert.strictEqual(
    nls["command.installPluginResources"],
    "Pick & Install from Plugin",
  );
  assert.strictEqual(
    nlsJa["command.installPluginResources"],
    "プラグイン中身を選んでインストール",
  );
  assert.ok(
    itemMenuHas(
      "resourceNinja.installPluginResources",
      "view == resourceNinja.browseView && viewItem == plugin",
    ),
  );
  assert.match(extensionSource, /resourceNinja\.installPluginResources/);
  assert.match(extensionSource, /everything is preselected/);
  assert.match(extensionSource, /すべて選択済み、不要なら解除/);
});

test("plugin grouped resources install uses virtual install sets", () => {
  assert.match(treeProviderSource, /const virtualBundle/);
  assert.match(
    treeProviderSource,
    /plugin\.resources\.map\(\(resource\) => resource\.path\)/,
  );
  assert.match(treeProviderSource, /getPluginPackageCandidates/);
  assert.match(treeProviderSource, /getPluginPackageId/);
  assert.match(
    extensionSource,
    /s\.path === skillName && s\.source === bundle\.source/,
  );
});

test("plugin grouping labels distinguish remote contents from installed origins", () => {
  assert.match(treeProviderSource, /Pick from a Plugin/);
  assert.match(treeProviderSource, /プラグイン中身を選択/);
  assert.match(treeProviderSource, /Indexed contents only/);
  assert.match(treeProviderSource, /インデックス済み中身のみ/);
  assert.match(treeProviderSource, /"Plugin"\}: \$\{pluginLabel\}/);
  assert.match(treeProviderSource, /Remote path/);
  assert.match(treeProviderSource, /Plugin resource kind row/);
  assert.match(userResourcesProviderSource, /"Plugin"\}: \$\{pluginId\}/);
  assert.match(userResourcesProviderSource, /Plugin Origins/);
  assert.match(userResourcesProviderSource, /プラグイン由来/);
});

test("installed plugin grouping falls back beyond remotePath", () => {
  assert.match(
    treeProviderSource,
    /getPluginIdFromPath\(resource\.relativePath\)/,
  );
  assert.match(treeProviderSource, /getPluginIdFromPath\(resource\.fullPath\)/);
  assert.match(
    userResourcesProviderSource,
    /getPluginIdFromPath\(resource\.relativePath\)/,
  );
  assert.match(
    userResourcesProviderSource,
    /getPluginIdFromPath\(resource\.fullPath\)/,
  );
  assert.match(extensionSource, /getInstalledPluginId/);
});

test("resource rows expose installed mcp and hook lifecycle states", () => {
  assert.match(treeProviderSource, /Recently installed/);
  assert.match(treeProviderSource, /Installed/);
  assert.match(treeProviderSource, /formatMcpLifecycleLabel/);
  assert.match(treeProviderSource, /formatHookDiagnosticsLabel/);
  assert.match(treeProviderSource, /isHookConfigFilePath/);
  assert.match(treeProviderSource, /Detected as a Copilot hook JSON config/);
  assert.match(userResourcesProviderSource, /formatMcpLifecycleLabel/);
  assert.match(userResourcesProviderSource, /formatHookDiagnosticsLabel/);
  assert.match(userResourcesProviderSource, /isHookConfigResource/);
  assert.match(
    userResourcesProviderSource,
    /Detected as a Copilot hook JSON config/,
  );
  assert.match(extensionSource, /Copied MCP config for review/);
  assert.match(extensionSource, /Hook config:/);
});

test("every surface that lists an installed resource shows the incomplete state", () => {
  const mcpToolsSource = fs.readFileSync(
    path.join(repoRoot, "src", "mcpTools.ts"),
    "utf8",
  );
  const chatParticipantSource = fs.readFileSync(
    path.join(repoRoot, "src", "chatParticipant.ts"),
    "utf8",
  );

  // Bind each assertion to the expression that reads the flag, so a decorative
  // mention of "incomplete" elsewhere in the file cannot satisfy the guard.
  assert.match(
    treeProviderSource,
    /skill\.incomplete\s*\n?\s*\?\s*new vscode\.ThemeIcon\(\s*\n?\s*"warning"/,
    "treeProvider must pick the warning icon from skill.incomplete",
  );
  assert.match(
    treeProviderSource,
    /skill\.incomplete\s*\n?\s*\?\s*\[baseDescription, incompleteLabel\]/,
    "treeProvider must append the incomplete label to the row description",
  );
  assert.match(
    treeProviderSource,
    /skill\.incomplete[\s\S]{0,200}?⚠ (Incomplete|不完全)/,
    "treeProvider must explain the incomplete state in the tooltip",
  );

  assert.match(
    userResourcesProviderSource,
    /resource\.incomplete\s*\n?\s*\?\s*new vscode\.ThemeIcon\(\s*\n?\s*"warning"/,
    "userResourcesProvider must pick the warning icon from resource.incomplete",
  );
  assert.match(
    userResourcesProviderSource,
    /const incompleteLabel = resource\.incomplete/,
    "userResourcesProvider must derive the row label from resource.incomplete",
  );
  // The read-only branch is a separate description path and dropped the label once.
  assert.match(
    userResourcesProviderSource,
    /isReadOnly\s*\n?\s*\?\s*\[[\s\S]{0,200}?incompleteLabel,/,
    "the read-only description branch must keep the incomplete label",
  );
  assert.match(
    userResourcesProviderSource,
    /resource\.incomplete[\s\S]{0,200}?⚠ (Incomplete|不完全)/,
    "userResourcesProvider must explain the incomplete state in the tooltip",
  );

  // The language-model surfaces are where a silently broken resource does the most damage.
  for (const [label, source] of [
    ["mcpTools.ts", mcpToolsSource],
    ["chatParticipant.ts", chatParticipantSource],
  ]) {
    assert.match(
      source,
      /resource\.incomplete\s*\n?\s*\?\s*`\$\{INCOMPLETE_ROW_MARKER\} `/,
      `${label} must mark an incomplete row from resource.incomplete`,
    );
  }
  assert.match(
    mcpToolsSource,
    /do not rely on its contents/,
    "the resource list tool must tell the model not to trust an incomplete resource",
  );

  assert.match(
    extensionSource,
    /meta\.incomplete\s*\n?\s*\?\s*`\$\(warning\) \$\{meta\.name\}`/,
    "the reinstall picker must flag an incomplete resource",
  );
});

test("docs explain the incomplete resource state and its recovery", () => {
  assert.match(readme, /### Incomplete Resources/);
  assert.match(readme, /warning \(red\)\s*\|\s*Incomplete resource/);
  assert.match(readme, /\*\*Reinstall\*\*, \*\*Update Index\*\*/);
  assert.match(readmeJa, /### 不完全なリソース/);
  assert.match(readmeJa, /warning \(赤\)\s*\|\s*不完全なリソース/);
  assert.match(readmeJa, /\*\*再インストール\*\*、\*\*インデックス更新\*\*/);
});

// Chat output is model context too, so third-party text must not shape it.
test("chat output escapes third-party resource text", () => {
  const chatParticipantSource = fs.readFileSync(
    path.join(repoRoot, "src", "chatParticipant.ts"),
    "utf8",
  );

  // Analyse whole `stream.markdown(...)` calls, not lines, so splitting an
  // interpolation and its escape across two lines cannot hide a regression.
  const calls = [];
  const marker = "stream.markdown(";
  let cursor = chatParticipantSource.indexOf(marker);
  while (cursor !== -1) {
    let depth = 0;
    let index = cursor + marker.length - 1;
    for (; index < chatParticipantSource.length; index += 1) {
      const character = chatParticipantSource[index];
      if (character === "(") depth += 1;
      if (character === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push(chatParticipantSource.slice(cursor, index + 1));
    assert.strictEqual(
      depth,
      0,
      "found an unbalanced stream.markdown call; the guard cannot analyse it",
    );
    cursor = chatParticipantSource.indexOf(marker, index + 1);
  }
  assert.ok(calls.length > 5, "expected to find the chat markdown calls");

  // Everything here originates in a third-party repository or an error path.
  const untrustedValues = [
    "resource.name",
    "resource.source",
    "resource.url",
    "resource.stars",
    "category",
    "getLocalizedDescription(",
    "error.message",
  ];

  const unescaped = [];
  for (const call of calls) {
    for (const value of untrustedValues) {
      if (!call.includes(value)) {
        continue;
      }
      const interpolations = call.match(/\$\{[\s\S]*?\}/g) || [];
      const offending = interpolations.filter((fragment) => {
        if (!fragment.includes(value)) {
          return false;
        }
        // Numeric coercion only proves anything for a value that is a number.
        if (fragment.includes("Number(")) {
          return value !== "resource.stars";
        }
        return !/escapeMarkdownCell\(|escapeMarkdownLinkDestination\(/.test(
          fragment,
        );
      });
      if (offending.length > 0) {
        unescaped.push(`${value}: ${offending[0].replace(/\s+/g, " ")}`);
      }
    }
  }

  assert.deepStrictEqual(
    unescaped,
    [],
    "wrap third-party chat values in escapeMarkdownCell or escapeMarkdownLinkDestination",
  );
});

test("recently installed tree badges have textual status alternatives", () => {
  assert.match(treeProviderSource, /const recentLabel = isRecent/);
  assert.match(
    treeProviderSource,
    /recentLabel,[\s\S]*sourceLabel \? `installed from \$\{sourceLabel\}` : "installed"/,
  );
  assert.match(treeProviderSource, /const accessibleStatusText = isRecent/);
  assert.match(userResourcesProviderSource, /const recentLabel = isRecent/);
  assert.match(
    userResourcesProviderSource,
    /recentLabel,[\s\S]*pluginLabel,[\s\S]*resource\.lifecycleLabel/,
  );
  assert.match(userResourcesProviderSource, /Status[\s\S]*Recently installed/);
});

test("remote resource rows support click installs for every resource kind", () => {
  assert.match(treeProviderSource, /getResourceKind\(skill\)/);
  assert.match(treeProviderSource, /command: singleClickInstall/);
  assert.match(treeProviderSource, /resourceNinja\.installDefault/);
  assert.match(treeProviderSource, /resourceNinja\.onSkillClick/);
  for (const kind of [
    "skill",
    "agent",
    "instruction",
    "prompt",
    "hook",
    "mcp",
    "plugin",
    "cursor-rule",
  ]) {
    assert.match(treeProviderSource, new RegExp(`"${kind}"`));
  }
});

test("browse view shows reinstall inline on already installed remote rows", () => {
  assert.match(
    treeProviderSource,
    /const browseContextValue = isInstalled[\s\S]*"installedRemoteSkill"[\s\S]*"installedRemoteResource"[\s\S]*: "skill"/,
  );
  assert.match(
    treeProviderSource,
    /if \(isInstalled\) \{[\s\S]*item\.command = \{[\s\S]*resourceNinja\.onSkillClick[\s\S]*\} else \{[\s\S]*item\.command = \{/,
  );
  assert.ok(
    itemMenuHas(
      "resourceNinja.install",
      "view == resourceNinja.browseView && viewItem == skill",
    ),
  );
  assert.ok(
    itemMenuHas(
      "resourceNinja.reinstall",
      "view == resourceNinja.browseView && (viewItem == installedRemoteSkill || viewItem == installedRemoteResource)",
    ),
  );
});

test("browse installed remote rows keep preview and metadata actions", () => {
  assert.ok(
    itemMenuHas(
      "resourceNinja.preview",
      "view == resourceNinja.browseView && (viewItem == skill || viewItem == installedRemoteSkill || viewItem == installedRemoteResource)",
    ),
  );
  assert.ok(
    itemMenuHas(
      "resourceNinja.toggleFavorite",
      "view == resourceNinja.browseView && (viewItem == skill || viewItem == installedRemoteSkill || viewItem == installedRemoteResource)",
    ),
  );
  assert.ok(
    itemMenuHas(
      "resourceNinja.openOnGitHub",
      "view == resourceNinja.browseView && (viewItem == skill || viewItem == installedRemoteSkill || viewItem == installedRemoteResource || viewItem == source || viewItem == remoteKindSource)",
    ),
  );
  assert.ok(
    itemMenuHas(
      "resourceNinja.copyUrl",
      "view == resourceNinja.browseView && (viewItem == skill || viewItem == installedRemoteSkill || viewItem == installedRemoteResource || viewItem == source || viewItem == remoteKindSource)",
    ),
  );
});

test("browse installed detection skips local-only installs", () => {
  assert.match(
    treeProviderSource,
    /if \(!meta\.source \|\| meta\.source === "local" \|\| !meta\.remotePath\) \{[\s\S]*return;/,
  );
  assert.match(
    treeProviderSource,
    /resource\.source &&[\s\S]*resource\.source !== "local" &&[\s\S]*resource\.remotePath/,
  );
});

test("default click installs mcp configs as copy-only without activation picker", () => {
  assert.match(
    extensionSource,
    /resourceKind === "mcp"[\s\S]*mode === "default"[\s\S]*mcpInstallMode: "copyOnly"/,
  );
  assert.match(
    extensionSource,
    /mode === "default"[\s\S]*: await pickMcpInstallMode\(1\)/,
  );
});

test("instruction file creation dialog is localized", () => {
  assert.match(
    extensionSource,
    /const createLabel = isJa \? "作成" : "Create"/,
  );
  assert.match(
    extensionSource,
    /const cancelLabel = isJa \? "キャンセル" : "Cancel"/,
  );
  assert.match(
    extensionSource,
    /output was not found\.[\s\S]*Create the sync target file\?/,
  );
});

test("user global skill delete refreshes instruction index", () => {
  assert.match(
    extensionSource,
    /resource\.kind === "skill"[\s\S]*autoUpdateInstruction[\s\S]*updateInstructionFile\(wsFolder\.uri, context\)/,
  );
});

test("plugin cleanup refreshes instruction index when skills were deleted", () => {
  assert.match(extensionSource, /let deletedSkills = 0/);
  assert.match(extensionSource, /deletedSkills\+\+/);
  assert.match(
    extensionSource,
    /deletedSkills > 0[\s\S]*updateInstructionFile\(wsFolder\.uri, context\)/,
  );
});

test("hook plugin cleanup removes folders but keeps JSON configs file-scoped", () => {
  assert.match(extensionSource, /const isDirectoryBackedHook/);
  assert.match(extensionSource, /!isHookConfigFilePath\(fullPath\)/);
  assert.match(
    extensionSource,
    /kind === "skill" \|\| isDirectoryBackedHook[\s\S]*path\.dirname\(fullPath\)[\s\S]*: fullPath/,
  );
  assert.match(
    extensionSource,
    /recursive: kind === "skill" \|\| isDirectoryBackedHook/,
  );
});

test("install set success reports skipped resources", () => {
  assert.match(
    extensionSource,
    /const skippedSummary = missingResources\.length/,
  );
  assert.match(extensionSource, /skipped/);
  assert.match(extensionSource, /スキップ/);
});

test("docs explain install sets and plugin grouping", () => {
  assert.match(readme, /Curated Install Sets/);
  assert.match(readme, /Pick from a Plugin/);
  assert.match(readme, /Plugin Origins/);
  assert.match(readmeJa, /おすすめまとめインストール/);
  assert.match(readmeJa, /プラグイン中身を選択/);
  assert.match(readmeJa, /プラグイン由来/);
});

test("create resource workspace roots use configured resource directories", () => {
  assert.match(
    extensionSource,
    /getConfiguredWorkspaceAgentsDirectory\(config\)/,
  );
  assert.match(
    extensionSource,
    /getConfiguredWorkspaceInstructionsDirectory\(config\)/,
  );
  assert.match(
    extensionSource,
    /getConfiguredWorkspacePromptsDirectory\(config\)/,
  );
  assert.match(
    extensionSource,
    /getConfiguredWorkspaceHooksDirectory\(config\)/,
  );
  assert.match(extensionSource, /getConfiguredWorkspaceMcpDirectory\(config\)/);
});

test("create resource workspace roots use exported defaults", () => {
  for (const defaultName of [
    "DEFAULT_WORKSPACE_AGENTS_DIRECTORY",
    "DEFAULT_WORKSPACE_INSTRUCTIONS_DIRECTORY",
    "DEFAULT_WORKSPACE_PROMPTS_DIRECTORY",
    "DEFAULT_WORKSPACE_HOOKS_DIRECTORY",
    "DEFAULT_WORKSPACE_MCP_DIRECTORY",
  ]) {
    assert.match(extensionSource, new RegExp(defaultName));
  }
});

test("create resource global home uses configured global home", () => {
  assert.match(extensionSource, /getConfiguredGlobalHomeDirectory\(config\)/);
  assert.match(extensionSource, /DEFAULT_GLOBAL_HOME_DIRECTORY/);
  assert.doesNotMatch(extensionSource, /getCopilotHomePath/);
});

test("create resource user agents default to VS Code prompts folder", () => {
  assert.match(
    extensionSource,
    /getConfiguredUserAgentsDirectory\(config\) \|\|/,
  );
  assert.match(extensionSource, /getConfiguredUserPromptsDirectory\(config\)/);
  assert.match(
    extensionSource,
    /path\.join\(userDataRoot\.fsPath, "prompts"\)/,
  );
});

test("create resource user instructions default to VS Code instructions folder", () => {
  assert.match(
    extensionSource,
    /getConfiguredUserInstructionsDirectory\(config\)/,
  );
  assert.match(
    extensionSource,
    /path\.join\(userDataRoot\.fsPath, "instructions"\)/,
  );
});

test("create resource user prompts default to VS Code prompts folder", () => {
  assert.match(
    extensionSource,
    /getConfiguredUserPromptsDirectory\(config\)[\s\S]*path\.join\(userDataRoot\.fsPath, "prompts"\)/,
  );
});

test("create resource user skill hook and mcp route through global home root", () => {
  assert.match(
    extensionSource,
    /kind === "skill" \|\| kind === "hook" \|\| kind === "mcp"/,
  );
  assert.match(extensionSource, /globalHomeRoot/);
  assert.match(
    extensionSource,
    /kind === "skill" \? "skills" : kind === "hook" \? "hooks" : "mcp"/,
  );
});

test("create resource target preview uses same root helper for actual creation", () => {
  assert.match(extensionSource, /function getCreateResourceUri/);
  assert.match(extensionSource, /const root = getResourceRootUri/);
  assert.match(
    extensionSource,
    /getCreateResourceUri\([\s\S]*targetPick\.scope/,
  );
});

test("create resource custom folder still bypasses configured roots", () => {
  assert.match(extensionSource, /scope === "custom" && customRoot/);
  assert.match(extensionSource, /return customRoot/);
  assert.match(extensionSource, /showOpenDialog/);
});

test("create resource path UX no longer hardcodes copilot home", () => {
  assert.doesNotMatch(
    extensionSource,
    /vscode\.Uri\.file\(getCopilotHomePath\(\)\)/,
  );
  assert.match(extensionSource, /resolveConfiguredUri/);
});

test("user-facing terminology prefers global resource home", () => {
  assert.strictEqual(nls["view.userResources"], "User / Global Resource Home");
  assert.strictEqual(
    nlsJa["view.userResources"],
    "ユーザー / グローバル リソース",
  );
  assert.strictEqual(
    nls["config.defaultInstallTarget.globalHome"],
    "Global Resource Home - install into the selected shared resource root",
  );
  assert.strictEqual(
    nlsJa["config.defaultInstallTarget.globalHome"],
    "Global Resource Home - 選択中の共有リソースルートにインストール",
  );
  assert.match(
    extensionSource,
    /label: isJa \? "グローバル リソース" : "Global Resource Home"/,
  );
  assert.match(userResourcesProviderSource, /Global Resource Home/);
  assert.match(readme, /Global Resource Home/);
  assert.match(readmeJa, /グローバル リソース|Global Resource Home/);
});

test("user global resource empty state gives next action", () => {
  assert.match(
    userResourcesProviderSource,
    /No resources found in User \/ Global Resource Home/,
  );
  assert.match(userResourcesProviderSource, /Install from Remote Resources/);
  assert.match(userResourcesProviderSource, /check Settings/);
  assert.match(userResourcesProviderSource, /Global Resource Home location/);
});

test("workspace empty state search hint uses localized runtime copy", () => {
  assert.match(treeProviderSource, /messages\.noResourcesFound\(\)/);
  assert.match(
    treeProviderSource,
    /messages\.installResourcesHint\(messages\.searchCommandTitle\(\)\)/,
  );
  assert.doesNotMatch(
    treeProviderSource,
    /Use 'Search Resources' to install resources/,
  );
});

test("global resource home tree description is not repetitive", () => {
  assert.match(userResourcesProviderSource, /function formatScopeDescription/);
  assert.match(userResourcesProviderSource, /formatRootPathForDisplay/);
  assert.match(userResourcesProviderSource, /resource\.scope === "globalHome"/);
  assert.match(
    fs.readFileSync(
      path.join(repoRoot, "src", "userResourceScanner.ts"),
      "utf8",
    ),
    /GitHub Copilot CLI/,
  );
});

console.log("RESULT=PASS");
