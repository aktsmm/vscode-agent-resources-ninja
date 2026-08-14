import { PluginHostId, PluginHostState, PluginHostSupportLevel } from "./types";

export type DefaultPluginHost =
  | "auto"
  | "ask"
  | Exclude<PluginHostId, "portable-resources">;

export interface PluginHostChoiceCandidate {
  hostId: PluginHostId;
  supportLevel: PluginHostSupportLevel;
  compatible: boolean;
  detected: boolean;
  available: boolean;
  highRisk?: boolean;
  reason?: string;
  state?: PluginHostState;
}

export interface PluginHostChoice extends PluginHostChoiceCandidate {
  recommended: boolean;
  configuredByUser: boolean;
  suggestedByWorkspace: boolean;
}

function isSafeNativeChoice(candidate: PluginHostChoiceCandidate): boolean {
  return (
    candidate.supportLevel === "native" &&
    candidate.compatible &&
    candidate.detected &&
    candidate.available &&
    candidate.state?.status !== "error" &&
    !candidate.highRisk
  );
}

export function resolvePluginHostChoices(input: {
  candidates: readonly PluginHostChoiceCandidate[];
  userDefault: DefaultPluginHost;
  workspaceSuggestion?: DefaultPluginHost;
}): PluginHostChoice[] {
  const explicitUserHost =
    input.userDefault === "auto" || input.userDefault === "ask"
      ? undefined
      : input.userDefault;
  const workspaceHost =
    input.workspaceSuggestion === "auto" || input.workspaceSuggestion === "ask"
      ? undefined
      : input.workspaceSuggestion;
  const autoRecommendation =
    input.userDefault === "auto"
      ? input.candidates.find(isSafeNativeChoice)?.hostId
      : undefined;

  return input.candidates
    .map((candidate, index) => {
      const configuredByUser = candidate.hostId === explicitUserHost;
      const recommended =
        input.userDefault !== "ask" &&
        isSafeNativeChoice(candidate) &&
        (configuredByUser || candidate.hostId === autoRecommendation);
      const group = recommended
        ? -1
        : candidate.state?.status === "installed"
          ? 0
          : configuredByUser && candidate.compatible
            ? 1
            : candidate.compatible &&
                candidate.detected &&
                candidate.supportLevel === "native"
              ? 2
              : candidate.compatible && candidate.detected
                ? 3
                : candidate.compatible && candidate.supportLevel === "native"
                  ? 4
                  : candidate.compatible
                    ? 5
                    : 6;
      return {
        choice: {
          ...candidate,
          configuredByUser,
          recommended,
          suggestedByWorkspace: candidate.hostId === workspaceHost,
        },
        group,
        index,
      };
    })
    .sort((left, right) => left.group - right.group || left.index - right.index)
    .map(({ choice }) => choice);
}

export function formatPluginHostState(
  state: PluginHostState | undefined,
  isJapanese: boolean,
): string {
  if (!state || state.status === "unknown") {
    return isJapanese ? "状態不明" : "State unavailable";
  }
  if (state.status === "error") {
    return isJapanese ? "状態取得失敗" : "State error";
  }
  if (state.status === "not-installed") {
    return isJapanese ? "未インストール" : "Not installed";
  }
  const installed = state.version
    ? isJapanese
      ? `インストール済み ${state.version}`
      : `Installed ${state.version}`
    : isJapanese
      ? "インストール済み"
      : "Installed";
  if (state.enabled === true) {
    return `${installed} · ${isJapanese ? "有効" : "Enabled"}`;
  }
  if (state.enabled === false) {
    return `${installed} · ${isJapanese ? "無効" : "Disabled"}`;
  }
  return installed;
}
