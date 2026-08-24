export type IndexRefreshRecoveryDecision = "skipped" | "refresh" | "declined";

export interface IndexRefreshRecoveryOptions {
  /** Set by callers that await this decision inside a batch or an automatic flow. */
  suppressRecoveryPrompt: boolean;
  message: string;
  refreshLabel: string;
  declineLabel: string;
  showPrompt: (
    message: string,
    ...items: string[]
  ) => PromiseLike<string | undefined>;
}

/**
 * A non-modal notification only settles once it is answered, so awaiting one on
 * behalf of a batch or background caller can hold that caller forever.
 */
export async function decideIndexRefreshRecovery(
  options: IndexRefreshRecoveryOptions,
): Promise<IndexRefreshRecoveryDecision> {
  if (options.suppressRecoveryPrompt) {
    return "skipped";
  }
  const choice = await options.showPrompt(
    options.message,
    options.refreshLabel,
    options.declineLabel,
  );
  return choice === options.refreshLabel ? "refresh" : "declined";
}
