// Shared stubs for tests that load a module which now imports the destination and
// harness modules. Those two are plain TypeScript, so the real code is loaded; only
// the VS Code backed file system is replaced.

const path = require("path");

module.exports = function destinationTestStubs(requireTypeScriptModule, repoRoot) {
  const source = (name) => path.join(repoRoot, "src", name);
  const pathSafety = requireTypeScriptModule(source("pathSafety.ts"), {});
  return {
    "./installDestinations": requireTypeScriptModule(
      source("installDestinations.ts"),
      { "./pathSafety": pathSafety },
    ),
    "./harnessInstructions": requireTypeScriptModule(
      source("harnessInstructions.ts"),
      {},
    ),
    "./harnessInstructionsFs": {
      createVsCodeHarnessFileSystem: () => {
        throw new Error("The VS Code file system is not available in this test");
      },
    },
  };
};
