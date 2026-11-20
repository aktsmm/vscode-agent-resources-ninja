// VS Code file system adapter for the harness instruction logic.

import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import type { HarnessFileSystem } from "./harnessInstructions";

function isFileNotFoundError(error: unknown): boolean {
  const code = (error as { code?: unknown } | undefined)?.code;
  if (code === "ENOENT" || code === "FileNotFound") {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /(?:ENOENT|FileNotFound)/i.test(message);
}

function normalizeForCompare(fsPath: string): string {
  const normalized = fsPath.replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function createVsCodeHarnessFileSystem(): HarnessFileSystem {
  return {
    async readText(fsPath) {
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(fsPath));
        return Buffer.from(bytes).toString("utf8");
      } catch (error) {
        if (isFileNotFoundError(error)) {
          return undefined;
        }
        throw error;
      }
    },
    async writeTextAtomic(fsPath, text) {
      const target = vscode.Uri.file(fsPath);
      const staged = vscode.Uri.file(`${fsPath}.${randomUUID()}.tmp`);
      await vscode.workspace.fs.writeFile(staged, Buffer.from(text, "utf8"));
      try {
        await vscode.workspace.fs.rename(staged, target, { overwrite: true });
      } catch (error) {
        try {
          await vscode.workspace.fs.delete(staged);
        } catch {
          // The staged copy is a leftover only; the original is untouched.
        }
        throw error;
      }
    },
    async exists(fsPath) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(fsPath));
        return true;
      } catch (error) {
        if (isFileNotFoundError(error)) {
          return false;
        }
        throw error;
      }
    },
    async listFileNames(directoryFsPath) {
      try {
        const entries = await vscode.workspace.fs.readDirectory(
          vscode.Uri.file(directoryFsPath),
        );
        return entries
          .filter(([, type]) => (type & vscode.FileType.File) !== 0)
          .map(([name]) => name);
      } catch (error) {
        if (isFileNotFoundError(error)) {
          return [];
        }
        throw error;
      }
    },
    async remove(fsPath) {
      await vscode.workspace.fs.delete(vscode.Uri.file(fsPath), {
        useTrash: true,
      });
    },
    async isDirty(fsPath) {
      const key = normalizeForCompare(fsPath);
      return vscode.workspace.textDocuments.some(
        (document) =>
          document.isDirty && normalizeForCompare(document.uri.fsPath) === key,
      );
    },
  };
}
