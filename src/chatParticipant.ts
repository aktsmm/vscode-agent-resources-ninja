/**
 * GitHub Copilot Chat Participant - Agent Resources Ninja
 *
 * @resources commands for resource search, install, and recommendations.
 */
import * as vscode from "vscode";
import {
  Skill,
  loadSkillIndex,
  SkillIndex,
  getLocalizedDescription,
  getResourceKind,
  getResourceKindLabel,
} from "./skillIndex";
import { scanLocalSkills } from "./localSkillScanner";
import { isJapanese } from "./i18n";

/** Resource index cache. */
let cachedIndex: SkillIndex | undefined;
let indexContext: vscode.ExtensionContext | undefined;

function requireIndexContext(): vscode.ExtensionContext {
  if (!indexContext) {
    throw new Error("Extension context is not initialized");
  }
  return indexContext;
}

/** Get the resource index. */
async function getSkillIndex(): Promise<SkillIndex> {
  const context = requireIndexContext();
  if (!cachedIndex) {
    cachedIndex = await loadSkillIndex(context);
  }
  return cachedIndex;
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function chatText(en: string, ja: string): string {
  return isJapanese() ? ja : en;
}

function findChatInstallCandidates(
  resources: Skill[],
  resourceName: string,
): {
  match?: Skill;
  candidates: Skill[];
  reason?: "empty" | "ambiguous" | "missing";
} {
  const query = resourceName.trim().toLowerCase();
  if (!query) {
    return { candidates: [], reason: "empty" };
  }

  const exactMatches = resources.filter(
    (resource) => resource.name.toLowerCase() === query,
  );
  if (exactMatches.length === 1) {
    return { match: exactMatches[0], candidates: exactMatches };
  }
  if (exactMatches.length > 1) {
    return { candidates: exactMatches, reason: "ambiguous" };
  }

  const partialMatches = resources.filter((resource) =>
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

function renderResourceCandidateTable(
  resources: Skill[],
  isJa: boolean,
): string {
  const rows = resources
    .slice(0, 20)
    .map((resource) => {
      const kind = getResourceKind(resource);
      return `| ${getResourceKindLabel(kind, isJa)} | ${escapeMarkdownCell(resource.name)} | ${escapeMarkdownCell(resource.source || "")} | \`${escapeMarkdownCell(resource.path || "")}\` |`;
    })
    .join("\n");
  return `${chatText("| Kind | Resource | Source | Path |", "| 種別 | リソース | ソース | パス |")}\n|---|---|---|---|\n${rows}`;
}

/** Chat Participant request handler. */
export function createChatParticipant(
  context: vscode.ExtensionContext,
): vscode.ChatParticipant {
  indexContext = context;

  const participant = vscode.chat.createChatParticipant(
    "resources",
    handleChatRequest,
  );

  participant.iconPath = new vscode.ThemeIcon("zap");

  participant.followupProvider = {
    provideFollowups: () => {
      return [
        {
          prompt: "/search MCP server",
          label: `$(search) ${chatText("Search Resources", "リソースを検索")}`,
        },
        {
          prompt: "/list",
          label: `$(list-tree) ${chatText("List Workspace", "ワークスペース一覧")}`,
        },
        {
          prompt: "/recommend",
          label: `$(lightbulb) ${chatText("Recommend", "おすすめ")}`,
        },
      ];
    },
  };

  context.subscriptions.push(participant);
  return participant;
}

async function handleChatRequest(
  request: vscode.ChatRequest,
  _context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
  const command = request.command;
  const query = request.prompt.trim();

  try {
    switch (command) {
      case "search":
        return await handleSearch(query, stream, token);
      case "install":
        return await handleInstall(query, stream, token);
      case "list":
        return await handleList(stream);
      case "recommend":
        return await handleRecommend(stream, token);
      default:
        return await handleSmartQuery(query, stream, token);
    }
  } catch (error) {
    stream.markdown(
      `${chatText("Error", "エラー")}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { errorDetails: { message: String(error) } };
  }
}

async function handleSearch(
  query: string,
  stream: vscode.ChatResponseStream,
  _token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
  if (!query) {
    stream.markdown(
      chatText(
        "**Please provide a search query**\n\nExample: `/search MCP server` or `/search github tools`",
        "**検索キーワードを入力してください**\n\n例: `/search MCP server` または `/search github tools`",
      ),
    );
    return {};
  }

  const index = await getSkillIndex();
  const lowerQuery = query.toLowerCase();
  const results = index.skills
    .filter((resource: Skill) => {
      const kind = getResourceKind(resource);
      return (
        resource.name.toLowerCase().includes(lowerQuery) ||
        kind.includes(lowerQuery) ||
        resource.description?.toLowerCase().includes(lowerQuery) ||
        resource.categories?.some((category: string) =>
          category.toLowerCase().includes(lowerQuery),
        )
      );
    })
    .slice(0, 10);

  if (results.length === 0) {
    stream.markdown(
      chatText(
        `No resources found for "${query}"\n\nTry a different search term.`,
        `"${query}" に一致するリソースは見つかりませんでした。\n\n別のキーワードを試してください。`,
      ),
    );
    return {};
  }

  const isJa = isJapanese();
  stream.markdown(
    chatText(
      `## Found ${results.length} resource(s) for "${query}"\n\n`,
      `## "${query}" の検索結果: ${results.length} 件\n\n`,
    ),
  );

  for (const resource of results) {
    const kind = getResourceKind(resource);
    const stars = resource.stars ? ` Star ${resource.stars}` : "";
    const categories =
      resource.categories
        ?.map((category: string) => `\`${category}\``)
        .join(" ") || "";

    stream.markdown(
      `### $(package) ${getResourceKindLabel(kind, isJa)}: ${resource.name}${stars}\n`,
    );
    stream.markdown(
      `${getLocalizedDescription(resource, isJa) || chatText("No description", "説明なし")}\n`,
    );
    stream.markdown(
      `**${chatText("Source", "ソース")}:** ${resource.source} | ${categories}\n`,
    );
    if (resource.url) {
      stream.markdown(`[GitHub](${resource.url})\n\n`);
    }

    stream.button({
      command: "resourceNinja.install",
      arguments: [resource],
      title: `$(cloud-download) ${chatText("Install", "インストール")} ${resource.name}`,
    });
    stream.markdown("\n\n---\n\n");
  }

  return { metadata: { command: "search", resultsCount: results.length } };
}

async function handleInstall(
  query: string,
  stream: vscode.ChatResponseStream,
  _token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
  if (!query) {
    stream.markdown(
      chatText(
        "**Please provide a resource name to install**\n\nExample: `/install github-mcp`",
        "**インストールするリソース名を入力してください**\n\n例: `/install github-mcp`",
      ),
    );
    return {};
  }

  const index = await getSkillIndex();
  const matchResult = findChatInstallCandidates(index.skills, query);
  const resource = matchResult.match;

  if (!resource) {
    const isJa = isJapanese();
    if (matchResult.candidates.length > 1) {
      stream.markdown(
        `${chatText(
          `Multiple resources match "${query}". Please install with a more specific name.`,
          `"${query}" に一致するリソースが複数あります。より具体的な名前で指定してください。`,
        )}\n\n${renderResourceCandidateTable(matchResult.candidates, isJa)}`,
      );
      return {};
    }
    stream.markdown(
      chatText(
        `Resource "${query}" not found.\n\nUse \`/search ${query}\` to find available resources.`,
        `リソース "${query}" が見つかりません。\n\n\`/search ${query}\` で利用可能なリソースを探してください。`,
      ),
    );
    return {};
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    stream.markdown(
      chatText(
        "No workspace folder open. Please open a folder first.",
        "ワークスペースフォルダーが開かれていません。先にフォルダーを開いてください。",
      ),
    );
    return {};
  }

  const kind = getResourceKind(resource);
  const isJa = isJapanese();
  stream.markdown(
    chatText(
      `## Installing ${resource.name}\n\n`,
      `## ${resource.name} をインストール中\n\n`,
    ),
  );
  stream.markdown(
    `- **${chatText("Kind", "種別")}:** ${getResourceKindLabel(kind, isJa)}\n`,
  );
  stream.markdown(
    `- **${chatText("Source", "ソース")}:** ${resource.source}\n`,
  );
  if (resource.url) {
    stream.markdown(`- **URL:** ${resource.url}\n\n`);
  }

  stream.progress(chatText("Installing...", "インストール中..."));

  const installed = await vscode.commands.executeCommand<boolean>(
    "resourceNinja.install",
    resource,
  );

  if (!installed) {
    stream.markdown(
      chatText(
        "Install was cancelled or did not complete.",
        "インストールはキャンセルされたか、完了しませんでした。",
      ),
    );
    return {
      metadata: {
        command: "install",
        resource: resource.name,
        installed: false,
      },
    };
  }

  stream.markdown(
    chatText(
      `**${resource.name}** has been installed successfully.\n\n`,
      `**${resource.name}** をインストールしました。\n\n`,
    ),
  );
  stream.markdown(
    chatText(
      "Check the Workspace Resources or User / Global Resource Home view for the installed files.",
      "インストール済みファイルは Workspace Resources または User / Global Resource Home ビューで確認できます。",
    ),
  );

  return { metadata: { command: "install", resource: resource.name } };
}

async function handleList(
  stream: vscode.ChatResponseStream,
): Promise<vscode.ChatResult> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    stream.markdown(
      chatText(
        "No workspace folder open. Please open a folder first.",
        "ワークスペースフォルダーが開かれていません。先にフォルダーを開いてください。",
      ),
    );
    return {};
  }

  const resources = (await scanLocalSkills(workspaceFolder.uri, true, true))
    .filter((resource) => !resource.isBuiltIn)
    .sort((a, b) =>
      `${a.kind || "skill"}:${a.name}`.localeCompare(
        `${b.kind || "skill"}:${b.name}`,
      ),
    );

  if (resources.length === 0) {
    stream.markdown(
      chatText(
        "**No workspace resources found yet**\n\nUse `/search` to find resources or `/recommend` for suggestions.",
        "**ワークスペースリソースはまだありません**\n\n`/search` で探すか、`/recommend` でおすすめを確認してください。",
      ),
    );
    return {};
  }

  const isJa = isJapanese();
  stream.markdown(
    `## ${chatText("Workspace Resources", "ワークスペースリソース")} (${resources.length})\n\n`,
  );
  stream.markdown(
    `${chatText("| Kind | Name | Path |", "| 種別 | 名前 | パス |")}\n|---|---|---|\n`,
  );

  for (const resource of resources.slice(0, 100)) {
    const kind = resource.kind || "skill";
    stream.markdown(
      `| ${getResourceKindLabel(kind, isJa)} | ${escapeMarkdownCell(resource.name)} | \`${escapeMarkdownCell(resource.relativePath)}\` |\n`,
    );
  }

  if (resources.length > 100) {
    stream.markdown(
      `\n_Showing first 100 of ${resources.length} resources._\n`,
    );
  }

  return { metadata: { command: "list", count: resources.length } };
}

async function handleRecommend(
  stream: vscode.ChatResponseStream,
  _token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
  stream.markdown(
    `## ${chatText("Recommended Resources", "おすすめリソース")}\n\n`,
  );

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    stream.markdown(
      chatText(
        "No workspace open. Here are some popular resources:\n\n",
        "ワークスペースが開かれていません。人気リソースを表示します。\n\n",
      ),
    );
    return await showPopularResources(stream);
  }

  const recommendations: { resource: Skill; reason: string }[] = [];
  const patterns: { glob: string; category: string; reason: string }[] = [
    {
      glob: "**/*.ts",
      category: "typescript",
      reason: "TypeScript files detected",
    },
    {
      glob: "**/package.json",
      category: "npm",
      reason: "Node.js project detected",
    },
    { glob: "**/*.py", category: "python", reason: "Python files detected" },
    {
      glob: "**/.github/**",
      category: "github",
      reason: "GitHub workflow detected",
    },
    {
      glob: "**/Dockerfile",
      category: "docker",
      reason: "Docker configuration detected",
    },
  ];

  const index = await getSkillIndex();
  for (const pattern of patterns) {
    const files = await vscode.workspace.findFiles(
      pattern.glob,
      "**/node_modules/**",
      1,
    );
    if (files.length === 0) {
      continue;
    }

    const matchingResources = index.skills.filter(
      (resource: Skill) =>
        resource.categories?.some((category: string) =>
          category.toLowerCase().includes(pattern.category),
        ) ||
        resource.name.toLowerCase().includes(pattern.category) ||
        resource.description?.toLowerCase().includes(pattern.category),
    );

    for (const resource of matchingResources.slice(0, 2)) {
      if (
        !recommendations.find((item) => item.resource.name === resource.name)
      ) {
        recommendations.push({ resource, reason: pattern.reason });
      }
    }
  }

  if (recommendations.length === 0) {
    stream.markdown(
      chatText(
        "No specific recommendations based on your project.\n\n",
        "プロジェクト固有のおすすめは見つかりませんでした。\n\n",
      ),
    );
    return await showPopularResources(stream);
  }

  for (const recommendation of recommendations.slice(0, 5)) {
    const resource = recommendation.resource;
    const kind = getResourceKind(resource);
    stream.markdown(
      `### $(lightbulb) ${getResourceKindLabel(kind, isJapanese())}: ${resource.name}\n`,
    );
    stream.markdown(`*${recommendation.reason}*\n\n`);
    stream.markdown(
      `${getLocalizedDescription(resource, isJapanese()) || chatText("No description", "説明なし")}\n\n`,
    );

    stream.button({
      command: "resourceNinja.install",
      arguments: [resource],
      title: `$(cloud-download) ${chatText("Install", "インストール")}`,
    });
    stream.markdown("\n\n");
  }

  return { metadata: { command: "recommend", count: recommendations.length } };
}

