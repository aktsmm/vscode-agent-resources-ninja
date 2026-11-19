import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";
import {
  classifyRevision,
  createRevisionResolver,
  matchesGitBlob,
  parseSourceRevision,
  RevisionFile,
  RevisionResolver,
  SourceRevision,
} from "./resourceRevision";
import {
  directoryMatchesRevision,
  downloadDirectory,
  fetchFileBytes,
  refreshSingleSkillMetadata,
  stripSkillMetaLocalPaths,
} from "./skillInstaller";
import { isSafePathSegment } from "./pathSafety";
import {
  getConfiguredAdditionalSkillRoots,
  getConfiguredSkillsDirectory,
  resolveConfiguredUri,
} from "./customizationPaths";
import { isGitHubResponseError } from "./githubResponse";
import { encodeGitHubPathForUrl, encodeGitRefForPath } from "./gitHubRefSafety";

const execFileAsync = promisify(execFile);
const MAX_FILE = 20 * 1024 * 1024;
const MAX_TOTAL = 100 * 1024 * 1024;
const MAX_ENTRIES = 10000;
const META = ".skill-meta.json";
const PREPARE_REASONS = new Set([
  "linked-or-invalid-directory", "outside-workspace", "network-location",
  "known-synchronized-location", "different-volume", "unknown-volume",
  "network-or-unknown-volume", "unknown-share-status", "shared-location",
  "invalid-skills-root", "unknown-extension-host", "remote-extension-host",
  "workspace-not-open", "unknown-skills-roots", "transaction-inside-skills-root",
  "target-not-in-skills-root", "no-safe-transaction-location", "tree-too-deep",
  "unsafe-tree", "linked-or-special-entry", "identity-unavailable", "identity-changed",
  "unsafe-or-oversize-file", "file-changed", "invalid-metadata", "missing-metadata",
  "unsupported-blob", "invalid-or-local-baseline", "different-source",
  "unsupported-baseline", "target-changed-during-prepare", "candidate-verification-failed",
  "pending-recovery",
]);
const APPLY_REASONS = new Set([
  ...PREPARE_REASONS, "dirty-or-unknown-document", "snapshot-changed",
  "backup-changed-during-switch", "post-switch-verification-failed",
]);
const PREVIEW_REASONS = new Set([
  "invalid-preview-candidate", "update-in-progress", "preview-snapshot-changed",
  "invalid-preview-path", "preview-file-not-found", "remote-extension-host",
  "unknown-extension-host",
]);
const CLEANUP_CODES = new Set(["EACCES", "EPERM", "ENOTEMPTY", "EBUSY", "ENOENT"]);

function safeReason(error: unknown, allowed: ReadonlySet<string>, fallback: string): string {
  return error instanceof Error && allowed.has(error.message) ? error.message : fallback;
}

function cleanupReason(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (typeof code === "string" && CLEANUP_CODES.has(code)) { return code; }
  return safeReason(error, new Set(["cleanup-ownership-unknown", "identity-changed", "identity-unavailable"]), "cleanup-failed");
}

export interface WorkspaceSkillLocalChange {
  path: string;
  kind: "added" | "deleted" | "modified";
}

export interface WorkspaceSkillCandidate {
  readonly id: string;
  readonly firstSync: boolean;
  readonly target: vscode.Uri;
  readonly revision: Readonly<SourceRevision>;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly localChanges: readonly WorkspaceSkillLocalChange[];
  /** Show this uncertainty in the ordinary update confirmation. */
  readonly synchronization: "unknown";
  /** Local sharing can also be configured outside the checks below. */
  readonly sharing: "unknown";
  /** Retain this location for recovery if the host exits during application. */
  readonly recoveryDirectory: vscode.Uri;
}

export interface WorkspaceSkillPreviewFile {
  path: string;
  local: boolean;
  staged: boolean;
}

export type WorkspaceSkillPrepareResult =
  | { status: "ready"; candidate: WorkspaceSkillCandidate }
  | {
      status: "unchanged";
      revision: Readonly<SourceRevision>;
      metadata: Readonly<Record<string, unknown>>;
      localChanges: readonly WorkspaceSkillLocalChange[];
      synchronization: "unknown";
      sharing: "unknown";
    }
  | { status: "blocked"; reason: string; failureKind: "rate-limit" | "other"; directory?: vscode.Uri }
  | {
      status: "cleanup-required"; reason: string; failureKind: "rate-limit" | "other";
      cleanupReason: string; directory: vscode.Uri;
    };

export type WorkspaceSkillApplyResult =
  | { status: "updated"; backup?: vscode.Uri }
  | { status: "blocked"; reason: string }
  | { status: "rolled-back"; reason: string; backup?: vscode.Uri }
  | { status: "recovery-required"; reason: string; backup: vscode.Uri };

export type DirtyDocumentGuard = (
  target: vscode.Uri,
) => Promise<"clean" | "dirty" | "unknown">;

export interface WorkspaceSkillUpdateOptions {
  workspace: vscode.Uri;
  target: vscode.Uri;
  /**
   * Return every additional skills root scanned outside open workspaces,
   * including sibling/global roots. Reject rather than guess if incomplete.
   */
  getSkillsRoots: () => Promise<readonly vscode.Uri[]>;
  token?: string;
  /** Present only for an explicitly requested first sync of a legacy install. */
  initialRevision?: SourceRevision;
  sourceId?: string;
}

export interface WorkspaceSkillApproval {
  /** Set only after the user confirms this exact candidate. */
  candidateId: string;
  mode: "single" | "bulk";
  overwriteLocalChanges?: boolean;
}

interface Entry {
  type: "file" | "directory";
  hash?: string;
}

interface Snapshot {
  entries: Map<string, Entry>;
  metadata: Uint8Array;
  metadataObject: Record<string, unknown>;
  rootIdentity: FileIdentity;
  identities: Map<string, FileIdentity>;
}

interface FileIdentity {
  dev: bigint;
  ino: bigint;
}

interface OwnedEntry {
  identity: FileIdentity;
  type: "file" | "directory";
  hash?: string;
}

interface OwnedTree {
  root: FileIdentity;
  entries: Map<string, OwnedEntry>;
}

interface InternalCandidate {
  root: string;
  target: string;
  transaction: string;
  stage: string;
  baseline: Snapshot;
  staged: Snapshot;
  transactionIdentity: FileIdentity;
  revision: SourceRevision;
  localChanges: WorkspaceSkillLocalChange[];
  firstSync: boolean;
  getSkillsRoots: WorkspaceSkillUpdateOptions["getSkillsRoots"];
  used: boolean;
}

