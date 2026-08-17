# Agent Resources Ninja v0.2.50

## Highlights

- Fixed the shared store destroying data owned by the skill-only sibling extension. A shared file that could not be read was indistinguishable from one that did not exist, so the bootstrap replaced it with this extension's own list; reads now report `missing`, `valid` or `rejected` separately and only a genuinely absent file is created.
- Fixed the periodic sync and the scan-metadata update rebuilding `index.json` from this extension's own view. Ownership is read from each source's scan record, so resources and scan records this extension does not own are kept instead of deleted, and a resource already loaded into the runtime index is written once rather than duplicated on every save.
- Fixed local sources disappearing when shared syncing was turned on. Sharing is off by default, so sources added beforehand are absent from the shared file; that absence only means removal after this extension's own sources have reached the file once.
- Added a one-time warning per shared file when a refused write pauses syncing, with **Show Coexistence Status** and **Show Details**, because the pause was previously visible only as a line in the output channel.
- Changed per-source freshness to stop treating the bundled catalog's publish date as a scan time, and added `lastIndexedBy` so a timestamp written by the sibling extension is not counted as this extension's own scan.
- Hardened both shared files as untrusted input: sizes are capped through the open file handle and rejected whole, source entries are validated field by field, resource entries are validated before they are re-served, and readers no longer rename an unparseable file aside.

## Compatibility

- `resourceNinja.refCatalogFormat` remains supported and unchanged.
- `resourceNinja.useSharedSourcesManifest` and `resourceNinja.useSharedResourceIndex` remain off by default; machines that never enabled them are unaffected.
- A shared file written by an earlier version keeps working. `lastIndexedBy` is optional, and a timestamp or scan record without it is treated as this extension's own so existing sources do not all turn stale at once.
- Sources that were previously reported as fresh only because of the bundled catalog date are now reported as stale. With the default `resourceNinja.staleSourceIndexUpdateMode` of `prompt` this appears as a stale-source prompt listing more sources than before; the startup budget of five sources per launch is unchanged.
- A shared file this extension refuses to write is left exactly as it is. Repair or remove it to resume syncing; `Resource NINJA: Show Coexistence Status` reports the current state and the reason.
- Existing `sources.json.broken-*` and `index.json.broken-*` files left by earlier versions are not touched, because deleting by pattern in a shared directory would also catch the sibling extension's temporary files.
- The shared lock protocol is unchanged in this release; aligning it with the sibling extension requires a coordinated release and is not included here.
- Resource Index remains v1.28.0 with 2653 resources across 24 sources.
