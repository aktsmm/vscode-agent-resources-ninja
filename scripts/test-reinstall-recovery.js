#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

const repoRoot = path.resolve(__dirname, "..");
const extensionPath = path.join(repoRoot, "src", "extension.ts");

function requireTypeScriptModule(filePath) {
  const transpiled = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filePath,
  });
  const loadedModule = new Module(filePath, module);
  loadedModule.filename = filePath;
  loadedModule.paths = Module._nodeModulePaths(path.dirname(filePath));
  loadedModule._compile(transpiled.outputText, filePath);
  return loadedModule.exports;
}

const { decideIndexRefreshRecovery } = requireTypeScriptModule(
  path.join(repoRoot, "src", "reinstallRecovery.ts"),
);

const failures = [];

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(
      () => console.log(`PASS ${name}`),
      (error) => {
        failures.push(name);
        console.error(`FAIL ${name}: ${error && error.message}`);
      },
    );
}

function createPromptRecorder(answer) {
  const calls = [];
  return {
    calls,
    showPrompt: (message, ...items) => {
      calls.push({ message, items });
      return Promise.resolve(answer);
    },
  };
}

function isVsCodeWindowShowCall(node) {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) {
    return false;
  }
  if (!callee.name.text.startsWith("show")) {
    return false;
  }
  const target = callee.expression;
  return (
    ts.isPropertyAccessExpression(target) &&
    ts.isIdentifier(target.expression) &&
    target.expression.text === "vscode" &&
    target.name.text === "window"
  );
}

function isModalCall(node) {
  return node.arguments.some(
    (argument) =>
      ts.isObjectLiteralExpression(argument) &&
      argument.properties.some(
        (property) =>
          ts.isPropertyAssignment(property) &&
          property.name.getText() === "modal" &&
          property.initializer.kind === ts.SyntaxKind.TrueKeyword,
      ),
  );
}

/**
 * Awaiting a non-modal notification inside a command that another command
 * awaits holds that caller until somebody answers the notification.
 */
function inspectReinstallCommands(sourceText, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.ES2020,
    true,
  );
  const blocking = [];
  const modal = [];
  const awaitedCommands = new Set();

  const collectCallers = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sourceFile).includes("executeCommand")
    ) {
      const [nameArgument] = node.arguments;
      if (nameArgument && ts.isStringLiteral(nameArgument)) {
        awaitedCommands.add(nameArgument.text);
      }
    }
    node.forEachChild(collectCallers);
  };
  collectCallers(sourceFile);

  const visitHandler = (commandName, node) => {
    if (ts.isAwaitExpression(node) && isVsCodeWindowShowCall(node.expression)) {
      const call = node.expression;
      const label = `${commandName}:${call.expression.name.text}`;
      if (isModalCall(call)) {
        modal.push(label);
      } else {
        blocking.push(label);
      }
    }
    node.forEachChild((child) => visitHandler(commandName, child));
  };

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sourceFile).endsWith("registerCommand")
    ) {
      const [nameArgument, handler] = node.arguments;
      if (
        nameArgument &&
        ts.isStringLiteral(nameArgument) &&
        nameArgument.text.startsWith("resourceNinja.reinstall") &&
        awaitedCommands.has(nameArgument.text) &&
        handler
      ) {
        visitHandler(nameArgument.text, handler);
      }
    }
    node.forEachChild(visit);
  };

  visit(sourceFile);
  return { blocking, modal, checked: awaitedCommands };
}

/**
 * The prompt itself now lives behind a helper, so the remaining way to
 * reintroduce the stall is a caller that forgets to suppress it.
 */
function inspectReinstallCallers(sourceText, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.ES2020,
    true,
  );
  const awaitedInProgress = [];
  const automatic = [];
  const violations = [];

  const readOptions = (callNode) =>
    callNode.arguments
      .filter((argument) => ts.isObjectLiteralExpression(argument))
      .flatMap((argument) =>
        argument.properties
          .filter((property) => ts.isPropertyAssignment(property))
          .map(
            (property) =>
              `${property.name.getText()}=${property.initializer.getText()}`,
          ),
      );

  const visit = (node, insideProgress) => {
    let childInsideProgress = insideProgress;
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sourceFile).endsWith("withProgress")
    ) {
      childInsideProgress = true;
    }

    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sourceFile).endsWith("executeCommand")
    ) {
      const [nameArgument] = node.arguments;
      if (
        nameArgument &&
        ts.isStringLiteral(nameArgument) &&
        nameArgument.text.startsWith("resourceNinja.reinstall")
      ) {
        const options = readOptions(node);
        const suppressed = options.includes("suppressRecoveryPrompt=true");
        const caller = { command: nameArgument.text, options };

        if (insideProgress) {
          awaitedInProgress.push(caller);
          if (!suppressed) {
            violations.push(
              `${nameArgument.text} inside withProgress without suppressRecoveryPrompt`,
            );
          }
        }
        if (options.includes("skipConfirmation=true")) {
          automatic.push(caller);
          if (!suppressed) {
            violations.push(
              `${nameArgument.text} skips confirmation without suppressRecoveryPrompt`,
            );
          }
        }
      }
    }

    node.forEachChild((child) => visit(child, childInsideProgress));
  };

  visit(sourceFile, false);
  return { awaitedInProgress, automatic, violations };
}

