import * as vscode from "vscode";
import {
  CoexistenceMode,
  getConfiguredCoexistenceMode,
} from "./customizationPaths";
import { ResourceKind } from "./skillIndex";
import { logger } from "./logger";

export interface AgentNinjaBeacon {
  extensionId: string;
  version: string;
  kinds: ResourceKind[];
  capabilities: string[];
  protocolVersion: 3;
  updatedAt: string;
  pid?: number;
}

export interface AgentNinjaExtensionApi {
  getAgentNinjaBeacon(): AgentNinjaBeacon | undefined;
}

export const SELF_EXTENSION_ID = "yamapan.agent-resources-ninja";
export const SIBLING_EXTENSION_ID = "yamapan.agent-skill-ninja";
export const BEACON_KEY_PREFIX = "agentNinja.beacon.";
export const BEACON_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const RESOURCE_NINJA_KINDS: ResourceKind[] = [
  "skill",
  "agent",
  "instruction",
  "prompt",
  "hook",
  "mcp",
  "plugin",
  "cursor-rule",
];
export const RESOURCE_NINJA_CAPABILITIES = [
  "mcp-staging",
  "shared-sources-manifest",
  "owner-handoff-v3",
];

function getBeaconKey(extensionId: string): string {
  return `${BEACON_KEY_PREFIX}${extensionId}`;
}

function getSelfVersion(): string {
  return (
    vscode.extensions.getExtension(SELF_EXTENSION_ID)?.packageJSON?.version ||
    "0.0.0"
  );
}

function isBeaconExpired(updatedAt: string): boolean {
  const timestamp = Date.parse(updatedAt);
  if (!Number.isFinite(timestamp)) {
    return true;
  }
  return Date.now() - timestamp > BEACON_TTL_MS;
}

function isValidKind(value: unknown): value is ResourceKind {
  return (
    value === "skill" ||
    value === "agent" ||
    value === "instruction" ||
    value === "prompt" ||
    value === "hook" ||
    value === "mcp" ||
    value === "plugin" ||
    value === "cursor-rule"
  );
}

function normalizeBeacon(beacon: unknown): AgentNinjaBeacon | undefined {
  if (!beacon || typeof beacon !== "object") {
    return undefined;
  }

  const candidate = beacon as Partial<AgentNinjaBeacon>;
  if (
    typeof candidate.extensionId !== "string" ||
    typeof candidate.version !== "string" ||
    candidate.protocolVersion !== 3 ||
    typeof candidate.updatedAt !== "string" ||
    !Array.isArray(candidate.kinds) ||
    !candidate.kinds.every(isValidKind) ||
    !Array.isArray(candidate.capabilities)
  ) {
    return undefined;
  }

  if (isBeaconExpired(candidate.updatedAt)) {
    return undefined;
  }

  return {
    extensionId: candidate.extensionId,
    version: candidate.version,
    kinds: [...candidate.kinds],
    capabilities: candidate.capabilities.filter(
      (capability): capability is string => typeof capability === "string",
    ),
    protocolVersion: 3,
    updatedAt: candidate.updatedAt,
    pid: typeof candidate.pid === "number" ? candidate.pid : undefined,
  };
}

export function buildSelfBeacon(): AgentNinjaBeacon {
  return {
    extensionId: SELF_EXTENSION_ID,
    version: getSelfVersion(),
    kinds: [...RESOURCE_NINJA_KINDS],
    capabilities: [...RESOURCE_NINJA_CAPABILITIES],
    protocolVersion: 3,
    updatedAt: new Date().toISOString(),
    pid: typeof process.pid === "number" ? process.pid : undefined,
  };
}

export async function publishBeacon(
  context: vscode.ExtensionContext,
): Promise<AgentNinjaBeacon> {
  const beacon = buildSelfBeacon();
  await context.globalState.update(getBeaconKey(beacon.extensionId), beacon);
  return beacon;
}

export async function clearBeacon(
  context: vscode.ExtensionContext,
): Promise<void> {
  await context.globalState.update(getBeaconKey(SELF_EXTENSION_ID), undefined);
}

