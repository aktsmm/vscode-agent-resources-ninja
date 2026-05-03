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
import { updateInstructionFile } from "./instructionManager";
import { getConfiguredInstructionFilePath } from "./customizationPaths";
import { searchGitHub, addSource } from "./indexUpdater";
import { isJapanese } from "./i18n";
import { getGitHubToken } from "./githubAuth";
import { logger } from "./logger";
import { scanLocalSkills } from "./localSkillScanner";

/** スキルインデックスをキャッシュ */
let cachedIndex: SkillIndex | undefined;
let extContext: vscode.ExtensionContext | undefined;

function requireExtContext(): vscode.ExtensionContext {
  if (!extContext) {
    throw new Error("Extension context is not initialized");
  }
  return extContext;
}

/** スキルインデックスを取得 */
async function getSkillIndex(): Promise<SkillIndex> {
  const context = requireExtContext();
  if (!cachedIndex) {
    cachedIndex = await loadSkillIndex(context);
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
    ? `⚠️ **インデックスが古くなっています！** (${daysOld}日前)`
    : "";

  return { lastUpdated, daysOld, isOutdated, warning };
}

/**
 * ソース統計を取得
 */
function getSourceStats(index: SkillIndex): string {
  const sourceCount = index.sources?.length || 0;
  const skillCount = index.skills?.length || 0;
  return `${sourceCount} リポジトリ、${skillCount} リソース`;
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
    normalized === "mcp"
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
          `❌ Search query is required. Provide a resource name, category, or kind keyword.`,
        ),
      ]);
    }
    const index = await getSkillIndex();
    const skills = index.skills;
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
        new vscode.LanguageModelTextPart(`🔎 ${sourceStats}から検索しました（最終更新: ${
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

> 現在のインデックス: ${sourceStats}（最終更新: ${updateInfo.lastUpdated}）`),
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
        return `| ${getResourceKindLabel(kind, isJa)} | ${skill.name} | ${
          desc || (isJa ? "説明なし" : "No description")
        } | ${categories} | ${trust} |${stars}`;
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
      ? `\n### 🌟 おすすめ: ${recommended.name}\n${
          getLocalizedDescription(recommended, isJa) || ""
        } (${getTrustBadge(recommended.source || "")})\n`
      : "";

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
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
          `❌ resourceName is required. Search first, then install an exact resource name.`,
        ),
      ]);
    }
    const index = await getSkillIndex();
    const skills = index.skills;

    const matchResult = findIndexedResourceCandidates(
      skills,
      skillName,
      kindFilter,
    );
    const skill = matchResult.match;

    if (!skill) {
      const candidates = matchResult.candidates;
      const isJa = isJapanese();
      if (candidates.length > 1) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `⚠️ Multiple resources match "${skillName}". Retry with an exact resourceName${kindFilter ? "" : " or kind"}.\n\n| Kind | Resource | Source | Path |\n|------|----------|--------|------|\n${formatResourceCandidates(candidates, isJa)}`,
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
        new vscode.LanguageModelTextPart(
          `❌ No workspace folder open. Please open a folder first.`,
        ),
      ]);
    }

    const context = requireExtContext();

    // インストール実行
    try {
      const installResult = await installSkill(
        skill,
        workspaceFolder.uri,
        context,
      );
      const hookConfigSummary = formatHookConfigUpdateSummary(
        installResult.hookConfigUpdate,
      );

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
          `✅ **${skill.name}** をインストールしました！

| 項目 | 内容 |
|-----------|------|
| Resource | ${skill.name} |
| Kind | ${getResourceKindLabel(kind, isJa)} |
| 説明 | ${desc || (isJa ? "説明なし" : "No description")} |
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
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `❌ Failed to install "${skill.name}": ${error}`,
        ),
      ]);
    }
  }
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
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
        new vscode.LanguageModelTextPart("❌ No workspace folder open."),
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
        return `| ${i + 1} | ${getResourceKindLabel(kind, false)} | ${escapeMarkdownCell(resource.name)} | \`${escapeMarkdownCell(resource.relativePath)}\` |`;
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
          "❌ No workspace open. Cannot analyze project.",
        ),
      ]);
    }

    const index = await getSkillIndex();
    const skills = index.skills;
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
            `| ${getResourceKindLabel(getResourceKind(s), false)} | ${s.name} | ${s.description || ""} | ${getTrustBadge(
              s.source || "",
            )} | ${s.stars} |`,
        )
        .join("\n");

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
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
          `| ${r.skill.name} | ${
            getLocalizedDescription(r.skill, isJa) || ""
          } | ${r.reason} | ${getTrustBadge(r.skill.source || "")} |`,
      )
      .join("\n");

    const topRecommend = recommendations[0];

    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(
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
          `❌ resourceName is required. List workspace resources first, then uninstall an exact resource name.`,
        ),
      ]);
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `❌ No workspace folder open. Please open a folder first.`,
        ),
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
          return `| ${getResourceKindLabel(kind, false)} | ${escapeMarkdownCell(resource.name)} | \`${escapeMarkdownCell(resource.relativePath)}\` |`;
        })
        .join("\n");

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `⚠️ Multiple workspace resources match "${skillName}". Please retry with a more specific name.\n\n| Kind | Name | Path |\n|------|------|------|\n${candidates}`,
        ),
      ]);
    }
    const matchedResource = resourceMatches[0];

    if (!matchedResource) {
      const installed = await getInstalledSkills(workspaceFolder.uri);
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `❌ Resource "${skillName}" is not installed.

Installed skills: ${installed.length > 0 ? installed.join(", ") : "none"}

---
**📋 Next Actions:**
1. 📋 Check workspace resources → use #listResources

---
**💡 スキルを探すには？**

| アクション | 説明 |
|-----------|------|
| 🔍 **ローカル検索** | インデックスからスキルを検索 |
| 🌐 **GitHub で検索** | GitHub から直接検索 |`,
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
          `✅ **${removedName}** をアンインストールしました！

| 項目 | 内容 |
|-----------|------|
| Resource | ${removedName} |
| Kind | ${getResourceKindLabel(removedKind, false)} |
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
| 🔍 **ローカル検索** | インデックスからスキルを検索 |
| 🌐 **GitHub で検索** | インデックスにないスキルを GitHub から直接検索 |
| ➕ **ソースを追加** | 新しいリポジトリをインデックスに追加 |`,
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `❌ Failed to uninstall "${matchedResource?.name || skillName}": ${error}`,
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
        new vscode.LanguageModelTextPart(`❌ Extension context not available.`),
      ]);
    }

    try {
      // 更新前の情報
      const oldIndex = await getSkillIndex();
      const oldCount = oldIndex.skills.length;
      const oldUpdated = oldIndex.lastUpdated || "unknown";

      // VS Code コマンドでインデックス更新を実行
      await vscode.commands.executeCommand("resourceNinja.updateIndex");

      // キャッシュをクリアして新しいインデックスを読み込む
      cachedIndex = undefined;
      const newIndex = await loadSkillIndex(extContext);
      cachedIndex = newIndex;

      const newCount = newIndex.skills.length;
      const newUpdated =
        newIndex.lastUpdated || new Date().toISOString().split("T")[0];
      const diff = newCount - oldCount;
      const diffText = diff > 0 ? `+${diff}` : diff === 0 ? "±0" : `${diff}`;

      // ソース統計
      const sourceStats = getSourceStats(newIndex);

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `✅ スキルインデックスを更新しました！

| 項目 | Before | After |
          |-----------|--------|-------|
| スキル数 | ${oldCount} | ${newCount} (${diffText}) |
| 最終更新 | ${oldUpdated} | ${newUpdated} |
| ソース | - | ${sourceStats} |

---
**Agent Instructions:**
- Report the update summary
- If new resources were added, suggest searching for them

**📋 Next Actions:**
1. 🔍 Search for new resources? → use #searchResources
2. 💡 Get recommendations? → use #recommendResources
3. 📋 List workspace resources? → use #listResources

---
**💡 さらにリソースを増やすには？**

| アクション | 説明 |
|-----------|------|
| 🌐 **GitHub で検索** | インデックスにないスキルを GitHub から直接検索 |
| ➕ **ソースを追加** | 新しいリポジトリをインデックスに追加 |`,
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `❌ Failed to update index: ${error}

---
**📋 Troubleshooting:**
1. Check internet connection
2. GitHub API rate limit may be exceeded
3. Try setting a GitHub token in settings`,
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
            `🔍 GitHub で "${query}" を検索しましたが、SKILL.md は見つかりませんでした。

---
**� スキルを見つけるには？**

| アクション | 説明 |
|-----------|------|
| 🔑 **キーワード変更** | 別のキーワードで再検索 |
| 🔍 **ローカル検索** | インデックスからスキルを検索 |
| ➕ **ソースを追加** | 既知のリポジトリをインデックスに追加 |
| 🔄 **インデックス更新** | 登録済みソースから最新情報を取得 |`,
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
          `🌐 GitHub で "${query}" を検索しました（${results.length} 件）

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
**💡 スキルをインストールするには？**

| アクション | 説明 |
|-----------|------|
| ➕ **ソースを追加** | 上記リポジトリをインデックスに追加 |
| 🔄 **インデックス更新** | 追加後にインデックスを更新 |
| 🔍 **ローカル検索** | 追加後にスキルを検索してインストール |`,
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `❌ GitHub search failed: ${error}

---
**📋 Troubleshooting:**
1. Check internet connection
2. GitHub API rate limit may be exceeded (60 req/hour without token)
3. Set GitHub token in settings for higher limits`,
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
        new vscode.LanguageModelTextPart(`❌ Extension context not available.`),
      ]);
    }

    try {
      // リポジトリ URL を正規化
      let normalizedUrl = repoUrl.trim();
      if (!normalizedUrl.startsWith("http")) {
        // owner/repo 形式の場合
        normalizedUrl = `https://github.com/${normalizedUrl}`;
      }

      // 現在のインデックスを取得
      const currentIndex = await getSkillIndex();

      // ソースを追加
      const result = await addSource(extContext, currentIndex, normalizedUrl);

      // キャッシュを更新
      cachedIndex = result.index;

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `✅ リポジトリをソースに追加しました！

| 項目 | 内容 |
|-----------|------|
| リポジトリ | ${normalizedUrl} |
| 追加スキル数 | ${result.addedSkills} |
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
| 🔍 **スキル検索** | 追加されたスキルを検索 |
| 💡 **おすすめ** | プロジェクトに合ったスキルを推奨 |
| 🌐 **GitHub で検索** | さらにスキルを探す |
| ➕ **ソースを追加** | 他のリポジトリも追加 |`,
        ),
      ]);
    } catch (error) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `❌ Failed to add source: ${error}

---
**📋 Troubleshooting:**
1. Check the repository URL format (https://github.com/owner/repo or owner/repo)
2. Repository must be public
3. Repository should contain SKILL.md files
4. GitHub API rate limit may be exceeded`,
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
          `❌ resourceName is required.

Usage: Provide resourceName and at least one of description_en or description_ja.`,
        ),
      ]);
    }

    if (!description_en && !description_ja) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `❌ At least one of description_en or description_ja is required.`,
        ),
      ]);
    }

    try {
      const index = await getSkillIndex();
      const skill = index.skills.find(
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
| Resource | ${skillName} |
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
          `❌ Failed to localize skill: ${error}`,
        ),
      ]);
    }
  }
}
