import * as path from "path";
import * as vscode from "vscode";
import {
  getMcpConfigConflictServerKeys,
  JsonObject,
  McpConfigMutationResult,
  mergeMcpConfig,
} from "./mcpConfig";

export interface McpConfigUpdateResult {
  changed: boolean;
  skipped: boolean;
  configUri: vscode.Uri;
  backupUri?: vscode.Uri;
  reason?: string;
  addedServers: string[];
  overwrittenServers: string[];
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
