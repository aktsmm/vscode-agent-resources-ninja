export type JsonObject = Record<string, unknown>;

export interface HookConfigChangeSummary {
  changed: boolean;
  addedByEvent: Record<string, number>;
  removedByEvent: Record<string, number>;
  reorderedEvents: string[];
}

export interface HookConfigMutationResult extends HookConfigChangeSummary {
  config: JsonObject;
}

export interface RecommendedHookConfigResult {
  config?: JsonObject;
  source: "hooks.json" | "readme" | "known" | "none";
  reason?: string;
}

const COMMAND_KEYS = ["bash", "command", "pwsh", "powershell", "python"];

const HOOK_ORDER_BY_EVENT: Record<string, string[]> = {
  preToolUse: ["tool-guardian", "governance-audit"],
  userPromptSubmitted: ["governance-audit", "session-logger"],
  sessionStart: ["governance-audit", "session-logger"],
  sessionEnd: [
    "secrets-scanner",
    "dependency-license-checker",
    "governance-audit",
    "session-logger",
    "session-auto-commit",
  ],
};

const KNOWN_HOOK_CONFIGS: Record<string, JsonObject> = {
  "dependency-license-checker": {
    version: 1,
    hooks: {
      sessionEnd: [
        {
          type: "command",
          bash: ".github/hooks/dependency-license-checker/check-licenses.sh",
          cwd: ".",
          env: { LICENSE_MODE: "warn" },
          timeoutSec: 60,
        },
      ],
    },
  },
  "governance-audit": {
    version: 1,
    hooks: {
      sessionStart: [
        {
          type: "command",
          bash: ".github/hooks/governance-audit/audit-session-start.sh",
          cwd: ".",
          timeoutSec: 5,
        },
      ],
      userPromptSubmitted: [
        {
          type: "command",
          bash: ".github/hooks/governance-audit/audit-prompt.sh",
          cwd: ".",
          env: {
            GOVERNANCE_LEVEL: "standard",
            BLOCK_ON_THREAT: "false",
          },
          timeoutSec: 10,
        },
      ],
      sessionEnd: [
        {
          type: "command",
          bash: ".github/hooks/governance-audit/audit-session-end.sh",
          cwd: ".",
          timeoutSec: 5,
        },
      ],
    },
  },
  "secrets-scanner": {
    version: 1,
    hooks: {
      sessionEnd: [
        {
          type: "command",
          bash: ".github/hooks/secrets-scanner/scan-secrets.sh",
          cwd: ".",
          env: { SCAN_MODE: "warn", SCAN_SCOPE: "diff" },
          timeoutSec: 30,
        },
      ],
    },
  },
  "session-auto-commit": {
    version: 1,
    hooks: {
      sessionEnd: [
        {
          type: "command",
          bash: ".github/hooks/session-auto-commit/auto-commit.sh",
          cwd: ".",
          timeoutSec: 30,
        },
      ],
    },
  },
  "session-logger": {
    version: 1,
    hooks: {
      sessionStart: [
        {
          type: "command",
          bash: ".github/hooks/session-logger/log-session-start.sh",
          cwd: ".",
          timeoutSec: 5,
        },
      ],
      userPromptSubmitted: [
        {
          type: "command",
          bash: ".github/hooks/session-logger/log-prompt.sh",
          cwd: ".",
          env: { LOG_LEVEL: "INFO" },
          timeoutSec: 5,
        },
      ],
      sessionEnd: [
        {
          type: "command",
          bash: ".github/hooks/session-logger/log-session-end.sh",
          cwd: ".",
          timeoutSec: 5,
        },
      ],
    },
  },
  "tool-guardian": {
    version: 1,
    hooks: {
      preToolUse: [
        {
          type: "command",
          matcher: "^bash$",
          bash: "hooks/tool-guardian/guard-tool.sh",
          cwd: ".",
          env: { GUARD_MODE: "block" },
          timeoutSec: 10,
        },
      ],
    },
  },
};

function cloneJsonObject<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function normalizeInstalledHookDirectory(value: string): string {
  return normalizePath(value).replace(/^\/+|\/+$/g, "");
}

function rewriteHookCommandPath(
  value: string,
  hookId: string,
  installedHookDirectory: string,
): string {
  const normalizedValue = normalizePath(value);
  const normalizedHookId = hookId.toLowerCase();
  const normalizedInstalled = normalizeInstalledHookDirectory(
    installedHookDirectory,
  );
  const prefixes = [
    `.github/hooks/${normalizedHookId}/`,
    `hooks/${normalizedHookId}/`,
    `${normalizedHookId}/`,
  ];
  const lowerValue = normalizedValue.toLowerCase();
  const matchedPrefix = prefixes.find((prefix) =>
    lowerValue.startsWith(prefix),
  );
  if (!matchedPrefix) {
    return normalizedValue;
  }
  return `${normalizedInstalled}/${normalizedValue.slice(matchedPrefix.length)}`;
}

