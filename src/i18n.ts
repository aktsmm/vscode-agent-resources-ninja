// 多言語対応ヘルパー
// vscode.env.language を使用してローカライズ

import * as vscode from "vscode";

// 日本語メッセージ
const jaMessages = {
  noWorkspace: "ワークスペースを開いてください",
  installSuccess: "✅ {0} をインストールしました",
  installFailed: "インストール失敗: {0}",
  installing: "{0} をインストール中...",
  installTargetPlaceholder: "{0} のインストール先を選択",
  installTargetWorkspaceLabel: "ワークスペース",
  installTargetWorkspaceDescription: "このワークスペース: {0}",
  installTargetUserProfileLabel: "ユーザープロファイル",
  installTargetUserProfileDescription: "ユーザー既定領域: {0}",
  installTargetCopilotHomeLabel: "グローバル リソース",
  installTargetCopilotHomeDescription: "共有リソースルート: {0}",
  installTargetCustomLabel: "カスタム",
  installTargetCustomDescription: "保存先フォルダーを選択",
  installTargetOpenLabel: "インストール先にする",
  uninstallSuccess: "✅ {0} をアンインストールしました",
  uninstallFailed: "アンインストール失敗: {0}",
  selectSkillToUninstall: "アンインストールする skill を選択",
  searchPlaceholder: "リソース名またはキーワードを入力...",
  searchCommandTitle: "リソースを検索",
  commandPaletteSearchTitle: "Agent Resources Ninja: リソースを検索",
  installConfirm: '"{0}" をインストールしますか？',
  noInstalledSkills: "インストール済み skill はありません",
  installedSkillsPlaceholder: "インストール済み skill",
  skillNotFound: "SKILL.md が見つかりません: {0}",
  invalidSkillInfo: "リソース情報が不正です",
  updatingIndex: "リソースインデックスを更新中...",
  updatingSource: "{0} を更新中...",
  indexUpdated: "✅ インデックスを更新しました ({0} → {1} リソース, {2})",
  updateFailed: "更新失敗: {0}",
  updating: "{0} を更新中...",
  updateSourceSelectRequired:
    "Remote Resources ビューから更新するソースを選択してください。",
  sourceIdNotFound: "ソース ID が見つかりません。",
  copiedToClipboard: "コピーしました",
  copiedToClipboardWithValue: "コピーしました: {0}",
  enterRepoUrl: "GitHub リポジトリの URL を入力してください",
  repoUrlPlaceholder: "https://github.com/owner/repo",
  invalidRepoUrl: "有効な GitHub リポジトリ URL を入力してください",
  scanningRepo: "リポジトリ内のリソースをスキャン中...",
  sourceAdded: "✅ ソースを追加しました ({0} リソース発見)",
  addSourceFailed: "ソース追加失敗: {0}",
  noSkillsInRepo: "このリポジトリにはリソースが見つかりませんでした",
  selectSourceToRemove: "削除するソースを選択",
  confirmRemoveSource:
    '"{0}" を削除しますか？このソースのすべてのリソースがインデックスから削除されます。インストール済みファイルは削除されません。',
  actionRemove: "削除",
  sourceRemoved: "✅ ソースを削除しました ({0} リソース)",
  removeSourceFailed: "ソース削除失敗: {0}",
  webSearchPrompt: "GitHub でリソースを検索",
  webSearchPlaceholder: "keyword... or username keyword...",
  searchingGitHub: "GitHub を検索中...",
  noSearchResults: '"{0}" に一致するリソースが見つかりませんでした',
  searchResultsCount: "{0} 件のリソースが見つかりました",
  searchFailed: "検索失敗: {0}",
  actionInstall: "インストール",
  actionCancel: "キャンセル",
  actionAddSourceRepo: "このリポジトリをソースに追加",
  actionOpenGitHub: "GitHub で開く",
  authRequired:
    "GitHub認証が必要です。API制限を回避するために認証を設定してください。",
  openSettings: "設定を開く",
  resetSettingsTitle: "設定の初期化",
  resetSettingsPrompt: "初期化する項目を選択してください",
  resetCache: "キャッシュをクリア",
  resetAllSettings: "すべての設定をリセット",
  resetAllIncludingToken: "すべての設定をリセット（トークン含む）",
  resetConfirmSettings:
    "Resource Ninja のキャッシュと token 以外のすべての設定をリセットします。この操作は元に戻せません。続行しますか？",
  resetConfirmAll:
    "Resource Ninja のキャッシュ、すべての設定、GitHub Token をリセットします。この操作は元に戻せません。続行しますか？",
  resetConfirmAction: "リセットする",
  resetComplete: "✅ 初期化が完了しました。VS Codeを再起動してください。",
  authWithGhCli: "gh CLIで認証",
  installedFolder: "インストール済み",
  rateLimitExceeded:
    "GitHub API の制限に達しました。GitHub トークンで認証してください。",
  repoNotFound: "リポジトリが見つかりません: {0}",
  githubApiError: "GitHub API エラー: {0}",
  actionPreview: "プレビュー",
  actionNewSearch: "新しい検索",
  actionBack: "戻る",
  previewTitle: "リソース プレビュー",
  loading: "読み込み中...",
  addSourceButtonLabel: "ソース追加",
  githubButtonLabel: "GitHub",
  sourceLabel: "ソース",
  categoriesLabel: "カテゴリ",
  noneLabel: "なし",
  starsLabel: "スター",
  organizationLabel: "組織",
  standaloneWarningTitle: "⚠️ 警告:",
  standaloneWarningBody: "このスキルは他のスキルと組み合わせて動作します。",
  requiresLabel: "必要スキル:",
  bundleLabel: "バンドル:",
  bundleInstallRecommended: "（バンドル全体のインストール推奨）",
  previewFailed: "プレビューに失敗しました: {0}",
  sourceNotFoundInPreview:
    "ソースが見つかりません: {0}。手動でソースを追加してください。",
  sourceResolutionFailedInPreview:
    "ソースIDを特定できませんでした: {0}。ソース追加後の解決に失敗しました。",
  skillNotFoundAfterAddSource:
    'ソース追加後にスキル "{0}" が見つかりませんでした。手動でインストールしてください。',
  githubUrlNotDetermined: "{0} の GitHub URL を特定できませんでした",
  addToFavorites: "お気に入りに追加",
  removeFromFavorites: "お気に入りから削除",
  favorites: "お気に入り",
  noFavorites: "お気に入りはありません",
  openOnGitHub: "GitHub で開く",
  popularSkill: "⭐ 人気スキル",
  orgManagedSkill: "☑ 組織管理",
  starsCount: "{0} スター",
  addSourceFromSearch: "このリポジトリをソースに追加",
  selectCategory: "カテゴリを選択",
  allCategories: "すべてのカテゴリ",
  recentlyInstalled: "最近インストールしたリソース",
  noRecentSkills: "最近インストールしたリソースはありません",
  skillsInCategory: "{0} のリソース ({1}件)",
  localSkillRegistered: "✅ {0} をインストラクションファイルに登録しました",
  localSkillUnregistered: "✅ {0} をインストラクションファイルから削除しました",
  localSkillAlreadyRegistered: "{0} は既に登録されています",
  createSkillPrompt: "スキル名を入力してください",
  createSkillPlaceholder: "my-awesome-skill",
  skillCreated: "✅ {0} を作成しました",
  noLocalSkills: "ローカルリソースが見つかりません",
  emptyResourceEntries:
    'リソース項目はまだありません。"{0}" を使って workspace または global のリソースをインストールしてください。',
  emptySkillEntries:
    'skill 項目はまだありません。"{0}" を使って workspace skill をインストールしてください。agents、prompts、instructions、hooks はそれぞれのネイティブ view に表示されます。',
  noResourcesFound: "リソースが見つかりません",
  installResourcesHint: "「{0}」でインストールしてください",
  instructionFileUpdatedOnSettingChange:
    "✅ 設定変更によりリソース出力を更新しました",
} as const;

