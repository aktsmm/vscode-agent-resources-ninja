import { createHash } from "crypto";

/**
 * Remembers credentials that GitHub rejected for organization SSO or classic-PAT
 * policy, so a rejected credential is not re-sent on every request of the same
 * scan. State is process-lifetime only and is never persisted.
 */

const GITHUB_API_HOSTNAME = "api.github.com";
const RAW_GITHUB_HOSTNAME = "raw.githubusercontent.com";
/** GitHub logins are alphanumeric with inner hyphens. */
const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

export const GITHUB_CREDENTIAL_BLOCK_TTL_MS = 10 * 60 * 1000;

const blockedOwners = new Map<string, Map<string, number>>();
let blocklistEpoch = 0;

function decodePathSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/**
 * Returns the owner a credential would be blocked under, or undefined when the
 * URL cannot be attributed to one. Undefined always means "never blocked", so
 * an unrecognized URL keeps the current behavior instead of losing its token.
 */
export function getGitHubBlocklistOwner(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== "https:") {
    return undefined;
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  let rawOwner: string | undefined;
  if (parsed.hostname === GITHUB_API_HOSTNAME) {
    // Only /repos/{owner}/... names an owner; /search and /user do not.
    rawOwner = segments[0] === "repos" ? segments[1] : undefined;
  } else if (parsed.hostname === RAW_GITHUB_HOSTNAME) {
    rawOwner = segments[0];
  }

  if (!rawOwner) {
    return undefined;
  }

  const decoded = decodePathSegment(rawOwner);
  if (
    !decoded ||
    decoded.includes("/") ||
    !GITHUB_OWNER_PATTERN.test(decoded)
  ) {
    return undefined;
  }

  return decoded.toLowerCase();
}

/** Keeps raw tokens out of the map keys; never log this value. */
function fingerprintToken(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

function readLiveFingerprints(
  owner: string,
  now: number,
): Map<string, number> | undefined {
  const fingerprints = blockedOwners.get(owner);
  if (!fingerprints) {
    return undefined;
  }

  for (const [fingerprint, expiresAt] of fingerprints) {
    if (expiresAt <= now) {
      fingerprints.delete(fingerprint);
    }
  }

  if (fingerprints.size === 0) {
    blockedOwners.delete(owner);
    return undefined;
  }

  return fingerprints;
}

export function isGitHubCredentialBlocked(
  url: string,
  token: string | undefined,
  now: number = Date.now(),
): boolean {
  if (!token) {
    return false;
  }

  const owner = getGitHubBlocklistOwner(url);
  if (!owner) {
    return false;
  }

  return (
    readLiveFingerprints(owner, now)?.has(fingerprintToken(token)) ?? false
  );
}

/**
 * `epoch` must be the value captured when the operation started. A reset during
 * a long operation bumps the epoch, so an in-flight request cannot resurrect a
 * block that the user just asked us to clear. Returns true only when this call
 * introduced the block, so parallel rejections announce it once.
 */
export function markGitHubCredentialBlocked(
  url: string,
  token: string | undefined,
  epoch: number,
  now: number = Date.now(),
): boolean {
  if (!token || epoch !== blocklistEpoch) {
    return false;
  }

  const owner = getGitHubBlocklistOwner(url);
  if (!owner) {
    return false;
  }

  const fingerprint = fingerprintToken(token);
  const alreadyBlocked =
    readLiveFingerprints(owner, now)?.has(fingerprint) ?? false;
  const fingerprints = blockedOwners.get(owner) ?? new Map<string, number>();
  fingerprints.set(fingerprint, now + GITHUB_CREDENTIAL_BLOCK_TTL_MS);
  blockedOwners.set(owner, fingerprints);
  return !alreadyBlocked;
}

export function getGitHubCredentialBlocklistEpoch(): number {
  return blocklistEpoch;
}

/** Call at user-initiated operation boundaries so a re-authorized credential is retried immediately. */
export function resetGitHubCredentialBlocklist(): void {
  blockedOwners.clear();
  blocklistEpoch += 1;
}
