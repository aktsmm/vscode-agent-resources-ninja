import * as path from "path";
import * as vscode from "vscode";
import {
  getMcpConfigConflictServerKeys,
  getMcpConfigServerKeys,
  JsonObject,
  McpConfigMutationResult,
  mergeMcpConfig,
  removeMcpConfigServers,
} from "./mcpConfig";

export interface McpConfigUpdateResult {
  changed: boolean;
  skipped: boolean;
  configUri: vscode.Uri;
  backupUri?: vscode.Uri;
  reason?: string;
  addedServers: string[];
  overwrittenServers: string[];
  removedServers: string[];
  skippedServers: string[];
  addedInputs: string[];
  skippedInputs: string[];
  dryRun?: boolean;
}

export interface McpConfigUpdateOptions {
  dryRun?: boolean;
  confirmOverwrite?: (
    serverKeys: string[],
    configUri: vscode.Uri,
  ) => Promise<string[]>;
}

export interface McpConfigLifecycleStatus {
  state: "staged" | "merged" | "stagedAndMerged" | "needsReview";
  stagedPath: string;
  targetPath?: string;
  serverKeys: string[];
  missingServerKeys: string[];
  reason?: string;
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(uri: vscode.Uri): Promise<JsonObject> {
  const content = await vscode.workspace.fs.readFile(uri);
  const parsed = JSON.parse(Buffer.from(content).toString("utf-8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${uri.fsPath} must contain a JSON object`);
  }
  return parsed as JsonObject;
}

async function createMcpJsonBackup(
  configUri: vscode.Uri,
): Promise<vscode.Uri | undefined> {
  try {
    const content = await vscode.workspace.fs.readFile(configUri);
    const timestamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
    const backupUri = vscode.Uri.file(
      path.join(path.dirname(configUri.fsPath), `mcp.json.bak-${timestamp}`),
    );
    await vscode.workspace.fs.writeFile(backupUri, content);
    return backupUri;
  } catch {
    return undefined;
  }
}

async function readWorkspaceMcpConfigOrBackup(
  configUri: vscode.Uri,
): Promise<{ config?: JsonObject; backupUri?: vscode.Uri }> {
  if (!(await fileExists(configUri))) {
    return {};
  }

  try {
    return { config: await readJsonFile(configUri) };
  } catch (error) {
    const backupUri = await createMcpJsonBackup(configUri);
    const reason = error instanceof Error ? error.message : String(error);
    const backupMessage = backupUri
      ? ` Backup created at ${backupUri.fsPath}.`
      : "";
    throw new Error(`Failed to parse mcp.json. ${reason}.${backupMessage}`);
  }
}

function createEmptyResult(
  configUri: vscode.Uri,
  reason?: string,
): McpConfigUpdateResult {
  return {
    changed: false,
    skipped: true,
    configUri,
    reason,
    addedServers: [],
    overwrittenServers: [],
    removedServers: [],
    skippedServers: [],
    addedInputs: [],
    skippedInputs: [],
  };
}

function toUpdateResult(
  configUri: vscode.Uri,
  mutation: McpConfigMutationResult,
  dryRun: boolean | undefined,
  backupUri?: vscode.Uri,
): McpConfigUpdateResult {
  return {
    changed: mutation.changed,
    skipped: false,
    configUri,
    backupUri,
    addedServers: mutation.addedServers,
    overwrittenServers: mutation.overwrittenServers,
    removedServers: mutation.removedServers,
    skippedServers: mutation.skippedServers,
    addedInputs: mutation.addedInputs,
    skippedInputs: mutation.skippedInputs,
    dryRun,
  };
}

export function getWorkspaceMcpConfigUri(workspaceUri: vscode.Uri): vscode.Uri {
  return vscode.Uri.joinPath(workspaceUri, ".vscode", "mcp.json");
}

export function formatMcpConfigUpdateSummary(
  result: McpConfigUpdateResult | undefined,
): string | undefined {
  if (!result) {
    return undefined;
  }
  if (result.skipped) {
    return `mcp.json skipped: ${result.reason || "no safe MCP server configuration was available"}`;
  }

  const parts = [
    result.addedServers.length
      ? `servers added: ${result.addedServers.join(", ")}`
      : "",
    result.overwrittenServers.length
      ? `servers overwritten: ${result.overwrittenServers.join(", ")}`
      : "",
    result.removedServers.length
      ? `servers removed: ${result.removedServers.join(", ")}`
      : "",
    result.skippedServers.length
      ? `servers skipped: ${result.skippedServers.join(", ")}`
      : "",
    result.addedInputs.length
      ? `inputs added: ${result.addedInputs.join(", ")}`
      : "",
    result.skippedInputs.length
      ? `inputs skipped: ${result.skippedInputs.join(", ")}`
      : "",
  ].filter(Boolean);

  if (parts.length === 0) {
    return "mcp.json unchanged";
  }
  const prefix = result.dryRun ? "mcp.json dry-run" : "mcp.json updated";
  return `${prefix}: ${parts.join("; ")}`;
}

export function formatMcpLifecycleLabel(
  status: McpConfigLifecycleStatus,
  isJa: boolean,
): string {
  switch (status.state) {
    case "stagedAndMerged":
      return isJa ? "確認用コピー + マージ済み" : "Staged + merged";
    case "merged":
      return isJa ? "マージ済み" : "Merged";
    case "needsReview":
      return isJa ? "確認が必要" : "Needs review";
    case "staged":
    default:
      return isJa ? "確認用コピー" : "Staged for review";
  }
}

export function formatMcpLifecycleTooltipLines(
  status: McpConfigLifecycleStatus,
  isJa: boolean,
): string[] {
  const stagedLabel = isJa ? "確認用コピー" : "Staged copy";
  const targetLabel = isJa ? "マージ先" : "Merge target";
  const serversLabel = isJa ? "MCP servers" : "MCP servers";
  const missingLabel = isJa ? "未マージ server" : "Unmerged servers";
  const reasonLabel = isJa ? "確認理由" : "Review reason";
  const lines = [`${stagedLabel}: ${status.stagedPath}`];
  if (status.targetPath) {
    lines.push(`${targetLabel}: ${status.targetPath}`);
  }
  if (status.serverKeys.length > 0) {
    lines.push(`${serversLabel}: ${status.serverKeys.join(", ")}`);
  }
  if (status.missingServerKeys.length > 0) {
    lines.push(`${missingLabel}: ${status.missingServerKeys.join(", ")}`);
  }
  if (status.reason) {
    lines.push(`${reasonLabel}: ${status.reason}`);
  }
  return lines;
}

export async function getMcpConfigLifecycleStatus(
  workspaceUri: vscode.Uri | undefined,
  installedMcpConfigUri: vscode.Uri,
): Promise<McpConfigLifecycleStatus> {
  let recommendedConfig: JsonObject;
  try {
    recommendedConfig = await readJsonFile(installedMcpConfigUri);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      state: "needsReview",
      stagedPath: installedMcpConfigUri.fsPath,
      serverKeys: [],
      missingServerKeys: [],
      reason: `installed MCP config is invalid: ${reason}`,
    };
  }

  let serverKeys: string[];
  try {
    serverKeys = getMcpConfigServerKeys(recommendedConfig);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      state: "needsReview",
      stagedPath: installedMcpConfigUri.fsPath,
      serverKeys: [],
      missingServerKeys: [],
      reason,
    };
  }