type MessageKey = keyof typeof jaMessages;
type MessageDictionary = Readonly<Record<MessageKey, string>>;

// 英語メッセージ（デフォルト）
const enMessages: MessageDictionary = {
  noWorkspace: "Please open a workspace",
  installSuccess: "✅ {0} installed successfully",
  installFailed: "Installation failed: {0}",
  installing: "Installing {0}...",
  installTargetPlaceholder: "Select where to install {0}",
  installTargetWorkspaceLabel: "Workspace",
  installTargetWorkspaceDescription: "This workspace: {0}",
  installTargetUserProfileLabel: "User Profile",
  installTargetUserProfileDescription: "Default user location: {0}",
  installTargetCopilotHomeLabel: "Global Resource Home",
  installTargetCopilotHomeDescription: "Shared resource root: {0}",
  installTargetCustomLabel: "Custom",
  installTargetCustomDescription: "Choose a destination folder",
  installTargetOpenLabel: "Use as install target",
  uninstallSuccess: "✅ {0} uninstalled successfully",
  uninstallFailed: "Uninstall failed: {0}",
  selectSkillToUninstall: "Select skill to uninstall",
  searchPlaceholder: "Enter resource name or keyword...",
  searchCommandTitle: "Search Resources",
  commandPaletteSearchTitle: "Agent Resources Ninja: Search Resources",
  installConfirm: 'Install "{0}"?',
  noInstalledSkills: "No installed skills found",
  installedSkillsPlaceholder: "Installed Skills",
  skillNotFound: "SKILL.md not found: {0}",
  invalidSkillInfo: "Invalid resource information",
  updatingIndex: "Updating resource index...",
  updatingSource: "Updating {0}...",
  indexUpdated: "✅ Index updated ({0} → {1} resources, {2})",
  updateFailed: "Update failed: {0}",
  updating: "Updating {0}...",
  updateSourceSelectRequired:
    "Please select a source to update from the Remote Resources view.",
  sourceIdNotFound: "Source ID not found.",
  copiedToClipboard: "Copied to clipboard",
  copiedToClipboardWithValue: "Copied: {0}",
  enterRepoUrl: "Enter GitHub repository URL",
  repoUrlPlaceholder: "https://github.com/owner/repo",
  invalidRepoUrl: "Please enter a valid GitHub repository URL",
  scanningRepo: "Scanning repository for resources...",
  sourceAdded: "✅ Source added ({0} resources found)",
  addSourceFailed: "Failed to add source: {0}",
  noSkillsInRepo: "No resources found in this repository",
  selectSourceToRemove: "Select source to remove",
  confirmRemoveSource:
    'Remove "{0}"? All resources from this source will be removed from the index. Installed files will not be deleted.',
  actionRemove: "Remove",
  sourceRemoved: "✅ Source removed ({0} resources)",
  removeSourceFailed: "Failed to remove source: {0}",
  webSearchPrompt: "Search resources on GitHub",
  webSearchPlaceholder: "keyword... or username keyword...",
  searchingGitHub: "Searching GitHub...",
  noSearchResults: 'No resources found for "{0}"',
  searchResultsCount: "{0} resources found",
  searchFailed: "Search failed: {0}",
  actionInstall: "Install",
  actionCancel: "Cancel",
  actionAddSourceRepo: "Add this repository as source",
  actionOpenGitHub: "Open on GitHub",
  authRequired:
    "GitHub authentication required. Please configure authentication to avoid API rate limits.",
  openSettings: "Open Settings",
  resetSettingsTitle: "Reset Settings",
  resetSettingsPrompt: "Select items to reset",
  resetCache: "Clear Cache",
  resetAllSettings: "Reset All Settings",
  resetAllIncludingToken: "Reset All Settings (including token)",
  resetConfirmSettings:
    "Reset the Resource Ninja cache and all settings except the token. This cannot be undone. Continue?",
  resetConfirmAll:
    "Reset the Resource Ninja cache, all settings, and the GitHub token. This cannot be undone. Continue?",
  resetConfirmAction: "Reset",
  resetComplete: "✅ Reset complete. Please restart VS Code.",
  authWithGhCli: "Authenticate with gh CLI",
  installedFolder: "Installed",
  rateLimitExceeded:
    "GitHub API rate limit exceeded. Please authenticate with a GitHub token.",
  repoNotFound: "Repository not found: {0}",
  githubApiError: "GitHub API error: {0}",
  actionPreview: "Preview",
  actionNewSearch: "New Search",
  actionBack: "Back",
  previewTitle: "Resource Preview",
  loading: "Loading...",
  addSourceButtonLabel: "Add Source",
  githubButtonLabel: "GitHub",
  sourceLabel: "Source",
  categoriesLabel: "Categories",
  noneLabel: "None",
  starsLabel: "Stars",
  organizationLabel: "Organization",
  standaloneWarningTitle: "⚠️ Warning:",
  standaloneWarningBody: "This skill requires other skills to work properly.",
  requiresLabel: "Requires:",
  bundleLabel: "Bundle:",
  bundleInstallRecommended: "(Install full bundle recommended)",
  previewFailed: "Preview failed: {0}",
  sourceNotFoundInPreview:
    "Source not found: {0}. Please add the source manually.",
  sourceResolutionFailedInPreview:
    "Unable to resolve source ID after adding source: {0}",
  skillNotFoundAfterAddSource:
    'Skill "{0}" not found after adding source. Please try installing manually.',
  githubUrlNotDetermined: "GitHub URL could not be determined for {0}",
  addToFavorites: "Add to Favorites",
  removeFromFavorites: "Remove from Favorites",
  favorites: "Favorites",
  noFavorites: "No favorites yet",
  openOnGitHub: "Open on GitHub",
  popularSkill: "⭐ Popular",
  orgManagedSkill: "☑ Organization",
  starsCount: "{0} stars",
  addSourceFromSearch: "Add this repository to sources",
  selectCategory: "Select Category",
  allCategories: "All Categories",
  recentlyInstalled: "Recently Installed Resources",
  noRecentSkills: "No recently installed resources",
  skillsInCategory: "{0} resources ({1})",
  localSkillRegistered: "✅ {0} registered in the instruction file",
  localSkillUnregistered: "✅ {0} removed from the instruction file",
  localSkillAlreadyRegistered: "{0} is already registered",
  createSkillPrompt: "Enter skill name",
  createSkillPlaceholder: "my-awesome-skill",
  skillCreated: "✅ {0} created",
  noLocalSkills: "No local resources found",
  emptyResourceEntries:
    'No resource entries listed yet. Use "{0}" to install workspace or global resources.',
  emptySkillEntries:
    'No skill entries listed yet. Use "{0}" to install workspace skills. Agents, prompts, instructions, and hooks stay in their native resource views.',
  noResourcesFound: "No resources found",
  installResourcesHint: "Use '{0}' to install resources",
  instructionFileUpdatedOnSettingChange:
    "✅ Resource output updated due to setting change",
};

