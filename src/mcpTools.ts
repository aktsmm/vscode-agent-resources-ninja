/**
 * MCP Tools - Agent Resources Ninja
 *
 * VS Code Language Model API を使用した MCP ツール実装
 * ツール一覧に表示され、エージェントが自動的に使用可能
 */
import * as vscode from "vscode";
import {
  Skill,
  loadSkillIndex,
  SkillIndex,
  ResourceKind,
  getLocalizedDescription,
  getIndexResources,
  getIndexSources,
  getResourceKind,
  getResourceKindLabel,
  saveSkillIndex,
} from "./skillIndex";
import {
  installSkill,
  getResourceTargetUri,
  getInstalledSkills,
  uninstallSkillByPath,
} from "./skillInstaller";
import { formatHookConfigUpdateSummary } from "./hookConfigManager";
import {
  escapeMarkdownTableText as escapeMarkdownCell,
  INCOMPLETE_ROW_MARKER,
  updateInstructionFile,
} from "./instructionManager";
import { getConfiguredInstructionFilePath } from "./customizationPaths";
import {
  searchGitHub,
  addSource,
  removeSource,
  getGitHubAuthFailureReason,
  type SourceIndexUpdateAllResult,
} from "./indexUpdater";
import { isJapanese } from "./i18n";
import { isGitHubResponseError } from "./githubResponse";
import { getGitHubToken } from "./githubAuth";
import { logger } from "./logger";
import { scanLocalSkills } from "./localSkillScanner";
import { formatSourceIndexUpdateToolResult } from "./sourceIndexUpdatePresentation";

/** スキルインデックスをキャッシュ */
let cachedIndex: SkillIndex | undefined;
let extContext: vscode.ExtensionContext | undefined;

function requireExtContext(): vscode.ExtensionContext {
  if (!extContext) {
    throw new Error("Extension context is not initialized");
  }
  return extContext;
}

export function localizeMcpText(en: string, ja: string): string {
  return isJapanese() ? ja : en;
}

export function formatMcpError(en: string, ja: string, error: unknown): string {
  const fallback = error instanceof Error ? error.message : String(error);
  // GitHub failures reuse the GUI reason mapping so both surfaces name the same root cause.
  const message = isGitHubResponseError(error)
    ? getGitHubAuthFailureReason(error)
    : fallback;
  return `${localizeMcpText(en, ja)}: ${message}`;
}

export function mcpContextUnavailableMessage(): string {
  return localizeMcpText(
    "❌ Extension context not available.",
    "❌ 拡張機能 context を利用できません。",
  );
}

export function githubAuthTroubleshootingText(): string {
  return localizeMcpText(
    `**GitHub authentication troubleshooting:**
1. Check the network connection and GitHub API rate-limit reset time.
2. Credential precedence is SecretStorage → GH_TOKEN → GITHUB_TOKEN → gh CLI → legacy setting. A legacy setting is copied into SecretStorage and then has the highest effective priority until cleared.
3. If GH_TOKEN or GITHUB_TOKEN is stale, update or unset it and reload VS Code.
4. Use "Clear Stored and Configured GitHub Token" for stale SecretStorage/legacy values, or run gh auth login to refresh gh CLI.
5. Private repositories require Contents: Read permission and may require organization SSO authorization.`,
    `**GitHub認証のトラブルシューティング:**
1. ネットワーク接続とGitHub API rate limitの再試行時刻を確認してください。
2. credentialの優先順は SecretStorage → GH_TOKEN → GITHUB_TOKEN → gh CLI → legacy設定です。legacy設定はSecretStorageへコピーされ、Clearするまで実効上の最優先になります。
3. GH_TOKENまたはGITHUB_TOKENが古い場合は更新または解除し、VS Codeをreloadしてください。
4. SecretStorage/legacy値には「保存・設定済み GitHub トークンをクリア」を使い、gh CLIは gh auth login で更新してください。
5. private repositoryにはContents: Read権限が必要で、organization SSO認可が必要な場合があります。`,
  );
}

function mcpWorkspaceUnavailableMessage(): string {
  return localizeMcpText(
    "❌ No workspace folder open. Please open a folder first.",
    "❌ ワークスペースフォルダーが開かれていません。先にフォルダーを開いてください。",
  );
}

/** スキルインデックスを取得 */
async function getSkillIndex(): Promise<SkillIndex> {
  const context = requireExtContext();
  if (!cachedIndex) {
    try {
      cachedIndex = await loadSkillIndex(context);
    } catch (error) {
      logger.error(
        "[Resource Ninja] MCP tools failed to load resource index; using empty fallback.",
        error,
      );
      return {
        version: "1.0.0",
        lastUpdated: new Date().toISOString().split("T")[0],
        sources: [],
        skills: [],
        categories: [],
        bundles: [],
      };
    }
  }
  return cachedIndex;
}

/**
 * 信頼度バッジを取得
 */
function getTrustBadge(source: string): string {
  const lowerSource = source.toLowerCase();
  if (lowerSource.includes("anthropic") || lowerSource.includes("github")) {
    return "🏢 Official";
  } else if (
    lowerSource.includes("awesome") ||
    lowerSource.includes("curated")
  ) {
    return "📋 Curated";
  }
  return "👥 Community";
}

/**
 * インデックス更新情報を取得
 */
