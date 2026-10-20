# Agent Resources Ninja v0.2.60

## Highlights

- Installed, User-Global and Remote Resources get a Filter and Sort picker for skills by invocation mode (`auto` / manual-only / model-only), with sort by name or by mode. Each choice applies immediately and the picker stays open. A filter on an index that has no invocation data says so instead of showing an empty tree.
- Update Index now records each skill's `invocation`, `argument-hint` and `context: fork` from its `SKILL.md`; search results, the preview and local-row tooltips show them. Bundled Resource Index v1.31.0 carries these fields for 2,059 skills; the remaining ones fill in on the next Update Index.
- New `resourceNinja.resourcesDirectoryPreset` (`custom` / `github` / `claude` / `agents`) picks the workspace skill folder from the settings UI. The default `custom` changes nothing for existing setups.
- Remote Resources supports multi-select, with three bulk-install entry points (context menu on the selection, a checkbox picker, and a source row). Batches check the real destination folder, so names that normalize to the same folder are no longer overwritten silently.
- Fixes: the reinstall command no longer treats the multi-select array as an install target; Agent Skills Ninja's folder-scoped `additionalSkillRoots` and directory preset are read per workspace folder; a malformed `argumentHint` in a cached or shared index no longer breaks the preview (it is dropped, sanitized and capped at 200 characters).

## Compatibility

- Existing resource kinds, install destinations, command IDs and the shared index-store contracts remain unchanged. New index fields are optional.
- `resourceNinja.refCatalogFormat` remains supported and unchanged.
- Agent Skills Ninja does not read `resourceNinja.resourcesDirectoryPreset`; when both are installed, set the preset in the extension whose folder you use.
- Bundled Resource Index v1.31.0 contains 2,788 resources across 24 sources (unchanged).

## Verification

- TypeScript compile, ESLint and production build: PASS
- Offline regression suite 99/99 (3 network tests skipped by default) and upstream catalog suite 102/102: PASS
- Isolated Extension Host: PASS, including live checks of the invocation picker, the folder preset and the three bulk-install commands (a production mutation probe made the bulk-install check fail)
- Dependency audit: 0 vulnerabilities
- Artifact: GitHub Release, Marketplace and the local VSIX compared by SHA256 with `scripts/Compare-ReleaseArtifact.ps1`

Visual confirmation in a real window and a bulk install from a real multi-row selection are not claimed as verified by these gates.

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.60.vsix`
- Size: 569,819 bytes
- SHA256: `69F9240EC5899E22A834071D938F81AAEC6735DC3FDBBC2FA146750E268F5B5C`