export function getPublishedSelfBeacon(
  context: vscode.ExtensionContext,
): AgentNinjaBeacon | undefined {
  return normalizeBeacon(
    context.globalState.get(getBeaconKey(SELF_EXTENSION_ID)),
  );
}

async function getSiblingExtensionApi(): Promise<
  Partial<AgentNinjaExtensionApi> | undefined
> {
  const sibling =
    vscode.extensions.getExtension<AgentNinjaExtensionApi>(
      SIBLING_EXTENSION_ID,
    );
  if (!sibling?.isActive) {
    return undefined;
  }

  try {
    return (await sibling.activate()) as Partial<AgentNinjaExtensionApi>;
  } catch (error) {
    logger.warn(
      "[Resource Ninja] Failed to activate sibling extension:",
      error,
    );
    return undefined;
  }
}

export async function readSiblingBeacon(
  _context: vscode.ExtensionContext,
): Promise<AgentNinjaBeacon | undefined> {
  const siblingApi = await getSiblingExtensionApi();
  const beacon = siblingApi?.getAgentNinjaBeacon?.();
  return normalizeBeacon(beacon);
}

export async function isSiblingActive(
  context: vscode.ExtensionContext,
): Promise<boolean> {
  const sibling = vscode.extensions.getExtension(SIBLING_EXTENSION_ID);
  if (!sibling?.isActive) {
    return false;
  }
  return !!(await readSiblingBeacon(context));
}

export function computeOwnership(
  self: AgentNinjaBeacon,
  sibling: AgentNinjaBeacon | undefined,
): "self" | "sibling" {
  if (!sibling) {
    return "self";
  }

  const selfKinds = new Set(self.kinds);
  const siblingKinds = new Set(sibling.kinds);

  const selfIsSubset = [...selfKinds].every((k) => siblingKinds.has(k));
  const siblingIsSubset = [...siblingKinds].every((k) => selfKinds.has(k));

  if (selfIsSubset && !siblingIsSubset) return "sibling";

  if (siblingIsSubset && !selfIsSubset) return "self";

  return self.extensionId < sibling.extensionId ? "self" : "sibling";
}

export function getCoexistenceMode(
  config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration(
    "resourceNinja",
  ),
): CoexistenceMode {
  return getConfiguredCoexistenceMode(config);
}

export async function getEffectiveOwner(
  context: vscode.ExtensionContext,
): Promise<"self" | "sibling"> {
  if (getCoexistenceMode() === "independent") {
    return "self";
  }

  const self = getPublishedSelfBeacon(context) || buildSelfBeacon();
  const sibling = await readSiblingBeacon(context);
  return computeOwnership(self, sibling);
}

export function subscribeOwnershipChanges(
  context: vscode.ExtensionContext,
  callback: () => void | Promise<void>,
): vscode.Disposable {
  const invoke = () => {
    void Promise.resolve(callback()).catch((error) => {
      logger.error(
        "[Resource Ninja] Failed to refresh coexistence state:",
        error,
      );
    });
  };

  const extensionWatcher = vscode.extensions.onDidChange(() => invoke());
  const configWatcher = vscode.workspace.onDidChangeConfiguration((event) => {
    if (
      event.affectsConfiguration("resourceNinja.coexistenceMode") ||
      event.affectsConfiguration("resourceNinja.instructionBlock.includeAgents") ||
      event.affectsConfiguration(
        "resourceNinja.instructionBlock.includeInstructions",
      ) ||
      event.affectsConfiguration(
        "resourceNinja.instructionBlock.globalHome.includeAgents",
      ) ||
      event.affectsConfiguration(
        "resourceNinja.instructionBlock.globalHome.includeInstructions",
      ) ||
      event.affectsConfiguration("resourceNinja.kindsExcluded")
    ) {
      invoke();
    }
  });

  const disposable = new vscode.Disposable(() => {
    extensionWatcher.dispose();
    configWatcher.dispose();
  });
  context.subscriptions.push(disposable);
  return disposable;
}