function getIndexUpdateInfo(index: SkillIndex): {
  lastUpdated: string;
  daysOld: number;
  isOutdated: boolean;
  warning: string;
} {
  const lastUpdated = index.lastUpdated || "unknown";
  let daysOld = 0;
  let isOutdated = false;

  if (lastUpdated !== "unknown") {
    const lastDate = new Date(lastUpdated);
    const now = new Date();
    daysOld = Math.floor(
      (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    isOutdated = daysOld > 7;
  }

  const warning = isOutdated
    ? localizeMcpText(
        `⚠️ **The index is out of date.** (${daysOld} days old)`,
        `⚠️ **インデックスが古くなっています。** (${daysOld}日前)`,
      )
    : "";

  return { lastUpdated, daysOld, isOutdated, warning };
}

/**
 * ソース統計を取得
 */
function getSourceStats(index: SkillIndex): string {
  const sourceCount = getIndexSources(index).length;
  const skillCount = getIndexResources(index).length;
  return localizeMcpText(
    `${sourceCount} repositories, ${skillCount} resources`,
    `${sourceCount}リポジトリ、${skillCount}リソース`,
  );
}

function normalizeKindFilter(kind?: string): ResourceKind | undefined {
  const normalized = kind?.trim().toLowerCase();
  if (!normalized || normalized === "all") {
    return undefined;
  }
  if (
    normalized === "skill" ||
    normalized === "agent" ||
    normalized === "instruction" ||
    normalized === "prompt" ||
    normalized === "hook" ||
    normalized === "mcp" ||
    normalized === "plugin" ||
    normalized === "cursor-rule"
  ) {
    return normalized;
  }
  return undefined;
}

function resourceMatchesKind(resource: Skill, kind?: ResourceKind): boolean {
  return !kind || getResourceKind(resource) === kind;
}

function formatResourceCandidates(resources: Skill[], isJa: boolean): string {
  return resources
    .slice(0, 20)
    .map((resource) => {
      const kind = getResourceKind(resource);
      return `| ${getResourceKindLabel(kind, isJa)} | ${escapeMarkdownCell(resource.name)} | ${escapeMarkdownCell(resource.source || "")} | \`${escapeMarkdownCell(resource.path || "")}\` |`;
    })
    .join("\n");
}

function toDisplayPath(
  workspaceFolder: vscode.WorkspaceFolder,
  uri: vscode.Uri,
): string {
  const relative = vscode.workspace.asRelativePath(uri, false);
  if (relative && relative !== uri.fsPath) {
    return relative.replace(/\\/g, "/");
  }
  return uri.fsPath
    .replace(workspaceFolder.uri.fsPath, ".")
    .replace(/\\/g, "/");
}

function findIndexedResourceCandidates(
  resources: Skill[],
  resourceName: string,
  kind?: ResourceKind,
): { match?: Skill; candidates: Skill[]; reason?: string } {
  const query = resourceName.trim().toLowerCase();
  if (!query) {
    return { candidates: [], reason: "empty" };
  }

  const kindFiltered = resources.filter((resource) =>
    resourceMatchesKind(resource, kind),
  );
  const exactMatches = kindFiltered.filter(
    (resource) => resource.name.toLowerCase() === query,
  );
  if (exactMatches.length === 1) {
    return { match: exactMatches[0], candidates: exactMatches };
  }
  if (exactMatches.length > 1) {
    return { candidates: exactMatches, reason: "ambiguous" };
  }

  const partialMatches = kindFiltered.filter((resource) =>
    resource.name.toLowerCase().includes(query),
  );
  if (partialMatches.length === 1) {
    return { match: partialMatches[0], candidates: partialMatches };
  }
  return {
    candidates: partialMatches,
    reason: partialMatches.length > 1 ? "ambiguous" : "missing",
  };
}

/**
 * MCP ツールを登録
 */
function registerLanguageModelTool(
  context: vscode.ExtensionContext,
  name: string,
  createTool: () => vscode.LanguageModelTool<any>,
): void {
  context.subscriptions.push(vscode.lm.registerTool(name, createTool()));
}

/**
 * MCP ツールを登録
 */
export function registerMcpTools(context: vscode.ExtensionContext): void {
  extContext = context;

  // vscode.lm API が存在するか確認
  if (!vscode.lm || typeof vscode.lm.registerTool !== "function") {
    logger.info(
      "Agent Resources Ninja: vscode.lm.registerTool is not available (requires VS Code 1.99+)",
    );
    return;
  }

  try {
    // リソース検索ツール
    registerLanguageModelTool(context, "resourceNinja_search", () => {
      return new SkillSearchTool();
    });

    // リソースインストールツール
    registerLanguageModelTool(context, "resourceNinja_install", () => {
      return new SkillInstallTool();
    });

    // インストール済み一覧ツール
    registerLanguageModelTool(context, "resourceNinja_list", () => {
      return new SkillListTool();
    });

    // リソース推奨ツール
    registerLanguageModelTool(context, "resourceNinja_recommend", () => {
      return new SkillRecommendTool();
    });

    // リソースアンインストールツール
    registerLanguageModelTool(context, "resourceNinja_uninstall", () => {
      return new SkillUninstallTool();
    });

    // インデックス更新ツール
    registerLanguageModelTool(context, "resourceNinja_updateIndex", () => {
      return new UpdateIndexTool();
    });

    // GitHub 検索ツール
    registerLanguageModelTool(context, "resourceNinja_webSearch", () => {
      return new WebSearchTool();
    });

    // ソース追加ツール
    registerLanguageModelTool(context, "resourceNinja_addSource", () => {
      return new AddSourceTool();
    });

    // ソース削除ツール
    registerLanguageModelTool(context, "resourceNinja_removeSource", () => {
      return new RemoveSourceTool();
    });

    // リソース説明ローカライズツール
    registerLanguageModelTool(context, "resourceNinja_localize", () => {
      return new LocalizeSkillsTool();
    });

    logger.info("Agent Resources Ninja: MCP tools registered successfully");
  } catch (error) {
    logger.error("Agent Resources Ninja: Failed to register MCP tools:", error);
  }
}

/**
 * スキル検索ツール
 */
class SkillSearchTool implements vscode.LanguageModelTool<{
  query: string;
  kind?: string;
}> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<{
      query: string;
      kind?: string;
    }>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const query = options.input.query?.trim() || "";
    const kindFilter = normalizeKindFilter(options.input.kind);
    if (!query) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          localizeMcpText(
            "❌ Search query is required. Provide a resource name, category, or kind keyword.",
            "❌ 検索キーワードが必要です。リソース名、カテゴリ、種別キーワードを指定してください。",
          ),
        ),
      ]);
    }
    const index = await getSkillIndex();
    const skills = getIndexResources(index);
    const lowerQuery = query.toLowerCase();

    // インデックス更新情報を取得
    const updateInfo = getIndexUpdateInfo(index);
    const sourceStats = getSourceStats(index);

    // スキルをフィルタリング
    const results = skills
      .filter(
        (skill: Skill) =>
          resourceMatchesKind(skill, kindFilter) &&
          (skill.name.toLowerCase().includes(lowerQuery) ||
            getResourceKind(skill).includes(lowerQuery) ||
            skill.description?.toLowerCase().includes(lowerQuery) ||
            skill.categories?.some((cat: string) =>
              cat.toLowerCase().includes(lowerQuery),
            )),
      )
      .slice(0, 10);

    if (results.length === 0) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          localizeMcpText(
            `🔎 Searched ${sourceStats} (last updated: ${updateInfo.lastUpdated})
${updateInfo.warning}

No resources matched "${query}"${kindFilter ? ` (${getResourceKindLabel(kindFilter, false)})` : ""}.

Try another keyword, search GitHub directly, add a source, or update the index${updateInfo.isOutdated ? " (recommended)" : ""}.`,
            `🔎 ${sourceStats}から検索しました（最終更新: ${
              updateInfo.lastUpdated
            }）
${updateInfo.warning}

"${query}"${kindFilter ? ` (${getResourceKindLabel(kindFilter, isJapanese())})` : ""} に一致するリソースが見つかりませんでした。

---
**💡 リソースを見つけるには？**

| アクション | 説明 |
|-----------|------|
| 🔑 **キーワード変更** | 別のキーワードで再検索 |
| 🌐 **GitHub で検索** | インデックスにないリソースを GitHub から直接検索 |
| ➕ **ソースを追加** | 新しいリポジトリをインデックスに追加 |
| 🔄 **インデックス更新** | 登録済みソースから最新情報を取得${
              updateInfo.isOutdated ? " ⚠️ 推奨!" : ""
            } |

> 現在のインデックス: ${sourceStats}（最終更新: ${updateInfo.lastUpdated}）`,
          ),
        ),
      ]);
    }

    // 結果をフォーマット（信頼度バッジ付き）
    const isJa = isJapanese();
    const formatted = results
      .map((skill: Skill) => {
        const stars = skill.stars ? ` ⭐${skill.stars}` : "";
        const categories = skill.categories?.join(", ") || "";
        const trust = getTrustBadge(skill.source || "");
        const desc = getLocalizedDescription(skill, isJa);
        const kind = getResourceKind(skill);
        return `| ${getResourceKindLabel(kind, isJa)} | ${escapeMarkdownCell(skill.name)} | ${escapeMarkdownCell(
          desc || (isJa ? "説明なし" : "No description"),
        )} | ${escapeMarkdownCell(categories)} | ${trust} |${stars}`;
      })
      .join("\n");

    // 🌟 おすすめを選定（Official優先、stars順）
    const recommended = results.sort((a: Skill, b: Skill) => {
      const aOfficial = getTrustBadge(a.source || "").includes("Official")
        ? 1
        : 0;
      const bOfficial = getTrustBadge(b.source || "").includes("Official")
        ? 1
        : 0;
      if (aOfficial !== bOfficial) return bOfficial - aOfficial;
      return (b.stars || 0) - (a.stars || 0);
    })[0];

    const recommendSection = recommended
      ? `\n### 🌟 ${isJa ? "おすすめ" : "Recommended"}: ${recommended.name}\n${
          getLocalizedDescription(recommended, isJa) || ""
        } (${getTrustBadge(recommended.source || "")})\n`
      : "";

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
        localizeMcpText(
          `🔎 Searched ${sourceStats} (last updated: ${updateInfo.lastUpdated})
${updateInfo.warning}

Search results for "${query}"${kindFilter ? ` (${getResourceKindLabel(kindFilter, false)})` : ""}: ${results.length}

| Kind | Resource | Description | Categories | Trust |
|---|---|---|---|---|
${formatted}
${recommendSection}
Choose a resource to install, or search GitHub/add a source/update the index for more results.`,
          `🔎 ${sourceStats}から検索しました（最終更新: ${
            updateInfo.lastUpdated
          }）
${updateInfo.warning}

"${query}"${kindFilter ? ` (${getResourceKindLabel(kindFilter, isJa)})` : ""} の検索結果: ${results.length} 件

| Kind | Resource | Description | Categories | Trust |
|---|---|------------|------|-------|
${formatted}
${recommendSection}
---
**Agent Instructions (MUST FOLLOW):**
- Show the table above to user in a clean format
- Highlight the recommended resource
- Community resources: warn users to use at their own risk
- NEVER show commands to user - execute directly when approved
- ❌ **DO NOT automatically call other tools** - just show the suggestions below and wait for user's choice
${
  updateInfo.isOutdated
    ? "- ⚠️ Index is outdated! Strongly suggest updating."
    : ""
}

**📋 Next Actions (show to user, DO NOT auto-execute):**
1. 📦 **Install** → Ask which resource

---
**💡 もっとリソースを探すには？（ユーザーに提案のみ）**

| アクション | 説明 |
|-----------|------|
| 🌐 **GitHub で検索** | インデックスにないリソースを GitHub から直接検索できます |
| ➕ **ソースを追加** | 新しいリポジトリをインデックスに追加できます |
| 🔄 **インデックス更新** | 登録済みソースから最新情報を取得できます${
            updateInfo.isOutdated ? " ⚠️ 推奨!" : ""
          } |

> 現在のインデックス: ${sourceStats}（最終更新: ${updateInfo.lastUpdated}）`,
        ),
      ),
    ]);
  }
}

