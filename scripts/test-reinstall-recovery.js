#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");
const vm = require("vm");

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
  createUnstartedReinstallRecord,
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

function isVsCodeWindowNotificationCall(node) {
  if (!ts.isCallExpression(node)) {
    return false;
  }
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) {
    return false;
  }
  if (
    ![
      "showErrorMessage",
      "showInformationMessage",
      "showWarningMessage",
    ].includes(callee.name.text)
  ) {
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
  const registeredCommands = new Set();

  const visitHandler = (commandName, node) => {
    if (ts.isAwaitExpression(node) && isVsCodeWindowNotificationCall(node.expression)) {
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
        handler
      ) {
        registeredCommands.add(nameArgument.text);
        visitHandler(nameArgument.text, handler);
      }
    }
    node.forEachChild(visit);
  };

  visit(sourceFile);
  return { blocking, modal, checked: registeredCommands };
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
  {
    const record = createUnstartedReinstallRecord(
      "Reference note",
      "other",
      "reference",
    );
    assert.strictEqual(record.result.failureKind, "other");
    assert.strictEqual(record.result.stage, "not-started");
    assert.strictEqual(record.task.resourceKind, "reference");
  }

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

  await test("a surfaced rate limit stops the batch even with an older SSO cause", async () => {
    const result = await runReinstallTask({
      name: "limited",
      remove: async () => undefined,
      install: async () => {
        throw Object.assign(new Error("limited"), {
          kind: "rate-limit",
          rootCauseKind: "sso-required",
        });
      },
    });
    assert.strictEqual(result.failureKind, "rate-limit");
    assert.strictEqual(result.attempts, 1);
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

  await test("a rate-limited batch does not remove or start later resources", async () => {
    const calls = [];
    const tasks = ["one", "two", "three"].map((name) => ({
      name,
      remove: async () => calls.push(`remove:${name}`),
      install: async () => {
        calls.push(`install:${name}`);
        if (name === "two") {
          throw new ReinstallAttemptError("rate-limit", "limited");
        }
        return name;
      },
    }));
    const records = await runReinstallBatch(tasks);
    assert.deepStrictEqual(calls, [
      "remove:one",
      "install:one",
      "remove:two",
      "install:two",
    ]);
    assert.strictEqual(records[1].result.failureKind, "rate-limit");
    assert.deepStrictEqual(records[2].result, {
      success: false,
      attempts: 0,
      removed: false,
      stage: "not-started",
      failureKind: "rate-limit",
    });
  });

  await test("a rate limit suppresses retries without discarding earlier records", async () => {
    let attempts = 0;
    const transient = {
      name: "transient",
      remove: async () => undefined,
      install: async () => {
        attempts++;
        throw new ReinstallAttemptError("server-error", "offline");
      },
    };
    const limited = {
      name: "limited",
      remove: async () => undefined,
      install: async () => {
        throw new ReinstallAttemptError("rate-limit", "limited");
      },
    };
    const original = await runReinstallBatch([transient, limited]);
    assert.strictEqual(attempts, 2);
    const retried = await retryReinstallBatch(original);
    assert.strictEqual(attempts, 2);
    assert.deepStrictEqual(retried, original);
  });

  await test("a rate limit during manual retry stops further retry requests", async () => {
    let firstAttempts = 0;
    let secondAttempts = 0;
    const makeTask = (name, action) => ({
      name,
      remove: async () => undefined,
      install: action,
    });
    const records = await runReinstallBatch([
      makeTask("one", async () => {
        firstAttempts++;
        throw new ReinstallAttemptError(
          firstAttempts > 2 ? "rate-limit" : "transport",
          "failed",
        );
      }),
      makeTask("two", async () => {
        secondAttempts++;
        throw new ReinstallAttemptError("transport", "failed");
      }),
    ]);
    const retried = await retryReinstallBatch(records);
    assert.strictEqual(firstAttempts, 3);
    assert.strictEqual(secondAttempts, 2);
    assert.strictEqual(retried[0].result.failureKind, "rate-limit");
    assert.strictEqual(retried[1].result.attempts, records[1].result.attempts);
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
    assert.deepStrictEqual(
      blocking,
      [],
      `A batch caller awaits these commands, so these notifications can stall it: ${blocking.join(", ")}`,
    );
    assert.ok(
      modal.length >= 1,
      "Expected the reinstall confirmations to still be awaited modal dialogs",
    );
    assert.ok(
      checked.size >= 1,
      "Expected reinstall commands to be registered for direct typed handlers",
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

  await test("batch failure reports require a click without holding the batch", async () => {
    const parsed = ts.createSourceFile(
      extensionPath,
      extensionSource,
      ts.ScriptTarget.ES2020,
      true,
    );
    let handler;
    const visit = (node) => {
      if (
        ts.isFunctionDeclaration(node) &&
        node.name?.text === "showReinstallBatchFailure"
      ) {
        handler = node;
      } else {
        node.forEachChild(visit);
      }
    };
    visit(parsed);
    assert.ok(handler, "batch failure handler not found");
    const code = ts.transpileModule(
      `${handler.getText(parsed)}\nshowReinstallBatchFailure;`,
      { compilerOptions: { target: ts.ScriptTarget.ES2020 } },
    ).outputText;
    const notifications = [];
    const reports = [];
    let choose;
    const showFailure = vm.runInNewContext(code, {
      vscode: {
        window: {
          showWarningMessage: (...args) => {
            notifications.push(args);
            return new Promise((resolve) => {
              choose = resolve;
            });
          },
        },
      },
      messages: { actionReportBug: () => "Report Bug" },
      isJapanese: () => false,
      buildReinstallBatchReport: () => ({ title: "safe", body: "safe" }),
      previewAndOpenBugReport: async (...args) => reports.push(args),
      logger: { warn: () => undefined },
    });
    const failed = [{ result: { success: false, failureKind: "not-found" } }];
    assert.strictEqual(showFailure("failed", failed), undefined);
    assert.deepStrictEqual(notifications[0], ["failed", "Report Bug"]);
    assert.deepStrictEqual(reports, []);
    choose("Report Bug");
    await new Promise(setImmediate);
    assert.deepStrictEqual(reports, [[{ title: "safe", body: "safe" }, false]]);

    showFailure("cancelled", [
      { result: { success: false, failureKind: "cancelled" } },
    ]);
    assert.deepStrictEqual(notifications[1], ["cancelled"]);
    assert.strictEqual(
      (extensionSource.match(/showReinstallBatchFailure\(/g) || []).length,
      5,
      "all four batch reinstall entry points must share the report action",
    );
  });

  await test("update-changed-only delegates to the staged update flow and never reinstalls", async () => {
    const parsed = ts.createSourceFile(
      extensionPath,
      extensionSource,
      ts.ScriptTarget.ES2020,
      true,
    );
    const declarations = new Map();
    let handler;
    const visit = (node) => {
      if (ts.isFunctionDeclaration(node) && node.name) {
        declarations.set(node.name.text, node.getText(parsed));
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(parsed).endsWith("registerCommand") &&
        node.arguments[0]?.getText(parsed) === '"resourceNinja.reinstallAll"'
      ) {
        handler = node.arguments[1];
      }
      node.forEachChild(visit);
    };
    visit(parsed);
    assert.ok(handler, "workspace reinstall handler not found");
    const code = ts.transpileModule(
      [
        declarations.get("normalizeInstalledRemotePath"),
        declarations.get("isRemoteInstalledSkillMeta"),
        declarations.get("findIndexedSkillForInstalledMeta"),
        declarations.get("createUnstartedReinstallRecord"),
        `(${handler.getText(parsed)});`,
      ].join("\n"),
      { compilerOptions: { target: ts.ScriptTarget.ES2020 } },
    ).outputText;

    const calls = [];
    let writes = 0;
    const provider = { refresh() {} };
    const meta = [{ name: "changed", source: "repo", remotePath: "skills/changed" }];
    const handlerFn = vm.runInNewContext(code, {
      AbortController,
      context: {},
      vscode: {
        workspace: {
          workspaceFolders: [{ uri: {} }],
          getConfiguration: () => ({ get: () => true }),
        },
        window: {
          showWarningMessage: async (_message, _options, _forced, changed) => {
            calls.push("confirm");
            return changed;
          },
          showInformationMessage() {},
        },
      },
      getInstalledSkillsWithMeta: async () => meta,
      runWorkspaceSkillUpdateCheck: async (interactive) => calls.push(["check", interactive]),
      updateInstructionFile: async () => { writes++; },
      uninstallSkill: async () => { writes++; },
      installSkill: async () => { writes++; },
      runReinstallTask: async () => { throw new Error("unsafe reinstall reached"); },
      loadSkillIndex: async () => { throw new Error("index must not load"); },
      installedProvider: provider,
      browseProvider: provider,
      isJapanese: () => false,
      logger: { warn() {}, error() {} },
    });
    assert.strictEqual(await handlerFn({}), false);
    assert.deepStrictEqual(calls, ["confirm", ["check", true]]);
    assert.strictEqual(writes, 0);

    calls.length = 0;
    assert.strictEqual(
      await handlerFn({ skipConfirmation: true, onlyChanged: true }),
      false,
    );
    assert.deepStrictEqual(calls, [["check", true]]);
    assert.strictEqual(writes, 0);
  });

  await test("Browse Global Home reinstall revalidates the confirmed target before removal", async () => {
    const parsed = ts.createSourceFile(extensionPath, extensionSource, ts.ScriptTarget.ES2020, true);
    const declarations = new Map();
    const visit = (node) => {
      if (ts.isFunctionDeclaration(node) && node.name) {
        declarations.set(node.name.text, node.getText(parsed));
      }
      node.forEachChild(visit);
    };
    visit(parsed);
    const code = ts.transpileModule(
      [
        declarations.get("normalizeInstalledRemotePath"),
        declarations.get("isRemoteInstalledUserResource"),
        declarations.get("reinstallBrowseGlobalHomeReference"),
        "reinstallBrowseGlobalHomeReference;",
      ].join("\n"),
      { compilerOptions: { target: ts.ScriptTarget.ES2020 } },
    ).outputText;
    const skill = { name: "notes", source: "repo", path: "references/notes.md", kind: "reference" };
    const resource = {
      name: "notes", description: "", source: "repo", remotePath: skill.path,
      kind: "reference", scope: "globalHome", rootFsPath: "C:\\home",
      fullPath: "C:\\home\\references\\notes.md",
    };
    const expected = { rootFsPath: resource.rootFsPath, fullPath: resource.fullPath };
    let resources = [resource];
    let targetPath = resource.fullPath;
    let confirm = true;
    let removes = 0;
    let stale = 0;
    const handler = vm.runInNewContext(code, {
      vscode: {
        workspace: { workspaceFolders: [{ uri: {} }], getConfiguration: () => ({}) },
        window: { showWarningMessage: async () => confirm ? "Reinstall" : undefined, showErrorMessage() {} },
        TreeItemCollapsibleState: { None: 0 },
      },
      browseProvider: { getGlobalHomeReference: () => resource },
      UserResourceTreeItem: class { constructor(_a, _b, _c, _d, value) { this.resource = value; } },
      scanUserResources: async () => resources,
      getResourceTargetUri: () => ({ fsPath: targetPath }),
      normalizeResourceRootIdentity: (value) => value.toLowerCase(),
      isJapanese: () => false,
      showStaleResourceGroupMessage: () => { stale++; },
      messages: { noWorkspace: () => "no workspace" },
      logger: { warn() {} },
      reinstallUserResource: async (_item, options) => {
        await options.beforeRemove();
        removes++;
      },
    });

    confirm = false;
    await handler(skill, expected);
    assert.strictEqual(removes, 0);
    confirm = true;
    resources = [{ ...resource, source: "other" }];
    await handler(skill, expected);
    resources = [resource, { ...resource, fullPath: "C:\\other\\notes.md" }];
    await handler(skill, expected);
    resources = [resource];
    targetPath = "C:\\other\\notes.md";
    await handler(skill, expected);
    assert.strictEqual(stale, 3);
    assert.strictEqual(removes, 0);
    targetPath = resource.fullPath;
    await handler(skill, expected);
    assert.strictEqual(removes, 1);
    await handler(skill, { ...expected, rootFsPath: "C:\\old" });
    assert.strictEqual(removes, 1);
    assert.match(extensionSource, /reinstallBrowseGlobalHomeReference\(skill,\s*referenceTarget\)/);
    assert.match(extensionSource, /reinstallBrowseGlobalHomeReference\(\s*item\.skill,\s*item\.globalHomeReferenceTarget/);
    assert.match(extensionSource, /await beforeRemove\?\.\(\);[\s\S]*?await deleteInstalledResourceByPath\(/);
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

  await test("every awaited reinstall caller suppresses the prompt", () => {
    const { awaitedInProgress, automatic, violations } =
      inspectReinstallCallers(extensionSource, extensionPath);
    assert.ok(
      awaitedInProgress.length >= 2,
      `Expected the group reinstall loops to be found: ${JSON.stringify(awaitedInProgress)}`,
    );
    assert.deepStrictEqual(
      automatic,
      [],
      "extension upgrades must not call the forced-reinstall command",
    );
    assert.deepStrictEqual(
      violations,
      [],
      `These callers can be held by an unanswered notification: ${violations.join(", ")}`,
    );
  });

  await test("the caller check catches a missing recovery-prompt suppression", () => {
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
    assert.equal(violations.length, awaitedInProgress.length, violations.join(", "));
  });

  if (failures.length > 0) {
    console.log("RESULT=FAIL");
    process.exitCode = 1;
    return;
  }
  console.log("RESULT=PASS");
}

void main();
