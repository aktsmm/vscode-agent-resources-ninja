import path from "path";
import { defineConfig } from "@vscode/test-cli";

const localAppData =
  process.env.LOCALAPPDATA ||
  path.join(process.env.USERPROFILE || "", "AppData", "Local");
const vscodeExecutablePath = path.join(
  localAppData,
  "Programs",
  "Microsoft VS Code",
  "Code.exe",
);
const smokeSandboxRoot = path.resolve(".vscode-test", "manual-local-launch");

export default defineConfig({
  files: "test/**/*.test.js",
  workspaceFolder: ".",
  useInstallation: {
    fromPath: vscodeExecutablePath,
  },
  launchArgs: [
    "--disable-updates",
    "--user-data-dir",
    path.join(smokeSandboxRoot, "user-data-start"),
    "--extensions-dir",
    path.join(smokeSandboxRoot, "extensions-test-code"),
  ],
  mocha: {
    timeout: 20000,
  },
});