/**
 * スキルインストールツール
 */
class SkillInstallTool implements vscode.LanguageModelTool<{
  resourceName?: string;
  skillName?: string;
  kind?: string;
}> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<{
      resourceName?: string;
      skillName?: string;
      kind?: string;
    }>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const skillName = (
      options.input.resourceName ||
      options.input.skillName ||
      ""
    ).trim();
    const kindFilter = normalizeKindFilter(options.input.kind);
    if (!skillName) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          localizeMcpText(
            "❌ resourceName is required. Search first, then install an exact resource name.",
            "❌ resourceName が必要です。先に検索し、正確なリソース名を指定してインストールしてください。",
          ),
        ),
      ]);
    }
    const index = await getSkillIndex();
    const skills = getIndexResources(index);

    const matchResult = findIndexedResourceCandidates(
      skills,
      skillName,
      kindFilter,
    );
    const skill = matchResult.match;

    if (!skill) {
      const candidates = matchResult.candidates;
      if (candidates.length > 1) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            localizeMcpText(
              `⚠️ Multiple resources match "${skillName}". Retry with an exact resourceName${kindFilter ? "" : " or kind"}.\n\n| Kind | Resource | Source | Path |\n|---|---|---|---|\n${formatResourceCandidates(candidates, false)}`,
              `⚠️ リソース「${skillName}」に複数候補があります。正確なresourceName${kindFilter ? "" : "またはkind"}で再実行してください。\n\n| 種別 | リソース | Source | Path |\n|---|---|---|---|\n${formatResourceCandidates(candidates, true)}`,
            ),
          ),
        ]);
      }
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `❌ Resource "${skillName}" not found.

---
**📋 Next Actions:**
1. 🔍 Search first → use #searchResources to find available resources
2. Check spelling and try again`,
        ),
      ]);
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(mcpWorkspaceUnavailableMessage()),
      ]);
    }

    const context = requireExtContext();

    // インストール実行
    try {
      const installResult = await installSkill(
        skill,
        workspaceFolder.uri,
        context,
        // 対話ユーザーがいない経路なので復旧ダイアログは出さず、失敗は例外で返す。
        { suppressRecoveryPrompt: true },
      );
      const hookConfigSummary = formatHookConfigUpdateSummary(
        installResult.hookConfigUpdate,
      );
      const installErrorCount = installResult.errors?.length ?? 0;
      if (installErrorCount > 0) {
        await vscode.commands.executeCommand("resourceNinja.refresh");
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            localizeMcpText(
              `⚠️ Resource "${skill.name}" was only partially installed. ${installErrorCount} file(s) failed to download. Review the installed folder and retry the install.`,
              `⚠️ リソース「${skill.name}」は一部だけインストールされました。${installErrorCount}件のファイル取得に失敗しています。インストール先を確認して再実行してください。`,
            ),
          ),
        ]);
      }

      // インストラクションファイル (AGENTS.md) を更新（設定で有効な場合のみ）
      const config = vscode.workspace.getConfiguration("resourceNinja");
      const targetUri = getResourceTargetUri(
        workspaceFolder.uri,
        config,
        skill,
      );
      if (config.get<boolean>("autoUpdateInstruction")) {
        await updateInstructionFile(workspaceFolder.uri, context);
      }

      // ツリービューをリフレッシュ
      await vscode.commands.executeCommand("resourceNinja.refresh");

      const trust = getTrustBadge(skill.source || "");
      const isJa = isJapanese();
      const desc = getLocalizedDescription(skill, isJa);
      const kind = getResourceKind(skill);

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          localizeMcpText(
            `✅ Installed **${skill.name}**.

| Field | Value |
|---|---|
| Resource | ${escapeMarkdownCell(skill.name)} |
| Kind | ${getResourceKindLabel(kind, false)} |
| Description | ${escapeMarkdownCell(desc || "No description")} |
| Trust | ${trust} |
| Installed to | ${escapeMarkdownCell(toDisplayPath(workspaceFolder, targetUri))} |
${hookConfigSummary ? `| hooks.json | ${hookConfigSummary} |` : ""}

You can now view the installed file or list workspace resources.`,
            `✅ **${skill.name}** をインストールしました！

| 項目 | 内容 |
|-----------|------|
| Resource | ${escapeMarkdownCell(skill.name)} |
| Kind | ${getResourceKindLabel(kind, isJa)} |
| 説明 | ${escapeMarkdownCell(desc || (isJa ? "説明なし" : "No description"))} |
| 信頼度 | ${trust} |
| インストール先 | ${escapeMarkdownCell(toDisplayPath(workspaceFolder, targetUri))} |
${hookConfigSummary ? `| hooks.json | ${hookConfigSummary} |` : ""}

---
**Agent Instructions:**
- Report success with the table above
- If Community resource, add: "⚠️ コミュニティ製リソースは自己責任でご使用ください"

**📋 Next Actions (show to user):**
1. 📄 View installed resource file?
2. 📋 List workspace resources?

---
**💡 もっとリソースを探すには？**

| アクション | 説明 |
|-----------|------|
| 🔍 **ローカル検索** | インデックスからリソースを検索 |
| 🌐 **GitHub で検索** | インデックスにないリソースを GitHub から直接検索 |
| ➕ **ソースを追加** | 新しいリポジトリをインデックスに追加 |`,
          ),
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          formatMcpError(
            `❌ Failed to install "${skill.name}"`,
            `❌ "${skill.name}" のインストールに失敗しました`,
            error,
          ),
        ),
      ]);
    }
  }
}

