import { copilotCliAdapter } from "./adapters/copilotCli";
import { claudeCodeAdapter } from "./adapters/claudeCode";
import { codexAdapter } from "./adapters/codex";
import { cursorAdapter } from "./adapters/cursor";
import { vscodeCopilotAdapter } from "./adapters/vscodeCopilot";
import { PluginHostAdapter, PluginHostId } from "./types";

const ENABLED_NATIVE_HOSTS = new Set<PluginHostId>([
  "vscode-copilot",
  "copilot-cli",
  "claude-code",
  "codex",
  "cursor",
]);

export class PluginHostRegistry {
  private readonly adapters = new Map<PluginHostId, PluginHostAdapter>();

  register(adapter: PluginHostAdapter): void {
    const { id, supportLevel } = adapter.capability;
    if (this.adapters.has(id)) {
      throw new Error(`Plugin host adapter is already registered: ${id}`);
    }
    if (supportLevel === "native" && !ENABLED_NATIVE_HOSTS.has(id)) {
      throw new Error(`Native plugin host is not enabled: ${id}`);
    }
    this.adapters.set(id, adapter);
  }

  get(id: PluginHostId): PluginHostAdapter | undefined {
    return this.adapters.get(id);
  }

  list(): PluginHostAdapter[] {
    return Array.from(this.adapters.values());
  }
}

export function createBaselinePluginHostRegistry(): PluginHostRegistry {
  const registry = new PluginHostRegistry();
  registry.register(vscodeCopilotAdapter);
  registry.register(copilotCliAdapter);
  registry.register(claudeCodeAdapter);
  registry.register(codexAdapter);
  registry.register(cursorAdapter);
  return registry;
}
