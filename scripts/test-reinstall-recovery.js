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

const {
  decideIndexRefreshRecovery,
  ReinstallAttemptError,
  retryReinstallBatch,
  runReinstallBatch,
  runReinstallTask,
} = requireTypeScriptModule(path.join(repoRoot, "src", "reinstallRecovery.ts"));

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

    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(sourceFile);
      const [nameArgument] = node.arguments;
      const commandName = expression.endsWith("executeCommand")
        ? nameArgument && ts.isStringLiteral(nameArgument)
          ? nameArgument.text
          : undefined
        : expression === "reinstallUserResource"
          ? "resourceNinja.reinstallUserResource"
          : expression === "reinstallResource"
            ? "resourceNinja.reinstall"
            : undefined;
      if (commandName?.startsWith("resourceNinja.reinstall")) {
        const options = readOptions(node);
        const suppressed = options.includes("suppressRecoveryPrompt=true");
        const caller = { command: commandName, options };

        if (insideProgress) {
          awaitedInProgress.push(caller);
          if (!suppressed) {
            violations.push(
              `${commandName} inside withProgress without suppressRecoveryPrompt`,
            );
          }
        }
        if (options.includes("skipConfirmation=true")) {
          automatic.push(caller);
          if (!suppressed) {
            violations.push(
              `${commandName} skips confirmation without suppressRecoveryPrompt`,
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
  await test("transient reinstall retries once without removing twice", async () => {
    let removeCount = 0;
    let installCount = 0;
    const result = await runReinstallTask({
      name: "demo",
      remove: async () => {
        removeCount++;
      },
      install: async () => {
        installCount++;
        if (installCount === 1) {
          throw new ReinstallAttemptError("transport", "offline");
        }
        return "installed";
      },
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.attempts, 2);
    assert.strictEqual(removeCount, 1);
    assert.strictEqual(installCount, 2);
  });

  await test("non-retryable reinstall failure stops after one attempt", async () => {
    let removeCount = 0;
    let installCount = 0;
    const result = await runReinstallTask({
      name: "private",
      remove: async () => {
        removeCount++;
      },
      install: async () => {
        installCount++;
        throw new ReinstallAttemptError("auth-required", "login required");
      },
    });
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.failureKind, "auth-required");
    assert.strictEqual(result.attempts, 1);
    assert.strictEqual(removeCount, 1);
    assert.strictEqual(installCount, 1);
  });

  await test("manual retry adds one install attempt and never removes again", async () => {
    let removeCount = 0;
    let installCount = 0;
    const task = {
      name: "unstable",
      remove: async () => {
        removeCount++;
      },
      install: async () => {
        installCount++;
        throw new ReinstallAttemptError("server-error", "upstream failed");
      },
    };
    const initial = await runReinstallBatch([task]);
    const retried = await retryReinstallBatch(initial);
    assert.strictEqual(retried[0].result.success, false);
    assert.strictEqual(retried[0].result.attempts, 3);
    assert.strictEqual(removeCount, 1);
    assert.strictEqual(installCount, 3);
  });

  await test("manual retry preserves failures outside the retry subset", async () => {
    const authTask = {
      name: "private",
      remove: async () => undefined,
      install: async () => {
        throw new ReinstallAttemptError("auth-required", "login required");
      },
    };
    const transientTask = {
      name: "server",
      remove: async () => undefined,
      install: async () => {
        throw new ReinstallAttemptError("server-error", "upstream failed");
      },
    };
    const initial = await runReinstallBatch([authTask, transientTask]);
    const retried = await retryReinstallBatch(initial);
    assert.strictEqual(retried.length, 2);
    assert.strictEqual(retried[0].result.failureKind, "auth-required");
    assert.strictEqual(retried[0].result.attempts, 1);
    assert.strictEqual(retried[1].result.failureKind, "server-error");
    assert.strictEqual(retried[1].result.attempts, 3);
  });

  await test("batch cancellation records every unstarted item with zero attempts", async () => {
    let started = 0;
    const tasks = ["one", "two", "three"].map((name) => ({
      name,
      remove: async () => undefined,
      install: async () => name,
    }));
    const records = await runReinstallBatch(tasks, {
      isCancellationRequested: () => started >= 1,
      onProgress: () => {
        started++;
      },
    });
    assert.strictEqual(records.length, 3);
    assert.strictEqual(records[0].result.success, true);
    for (const record of records.slice(1)) {
      assert.strictEqual(record.result.stage, "not-started");
      assert.strictEqual(record.result.failureKind, "cancelled");
      assert.strictEqual(record.result.attempts, 0);
    }
  });

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

  await test("reinstall groups use direct typed handlers without boolean command calls", () => {
    const { blocking, modal, checked } = inspectReinstallCommands(
      extensionSource,
      extensionPath,
    );
    const reinstallCommands = Array.from(checked).filter((name) =>
      name.startsWith("resourceNinja.reinstall"),
    );
    assert.ok(
      reinstallCommands.length >= 1,
      `Expected the automatic reinstall command caller: ${reinstallCommands.join(", ")}`,
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
    assert.doesNotMatch(
      extensionSource,
      /executeCommand<boolean>\(\s*"resourceNinja\.reinstall(?:UserResource)?"/,
      "group reinstall must call the typed handlers directly",
    );
    assert.match(
      extensionSource,
      /const record = await reinstallUserResource\(/,
    );
    assert.match(extensionSource, /const record = await reinstallResource\(/);
  });

  await test("manual retry is gated before showing a notification", () => {
    assert.match(
      extensionSource,
      /if \(\s*suppressPrompt \|\|[\s\S]*?!isReinstallRetryable\(record\.result\.failureKind\)[\s\S]*?\) \{\s*return record;/,
    );
    assert.match(
      extensionSource,
      /Retry once without removing the existing files again/,
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
