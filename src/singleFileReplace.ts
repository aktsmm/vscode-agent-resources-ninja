// Replaces one installed file and its metadata sidecar without ever leaving the user with
// neither copy. Kept free of `vscode` imports so plain-Node regression scripts can load the real code.

import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export const SINGLE_FILE_MAX_BYTES = 5 * 1024 * 1024;

export interface SingleFileSnapshot {
  readonly target: string;
  readonly metadata: string;
  readonly targetBytes: Uint8Array;
  /** Undefined when the sidecar did not exist. */
  readonly metadataBytes: Uint8Array | undefined;
}

export type SingleFileCaptureResult =
  | { status: "captured"; snapshot: SingleFileSnapshot }
  | { status: "refused"; reason: "not-a-file" | "linked" | "too-large" | "unreadable" };

export type SingleFileReplaceResult =
  | { status: "updated" }
  | { status: "changed" }
  | { status: "restored" }
  | { status: "restore-failed"; backup: string };

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.byteLength === b.byteLength && Buffer.compare(a, b) === 0;
}

async function readOptional(location: string, maxBytes: number): Promise<
  { status: "ok"; bytes: Uint8Array | undefined } | { status: "refused"; reason: "not-a-file" | "linked" | "too-large" | "unreadable" }
> {
  let info;
  try {
    info = await fs.lstat(location);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { status: "ok", bytes: undefined }
      : { status: "refused", reason: "unreadable" };
  }
  if (info.isSymbolicLink()) {
    return { status: "refused", reason: "linked" };
  }
  if (!info.isFile()) {
    return { status: "refused", reason: "not-a-file" };
  }
  if (info.size > maxBytes) {
    return { status: "refused", reason: "too-large" };
  }
  try {
    const bytes = await fs.readFile(location);
    return bytes.byteLength === info.size
      ? { status: "ok", bytes }
      : { status: "refused", reason: "unreadable" };
  } catch {
    return { status: "refused", reason: "unreadable" };
  }
}

/** Reads the installed file and its sidecar into memory. A missing file is refused: there is nothing to keep. */
export async function captureSingleFile(
  target: string,
  metadata: string,
  maxBytes: number = SINGLE_FILE_MAX_BYTES,
): Promise<SingleFileCaptureResult> {
  const file = await readOptional(target, maxBytes);
  if (file.status === "refused") {
    return file;
  }
  if (!file.bytes) {
    return { status: "refused", reason: "not-a-file" };
  }
  const sidecar = await readOptional(metadata, maxBytes);
  if (sidecar.status === "refused") {
    return sidecar;
  }
  return {
    status: "captured",
    snapshot: {
      target,
      metadata,
      targetBytes: file.bytes,
      metadataBytes: sidecar.bytes,
    },
  };
}

async function restore(snapshot: SingleFileSnapshot): Promise<boolean> {
  try {
    await fs.writeFile(snapshot.target, snapshot.targetBytes);
    if (snapshot.metadataBytes) {
      await fs.writeFile(snapshot.metadata, snapshot.metadataBytes);
    } else {
      await fs.rm(snapshot.metadata, { force: true });
    }
    const target = await fs.readFile(snapshot.target);
    if (!same(target, snapshot.targetBytes)) {
      return false;
    }
    if (snapshot.metadataBytes) {
      return same(await fs.readFile(snapshot.metadata), snapshot.metadataBytes);
    }
    return !(await fs.lstat(snapshot.metadata).then(() => true, () => false));
  } catch {
    return false;
  }
}

/**
 * Runs `replace` (which downloads, verifies and overwrites the file) only after both copies are
 * saved under `backupRoot`, and puts the saved copies back when it fails or reports an
 * incomplete result. The backup is removed once the outcome is verified; if the original
 * cannot be restored the backup stays and its location is returned.
 */
export async function replaceSingleFile(
  snapshot: SingleFileSnapshot,
  backupRoot: string,
  replace: () => Promise<boolean>,
): Promise<SingleFileReplaceResult> {
  const current = await readOptional(snapshot.target, SINGLE_FILE_MAX_BYTES);
  if (current.status !== "ok" || !current.bytes || !same(current.bytes, snapshot.targetBytes)) {
    return { status: "changed" };
  }
  const currentMetadata = await readOptional(snapshot.metadata, SINGLE_FILE_MAX_BYTES);
  if (
    currentMetadata.status !== "ok" ||
    (currentMetadata.bytes === undefined) !== (snapshot.metadataBytes === undefined) ||
    (currentMetadata.bytes && snapshot.metadataBytes && !same(currentMetadata.bytes, snapshot.metadataBytes))
  ) {
    return { status: "changed" };
  }

  const backup = path.join(backupRoot, randomUUID());
  await fs.mkdir(backup, { recursive: true });
  await fs.writeFile(path.join(backup, "resource"), snapshot.targetBytes, { flag: "wx" });
  if (snapshot.metadataBytes) {
    await fs.writeFile(path.join(backup, "metadata"), snapshot.metadataBytes, { flag: "wx" });
  }

  let clean = false;
  try {
    clean = await replace();
  } catch {
    clean = false;
  }
  if (clean) {
    await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined);
    return { status: "updated" };
  }
  if (await restore(snapshot)) {
    await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined);
    return { status: "restored" };
  }
  return { status: "restore-failed", backup };
}
