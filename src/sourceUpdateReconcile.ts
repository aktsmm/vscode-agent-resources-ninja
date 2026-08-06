import type { Bundle, Skill, Source } from "./skillIndex";

/**
 * A scan that succeeds but returns nothing is indistinguishable from a repository
 * that was renamed, emptied, or restructured, so the existing index is kept unless
 * the caller explicitly opts into shrinking it.
 */
export class EmptySourceScanError extends Error {
  constructor(
    public readonly sourceId: string,
    message: string,
  ) {
    super(message);
    this.name = "EmptySourceScanError";
  }
}

export function isEmptySourceScanError(
  error: unknown,
): error is EmptySourceScanError {
  return error instanceof EmptySourceScanError;
}

export function createEmptySourceScanError(
  sourceId: string,
  sourceName?: string,
): EmptySourceScanError {
  return new EmptySourceScanError(
    sourceId,
    `Scanning ${sourceName || sourceId} returned no resources while ${sourceId} still has indexed resources. The existing index was kept.`,
  );
}

export interface SourceScanReconcileInput {
  existingSkills: readonly Skill[];
  scannedSkills: readonly Skill[];
  existingBundles?: readonly Bundle[];
  scannedBundles?: readonly Bundle[];
  allowEmptyResult?: boolean;
}

export interface SourceScanReconcileResult {
  keptExisting: boolean;
  skills: Skill[];
  bundles: Bundle[];
}

export function reconcileSourceScanResult(
  input: SourceScanReconcileInput,
): SourceScanReconcileResult {
  const existingSkills = [...input.existingSkills];
  const existingBundles = [...(input.existingBundles || [])];
  const scannedSkills = [...input.scannedSkills];
  const scannedBundles = [...(input.scannedBundles || [])];

  if (
    !input.allowEmptyResult &&
    scannedSkills.length === 0 &&
    existingSkills.length > 0
  ) {
    return {
      keptExisting: true,
      skills: existingSkills,
      bundles: existingBundles,
    };
  }

  return {
    keptExisting: false,
    skills: scannedSkills,
    bundles: scannedBundles,
  };
}

/**
 * A source that suddenly points at a different GitHub repository id is treated as
 * a takeover (repo-jacking) rather than an update, because the name can be
 * re-registered by anyone after the original repository is deleted or renamed away.
 */
export class SourceRepositoryChangedError extends Error {
  constructor(
    public readonly sourceId: string,
    public readonly expectedRepoId: number,
    public readonly actualRepoId: number,
    message: string,
  ) {
    super(message);
    this.name = "SourceRepositoryChangedError";
  }
}

export function isSourceRepositoryChangedError(
  error: unknown,
): error is SourceRepositoryChangedError {
  return error instanceof SourceRepositoryChangedError;
}

export interface SourceRepositoryIdentityInput {
  sourceId?: string;
  sourceName?: string;
  expectedRepoId?: number;
  actualRepoId?: number;
  allowRepositoryChange?: boolean;
}

/**
 * Trust-on-first-use: the first successful scan records the repository id and every
 * later scan must match it. An unavailable id (rate limit, private repo, older
 * index entry) leaves the check disabled rather than blocking the scan.
 */
export function assertSourceRepositoryIdentity(
  input: SourceRepositoryIdentityInput,
): void {
  if (
    input.allowRepositoryChange ||
    input.expectedRepoId === undefined ||
    input.actualRepoId === undefined ||
    input.expectedRepoId === input.actualRepoId
  ) {
    return;
  }

  const sourceId = input.sourceId || "unknown source";
  throw new SourceRepositoryChangedError(
    sourceId,
    input.expectedRepoId,
    input.actualRepoId,
    `${input.sourceName || sourceId} now resolves to a different GitHub repository (recorded id ${input.expectedRepoId}, current id ${input.actualRepoId}). The update was refused because the repository may have been renamed away and re-registered by someone else.`,
  );
}

/**
 * Keeps curated fields (name, description, includePaths, ...) and only takes the
 * facts a scan is authoritative for.
 */
export function mergeScannedSource(existing: Source, scanned: Source): Source {
  return {
    ...existing,
    url: scanned.url || existing.url,
    repoId: scanned.repoId ?? existing.repoId,
  };
}
