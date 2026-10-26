const assert = require("assert");
const vscode = require("vscode");

const file = (root, ...segments) => vscode.Uri.joinPath(root, ...segments);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// 高負荷の CI や共有マシンでは、非同期に反映される結果の到着が遅れる。
// 「いずれ成立する」ことを確かめるアサーションは、固定の待ちではなく期限付きで再評価する。
const eventually = async (check, timeoutMs = 30000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  for (;;) {
    try {
      return await check();
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) {
      throw lastError;
    }
    await sleep(250);
  }
};
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

  test("gitignore real configuration, dirty protection, recovery and old-root cleanup", async function () {
    this.timeout(120000);
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
      const original = await eventually(async () => {
        const text = await read(file(root, ".gitignore"));
        assert(text.includes("# Agent Resources Ninja START"));
        assert(text.includes("/remote/"));
        return text;
      });
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
      await eventually(async () => {
        const off = await read(file(root, ".gitignore"));
        assert(off.includes("# unsaved"));
        assert(!off.includes("# Agent Resources Ninja START"));
      });
      await update("autoManageGitignore", true);
      await vscode.commands.executeCommand("resourceNinja.refresh");
      await createRemote(next);
      await update("resourcesDirectory", "smoke-next");
      await vscode.commands.executeCommand("resourceNinja.refresh");
      await eventually(async () => {
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
      });
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

  // 設定の値が単体テストで正しくても、設定から実体のフォルダまで通ったことの証拠にはならない。
  // プリセットを切り替えると、管理するフォルダが実際に切り替わることを実機で確かめる。
  test("the workspace skill folder preset switches the managed folder", async function () {
    this.timeout(90000);
    const folder = vscode.workspace.workspaceFolders[0];
    const preset = file(folder.uri, ".claude", "skills");
    const config = vscode.workspace.getConfiguration(
      "resourceNinja",
      folder.uri,
    );
    try {
      await createRemote(preset);
      await config.update(
        "resourcesDirectoryPreset",
        "claude",
        vscode.ConfigurationTarget.Workspace,
      );
      await config.update(
        "autoManageGitignore",
        true,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      await vscode.commands.executeCommand("resourceNinja.refresh");
      await eventually(async () => {
        const text = await read(file(preset, ".gitignore"));
        assert(
          text.includes("# Agent Resources Ninja START"),
          "the preset folder must be the one being managed",
        );
        assert(text.includes("/remote/"));
      });
    } finally {
      await config.update(
        "resourcesDirectoryPreset",
        undefined,
        vscode.ConfigurationTarget.Workspace,
      );
      await config.update(
        "autoManageGitignore",
        false,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      await vscode.commands.executeCommand("resourceNinja.refresh");
      try {
        await vscode.workspace.fs.delete(file(folder.uri, ".claude"), {
          recursive: true,
          useTrash: false,
        });
      } catch (error) {
        if (error.code !== "FileNotFound") {
          throw error;
        }
      }
    }
  });

  test("SKILL.md edits regenerate the block in additional roots and honor manual-only skills", async function () {
    this.timeout(180000);
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
    const readAgents = async () => {
      try {
        return await read(agents);
      } catch {
        return "";
      }
    };
    const skillText = (flag) =>
      `---\nname: extra-skill\ndescription: smoke fixture\n${flag}---\n\nFixture.\n`;
    // watcher の登録が遅れて最初の書き込みを取りこぼしても進めるよう、待つ間は同じ内容を書き直して再通知する。
    const waitFor = async (predicate, message, retouch) => {
      const deadline = Date.now() + 45000;
      let lastTouch = Date.now();
      while (Date.now() < deadline) {
        if (await predicate()) {
          return;
        }
        if (retouch && Date.now() - lastTouch >= 3000) {
          await retouch();
          lastTouch = Date.now();
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
        () => write(skillMd, skillText("")),
      );

      await write(skillMd, skillText("disable-model-invocation: true\n"));
      await waitFor(
        async () => !(await readAgents()).includes("extra-skill"),
        "a manual-only skill must leave the block without a metadata change",
        () => write(skillMd, skillText("disable-model-invocation: true\n")),
      );

      await write(skillMd, skillText(""));
      await waitFor(
        async () => (await readAgents()).includes("extra-skill"),
        "removing the flag must list the skill again",
        () => write(skillMd, skillText("")),
      );

      await update("instructionBlock.includeExplicitOnlySkills", true);
      await write(skillMd, skillText("disable-model-invocation: true\n"));
      await waitFor(
        async () => (await readAgents()).includes("extra-skill"),
        "the opt-in setting must keep a manual-only skill in the block",
        () => write(skillMd, skillText("disable-model-invocation: true\n")),
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
    this.timeout(180000);
    const extension = vscode.extensions.getExtension(
      "yamapan.agent-resources-ninja",
    );
    await extension.activate();
    const pause = sleep;
    const pickerKeys = {
      next: "workbench.action.quickOpenSelectNext",
      previous: "workbench.action.quickOpenSelectPrevious",
      accept: "workbench.action.acceptSelectedQuickOpenItem",
    };
    // 高負荷ではピッカーの表示が遅れてキー入力を取りこぼすため、開く待ちとキー間隔に余裕を持たせる。
    const drive = async (commandId, keys) => {
      const pending = vscode.commands.executeCommand(commandId);
      await pause(2000);
      for (const key of keys) {
        await vscode.commands.executeCommand(pickerKeys[key]);
        await pause(400);
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

  // 一括インストールの 3 つの入口は、静的チェックだけでは「実際に動く」ことの証拠にならない。
  // 何も選んでいないとき・ピッカーを何も選ばずに閉じたときに、例外にせず、何もインストールしないことを確かめる。
  test("bulk install entry points open, close, and install nothing without a selection", async function () {
    this.timeout(60000);
    const extension = vscode.extensions.getExtension(
      "yamapan.agent-resources-ninja",
    );
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      "resourceNinja.installMultiple",
      "resourceNinja.installSelectedResources",
      "resourceNinja.installSourceResources",
    ]) {
      assert.ok(commands.includes(id), `Missing command: ${id}`);
    }

    const folder = vscode.workspace.workspaceFolders[0];
    const root = file(folder.uri, "smoke-skills");
    const listRoot = async () =>
      (await vscode.workspace.fs.readDirectory(root))
        .map(([name]) => name)
        .sort();
    const before = await listRoot();
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    // 選択も対象の行もない呼び出しは、案内を出して何もしない
    await vscode.commands.executeCommand(
      "resourceNinja.installSelectedResources",
    );
    await vscode.commands.executeCommand(
      "resourceNinja.installSourceResources",
    );

    // 実際のピッカーを開き、何も選ばずに閉じる。約 3,000 件の候補でも開閉でき、何もインストールされない
    const pending = vscode.commands.executeCommand(
      "resourceNinja.installMultiple",
    );
    await pause(1500);
    await vscode.commands.executeCommand("workbench.action.closeQuickOpen");
    await pending;

    assert.deepStrictEqual(
      await listRoot(),
      before,
      "closing the picker without a choice must not install anything",
    );
  });

  // ツール入力の解決は stub では確かめられても、実ホストの登録・schema・実 index では未確認だった。
  // 変更を起こさない入力（不明な kind、部分一致、存在しない名前、同名の曖昧さ）だけを実際に呼び、何も変わらないことを確かめる。
  test("registered language model tools refuse ambiguous, partial and unknown targets without changing anything", async function () {
    this.timeout(60000);
    const extension = vscode.extensions.getExtension(
      "yamapan.agent-resources-ninja",
    );
    await extension.activate();
    const folder = vscode.workspace.workspaceFolders[0];
    const root = file(folder.uri, "smoke-skills");
    const listRoot = async () =>
      (await vscode.workspace.fs.readDirectory(root))
        .map(([name]) => name)
        .sort();
    const before = await listRoot();

    const names = vscode.lm.tools.map((tool) => tool.name);
    for (const name of [
      "resourceNinja_search",
      "resourceNinja_install",
      "resourceNinja_uninstall",
      "resourceNinja_localize",
    ]) {
      assert.ok(names.includes(name), `Missing tool: ${name}`);
    }
    const schemaOf = (name) =>
      vscode.lm.tools.find((tool) => tool.name === name).inputSchema
        .properties;
    for (const key of ["source", "path", "overwrite"]) {
      assert.ok(schemaOf("resourceNinja_install")[key], `install.${key}`);
    }
    assert.ok(schemaOf("resourceNinja_uninstall").path, "uninstall.path");

    const invoke = async (name, input) => {
      const result = await vscode.lm.invokeTool(
        name,
        { input, toolInvocationToken: undefined },
        new vscode.CancellationTokenSource().token,
      );
      return result.content
        .map((part) => part.value || "")
        .join("\n");
    };

    // search は実 index を返し、Source / Path の列を持つ
    const search = await invoke("resourceNinja_search", { query: "skill" });
    assert.match(search, /\| Kind \| Resource \| Source \| Path \|/);

    assert.match(
      await invoke("resourceNinja_install", {
        resourceName: "skill",
        kind: "skills",
      }),
      /Unknown kind|不明な kind/,
    );
    assert.match(
      await invoke("resourceNinja_localize", {
        resourceName: "skill",
        kind: "skills",
        description_ja: "x",
      }),
      /Unknown kind|不明な kind/,
    );
    // 部分一致だけの名前は対象にならない（インストールされない）
    assert.match(
      await invoke("resourceNinja_install", { resourceName: "skil" }),
      /not found|見つかりません/i,
    );
    assert.match(
      await invoke("resourceNinja_uninstall", {
        resourceName: "no-such-resource-for-smoke",
      }),
      /not installed|インストールされていません/,
    );

    assert.deepStrictEqual(
      await listRoot(),
      before,
      "refused tool calls must not change the workspace",
    );
  });

  // 他ホームの読み取り専用グループや古いグループは、プラグイン削除コマンドに「実行時に」拒否される必要がある。
  // 拒否されずに通常経路へ進むと、同じプラグイン ID を持つ書き込み可能なリソースの削除確認（モーダル）に到達して止まる。
  test("deleting a plugin group refuses read-only and stale user groups", async function () {
    this.timeout(360000);
    const extension = vscode.extensions.getExtension(
      "yamapan.agent-resources-ninja",
    );
    await extension.activate();
    const folder = vscode.workspace.workspaceFolders[0];
    const home = file(folder.uri, "smoke-home");
    const planted = file(home, "plugins", "smokeplug", "skills", "plugged");
    const config = vscode.workspace.getConfiguration(
      "resourceNinja",
      folder.uri,
    );
    await vscode.workspace.fs.createDirectory(planted);
    await write(
      file(planted, "SKILL.md"),
      "---\nname: plugged\ndescription: smoke fixture\n---\nPlugin-origin fixture.",
    );
    try {
      await config.update(
        "globalHomeDirectory",
        "smoke-home",
        vscode.ConfigurationTarget.Workspace,
      );
      await vscode.commands.executeCommand("resourceNinja.refresh");
      const otherHome = file(folder.uri, "smoke-other-home").fsPath;
      for (const group of [
        { readOnlyGroup: true },
        { readOnlyGroup: false },
        {},
      ]) {
        const settled = await Promise.race([
          Promise.resolve(
            vscode.commands.executeCommand(
              "resourceNinja.deletePluginResources",
              {
                nodeType: "plugin",
                scope: "globalHome",
                pluginId: "smokeplug",
                rootFsPath: otherHome,
                ...group,
              },
            ),
          ).then(() => "settled"),
          // 初回の呼び出しは、現在の一覧を得るための全スキャンを待つ。高負荷では長引くので、モーダルで止まった場合だけを検出できる上限にする。
          new Promise((resolve) => setTimeout(() => resolve("blocked"), 90000)),
        ]);
        assert.strictEqual(
          settled,
          "settled",
          "a read-only or stale user group must be refused before any delete confirmation",
        );
        assert.ok(
          await vscode.workspace.fs.stat(file(planted, "SKILL.md")),
          "no resource may be deleted by a refused group",
        );
      }
    } finally {
      await config.update(
        "globalHomeDirectory",
        undefined,
        vscode.ConfigurationTarget.Workspace,
      );
      await vscode.workspace.fs.delete(home, {
        recursive: true,
        useTrash: false,
      });
      await vscode.commands.executeCommand("resourceNinja.refresh");
    }
  });

  // 状態を実際に変える呼び出しも実ホストで確かめる。同名の 2 つの skill に対し、名前だけでは何も削除されず、
  // path を指定したときだけ指定した 1 件が削除される（対象外は残る）。install は GitHub への取得が要るため対象外。
  test("registered uninstall tool removes only the skill selected by path when two share a name", async function () {
    this.timeout(60000);
    const extension = vscode.extensions.getExtension(
      "yamapan.agent-resources-ninja",
    );
    await extension.activate();
    const folder = vscode.workspace.workspaceFolders[0];
    const root = file(folder.uri, "smoke-skills");
    const exists = async (uri) => {
      try {
        await vscode.workspace.fs.stat(uri);
        return true;
      } catch {
        return false;
      }
    };
    const gitignoreExisted = await exists(file(root, ".gitignore"));
    const dirs = ["dup-a", "dup-b"];
    for (const dir of dirs) {
      await vscode.workspace.fs.createDirectory(file(root, dir));
      await write(
        file(root, dir, "SKILL.md"),
        "---\nname: smoke-dup\ndescription: same name in two folders\n---\nFixture.",
      );
    }
    const invoke = async (input) =>
      (
        await vscode.lm.invokeTool(
          "resourceNinja_uninstall",
          { input, toolInvocationToken: undefined },
          new vscode.CancellationTokenSource().token,
        )
      ).content
        .map((part) => part.value || "")
        .join("\n");
    try {
      const ambiguous = await invoke({ resourceName: "smoke-dup" });
      assert.match(
        ambiguous,
        /Multiple workspace resources match|に複数候補があります/,
      );
      for (const dir of dirs) {
        assert.ok(
          await exists(file(root, dir, "SKILL.md")),
          `${dir} must survive an ambiguous name`,
        );
      }

      const removed = await invoke({
        resourceName: "smoke-dup",
        path: "smoke-skills/dup-b",
      });
      assert.match(
        removed,
        /Uninstalled \*\*smoke-dup\*\*|\*\*smoke-dup\*\* をアンインストールし/,
      );
      assert.ok(
        await exists(file(root, "dup-a", "SKILL.md")),
        "the skill that was not selected must remain",
      );
      assert.ok(
        !(await exists(file(root, "dup-b", "SKILL.md"))),
        "the selected skill must be removed",
      );
    } finally {
      for (const dir of dirs) {
        await vscode.workspace.fs.delete(file(root, dir), {
          recursive: true,
          useTrash: false,
        });
      }
      if (!gitignoreExisted) {
        try {
          await vscode.workspace.fs.delete(file(root, ".gitignore"));
        } catch {
          // 作られていなければ何もしない
        }
      }
      await vscode.commands.executeCommand("resourceNinja.refresh");
    }
  });
});