const candidates = new WeakMap<WorkspaceSkillCandidate, InternalCandidate>();
const activeTargets = new Set<string>();

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function inside(root: string, child: string): boolean {
  const relative = path.relative(root, child);
  return !!relative && relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  if (hash(a.metadata) !== hash(b.metadata) || a.entries.size !== b.entries.size) {
    return false;
  }
  for (const [name, entry] of a.entries) {
    const other = b.entries.get(name);
    if (!other || entry.type !== other.type || entry.hash !== other.hash) {
      return false;
    }
  }
  return true;
}

function samePreviewSnapshot(a: Snapshot, b: Snapshot): boolean {
  if (!sameSnapshot(a, b) ||
      a.rootIdentity.dev !== b.rootIdentity.dev || a.rootIdentity.ino !== b.rootIdentity.ino ||
      a.identities.size !== b.identities.size) {
    return false;
  }
  for (const [name, identity] of a.identities) {
    const other = b.identities.get(name);
    if (!other || identity.dev !== other.dev || identity.ino !== other.ino) { return false; }
  }
  return true;
}

async function assertNoLinks(absolute: string): Promise<void> {
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("linked-or-invalid-directory");
    }
  }
}

async function checkLocation(root: string, target: string): Promise<void> {
  if (!path.isAbsolute(root) || !path.isAbsolute(target) || !inside(root, target)) {
    throw new Error("outside-workspace");
  }
  if (root.startsWith("\\\\") || target.startsWith("\\\\")) {
    throw new Error("network-location");
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(onedrive|dropbox|googledrive)/i.test(key) && value && path.isAbsolute(value)) {
      const syncRoot = path.resolve(value);
      if (isWithinOrEqual(syncRoot, target) || isWithinOrEqual(syncRoot, root) ||
          isWithinOrEqual(target, syncRoot)) {
        throw new Error("known-synchronized-location");
      }
    }
  }
  await assertNoLinks(root);
  await assertNoLinks(target);
  const [rootStat, targetStat] = await Promise.all([fs.stat(root), fs.stat(target)]);
  if (rootStat.dev !== targetStat.dev) {
    throw new Error("different-volume");
  }
  if (process.platform === "win32") {
    const drive = path.parse(root).root.slice(0, 2).toUpperCase();
    if (!/^[A-Z]:$/.test(drive)) {
      throw new Error("unknown-volume");
    }
    const command = `$ErrorActionPreference='Stop'; ` +
      `[Console]::OutputEncoding=[Text.UTF8Encoding]::new(); ` +
      `$disk=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}'"; ` +
      `$shares=@(Get-CimInstance Win32_Share | Select-Object Name,Path); ` +
      `@{drive=[int]$disk.DriveType;shares=$shares} | ConvertTo-Json -Compress -Depth 3`;
    const result = await execFileAsync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command", command,
    ], { timeout: 10000, windowsHide: true });
    const inspection: unknown = JSON.parse(result.stdout);
    if (!inspection || typeof inspection !== "object" ||
        (inspection as { drive?: unknown }).drive !== 3 ||
        !Array.isArray((inspection as { shares?: unknown }).shares)) {
      throw new Error("network-or-unknown-volume");
    }
    for (const share of (inspection as { shares: unknown[] }).shares) {
      if (!share || typeof share !== "object") { throw new Error("unknown-share-status"); }
      const { Name: name, Path: sharePath } = share as { Name?: unknown; Path?: unknown };
      if (typeof name !== "string" ||
          (sharePath !== null && sharePath !== undefined && typeof sharePath !== "string")) {
        throw new Error("unknown-share-status");
      }
      if (/^(?:[a-z]:?|admin|ipc)\$$/i.test(name) || !sharePath) { continue; }
      if (!path.isAbsolute(sharePath)) { throw new Error("unknown-share-status"); }
      const shared = path.resolve(sharePath);
      // Windows' stock "Users" share of the system Users folder is not a share of the workspace.
      const stockUsers = path.join(process.env.SystemDrive || "C:", "Users");
      if (name.toLowerCase() === "users" &&
          path.relative(shared, path.resolve(`${stockUsers}${path.sep}`)) === "") {
        continue;
      }
      if (isWithinOrEqual(shared, target) || isWithinOrEqual(target, shared)) {
        throw new Error("shared-location");
      }
    }
  } else {
    // Unknown filesystems, including FUSE, are not treated as local.
    const stat = await fs.statfs(root);
    const localTypes = new Set([0xef53, 0x58465342, 0x9123683e, 0x01021994, 0x2fc12fc1]);
    if (!localTypes.has(Number(stat.type))) {
      throw new Error("network-or-unknown-volume");
    }
  }
}

