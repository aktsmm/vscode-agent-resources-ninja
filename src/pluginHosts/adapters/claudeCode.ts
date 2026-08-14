import {
  PluginArtifact,
  PluginHostAdapter,
  PluginHostCapability,
  PluginInstallScope,
} from "../types";
import { isNativeInstallCandidate } from "../artifact";
import { PluginHostCommandRunner } from "../commandRunner";

export const CLAUDE_CODE_CAPABILITY: PluginHostCapability = {
  id: "claude-code",
  displayName: "Claude Code",
  supportLevel: "native",
  surfaces: ["vscode-extension", "cli"],
  actions: ["install", "list", "update", "enable", "disable", "uninstall"],
  scopes: ["user", "project", "local"],
  acceptedManifestKinds: ["claude-plugin"],
  extensionIds: ["anthropic.claude-code"],
  executableNames: ["claude"],
};

export type ClaudeCodeAvailability =
  | "native-ready"
  | "extension-handoff"
  | "cli-handoff"
  | "unavailable";

export function getClaudeCodeAvailability(input: {
  extensionDetected: boolean;
  executablePath?: string;
  nativeExecutionEnabled: boolean;
}): ClaudeCodeAvailability {
  if (input.executablePath && input.nativeExecutionEnabled) {
    return "native-ready";
  }
  if (input.extensionDetected) {
    return "extension-handoff";
  }
  if (input.executablePath) {
    return "cli-handoff";
  }
  return "unavailable";
}

export interface ClaudePluginState {
  id: string;
  name: string;
  marketplace?: string;
  scope?: PluginInstallScope;
  version?: string;
  enabled?: boolean;
}

export interface ClaudeMarketplaceState {
  name: string;
  source: string;
  repository?: string;
  path?: string;
}

export type ClaudePluginMutationResult =
  | { ok: true; marketplaceAdded?: boolean }
  | {
      ok: false;
      phase:
        | "marketplace-list"
        | "conflict"
        | "marketplace-add"
        | "mutation"
        | "verify";
      reason: string;
      cleanup?: "not-needed" | "removed" | "skipped" | "failed";
    };

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function parseClaudePluginListJson(
  content: string,
): ClaudePluginState[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  const values = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as Record<string, unknown>).plugins)
      ? ((parsed as Record<string, unknown>).plugins as unknown[])
      : undefined;
  if (!values) {
    return undefined;
  }
  const states: ClaudePluginState[] = [];
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const item = value as Record<string, unknown>;
    const explicitId = optionalString(item.id);
    const idParts = explicitId?.split("@", 2);
    const name = optionalString(item.name) ?? idParts?.[0];
    const marketplace = optionalString(item.marketplace) ?? idParts?.[1];
    const id =
      explicitId ?? (name && marketplace ? `${name}@${marketplace}` : name);
    if (!id || !name) {
      return undefined;
    }
    const scope = optionalString(item.scope);
    if (scope && scope !== "user" && scope !== "project" && scope !== "local") {
      return undefined;
    }
    states.push({
      id,
      name,
      marketplace,
      scope: scope as PluginInstallScope | undefined,
      version: optionalString(item.version),
      enabled: typeof item.enabled === "boolean" ? item.enabled : undefined,
    });
  }
  return states;
}

export function parseClaudeMarketplaceListJson(
  content: string,
): ClaudeMarketplaceState[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) {
    return undefined;
  }
  const states: ClaudeMarketplaceState[] = [];
  for (const value of parsed) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const item = value as Record<string, unknown>;
    const name = optionalString(item.name);
    const source = optionalString(item.source);
    if (!name || !source) {
      return undefined;
    }
    states.push({
      name,
      source,
      repository: optionalString(item.repo)?.toLowerCase(),
      path: optionalString(item.path),
    });
  }
  return states;
}

function commandSucceeded(result: {
  exitCode: number | null;
  error?: string;
  timedOut?: boolean;
}): boolean {
  return result.exitCode === 0 && !result.error && !result.timedOut;
}

function commandFailure(result: {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}): string {
  return (
    result.error ||
    result.stderr.trim() ||
    result.stdout.trim() ||
    `Claude Code exited with code ${String(result.exitCode)}`
  );
}

function marketplaceMatches(
  marketplace: ClaudeMarketplaceState | undefined,
  source: string,
): boolean {
  return marketplace?.source === "github"
    ? marketplace.repository?.toLowerCase() === source.toLowerCase()
    : marketplace?.path === source;
}

async function cleanupClaudeMarketplace(input: {
  runner: PluginHostCommandRunner;
  marketplaceName: string;
  marketplaceSource: string;
  scope: PluginInstallScope;
}): Promise<"removed" | "skipped" | "failed"> {
  const listResult = await input.runner.run([
    "plugin",
    "marketplace",
    "list",
    "--json",
  ]);
  const marketplaces = commandSucceeded(listResult)
    ? parseClaudeMarketplaceListJson(listResult.stdout)
    : undefined;
  const current = marketplaces?.find(
    (marketplace) => marketplace.name === input.marketplaceName,
  );
  if (!marketplaceMatches(current, input.marketplaceSource)) {
    return "skipped";
  }
  const removeResult = await input.runner.run([
    "plugin",
    "marketplace",
    "remove",
    input.marketplaceName,
    "--scope",
    input.scope,
  ]);
  return commandSucceeded(removeResult) ? "removed" : "failed";
}

