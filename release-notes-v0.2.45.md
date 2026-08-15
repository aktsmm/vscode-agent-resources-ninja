# Agent Resources Ninja v0.2.45

## Highlights

- Hardened local resource containment with real-path resolution. Symlink and junction escapes, broken links, and recursive deletion of the allowed root are refused before write or delete operations.
- Classified GitHub server and transport failures explicitly, restricted automatic retries to bounded transient kinds, and applied a short TTL to every unverified default-branch fallback.
- Made batch installs, reinstalls, skill deletions, and plugin-resource deletions cancellable between resources. Partial results now distinguish successful, failed, and unprocessed items.
- Fixed JSON hook metadata to use an adjacent `<hook>.json.resource-ninja.json` sidecar. Metadata scanning, deletion, custom targets, and legacy plugin-hook migration share the same file-backed contract.
- Added filesystem-backed legacy hook migration coverage and behavior tests for batch result formatting, branch-cache recovery, link containment, and cancellation contracts.
- Refreshed compatible development dependencies. Full and runtime dependency audits both report zero vulnerabilities, and the lockfile contains public registry URLs with SHA-512 integrity.

## Compatibility

- `resourceNinja.refCatalogFormat` remains supported and unchanged. Existing generated reference catalogs keep their configured format.
- Resource Index remains v1.28.0 with 2648 resources across 24 sources. Index-wide freshness remains 2026-07-30 because this release does not perform a full upstream regeneration.
- Cancellation is cooperative between resources; an individual install or delete already in progress is allowed to finish.
- Hook README resources remain directory-backed. Hook JSON resources are file-backed in workspace, Global Resource Home, User Data, and custom targets.
- Paths that resolve outside the selected resource root through a symlink or junction are intentionally rejected.

## Verification

- `npm run compile`: PASS
- `npm run test:resources`: PASS (`75/75`, 3 declared network tests skipped by the offline gate)
- `npm run test:upstream`: PASS (`78/78`, no skips)
- `npm test`: PASS (`1/1` Extension Host smoke)
- `npm audit --audit-level=moderate`: PASS (0 vulnerabilities)
- `npm run audit:runtime`: PASS (0 vulnerabilities)
- Packaged VSIX install: PASS in an isolated `--user-data-dir` / `--extensions-dir` profile (`yamapan.agent-resources-ninja@0.2.45`)
- Exact extracted VSIX bits Extension Host smoke: PASS (`1/1`, core commands registered)

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.45.vsix`
- Size: 468,072 bytes
- SHA256: `A04487EEEF83CAF52B117893F5D038AA49D3057B1D734AB1757579495BF1A4D4`
- Payload: 12 files; compiled entrypoint, package metadata, locales, icon assets, license, README, changelog, and Resource Index present; no source maps, source/test directories, or release notes
