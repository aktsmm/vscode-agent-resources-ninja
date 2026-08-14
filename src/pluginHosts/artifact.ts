import {
  PluginArtifact,
  PluginArtifactAvailability,
  PluginArtifactSource,
  PluginMarketplaceIdentity,
  PluginResolutionMode,
} from "./types";
import { createHash } from "crypto";

const CLI_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,63})$/;
const verifiedMarketplaceIdentities = new WeakSet<object>();

export interface PluginArtifactInput {
  kind?: string;
  name?: string;
  sourceId?: string;
  remotePath?: string;
  packageRootUri?: string;
  packageRootPath?: string;
  manifestPath?: string;
  manifestKind?: string;
  source?: PluginArtifactSource;
  availability?: PluginArtifactAvailability;
  resolutionMode?: PluginResolutionMode;
  contentFingerprint?: string;
  marketplace?: PluginArtifact["marketplace"];
}

export type PluginArtifactResult =
  | { ok: true; artifact: PluginArtifact }
  | { ok: false; reason: string };

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizeRepository(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value
    .trim()
    .replace(/\.git$/i, "")
    .replace(/^\/+|\/+$/g, "");
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)
    ? normalized.toLowerCase()
    : undefined;
}

function normalizePluginRoot(value: unknown): string | undefined {
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

function getRepositoryFromManifestUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/").filter(Boolean);
    if (url.hostname.toLowerCase() === "raw.githubusercontent.com") {
      return normalizeRepository(`${segments[0]}/${segments[1]}`);
    }
    if (url.hostname.toLowerCase() === "api.github.com") {
      return segments[0] === "repos"
        ? normalizeRepository(`${segments[1]}/${segments[2]}`)
        : undefined;
    }
    if (url.hostname.toLowerCase() === "github.com") {
      return normalizeRepository(`${segments[0]}/${segments[1]}`);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function getMarketplaceEntryRoot(
  source: unknown,
  sourceRepository: string,
): string | undefined {
  if (typeof source === "string") {
    return normalizePluginRoot(source);
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return undefined;
  }
  const sourceObject = source as Record<string, unknown>;
  if (
    sourceObject.source !== "github" ||
    normalizeRepository(sourceObject.repo) !== sourceRepository
  ) {
    return undefined;
  }
  return normalizePluginRoot(sourceObject.path);
}

export function createVerifiedMarketplaceIdentity(input: {
  manifestContent: string;
  manifestSourceUrl: string;
  sourceRepository: string;
  pluginRoot: string;
}): PluginMarketplaceIdentity | undefined {
  const sourceRepository = normalizeRepository(input.sourceRepository);
  const pluginRoot = normalizePluginRoot(input.pluginRoot);
  if (
    !sourceRepository ||
    !pluginRoot ||
    getRepositoryFromManifestUrl(input.manifestSourceUrl) !== sourceRepository
  ) {
    return undefined;
  }
  let manifest: Record<string, unknown>;
  try {
    const parsed = JSON.parse(input.manifestContent) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    manifest = parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (
    typeof manifest.name !== "string" ||
    !CLI_NAME_PATTERN.test(manifest.name) ||
    !Array.isArray(manifest.plugins)
  ) {
    return undefined;
  }
  const matches = manifest.plugins.filter((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const plugin = value as Record<string, unknown>;
    return (
      typeof plugin.name === "string" &&
      CLI_NAME_PATTERN.test(plugin.name) &&
      getMarketplaceEntryRoot(plugin.source, sourceRepository) === pluginRoot
    );
  }) as Array<Record<string, unknown>>;
  if (matches.length !== 1) {
    return undefined;
  }
  const identity = Object.freeze({
    marketplaceName: manifest.name,
    pluginName: matches[0].name as string,
    sourceRepository,
    pluginRoot,
    manifestSourceUrl: input.manifestSourceUrl,
    manifestFingerprint: createHash("sha256")
      .update(input.manifestContent, "utf8")
      .digest("hex"),
  });
  verifiedMarketplaceIdentities.add(identity);
  return identity;
}

export function isVerifiedMarketplaceIdentity(
  identity: PluginMarketplaceIdentity | undefined,
): identity is PluginMarketplaceIdentity {
  return !!identity && verifiedMarketplaceIdentities.has(identity);
}

export function createPluginArtifact(
  input: PluginArtifactInput,
): PluginArtifactResult {
  if (input.kind !== "plugin") {
    return { ok: false, reason: "Resource is not a plugin package." };
  }
  if (input.manifestKind === "marketplace") {
    return {
      ok: false,
      reason: "A marketplace catalog is not an installable plugin package.",
    };
  }
  if (input.marketplace && !isVerifiedMarketplaceIdentity(input.marketplace)) {
    return {
      ok: false,
      reason: "Marketplace identity was not derived from a manifest.",
    };
  }

  const name = clean(input.name);
  const packageRootUri = clean(input.packageRootUri);
  const packageRootPath = clean(input.packageRootPath);
  const manifestPath = clean(input.manifestPath);
  const manifestKind = clean(input.manifestKind);
  const sourceId = clean(input.sourceId);
  const remotePath = clean(input.remotePath);
  if (
    !name ||
    !packageRootUri ||
    !packageRootPath ||
    !manifestPath ||
    !manifestKind ||
    !sourceId
  ) {
    return {
      ok: false,
      reason: "Plugin package identity or provenance is incomplete.",
    };
  }

  const source = input.source ?? { kind: "unknown", label: sourceId };
  const resourceIdentity = [
    sourceId,
    remotePath ?? manifestPath,
    manifestKind,
  ].join(":");
  return {
    ok: true,
    artifact: {
      resourceIdentity,
      name,
      packageRootUri,
      packageRootPath,
      manifestPath,
      manifestKind,
      source,
      availability: input.availability ?? "unavailable",
      resolutionMode: input.resolutionMode ?? "host-resolved",
      contentFingerprint: clean(input.contentFingerprint),
      marketplace: input.marketplace,
    },
  };
}

export function isNativeInstallCandidate(artifact: PluginArtifact): boolean {
  return (
    artifact.availability === "complete" && artifact.source.kind !== "unknown"
  );
}
