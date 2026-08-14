import { getPluginRootFromManifestPath } from "./resourceKinds";
import { findExecutableOnPath } from "./pluginHosts/executable";

export const COPILOT_MARKETPLACE_MANIFEST_PATHS = [
  "marketplace.json",
  ".plugin/marketplace.json",
  ".github/plugin/marketplace.json",
  ".agents/plugins/marketplace.json",
  ".claude-plugin/marketplace.json",
] as const;

const CLI_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,63})$/;

function stripAnsiSequences(value: string): string {
  let stripped = "";
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 27 || value[index + 1] !== "[") {
      stripped += value[index];
      continue;
    }
    index += 2;
    while (index < value.length) {
      const code = value.charCodeAt(index);
      if (code >= 64 && code <= 126) {
        break;
      }
      index += 1;
    }
  }
  return stripped;
}

export interface CliPluginResource {
  kind?: string;
  pluginRoot?: string;
  pluginManifestPath?: string;
  pluginManifestKind?: string;
}

export interface CopilotMarketplacePluginIdentity {
  marketplaceName: string;
  pluginName: string;
  pluginRoot: string;
  ownerRepo: string;
}

export interface CopilotCliCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
  timedOut?: boolean;
  truncated?: boolean;
}

export interface CopilotCliCommandRunner {
  run(args: readonly string[]): Promise<CopilotCliCommandResult>;
}

export type MarketplaceCleanupResult =
  | { status: "not-needed" }
  | { status: "removed" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

export type CopilotCliPluginInstallResult =
  | {
      ok: true;
      marketplaceAdded: boolean;
    }
  | {
      ok: false;
      phase: "list" | "conflict" | "add" | "verify" | "install";
      reason: string;
      cleanup: MarketplaceCleanupResult;
    };

export type CopilotCliPluginUninstallResult =
  | { ok: true }
  | {
      ok: false;
      phase: "list" | "conflict" | "uninstall";
      reason: string;
    };

export interface MarketplaceRegistration {
  name: string;
  sourceKind: string;
  source: string;
  ownerRepo?: string;
}

export interface MarketplaceListResult {
  recognized: boolean;
  registrations: MarketplaceRegistration[];
}

export interface CopilotCliPluginState {
  id: string;
  version?: string;
  enabled?: boolean;
}

function normalizeRelativePluginRoot(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized)
  ) {
    return undefined;
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "..")) {
    return undefined;
  }
  return segments.join("/").replace(/\/+$/, "") || ".";
}

export function getCanonicalCopilotCliPluginRoot(
  resource: CliPluginResource,
): string | undefined {
  if (
    resource.kind !== "plugin" ||
    resource.pluginManifestKind === "marketplace" ||
    !resource.pluginManifestPath
  ) {
    return undefined;
  }
  const derivedRoot = normalizeRelativePluginRoot(
    getPluginRootFromManifestPath(resource.pluginManifestPath),
  );
  if (!derivedRoot) {
    return undefined;
  }
  if (resource.pluginRoot !== undefined) {
    const explicitRoot = normalizeRelativePluginRoot(resource.pluginRoot);
    if (!explicitRoot || explicitRoot !== derivedRoot) {
      return undefined;
    }
  }
  return derivedRoot;
}

export function normalizeGitHubOwnerRepo(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value
    .trim()
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)) {
    return undefined;
  }
  return normalized.toLowerCase();
}

function getMarketplaceEntryRoot(
  source: unknown,
  ownerRepo: string,
): string | undefined {
  if (typeof source === "string") {
    return normalizeRelativePluginRoot(source);
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return undefined;
  }
  const sourceObject = source as Record<string, unknown>;
  if (sourceObject.source === "local") {
    return normalizeRelativePluginRoot(sourceObject.path);
  }
  if (
    sourceObject.source !== "github" ||
    normalizeGitHubOwnerRepo(sourceObject.repo) !== ownerRepo
  ) {
    return undefined;
  }
  return normalizeRelativePluginRoot(sourceObject.path);
}

