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
});
