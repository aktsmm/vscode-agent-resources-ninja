import * as os from "os";
import * as path from "path";

export interface UserDataPathOptions {
  platform?: NodeJS.Platform;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
  appName?: string;
}

function getOptions(
  options: UserDataPathOptions = {},
): Required<UserDataPathOptions> {
  return {
    platform: options.platform || process.platform,
    homeDir: options.homeDir || os.homedir(),
    env: options.env || process.env,
    appName: options.appName || "Visual Studio Code",
  };
}

export function getVsCodeUserDataFolderName(
  appName: string = "Visual Studio Code",
): string {
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

export function getVsCodeUserDataPath(
  options: UserDataPathOptions = {},
): string {
  const { platform, homeDir, env, appName } = getOptions(options);
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

export function getVsCodeUserPromptsPath(
  options: UserDataPathOptions = {},
): string {
  return path.join(getVsCodeUserDataPath(options), "prompts");
}

export function getCopilotHomePath(
  options: Pick<UserDataPathOptions, "homeDir"> = {},
): string {
  return path.join(options.homeDir || os.homedir(), ".copilot");
}
