import * as vscode from "vscode";
import { messages } from "./i18n";
import {
  createGitHubResponseError,
  GitHubFailureKind,
  GitHubResponseError,
} from "./githubResponse";

export type GitHubTokenSource = "secret" | "config" | "env" | "gh-cli" | "none";

/** `resolveGitHubToken` が走査する実ソース数（none を除く） */
const GITHUB_TOKEN_SOURCE_COUNT = 4;

export interface ResolveGitHubTokenOptions {
  excludeSources?: readonly GitHubTokenSource[];
}

/** SecretStorage に保存する GitHub トークンのキー */
const GITHUB_TOKEN_SECRET_KEY = "resourceNinja.githubToken";
export const GITHUB_AUTH_TIMEOUT_MS = 5000;

/** activate 時に注入される SecretStorage 参照 */
let secretStorage: vscode.SecretStorage | undefined;
let pendingSecretStorageMutation: Promise<void> = Promise.resolve();

/** SecretStorage を初期化する（activate から呼ぶ） */
export function initializeGitHubAuth(context: vscode.ExtensionContext): void {
  secretStorage = context.secrets;
  pendingSecretStorageMutation = Promise.resolve();
}

function runSecretStorageMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const result = pendingSecretStorageMutation.then(mutation, mutation);
  pendingSecretStorageMutation = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function getConfiguredGitHubToken(): string | undefined {
  const config = vscode.workspace.getConfiguration("resourceNinja");
  const token = config.get<string>("githubToken")?.trim();
  return token && token.length > 0 ? token : undefined;
}

function hasConfiguredGitHubToken(): boolean {
  const inspected = vscode.workspace
    .getConfiguration("resourceNinja")
    .inspect<string>("githubToken");
  return Boolean(
    inspected &&
    [
      inspected.globalValue,
      inspected.workspaceValue,
      inspected.workspaceFolderValue,
    ].some((value) => typeof value === "string" && value.trim().length > 0),
  );
}

export async function deleteConfiguredGitHubTokens(): Promise<boolean> {
  const config = vscode.workspace.getConfiguration("resourceNinja");
  const inspected = config.inspect<string>("githubToken");
  if (!inspected) {
    return false;
  }

  const configuredTargets: Array<
    [string | undefined, vscode.ConfigurationTarget]
  > = [
    [inspected.globalValue, vscode.ConfigurationTarget.Global],
    [inspected.workspaceValue, vscode.ConfigurationTarget.Workspace],
    [
      inspected.workspaceFolderValue,
      vscode.ConfigurationTarget.WorkspaceFolder,
    ],
  ];
  let deleted = false;
  for (const [value, target] of configuredTargets) {
    if (value === undefined) {
      continue;
    }
    await config.update("githubToken", undefined, target);
    deleted = true;
  }
  return deleted;
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
  return runSecretStorageMutation(async () => {
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
  });
}

/**
 * 設定の githubToken が変更されたときに SecretStorage を同期する。
 * 値があれば保存し、空になっていれば削除する（セッション中の編集を反映）。
 */
export async function syncConfiguredGitHubToken(): Promise<void> {
  return runSecretStorageMutation(async () => {
    if (!secretStorage) {
      return;
    }
    const configToken = getConfiguredGitHubToken();
    if (configToken) {
      await secretStorage.store(GITHUB_TOKEN_SECRET_KEY, configToken);
    } else {
      await secretStorage.delete(GITHUB_TOKEN_SECRET_KEY);
    }
  });
}

/** SecretStorage に保存されたトークンを削除する（reset all 用） */
export async function deleteStoredGitHubToken(): Promise<boolean> {
  return runSecretStorageMutation(async () => {
    if (!secretStorage) {
      return false;
    }
    const storedToken = await secretStorage.get(GITHUB_TOKEN_SECRET_KEY);
    if (storedToken === undefined) {
      return false;
    }
    await secretStorage.delete(GITHUB_TOKEN_SECRET_KEY);
    return true;
  });
}

export async function clearStoredGitHubTokenWithFeedback(): Promise<void> {
  try {
    const configuredDeleted = await deleteConfiguredGitHubTokens();
    const storedDeleted = await deleteStoredGitHubToken();
    await vscode.window.showInformationMessage(
      configuredDeleted || storedDeleted
        ? messages.githubTokenCleared()
        : messages.githubTokenNotStored(),
    );
  } catch {
    await vscode.window.showErrorMessage(messages.githubTokenClearFailed());
  }
}

export async function hasStoredGitHubToken(): Promise<boolean> {
  return Boolean(await getSecretToken());
}

export async function hasClearableGitHubToken(): Promise<boolean> {
  return Boolean((await getSecretToken()) || hasConfiguredGitHubToken());
}

const GH_CLI_SHADOWING_TOKEN_ENV_KEYS = new Set(["GH_TOKEN", "GITHUB_TOKEN"]);

/** gh の保存済み github.com 資格情報を参照するための子プロセス環境を作る。 */
export function createGhCliChildEnv(
  sourceEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(sourceEnv).filter(
      ([key]) => !GH_CLI_SHADOWING_TOKEN_ENV_KEYS.has(key.toUpperCase()),
    ),
  );
}