async function projectedPath(value: string): Promise<string> {
  let current = value;
  const missing: string[] = [];
  for (;;) {
    try {
      return path.join(await fs.realpath(current), ...missing.reverse());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") { throw error; }
      const parent = path.dirname(current);
      if (parent === current) { throw new Error("invalid-skills-root"); }
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

function isWithinOrEqual(root: string, candidate: string): boolean {
  return path.relative(root, candidate) === "" || inside(root, candidate);
}

function assertWorkspace(root: string): void {
  if (!vscode.env || !("remoteName" in vscode.env)) {
    throw new Error("unknown-extension-host");
  }
  if (vscode.env.remoteName !== undefined) {
    throw new Error("remote-extension-host");
  }
  if (!vscode.workspace.workspaceFolders?.some((folder) =>
    folder.uri.scheme === "file" &&
    path.relative(path.resolve(folder.uri.fsPath), root) === "")) {
    throw new Error("workspace-not-open");
  }
}

async function assertOutsideSkillsRoots(
  location: string, target: string,
  getSkillsRoots: WorkspaceSkillUpdateOptions["getSkillsRoots"],
): Promise<void> {
  const extraRoots = await getSkillsRoots();
  if (!Array.isArray(extraRoots)) { throw new Error("unknown-skills-roots"); }
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) { throw new Error("unknown-skills-roots"); }
  const roots = [...extraRoots];
  for (const folder of folders) {
    if (folder.uri.scheme !== "file") { throw new Error("unknown-skills-roots"); }
    const config = vscode.workspace.getConfiguration("resourceNinja", folder.uri);
    roots.push(folder.uri);
    for (const configured of [
      getConfiguredSkillsDirectory(config), ...getConfiguredAdditionalSkillRoots(config),
    ]) {
      roots.push(resolveConfiguredUri(folder.uri, configured, configured));
    }
  }
  const realLocation = await projectedPath(location);
  const realTarget = await projectedPath(target);
  let targetCovered = false;
  for (const root of roots) {
    if (!root || root.scheme !== "file" || !path.isAbsolute(root.fsPath)) {
      throw new Error("unknown-skills-roots");
    }
    const rootPath = path.resolve(root.fsPath);
    const realRoot = await projectedPath(rootPath);
    if (isWithinOrEqual(rootPath, target) || isWithinOrEqual(realRoot, realTarget)) {
      targetCovered = true;
    }
    if (isWithinOrEqual(rootPath, location) || isWithinOrEqual(realRoot, realLocation)) {
      throw new Error("transaction-inside-skills-root");
    }
  }
  if (!targetCovered) { throw new Error("target-not-in-skills-root"); }
}

async function transactionParent(
  root: string, target: string,
  getSkillsRoots: WorkspaceSkillUpdateOptions["getSkillsRoots"],
): Promise<string> {
  let current = root;
  for (;;) {
    try {
      await assertOutsideSkillsRoots(current, target, getSkillsRoots);
      await assertNoLinks(current);
      if ((await fs.stat(current)).dev !== (await fs.stat(root)).dev) {
        throw new Error("different-volume");
      }
      return current;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "transaction-inside-skills-root") {
        throw error;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) { throw new Error("no-safe-transaction-location"); }
    current = parent;
  }
}

function recoveryRecordPath(parent: string, target: string): string {
  const identity = process.platform === "win32" ? target.toLowerCase() : target;
  return path.join(parent, `.resource-ninja-recovery-${hash(Buffer.from(identity))}.json`);
}

export interface WorkspaceRecoveryRecord {
  target: string;
  transaction: string;
  backup: string;
  record: string;
}

/** Discover records without using their contents as permission to change files. */
export async function findWorkspaceRecoveryRecords(
  workspace: vscode.Uri,
): Promise<{ records: WorkspaceRecoveryRecord[]; incomplete: boolean }> {
  const records: WorkspaceRecoveryRecord[] = [];
  let incomplete = false;
  if (workspace.scheme !== "file" || !path.isAbsolute(workspace.fsPath)) {
    return { records, incomplete: true };
  }
  const root = path.resolve(workspace.fsPath);
  const equalPath = (a: string, b: string) =>
    process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  let parent = path.dirname(root);
  for (;;) {
    let names: string[];
    try {
      names = await fs.readdir(parent);
    } catch {
      incomplete = true;
      break;
    }
    for (const name of names) {
      if (!/^\.resource-ninja-recovery-[a-f0-9]{64}\.json$/.test(name)) {
        continue;
      }
      const record = path.join(parent, name);
      try {
        const info = await fs.lstat(record);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) {
          incomplete = true;
          continue;
        }
        const handle = await fs.open(record, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        let value: unknown;
        try {
          const opened = await handle.stat();
          // On Windows lstat can report device 0 while fstat reports the volume ID.
          const sameDevice = opened.dev === info.dev || (process.platform === "win32" && info.dev === 0);
          if (!opened.isFile() || !sameDevice || opened.ino !== info.ino) {
            incomplete = true;
            continue;
          }
          const bytes = Buffer.alloc(64 * 1024 + 1);
          const read = await handle.read(bytes, 0, bytes.length, 0);
          if (read.bytesRead > 64 * 1024) {
            incomplete = true;
            continue;
          }
          value = JSON.parse(bytes.subarray(0, read.bytesRead).toString("utf8"));
        } finally {
          await handle.close();
        }
        if (!value || typeof value !== "object") {
          incomplete = true;
          continue;
        }
        const entry = value as Record<string, unknown>;
        if (typeof entry.workspace !== "string" || !path.isAbsolute(entry.workspace)) {
          incomplete = true;
          continue;
        }
        if (!equalPath(path.resolve(entry.workspace), root)) {
          continue;
        }
        if (entry.version !== 1 || typeof entry.target !== "string" ||
            typeof entry.transaction !== "string" || typeof entry.backup !== "string" ||
            !path.isAbsolute(entry.target) || !path.isAbsolute(entry.transaction) ||
            !path.isAbsolute(entry.backup)) {
          incomplete = true;
          continue;
        }
        const target = path.resolve(entry.target);
        const transaction = path.resolve(entry.transaction);
        const backup = path.resolve(entry.backup);
        if (!inside(root, target) ||
            !equalPath(record, recoveryRecordPath(parent, target)) ||
            !equalPath(path.dirname(transaction), parent) ||
            !path.basename(transaction).startsWith(".resource-ninja-update-") ||
            !equalPath(backup, path.join(transaction, "backup"))) {
          incomplete = true;
          continue;
        }
        records.push({ target, transaction, backup, record });
      } catch {
        incomplete = true;
      }
    }
    const next = path.dirname(parent);
    if (next === parent) { break; }
    parent = next;
  }
  return { records, incomplete };
}

class PendingRecoveryError extends Error {
  constructor(readonly transaction?: string) {
    super("pending-recovery");
  }
}

async function assertNoPendingRecovery(parent: string, target: string): Promise<void> {
  const record = recoveryRecordPath(parent, target);
  try {
    await fs.lstat(record);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") { return; }
    throw error;
  }
  // The record only locates the retained backup for the user; it grants no permission.
  let transaction: string | undefined;
  try {
    const info = await fs.lstat(record);
    if (info.isFile() && info.size <= 64 * 1024) {
      const value: unknown = JSON.parse(await fs.readFile(record, "utf8"));
      const candidate = (value as { transaction?: unknown } | null)?.transaction;
      if (typeof candidate === "string" && inside(parent, path.resolve(candidate))) {
        transaction = path.resolve(candidate);
      }
    }
  } catch {
    transaction = undefined;
  }
  throw new PendingRecoveryError(transaction);
}

async function snapshot(directory: string, requireMetadata = true): Promise<Snapshot> {
  const entries = new Map<string, Entry>();
  const identities = new Map<string, FileIdentity>();
  let metadata = new Uint8Array();
  let metadataObject: Record<string, unknown> = {};
  let total = 0;
  let count = 0;
  await assertNoLinks(directory);
  const rootIdentity = await fileIdentity(directory, "directory");
  const visit = async (dir: string, prefix: string, depth: number): Promise<void> => {
    if (depth > 64) { throw new Error("tree-too-deep"); }
    const children = await fs.readdir(dir, { withFileTypes: true });
    for (const child of children) {
      if (++count > MAX_ENTRIES || !isSafePathSegment(child.name)) {
        throw new Error("unsafe-tree");
      }
      const rel = prefix ? `${prefix}/${child.name}` : child.name;
      const location = path.join(dir, child.name);
      const info = await fs.lstat(location, { bigint: true });
      if (info.dev !== rootIdentity.dev) { throw new Error("different-volume"); }
      if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) {
        throw new Error("linked-or-special-entry");
      }
      if (info.ino === 0n) { throw new Error("identity-unavailable"); }
      const identity = { dev: info.dev, ino: info.ino };
      identities.set(rel, identity);
      if (info.isDirectory()) {
        entries.set(rel, { type: "directory" });
        await visit(location, rel, depth + 1);
        await assertIdentity(location, "directory", identity);
      } else {
        if (info.nlink > 1n || info.size > BigInt(MAX_FILE) ||
            (total += Number(info.size)) > MAX_TOTAL) {
          throw new Error("unsafe-or-oversize-file");
        }
        const bytes = await fs.readFile(location);
        if (BigInt(bytes.length) !== info.size) { throw new Error("file-changed"); }
        await assertIdentity(location, "file", identity);
        if (!prefix && child.name === META) {
          metadata = bytes;
          const value: unknown = JSON.parse(bytes.toString("utf8"));
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new Error("invalid-metadata");
          }
          metadataObject = value as Record<string, unknown>;
        } else {
          entries.set(rel, { type: "file", hash: hash(bytes) });
        }
      }
    }
  };
  await visit(directory, "", 0);
  await assertIdentity(directory, "directory", rootIdentity);
  if (requireMetadata && metadata.length === 0) { throw new Error("missing-metadata"); }
  return { entries, metadata, metadataObject, rootIdentity, identities };
}