async function showPopularResources(
  stream: vscode.ChatResponseStream,
): Promise<vscode.ChatResult> {
  const index = await getSkillIndex();
  const popular = index.skills
    .filter((resource: Skill) => resource.stars && resource.stars > 0)
    .sort((a: Skill, b: Skill) => (b.stars || 0) - (a.stars || 0))
    .slice(0, 5);

  const isJa = isJapanese();
  stream.markdown(`### ${chatText("Popular Resources", "人気リソース")}\n\n`);

  for (const resource of popular) {
    const kind = getResourceKind(resource);
    stream.markdown(
      `- **${getResourceKindLabel(kind, isJa)}: ${resource.name}** ${chatText("Star", "スター")} ${resource.stars} - ${getLocalizedDescription(resource, isJa) || chatText("No description", "説明なし")}\n`,
    );
  }

  return {};
}

async function handleSmartQuery(
  query: string,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken,
): Promise<vscode.ChatResult> {
  if (!query) {
    stream.markdown("# Agent Resources Ninja\n\n");
    stream.markdown(
      chatText(
        "I can help you find and manage agent resources for GitHub Copilot.\n\n",
        "GitHub Copilot 向けのエージェントリソースを探したり管理したりできます。\n\n",
      ),
    );
    stream.markdown(`## ${chatText("Commands", "コマンド")}\n\n`);
    stream.markdown(
      `- \`/search <query>\` - ${chatText("Search for resources", "リソースを検索")}\n`,
    );
    stream.markdown(
      `- \`/install <name>\` - ${chatText("Install a resource", "リソースをインストール")}\n`,
    );
    stream.markdown(
      `- \`/list\` - ${chatText("List workspace resources", "ワークスペースリソースを一覧表示")}\n`,
    );
    stream.markdown(
      `- \`/recommend\` - ${chatText("Get resource recommendations", "おすすめリソースを表示")}\n\n`,
    );
    stream.markdown(
      chatText(
        "Or just describe what you need, and I'll find relevant resources.\n",
        "必要なものを自然文で説明しても、関連リソースを探します。\n",
      ),
    );
    return {};
  }

  return await handleSearch(query, stream, token);
}