const extensionSource = fs.readFileSync(extensionPath, "utf8");

async function main() {
  await test("a suppressed caller never reaches the prompt", async () => {
    const recorder = createPromptRecorder("Update");
    const decision = await decideIndexRefreshRecovery({
      suppressRecoveryPrompt: true,
      message: "missing",
      refreshLabel: "Update",
      declineLabel: "Cancel",
      showPrompt: recorder.showPrompt,
    });
    assert.strictEqual(decision, "skipped");
    assert.deepStrictEqual(recorder.calls, []);
  });

  await test("an interactive caller can accept the refresh", async () => {
    const recorder = createPromptRecorder("更新する");
    const decision = await decideIndexRefreshRecovery({
      suppressRecoveryPrompt: false,
      message: "見つかりません",
      refreshLabel: "更新する",
      declineLabel: "キャンセル",
      showPrompt: recorder.showPrompt,
    });
    assert.strictEqual(decision, "refresh");
    assert.strictEqual(recorder.calls.length, 1);
    assert.deepStrictEqual(Array.from(recorder.calls[0].items), [
      "更新する",
      "キャンセル",
    ]);
  });

  await test("declining and dismissing both stop short of a refresh", async () => {
    const declined = await decideIndexRefreshRecovery({
      suppressRecoveryPrompt: false,
      message: "missing",
      refreshLabel: "Update",
      declineLabel: "Skip",
      showPrompt: createPromptRecorder("Skip").showPrompt,
    });
    assert.strictEqual(declined, "declined");

    const dismissed = await decideIndexRefreshRecovery({
      suppressRecoveryPrompt: false,
      message: "missing",
      refreshLabel: "Update",
      declineLabel: "Skip",
      showPrompt: createPromptRecorder(undefined).showPrompt,
    });
    assert.strictEqual(dismissed, "declined");
  });

  await test("no programmatically awaited reinstall command blocks on a notification", () => {
    const { blocking, modal, checked } = inspectReinstallCommands(
      extensionSource,
      extensionPath,
    );
    const reinstallCommands = Array.from(checked).filter((name) =>
      name.startsWith("resourceNinja.reinstall"),
    );
    assert.ok(
      reinstallCommands.length >= 3,
      `Expected the reinstall commands invoked by other commands: ${reinstallCommands.join(", ")}`,
    );
    assert.deepStrictEqual(
      blocking,
      [],
      `A batch caller awaits these commands, so these notifications can stall it: ${blocking.join(", ")}`,
    );
    assert.ok(
      modal.length >= 1,
      "Expected the reinstall confirmations to still be awaited modal dialogs",
    );
  });

  await test("the blocking-notification check is not vacuous", () => {
    const anchor = "await decideIndexRefreshRecovery(";
    assert.ok(
      extensionSource.includes(anchor),
      "The mutation anchor is gone; this proof no longer tests the real file",
    );
    const mutated = extensionSource.replace(
      anchor,
      "await vscode.window.showWarningMessage(",
    );
    const { blocking } = inspectReinstallCommands(mutated, extensionPath);
    assert.strictEqual(blocking.length, 1);
    assert.match(
      blocking[0],
      /^resourceNinja\.reinstall\w*:showWarningMessage$/,
    );
  });

  await test("every awaited or automatic reinstall caller suppresses the prompt", () => {
    const { awaitedInProgress, automatic, violations } =
      inspectReinstallCallers(extensionSource, extensionPath);
    assert.ok(
      awaitedInProgress.length >= 2,
      `Expected the group reinstall loops to be found: ${JSON.stringify(awaitedInProgress)}`,
    );
    assert.ok(
      automatic.length >= 1,
      `Expected the post-upgrade reinstall caller to be found: ${JSON.stringify(automatic)}`,
    );
    assert.deepStrictEqual(
      violations,
      [],
      `These callers can be held by an unanswered notification: ${violations.join(", ")}`,
    );
  });

  await test("the caller check catches both ways the stall returns", () => {
    const anchor = /(\r?\n\s*)suppressRecoveryPrompt: true,/g;
    assert.ok(
      anchor.test(extensionSource),
      "No caller passes suppressRecoveryPrompt; this proof no longer tests the real file",
    );
    const mutated = extensionSource.replace(anchor, "$1");
    const { awaitedInProgress, automatic } = inspectReinstallCallers(
      extensionSource,
      extensionPath,
    );
    const { violations } = inspectReinstallCallers(mutated, extensionPath);
    // Every caller the unmutated file protects must show up once per rule it
    // satisfies, so the count follows the real callers instead of a fixed list.
    assert.strictEqual(
      violations.length,
      awaitedInProgress.length + automatic.length,
    );
    assert.ok(violations.length >= 3, violations.join(", "));
  });

  if (failures.length > 0) {
    console.log("RESULT=FAIL");
    process.exitCode = 1;
    return;
  }
  console.log("RESULT=PASS");
}

void main();
