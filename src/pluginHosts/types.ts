export const PLUGIN_HOST_IDS = [
  "vscode-copilot",
  "copilot-cli",
  "claude-code",
  "codex",
  "cursor",
  "gemini-cli",
  "cline-cli",
  "portable-resources",
] as const;

export type PluginHostId = (typeof PLUGIN_HOST_IDS)[number];

export type PluginHostSupportLevel =
  | "native"
  | "resources-only"
  | "handoff"
  | "unsupported";

export type PluginHostSurface =
  | "vscode-extension"
  | "editor"
  | "cli"
  | "desktop";

export type PluginInstallScope = "user" | "project" | "local";

export type PluginHostAction =
  | "install"
  | "list"
  | "update"
  | "enable"
  | "disable"
  | "uninstall"
  | "copy"
  | "delete"
  | "marketplace-manage";

export type PluginResolutionMode = "immutable" | "host-resolved" | "local-copy";

export type PluginArtifactAvailability =
  | "complete"
  | "incomplete"
  | "unavailable";

export type PluginArtifactSource =
  | {
      kind: "github";
      repository: string;
      url: string;
      ref?: string;
      repositoryId?: number;
    }
  | {
      kind: "local";
      uri: string;
    }
  | {
      kind: "unknown";
      label?: string;
    };

export interface PluginMarketplaceIdentity {
  marketplaceName: string;
  pluginName: string;
  sourceRepository: string;
  pluginRoot: string;
  manifestSourceUrl: string;
  manifestFingerprint: string;
}

export interface PluginArtifact {
  resourceIdentity: string;
  name: string;
  packageRootUri: string;
  packageRootPath: string;
  manifestPath: string;
  manifestKind: string;
  source: PluginArtifactSource;
  availability: PluginArtifactAvailability;
  resolutionMode: PluginResolutionMode;
  contentFingerprint?: string;
  marketplace?: PluginMarketplaceIdentity;
}

export interface PluginHostCapability {
  id: PluginHostId;
  displayName: string;
  supportLevel: PluginHostSupportLevel;
  surfaces: readonly PluginHostSurface[];
  actions: readonly PluginHostAction[];
  scopes: readonly PluginInstallScope[];
  acceptedManifestKinds: readonly string[];
  extensionIds?: readonly string[];
  executableNames?: readonly string[];
}

export interface PluginHostProbe {
  hostId: PluginHostId;
  available: boolean;
  detected: boolean;
  version?: string;
  executablePath?: string;
  reason?: string;
}

export interface PluginHostState {
  hostId: PluginHostId;
  status: "unknown" | "not-installed" | "installed" | "error";
  enabled?: boolean;
  updateAvailable?: boolean;
  version?: string;
  reason?: string;
}

export interface PluginHostAdapter {
  readonly capability: PluginHostCapability;
  supportsArtifact(artifact: PluginArtifact): boolean;
}
