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
  getResourceKind,
  getResourceKindLabel,
} from "./skillIndex";
import { scanLocalSkills } from "./localSkillScanner";

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

function renderResourceCandidateTable(resources: Skill[]): string {
  const rows = resources
    .slice(0, 20)
    .map((resource) => {
      const kind = getResourceKind(resource);
      return `| ${getResourceKindLabel(kind, false)} | ${escapeMarkdownCell(resource.name)} | ${escapeMarkdownCell(resource.source || "")} | \`${escapeMarkdownCell(resource.path || "")}\` |`;
    })
    .join("\n");
  return `| Kind | Resource | Source | Path |\n|---|---|---|---|\n${rows}`;
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
        { prompt: "/search MCP server", label: "$(search) Search Resources" },
        { prompt: "/list", label: "$(list-tree) List Workspace" },
        { prompt: "/recommend", label: "$(lightbulb) Recommend" },
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
      `Error: ${error instanceof Error ? error.message : String(error)}`,
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
      "**Please provide a search query**\n\nExample: `/search MCP server` or `/search github tools`",
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
      `No resources found for "${query}"\n\nTry a different search term.`,
    );
    return {};
  }

  stream.markdown(`## Found ${results.length} resource(s) for "${query}"\n\n`);

  for (const resource of results) {
    const kind = getResourceKind(resource);
    const stars = resource.stars ? ` Star ${resource.stars}` : "";
    const categories =
      resource.categories
        ?.map((category: string) => `\`${category}\``)
        .join(" ") || "";

    stream.markdown(
      `### $(package) ${getResourceKindLabel(kind, false)}: ${resource.name}${stars}\n`,
    );
    stream.markdown(`${resource.description || "No description"}\n`);
    stream.markdown(`**Source:** ${resource.source} | ${categories}\n`);
    if (resource.url) {
      stream.markdown(`[GitHub](${resource.url})\n\n`);
    }

    stream.button({
      command: "resourceNinja.install",
      arguments: [resource],
      title: `$(cloud-download) Install ${resource.name}`,
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
      "**Please provide a resource name to install**\n\nExample: `/install github-mcp`",
    );
    return {};
  }

  const index = await getSkillIndex();
  const matchResult = findChatInstallCandidates(index.skills, query);
  const resource = matchResult.match;

  if (!resource) {
    if (matchResult.candidates.length > 1) {
      stream.markdown(
        `Multiple resources match "${query}". Please install with a more specific name.\n\n${renderResourceCandidateTable(matchResult.candidates)}`,
      );
      return {};
    }
    stream.markdown(
      `Resource "${query}" not found.\n\nUse \`/search ${query}\` to find available resources.`,
    );
    return {};
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    stream.markdown("No workspace folder open. Please open a folder first.");
    return {};
  }

  const kind = getResourceKind(resource);
  stream.markdown(`## Installing ${resource.name}\n\n`);
  stream.markdown(`- **Kind:** ${getResourceKindLabel(kind, false)}\n`);
  stream.markdown(`- **Source:** ${resource.source}\n`);
  if (resource.url) {
    stream.markdown(`- **URL:** ${resource.url}\n\n`);
  }

  stream.progress("Installing...");

  const installed = await vscode.commands.executeCommand<boolean>(
    "resourceNinja.install",
    resource,
  );

  if (!installed) {
    stream.markdown("Install was cancelled or did not complete.");
    return {
      metadata: {
        command: "install",
        resource: resource.name,
        installed: false,
      },
    };
  }

  stream.markdown(`**${resource.name}** has been installed successfully.\n\n`);
  stream.markdown(
    "Check the Workspace Resources or User / Global Resource Home view for the installed files.",
  );

  return { metadata: { command: "install", resource: resource.name } };
}

async function handleList(
  stream: vscode.ChatResponseStream,
): Promise<vscode.ChatResult> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    stream.markdown("No workspace folder open. Please open a folder first.");
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
      "**No workspace resources found yet**\n\nUse `/search` to find resources or `/recommend` for suggestions.",
    );
    return {};
  }

  stream.markdown(`## Workspace Resources (${resources.length})\n\n`);
  stream.markdown("| Kind | Name | Path |\n|---|---|---|\n");

  for (const resource of resources.slice(0, 100)) {
    const kind = resource.kind || "skill";
    stream.markdown(
      `| ${getResourceKindLabel(kind, false)} | ${escapeMarkdownCell(resource.name)} | \`${escapeMarkdownCell(resource.relativePath)}\` |\n`,
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
  stream.markdown("## Recommended Resources\n\n");

  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    stream.markdown("No workspace open. Here are some popular resources:\n\n");
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
    stream.markdown("No specific recommendations based on your project.\n\n");
    return await showPopularResources(stream);
  }

  for (const recommendation of recommendations.slice(0, 5)) {
    const resource = recommendation.resource;
    const kind = getResourceKind(resource);
    stream.markdown(
      `### $(lightbulb) ${getResourceKindLabel(kind, false)}: ${resource.name}\n`,
    );
    stream.markdown(`*${recommendation.reason}*\n\n`);
    stream.markdown(`${resource.description || "No description"}\n\n`);

    stream.button({
      command: "resourceNinja.install",
      arguments: [resource],
      title: "$(cloud-download) Install",
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

  stream.markdown("### Popular Resources\n\n");

  for (const resource of popular) {
    const kind = getResourceKind(resource);
    stream.markdown(
      `- **${getResourceKindLabel(kind, false)}: ${resource.name}** Star ${resource.stars} - ${resource.description || "No description"}\n`,
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
      "I can help you find and manage agent resources for GitHub Copilot.\n\n",
    );
    stream.markdown("## Commands\n\n");
    stream.markdown("- `/search <query>` - Search for resources\n");
    stream.markdown("- `/install <name>` - Install a resource\n");
    stream.markdown("- `/list` - List workspace resources\n");
    stream.markdown("- `/recommend` - Get resource recommendations\n\n");
    stream.markdown(
      "Or just describe what you need, and I'll find relevant resources.\n",
    );
    return {};
  }

  return await handleSearch(query, stream, token);
}
