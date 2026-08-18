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
  staleSourceIndexUpdating: "古いソースインデックスを更新中...",
  staleSourceIndexUpdated:
    "✅ ソースインデックスを更新しました ({0}/{1} ソース)",
  staleSourceIndexPartialFailed:
    "ソースインデックスの更新結果: {0}/{2} 件更新、{1} 件失敗、{5} 件未試行。失敗: {3}。理由: {4}",
  sourceIndexResourcesUpdatedProgress: "{0} 件のリソースを更新",
  sourceIndexUpdated: "✅ {0} を更新しました: {1} → {2} リソース ({3})",
  githubRateLimitReason: "GitHub API の rate limit に達しました",
  githubRateLimitResetAt: "再試行可能: {0}",
  githubSsoRequiredReason: "GitHub organization の SSO 認証が必要です",
  githubClassicPatForbiddenReason:
    "GitHub organization のポリシーにより classic PAT が拒否されました",
  githubAuthRequiredReason:
    "GitHub 認証またはリポジトリへのアクセス権が必要です",
  githubAuthHelp: "{0}\n\n現在の credential source: {1}\n{2}",
  githubAuthActiveGhCliAccount: "gh CLI のアクティブなアカウント: {0}",
  githubAuthSelectGhCliAccount: "切り替える gh CLI アカウントを選択",
  githubAuthSwitchConfirm:
    "gh CLI のアクティブなアカウントを {0} に切り替えます。続行しますか？",
  githubAuthRecoveryFailed:
    "GitHub 認証を復旧できませんでした。元の操作は再実行していません。",
  githubAuthSourceSecret: "VS Code SecretStorage",
  githubAuthSourceEnv: "GH_TOKEN / GITHUB_TOKEN 環境変数",
  githubAuthSourceGhCli: "gh CLI",
  githubAuthSourceConfig: "legacy resourceNinja.githubToken 設定",
  githubAuthSourceNone: "未設定",
  githubAuthGuidanceSecret:
    "保存済みトークンが古い場合はクリアしてください。その後、gh CLI または環境変数で再認証できます。",
  githubAuthGuidanceEnv:
    "GH_TOKEN が GITHUB_TOKEN より優先され、どちらも gh CLI より優先されます。環境変数を更新または解除してから VS Code を再読み込みしてください。",
  githubAuthGuidanceGhCli:
    "ターミナルで gh auth login を実行して認証を更新してください。organization SSO が必要な場合はトークンのSSO認可も確認してください。",
  githubAuthGuidanceConfig:
    "legacy設定のトークンが古い場合はクリアするか、GitHub Token設定を空にしてください。",
  githubAuthGuidanceNone:
    "gh CLIで認証するか、private repository用のfine-grained PATをGitHub Token設定へ保存してください。",
  githubAuthStatusAuthenticated: "GitHub認証は有効です（source: {0}）。",
  sharedStoreSyncPaused:
    "共有ストアへの同期を中断しました。共有ファイルの読み書きを安全に完了できないためです（{0}）。他のツールのデータを壊さないよう既存ファイルはそのままにしてあり、ローカルのリソースは引き続き使えます。",
  actionShowDetails: "詳細を表示",
  actionShowCoexistenceStatus: "共存ステータスを表示",
  actionConfigureGitHubAuth: "GitHub 認証を設定",
  actionOpenGitHubTokenPage: "GitHub のトークン設定を開く",
  actionOpenSsoSession: "organization の SSO 認可を開く",
  actionSwitchGhCliAccount: "別の gh CLI アカウントに切り替える",
  actionSwitchGhCliAccountConfirm: "このアカウントに切り替える",
  actionInstallGhCli: "GitHub CLI をインストール",
  actionClearStoredGitHubToken: "保存・設定済み GitHub トークンをクリア",
  updating: "{0} を更新中...",
  updateSourceSelectRequired:
    "Remote Resources ビューから更新するソースを選択してください。",
  sourceIdNotFound: "ソース ID が見つかりません。",
  copiedToClipboard: "コピーしました",
  copiedToClipboardWithValue: "コピーしました: {0}",
  resourceUrlUnavailable: "この項目のGitHub URLを特定できませんでした。",
  resourceTerminalUnavailable:
    "この項目を開くフォルダーを特定できませんでした。",
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
  authRequired: "GitHub認証またはリポジトリへのアクセス権を確認してください。",
  privateRepositoryAccessFailed:
    "リポジトリ {0}/{1} が見つからないか、現在の認証にアクセス権がありません。private repositoryでは Contents: Read 権限とorganization SSO認可を確認してください。",
  repositoryOrBranchAccessFailed:
    "リポジトリ {0}/{1} のbranch {2} が見つからないか、現在の認証にアクセス権がありません。",
  skillDownloadNotFoundNoAuth:
    'スキル "{0}" が見つかりません。プライベート リポジトリの場合は GitHub 認証が必要です。認証を設定するか、インデックスを更新してください。',
  skillDownloadNotFoundWithAuth:
    'スキル "{0}" が見つかりません。インデックスのパスが古いか、GitHub 認証に対象リポジトリの Contents: read 権限がない可能性があります。',
  actionUpdateIndex: "インデックス更新",
  actionReportBug: "バグ報告",
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
  githubTokenCleared:
    "SecretStorage と legacy 設定の GitHub トークンを削除しました。環境変数と gh CLI の認証は変更していません。",
  githubTokenNotStored:
    "SecretStorage または legacy 設定に GitHub トークンはありません。環境変数と gh CLI の認証は変更していません。",
  githubTokenClearFailed:
    "保存・設定済み GitHub トークンを完全に削除できませんでした。設定を確認して再試行してください。",
  githubTokenMigrated:
    "legacy GitHub Token設定をSecretStorageへコピーしました。設定ファイルの平文コピーを削除しますか？",
  actionRemoveLegacyGitHubToken: "legacy設定のコピーを削除",
  authWithGhCli: "ターミナルで gh auth login を実行",
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
  pluginLocationRegisterPrompt:
    'plugin "{0}" のフォルダーのパスを、ユーザー設定 (settings.json) の chat.pluginLocations に追加してよいですか？登録しないと VS Code はこの plugin を読み込みません。',
  pluginLocationRegisterPromptMultiple:
    "インストールした {0} 個の plugin フォルダーのパスを、ユーザー設定 (settings.json) の chat.pluginLocations に追加してよいですか？登録しないと VS Code はこれらの plugin を読み込みません。",
  pluginLocationRegisterAction: "chat.pluginLocations に登録",
  pluginLocationSkipAction: "登録しない",
  pluginLocationRegistered:
    "✅ {0} 個の plugin フォルダーのパスをユーザー設定の chat.pluginLocations に追加しました",
  pluginLocationOpenSettingAction: "chat.pluginLocations を開く",
  pluginLocationRegisterFailed:
    "chat.pluginLocations の更新に失敗しました: {0}",
  pluginLocationUnsupportedVersion:
    "plugin フォルダーを登録できませんでした: この VS Code ({0}) には chat.pluginLocations 設定がありません。VS Code 1.116 以降へ更新するまで、この plugin は読み込まれません。",
  pluginsDisabledNote:
    "chat.plugins.enabled が false のため、有効化するまで plugin は読み込まれません。",
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
  staleSourceIndexUpdating: "Updating stale source indexes...",
  staleSourceIndexUpdated: "✅ Updated source indexes ({0}/{1} sources)",
  staleSourceIndexPartialFailed:
    "Source index update result: {0}/{2} updated, {1} failed, {5} not attempted. Failed: {3}. Reason: {4}",
  sourceIndexResourcesUpdatedProgress: "Updated {0} resource(s)",
  sourceIndexUpdated: "✅ Updated {0}: {1} → {2} resource(s) ({3})",
  githubRateLimitReason: "GitHub API rate limit exceeded",
  githubRateLimitResetAt: "retry after {0}",
  githubSsoRequiredReason: "GitHub organization SSO authorization is required",
  githubClassicPatForbiddenReason:
    "GitHub organization policy rejected the classic PAT",
  githubAuthRequiredReason:
    "GitHub authentication or repository permission is required",
  githubAuthHelp: "{0}\n\nActive credential source: {1}\n{2}",
  githubAuthActiveGhCliAccount: "Active gh CLI account: {0}",
  githubAuthSelectGhCliAccount: "Select a gh CLI account to switch to",
  githubAuthSwitchConfirm: "Switch the active gh CLI account to {0}?",
  githubAuthRecoveryFailed:
    "GitHub authentication could not be recovered. The original operation was not retried.",
  githubAuthSourceSecret: "VS Code SecretStorage",
  githubAuthSourceEnv: "GH_TOKEN / GITHUB_TOKEN environment variables",
  githubAuthSourceGhCli: "gh CLI",
  githubAuthSourceConfig: "legacy resourceNinja.githubToken setting",
  githubAuthSourceNone: "none detected",
  githubAuthGuidanceSecret:
    "Clear the stored token if it is stale. You can then authenticate again with gh CLI or an environment variable.",
  githubAuthGuidanceEnv:
    "GH_TOKEN takes precedence over GITHUB_TOKEN, and both override gh CLI. Update or unset the environment variable, then reload VS Code.",
  githubAuthGuidanceGhCli:
    "Run gh auth login in the terminal to refresh authentication. If the organization requires SSO, also authorize the token for SSO.",
  githubAuthGuidanceConfig:
    "Clear the stale legacy token or empty the GitHub Token setting.",
  githubAuthGuidanceNone:
    "Authenticate with gh CLI, or save a fine-grained PAT with access to the private repository in the GitHub Token setting.",
  githubAuthStatusAuthenticated:
    "GitHub authentication is working (source: {0}).",
  sharedStoreSyncPaused:
    "Syncing to the shared store is paused because a shared file read or write could not complete safely ({0}). Existing files were left untouched so another tool's data is not destroyed, and your local resources keep working.",
  actionShowDetails: "Show Details",
  actionShowCoexistenceStatus: "Show Coexistence Status",
  actionConfigureGitHubAuth: "Configure GitHub Authentication",
  actionOpenGitHubTokenPage: "Open GitHub Token Settings",
  actionOpenSsoSession: "Open Organization SSO Authorization",
  actionSwitchGhCliAccount: "Switch to Another gh CLI Account",
  actionSwitchGhCliAccountConfirm: "Switch to This Account",
  actionInstallGhCli: "Install GitHub CLI",
  actionClearStoredGitHubToken: "Clear Stored and Configured GitHub Token",
  updating: "Updating {0}...",
  updateSourceSelectRequired:
    "Please select a source to update from the Remote Resources view.",
  sourceIdNotFound: "Source ID not found.",
  copiedToClipboard: "Copied to clipboard",
  copiedToClipboardWithValue: "Copied: {0}",
  resourceUrlUnavailable: "Could not determine a GitHub URL for this item.",
  resourceTerminalUnavailable:
    "Could not determine a folder to open for this item.",
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
  authRequired: "Check GitHub authentication or repository access.",
  privateRepositoryAccessFailed:
    "Repository {0}/{1} was not found, or the active credential cannot access it. For a private repository, verify Contents: Read permission and organization SSO authorization.",
  repositoryOrBranchAccessFailed:
    "Repository {0}/{1} branch {2} was not found, or the active credential cannot access it.",
  skillDownloadNotFoundNoAuth:
    'Skill "{0}" was not found. Private repositories require GitHub authentication. Configure authentication or update the resource index.',
  skillDownloadNotFoundWithAuth:
    'Skill "{0}" was not found. The index path may be outdated, or GitHub authentication may not have Contents: read access to the repository.',
  actionUpdateIndex: "Update Index",
  actionReportBug: "Report Bug",
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
  githubTokenCleared:
    "Removed the GitHub token from SecretStorage and the legacy setting. Environment variables and gh CLI authentication were not changed.",
  githubTokenNotStored:
    "No GitHub token is stored in SecretStorage or the legacy setting. Environment variables and gh CLI authentication were not changed.",
  githubTokenClearFailed:
    "Could not completely remove the stored and configured GitHub token. Check your settings and try again.",
  githubTokenMigrated:
    "Copied the legacy GitHub Token setting into SecretStorage. Remove the plaintext setting copy?",
  actionRemoveLegacyGitHubToken: "Remove Legacy Setting Copy",
  authWithGhCli: "Run gh auth login in Terminal",
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
  pluginLocationRegisterPrompt:
    'Add the folder path of plugin "{0}" to chat.pluginLocations in your user settings (settings.json)? VS Code does not load the plugin until it is registered.',
  pluginLocationRegisterPromptMultiple:
    "Add the folder paths of {0} installed plugins to chat.pluginLocations in your user settings (settings.json)? VS Code does not load these plugins until they are registered.",
  pluginLocationRegisterAction: "Register in chat.pluginLocations",
  pluginLocationSkipAction: "Skip",
  pluginLocationRegistered:
    "✅ Added {0} plugin folder paths to chat.pluginLocations in your user settings",
  pluginLocationOpenSettingAction: "Open chat.pluginLocations",
  pluginLocationRegisterFailed: "Failed to update chat.pluginLocations: {0}",
  pluginLocationUnsupportedVersion:
    "Could not register the plugin folder: this VS Code ({0}) has no chat.pluginLocations setting. The plugin will not load until you update to VS Code 1.116 or newer.",
  pluginsDisabledNote:
    "chat.plugins.enabled is false, so the plugin will not load until it is enabled.",
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
  staleSourceIndexUpdating: () => localize("staleSourceIndexUpdating"),
  staleSourceIndexUpdated: (updated: number, total: number) =>
    localize("staleSourceIndexUpdated", updated, total),
  staleSourceIndexPartialFailed: (
    updated: number,
    failed: number,
    total: number,
    failedSources: string,
    reason: string,
    skipped: number,
  ) =>
    localize(
      "staleSourceIndexPartialFailed",
      updated,
      failed,
      total,
      failedSources,
      reason,
      skipped,
    ),
  sourceIndexResourcesUpdatedProgress: (count: number) =>
    localize("sourceIndexResourcesUpdatedProgress", count),
  sourceIndexUpdated: (
    name: string,
    oldCount: number,
    newCount: number,
    diff: string,
  ) => localize("sourceIndexUpdated", name, oldCount, newCount, diff),
  githubRateLimitReason: () => localize("githubRateLimitReason"),
  githubRateLimitResetAt: (resetAt: string) =>
    localize("githubRateLimitResetAt", resetAt),
  githubSsoRequiredReason: () => localize("githubSsoRequiredReason"),
  githubClassicPatForbiddenReason: () =>
    localize("githubClassicPatForbiddenReason"),
  githubAuthRequiredReason: () => localize("githubAuthRequiredReason"),
  githubAuthHelp: (reason: string, source: string, guidance: string) =>
    localize("githubAuthHelp", reason, source, guidance),
  githubAuthActiveGhCliAccount: (account: string) =>
    localize("githubAuthActiveGhCliAccount", account),
  githubAuthSelectGhCliAccount: () => localize("githubAuthSelectGhCliAccount"),
  githubAuthSwitchConfirm: (account: string) =>
    localize("githubAuthSwitchConfirm", account),
  githubAuthRecoveryFailed: () => localize("githubAuthRecoveryFailed"),
  githubAuthSourceSecret: () => localize("githubAuthSourceSecret"),
  githubAuthSourceEnv: () => localize("githubAuthSourceEnv"),
  githubAuthSourceGhCli: () => localize("githubAuthSourceGhCli"),
  githubAuthSourceConfig: () => localize("githubAuthSourceConfig"),
  githubAuthSourceNone: () => localize("githubAuthSourceNone"),
  githubAuthGuidanceSecret: () => localize("githubAuthGuidanceSecret"),
  githubAuthGuidanceEnv: () => localize("githubAuthGuidanceEnv"),
  githubAuthGuidanceGhCli: () => localize("githubAuthGuidanceGhCli"),
  githubAuthGuidanceConfig: () => localize("githubAuthGuidanceConfig"),
  githubAuthGuidanceNone: () => localize("githubAuthGuidanceNone"),
  githubAuthStatusAuthenticated: (source: string) =>
    localize("githubAuthStatusAuthenticated", source),
  sharedStoreSyncPaused: (reason: string) =>
    localize("sharedStoreSyncPaused", reason),
  actionShowDetails: () => localize("actionShowDetails"),
  actionShowCoexistenceStatus: () => localize("actionShowCoexistenceStatus"),
  actionConfigureGitHubAuth: () => localize("actionConfigureGitHubAuth"),
  actionOpenGitHubTokenPage: () => localize("actionOpenGitHubTokenPage"),
  actionOpenSsoSession: () => localize("actionOpenSsoSession"),
  actionSwitchGhCliAccount: () => localize("actionSwitchGhCliAccount"),
  actionSwitchGhCliAccountConfirm: () =>
    localize("actionSwitchGhCliAccountConfirm"),
  actionInstallGhCli: () => localize("actionInstallGhCli"),
  actionClearStoredGitHubToken: () => localize("actionClearStoredGitHubToken"),
  updating: (name: string) => localize("updating", name),
  updateSourceSelectRequired: () => localize("updateSourceSelectRequired"),
  sourceIdNotFound: () => localize("sourceIdNotFound"),
  copiedToClipboard: () => localize("copiedToClipboard"),
  copiedToClipboardWithValue: (value: string) =>
    localize("copiedToClipboardWithValue", value),
  resourceUrlUnavailable: () => localize("resourceUrlUnavailable"),
  resourceTerminalUnavailable: () => localize("resourceTerminalUnavailable"),

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
  privateRepositoryAccessFailed: (owner: string, repo: string) =>
    localize("privateRepositoryAccessFailed", owner, repo),
  repositoryOrBranchAccessFailed: (
    owner: string,
    repo: string,
    branch: string,
  ) => localize("repositoryOrBranchAccessFailed", owner, repo, branch),
  skillDownloadNotFoundNoAuth: (name: string) =>
    localize("skillDownloadNotFoundNoAuth", name),
  skillDownloadNotFoundWithAuth: (name: string) =>
    localize("skillDownloadNotFoundWithAuth", name),
  actionUpdateIndex: () => localize("actionUpdateIndex"),
  actionReportBug: () => localize("actionReportBug"),
  openSettings: () => localize("openSettings"),
  authWithGhCli: () => localize("authWithGhCli"),
  githubTokenCleared: () => localize("githubTokenCleared"),
  githubTokenNotStored: () => localize("githubTokenNotStored"),
  githubTokenClearFailed: () => localize("githubTokenClearFailed"),
  githubTokenMigrated: () => localize("githubTokenMigrated"),
  actionRemoveLegacyGitHubToken: () =>
    localize("actionRemoveLegacyGitHubToken"),

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

  // plugin の chat.pluginLocations 登録
  pluginLocationRegisterPrompt: (name: string) =>
    localize("pluginLocationRegisterPrompt", name),
  pluginLocationRegisterPromptMultiple: (count: number) =>
    localize("pluginLocationRegisterPromptMultiple", count),
  pluginLocationRegisterAction: () => localize("pluginLocationRegisterAction"),
  pluginLocationSkipAction: () => localize("pluginLocationSkipAction"),
  pluginLocationRegistered: (count: number) =>
    localize("pluginLocationRegistered", count),
  pluginLocationOpenSettingAction: () =>
    localize("pluginLocationOpenSettingAction"),
  pluginLocationRegisterFailed: (error: string) =>
    localize("pluginLocationRegisterFailed", error),
  pluginLocationUnsupportedVersion: (version: string) =>
    localize("pluginLocationUnsupportedVersion", version),
  pluginsDisabledNote: () => localize("pluginsDisabledNote"),
};

export default messages;