  if (!workspaceUri) {
    return {
      state: "staged",
      stagedPath: installedMcpConfigUri.fsPath,
      serverKeys,
      missingServerKeys: serverKeys,
    };
  }

  const targetUri = getWorkspaceMcpConfigUri(workspaceUri);
  if (!(await fileExists(targetUri))) {
    return {
      state: "staged",
      stagedPath: installedMcpConfigUri.fsPath,
      targetPath: targetUri.fsPath,
      serverKeys,
      missingServerKeys: serverKeys,
    };
  }

  let workspaceConfig: JsonObject;
  try {
    workspaceConfig = await readJsonFile(targetUri);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      state: "needsReview",
      stagedPath: installedMcpConfigUri.fsPath,
      targetPath: targetUri.fsPath,
      serverKeys,
      missingServerKeys: serverKeys,
      reason: `.vscode/mcp.json is invalid: ${reason}`,
    };
  }

  const workspaceServers = workspaceConfig.servers;
  const installedServers =
    typeof workspaceServers === "object" &&
    workspaceServers !== null &&
    !Array.isArray(workspaceServers)
      ? new Set(Object.keys(workspaceServers))
      : new Set<string>();
  const missingServerKeys = serverKeys.filter(
    (serverKey) => !installedServers.has(serverKey),
  );
  const merged = serverKeys.length > 0 && missingServerKeys.length === 0;
  return {
    state: merged ? "stagedAndMerged" : "staged",
    stagedPath: installedMcpConfigUri.fsPath,
    targetPath: targetUri.fsPath,
    serverKeys,
    missingServerKeys,
  };
}