export async function installClaudeCodePlugin(input: {
  runner: PluginHostCommandRunner;
  pluginName: string;
  marketplaceName: string;
  marketplaceSource: string;
  scope: PluginInstallScope;
}): Promise<ClaudePluginMutationResult> {
  const marketplaceList = await input.runner.run([
    "plugin",
    "marketplace",
    "list",
    "--json",
  ]);
  if (!commandSucceeded(marketplaceList)) {
    return {
      ok: false,
      phase: "marketplace-list",
      reason: commandFailure(marketplaceList),
    };
  }
  const marketplaces = parseClaudeMarketplaceListJson(marketplaceList.stdout);
  if (!marketplaces) {
    return {
      ok: false,
      phase: "marketplace-list",
      reason: "Claude Code marketplace JSON was not recognized.",
    };
  }
  const existing = marketplaces.find(
    (marketplace) => marketplace.name === input.marketplaceName,
  );
  if (existing && !marketplaceMatches(existing, input.marketplaceSource)) {
    return {
      ok: false,
      phase: "conflict",
      reason: `Marketplace ${input.marketplaceName} is registered from a different source.`,
    };
  }
  let marketplaceAdded = false;
  if (!existing) {
    const addResult = await input.runner.run([
      "plugin",
      "marketplace",
      "add",
      input.marketplaceSource,
      "--scope",
      input.scope,
    ]);
    if (!commandSucceeded(addResult)) {
      return {
        ok: false,
        phase: "marketplace-add",
        reason: commandFailure(addResult),
      };
    }
    marketplaceAdded = true;
  }
  const pluginId = `${input.pluginName}@${input.marketplaceName}`;
  const installResult = await input.runner.run([
    "plugin",
    "install",
    pluginId,
    "--scope",
    input.scope,
  ]);
  if (!commandSucceeded(installResult)) {
    const cleanup = marketplaceAdded
      ? await cleanupClaudeMarketplace(input)
      : "not-needed";
    return {
      ok: false,
      phase: "mutation",
      reason: commandFailure(installResult),
      cleanup,
    };
  }
  const listResult = await input.runner.run(["plugin", "list", "--json"]);
  const states = commandSucceeded(listResult)
    ? parseClaudePluginListJson(listResult.stdout)
    : undefined;
  if (!states?.some((state) => state.id === pluginId)) {
    const cleanup = marketplaceAdded
      ? await cleanupClaudeMarketplace(input)
      : "not-needed";
    return {
      ok: false,
      phase: "verify",
      reason: commandSucceeded(listResult)
        ? "Claude Code did not report the installed plugin."
        : commandFailure(listResult),
      cleanup,
    };
  }
  return { ok: true, marketplaceAdded };
}

export async function mutateClaudeCodePlugin(input: {
  runner: PluginHostCommandRunner;
  action: "update" | "enable" | "disable" | "uninstall";
  pluginId: string;
  marketplaceName: string;
  marketplaceSource: string;
  scope: PluginInstallScope;
}): Promise<ClaudePluginMutationResult> {
  const marketplaceList = await input.runner.run([
    "plugin",
    "marketplace",
    "list",
    "--json",
  ]);
  const marketplaces = commandSucceeded(marketplaceList)
    ? parseClaudeMarketplaceListJson(marketplaceList.stdout)
    : undefined;
  const marketplace = marketplaces?.find(
    (candidate) => candidate.name === input.marketplaceName,
  );
  if (!marketplaceMatches(marketplace, input.marketplaceSource)) {
    return {
      ok: false,
      phase: "conflict",
      reason: `Marketplace ${input.marketplaceName} is not registered from ${input.marketplaceSource}.`,
    };
  }
  const result = await input.runner.run([
    "plugin",
    input.action,
    input.pluginId,
    "--scope",
    input.scope,
  ]);
  return commandSucceeded(result)
    ? { ok: true }
    : { ok: false, phase: "mutation", reason: commandFailure(result) };
}

export interface ClaudePluginCommandPlan {
  readonlyCommands: readonly (readonly string[])[];
  mutations: readonly (readonly string[])[];
}

export function planClaudePluginInstall(input: {
  pluginId: string;
  marketplaceSource: string;
  marketplaceRegistered: boolean;
  scope: PluginInstallScope;
}): ClaudePluginCommandPlan {
  const mutations: string[][] = [];
  if (!input.marketplaceRegistered) {
    mutations.push(["plugin", "marketplace", "add", input.marketplaceSource]);
  }
  mutations.push(["plugin", "install", input.pluginId, "--scope", input.scope]);
  return {
    readonlyCommands: [["plugin", "list", "--json"]],
    mutations,
  };
}

export const claudeCodeAdapter: PluginHostAdapter = {
  capability: CLAUDE_CODE_CAPABILITY,
  supportsArtifact(artifact: PluginArtifact): boolean {
    return (
      isNativeInstallCandidate(artifact) &&
      artifact.manifestKind === "claude-plugin"
    );
  },
};