function normalizeHookEntry(
  entry: JsonObject,
  hookId: string,
  installedHookDirectory: string,
): JsonObject {
  const normalized = cloneJsonObject(entry);
  for (const key of COMMAND_KEYS) {
    const value = normalized[key];
    if (typeof value === "string") {
      normalized[key] = rewriteHookCommandPath(
        value,
        hookId,
        installedHookDirectory,
      );
    }
  }
  return normalized;
}

function getRecommendedHooks(config: JsonObject): Record<string, JsonObject[]> {
  const hooks = config.hooks;
  if (!isJsonObject(hooks)) {
    throw new Error("Recommended hook config must contain a hooks object");
  }

  const normalized: Record<string, JsonObject[]> = {};
  for (const [eventName, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) {
      throw new Error(`Recommended hooks.${eventName} must be an array`);
    }
    const objectEntries = entries.filter(isJsonObject);
    if (objectEntries.length > 0) {
      normalized[eventName] = objectEntries;
    }
  }
  return normalized;
}

function prepareExistingConfig(existingConfig: unknown): JsonObject {
  if (existingConfig === undefined) {
    return { version: 1, hooks: {} };
  }
  if (!isJsonObject(existingConfig)) {
    throw new Error("hooks.json root must be a JSON object");
  }
  const config = cloneJsonObject(existingConfig);
  if (config.hooks === undefined) {
    config.hooks = {};
  }
  if (!isJsonObject(config.hooks)) {
    throw new Error("hooks.json hooks property must be an object");
  }
  return config;
}

function getEntryCommand(entry: JsonObject): string | undefined {
  for (const key of COMMAND_KEYS) {
    const value = entry[key];
    if (typeof value === "string" && value.trim()) {
      return normalizePath(value.trim());
    }
  }
  const url = entry.url;
  if (typeof url === "string" && url.trim()) {
    return url.trim();
  }
  return undefined;
}

export function getHookConfigEventCounts(
  config: JsonObject,
): Record<string, number> {
  const hooks = getRecommendedHooks(config);
  return Object.fromEntries(
    Object.entries(hooks).map(([eventName, entries]) => [
      eventName,
      entries.length,
    ]),
  );
}

export function getHookConfigCommandPaths(config: JsonObject): string[] {
  const hooks = getRecommendedHooks(config);
  const commands: string[] = [];
  for (const entries of Object.values(hooks)) {
    for (const entry of entries) {
      const command = getEntryCommand(entry);
      if (command) {
        commands.push(command);
      }
    }
  }
  return commands;
}

function getHookEntryIdentity(eventName: string, entry: JsonObject): string {
  const type = typeof entry.type === "string" ? entry.type : "command";
  const matcher = typeof entry.matcher === "string" ? entry.matcher : "";
  const command = getEntryCommand(entry);
  if (command) {
    return `${eventName}\u0000${type}\u0000${matcher}\u0000${command}`;
  }
  return `${eventName}\u0000${JSON.stringify(entry)}`;
}

function getHookIdFromEntry(entry: JsonObject): string | undefined {
  const command = getEntryCommand(entry);
  if (!command) {
    return undefined;
  }
  const match = normalizePath(command)
    .toLowerCase()
    .match(/(?:^|\/)(?:\.github\/)?hooks\/([^/]+)\//);
  return match?.[1];
}

function getEntryPriority(eventName: string, entry: JsonObject): number {
  const order = HOOK_ORDER_BY_EVENT[eventName];
  const hookId = getHookIdFromEntry(entry);
  if (!order || !hookId) {
    return 50;
  }
  const index = order.indexOf(hookId);
  return index >= 0 ? index * 10 : 50;
}

function sortEventEntries(
  eventName: string,
  entries: JsonObject[],
): JsonObject[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const priorityDiff =
        getEntryPriority(eventName, left.entry) -
        getEntryPriority(eventName, right.entry);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return left.index - right.index;
    })
    .map(({ entry }) => entry);
}

function identities(entries: JsonObject[], eventName: string): string[] {
  return entries.map((entry) => getHookEntryIdentity(eventName, entry));
}

function createEmptySummary(): HookConfigChangeSummary {
  return {
    changed: false,
    addedByEvent: {},
    removedByEvent: {},
    reorderedEvents: [],
  };
}

export function normalizeRecommendedHookConfig(
  recommendedConfig: JsonObject,
  hookId: string,
  installedHookDirectory: string,
): JsonObject {
  const hooks = getRecommendedHooks(recommendedConfig);
  const normalizedHooks: Record<string, JsonObject[]> = {};
  for (const [eventName, entries] of Object.entries(hooks)) {
    normalizedHooks[eventName] = entries.map((entry) =>
      normalizeHookEntry(entry, hookId, installedHookDirectory),
    );
  }
  return {
    version: recommendedConfig.version ?? 1,
    hooks: normalizedHooks,
  };
}

