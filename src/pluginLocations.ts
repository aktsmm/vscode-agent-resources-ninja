// Helpers for the VS Code `chat.pluginLocations` map.
// Kept free of `vscode` imports so plain-Node regression scripts can load the real code.

// VS Code registers `chat.pluginLocations` from 1.116 onward; the Agent Plugins
// feature does not exist on the older builds this extension still supports.
const MIN_PLUGIN_LOCATIONS_MAJOR = 1;
const MIN_PLUGIN_LOCATIONS_MINOR = 116;

/**
 * Whether the running VS Code build knows the `chat.pluginLocations` setting.
 * An unrecognized or empty version fails closed, because offering to write a
 * setting that is not registered only produces an error the user cannot act on.
 */
export function supportsPluginLocations(vscodeVersion: string): boolean {
  if (typeof vscodeVersion !== "string") {
    return false;
  }
  // Major and minor are compared as numbers: lexically "1.9" sorts after
  // "1.116", which would wrongly report the feature on VS Code 1.9.
  const match = /^\s*(\d+)\.(\d+)(?:\D|$)/.exec(vscodeVersion);
  if (!match) {
    return false;
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) {
    return false;
  }
  if (major !== MIN_PLUGIN_LOCATIONS_MAJOR) {
    return major > MIN_PLUGIN_LOCATIONS_MAJOR;
  }
  return minor >= MIN_PLUGIN_LOCATIONS_MINOR;
}

/**
 * Normalizes a filesystem path into the key form `chat.pluginLocations` uses:
 * forward slashes, no trailing slash. Case is preserved because the setting is
 * compared verbatim.
 */
export function toPluginLocationKey(fsPath: string): string {
  const forwardSlashed = fsPath.replace(/\\/g, "/");
  // `D:\` must stay `D:/`: dropping the separator would turn a drive root into a
  // drive-relative path that names something else entirely.
  const driveRoot = /^([A-Za-z]:)\/+$/.exec(forwardSlashed);
  if (driveRoot) {
    return `${driveRoot[1]}/`;
  }
  const withoutTrailingSlash = forwardSlashed.replace(/\/+$/, "");
  // A path that is only slashes would otherwise normalize to an empty key.
  return withoutTrailingSlash || forwardSlashed;
}

// Plain assignment on a key of `__proto__` hits the prototype setter instead of
// creating an own property, which silently drops an entry `JSON.parse` produced.
function defineEntry(
  target: Record<string, boolean>,
  key: string,
  value: boolean,
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function toEntryMap(existing: unknown): Record<string, boolean> {
  const entries: Record<string, boolean> = {};
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
    return entries;
  }
  for (const [key, value] of Object.entries(
    existing as Record<string, unknown>,
  )) {
    defineEntry(entries, key, value === true);
  }
  return entries;
}

function hasEntry(entries: Record<string, boolean>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(entries, key);
}

/**
 * The keys registration would actually have to change: those missing from the
 * setting, plus those present but disabled.
 */
export function getPluginLocationsToRegister(
  existing: unknown,
  keys: string[],
): string[] {
  const entries = toEntryMap(existing);
  return keys.filter((key) => entries[key] !== true);
}

/**
 * Enables every key in `keys` and leaves every other entry exactly as it is,
 * including entries the user disabled. Asking to register a location is an
 * explicit request for it to load, so a listed key is forced to `true`.
 */
export function mergePluginLocations(
  existing: unknown,
  keys: string[],
): Record<string, boolean> {
  const merged = toEntryMap(existing);
  for (const key of keys) {
    defineEntry(merged, key, true);
  }
  return merged;
}

/**
 * Drops `keys` from the map and leaves every other entry untouched.
 */
export function removePluginLocations(
  existing: unknown,
  keys: string[],
): Record<string, boolean> {
  const remaining = toEntryMap(existing);
  for (const key of keys) {
    delete remaining[key];
  }
  return remaining;
}

// A registered location is always an ancestor directory of the resource files
// installed under it, so the candidates for a delete are the deleted path itself
// and its ancestors. The filesystem root and a bare drive root are excluded.
function toSelfAndAncestorKeys(fsPath: string): string[] {
  const keys: string[] = [];
  let current = toPluginLocationKey(fsPath);
  while (current && !/^[A-Za-z]:\/?$/.test(current)) {
    keys.push(current);
    const separatorIndex = current.lastIndexOf("/");
    if (separatorIndex <= 0) {
      break;
    }
    current = current.slice(0, separatorIndex);
  }
  return keys;
}

/**
 * `isContainedPath` from `./pathSafety`, passed in rather than imported: the
 * plain-Node regression loaders compile this file on its own and cannot resolve
 * a relative `.ts` import, so an import here would break them the way one added
 * to `resourceKinds.ts` once did.
 */
export type PathContainmentCheck = (
  rootFsPath: string,
  candidateFsPath: string,
) => boolean;

/**
 * The registered locations affected by the deleted resource paths. Matching
 * against the real setting instead of a path shape keeps a `custom` install
 * target removable while an entry unrelated to the deletion is left alone.
 *
 * Two directions are needed. Upwards, a deleted file names the plugin package it
 * lived in, and that walk stops at the nearest ancestor carrying the plugin
 * folder name so a registered ancestor such as a workspace root is never taken
 * out with it, even when it repeats that same name. Downwards, a deleted
 * directory can contain whole plugin folders whose names the caller has no way
 * to know, so that pass is bounded by containment alone.
 */
export function collectPluginLocationKeysForRemoval(
  existing: unknown,
  resourceFsPaths: string[],
  pluginFolderName: string,
  isPathContained: PathContainmentCheck,
): string[] {
  const entries = toEntryMap(existing);
  const keys = new Set<string>();
  for (const resourceFsPath of resourceFsPaths) {
    if (!resourceFsPath) {
      continue;
    }
    if (pluginFolderName) {
      for (const candidate of toSelfAndAncestorKeys(resourceFsPath)) {
        if (
          candidate.slice(candidate.lastIndexOf("/") + 1) !== pluginFolderName
        ) {
          continue;
        }
        if (hasEntry(entries, candidate)) {
          keys.add(candidate);
        }
        // The nearest ancestor with this name is the plugin package. Anything
        // above it only repeats the name and is a different folder.
        break;
      }
    }
    for (const registeredKey of Object.keys(entries)) {
      // Containment, not a string prefix: `.../pluginsX` shares a prefix with
      // `.../plugins` but is not inside it.
      if (isPathContained(resourceFsPath, registeredKey)) {
        keys.add(registeredKey);
      }
    }
  }
  return Array.from(keys);
}
