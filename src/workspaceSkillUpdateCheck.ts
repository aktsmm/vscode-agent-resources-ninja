import * as path from "node:path";
import * as vscode from "vscode";
import {
  classifyRevision,
  parseSourceRevision,
  RevisionPathMissingError,
  type RevisionTarget,
  type SourceRevision,
} from "./resourceRevision";
import type { InstalledSkillScanResult } from "./skillInstaller";
import type { WorkspaceUpdateTarget } from "./workspaceSkillUpdateUi";

/**
 * True when a document lives at or below the skill folder. Only a real parent
 * segment counts as leaving it, so a file named `..notes` inside it stays inside.
 */
export function isDocumentInsideDirectory(
  directoryFsPath: string,
  documentFsPath: string,
): boolean {
  const normalize = (value: string): string =>
    process.platform === "win32" ? value.toLowerCase() : value;
  const relative = path.relative(
    normalize(path.resolve(directoryFsPath)),
    normalize(path.resolve(documentFsPath)),
  );
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

export interface WorkspaceUpdateCheckDependencies {
  scan(workspace: vscode.Uri): Promise<InstalledSkillScanResult>;
  resolve(target: RevisionTarget): Promise<SourceRevision>;
  isRateLimit(error: unknown): boolean;
  isCancelled(): boolean;
  log(message: string, error?: unknown): void;
}

export interface WorkspaceUpdateCheckSummary {
  targets: WorkspaceUpdateTarget[];
  /** Skills that are local-only, lack a baseline, or whose upstream path is gone. */
  unverified: number;
  upToDate: number;
  /** False when a scan or request failed, so the 14-day clock must not advance. */
  complete: boolean;
  rateLimited: boolean;
}

/**
 * Compares every installed remote skill's recorded baseline with upstream.
 * Only a changed object under the same repository, ref and path is a candidate;
 * the check never writes anything.
 */
export async function findChangedWorkspaceSkills(
  workspaces: readonly vscode.Uri[],
  deps: WorkspaceUpdateCheckDependencies,
): Promise<WorkspaceUpdateCheckSummary> {
  const summary: WorkspaceUpdateCheckSummary = {
    targets: [],
    unverified: 0,
    upToDate: 0,
    complete: true,
    rateLimited: false,
  };
  const seen = new Set<string>();

  for (const workspace of workspaces) {
    if (summary.rateLimited || deps.isCancelled()) {
      summary.complete = false;
      break;
    }
    const scan = await deps.scan(workspace);
    if (!scan.complete) {
      summary.complete = false;
      deps.log("[Workspace update] Installed skill scan was incomplete");
    }

    for (const meta of scan.metas) {
      if (summary.rateLimited || deps.isCancelled()) {
        summary.complete = false;
        break;
      }
      const baseline = parseSourceRevision(meta.sourceRevision);
      const skillFile = typeof meta.skillFilePath === "string" ? meta.skillFilePath : "";
      const remotePath = typeof meta.remotePath === "string"
        ? meta.remotePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
        : undefined;
      if (
        !baseline ||
        !skillFile ||
        meta.reinstallDisabled === true ||
        meta.incomplete === true ||
        !meta.source ||
        meta.source === "local" ||
        meta.source === "unknown" ||
        remotePath !== baseline.remotePath
      ) {
        summary.unverified++;
        continue;
      }

      const target = path.dirname(skillFile);
      const key = process.platform === "win32" ? target.toLowerCase() : target;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      try {
        const current = await deps.resolve({
          owner: baseline.owner,
          repo: baseline.repo,
          branch: baseline.ref,
          remotePath: baseline.remotePath,
        });
        const status = classifyRevision(baseline, current);
        if (status === "changed") {
          summary.targets.push({
            workspace,
            target: vscode.Uri.file(target),
            label: typeof meta.name === "string" && meta.name ? meta.name : path.basename(target),
          });
        } else if (status === "unchanged") {
          summary.upToDate++;
        } else {
          summary.unverified++;
        }
      } catch (error) {
        if (error instanceof RevisionPathMissingError) {
          summary.unverified++;
        } else if (deps.isRateLimit(error)) {
          summary.rateLimited = true;
          summary.complete = false;
        } else {
          summary.complete = false;
          summary.unverified++;
          deps.log("[Workspace update] Revision check failed", error);
        }
      }
    }
  }
  return summary;
}
