import {
  PluginArtifact,
  PluginHostAdapter,
  PluginHostCapability,
} from "../types";
import { isNativeInstallCandidate } from "../artifact";
import { PluginHostCommandRunner } from "../commandRunner";
import * as path from "path";

export const CODEX_CAPABILITY: PluginHostCapability = {
  id: "codex",
  displayName: "Codex",
  supportLevel: "native",
  surfaces: ["vscode-extension", "cli", "desktop"],
  actions: ["install", "list", "uninstall", "marketplace-manage"],
  scopes: ["user"],
  acceptedManifestKinds: ["codex-plugin"],
  extensionIds: ["openai.chatgpt"],
  executableNames: ["codex"],
};

export type CodexAvailability =
  | "native-ready"
  | "extension-handoff"
  | "cli-handoff"
  | "unavailable";

export function getCodexAvailability(input: {
  extensionDetected: boolean;
  executablePath?: string;
  nativeExecutionEnabled?: boolean;
}): CodexAvailability {
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

export interface CodexMarketplaceState {
  name: string;
  root: string;
  sourceType?: string;
  source?: string;
}

export interface CodexPluginState {
  pluginId: string;
  name: string;
  marketplaceName: string;
  version?: string;
  installed?: boolean;
  enabled?: boolean;
}

export type CodexPluginMutationResult =
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

export function parseCodexMarketplaceListJson(
  content: string,
): CodexMarketplaceState[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  const values = (parsed as Record<string, unknown>).marketplaces;
  if (!Array.isArray(values)) {
    return undefined;
  }
  const states: CodexMarketplaceState[] = [];
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const item = value as Record<string, unknown>;
    const name = optionalString(item.name);
    const root = optionalString(item.root);
    if (!name || !root) {
      return undefined;
    }
    const marketplaceSource =
      item.marketplaceSource && typeof item.marketplaceSource === "object"
        ? (item.marketplaceSource as Record<string, unknown>)
        : {};
    states.push({
      name,
      root,
      sourceType: optionalString(marketplaceSource.sourceType),
      source: optionalString(marketplaceSource.source),
    });
  }
  return states;
}

export function parseCodexPluginListJson(
  content: string,
): CodexPluginState[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  const values = (parsed as Record<string, unknown>).installed;
  if (!Array.isArray(values)) {
    return undefined;
  }
  const states: CodexPluginState[] = [];
  for (const value of values) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const item = value as Record<string, unknown>;
    const pluginId = optionalString(item.pluginId);
    const name = optionalString(item.name);
    const marketplaceName = optionalString(item.marketplaceName);
    if (!pluginId || !name || !marketplaceName) {
      return undefined;
    }
    states.push({
      pluginId,
      name,
      marketplaceName,
      version: optionalString(item.version),
      installed:
        typeof item.installed === "boolean" ? item.installed : undefined,
      enabled: typeof item.enabled === "boolean" ? item.enabled : undefined,
    });
  }
  return states;
}

function normalizeGitSource(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const match = value.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/i);
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : undefined;
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
    `Codex exited with code ${String(result.exitCode)}`
  );
}

export function codexMarketplaceMatches(
  marketplace: CodexMarketplaceState | undefined,
  source: string,
): boolean {
  if (marketplace?.sourceType === "git") {
    return normalizeGitSource(marketplace.source) === source.toLowerCase();
  }
  if (
    path.isAbsolute(source) &&
    marketplace &&
    (marketplace?.sourceType === "local" || !marketplace?.sourceType)
  ) {
    const normalizeLocal = (value: string): string =>
      path
        .resolve(value.replace(/^\\\\\?\\/, ""))
        .replace(/\\/g, "/")
        .replace(/\/+$/, "")
        .toLowerCase();
    return normalizeLocal(marketplace.root) === normalizeLocal(source);
  }
  return false;
}

async function cleanupCodexMarketplace(input: {
  runner: PluginHostCommandRunner;
  marketplaceName: string;
  marketplaceSource: string;
}): Promise<"removed" | "skipped" | "failed"> {
  const listResult = await input.runner.run([
    "plugin",
    "marketplace",
    "list",
    "--json",
  ]);
  const marketplaces = commandSucceeded(listResult)
    ? parseCodexMarketplaceListJson(listResult.stdout)
    : undefined;
  const current = marketplaces?.find(
    (marketplace) => marketplace.name === input.marketplaceName,
  );
  if (!codexMarketplaceMatches(current, input.marketplaceSource)) {
    return "skipped";
  }
  const removeResult = await input.runner.run([
    "plugin",
    "marketplace",
    "remove",
    input.marketplaceName,
    "--json",
  ]);
  return commandSucceeded(removeResult) ? "removed" : "failed";
}

export async function installCodexPlugin(input: {
  runner: PluginHostCommandRunner;
  pluginName: string;
  marketplaceName: string;
  marketplaceSource: string;
}): Promise<CodexPluginMutationResult> {
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
  const marketplaces = parseCodexMarketplaceListJson(marketplaceList.stdout);
  if (!marketplaces) {
    return {
      ok: false,
      phase: "marketplace-list",
      reason: "Codex marketplace JSON was not recognized.",
    };
  }
  const existing = marketplaces.find(
    (marketplace) => marketplace.name === input.marketplaceName,
  );
  if (existing && !codexMarketplaceMatches(existing, input.marketplaceSource)) {
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
      "--json",
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
    "add",
    pluginId,
    "--json",
  ]);
  if (!commandSucceeded(installResult)) {
    const cleanup = marketplaceAdded
      ? await cleanupCodexMarketplace(input)
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
    ? parseCodexPluginListJson(listResult.stdout)
    : undefined;
  if (
    !states?.some((state) => state.pluginId === pluginId && state.installed)
  ) {
    const cleanup = marketplaceAdded
      ? await cleanupCodexMarketplace(input)
      : "not-needed";
    return {
      ok: false,
      phase: "verify",
      reason: commandSucceeded(listResult)
        ? "Codex did not report the installed plugin."
        : commandFailure(listResult),
      cleanup,
    };
  }
  return { ok: true, marketplaceAdded };
}

export async function uninstallCodexPlugin(input: {
  runner: PluginHostCommandRunner;
  pluginId: string;
  marketplaceName: string;
  marketplaceSource: string;
}): Promise<CodexPluginMutationResult> {
  const marketplaceList = await input.runner.run([
    "plugin",
    "marketplace",
    "list",
    "--json",
  ]);
  const marketplaces = commandSucceeded(marketplaceList)
    ? parseCodexMarketplaceListJson(marketplaceList.stdout)
    : undefined;
  const marketplace = marketplaces?.find(
    (candidate) => candidate.name === input.marketplaceName,
  );
  if (!codexMarketplaceMatches(marketplace, input.marketplaceSource)) {
    return {
      ok: false,
      phase: "conflict",
      reason: `Marketplace ${input.marketplaceName} is not registered from ${input.marketplaceSource}.`,
    };
  }
  const result = await input.runner.run([
    "plugin",
    "remove",
    input.pluginId,
    "--json",
  ]);
  return commandSucceeded(result)
    ? { ok: true }
    : { ok: false, phase: "mutation", reason: commandFailure(result) };
}

export function planCodexMarketplaceHandoff(
  marketplaceSource: string,
): readonly string[] {
  return ["plugin", "marketplace", "add", marketplaceSource];
}

export const codexAdapter: PluginHostAdapter = {
  capability: CODEX_CAPABILITY,
  supportsArtifact(artifact: PluginArtifact): boolean {
    return (
      isNativeInstallCandidate(artifact) &&
      artifact.manifestKind === "codex-plugin"
    );
  },
};
