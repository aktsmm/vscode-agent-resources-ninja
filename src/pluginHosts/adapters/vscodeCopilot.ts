import {
  PluginArtifact,
  PluginHostAdapter,
  PluginHostCapability,
} from "../types";
import { isNativeInstallCandidate } from "../artifact";

export const VSCODE_COPILOT_CAPABILITY: PluginHostCapability = {
  id: "vscode-copilot",
  displayName: "VS Code / GitHub Copilot Chat",
  supportLevel: "native",
  surfaces: ["vscode-extension"],
  actions: ["install", "list", "uninstall"],
  scopes: ["user", "project", "local"],
  acceptedManifestKinds: ["agent-plugins", "plugin"],
  extensionIds: ["github.copilot-chat"],
};

export const vscodeCopilotAdapter: PluginHostAdapter = {
  capability: VSCODE_COPILOT_CAPABILITY,
  supportsArtifact(artifact: PluginArtifact): boolean {
    return (
      isNativeInstallCandidate(artifact) &&
      VSCODE_COPILOT_CAPABILITY.acceptedManifestKinds.includes(
        artifact.manifestKind,
      )
    );
  },
};