function diff(snapshotValue: Snapshot, expectedFiles: RevisionFile[]): WorkspaceSkillLocalChange[] {
  const expected = new Map(expectedFiles.map((file) => [file.path, file]));
  const expectedDirectories = new Set<string>();
  for (const file of expectedFiles) {
    const parts = file.path.split("/");
    for (let index = 1; index < parts.length; index++) {
      expectedDirectories.add(parts.slice(0, index).join("/"));
    }
  }
  const result: WorkspaceSkillLocalChange[] = [];
  for (const [name, entry] of snapshotValue.entries) {
    if (entry.type === "directory") {
      if (!expectedDirectories.has(name)) {
        result.push({ path: `${name}/`, kind: "added" });
      }
      continue;
    }
    if (!expected.has(name)) { result.push({ path: name, kind: "added" }); }
  }
  for (const [name] of expected) {
    const current = snapshotValue.entries.get(name);
    if (!current || current.type !== "file") {
      result.push({ path: name, kind: "deleted" });
    }
  }
  return result;
}

async function baselineChanges(
  target: string, current: Snapshot, files: RevisionFile[],
): Promise<WorkspaceSkillLocalChange[]> {
  const changes = diff(current, files);
  for (const file of files) {
    const currentEntry = current.entries.get(file.path);
    if (currentEntry?.type === "file") {
      const bytes = await fs.readFile(path.join(target, ...file.path.split("/")));
      if (hash(bytes) !== currentEntry.hash) { throw new Error("file-changed"); }
      if (!matchesGitBlob(bytes, file.sha)) {
        changes.push({ path: file.path, kind: "modified" });
      }
    }
  }
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

async function assertOrdinaryBlob(
  revision: SourceRevision, resolver: RevisionResolver,
): Promise<void> {
  const parentPath = path.posix.dirname(revision.remotePath);
  const parent = await resolver({
    owner: revision.owner, repo: revision.repo, branch: revision.ref,
    remotePath: parentPath === "." ? "" : parentPath,
  });
  if (parent.kind !== "tree" || parent.commitSha !== revision.commitSha) {
    throw new Error("unsupported-blob");
  }
  const files = await resolver.listFiles(parent);
  const name = path.posix.basename(revision.remotePath);
  const selected = files.find((file) => file.path === name);
  if (!selected || (selected.mode !== "100644" && selected.mode !== "100755") ||
      selected.sha !== revision.contentSha) {
    throw new Error("unsupported-blob");
  }
}

/**
 * Downloads and verifies the selected commit without modifying the installed skill.
 * The returned candidate is process-local and single-use; call discard when not applied.
 */
export async function prepareWorkspaceSkillUpdate(
  options: WorkspaceSkillUpdateOptions,
): Promise<WorkspaceSkillPrepareResult> {
  if (options.workspace.scheme !== "file" || options.target.scheme !== "file") {
    return { status: "blocked", reason: "non-local-uri", failureKind: "other" };
  }
  const root = path.resolve(options.workspace.fsPath);
  const target = path.resolve(options.target.fsPath);
  let transaction: string | undefined;
  let transactionIdentity: FileIdentity | undefined;
  try {
    assertWorkspace(root);
    await checkLocation(root, target);
    const parent = await transactionParent(root, target, options.getSkillsRoots);
    await assertNoPendingRecovery(parent, target);
    const before = await snapshot(target);
    const meta = before.metadataObject;
    const baseline = parseSourceRevision(meta.sourceRevision);
    const firstSync = meta.sourceRevision == null;
    const initialRevision = firstSync
      ? parseSourceRevision(options.initialRevision)
      : undefined;
    const comparisonRevision = baseline || initialRevision;
    if (!comparisonRevision || typeof meta.name !== "string" || !meta.name ||
        typeof meta.source !== "string" || !meta.source ||
        meta.source === "local" || meta.source === "unknown" ||
        (firstSync && (meta.source !== options.sourceId || !options.sourceId)) ||
        typeof meta.remotePath !== "string" ||
        meta.remotePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") !== comparisonRevision.remotePath ||
        meta.incomplete === true) {
      throw new Error("invalid-or-local-baseline");
    }
    const resolver = createRevisionResolver(options.token);
    const current = await resolver({
      owner: comparisonRevision.owner, repo: comparisonRevision.repo,
      branch: comparisonRevision.ref, remotePath: comparisonRevision.remotePath,
    });
    const status = classifyRevision(comparisonRevision, current);
    if (status !== "unchanged" && status !== "changed") { throw new Error("different-source"); }

    let oldFiles: RevisionFile[];
    const localComparisonRevision = firstSync ? current : comparisonRevision;
    const pinnedComparisonRevision = firstSync
      ? localComparisonRevision
      : { ...localComparisonRevision, ref: localComparisonRevision.commitSha };
    if (localComparisonRevision.kind === "tree") {
      const oldResolver = firstSync ? resolver : createRevisionResolver(options.token);
      oldFiles = await oldResolver.listFiles(pinnedComparisonRevision);
    } else {
      const oldResolver = firstSync ? resolver : createRevisionResolver(options.token);
      await assertOrdinaryBlob(pinnedComparisonRevision, oldResolver);
      oldFiles = [{
        path: "SKILL.md",
        sha: localComparisonRevision.contentSha,
        mode: "100644",
      }];
    }
    if (oldFiles.some((file) => (file.mode !== "100644" && file.mode !== "100755") ||
        file.path.split("/").some((part) => !isSafePathSegment(part)))) {
      throw new Error("unsupported-baseline");
    }
    const localChanges = await baselineChanges(target, before, oldFiles);
    if (!firstSync && status === "unchanged") {
      if (!samePreviewSnapshot(before, await snapshot(target))) {
        throw new Error("target-changed-during-prepare");
      }
      return {
        status, revision: current, metadata: structuredClone(meta),
        localChanges, synchronization: "unknown", sharing: "unknown",
      };
    }
    transaction = await fs.mkdtemp(path.join(parent, ".resource-ninja-update-"));
    transactionIdentity = await fileIdentity(transaction, "directory");
    await assertOutsideSkillsRoots(transaction, target, options.getSkillsRoots);
    const stage = path.join(transaction, "candidate");
    await fs.mkdir(stage);
    const stageIdentity = await fileIdentity(stage, "directory");
    if (current.kind === "tree") {
      const result = await downloadDirectory(
        current.owner, current.repo, current.remotePath, vscode.Uri.file(stage),
        current.commitSha, options.token, 0, vscode.Uri.file(stage), true, true,
      );
      if (result.errors.length || result.rejectedEntries.length ||
          !(await directoryMatchesRevision(vscode.Uri.file(stage), current, resolver, META))) {
        throw new Error("candidate-verification-failed");
      }
    } else {
      await assertOrdinaryBlob(current, resolver);
      const raw = `https://raw.githubusercontent.com/${current.owner}/${current.repo}/${encodeGitRefForPath(current.commitSha)}/${encodeGitHubPathForUrl(current.remotePath)}`;
      const api = `https://api.github.com/repos/${current.owner}/${current.repo}/contents/${encodeGitHubPathForUrl(current.remotePath)}?ref=${encodeURIComponent(current.commitSha)}`;
      const bytes = await fetchFileBytes(raw, options.token, api, true);
      if (bytes.length > MAX_FILE || !matchesGitBlob(bytes, current.contentSha)) {
        throw new Error("candidate-verification-failed");
      }
      await fs.writeFile(path.join(stage, "SKILL.md"), bytes, { flag: "wx" });
    }
    const nextMeta = { ...meta, sourceRevision: current, installedAt: new Date().toISOString() };
    stripSkillMetaLocalPaths(nextMeta);
    await fs.writeFile(path.join(stage, META), JSON.stringify(nextMeta, null, 2), { flag: "wx" });
    await refreshSingleSkillMetadata(vscode.Uri.file(path.join(stage, "SKILL.md")), true);
    const staged = await snapshot(stage);
    if (!staged.entries.has("SKILL.md") ||
        !samePreviewSnapshot(before, await snapshot(target))) {
      throw new Error("target-changed-during-prepare");
    }
    await assertIdentity(stage, "directory", stageIdentity);
    await assertOutsideSkillsRoots(transaction, target, options.getSkillsRoots);
    const candidate: WorkspaceSkillCandidate = Object.freeze({
      id: randomUUID(), target: options.target, firstSync,
      revision: Object.freeze({ ...current }),
      metadata: Object.freeze(structuredClone(meta)),
      localChanges: Object.freeze(localChanges.map((item) => Object.freeze({ ...item }))),
      synchronization: "unknown",
      sharing: "unknown",
      recoveryDirectory: vscode.Uri.file(transaction),
    });
    candidates.set(candidate, {
      root, target, transaction, stage, baseline: before, staged,
      transactionIdentity, revision: current, localChanges, firstSync,
      getSkillsRoots: options.getSkillsRoots, used: false,
    });
    transaction = undefined;
    return { status: "ready", candidate };
  } catch (error) {
    const failureKind = isGitHubResponseError(error) &&
      (error.kind === "rate-limit" || error.rootCauseKind === "rate-limit")
      ? "rate-limit" : "other";
    const reason = failureKind === "rate-limit"
      ? "rate-limit" : safeReason(error, PREPARE_REASONS, "prepare-failed");
    if (transaction) {
      try {
        if (!transactionIdentity) { throw new Error("cleanup-ownership-unknown"); }
        await assertIdentity(transaction, "directory", transactionIdentity);
        await fs.rmdir(transaction);
      } catch (cleanupError) {
        return {
          status: "cleanup-required", reason, failureKind,
          cleanupReason: cleanupReason(cleanupError),
          directory: vscode.Uri.file(transaction),
        };
      }
    }
    return {
      status: "blocked", reason, failureKind,
      ...(error instanceof PendingRecoveryError && error.transaction
        ? { directory: vscode.Uri.file(error.transaction) } : {}),
    };
  }
}

async function fileIdentity(location: string, type: "file" | "directory"): Promise<FileIdentity> {
  const stat = await fs.lstat(location, { bigint: true });
  if (stat.ino === 0n || stat.isSymbolicLink() ||
      (type === "directory" ? !stat.isDirectory() : !stat.isFile() || stat.nlink > 1n)) {
    throw new Error("identity-unavailable");
  }
  return { dev: stat.dev, ino: stat.ino };
}

async function assertIdentity(
  location: string, type: "file" | "directory", expected: FileIdentity,
): Promise<void> {
  const actual = await fileIdentity(location, type);
  if (actual.dev !== expected.dev || actual.ino !== expected.ino) {
    throw new Error("identity-changed");
  }
}

async function recordOwned(
  owned: OwnedTree | undefined, root: string, name: string,
  type: "file" | "directory", expectedHash?: string,
): Promise<void> {
  if (!owned) { return; }
  const location = path.join(root, ...name.split("/"));
  const identity = await fileIdentity(location, type);
  owned.entries.set(name, { identity, type, hash: expectedHash });
}

async function copySnapshot(
  source: string, destination: string, value: Snapshot, owned?: OwnedTree,
): Promise<void> {
  await assertNoLinks(source);
  await assertNoLinks(destination);
  const directories = [...value.entries].filter(([, entry]) => entry.type === "directory");
  directories.sort(([a], [b]) => a.split("/").length - b.split("/").length);
  for (const [name] of directories) {
    const targetDirectory = path.join(destination, ...name.split("/"));
    await assertNoLinks(path.dirname(targetDirectory));
    await fs.mkdir(targetDirectory);
    await recordOwned(owned, destination, name, "directory");
  }
  for (const [name, entry] of value.entries) {
    if (entry.type === "file") {
      const sourceFile = path.join(source, ...name.split("/"));
      const targetFile = path.join(destination, ...name.split("/"));
      await assertNoLinks(path.dirname(sourceFile));
      await assertNoLinks(path.dirname(targetFile));
      const sourceInfo = await fs.lstat(sourceFile);
      if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink() || sourceInfo.nlink > 1) {
        throw new Error("linked-or-special-entry");
      }
      await fs.copyFile(
        sourceFile,
        targetFile,
        constants.COPYFILE_EXCL,
      );
      await recordOwned(owned, destination, name, "file", entry.hash);
    }
  }
  await assertNoLinks(source);
  await assertNoLinks(destination);
  const metadataInfo = await fs.lstat(path.join(source, META));
  if (!metadataInfo.isFile() || metadataInfo.isSymbolicLink() || metadataInfo.nlink > 1) {
    throw new Error("linked-or-special-entry");
  }
  await fs.copyFile(path.join(source, META), path.join(destination, META), constants.COPYFILE_EXCL);
  await recordOwned(owned, destination, META, "file", hash(value.metadata));
}