/**
 * ワークスペースリソース一覧ツール
 */
class SkillListTool implements vscode.LanguageModelTool<Record<string, never>> {
  async invoke(
    _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(mcpWorkspaceUnavailableMessage()),
      ]);
    }

    const resources = (await scanLocalSkills(workspaceFolder.uri, true, true))
      .filter((resource) => !resource.isBuiltIn)
      .sort((a, b) =>
        `${a.kind || "skill"}:${a.name}`.localeCompare(
          `${b.kind || "skill"}:${b.name}`,
        ),
      );

    if (resources.length === 0) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `📭 No workspace resources found yet.

---
**How to find resources**

| Action | Description |
|--------|-------------|
| 🔍 Search | Search the bundled resource index |
| 💡 Recommend | Get project-based suggestions |
| 🌐 GitHub Search | Search GitHub directly |
| ➕ Add Source | Add another resource repository |
| 🔄 Update Index | Refresh configured sources |`,
        ),
      ]);
    }

    const visibleResources = resources.slice(0, 100);
    const list = visibleResources
      .map((resource, i) => {
        const kind = resource.kind || "skill";
        const marker = resource.incomplete ? `${INCOMPLETE_ROW_MARKER} ` : "";
        return `| ${i + 1} | ${getResourceKindLabel(kind, isJapanese())} | ${marker}${escapeMarkdownCell(resource.name)} | \`${escapeMarkdownCell(resource.relativePath)}\` |`;
      })
      .join("\n");
    const overflowNote =
      resources.length > visibleResources.length
        ? `\n\n_Showing first ${visibleResources.length} of ${resources.length} resources._`
        : "";

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
        `📦 Workspace Resources: ${resources.length}

| # | Kind | Name | Path |
|---|------|------|------|
${list}
${overflowNote}

---
**Agent Instructions:**
- Show the table in clean format
- Offer to open or preview any listed resource
- A name prefixed with \`${INCOMPLETE_ROW_MARKER}\` was never downloaded fully; do not rely on its contents and suggest reinstalling it

**📋 Next Actions (show to user):**
1. 📄 View details? → Ask which resource
2. 🗑️ Uninstall? → Confirm before deleting

---
**💡 Find more resources**

| Action | Description |
|--------|-------------|
| 🔍 Search | Search the bundled resource index |
| 🌐 GitHub Search | Search GitHub directly |
| ➕ Add Source | Add another resource repository |
| 🔄 Update Index | Refresh configured sources |`,
      ),
    ]);
  }
}

/**
 * スキル推奨ツール
 */
class SkillRecommendTool implements vscode.LanguageModelTool<
  Record<string, never>
