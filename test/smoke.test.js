const assert = require("assert");
const vscode = require("vscode");

const file = (root, ...segments) => vscode.Uri.joinPath(root, ...segments);
const write = (uri, value) =>
  vscode.workspace.fs.writeFile(uri, Buffer.from(value));
const read = async (uri) =>
  Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
async function createRemote(root) {
  await vscode.workspace.fs.createDirectory(file(root, "remote"));
  await write(
    file(root, "remote", "SKILL.md"),
    "---\nname: remote\ndescription: smoke fixture\n---\nLocal test fixture.",
  );
  await write(
    file(root, "remote", ".skill-meta.json"),
    JSON.stringify({
      name: "remote",
      source: "fixture",
      remotePath: "skills/remote",
    }),
  );
}

suite("Agent Resources Ninja smoke test", () => {
  test("activates and registers core commands", async () => {
    const extension = vscode.extensions.getExtension(
      "yamapan.agent-resources-ninja",
    );

    assert.ok(extension, "Extension should be discoverable by id");
    const folder = vscode.workspace.workspaceFolders[0];
    const expectedLocale = process.env.RESOURCE_NINJA_TEST_LOCALE || "en";
    assert.strictEqual(
      vscode.workspace
        .getConfiguration("resourceNinja", folder.uri)
        .get("language"),
      expectedLocale,
      "Product locale must match the requested host verification locale",
    );
    for (const document of vscode.workspace.textDocuments) {
      if (
        document.isDirty &&
        document.uri.fsPath.startsWith(folder.uri.fsPath)
      ) {
        await document.save();
      }
    }
    const root = file(folder.uri, "smoke-skills");
    await createRemote(root);
    try {
      await vscode.workspace.fs.delete(file(root, ".gitignore"));
    } catch (error) {
      if (error.code !== "FileNotFound") {
        throw error;
      }
    }
    await extension.activate();
    await assert.rejects(vscode.workspace.fs.stat(file(root, ".gitignore")));

    const commands = await vscode.commands.getCommands(true);
    for (const command of [
      "resourceNinja.search",
      "resourceNinja.install",
      "resourceNinja.refresh",
      "resourceNinja.openSettings",
      "resourceNinja.clearGitHubToken",
      "resourceNinja.showGitHubAuthStatus",
    ]) {
      assert.ok(commands.includes(command), `Missing command: ${command}`);
    }
  });

  test("gitignore real configuration, dirty protection, recovery and old-root cleanup", async () => {
    const folder = vscode.workspace.workspaceFolders[0];
    const root = file(folder.uri, "smoke-skills");
    const next = file(folder.uri, "smoke-next");
    const config = vscode.workspace.getConfiguration(
      "resourceNinja",
      folder.uri,
    );
    const update = (key, value) =>
      config.update(
        key,
        value,
        key === "resourcesDirectory"
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.WorkspaceFolder,
      );
    try {
      await write(file(root, ".gitignore"), "# user rule\nkeep-me\n");
      await update("autoManageGitignore", true);
      await vscode.commands.executeCommand("resourceNinja.refresh");
      const original = await read(file(root, ".gitignore"));
      assert(original.includes("# Agent Resources Ninja START"));
      assert(original.includes("/remote/"));
      const document = await vscode.workspace.openTextDocument(
        file(root, ".gitignore"),
      );
      const edit = new vscode.WorkspaceEdit();
      edit.insert(document.uri, new vscode.Position(0, 0), "# unsaved\n");
      assert(await vscode.workspace.applyEdit(edit));
      assert(document.isDirty);
      await update("autoManageGitignore", false);
      await vscode.commands.executeCommand("resourceNinja.refresh");
      assert.strictEqual(await read(file(root, ".gitignore")), original);
      assert(await document.save());
      await vscode.commands.executeCommand("resourceNinja.refreshLocal");
      const off = await read(file(root, ".gitignore"));
      assert(off.includes("# unsaved"));
      assert(!off.includes("# Agent Resources Ninja START"));
      await update("autoManageGitignore", true);
      await vscode.commands.executeCommand("resourceNinja.refresh");
      await createRemote(next);
      await update("resourcesDirectory", "smoke-next");
      await vscode.commands.executeCommand("resourceNinja.refresh");
      assert(
        !(await read(file(root, ".gitignore"))).includes(
          "# Agent Resources Ninja START",
        ),
      );
      assert(
        (await read(file(next, ".gitignore"))).includes(
          "# Agent Resources Ninja START",
        ),
      );
    } finally {
      for (const document of vscode.workspace.textDocuments) {
        if (
          document.isDirty &&
          document.uri.fsPath === file(root, ".gitignore").fsPath
        ) {
          await document.save();
        }
      }
      await update("autoManageGitignore", false);
      await update("resourcesDirectory", "smoke-skills");
      await vscode.commands.executeCommand("resourceNinja.refresh");
    }
  });

  test("SKILL.md edits regenerate the block in additional roots and honor manual-only skills", async function () {
    this.timeout(90000);
    const folder = vscode.workspace.workspaceFolders[0];
    const extra = file(folder.uri, "smoke-extra");
    const skillMd = file(extra, "extra-skill", "SKILL.md");
    const agents = file(folder.uri, "AGENTS.md");
    const config = vscode.workspace.getConfiguration(
      "resourceNinja",
      folder.uri,
    );
    const update = (key, value) =>
      config.update(key, value, vscode.ConfigurationTarget.Workspace);
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const readAgents = async () => {
      try {
        return await read(agents);
      } catch {
        return "";
      }
    };
    const skillText = (flag) =>
      `---\nname: extra-skill\ndescription: smoke fixture\n${flag}---\n\nFixture.\n`;
    const waitFor = async (predicate, message) => {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        if (await predicate()) {
          return;
        }
        await sleep(250);
      }
      assert.fail(message);
    };
    let hadAgents = true;
    try {
      await vscode.workspace.fs.stat(agents);
    } catch {
      hadAgents = false;
    }

    try {
      await update("useRefOutput", false);
      await update("outputFormat", "compact");
      await update("autoUpdateInstruction", true);
      await vscode.workspace.fs.createDirectory(file(extra, "extra-skill"));
      await update("additionalSkillRoots", ["smoke-extra"]);
      // The settings listener rebuilds the SKILL.md watchers for the new root.
      await sleep(1500);

      await write(skillMd, skillText(""));
      await waitFor(
        async () => (await readAgents()).includes("extra-skill"),
        "a new SKILL.md in an additional root must appear in the block",
      );

      await write(skillMd, skillText("disable-model-invocation: true\n"));
      await waitFor(
        async () => !(await readAgents()).includes("extra-skill"),
        "a manual-only skill must leave the block without a metadata change",
      );

      await write(skillMd, skillText(""));
      await waitFor(
        async () => (await readAgents()).includes("extra-skill"),
        "removing the flag must list the skill again",
      );

      await update("instructionBlock.includeExplicitOnlySkills", true);
      await write(skillMd, skillText("disable-model-invocation: true\n"));
      await waitFor(
        async () => (await readAgents()).includes("extra-skill"),
        "the opt-in setting must keep a manual-only skill in the block",
      );
    } finally {
      await update("instructionBlock.includeExplicitOnlySkills", undefined);
      await update("additionalSkillRoots", undefined);
      await update("autoUpdateInstruction", false);
      await update("outputFormat", undefined);
      await update("useRefOutput", undefined);
      await vscode.workspace.fs.delete(extra, { recursive: true });
      if (!hadAgents) {
        try {
          await vscode.workspace.fs.delete(agents);
        } catch (error) {
          if (error.code !== "FileNotFound") {
            throw error;
          }
        }
      }
    }
  });

  test("both Ninja extensions preserve their blocks in the same destination", async function () {
    if (!process.env.RESOURCE_NINJA_SIBLING_ROOT) {
      this.skip();
      return;
    }
    const sibling = vscode.extensions.getExtension("yamapan.agent-skill-ninja");
    assert(sibling, "Requested sibling must be loaded");
    await sibling.activate();
    const folder = vscode.workspace.workspaceFolders[0];
    const root = file(folder.uri, "smoke-skills");
    const resourceConfig = vscode.workspace.getConfiguration(
      "resourceNinja",
      folder.uri,
    );
    const skillConfig = vscode.workspace.getConfiguration(
      "skillNinja",
      folder.uri,
    );
    try {
      await resourceConfig.update(
        "autoManageGitignore",
        true,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      await skillConfig.update(
        "autoManageGitignore",
        true,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      await Promise.all([
        vscode.commands.executeCommand("resourceNinja.refresh"),
        vscode.commands.executeCommand("skillNinja.refresh"),
      ]);
      const both = await read(file(root, ".gitignore"));
      assert(both.includes("# Agent Resources Ninja START"));
      assert(both.includes("# Agent Skills Ninja START"));
      assert(both.includes("keep-me"));
      await resourceConfig.update(
        "autoManageGitignore",
        false,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      await vscode.commands.executeCommand("resourceNinja.refresh");
      const onlySkills = await read(file(root, ".gitignore"));
      assert(!onlySkills.includes("# Agent Resources Ninja START"));
      assert(onlySkills.includes("# Agent Skills Ninja START"));
    } finally {
      await resourceConfig.update(
        "autoManageGitignore",
        false,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      await skillConfig.update(
        "autoManageGitignore",
        false,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      await vscode.commands.executeCommand("resourceNinja.refresh");
      await vscode.commands.executeCommand("skillNinja.refresh");
    }
  });

  // 単体テストは「ピッカーが開いたまま状態を保つ」ことを確かめられない。実際の QuickPick をキー操作で動かす。
  // コマンドは確定後の設定を返すので、ホスト側から結果を観測できる。
  test("filter and sort pickers apply several choices from one open picker", async function () {
    const extension = vscode.extensions.getExtension(
      "yamapan.agent-resources-ninja",
    );
    await extension.activate();
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const pickerKeys = {
      next: "workbench.action.quickOpenSelectNext",
      previous: "workbench.action.quickOpenSelectPrevious",
      accept: "workbench.action.acceptSelectedQuickOpenItem",
    };
    const drive = async (commandId, keys) => {
      const pending = vscode.commands.executeCommand(commandId);
      await pause(800);
      for (const key of keys) {
        await vscode.commands.executeCommand(pickerKeys[key]);
        await pause(250);
      }
      await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
      return pending;
    };
    const repeat = (key, count) => Array(count).fill(key);

    for (const [commandId, sortSteps, expectedSort] of [
      // 項目順: 絞り込み(all/auto/explicitOnly/modelOnly) → 並べ替え。
      // ローカル（Installed / User-Global）は default/name/invocation、Browse は default/name/stars
      ["resourceNinja.filterSkillsByInvocation", 4, "invocation"],
      ["resourceNinja.filterBrowseSkills", 3, "name"],
    ]) {
      try {
        const changed = await drive(commandId, [
          ...repeat("next", 2),
          "accept",
          ...repeat("next", sortSteps),
          "accept",
        ]);
        assert.deepStrictEqual(
          { ...changed },
          { filter: "explicitOnly", sort: expectedSort },
          `${commandId} must apply a filter and a sort from one open picker`,
        );
        const unchanged = await drive(commandId, []);
        assert.deepStrictEqual(
          { ...unchanged },
          { ...changed },
          `${commandId} must keep the applied options`,
        );
      } finally {
        const reset = await drive(commandId, [
          ...repeat("previous", 2),
          "accept",
          ...repeat("next", 4),
          "accept",
        ]);
        assert.deepStrictEqual(
          { ...reset },
          { filter: "all", sort: "default" },
          `${commandId} must return to the default view`,
        );
      }
    }
  });
});