export function mergeHookConfig(
  existingConfig: unknown,
  recommendedConfig: JsonObject,
  hookId: string,
  installedHookDirectory: string,
): HookConfigMutationResult {
  const config = prepareExistingConfig(existingConfig);
  const hooks = config.hooks as Record<string, unknown>;
  const recommended = getRecommendedHooks(
    normalizeRecommendedHookConfig(
      recommendedConfig,
      hookId,
      installedHookDirectory,
    ),
  );
  const summary = createEmptySummary();

  for (const [eventName, recommendedEntries] of Object.entries(recommended)) {
    const existingEntries = hooks[eventName];
    if (existingEntries === undefined) {
      hooks[eventName] = [];
    } else if (!Array.isArray(existingEntries)) {
      throw new Error(`hooks.json hooks.${eventName} must be an array`);
    }

    const targetEntries = hooks[eventName] as unknown[];
    const existingObjectEntries = targetEntries.filter(isJsonObject);
    const existingIds = new Set(
      existingObjectEntries.map((entry) =>
        getHookEntryIdentity(eventName, entry),
      ),
    );

    for (const recommendedEntry of recommendedEntries) {
      const identity = getHookEntryIdentity(eventName, recommendedEntry);
      if (!existingIds.has(identity)) {
        targetEntries.push(recommendedEntry);
        existingIds.add(identity);
        summary.addedByEvent[eventName] =
          (summary.addedByEvent[eventName] || 0) + 1;
        summary.changed = true;
      }
    }

    const beforeIds = identities(targetEntries.filter(isJsonObject), eventName);
    const sortedEntries = sortEventEntries(
      eventName,
      targetEntries.filter(isJsonObject),
    );
    const afterIds = identities(sortedEntries, eventName);
    if (beforeIds.join("\u0000") !== afterIds.join("\u0000")) {
      hooks[eventName] = sortedEntries;
      summary.reorderedEvents.push(eventName);
      summary.changed = true;
    }
  }

  return { config, ...summary };
}

export function removeHookConfig(
  existingConfig: unknown,
  recommendedConfig: JsonObject,
  hookId: string,
  installedHookDirectory: string,
): HookConfigMutationResult {
  const config = prepareExistingConfig(existingConfig);
  const hooks = config.hooks as Record<string, unknown>;
  const recommended = getRecommendedHooks(
    normalizeRecommendedHookConfig(
      recommendedConfig,
      hookId,
      installedHookDirectory,
    ),
  );
  const summary = createEmptySummary();

  for (const [eventName, recommendedEntries] of Object.entries(recommended)) {
    const existingEntries = hooks[eventName];
    if (existingEntries === undefined) {
      continue;
    }
    if (!Array.isArray(existingEntries)) {
      throw new Error(`hooks.json hooks.${eventName} must be an array`);
    }

    const removalIds = new Set(
      recommendedEntries.map((entry) => getHookEntryIdentity(eventName, entry)),
    );
    const beforeLength = existingEntries.length;
    const remaining = existingEntries.filter((entry) => {
      if (!isJsonObject(entry)) {
        return true;
      }
      return !removalIds.has(getHookEntryIdentity(eventName, entry));
    });

    const removed = beforeLength - remaining.length;
    if (removed > 0) {
      summary.removedByEvent[eventName] = removed;
      summary.changed = true;
      if (remaining.length === 0) {
        delete hooks[eventName];
      } else {
        hooks[eventName] = remaining;
      }
    }
  }

  return { config, ...summary };
}

export function extractRecommendedHookConfigFromReadme(
  readmeText: string,
): JsonObject | undefined {
  const fencedJsonBlocks = readmeText.matchAll(/```json\s*([\s\S]*?)```/gi);
  for (const block of fencedJsonBlocks) {
    try {
      const parsed = JSON.parse(block[1]) as unknown;
      if (isJsonObject(parsed) && isJsonObject(parsed.hooks)) {
        getRecommendedHooks(parsed);
        return parsed;
      }
    } catch {
      // Keep scanning later JSON examples.
    }
  }
  return undefined;
}

export function getKnownRecommendedHookConfig(
  hookId: string,
): JsonObject | undefined {
  const known = KNOWN_HOOK_CONFIGS[hookId.toLowerCase()];
  return known ? cloneJsonObject(known) : undefined;
}

export function getFallbackRecommendedHookConfig(
  hookId: string,
  readmeText?: string,
): RecommendedHookConfigResult {
  if (readmeText) {
    const fromReadme = extractRecommendedHookConfigFromReadme(readmeText);
    if (fromReadme) {
      return { config: fromReadme, source: "readme" };
    }
  }

  const known = getKnownRecommendedHookConfig(hookId);
  if (known) {
    return { config: known, source: "known" };
  }

  return {
    source: "none",
    reason:
      "No hooks.json, README JSON example, or known safe fallback was available for this hook.",
  };
}