export function resolveMarketplacePluginIdentity(
  content: string,
  pluginRoot: string,
  ownerRepoValue: string,
): CopilotMarketplacePluginIdentity | undefined {
  const ownerRepo = normalizeGitHubOwnerRepo(ownerRepoValue);
  const canonicalRoot = normalizeRelativePluginRoot(pluginRoot);
  if (!ownerRepo || !canonicalRoot) {
    return undefined;
  }

  let manifest: Record<string, unknown>;
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    manifest = parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const marketplaceName = manifest.name;
  if (
    typeof marketplaceName !== "string" ||
    !CLI_NAME_PATTERN.test(marketplaceName)
  ) {
    return undefined;
  }
  if (!Array.isArray(manifest.plugins)) {
    return undefined;
  }

  const matches: CopilotMarketplacePluginIdentity[] = [];
  for (const value of manifest.plugins) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const plugin = value as Record<string, unknown>;
    if (
      typeof plugin.name !== "string" ||
      !CLI_NAME_PATTERN.test(plugin.name) ||
      getMarketplaceEntryRoot(plugin.source, ownerRepo) !== canonicalRoot
    ) {
      continue;
    }
    matches.push({
      marketplaceName,
      pluginName: plugin.name,
      pluginRoot: canonicalRoot,
      ownerRepo,
    });
  }
  return matches.length === 1 ? matches[0] : undefined;
}

export function resolveMarketplacePluginIdentityFromCandidates(
  contents: readonly string[],
  pluginRoot: string,
  ownerRepo: string,
): CopilotMarketplacePluginIdentity | undefined {
  const identities = new Map<string, CopilotMarketplacePluginIdentity>();
  for (const content of contents) {
    const identity = resolveMarketplacePluginIdentity(
      content,
      pluginRoot,
      ownerRepo,
    );
    if (!identity) {
      continue;
    }
    identities.set(
      `${identity.marketplaceName}\0${identity.pluginName}\0${identity.ownerRepo}`,
      identity,
    );
  }
  return identities.size === 1 ? identities.values().next().value : undefined;
}

export function parseMarketplaceList(output: string): MarketplaceListResult {
  const registrations: MarketplaceRegistration[] = [];
  const lines = stripAnsiSequences(output).split(/\r?\n/);
  for (const line of lines) {
    const match =
      /^\s*(?:\S+\s+)?([a-z0-9](?:[a-z0-9.-]{0,63}))\s+\(([^:()]+):\s*(.+)\)\s*$/.exec(
        line,
      );
    if (!match) {
      continue;
    }
    const sourceKind = match[2].trim();
    const source = match[3].trim();
    registrations.push({
      name: match[1],
      sourceKind,
      source,
      ownerRepo:
        sourceKind.toLowerCase() === "github"
          ? normalizeGitHubOwnerRepo(source)
          : undefined,
    });
  }
  return {
    recognized: registrations.length > 0,
    registrations,
  };
}

export function parseCopilotCliPluginList(
  output: string,
): CopilotCliPluginState[] | undefined {
  const normalized = stripAnsiSequences(output);
  if (/\bNo plugins installed\b/i.test(normalized)) {
    return [];
  }
  if (!/\bInstalled plugins:\s*/i.test(normalized)) {
    return undefined;
  }
  const states: CopilotCliPluginState[] = [];
  for (const line of normalized.split(/\r?\n/)) {
    const match =
      /^\s*(?:\S+\s+)?([a-z0-9](?:[a-z0-9.-]{0,63})@[a-z0-9](?:[a-z0-9.-]{0,63}))(?:\s+\(v?([^()]+)\))?\s*$/i.exec(
        line,
      );
    if (!match) {
      continue;
    }
    states.push({
      id: match[1],
      version: match[2]?.trim() || undefined,
      enabled: undefined,
    });
  }
  return states.length > 0 ? states : undefined;
}

function successful(result: CopilotCliCommandResult): boolean {
  return result.exitCode === 0 && !result.error && !result.timedOut;
}

function commandFailure(result: CopilotCliCommandResult): string {
  return (
    result.error ||
    result.stderr.trim() ||
    result.stdout.trim() ||
    `Copilot CLI exited with code ${String(result.exitCode)}`
  );
}

function findMarketplaceRegistration(
  parsed: MarketplaceListResult,
  identity: CopilotMarketplacePluginIdentity,
): MarketplaceRegistration | undefined {
  return parsed.registrations.find(
    (registration) => registration.name === identity.marketplaceName,
  );
}

function registrationMatches(
  registration: MarketplaceRegistration | undefined,
  identity: CopilotMarketplacePluginIdentity,
): boolean {
  return registration?.ownerRepo === identity.ownerRepo;
}

