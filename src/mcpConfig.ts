export type JsonObject = Record<string, unknown>;

export interface McpConfigChangeSummary {
  changed: boolean;
  addedServers: string[];
  overwrittenServers: string[];
  removedServers: string[];
  skippedServers: string[];
  addedInputs: string[];
  skippedInputs: string[];
}

export interface McpConfigMutationResult extends McpConfigChangeSummary {
  config: JsonObject;
}

function cloneJsonObject<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createEmptySummary(): McpConfigChangeSummary {
  return {
    changed: false,
    addedServers: [],
    overwrittenServers: [],
    removedServers: [],
    skippedServers: [],
    addedInputs: [],
    skippedInputs: [],
  };
}

function prepareExistingConfig(existingConfig: unknown): JsonObject {
  if (existingConfig === undefined) {
    return { servers: {} };
  }
  if (!isJsonObject(existingConfig)) {
    throw new Error("mcp.json root must be a JSON object");
  }

  const config = cloneJsonObject(existingConfig);
  if (config.servers === undefined) {
    config.servers = {};
  }
  if (!isJsonObject(config.servers)) {
    throw new Error("mcp.json servers property must be an object");
  }
  if (config.inputs !== undefined && !Array.isArray(config.inputs)) {
    throw new Error("mcp.json inputs property must be an array");
  }
  return config;
}

function getRecommendedServers(
  recommendedConfig: JsonObject,
): Record<string, JsonObject> {
  const serverSources = [
    recommendedConfig.servers,
    recommendedConfig.mcpServers,
  ];
  const servers: Record<string, JsonObject> = {};

  for (const source of serverSources) {
    if (source === undefined) {
      continue;
    }
    if (!isJsonObject(source)) {
      throw new Error(
        "Recommended MCP config servers/mcpServers property must be an object",
      );
    }
    for (const [serverKey, serverConfig] of Object.entries(source)) {
      if (isJsonObject(serverConfig)) {
        servers[serverKey] = cloneJsonObject(serverConfig);
      }
    }
  }

  if (Object.keys(servers).length === 0) {
    throw new Error(
      "Recommended MCP config must contain servers or mcpServers",
    );
  }
  return servers;
}

export function getMcpConfigServerKeys(
  recommendedConfig: JsonObject,
): string[] {
  return Object.keys(getRecommendedServers(recommendedConfig));
}

function getRecommendedInputs(recommendedConfig: JsonObject): JsonObject[] {
  if (recommendedConfig.inputs === undefined) {
    return [];
  }
  if (!Array.isArray(recommendedConfig.inputs)) {
    throw new Error("Recommended MCP config inputs property must be an array");
  }
  return recommendedConfig.inputs.filter(isJsonObject).map(cloneJsonObject);
}

function getInputId(input: JsonObject): string | undefined {
  const id = input.id;
  return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

export function getMcpConfigConflictServerKeys(
  existingConfig: unknown,
  recommendedConfig: JsonObject,
): string[] {
  const existing = prepareExistingConfig(existingConfig);
  const existingServers = existing.servers as Record<string, unknown>;
  const recommendedServers = getRecommendedServers(recommendedConfig);
  return Object.keys(recommendedServers).filter((serverKey) =>
    Object.hasOwn(existingServers, serverKey),
  );
}

export function mergeMcpConfig(
  existingConfig: unknown,
  recommendedConfig: JsonObject,
  overwriteServerKeys: Iterable<string> = [],
): McpConfigMutationResult {
  const config = prepareExistingConfig(existingConfig);
  const servers = config.servers as Record<string, unknown>;
  const recommendedServers = getRecommendedServers(recommendedConfig);
  const overwriteSet = new Set(overwriteServerKeys);
  const summary = createEmptySummary();

  for (const [serverKey, serverConfig] of Object.entries(recommendedServers)) {
    if (Object.hasOwn(servers, serverKey)) {
      if (!overwriteSet.has(serverKey)) {
        summary.skippedServers.push(serverKey);
        continue;
      }
      servers[serverKey] = serverConfig;
      summary.overwrittenServers.push(serverKey);
      summary.changed = true;
      continue;
    }

    servers[serverKey] = serverConfig;
    summary.addedServers.push(serverKey);
    summary.changed = true;
  }

  const recommendedInputs = getRecommendedInputs(recommendedConfig);
  if (recommendedInputs.length > 0) {
    const inputs = Array.isArray(config.inputs) ? config.inputs : [];
    const existingInputIds = new Set(
      inputs.filter(isJsonObject).map(getInputId).filter(Boolean),
    );

    for (const input of recommendedInputs) {
      const inputId = getInputId(input);
      if (!inputId) {
        inputs.push(input);
        summary.addedInputs.push("<anonymous>");
        summary.changed = true;
        continue;
      }
      if (existingInputIds.has(inputId)) {
        summary.skippedInputs.push(inputId);
        continue;
      }
      inputs.push(input);
      existingInputIds.add(inputId);
      summary.addedInputs.push(inputId);
      summary.changed = true;
    }

    if (summary.addedInputs.length > 0) {
      config.inputs = inputs;
    }
  }

  return { config, ...summary };
}

export function removeMcpConfigServers(
  existingConfig: unknown,
  recommendedConfig: JsonObject,
  serverKeysToRemove: Iterable<string>,
): McpConfigMutationResult {
  const config = prepareExistingConfig(existingConfig);
  const servers = config.servers as Record<string, unknown>;
  const recommendedServers = getRecommendedServers(recommendedConfig);
  const removableKeys = new Set(serverKeysToRemove);
  const summary = createEmptySummary();

  for (const serverKey of Object.keys(recommendedServers)) {
    if (!removableKeys.has(serverKey)) {
      summary.skippedServers.push(serverKey);
      continue;
    }
    if (!Object.hasOwn(servers, serverKey)) {
      summary.skippedServers.push(serverKey);
      continue;
    }
    delete servers[serverKey];
    summary.removedServers.push(serverKey);
    summary.changed = true;
  }

  return { config, ...summary };
}
