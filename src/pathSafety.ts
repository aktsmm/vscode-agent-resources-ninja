// Path containment helpers for content that arrives from third-party repositories.
// Kept free of `vscode` imports so plain-Node regression scripts can load the real code.

import * as path from "path";

const WINDOWS_RESERVED_DEVICE_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "conin$",
  "conout$",
  ...Array.from({ length: 9 }, (_unused, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_unused, index) => `lpt${index + 1}`),
]);

// Win32 resolves `COM¹` to the `COM1` device, so the superscript forms are the
// same reserved names written differently.
const SUPERSCRIPT_DIGITS: Readonly<Record<string, string>> = {
  "\u00b9": "1",
  "\u00b2": "2",
  "\u00b3": "3",
};

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/; // eslint-disable-line no-control-regex

/**
 * True only when `segment` is one ordinary file or directory name that is safe to
 * append to a local path on any supported platform.
 */
export function isSafePathSegment(segment: string): boolean {
  if (typeof segment !== "string" || segment.trim().length === 0) {
    return false;
  }
  if (segment === "." || segment === "..") {
    return false;
  }
  if (
    segment.includes("/") ||
    segment.includes("\\") ||
    segment.includes(":")
  ) {
    return false;
  }
  if (CONTROL_CHARACTERS.test(segment)) {
    return false;
  }

  // Windows silently strips a trailing dot or space, so the written name would
  // differ from the name that was checked.
  const lastCharacter = segment[segment.length - 1];
  if (lastCharacter === "." || lastCharacter === " ") {
    return false;
  }

  const stem = segment
    .split(".")[0]
    .toLowerCase()
    .replace(
      /[\u00b9\u00b2\u00b3]/g,
      (character) => SUPERSCRIPT_DIGITS[character],
    );
  return !WINDOWS_RESERVED_DEVICE_NAMES.has(stem);
}

/**
 * Whether two filesystem paths on `platform` may differ only by case and still
 * be the same path. Exported so both branches can be tested on one host.
 */
export function shouldFoldPathCase(platform: string): boolean {
  return platform === "win32";
}

/**
 * True only when `candidateFsPath` resolves to `rootFsPath` itself or to something
 * underneath it.
 */
export function isContainedPath(
  rootFsPath: string,
  candidateFsPath: string,
): boolean {
  return isContainedPathOnPlatform(
    rootFsPath,
    candidateFsPath,
    process.platform,
  );
}

/**
 * Containment is not enough for a recursive delete: `isContainedPath` accepts a
 * candidate equal to the root, which would wipe the whole allowed root instead
 * of one resource inside it.
 */
export function isDeletableWithin(
  rootFsPath: string,
  candidateFsPath: string,
): boolean {
  return isDeletableWithinOnPlatform(
    rootFsPath,
    candidateFsPath,
    process.platform,
  );
}

export function isDeletableWithinOnPlatform(
  rootFsPath: string,
  candidateFsPath: string,
  platform: string,
): boolean {
  if (!isContainedPathOnPlatform(rootFsPath, candidateFsPath, platform)) {
    return false;
  }
  const fold = shouldFoldPathCase(platform);
  const root = path.resolve(rootFsPath);
  const candidate = path.resolve(candidateFsPath);
  return fold
    ? root.toLowerCase() !== candidate.toLowerCase()
    : root !== candidate;
}

/**
 * `isContainedPath` with the platform supplied, so the case-sensitive branch is
 * reachable from a test without reassigning `process.platform`.
 */
export function isContainedPathOnPlatform(
  rootFsPath: string,
  candidateFsPath: string,
  platform: string,
): boolean {
  if (
    typeof rootFsPath !== "string" ||
    typeof candidateFsPath !== "string" ||
    rootFsPath.length === 0 ||
    candidateFsPath.length === 0
  ) {
    return false;
  }

  const foldCase = shouldFoldPathCase(platform);
  const normalizeCase = (value: string): string =>
    foldCase ? value.toLowerCase() : value;

  const root = normalizeCase(path.resolve(rootFsPath));
  const candidate = normalizeCase(path.resolve(candidateFsPath));

  if (candidate === root) {
    return true;
  }

  // The separator keeps `C:\a\bcd` from counting as inside `C:\a\b`.
  const rootWithSeparator = root.endsWith(path.sep)
    ? root
    : `${root}${path.sep}`;
  return candidate.startsWith(rootWithSeparator);
}
