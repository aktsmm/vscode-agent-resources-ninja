#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

function requireTypeScriptModule(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const transpiled = ts.transpileModule(source, {
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

const recovery = requireTypeScriptModule(
  path.join(__dirname, "..", "src", "authRecovery.ts"),
);

function createRuntime(overrides = {}) {
  return {
    getCandidateToken: async () => "candidate-token",
    validateToken: async () => true,
    confirmSwitch: async () => true,
    switchAccount: async () => true,
    verifyActiveAccount: async () => true,
    ...overrides,
  };
}

const tests = [
  {
    name: "candidate validation failure never confirms or switches accounts",
    run: async () => {
      const calls = [];
      const outcome = await recovery.recoverSelectedGhCliAccount(
        "candidate",
        createRuntime({
          validateToken: async () => {
            calls.push("validate");
            return false;
          },
          confirmSwitch: async () => {
            calls.push("confirm");
            return true;
          },
          switchAccount: async () => {
            calls.push("switch");
            return true;
          },
        }),
      );
      assert.deepStrictEqual(outcome, {
        recovered: false,
        reason: "candidate-validation-failed",
      });
      assert.deepStrictEqual(calls, ["validate"]);
    },
  },
  {
    name: "dismissed confirmation never switches accounts",
    run: async () => {
      let switched = false;
      const outcome = await recovery.recoverSelectedGhCliAccount(
        "candidate",
        createRuntime({
          confirmSwitch: async () => false,
          switchAccount: async () => {
            switched = true;
            return true;
          },
        }),
      );
      assert.deepStrictEqual(outcome, {
        recovered: false,
        reason: "dismissed",
      });
      assert.strictEqual(switched, false);
    },
  },
  {
    name: "candidate validation failure including a rate limit never switches accounts",
    run: async () => {
      let switched = false;
      const outcome = await recovery.recoverSelectedGhCliAccount(
        "rate-limited-candidate",
        createRuntime({
          validateToken: async () => false,
          switchAccount: async () => {
            switched = true;
            return true;
          },
        }),
      );
      assert.deepStrictEqual(outcome, {
        recovered: false,
        reason: "candidate-validation-failed",
      });
      assert.strictEqual(switched, false);
    },
  },
  {
    name: "switch and post-switch validation failures cannot recover",
    run: async () => {
      const switchFailure = await recovery.recoverSelectedGhCliAccount(
        "candidate",
        createRuntime({ switchAccount: async () => false }),
      );
      assert.deepStrictEqual(switchFailure, {
        recovered: false,
        reason: "switch-failed",
      });

      const verificationFailure = await recovery.recoverSelectedGhCliAccount(
        "candidate",
        createRuntime({ verifyActiveAccount: async () => false }),
      );
      assert.deepStrictEqual(verificationFailure, {
        recovered: false,
        reason: "post-switch-validation-failed",
      });
    },
  },
  {
    name: "successful recovery verifies the active account after switching",
    run: async () => {
      const calls = [];
      const outcome = await recovery.recoverSelectedGhCliAccount(
        "candidate",
        createRuntime({
          getCandidateToken: async () => {
            calls.push("token");
            return "candidate-token";
          },
          validateToken: async () => {
            calls.push("validate");
            return true;
          },
          confirmSwitch: async () => {
            calls.push("confirm");
            return true;
          },
          switchAccount: async () => {
            calls.push("switch");
            return true;
          },
          verifyActiveAccount: async () => {
            calls.push("verify");
            return true;
          },
        }),
      );
      assert.deepStrictEqual(outcome, {
        recovered: true,
        method: "gh-cli-account-switch",
        account: "candidate",
      });
      assert.deepStrictEqual(calls, [
        "token",
        "validate",
        "confirm",
        "switch",
        "verify",
      ]);
    },
  },
  {
    name: "one-shot retry permits exactly one recovered retry",
    run: async () => {
      const retry = recovery.createOneShotGitHubAuthRetry();
      let calls = 0;
      const recovered = {
        recovered: true,
        method: "gh-cli-account-switch",
        account: "candidate",
      };
      assert.strictEqual(
        await retry(recovered, async () => {
          calls += 1;
        }),
        true,
      );
      assert.strictEqual(
        await retry(recovered, async () => {
          calls += 1;
        }),
        false,
      );
      assert.strictEqual(calls, 1);
    },
  },
  {
    name: "one-shot retry rejects a non-recovered outcome",
    run: async () => {
      const retry = recovery.createOneShotGitHubAuthRetry();
      let calls = 0;
      assert.strictEqual(
        await retry(
          { recovered: false, reason: "candidate-validation-failed" },
          async () => {
            calls += 1;
          },
        ),
        false,
      );
      assert.strictEqual(calls, 0);
    },
  },
];

async function main() {
  let passed = 0;
  for (const test of tests) {
    try {
      await test.run();
      passed += 1;
      console.log(`PASS ${test.name}`);
    } catch (error) {
      console.error(`FAIL ${test.name}`);
      throw error;
    }
  }
  console.log(`${passed}/${tests.length} auth-recovery tests passed`);
  console.log("RESULT=PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
