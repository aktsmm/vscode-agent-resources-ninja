const assert = require("assert");
const vscode = require("vscode");

suite("Agent Resources Ninja smoke test", () => {
  test("activates and registers core commands", async () => {
    const extension = vscode.extensions.getExtension(
      "yamapan.agent-resources-ninja",
    );

    assert.ok(extension, "Extension should be discoverable by id");
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    for (const command of [
      "resourceNinja.search",
      "resourceNinja.install",
      "resourceNinja.refresh",
      "resourceNinja.openSettings",
    ]) {
      assert.ok(commands.includes(command), `Missing command: ${command}`);
    }
  });
});