async function assertOwnedEntry(root: string, name: string, entry: OwnedEntry): Promise<void> {
  const location = path.join(root, ...name.split("/"));
  await assertIdentity(location, entry.type, entry.identity);
  if (entry.type === "file") {
    const info = await fs.lstat(location);
    if (info.size > MAX_FILE || hash(await fs.readFile(location)) !== entry.hash) {
      throw new Error("owned-content-changed");
    }
    await assertIdentity(location, entry.type, entry.identity);
  }
}

async function assertOwnedTree(root: string, owned: OwnedTree): Promise<void> {
  await assertNoLinks(root);
  await assertIdentity(root, "directory", owned.root);
  const seen = new Set<string>();
  const visit = async (directory: string, prefix: string): Promise<void> => {
    for (const child of await fs.readdir(directory)) {
      const name = prefix ? `${prefix}/${child}` : child;
      const entry = owned.entries.get(name);
      if (!entry || seen.has(name)) { throw new Error("unowned-entry"); }
      seen.add(name);
      await assertOwnedEntry(root, name, entry);
      if (entry.type === "directory") {
        await visit(path.join(directory, child), name);
      }
    }
  };
  await visit(root, "");
  if (seen.size !== owned.entries.size) { throw new Error("owned-entry-missing"); }
  await assertIdentity(root, "directory", owned.root);
}