> {
  async invoke(
    _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          localizeMcpText(
            "❌ No workspace open. Cannot analyze project.",
            "❌ ワークスペースが開かれていないため、プロジェクトを分析できません。",
          ),
        ),
      ]);
    }

    const index = await getSkillIndex();
    const skills = getIndexResources(index);
    const recommendations: { skill: Skill; reason: string }[] = [];

    // インデックス更新情報を取得
    const updateInfo = getIndexUpdateInfo(index);
    const sourceStats = getSourceStats(index);

    // ファイルパターンに基づく推奨
    const patterns: { glob: string; category: string; reason: string }[] = [
      { glob: "**/*.ts", category: "typescript", reason: "TypeScript project" },
      { glob: "**/package.json", category: "npm", reason: "Node.js project" },
      { glob: "**/*.py", category: "python", reason: "Python project" },
      { glob: "**/.github/**", category: "github", reason: "GitHub workflows" },
      { glob: "**/Dockerfile", category: "docker", reason: "Docker project" },
      { glob: "**/*.bicep", category: "azure", reason: "Azure Bicep files" },
      {
        glob: "**/azure-pipelines.yml",
        category: "azure",
        reason: "Azure DevOps",
      },
      { glob: "**/*.md", category: "markdown", reason: "Documentation files" },
    ];

    for (const pattern of patterns) {
      const files = await vscode.workspace.findFiles(
        pattern.glob,
        "**/node_modules/**",
        1,
      );
      if (files.length > 0) {
        const matchingSkills = skills.filter(
          (s: Skill) =>
            s.categories?.some((c: string) =>
              c.toLowerCase().includes(pattern.category),
            ) ||
            s.name.toLowerCase().includes(pattern.category) ||
            s.description?.toLowerCase().includes(pattern.category),
        );

        for (const skill of matchingSkills.slice(0, 2)) {
          if (!recommendations.find((r) => r.skill.name === skill.name)) {
            recommendations.push({ skill, reason: pattern.reason });
          }
        }
      }
    }

    if (recommendations.length === 0) {
      // 人気リソースを返す
      const popular = skills
        .filter((s: Skill) => s.stars && s.stars > 0)
        .sort((a: Skill, b: Skill) => (b.stars || 0) - (a.stars || 0))
        .slice(0, 5);

      const list = popular
        .map(
          (s: Skill) =>
            `| ${getResourceKindLabel(getResourceKind(s), isJapanese())} | ${escapeMarkdownCell(s.name)} | ${escapeMarkdownCell(s.description || "")} | ${getTrustBadge(
              s.source || "",
            )} | ${s.stars} |`,
        )
        .join("\n");

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          localizeMcpText(
            `🔎 Analyzed ${sourceStats} (last updated: ${updateInfo.lastUpdated}).
${updateInfo.warning}

No project-specific recommendation was found. Popular resources:

| Kind | Resource | Description | Trust | Stars |
|---|---|---|---|---|
${list}

Choose a resource to install, or search/update the index for more options.`,
            `🔎 ${sourceStats}から分析しました（最終更新: ${
              updateInfo.lastUpdated
            }）
${updateInfo.warning}

🤔 プロジェクト固有の推奨が見つかりませんでした。人気リソースはこちら:

| Kind | Resource | Description | Trust | Stars |
|---|---|------------|------|-------|
${list}

---
**📋 Next Actions (show to user):**
1. 📦 Install? → Ask which resource

---
**💡 もっとリソースを探すには？**

| アクション | 説明 |
|-----------|------|
| 🔍 **キーワード検索** | インデックスからリソースを検索 |
| 🌐 **GitHub で検索** | インデックスにないリソースを GitHub から直接検索 |
| ➕ **ソースを追加** | 新しいリポジトリをインデックスに追加 |
| 🔄 **インデックス更新** | 登録済みソースから最新情報を取得${
              updateInfo.isOutdated ? " ⚠️ 推奨!" : ""
            } |`,
          ),
        ),
      ]);
    }

    // 推奨をOfficial優先でソート
    recommendations.sort((a, b) => {
      const aOfficial = getTrustBadge(a.skill.source || "").includes("Official")
        ? 1
        : 0;
      const bOfficial = getTrustBadge(b.skill.source || "").includes("Official")
        ? 1
        : 0;
      return bOfficial - aOfficial;
    });

    const isJa = isJapanese();
    const list = recommendations
      .slice(0, 5)
      .map(
        (r) =>
          `| ${escapeMarkdownCell(r.skill.name)} | ${escapeMarkdownCell(
            getLocalizedDescription(r.skill, isJa) || "",
          )} | ${escapeMarkdownCell(r.reason)} | ${getTrustBadge(
            r.skill.source || "",
          )} |`,
      )
      .join("\n");

    const topRecommend = recommendations[0];

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
        localizeMcpText(
          `🔍 Analyzed ${sourceStats} (last updated: ${updateInfo.lastUpdated}).
${updateInfo.warning}

Project-based recommendations:

| Resource | Description | Reason | Trust |
|---|---|---|---|
${list}

### 🌟 Top recommendation: ${topRecommend.skill.name}
${getLocalizedDescription(topRecommend.skill, false) || ""}
Reason: ${topRecommend.reason} | ${getTrustBadge(topRecommend.skill.source || "")}

Choose a resource to install, or search/update the index for more options.`,
          `🔍 ${sourceStats}から分析しました（最終更新: ${
            updateInfo.lastUpdated
          }）
${updateInfo.warning}

💡 プロジェクト分析に基づく推奨リソース:

| Resource | Description | Reason | Trust |
|---|------------|------|-------|
${list}

### 🌟 イチオシ: ${topRecommend.skill.name}
${getLocalizedDescription(topRecommend.skill, isJa) || ""} 
理由: ${topRecommend.reason} | ${getTrustBadge(topRecommend.skill.source || "")}

---
**Agent Instructions:**
- Show the table and highlight the 🌟 recommendation
- Official resources (🏢) should be prioritized
- Ask user which to install
${updateInfo.isOutdated ? "- ⚠️ Index is outdated! Suggest updating." : ""}

**📋 Next Actions (show to user):**
1. 📦 Install? → Ask which resource, then use #installResource
2. 📋 List workspace resources?

---
**💡 もっとリソースを探すには？**

| アクション | 説明 |
|-----------|------|
| 🔍 **キーワード検索** | インデックスからリソースを検索 |
| 🌐 **GitHub で検索** | インデックスにないリソースを GitHub から直接検索 |
| ➕ **ソースを追加** | 新しいリポジトリをインデックスに追加 |
| 🔄 **インデックス更新** | 登録済みソースから最新情報を取得${
            updateInfo.isOutdated ? " ⚠️ 推奨!" : ""
          } |`,
        ),
      ),
    ]);
  }
}

/**
 * ワークスペースリソースアンインストールツール
 */
