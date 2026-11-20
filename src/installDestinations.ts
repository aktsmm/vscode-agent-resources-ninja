// Shared vocabulary for install destinations, used by the install picker and the
// side views so one folder carries one name, one path and one explanation.
// Kept free of `vscode` imports so plain-Node regression scripts can load the real code.

import { isContainedPath } from "./pathSafety";

export type InstallDestinationState =
  | "installable"
  | "installable-empty"
  | "browse-only"
  | "read-only";

/** The side view names the VS Code user-data folder this way; the install picker uses the same words. */
export const USER_PROFILE_DESTINATION_LABEL = "VS Code User Customizations";

/** Kinds that the old VS Code User Profile (`userData`) used to hold on its own. */
const USER_PROFILE_NATIVE_KINDS: ReadonlySet<string> = new Set([
  "agent",
  "instruction",
  "prompt",
]);

export interface InstallDestinationStateInput {
  readOnly?: boolean;
  /** The folder lives inside the VS Code user-data folder. */
  legacyUserProfile?: boolean;
  /** `resourceNinja.legacyUserProfileInstallTarget` */
  legacyInstallTargetEnabled?: boolean;
  /** `undefined` when the folder could not be inspected. */
  hasExistingEntries?: boolean;
}

/**
 * Whether `locationFsPath` sits inside the VS Code user-data folder. A folder the
 * user pointed `resourceNinja.userInstructionsDirectory` and friends at somewhere
 * else is an explicit choice, not the old profile.
 */
export function isLegacyUserProfileLocation(
  locationFsPath: string,
  userDataRootFsPath: string,
): boolean {
  if (!locationFsPath || !userDataRootFsPath) {
    return false;
  }
  return isContainedPath(userDataRootFsPath, locationFsPath);
}

export function isUserProfileNativeKind(kind: string): boolean {
  return USER_PROFILE_NATIVE_KINDS.has(kind);
}

export function classifyInstallDestination(
  input: InstallDestinationStateInput,
): InstallDestinationState {
  if (input.readOnly) {
    return "read-only";
  }
  if (input.legacyUserProfile && input.legacyInstallTargetEnabled !== true) {
    return "browse-only";
  }
  if (input.hasExistingEntries === false) {
    return "installable-empty";
  }
  return "installable";
}

export function allowsNewInstall(state: InstallDestinationState): boolean {
  return state === "installable" || state === "installable-empty";
}

export function getInstallDestinationStateLabel(
  state: InstallDestinationState,
  isJa: boolean,
): string {
  switch (state) {
    case "installable-empty":
      return isJa ? "空 · 初回インストールで作成" : "Empty · created on first install";
    case "browse-only":
      return isJa
        ? "閲覧のみ · 新規インストール対象外"
        : "Browse only · not offered for new installs";
    case "read-only":
      return isJa ? "読み取り専用" : "Read-only";
    case "installable":
    default:
      return isJa ? "インストール先" : "Install target";
  }
}

export function getInstallDestinationStateReason(
  state: InstallDestinationState,
  isJa: boolean,
): string | undefined {
  switch (state) {
    case "installable-empty":
      return isJa
        ? "まだファイルがありません。インストールすると作成されます。"
        : "No files yet. The first install creates it.";
    case "browse-only":
      return isJa
        ? "旧 VS Code ユーザープロファイルです。既存ファイルは閲覧できますが、新規インストール先にはしません。設定 resourceNinja.legacyUserProfileInstallTarget で候補に戻せます。"
        : "Legacy VS Code User Profile. Existing files stay visible, but it is not offered for new installs. Enable resourceNinja.legacyUserProfileInstallTarget to offer it again.";
    case "read-only":
      return isJa
        ? "この拡張機能は書き込みません。"
        : "This extension never writes here.";
    case "installable":
    default:
      return undefined;
  }
}

/** One line for a Quick Pick: the state first, then the real path. */
export function formatInstallDestinationDetail(
  state: InstallDestinationState,
  fsPath: string,
  isJa: boolean,
): string {
  return `${getInstallDestinationStateLabel(state, isJa)} · ${fsPath}`;
}

export type DefaultUserDataTargetDecision =
  | "use-user-profile"
  | "use-global-home-alias"
  | "reselect";

/**
 * A default of `userData` must never be redirected somewhere else without telling
 * the user: when the legacy profile is switched off, the default asks for a new
 * choice instead of writing to a different folder.
 */
export function decideDefaultUserDataTarget(input: {
  aliasesGlobalHome: boolean;
  legacyUserProfile: boolean;
  legacyInstallTargetEnabled: boolean;
}): DefaultUserDataTargetDecision {
  if (input.aliasesGlobalHome) {
    return "use-global-home-alias";
  }
  if (input.legacyUserProfile && !input.legacyInstallTargetEnabled) {
    return "reselect";
  }
  return "use-user-profile";
}

/**
 * A reinstall removes the scanned copy first, so it may only write back inside the
 * root that copy came from. Anything else would delete in one place and create in
 * another.
 */
export function isReinstallDestinationInOriginalRoot(
  originalRootFsPath: string,
  destinationFsPath: string,
): boolean {
  return isContainedPath(originalRootFsPath, destinationFsPath);
}