async function removeOwnedTree(
  root: string, owned: OwnedTree, parentIdentity: FileIdentity,
): Promise<void> {
  await assertOwnedTree(root, owned);
  const entries = [...owned.entries].sort(([a], [b]) =>
    b.split("/").length - a.split("/").length);
  for (const [name, entry] of entries) {
    await assertIdentity(path.dirname(root), "directory", parentIdentity);
    await assertIdentity(root, "directory", owned.root);
    const parts = name.split("/");
    for (let index = 1; index < parts.length; index++) {
      const ancestor = parts.slice(0, index).join("/");
      const parent = owned.entries.get(ancestor);
      if (!parent || parent.type !== "directory") { throw new Error("unowned-parent"); }
      await assertIdentity(path.join(root, ...parts.slice(0, index)), "directory", parent.identity);
    }
    await assertOwnedEntry(root, name, entry);
    const location = path.join(root, ...parts);
    if (entry.type === "file") { await fs.unlink(location); }
    else { await fs.rmdir(location); }
  }
  await assertIdentity(path.dirname(root), "directory", parentIdentity);
  await assertIdentity(root, "directory", owned.root);
  await fs.rmdir(root);
}

interface RollbackIdentity {
  original: FileIdentity;
  parent: FileIdentity;
  transaction: FileIdentity;
}

function ownedFromSnapshot(value: Snapshot): OwnedTree | undefined {
  const owned: OwnedTree = { root: value.rootIdentity, entries: new Map() };
  for (const [name, entry] of value.entries) {
    const identity = value.identities.get(name);
    if (!identity) { return undefined; }
    owned.entries.set(name, { identity, type: entry.type, hash: entry.hash });
  }
  const metadataIdentity = value.identities.get(META);
  if (!metadataIdentity) { return undefined; }
  owned.entries.set(META, {
    identity: metadataIdentity, type: "file", hash: hash(value.metadata),
  });
  return owned;
}

/**
 * Runs only after the switched content was verified. Removes the exact staged
 * copy and, unless an ordinary update overwrote saved local edits, the exact old copy.
 * Returns whether the old copy is still retained for the user.
 */
async function cleanupAfterSuccess(
  state: InternalCandidate, backupPath: string, retainBackup: boolean,
): Promise<boolean> {
  try {
    const stageOwned = ownedFromSnapshot(state.staged);
    if (!stageOwned) { return true; }
    await removeOwnedTree(state.stage, stageOwned, state.transactionIdentity);
    if (retainBackup) { return true; }
    const backupOwned = ownedFromSnapshot(state.baseline);
    if (!backupOwned) { return true; }
    await removeOwnedTree(backupPath, backupOwned, state.transactionIdentity);
    await assertIdentity(state.transaction, "directory", state.transactionIdentity);
    await fs.rmdir(state.transaction);
    return false;
  } catch {
    return true;
  }
}