class SkillUninstallTool implements vscode.LanguageModelTool<{
  resourceName?: string;
  skillName?: string;
  kind?: string;
}> {
  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<{
      resourceName?: string;
      skillName?: string;
      kind?: string;
    }>,
  ): vscode.PreparedToolInvocation {
    const resourceName =
      options.input.resourceName || options.input.skillName || "resource";
    return {
      invocationMessage: localizeMcpText(
        `Removing workspace resource "${resourceName}"`,
        `workspaceリソース「${resourceName}」を削除中`,
      ),
      confirmationMessages: {
        title: localizeMcpText(
          "Remove workspace resource?",
          "workspaceリソースを削除しますか？",
        ),
        message: localizeMcpText(
          `The installed resource "${resourceName}" will be moved to the trash so it can be restored if needed.`,
          `インストール済みリソース「${resourceName}」をごみ箱へ移動します。必要な場合は復元できます。`,
        ),
      },
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<{
      resourceName?: string;
      skillName?: string;
      kind?: string;
    }>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const skillName = (
      options.input.resourceName ||
      options.input.skillName ||
      ""
    ).trim();
    const kindFilter = normalizeKindFilter(options.input.kind);
    if (!skillName) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          localizeMcpText(
            "❌ resourceName is required. List workspace resources first, then uninstall an exact resource name.",
            "❌ resourceName が必要です。先にワークスペースリソースを一覧し、正確なリソース名を指定してアンインストールしてください。",
          ),
        ),
      ]);
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(mcpWorkspaceUnavailableMessage()),
      ]);
    }

    // ワークスペースリソースを確認
    const workspaceResources = (
      await scanLocalSkills(workspaceFolder.uri, true, true)
    ).filter(
      (resource) =>
        !resource.isBuiltIn &&
        (!kindFilter || (resource.kind || "skill") === kindFilter),
    );
    const lowerName = skillName.toLowerCase();
    const exactResourceMatches = workspaceResources.filter(
      (resource) => resource.name.toLowerCase() === lowerName,
    );
    const partialResourceMatches = workspaceResources.filter((resource) =>
      resource.name.toLowerCase().includes(lowerName),
    );
    const resourceMatches =
      exactResourceMatches.length > 0
        ? exactResourceMatches
        : partialResourceMatches;

    if (resourceMatches.length > 1) {
      const candidates = resourceMatches
        .slice(0, 20)
        .map((resource) => {
          const kind = resource.kind || "skill";
          const marker = resource.incomplete ? `${INCOMPLETE_ROW_MARKER} ` : "";
          return `| ${getResourceKindLabel(kind, isJapanese())} | ${marker}${escapeMarkdownCell(resource.name)} | \`${escapeMarkdownCell(resource.relativePath)}\` |`;
        })
        .join("\n");

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          localizeMcpText(
            `⚠️ Multiple workspace resources match "${skillName}". Retry with a more specific name.\n\n| Kind | Name | Path |\n|---|---|---|\n${candidates}`,
            `⚠️ workspaceリソース「${skillName}」に複数候補があります。より具体的な名前で再実行してください。\n\n| 種別 | 名前 | Path |\n|---|---|---|\n${candidates}`,
          ),
        ),
      ]);
    }
    const matchedResource = resourceMatches[0];

    if (!matchedResource) {
      const installed = await getInstalledSkills(workspaceFolder.uri);
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          localizeMcpText(
            `❌ Resource "${skillName}" is not installed.

Installed resources: ${installed.length > 0 ? installed.join(", ") : "none"}

List workspace resources or search the index to find the exact resource name.`,
            `❌ リソース「${skillName}」はインストールされていません。

インストール済みリソース: ${installed.length > 0 ? installed.join(", ") : "なし"}

---
**📋 Next Actions:**
1. 📋 Check workspace resources → use #listResources

---
**💡 リソースを探すには？**

| アクション | 説明 |
|-----------|------|
| 🔍 **ローカル検索** | インデックスからリソースを検索 |
| 🌐 **GitHub で検索** | GitHub から直接検索 |`,
          ),
        ),
      ]);
    }

    // アンインストール実行
    try {
      const removedName = matchedResource.name;
      const removedKind = matchedResource.kind || "skill";

      let hookConfigSummary: string | undefined;
      const uninstallResult = await uninstallSkillByPath(
        matchedResource.relativePath,
        workspaceFolder.uri,
      );
      hookConfigSummary = formatHookConfigUpdateSummary(
        uninstallResult.hookConfigUpdate,
      );

      // インストラクションファイルを更新（設定で有効な場合のみ）
      const config = vscode.workspace.getConfiguration("resourceNinja");
      const instructionTarget = getConfiguredInstructionFilePath(config);
      if (
        removedKind === "skill" &&
        config.get<boolean>("autoUpdateInstruction")
      ) {
        await updateInstructionFile(workspaceFolder.uri, requireExtContext());
      }

      // ツリービューをリフレッシュ
      await vscode.commands.executeCommand("resourceNinja.refresh");

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          localizeMcpText(
            `✅ Uninstalled **${removedName}** and moved its files to the trash.

| Field | Value |
|---|---|
| Resource | ${escapeMarkdownCell(removedName)} |
| Kind | ${getResourceKindLabel(removedKind, false)} |
| Instruction file | ${removedKind === "skill" ? (instructionTarget === "none" ? "Disabled" : "Updated") : "Unchanged"} |
${hookConfigSummary ? `| hooks.json | ${hookConfigSummary} |` : ""}

You can list remaining resources or search for an alternative.`,
            `✅ **${removedName}** をアンインストールし、ファイルをごみ箱へ移動しました。

| 項目 | 内容 |
|-----------|------|
| Resource | ${escapeMarkdownCell(removedName)} |
| Kind | ${getResourceKindLabel(removedKind, isJapanese())} |
| ステータス | 削除完了 |
| Instruction File | ${removedKind === "skill" ? (instructionTarget === "none" ? "無効" : "更新済み") : "変更なし"} |
${hookConfigSummary ? `| hooks.json | ${hookConfigSummary} |` : ""}

---
**Agent Instructions:**
- Report success
- Remind user that the resource files have been removed

**📋 Next Actions:**
1. 📋 List remaining resources? → use #listResources

---
**💡 代替リソースを探すには？**

| アクション | 説明 |
|-----------|------|
| 🔍 **ローカル検索** | インデックスからリソースを検索 |
| 🌐 **GitHub で検索** | インデックスにないリソースを GitHub から直接検索 |
| ➕ **ソースを追加** | 新しいリポジトリをインデックスに追加 |`,
          ),
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          formatMcpError(
            `❌ Failed to uninstall "${matchedResource?.name || skillName}"`,
            `❌ "${matchedResource?.name || skillName}" のアンインストールに失敗しました`,
            error,
          ),
        ),
      ]);
    }
  }
}

/**
 * インデックス更新ツール
 */
class UpdateIndexTool implements vscode.LanguageModelTool<
  Record<string, never>
> {
  async invoke(
    _options: vscode.LanguageModelToolInvocationOptions<Record<string, never>>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    if (!extContext) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(mcpContextUnavailableMessage()),
      ]);
    }

    try {
      // 更新前の情報
      const oldIndex = await getSkillIndex();
      const oldCount = getIndexResources(oldIndex).length;
      const oldUpdated = oldIndex.lastUpdated || "unknown";

      // VS Code コマンドでインデックス更新を実行
      const updateResult = await vscode.commands.executeCommand<
        SourceIndexUpdateAllResult | undefined
      >("resourceNinja.updateIndex");
      if (!updateResult) {
        throw new Error("Index update did not return a result");
      }

      // キャッシュをクリアして新しいインデックスを読み込む
      cachedIndex = undefined;
      const newIndex = await getSkillIndex();
      cachedIndex = newIndex;

      const newCount = getIndexResources(newIndex).length;
      const newUpdated =
        newIndex.lastUpdated || new Date().toISOString().split("T")[0];
      // ソース統計
      const sourceStats = getSourceStats(newIndex);

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          formatSourceIndexUpdateToolResult(
            {
              oldCount,
              newCount,
              oldUpdated,
              newUpdated,
              sourceStats,
              totalSources: oldIndex.sources.length,
              succeededCount: updateResult.succeeded.length,
              failureCount: updateResult.failures.length,
              skippedCount: updateResult.skipped.length,
              failedSources: updateResult.failures.map(
                (failure) => failure.entry.name || failure.entry.id,
              ),
            },
            isJapanese() ? "ja" : "en",
          ),
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `${formatMcpError(
            "❌ Failed to update index",
            "❌ インデックス更新に失敗しました",
            error,
          )}

---
${githubAuthTroubleshootingText()}`,
        ),
      ]);
    }
  }
}