export async function updateMcpConfigForInstall(
  workspaceUri: vscode.Uri,
  installedMcpConfigUri: vscode.Uri,
  options: McpConfigUpdateOptions = {},
): Promise<McpConfigUpdateResult> {
  const configUri = getWorkspaceMcpConfigUri(workspaceUri);
  let recommendedConfig: JsonObject;
  try {
    recommendedConfig = await readJsonFile(installedMcpConfigUri);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return createEmptyResult(
      configUri,
      `installed MCP config is invalid: ${reason}`,
    );
  }

  const { config: existingConfig } =
    await readWorkspaceMcpConfigOrBackup(configUri);
  let overwriteServerKeys: string[] = [];
  const conflicts = getMcpConfigConflictServerKeys(
    existingConfig,
    recommendedConfig,
  );

  if (conflicts.length > 0 && options.confirmOverwrite) {
    overwriteServerKeys = await options.confirmOverwrite(conflicts, configUri);
  }

  const mutation = mergeMcpConfig(
    existingConfig,
    recommendedConfig,
    overwriteServerKeys,
  );

  if (!mutation.changed) {
    return toUpdateResult(configUri, mutation, options.dryRun);
  }

  let backupUri: vscode.Uri | undefined;
  if (!options.dryRun) {
    await vscode.workspace.fs.createDirectory(
      vscode.Uri.joinPath(workspaceUri, ".vscode"),
    );
    if (await fileExists(configUri)) {
      backupUri = await createMcpJsonBackup(configUri);
    }
    await vscode.workspace.fs.writeFile(
      configUri,
      Buffer.from(`${JSON.stringify(mutation.config, null, 2)}\n`, "utf-8"),
    );
  }

  return toUpdateResult(configUri, mutation, options.dryRun, backupUri);
}

export async function updateMcpConfigForUninstall(
  workspaceUri: vscode.Uri,
  installedMcpConfigUri: vscode.Uri,
  serverKeysToRemove: string[],
  options: Pick<McpConfigUpdateOptions, "dryRun"> = {},
): Promise<McpConfigUpdateResult> {
  const configUri = getWorkspaceMcpConfigUri(workspaceUri);
  if (serverKeysToRemove.length === 0) {
    return createEmptyResult(
      configUri,
      "no MCP server keys were selected for removal",
    );
  }

  let recommendedConfig: JsonObject;
  try {
    recommendedConfig = await readJsonFile(installedMcpConfigUri);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return createEmptyResult(
      configUri,
      `installed MCP config is invalid: ${reason}`,
    );
  }

  const { config: existingConfig } =
    await readWorkspaceMcpConfigOrBackup(configUri);
  if (!existingConfig) {
    return createEmptyResult(configUri, ".vscode/mcp.json does not exist");
  }

  const mutation = removeMcpConfigServers(
    existingConfig,
    recommendedConfig,
    serverKeysToRemove,
  );

  if (!mutation.changed) {
    return toUpdateResult(configUri, mutation, options.dryRun);
  }

  let backupUri: vscode.Uri | undefined;
  if (!options.dryRun) {
    backupUri = await createMcpJsonBackup(configUri);
    await vscode.workspace.fs.writeFile(
      configUri,
      Buffer.from(`${JSON.stringify(mutation.config, null, 2)}\n`, "utf-8"),
    );
  }

  return toUpdateResult(configUri, mutation, options.dryRun, backupUri);
}
