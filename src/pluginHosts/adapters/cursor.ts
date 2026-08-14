import * as path from "path";
import {
  PluginArtifact,
  PluginHostAdapter,
  PluginHostCapability,
} from "../types";
import { isNativeInstallCandidate } from "../artifact";

export const CURSOR_CAPABILITY: PluginHostCapability = {
  id: "cursor",
  displayName: "Cursor",
  supportLevel: "native",
  surfaces: ["editor"],
  actions: ["install", "uninstall"],
  scopes: ["user"],
  acceptedManifestKinds: ["agent-plugins", "cursor-plugin"],
};

export function isCursorEditor(appName: string, uriScheme: string): boolean {
  return /cursor/i.test(appName) || /^cursor$/i.test(uriScheme);
}

export function getCursorLocalPluginPath(
  homeDirectory: string,
  pluginName: string,
): string | undefined {
  if (!homeDirectory || !/^[a-z0-9](?:[a-z0-9.-]{0,63})$/.test(pluginName)) {
    return undefined;
  }
  return path.join(homeDirectory, ".cursor", "plugins", "local", pluginName);
}

export const cursorAdapter: PluginHostAdapter = {
  capability: CURSOR_CAPABILITY,
  supportsArtifact(artifact: PluginArtifact): boolean {
    return (
      isNativeInstallCandidate(artifact) &&
      CURSOR_CAPABILITY.acceptedManifestKinds.includes(artifact.manifestKind)
    );
  },
};