/**
 * GitHub 検索ツール
 */
class WebSearchTool implements vscode.LanguageModelTool<{ query: string }> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<{ query: string }>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const query = options.input.query;

    try {
      // GitHub トークンを取得（設定 / env / gh CLI）
      const token = await getGitHubToken();

      // GitHub で SKILL.md を検索
      const results = await searchGitHub(query, token);

      if (results.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            localizeMcpText(
              `🔍 No supported resources were found on GitHub for "${query}".

Try another keyword, search the local index, add a known source, or update the index.`,
              `🔍 GitHubで「${query}」を検索しましたが、対応リソースは見つかりませんでした。

---
**💡 リソースを見つけるには？**

| アクション | 説明 |
|-----------|------|
| 🔑 **キーワード変更** | 別のキーワードで再検索 |
| 🔍 **ローカル検索** | インデックスからリソースを検索 |
| ➕ **ソースを追加** | 既知のリポジトリをインデックスに追加 |
| 🔄 **インデックス更新** | 登録済みソースから最新情報を取得 |`,
            ),
          ),
        ]);
      }

      // 結果をフォーマット
      const formatted = results
        .slice(0, 10)
        .map((r, i) => {
          return `| ${i + 1} | [${r.repo}](${r.repoUrl}) | ${r.path} | ⭐${
            r.stars || 0
          } |`;
        })
        .join("\n");

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          localizeMcpText(
            `🌐 Found ${results.length} GitHub result(s) for "${query}".

| # | Repository | Path | Stars |
|---|---|---|---|
${formatted}

Add a repository as a source, update the index, then search locally to install a resource.`,
            `🌐 GitHubで「${query}」を検索しました（${results.length}件）

| # | Repository | Path | Stars |
|---|------------|------|-------|
${formatted}

---
**Agent Instructions:**
- Show the search results to user
- If user wants to add a repository, use #addSource

**📋 Next Actions:**
1. ➕ Add repository as source? → use #addSource with repo URL

---
**💡 リソースをインストールするには？**

| アクション | 説明 |
|-----------|------|
| ➕ **ソースを追加** | 上記リポジトリをインデックスに追加 |
| 🔄 **インデックス更新** | 追加後にインデックスを更新 |
| 🔍 **ローカル検索** | 追加後にリソースを検索してインストール |`,
          ),
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `${formatMcpError(
            "❌ GitHub search failed",
            "❌ GitHub検索に失敗しました",
            error,
          )}

---
${githubAuthTroubleshootingText()}`,
        ),
      ]);
    }
  }
}

/**
 * ソース追加ツール
 */
class AddSourceTool implements vscode.LanguageModelTool<{ repoUrl: string }> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<{ repoUrl: string }>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const repoUrl = options.input.repoUrl;

    if (!extContext) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(mcpContextUnavailableMessage()),
      ]);
    }

    try {
      // リポジトリ URL を正規化
      let normalizedUrl = repoUrl.trim();
      if (!normalizedUrl.startsWith("http")) {
        // owner/repo 形式の場合
        normalizedUrl = `https://github.com/${normalizedUrl}`;
      }
      const normalizedMatch = normalizedUrl.match(
        /^(https:\/\/github\.com\/[^/]+\/[^/]+)(?:\/(?:tree|blob)\/.*)?\/?$/i,
      );
      if (normalizedMatch) {
        normalizedUrl = normalizedMatch[1];
      }

      // 現在のインデックスを取得
      const currentIndex = await getSkillIndex();

      // ソースを追加
      const result = await addSource(extContext, currentIndex, normalizedUrl);

      // キャッシュを更新
      cachedIndex = result.index;

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          localizeMcpText(
            `✅ Added the repository as a source.

| Field | Value |
|---|---|
| Repository | ${normalizedUrl} |
| Resources added | ${result.addedSkills} |
| Status | Complete |

Search the new resources or install one from the updated index.`,
            `✅ リポジトリをソースに追加しました。

| 項目 | 内容 |
|-----------|------|
| リポジトリ | ${normalizedUrl} |
| 追加リソース数 | ${result.addedSkills} |
| ステータス | 追加完了 |

---
**Agent Instructions:**
- Report success
- The index has been updated with new resources

**📋 Next Actions:**
1. 🔍 Search for new resources? → use #searchResources
2. 📦 Install a resource? → use #installResource

---
**💡 次のステップ**

| アクション | 説明 |
|-----------|------|
| 🔍 **リソース検索** | 追加されたリソースを検索 |
| 💡 **おすすめ** | プロジェクトに合ったリソースを推奨 |
| 🌐 **GitHub で検索** | さらにリソースを探す |
| ➕ **ソースを追加** | 他のリポジトリも追加 |`,
          ),
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `${formatMcpError(
            "❌ Failed to add source",
            "❌ ソース追加に失敗しました",
            error,
          )}

---
${localizeMcpText(
  "Check the repository URL format (https://github.com/owner/repo or owner/repo) and confirm that it contains supported resource files.",
  "repository URL形式（https://github.com/owner/repo または owner/repo）と、対応resource fileが含まれることを確認してください。",
)}

${githubAuthTroubleshootingText()}`,
        ),
      ]);
    }
  }
}