async function rollbackUpdate(
  state: InternalCandidate,
  backupPath: string,
  identity: RollbackIdentity,
  owned: OwnedTree | undefined,
  checkGuard: () => Promise<void>,
): Promise<void> {
  const parent = path.dirname(state.target);
  const verifyBackup = async (): Promise<void> => {
    assertWorkspace(state.root);
    await assertNoLinks(parent);
    await assertNoLinks(state.transaction);
    await assertIdentity(parent, "directory", identity.parent);
    await assertIdentity(state.transaction, "directory", identity.transaction);
    await assertIdentity(backupPath, "directory", identity.original);
    if (!sameSnapshot(state.baseline, await snapshot(backupPath))) {
      throw new Error("backup-changed");
    }
    await assertIdentity(backupPath, "directory", identity.original);
    await assertOutsideSkillsRoots(state.transaction, state.target, state.getSkillsRoots);
    await checkGuard();
  };
  await verifyBackup();
  let targetExists = false;
  try {
    await fs.lstat(state.target);
    targetExists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") { throw error; }
  }
  if (targetExists) {
    if (!owned) { throw new Error("unowned-target"); }
    await assertOwnedTree(state.target, owned);
    await checkGuard();
    await removeOwnedTree(state.target, owned, identity.parent);
  } else if (owned) {
    throw new Error("owned-target-missing");
  }
  await verifyBackup();
  await fs.mkdir(state.target);
  const restoredIdentity = await fileIdentity(state.target, "directory");
  await copySnapshot(backupPath, state.target, state.baseline);
  await assertIdentity(state.target, "directory", restoredIdentity);
  if (!sameSnapshot(state.baseline, await snapshot(state.target))) {
    throw new Error("rollback-verification-failed");
  }
  await verifyBackup();
  if (!sameSnapshot(state.baseline, await snapshot(state.target))) {
    throw new Error("rollback-verification-failed");
  }
  await assertIdentity(state.target, "directory", restoredIdentity);
  await checkGuard();
}

/**
 * Applies only the exact approved candidate. The old copy is removed after
 * verification unless an ordinary update overwrote saved local edits.
 * After moving the original, an uncertain failure never overwrites or deletes another writer.
 */
export async function applyWorkspaceSkillUpdate(
  candidate: WorkspaceSkillCandidate,
  approval: WorkspaceSkillApproval,
  dirtyDocumentGuard?: DirtyDocumentGuard,
): Promise<WorkspaceSkillApplyResult> {
  const state = candidates.get(candidate);
  if (!state || state.used || !approval || candidate.id !== approval.candidateId ||
      (approval.mode !== "single" && approval.mode !== "bulk") ||
      (state.localChanges.length > 0 &&
        (approval.mode === "bulk" || approval.overwriteLocalChanges !== true))) {
    return { status: "blocked", reason: "approval-required-or-invalid-candidate" };
  }
  const key = process.platform === "win32" ? state.target.toLowerCase() : state.target;
  if (activeTargets.has(key)) { return { status: "blocked", reason: "update-in-progress" }; }
  activeTargets.add(key);
  let moved = false;
  let guardFailed = false;
  let identity: RollbackIdentity | undefined;
  let owned: OwnedTree | undefined;
  let recoveryRecord: { path: string; identity: FileIdentity; content: string } | undefined;
  let recordCreated = false;
  const backupPath = path.join(state.transaction, "backup");
  const backup = vscode.Uri.file(backupPath);
  const releaseRecord = async (): Promise<void> => {
    if (!recoveryRecord) { return; }
    await assertIdentity(recoveryRecord.path, "file", recoveryRecord.identity);
    if (await fs.readFile(recoveryRecord.path, "utf8") !== recoveryRecord.content) {
      throw new Error("recovery-record-changed");
    }
    await assertIdentity(recoveryRecord.path, "file", recoveryRecord.identity);
    await fs.unlink(recoveryRecord.path);
    recoveryRecord = undefined;
  };
  const checkGuard = async (): Promise<void> => {
    if (!dirtyDocumentGuard) { return; }
    try {
      if (await dirtyDocumentGuard(candidate.target) === "clean") { return; }
    } catch {
      guardFailed = true;
      throw new Error("dirty-or-unknown-document");
    }
    guardFailed = true;
    throw new Error("dirty-or-unknown-document");
  };
  try {
    assertWorkspace(state.root);
    await checkLocation(state.root, state.target);
    await assertOutsideSkillsRoots(state.transaction, state.target, state.getSkillsRoots);
    await checkGuard();
    if (!samePreviewSnapshot(state.baseline, await snapshot(state.target)) ||
        !samePreviewSnapshot(state.staged, await snapshot(state.stage))) {
      throw new Error("snapshot-changed");
    }
    await checkGuard();
    identity = {
      original: await fileIdentity(state.target, "directory"),
      parent: await fileIdentity(path.dirname(state.target), "directory"),
      transaction: state.transactionIdentity,
    };
    await assertIdentity(state.target, "directory", state.baseline.rootIdentity);
    await assertIdentity(state.transaction, "directory", state.transactionIdentity);
    const recordPath = recoveryRecordPath(path.dirname(state.transaction), state.target);
    const content = JSON.stringify({
      version: 1, workspace: state.root, target: state.target,
      transaction: state.transaction, backup: backupPath,
      candidateId: candidate.id, revision: state.revision,
    });
    try {
      await fs.writeFile(recordPath, content, { flag: "wx", mode: 0o600 });
      recordCreated = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return { status: "blocked", reason: "pending-recovery" };
      }
      return { status: "recovery-required", reason: "recovery-record-write-failed", backup: candidate.recoveryDirectory };
    }
    recoveryRecord = { path: recordPath, identity: await fileIdentity(recordPath, "file"), content };
    state.used = true;
    await fs.rename(state.target, backupPath);
    moved = true;
    await assertIdentity(backupPath, "directory", identity.original);
    if (!sameSnapshot(state.baseline, await snapshot(backupPath))) {
      throw new Error("backup-changed-during-switch");
    }
    await assertOutsideSkillsRoots(state.transaction, state.target, state.getSkillsRoots);
    await checkGuard();
    await fs.mkdir(state.target);
    owned = { root: await fileIdentity(state.target, "directory"), entries: new Map() };
    await copySnapshot(state.stage, state.target, state.staged, owned);
    if (!sameSnapshot(state.staged, await snapshot(state.target)) ||
        !sameSnapshot(state.baseline, await snapshot(backupPath))) {
      throw new Error("post-switch-verification-failed");
    }
    await assertOutsideSkillsRoots(state.transaction, state.target, state.getSkillsRoots);
    await checkGuard();
    await releaseRecord();
    const retained = await cleanupAfterSuccess(
      state, backupPath, !state.firstSync && state.localChanges.length > 0,
    );
    return retained
      ? { status: "updated", backup: state.firstSync ? candidate.recoveryDirectory : backup }
      : { status: "updated" };
  } catch (error) {
    const reason = safeReason(error, APPLY_REASONS, "apply-failed");
    if (moved) {
      if (!guardFailed && identity) {
        try {
          await rollbackUpdate(state, backupPath, identity, owned, checkGuard);
          await checkGuard();
          if (!sameSnapshot(state.baseline, await snapshot(state.target))) {
            throw new Error("rollback-verification-failed");
          }
          await releaseRecord();
          if (state.firstSync) {
            const retained = await cleanupAfterSuccess(state, backupPath, false);
            return retained
              ? { status: "rolled-back", reason, backup: candidate.recoveryDirectory }
              : { status: "rolled-back", reason };
          }
          return { status: "rolled-back", reason, backup };
        } catch {
          // Both backup and any competing or partially restored target remain in place.
        }
      }
      return { status: "recovery-required", reason, backup };
    }
    try {
      await fs.lstat(backupPath);
      return { status: "recovery-required", reason: "rename-outcome-unknown", backup };
    } catch (backupError) {
      if ((backupError as NodeJS.ErrnoException).code !== "ENOENT") {
        return { status: "recovery-required", reason: "rename-outcome-unknown", backup };
      }
    }
    try {
      if (recordCreated && !recoveryRecord) {
        return { status: "recovery-required", reason: "recovery-record-identity-unknown", backup: candidate.recoveryDirectory };
      }
      await releaseRecord();
    } catch {
      return { status: "recovery-required", reason: "recovery-record-cleanup-failed", backup: candidate.recoveryDirectory };
    }
    state.used = false;
    return { status: "blocked", reason };
  } finally {
    activeTargets.delete(key);
  }
}