/** gh CLI からトークンを取得 */
export async function getGhCliToken(): Promise<string | null> {
  try {
    const { exec } = await import("child_process");
    const token = await new Promise<string>((resolve, reject) => {
      exec(
        "gh auth token --hostname github.com",
        {
          timeout: GITHUB_AUTH_TIMEOUT_MS,
          windowsHide: true,
          env: createGhCliChildEnv(process.env),
        },
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

export async function isGhCliAvailable(): Promise<boolean> {
  try {
    const { exec } = await import("child_process");
    await new Promise<void>((resolve, reject) => {
      exec(
        "gh --version",
        {
          timeout: GITHUB_AUTH_TIMEOUT_MS,
          windowsHide: true,
          env: createGhCliChildEnv(process.env),
        },
        (error: Error | null) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        },
      );
    });
    return true;
  } catch {
    return false;
  }
}

export function getGitHubAuthRecoveryPolicy(input: {
  source: GitHubTokenSource;
  hasClearableToken: boolean;
  ghCliAvailable: boolean;
  failureKind?: GitHubFailureKind;
}): {
  showSettings: boolean;
  showGhLogin: boolean;
  showGhInstall: boolean;
  showClearToken: boolean;
  showGitHubTokenPage: boolean;
} {
  const canUseGhCli = input.source !== "env";
  return {
    showSettings: input.source !== "env",
    showGhLogin: canUseGhCli && input.ghCliAvailable,
    showGhInstall: canUseGhCli && !input.ghCliAvailable,
    showClearToken:
      input.hasClearableToken &&
      (input.source === "secret" || input.source === "config"),
    showGitHubTokenPage:
      input.failureKind === "sso-required" ||
      input.failureKind === "classic-pat-forbidden",
  };
}

function getEnvToken(): string | undefined {
  const token = (process.env.GH_TOKEN || process.env.GITHUB_TOKEN)?.trim();
  return token && token.length > 0 ? token : undefined;
}

/**
 * SecretStorage / 環境変数 / gh CLI / 旧設定 の順でトークンを解決する。
 * 旧設定（githubToken）は後方互換のための最終フォールバック。
 */
export async function resolveGitHubToken(
  options: ResolveGitHubTokenOptions = {},
): Promise<{
  token: string | undefined;
  source: GitHubTokenSource;
}> {
  const excludedSources = new Set(options.excludeSources);
  const secretToken = await getSecretToken();
  if (secretToken && !excludedSources.has("secret")) {
    return { token: secretToken, source: "secret" };
  }

  const envToken = getEnvToken();
  if (envToken && !excludedSources.has("env")) {
    return { token: envToken, source: "env" };
  }

  if (!excludedSources.has("gh-cli")) {
    const ghCliToken = await getGhCliToken();
    if (ghCliToken) {
      return { token: ghCliToken, source: "gh-cli" };
    }
  }

  const configToken = getConfiguredGitHubToken();
  if (configToken && !excludedSources.has("config")) {
    return { token: configToken, source: "config" };
  }

  return { token: undefined, source: "none" };
}

/**
 * 失敗したトークンの出所に関係なく、未試行のトークンを全ソースから探す。
 * `alreadyTried` を渡すと、同じ値へ往復するのを防げる。
 */
export async function resolveGitHubTokenAfterFailure(
  failedToken: string,
  alreadyTried?: Iterable<string>,
): Promise<{ token: string; source: GitHubTokenSource } | undefined> {
  const triedTokens = new Set<string>(alreadyTried ?? []);
  triedTokens.add(failedToken);

  const excludeSources: GitHubTokenSource[] = [];
  // ソース数は有限なので、除外を積み上げれば必ず "none" で停止する。
  while (excludeSources.length < GITHUB_TOKEN_SOURCE_COUNT) {
    const candidate = await resolveGitHubToken({ excludeSources });
    if (!candidate.token || candidate.source === "none") {
      return undefined;
    }
    if (!triedTokens.has(candidate.token)) {
      return { token: candidate.token, source: candidate.source };
    }
    excludeSources.push(candidate.source);
  }

  return undefined;
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
  error?: GitHubResponseError;
}> {
  const { token, source } = await resolveGitHubToken();

  if (token) {
    try {
      const response = await validateGitHubToken(token);
      if (response.ok) {
        return {
          authenticated: true,
          method: source,
          message: "GitHub token authenticated",
        };
      }

      if (response.status !== 401) {
        const error = await createGitHubAuthValidationError(response);
        return {
          authenticated: false,
          method: source,
          message: error.message,
          error,
        };
      }

      const fallback = await resolveGitHubTokenAfterFailure(token);
      if (fallback) {
        const fallbackResponse = await validateGitHubToken(fallback.token);
        if (fallbackResponse.ok) {
          return {
            authenticated: true,
            method: fallback.source,
            message: "GitHub token authenticated",
          };
        }
        if (fallbackResponse.status !== 401) {
          const error = await createGitHubAuthValidationError(fallbackResponse);
          return {
            authenticated: false,
            method: fallback.source,
            message: error.message,
            error,
          };
        }
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

async function validateGitHubToken(token: string): Promise<Response> {
  return fetch("https://api.github.com/user", {
    headers: { Authorization: `token ${token}` },
    signal: AbortSignal.timeout(GITHUB_AUTH_TIMEOUT_MS),
  });
}

async function createGitHubAuthValidationError(
  response: Response,
): Promise<GitHubResponseError> {
  const bodyText = await response
    .clone()
    .text()
    .catch(() => "");
  return createGitHubResponseError(
    response,
    bodyText,
    "GitHub authentication check failed",
  );
}