function normalizeSourceLookupValue(value: string): string {
  return value
    .trim()
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function normalizeSourceLookupUrl(value: string): string {
  const trimmed = value
    .trim()
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
  if (/^[^/\s]+\/[^/\s]+$/.test(trimmed)) {
    return `https://github.com/${trimmed}`.toLowerCase();
  }
  const match = trimmed.match(
    /^(https:\/\/github\.com\/[^/]+\/[^/]+)(?:\/(?:tree|blob)\/.*)?$/i,
  );
  return (match ? match[1] : trimmed).toLowerCase();
}

function formatSourceCandidates(
  index: SkillIndex,
  sourceIds: string[],
): string {
  return sourceIds
    .map((sourceId) => {
      const source = getIndexSources(index).find(
        (candidate) => candidate.id === sourceId,
      );
      if (!source) {
        return undefined;
      }
      const count = getIndexResources(index).filter(
        (skill) => skill.source === source.id,
      ).length;
      return `| ${escapeMarkdownCell(source.id)} | ${escapeMarkdownCell(source.name)} | ${escapeMarkdownCell(source.url)} | ${count} |`;
    })
    .filter((line): line is string => !!line)
    .join("\n");
}

class RemoveSourceTool implements vscode.LanguageModelTool<{
  sourceIdOrName: string;
}> {
  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<{
      sourceIdOrName: string;
    }>,
  ): vscode.PreparedToolInvocation {
    const source = options.input.sourceIdOrName || "source";
    return {
      invocationMessage: localizeMcpText(
        `Removing source "${source}" from the index`,
        `source「${source}」をindexから削除中`,
      ),
      confirmationMessages: {
        title: localizeMcpText(
          "Remove source from the index?",
          "sourceをindexから削除しますか？",
        ),
        message: localizeMcpText(
          `Source "${source}" and its catalog entries will be removed from the index. Installed files will be kept.`,
          `source「${source}」とcatalog entryをindexから削除します。インストール済みファイルは保持します。`,
        ),
      },
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<{
      sourceIdOrName: string;
    }>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    if (!extContext) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(mcpContextUnavailableMessage()),
      ]);
    }

    const query = options.input.sourceIdOrName?.trim() || "";
    if (!query) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          localizeMcpText(
            "❌ sourceIdOrName is required. Provide a source id, source name, GitHub repository URL, or owner/repo.",
            "❌ sourceIdOrName が必要です。source id、source name、GitHub リポジトリ URL、または owner/repo を指定してください。",
          ),
        ),
      ]);
    }

    try {
      const currentIndex = await getSkillIndex();
      const sources = getIndexSources(currentIndex);
      const normalizedQuery = normalizeSourceLookupValue(query);
      const normalizedUrl = normalizeSourceLookupUrl(query);

      const exactId = sources.find(
        (source) => normalizeSourceLookupValue(source.id) === normalizedQuery,
      );
      const exactNameMatches = sources.filter(
        (source) => normalizeSourceLookupValue(source.name) === normalizedQuery,
      );
      const exactUrlMatches = sources.filter(
        (source) => normalizeSourceLookupUrl(source.url) === normalizedUrl,
      );

      const candidateIds = Array.from(
        new Set(
          [
            exactId?.id,
            ...exactNameMatches.map((source) => source.id),
            ...exactUrlMatches.map((source) => source.id),
          ].filter((sourceId): sourceId is string => !!sourceId),
        ),
      );

      if (candidateIds.length === 0) {
        const visibleSources = sources.slice(0, 20).map((source) => source.id);
        const table = formatSourceCandidates(currentIndex, visibleSources);
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `${localizeMcpText(`❌ Source not found: ${query}`, `❌ ソースが見つかりません: ${query}`)}\n\n| Source ID | Name | URL | Resources |\n|---|---|---|---|\n${table}`,
          ),
        ]);
      }

      if (candidateIds.length > 1) {
        const table = formatSourceCandidates(currentIndex, candidateIds);
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `${localizeMcpText(`⚠️ Multiple sources match "${query}". Use an exact source id.`, `⚠️ "${query}" に一致するソースが複数あります。正確な source id を指定してください。`)}\n\n| Source ID | Name | URL | Resources |\n|---|---|---|---|\n${table}`,
          ),
        ]);
      }

      const sourceId = candidateIds[0];
      const source = sources.find((candidate) => candidate.id === sourceId);
      const result = await removeSource(extContext, currentIndex, sourceId);
      cachedIndex = result.index;
      await vscode.commands.executeCommand("resourceNinja.refresh");

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          localizeMcpText(
            `✅ Removed the source from the index.\n\n| Field | Value |\n|---|---|\n| Source | ${escapeMarkdownCell(source?.name || sourceId)} |\n| Source ID | ${escapeMarkdownCell(sourceId)} |\n| Index entries removed | ${result.removedSkills} |\n| Installed files | Kept |\n\nInstalled workspace, user, and global files remain unchanged.`,
            `✅ リソースsourceをindexから削除しました。\n\n| 項目 | 内容 |\n|---|---|\n| Source | ${escapeMarkdownCell(source?.name || sourceId)} |\n| Source ID | ${escapeMarkdownCell(sourceId)} |\n| 削除したindex項目 | ${result.removedSkills} |\n| Installed files | 保持 |\n\nインストール済みのworkspace / user / globalファイルは残っています。`,
          ),
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          formatMcpError(
            "❌ Failed to remove source",
            "❌ ソース削除に失敗しました",
            error,
          ),
        ),
      ]);
    }
  }
}

/**
 * スキル説明ローカライズツール
 * AIエージェントがスキル説明を翻訳してインデックスに保存
 */
interface LocalizeInput {
  resourceName?: string;
  skillName?: string;
  description_en?: string;
  description_ja?: string;
}

class LocalizeSkillsTool implements vscode.LanguageModelTool<LocalizeInput> {
  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<LocalizeInput>,
    _token: vscode.CancellationToken,
  ): Promise<vscode.LanguageModelToolResult> {
    const { description_en, description_ja } = options.input;
    const skillName =
      options.input.resourceName || options.input.skillName || "";

    if (!skillName) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `${localizeMcpText(
            "❌ resourceName is required.",
            "❌ resourceName が必要です。",
          )}

Usage: Provide resourceName and at least one of description_en or description_ja.`,
        ),
      ]);
    }

    if (!description_en && !description_ja) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          localizeMcpText(
            "❌ At least one of description_en or description_ja is required.",
            "❌ description_en または description_ja の少なくとも一方が必要です。",
          ),
        ),
      ]);
    }

    try {
      const index = await getSkillIndex();
      const skill = getIndexResources(index).find(
        (s) => s.name.toLowerCase() === skillName.toLowerCase(),
      );

      if (!skill) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `❌ Resource "${skillName}" not found in index.

Try searching for the resource first with #searchResources.`,
          ),
        ]);
      }

      // 説明を更新
      let updated = false;
      if (description_en) {
        skill.description = description_en;
        updated = true;
      }
      if (description_ja) {
        skill.description_ja = description_ja;
        updated = true;
      }

      if (updated) {
        // インデックスを保存
        await saveSkillIndex(requireExtContext(), index);
        cachedIndex = index;
      }

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `✅ Resource "${skillName}" localized successfully!

| Field | Value |
|-------|-------|
| Resource | ${escapeMarkdownCell(skillName)} |
| English | ${skill.description || "(not set)"} |
| Japanese | ${skill.description_ja || "(not set)"} |

---
**Agent Instructions:**
- The resource description has been updated in the local index
- Changes will persist across sessions`,
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          formatMcpError(
            "❌ Failed to localize resource",
            "❌ リソース説明のローカライズに失敗しました",
            error,
          ),
        ),
      ]);
    }
  }
}
