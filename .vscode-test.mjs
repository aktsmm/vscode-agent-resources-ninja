import path from "path";
import fs from "fs";
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
const locale = process.env.RESOURCE_NINJA_TEST_LOCALE || "en";
if (locale !== "en" && locale !== "ja") {
  throw new Error("Unsupported smoke test locale; use en or ja");
}
const workspaceFolder = path.join(smokeSandboxRoot, "workspace", locale);
fs.mkdirSync(path.join(workspaceFolder, ".vscode"), { recursive: true });
fs.writeFileSync(
  path.join(workspaceFolder, ".vscode", "settings.json"),
  JSON.stringify(
    {
      "resourceNinja.resourcesDirectory": "smoke-skills",
      "resourceNinja.language": locale,
      "resourceNinja.autoUpdateInstruction": false,
      "resourceNinja.staleSourceIndexUpdateMode": "never",
      "resourceNinja.autoUpdateResourcesOnUpgrade": "never",
      "skillNinja.autoUpdateInstruction": false,
      "skillNinja.language": locale,
      "skillNinja.autoManageGitignore": false,
      "skillNinja.staleSourceIndexUpdateMode": "never",
      "skillNinja.autoUpdateSkillsOnUpgrade": "never",
    },
    null,
    2,
  ),
);
const siblingRoot = process.env.RESOURCE_NINJA_SIBLING_ROOT;
if (
  siblingRoot &&
  !fs.existsSync(path.join(siblingRoot, "dist", "extension.js"))
) {
  throw new Error("Sibling extension build is missing");
}

export default defineConfig({
  files: "test/**/*.test.js",
  workspaceFolder,
  useInstallation: {
    fromPath: vscodeExecutablePath,
  },
  launchArgs: [
    "--disable-updates",
    "--locale",
    locale,
    "--user-data-dir",
    path.join(smokeSandboxRoot, "user-data-start", locale),
    "--extensions-dir",
    path.join(smokeSandboxRoot, "extensions-test-code"),
    ...(siblingRoot ? [`--extensionDevelopmentPath=${siblingRoot}`] : []),
  ],
  mocha: {
    timeout: 20000,
  },
});
