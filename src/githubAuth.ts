import * as vscode from "vscode";
import { messages } from "./i18n";

export type GitHubTokenSource = "secret" | "config" | "env" | "gh-cli" | "none";

/** SecretStorage に保存する GitHub トークンのキー */
const GITHUB_TOKEN_SECRET_KEY = "resourceNinja.githubToken";

/** activate 時に注入される SecretStorage 参照 */
let secretStorage: vscode.SecretStorage | undefined;

/** SecretStorage を初期化する（activate から呼ぶ） */
export function initializeGitHubAuth(context: vscode.ExtensionContext): void {
  secretStorage = context.secrets;
}

function getConfiguredGitHubToken(): string | undefined {
  const config = vscode.workspace.getConfiguration("resourceNinja");
  const token = config.get<string>("githubToken")?.trim();
  return token && token.length > 0 ? token : undefined;
}

/** SecretStorage に保存されたトークンを取得 */
async function getSecretToken(): Promise<string | undefined> {
  if (!secretStorage) {
    return undefined;
  }
  const token = (await secretStorage.get(GITHUB_TOKEN_SECRET_KEY))?.trim();
  return token && token.length > 0 ? token : undefined;
}

/**
 * 旧来の設定（resourceNinja.githubToken）に残るトークンを SecretStorage へ移行する。
 * 移行が発生した場合のみ true を返す（冪等）。
 */
export async function migrateConfiguredGitHubTokenToSecretStorage(): Promise<boolean> {
  if (!secretStorage) {
    return false;
  }
  const configToken = getConfiguredGitHubToken();
  if (!configToken) {
    return false;
  }
  const stored = (await secretStorage.get(GITHUB_TOKEN_SECRET_KEY))?.trim();
  if (stored === configToken) {
    return false;
  }
  await secretStorage.store(GITHUB_TOKEN_SECRET_KEY, configToken);
  return true;
}

/**
 * 設定の githubToken が変更されたときに SecretStorage を同期する。
 * 値があれば保存し、空になっていれば削除する（セッション中の編集を反映）。
 */
export async function syncConfiguredGitHubToken(): Promise<void> {
  if (!secretStorage) {
    return;
  }
  const configToken = getConfiguredGitHubToken();
  if (configToken) {
    await secretStorage.store(GITHUB_TOKEN_SECRET_KEY, configToken);
  } else {
    await secretStorage.delete(GITHUB_TOKEN_SECRET_KEY);
  }
}

/** SecretStorage に保存されたトークンを削除する（reset all 用） */
export async function deleteStoredGitHubToken(): Promise<void> {
  await secretStorage?.delete(GITHUB_TOKEN_SECRET_KEY);
}

/** gh CLI からトークンを取得 */
export async function getGhCliToken(): Promise<string | null> {
  try {
    const { exec } = await import("child_process");
    const token = await new Promise<string>((resolve, reject) => {
      exec(
        "gh auth token",
        { timeout: 5000, windowsHide: true },
        (error: Error | null, stdout: string) => {
          if (error) {
            reject(error);
          } else {
            resolve(stdout.trim());
          }
        },
      );
    });
    if (token && token.length > 0) {
      return token;
    }
  } catch {
    // gh CLI が使えない場合は無視
  }
  return null;
}

function getEnvToken(): string | undefined {
  const token = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN)?.trim();
  return token && token.length > 0 ? token : undefined;
}

/**
 * SecretStorage / 環境変数 / gh CLI / 旧設定 の順でトークンを解決する。
 * 旧設定（githubToken）は後方互換のための最終フォールバック。
 */
export async function resolveGitHubToken(): Promise<{
  token: string | undefined;
  source: GitHubTokenSource;
}> {
  const secretToken = await getSecretToken();
  if (secretToken) {
    return { token: secretToken, source: "secret" };
  }

  const envToken = getEnvToken();
  if (envToken) {
    return { token: envToken, source: "env" };
  }

  const ghCliToken = await getGhCliToken();
  if (ghCliToken) {
    return { token: ghCliToken, source: "gh-cli" };
  }

  const configToken = getConfiguredGitHubToken();
  if (configToken) {
    return { token: configToken, source: "config" };
  }

  return { token: undefined, source: "none" };
}

/** トークンのみ取得したい場合のヘルパー */
export async function getGitHubToken(): Promise<string | undefined> {
  const { token } = await resolveGitHubToken();
  return token;
}

/** GitHub 認証状態を確認 */
export async function checkGitHubAuth(): Promise<{
  authenticated: boolean;
  method: GitHubTokenSource;
  message: string;
}> {
  const { token, source } = await resolveGitHubToken();

  if (token) {
    try {
      const response = await fetch("https://api.github.com/user", {
        headers: { Authorization: `token ${token}` },
      });
      if (response.ok) {
        return {
          authenticated: true,
          method: source,
          message: "GitHub token authenticated",
        };
      }
    } catch {
      // 無効トークンは下で none を返す
    }
  }

  return {
    authenticated: false,
    method: "none",
    message: messages.authRequired(),
  };
}
