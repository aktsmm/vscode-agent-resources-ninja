export type GitHubAuthRecoveryOutcome =
  | {
      recovered: true;
      method: "gh-cli-account-switch";
      account: string;
    }
  | {
      recovered: false;
      reason:
        | "dismissed"
        | "manual-action-started"
        | "source-not-gh-cli"
        | "status-unavailable"
        | "no-eligible-account"
        | "candidate-validation-failed"
        | "switch-failed"
        | "post-switch-validation-failed";
    };

export interface GhCliAccountRecoveryRuntime {
  getCandidateToken(account: string): Promise<string | null>;
  validateToken(token: string): Promise<boolean>;
  confirmSwitch(account: string): Promise<boolean>;
  switchAccount(account: string): Promise<boolean>;
  verifyActiveAccount(account: string): Promise<boolean>;
}

/**
 * The caller owns account selection and confirmation. This seam only accepts a
 * successful recovery after the selected account's token and active state have
 * both been verified.
 */
export async function recoverSelectedGhCliAccount(
  account: string,
  runtime: GhCliAccountRecoveryRuntime,
): Promise<GitHubAuthRecoveryOutcome> {
  const candidateToken = await runtime.getCandidateToken(account);
  if (!candidateToken || !(await runtime.validateToken(candidateToken))) {
    return { recovered: false, reason: "candidate-validation-failed" };
  }

  if (!(await runtime.confirmSwitch(account))) {
    return { recovered: false, reason: "dismissed" };
  }

  if (!(await runtime.switchAccount(account))) {
    return { recovered: false, reason: "switch-failed" };
  }

  if (!(await runtime.verifyActiveAccount(account))) {
    return { recovered: false, reason: "post-switch-validation-failed" };
  }

  return {
    recovered: true,
    method: "gh-cli-account-switch",
    account,
  };
}

/** Creates a retry gate scoped to one command-handler invocation. */
export function createOneShotGitHubAuthRetry(): (
  outcome: GitHubAuthRecoveryOutcome,
  retry: () => Promise<void>,
) => Promise<boolean> {
  let retried = false;

  return async (outcome, retry) => {
    if (!outcome.recovered || retried) {
      return false;
    }
    retried = true;
    await retry();
    return true;
  };
}
