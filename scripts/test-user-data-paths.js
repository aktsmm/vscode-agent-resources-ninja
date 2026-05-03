#!/usr/bin/env node

const assert = require("assert");
const path = require("path");

function getVsCodeUserDataFolderName(appName = "Visual Studio Code") {
  const normalizedName = appName.toLowerCase();

  if (normalizedName.includes("insiders") && normalizedName.includes("code")) {
    return "Code - Insiders";
  }

  if (normalizedName.includes("codium")) {
    return "VSCodium";
  }

  if (normalizedName.includes("cursor")) {
    return "Cursor";
  }

  return "Code";
}

function getVsCodeUserDataPath({
  platform,
  homeDir,
  env = {},
  appName = "Visual Studio Code",
}) {
  const folderName = getVsCodeUserDataFolderName(appName);

  switch (platform) {
    case "win32": {
      const appData = env.APPDATA || path.join(homeDir, "AppData", "Roaming");
      return path.join(appData, folderName, "User");
    }
    case "darwin":
      return path.join(
        homeDir,
        "Library",
        "Application Support",
        folderName,
        "User",
      );
    case "linux": {
      const configHome = env.XDG_CONFIG_HOME || path.join(homeDir, ".config");
      return path.join(configHome, folderName, "User");
    }
    default:
      return path.join(homeDir, ".config", folderName, "User");
  }
}

function getVsCodeUserPromptsPath(options) {
  return path.join(getVsCodeUserDataPath(options), "prompts");
}

function getCopilotHomePath({ homeDir }) {
  return path.join(homeDir, ".copilot");
}

function normalize(value) {
  return value.replace(/\\/g, "/");
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("resolves macOS stable user prompts path", () => {
  assert.strictEqual(
    normalize(
      getVsCodeUserPromptsPath({
        platform: "darwin",
        homeDir: "/Users/alice",
        env: { APPDATA: "C:/Users/alice/AppData/Roaming" },
      }),
    ),
    "/Users/alice/Library/Application Support/Code/User/prompts",
  );
});

test("resolves macOS insiders user prompts path", () => {
  assert.strictEqual(
    normalize(
      getVsCodeUserPromptsPath({
        platform: "darwin",
        homeDir: "/Users/alice",
        appName: "Visual Studio Code - Insiders",
      }),
    ),
    "/Users/alice/Library/Application Support/Code - Insiders/User/prompts",
  );
});

test("resolves VSCodium user prompts path", () => {
  assert.strictEqual(
    normalize(
      getVsCodeUserPromptsPath({
        platform: "darwin",
        homeDir: "/Users/alice",
        appName: "VSCodium",
      }),
    ),
    "/Users/alice/Library/Application Support/VSCodium/User/prompts",
  );
});

test("resolves Windows APPDATA path", () => {
  assert.strictEqual(
    normalize(
      getVsCodeUserPromptsPath({
        platform: "win32",
        homeDir: "C:/Users/alice",
        env: { APPDATA: "C:/Users/alice/AppData/Roaming" },
      }),
    ),
    "C:/Users/alice/AppData/Roaming/Code/User/prompts",
  );
});

test("falls back to Windows roaming path without APPDATA", () => {
  assert.strictEqual(
    normalize(
      getVsCodeUserPromptsPath({
        platform: "win32",
        homeDir: "C:/Users/alice",
        env: {},
      }),
    ),
    "C:/Users/alice/AppData/Roaming/Code/User/prompts",
  );
});

test("resolves Linux XDG_CONFIG_HOME path", () => {
  assert.strictEqual(
    normalize(
      getVsCodeUserPromptsPath({
        platform: "linux",
        homeDir: "/home/alice",
        env: { XDG_CONFIG_HOME: "/tmp/config" },
      }),
    ),
    "/tmp/config/Code/User/prompts",
  );
});

test("resolves Linux default config path", () => {
  assert.strictEqual(
    normalize(
      getVsCodeUserPromptsPath({
        platform: "linux",
        homeDir: "/home/alice",
        env: {},
      }),
    ),
    "/home/alice/.config/Code/User/prompts",
  );
});

test("resolves Copilot home consistently", () => {
  assert.strictEqual(
    normalize(getCopilotHomePath({ homeDir: "/Users/alice" })),
    "/Users/alice/.copilot",
  );
});

console.log("User data path tests passed");