/** Discards only an unapplied candidate; retained backups are never removed here. */
export async function discardWorkspaceSkillUpdate(
  candidate: WorkspaceSkillCandidate,
): Promise<"discarded" | "preserved"> {
  const state = candidates.get(candidate);
  if (!state || state.used) { return "preserved"; }
  const key = process.platform === "win32" ? state.target.toLowerCase() : state.target;
  if (activeTargets.has(key)) { return "preserved"; }
  state.used = true;
  try {
    await assertIdentity(state.transaction, "directory", state.transactionIdentity);
    const contents = await fs.readdir(state.transaction);
    if (contents.length !== 1 || contents[0] !== "candidate" ||
        !samePreviewSnapshot(state.staged, await snapshot(state.stage))) {
      return "preserved";
    }
    await assertIdentity(state.transaction, "directory", state.transactionIdentity);
    const owned = ownedFromSnapshot(state.staged);
    if (!owned) { return "preserved"; }
    await removeOwnedTree(state.stage, owned, state.transactionIdentity);
    await assertIdentity(state.transaction, "directory", state.transactionIdentity);
    await fs.rmdir(state.transaction);
    return "discarded";
  } catch {
    return "preserved";
  }
}

function previewState(candidate: WorkspaceSkillCandidate): InternalCandidate {
  const state = candidates.get(candidate);
  if (!state || state.used) { throw new Error("invalid-preview-candidate"); }
  const key = process.platform === "win32" ? state.target.toLowerCase() : state.target;
  if (activeTargets.has(key)) { throw new Error("update-in-progress"); }
  return state;
}

async function assertPreviewState(
  candidate: WorkspaceSkillCandidate, state: InternalCandidate,
): Promise<void> {
  if (previewState(candidate) !== state) { throw new Error("invalid-preview-candidate"); }
  assertWorkspace(state.root);
  await assertOutsideSkillsRoots(state.transaction, state.target, state.getSkillsRoots);
  await assertIdentity(state.transaction, "directory", state.transactionIdentity);
  if (!samePreviewSnapshot(state.baseline, await snapshot(state.target)) ||
      !samePreviewSnapshot(state.staged, await snapshot(state.stage))) {
    throw new Error("preview-snapshot-changed");
  }
  if (previewState(candidate) !== state) { throw new Error("invalid-preview-candidate"); }
}

/** Lists saved local and verified staged content, excluding the separate metadata sidecar. */
export async function listWorkspaceSkillUpdateFiles(
  candidate: WorkspaceSkillCandidate,
): Promise<readonly WorkspaceSkillPreviewFile[]> {
  try {
    return await listPreviewFiles(candidate);
  } catch (error) {
    throw new Error(safeReason(error, PREVIEW_REASONS, "preview-unavailable"));
  }
}

async function listPreviewFiles(
  candidate: WorkspaceSkillCandidate,
): Promise<readonly WorkspaceSkillPreviewFile[]> {
  const state = previewState(candidate);
  await assertPreviewState(candidate, state);
  const names = new Set([...state.baseline.entries.keys(), ...state.staged.entries.keys()]);
  return [...names].sort().filter((name) =>
    state.baseline.entries.get(name)?.type === "file" ||
    state.staged.entries.get(name)?.type === "file",
  ).map((name) => ({
    path: name,
    local: state.baseline.entries.get(name)?.type === "file",
    staged: state.staged.entries.get(name)?.type === "file",
  }));
}

/** Reads exact bytes only from an unchanged candidate and its saved local snapshot. */
export async function readWorkspaceSkillUpdateFile(
  candidate: WorkspaceSkillCandidate,
  side: "local" | "staged",
  relativePath: string,
): Promise<Uint8Array> {
  try {
    return await readPreviewFile(candidate, side, relativePath);
  } catch (error) {
    throw new Error(safeReason(error, PREVIEW_REASONS, "preview-unavailable"));
  }
}

async function readPreviewFile(
  candidate: WorkspaceSkillCandidate,
  side: "local" | "staged",
  relativePath: string,
): Promise<Uint8Array> {
  const state = previewState(candidate);
  if ((side !== "local" && side !== "staged") || typeof relativePath !== "string" ||
      !relativePath || relativePath.split("/").some((part) => !isSafePathSegment(part))) {
    throw new Error("invalid-preview-path");
  }
  const value = side === "local" ? state.baseline : state.staged;
  const entry = value.entries.get(relativePath);
  const expectedIdentity = value.identities.get(relativePath);
  if (entry?.type !== "file" || !expectedIdentity) { throw new Error("preview-file-not-found"); }
  await assertPreviewState(candidate, state);
  const root = side === "local" ? state.target : state.stage;
  const location = path.join(root, ...relativePath.split("/"));
  await assertNoLinks(path.dirname(location));
  await assertIdentity(location, "file", expectedIdentity);
  const bytes = await fs.readFile(location);
  if (bytes.length > MAX_FILE || hash(bytes) !== entry.hash) {
    throw new Error("preview-snapshot-changed");
  }
  await assertIdentity(location, "file", expectedIdentity);
  await assertPreviewState(candidate, state);
  return new Uint8Array(bytes);
}