async function cleanupOwnedMarketplace(
  identity: CopilotMarketplacePluginIdentity,
  runner: CopilotCliCommandRunner,
): Promise<MarketplaceCleanupResult> {
  const listResult = await runner.run([
    "--no-color",
    "plugin",
    "marketplace",
    "list",
  ]);
  if (!successful(listResult)) {
    return { status: "skipped", reason: commandFailure(listResult) };
  }
  const parsed = parseMarketplaceList(listResult.stdout);
  const registration = findMarketplaceRegistration(parsed, identity);
  if (!parsed.recognized || !registrationMatches(registration, identity)) {
    return {
      status: "skipped",
      reason: "Marketplace ownership could not be proven before cleanup.",
    };
  }
  const removeResult = await runner.run([
    "--no-color",
    "plugin",
    "marketplace",
    "remove",
    identity.marketplaceName,
  ]);
  return successful(removeResult)
    ? { status: "removed" }
    : { status: "failed", reason: commandFailure(removeResult) };
}

export async function installCopilotCliPlugin(
  identity: CopilotMarketplacePluginIdentity,
  runner: CopilotCliCommandRunner,
): Promise<CopilotCliPluginInstallResult> {
  const listResult = await runner.run([
    "--no-color",
    "plugin",
    "marketplace",
    "list",
  ]);
  if (!successful(listResult)) {
    return {
      ok: false,
      phase: "list",
      reason: commandFailure(listResult),
      cleanup: { status: "not-needed" },
    };
  }
  const parsed = parseMarketplaceList(listResult.stdout);
  if (!parsed.recognized) {
    return {
      ok: false,
      phase: "list",
      reason: "Copilot CLI marketplace list output was not recognized.",
      cleanup: { status: "not-needed" },
    };
  }
  const existing = findMarketplaceRegistration(parsed, identity);
  if (existing && !registrationMatches(existing, identity)) {
    return {
      ok: false,
      phase: "conflict",
      reason: `Marketplace ${identity.marketplaceName} is registered from a different source.`,
      cleanup: { status: "not-needed" },
    };
  }

  let marketplaceAdded = false;
  if (!existing) {
    const addResult = await runner.run([
      "--no-color",
      "plugin",
      "marketplace",
      "add",
      identity.ownerRepo,
    ]);
    if (!successful(addResult)) {
      return {
        ok: false,
        phase: "add",
        reason: commandFailure(addResult),
        cleanup: { status: "not-needed" },
      };
    }
    marketplaceAdded = true;

    const verifyResult = await runner.run([
      "--no-color",
      "plugin",
      "marketplace",
      "list",
    ]);
    const verified = successful(verifyResult)
      ? parseMarketplaceList(verifyResult.stdout)
      : undefined;
    if (
      !verified?.recognized ||
      !registrationMatches(
        findMarketplaceRegistration(verified, identity),
        identity,
      )
    ) {
      return {
        ok: false,
        phase: "verify",
        reason: successful(verifyResult)
          ? "The added marketplace registration could not be verified."
          : commandFailure(verifyResult),
        cleanup: await cleanupOwnedMarketplace(identity, runner),
      };
    }
  }

  const installResult = await runner.run([
    "--no-color",
    "plugin",
    "install",
    `${identity.pluginName}@${identity.marketplaceName}`,
  ]);
  if (!successful(installResult)) {
    return {
      ok: false,
      phase: "install",
      reason: commandFailure(installResult),
      cleanup: marketplaceAdded
        ? await cleanupOwnedMarketplace(identity, runner)
        : { status: "not-needed" },
    };
  }
  return { ok: true, marketplaceAdded };
}

export async function uninstallCopilotCliPlugin(
  identity: CopilotMarketplacePluginIdentity,
  runner: CopilotCliCommandRunner,
): Promise<CopilotCliPluginUninstallResult> {
  const listResult = await runner.run([
    "--no-color",
    "plugin",
    "marketplace",
    "list",
  ]);
  if (!successful(listResult)) {
    return { ok: false, phase: "list", reason: commandFailure(listResult) };
  }
  const parsed = parseMarketplaceList(listResult.stdout);
  if (!parsed.recognized) {
    return {
      ok: false,
      phase: "list",
      reason: "Copilot CLI marketplace list output was not recognized.",
    };
  }
  const registration = findMarketplaceRegistration(parsed, identity);
  if (!registrationMatches(registration, identity)) {
    return {
      ok: false,
      phase: "conflict",
      reason: `Marketplace ${identity.marketplaceName} is not registered from ${identity.ownerRepo}.`,
    };
  }
  const uninstallResult = await runner.run([
    "--no-color",
    "plugin",
    "uninstall",
    `${identity.pluginName}@${identity.marketplaceName}`,
  ]);
  return successful(uninstallResult)
    ? { ok: true }
    : {
        ok: false,
        phase: "uninstall",
        reason: commandFailure(uninstallResult),
      };
}

export async function findCopilotCliExecutable(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  return findExecutableOnPath(
    "copilot",
    environment,
    platform,
    platform === "win32" ? [".exe"] : undefined,
  );
}
