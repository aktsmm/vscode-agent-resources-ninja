import * as path from "path";
import * as vscode from "vscode";
import {
  getFallbackRecommendedHookConfig,
  HookConfigMutationResult,
  JsonObject,
  mergeHookConfig,
  removeHookConfig,
} from "./hookConfig";

export interface HookConfigUpdateResult {
  operation: "install" | "uninstall";
  changed: boolean;
  skipped: boolean;
  configUri: vscode.Uri;
  backupUri?: vscode.Uri;
  reason?: string;
  source?: "hooks.json" | "readme" | "known" | "none";
  addedByEvent: Record<string, number>;
  removedByEvent: Record<string, number>;
  reorderedEvents: string[];
  dryRun?: boolean;
}

export interface HookConfigUpdateOptions {
  dryRun?: boolean;
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function getParentDirectoryUri(resourceUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.file(path.dirname(resourceUri.fsPath));
}

function getUriBasename(uri: vscode.Uri): string {
  return path.basename(uri.fsPath);
}

function toWorkspaceRelativePath(
  rootUri: vscode.Uri,
  childUri: vscode.Uri,
): string {
  const relative = path.relative(rootUri.fsPath, childUri.fsPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return getUriBasename(childUri);
  }
  return relative.replace(/\\/g, "/");
}

function createEmptyMutationResult(
  config: JsonObject,
): HookConfigMutationResult {
  return {
    config,
    changed: false,
    addedByEvent: {},
    removedByEvent: {},
    reorderedEvents: [],
  };
}

async function readJsonFile(uri: vscode.Uri): Promise<JsonObject> {
  const content = await vscode.workspace.fs.readFile(uri);
  const parsed = JSON.parse(Buffer.from(content).toString("utf-8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${uri.fsPath} must contain a JSON object`);
  }
  return parsed as JsonObject;
}

async function createHooksJsonBackup(
  configUri: vscode.Uri,
): Promise<vscode.Uri | undefined> {
  try {
    const content = await vscode.workspace.fs.readFile(configUri);
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
    const backupUri = vscode.Uri.file(
      path.join(path.dirname(configUri.fsPath), `hooks.json.bak-${timestamp}`),
    );
    await vscode.workspace.fs.writeFile(backupUri, content);
    return backupUri;
  } catch {
    return undefined;
  }
}

async function readRootHooksConfigOrBackup(
  configUri: vscode.Uri,
): Promise<{ config?: JsonObject; backupUri?: vscode.Uri }> {
  if (!(await fileExists(configUri))) {
    return {};
  }

  try {
    return { config: await readJsonFile(configUri) };
  } catch (error) {
    const backupUri = await createHooksJsonBackup(configUri);
    const reason = error instanceof Error ? error.message : String(error);
    const backupMessage = backupUri
      ? ` Backup created at ${backupUri.fsPath}.`
      : "";
    throw new Error(`Failed to parse hooks.json. ${reason}.${backupMessage}`);
  }
}

async function loadRecommendedHookConfig(
  hookDirectoryUri: vscode.Uri,
  hookId: string,
): Promise<{
  config?: JsonObject;
  source: "hooks.json" | "readme" | "known" | "none";
  reason?: string;
}> {
  const recommendedUri = vscode.Uri.joinPath(hookDirectoryUri, "hooks.json");
  if (await fileExists(recommendedUri)) {
    try {
      return {
        config: await readJsonFile(recommendedUri),
        source: "hooks.json",
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        source: "none",
        reason: `Installed hook contains an invalid hooks.json: ${reason}`,
      };
    }
  }

  let readmeText: string | undefined;
  try {
    const readme = await vscode.workspace.fs.readFile(
      vscode.Uri.joinPath(hookDirectoryUri, "README.md"),
    );
    readmeText = Buffer.from(readme).toString("utf-8");
  } catch {
    // README is optional for the fallback chain.
  }

  return getFallbackRecommendedHookConfig(hookId, readmeText);
}

function toUpdateResult(
  operation: "install" | "uninstall",
  configUri: vscode.Uri,
  mutation: HookConfigMutationResult,
  source: "hooks.json" | "readme" | "known" | "none",
  options: HookConfigUpdateOptions,
): HookConfigUpdateResult {
  return {
    operation,
    changed: mutation.changed,
    skipped: false,
    configUri,
    source,
    addedByEvent: mutation.addedByEvent,
    removedByEvent: mutation.removedByEvent,
    reorderedEvents: mutation.reorderedEvents,
    dryRun: options.dryRun,
  };
}

export function formatHookConfigUpdateSummary(
  result: HookConfigUpdateResult | undefined,
): string | undefined {
  if (!result) {
    return undefined;
  }
  if (result.skipped) {
    return `hooks.json skipped: ${result.reason || "no safe hook configuration was available"}`;
  }

  const added = Object.entries(result.addedByEvent)
    .map(([event, count]) => `${event}+${count}`)
    .join(", ");
  const removed = Object.entries(result.removedByEvent)
    .map(([event, count]) => `${event}-${count}`)
    .join(", ");
  const reordered = result.reorderedEvents
    .map((event) => `${event} reordered`)
    .join(", ");
  const parts = [added, removed, reordered].filter(Boolean);
  if (parts.length === 0) {
    return "hooks.json unchanged";
  }
  const prefix = result.dryRun ? "hooks.json dry-run" : "hooks.json updated";
  return `${prefix}: ${parts.join("; ")}`;
}

async function updateHookConfig(
  operation: "install" | "uninstall",
  configRootUri: vscode.Uri,
  hookReadmeUri: vscode.Uri,
  options: HookConfigUpdateOptions = {},
): Promise<HookConfigUpdateResult> {
  const hookDirectoryUri = getParentDirectoryUri(hookReadmeUri);
  const hookId = getUriBasename(hookDirectoryUri);
  const configUri = vscode.Uri.joinPath(configRootUri, "hooks.json");
  const recommended = await loadRecommendedHookConfig(hookDirectoryUri, hookId);

  if (!recommended.config) {
    return {
      operation,
      changed: false,
      skipped: true,
      configUri,
      source: recommended.source,
      reason: recommended.reason,
      addedByEvent: {},
      removedByEvent: {},
      reorderedEvents: [],
      dryRun: options.dryRun,
    };
  }

  const { config: existingConfig } =
    await readRootHooksConfigOrBackup(configUri);
  if (operation === "uninstall" && existingConfig === undefined) {
    return {
      operation,
      changed: false,
      skipped: false,
      configUri,
      source: recommended.source,
      addedByEvent: {},
      removedByEvent: {},
      reorderedEvents: [],
      dryRun: options.dryRun,
    };
  }

  const installedHookDirectory = toWorkspaceRelativePath(
    configRootUri,
    hookDirectoryUri,
  );
  const mutation =
    operation === "install"
      ? mergeHookConfig(
          existingConfig,
          recommended.config,
          hookId,
          installedHookDirectory,
        )
      : removeHookConfig(
          existingConfig,
          recommended.config,
          hookId,
          installedHookDirectory,
        );

  if (mutation.changed && !options.dryRun) {
    await vscode.workspace.fs.writeFile(
      configUri,
      Buffer.from(`${JSON.stringify(mutation.config, null, 2)}\n`, "utf-8"),
    );
  }

  return toUpdateResult(
    operation,
    configUri,
    mutation.changed ? mutation : createEmptyMutationResult(mutation.config),
    recommended.source,
    options,
  );
}

export async function updateHookConfigForInstall(
  configRootUri: vscode.Uri,
  hookReadmeUri: vscode.Uri,
  options: HookConfigUpdateOptions = {},
): Promise<HookConfigUpdateResult> {
  return updateHookConfig("install", configRootUri, hookReadmeUri, options);
}

export async function updateHookConfigForUninstall(
  configRootUri: vscode.Uri,
  hookReadmeUri: vscode.Uri,
  options: HookConfigUpdateOptions = {},
): Promise<HookConfigUpdateResult> {
  return updateHookConfig("uninstall", configRootUri, hookReadmeUri, options);
}
