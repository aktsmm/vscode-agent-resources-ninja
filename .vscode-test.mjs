import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "test/**/*.test.js",
  workspaceFolder: ".",
  mocha: {
    timeout: 20000,
  },
});