/**
 * 現在の言語設定を取得
 */
function getCurrentLanguage(): string {
  const config = vscode.workspace.getConfiguration("resourceNinja");
  const langSetting = config.get<string>("language", "auto");

  if (langSetting === "auto") {
    return vscode.env.language;
  }
  return langSetting;
}

/**
 * 現在の言語が日本語かどうかを判定
 */
export function isJapanese(): boolean {
  return getCurrentLanguage().startsWith("ja");
}

// 現在の言語に応じたメッセージを取得
function getMessages(): MessageDictionary {
  if (isJapanese()) {
    return jaMessages;
  }
  return enMessages;
}

// フォーマット関数
function format(template: string, ...args: (string | number)[]): string {
  return template.replace(/\{(\d+)\}/g, (_, index) => {
    const i = parseInt(index, 10);
    return args[i] !== undefined ? String(args[i]) : `{${index}}`;
  });
}

// ローカライズ関数
function localize(key: MessageKey, ...args: (string | number)[]): string {
  const messages = getMessages();
  const template = messages[key];
  return format(template, ...args);
}

// メッセージキー定義
export const messages = {
  // 一般
  noWorkspace: () => localize("noWorkspace"),

  // インストール関連
  installSuccess: (name: string) => localize("installSuccess", name),
  installFailed: (error: string) => localize("installFailed", error),
  installing: (name: string) => localize("installing", name),
  installTargetPlaceholder: (name: string) =>
    localize("installTargetPlaceholder", name),
  installTargetWorkspaceLabel: () => localize("installTargetWorkspaceLabel"),
  installTargetWorkspaceDescription: (pathValue: string) =>
    localize("installTargetWorkspaceDescription", pathValue),
  installTargetUserProfileLabel: () =>
    localize("installTargetUserProfileLabel"),
  installTargetUserProfileDescription: (pathValue: string) =>
    localize("installTargetUserProfileDescription", pathValue),
  installTargetCopilotHomeLabel: () =>
    localize("installTargetCopilotHomeLabel"),
  installTargetCopilotHomeDescription: (pathValue: string) =>
    localize("installTargetCopilotHomeDescription", pathValue),
  installTargetCustomLabel: () => localize("installTargetCustomLabel"),
  installTargetCustomDescription: () =>
    localize("installTargetCustomDescription"),
  installTargetOpenLabel: () => localize("installTargetOpenLabel"),

  // アンインストール関連
  uninstallSuccess: (name: string) => localize("uninstallSuccess", name),
  uninstallFailed: (error: string) => localize("uninstallFailed", error),
  selectSkillToUninstall: () => localize("selectSkillToUninstall"),

  // 検索関連
  searchPlaceholder: () => localize("searchPlaceholder"),
  searchCommandTitle: () => localize("searchCommandTitle"),
  commandPaletteSearchTitle: () => localize("commandPaletteSearchTitle"),
  installConfirm: (name: string) => localize("installConfirm", name),
  noInstalledSkills: () => localize("noInstalledSkills"),
  installedSkillsPlaceholder: () => localize("installedSkillsPlaceholder"),
  skillNotFound: (name: string) => localize("skillNotFound", name),
  invalidSkillInfo: () => localize("invalidSkillInfo"),

  // インデックス更新
  updatingIndex: () => localize("updatingIndex"),
  updatingSource: (name: string) => localize("updatingSource", name),
  indexUpdated: (oldCount: number, newCount: number, diff: string) =>
    localize("indexUpdated", oldCount, newCount, diff),
  updateFailed: (error: string) => localize("updateFailed", error),
  updating: (name: string) => localize("updating", name),
  updateSourceSelectRequired: () => localize("updateSourceSelectRequired"),
  sourceIdNotFound: () => localize("sourceIdNotFound"),
  copiedToClipboard: () => localize("copiedToClipboard"),
  copiedToClipboardWithValue: (value: string) =>
    localize("copiedToClipboardWithValue", value),

  // ソース追加
  enterRepoUrl: () => localize("enterRepoUrl"),
  repoUrlPlaceholder: () => localize("repoUrlPlaceholder"),
  invalidRepoUrl: () => localize("invalidRepoUrl"),
  scanningRepo: () => localize("scanningRepo"),
  sourceAdded: (count: number) => localize("sourceAdded", count),
  addSourceFailed: (error: string) => localize("addSourceFailed", error),
  noSkillsInRepo: () => localize("noSkillsInRepo"),

  // ソース削除
  selectSourceToRemove: () => localize("selectSourceToRemove"),
  confirmRemoveSource: (name: string) => localize("confirmRemoveSource", name),
  actionRemove: () => localize("actionRemove"),
  sourceRemoved: (count: number) => localize("sourceRemoved", count),
  removeSourceFailed: (error: string) => localize("removeSourceFailed", error),

  // Web検索
  webSearchPrompt: () => localize("webSearchPrompt"),
  webSearchPlaceholder: () => localize("webSearchPlaceholder"),
  searchingGitHub: () => localize("searchingGitHub"),
  noSearchResults: (query: string) => localize("noSearchResults", query),
  searchResultsCount: (count: number) => localize("searchResultsCount", count),
  searchFailed: (error: string) => localize("searchFailed", error),

  // アクション
  actionInstall: () => localize("actionInstall"),
  actionCancel: () => localize("actionCancel"),
  actionAddSourceRepo: () => localize("actionAddSourceRepo"),
  actionOpenGitHub: () => localize("actionOpenGitHub"),

  // 認証
  authRequired: () => localize("authRequired"),
  openSettings: () => localize("openSettings"),
  authWithGhCli: () => localize("authWithGhCli"),

  // 初期化
  resetSettingsTitle: () => localize("resetSettingsTitle"),
  resetSettingsPrompt: () => localize("resetSettingsPrompt"),
  resetCache: () => localize("resetCache"),
  resetAllSettings: () => localize("resetAllSettings"),
  resetAllIncludingToken: () => localize("resetAllIncludingToken"),
  resetConfirmSettings: () => localize("resetConfirmSettings"),
  resetConfirmAll: () => localize("resetConfirmAll"),
  resetConfirmAction: () => localize("resetConfirmAction"),
  resetComplete: () => localize("resetComplete"),

  // TreeView
  installedFolder: () => localize("installedFolder"),

  // GitHub API エラー
  rateLimitExceeded: () => localize("rateLimitExceeded"),
  repoNotFound: (repo: string) => localize("repoNotFound", repo),
  githubApiError: (status: number) => localize("githubApiError", status),

  // 新機能: プレビュー、お気に入り、検索継続
  actionPreview: () => localize("actionPreview"),
  actionNewSearch: () => localize("actionNewSearch"),
  actionBack: () => localize("actionBack"),
  previewTitle: () => localize("previewTitle"),
  loading: () => localize("loading"),
  addSourceButtonLabel: () => localize("addSourceButtonLabel"),
  githubButtonLabel: () => localize("githubButtonLabel"),
  sourceLabel: () => localize("sourceLabel"),
  categoriesLabel: () => localize("categoriesLabel"),
  noneLabel: () => localize("noneLabel"),
  starsLabel: () => localize("starsLabel"),
  organizationLabel: () => localize("organizationLabel"),
  standaloneWarningTitle: () => localize("standaloneWarningTitle"),
  standaloneWarningBody: () => localize("standaloneWarningBody"),
  requiresLabel: () => localize("requiresLabel"),
  bundleLabel: () => localize("bundleLabel"),
  bundleInstallRecommended: () => localize("bundleInstallRecommended"),
  previewFailed: (error: string) => localize("previewFailed", error),
  sourceNotFoundInPreview: (source: string) =>
    localize("sourceNotFoundInPreview", source),
  sourceResolutionFailedInPreview: (source: string) =>
    localize("sourceResolutionFailedInPreview", source),
  skillNotFoundAfterAddSource: (name: string) =>
    localize("skillNotFoundAfterAddSource", name),
  githubUrlNotDetermined: (name: string) =>
    localize("githubUrlNotDetermined", name),
  addToFavorites: () => localize("addToFavorites"),
  removeFromFavorites: () => localize("removeFromFavorites"),
  favorites: () => localize("favorites"),
  noFavorites: () => localize("noFavorites"),

  // GitHubで開く・ハイライト
  openOnGitHub: () => localize("openOnGitHub"),
  popularSkill: () => localize("popularSkill"),
  orgManagedSkill: () => localize("orgManagedSkill"),
  starsCount: (count: number) => localize("starsCount", count),
  addSourceFromSearch: () => localize("addSourceFromSearch"),

  // カテゴリフィルタ・履歴
  selectCategory: () => localize("selectCategory"),
  allCategories: () => localize("allCategories"),
  recentlyInstalled: () => localize("recentlyInstalled"),
  noRecentSkills: () => localize("noRecentSkills"),
  skillsInCategory: (category: string, count: number) =>
    localize("skillsInCategory", category, count),

  // ローカルスキル
  localSkillRegistered: (name: string) =>
    localize("localSkillRegistered", name),
  localSkillUnregistered: (name: string) =>
    localize("localSkillUnregistered", name),
  localSkillAlreadyRegistered: (name: string) =>
    localize("localSkillAlreadyRegistered", name),
  createSkillPrompt: () => localize("createSkillPrompt"),
  createSkillPlaceholder: () => localize("createSkillPlaceholder"),
  skillCreated: (name: string) => localize("skillCreated", name),
  noLocalSkills: () => localize("noLocalSkills"),
  emptyResourceEntries: (commandTitle: string) =>
    localize("emptyResourceEntries", commandTitle),
  emptySkillEntries: (commandTitle: string) =>
    localize("emptySkillEntries", commandTitle),
  noResourcesFound: () => localize("noResourcesFound"),
  installResourcesHint: (commandTitle: string) =>
    localize("installResourcesHint", commandTitle),

  // 設定変更時の自動更新
  instructionFileUpdatedOnSettingChange: () =>
    localize("instructionFileUpdatedOnSettingChange"),
};

export default messages;
