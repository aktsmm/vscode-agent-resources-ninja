import { PluginHostCapability } from "./types";

export const GEMINI_CLI_EVALUATION: PluginHostCapability = {
  id: "gemini-cli",
  displayName: "Gemini CLI",
  supportLevel: "unsupported",
  surfaces: ["cli"],
  actions: [],
  scopes: [],
  acceptedManifestKinds: ["gemini-extension"],
  executableNames: ["gemini"],
};

export const CLINE_CLI_EVALUATION: PluginHostCapability = {
  id: "cline-cli",
  displayName: "Cline CLI",
  supportLevel: "unsupported",
  surfaces: ["cli"],
  actions: [],
  scopes: [],
  acceptedManifestKinds: [],
  executableNames: ["cline"],
};

export const PORTABLE_RESOURCES_EVALUATION: PluginHostCapability = {
  id: "portable-resources",
  displayName: "Portable Agent Resources",
  supportLevel: "resources-only",
  surfaces: ["vscode-extension", "editor", "cli"],
  actions: [],
  scopes: ["user", "project", "local"],
  acceptedManifestKinds: [],
};

export const EVALUATED_FUTURE_HOSTS = [
  GEMINI_CLI_EVALUATION,
  CLINE_CLI_EVALUATION,
  PORTABLE_RESOURCES_EVALUATION,
] as const;
