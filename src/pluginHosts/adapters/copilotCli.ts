import {
  PluginArtifact,
  PluginHostAdapter,
  PluginHostCapability,
} from "../types";
import {
  isNativeInstallCandidate,
  isVerifiedMarketplaceIdentity,
} from "../artifact";

const CLI_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,63})$/;

function hasVerifiedMarketplaceIdentity(artifact: PluginArtifact): boolean {
  const marketplace = artifact.marketplace;
  return (
    artifact.resolutionMode === "host-resolved" &&
    artifact.source.kind === "github" &&
    isVerifiedMarketplaceIdentity(marketplace) &&
    CLI_NAME_PATTERN.test(marketplace.marketplaceName) &&
    CLI_NAME_PATTERN.test(marketplace.pluginName) &&
    marketplace.sourceRepository.toLowerCase() ===
      artifact.source.repository.toLowerCase() &&
    marketplace.pluginRoot === artifact.packageRootPath
  );
}

export const COPILOT_CLI_CAPABILITY: PluginHostCapability = {
  id: "copilot-cli",
  displayName: "GitHub Copilot CLI",
  supportLevel: "native",
  surfaces: ["cli"],
  actions: ["install", "list", "update", "enable", "disable", "uninstall"],
  scopes: ["user"],
  acceptedManifestKinds: ["*"],
  executableNames: ["copilot"],
};

export const copilotCliAdapter: PluginHostAdapter = {
  capability: COPILOT_CLI_CAPABILITY,
  supportsArtifact(artifact: PluginArtifact): boolean {
    return (
      isNativeInstallCandidate(artifact) &&
      hasVerifiedMarketplaceIdentity(artifact)
    );
  },
};
