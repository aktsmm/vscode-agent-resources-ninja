# Agent Resources Ninja v0.2.56

## Highlights

- Reinstall batches now retry only classified server or transport failures, with one automatic retry and at most one manual retry. Retry never removes the existing resource again, and cancellation preserves unattempted items in the final summary.
- Resource metadata, instruction files, and reference catalogs now distinguish missing files from unreadable or malformed data. Unsafe reads stop writes instead of replacing existing content with defaults.
- Resource output updates now report explicit updated, unchanged, disabled, deferred, unreadable, locked, or failed states. A successful install remains successful while a separate warning explains an output failure.
- Agent Skills Ninja's shared `reinstallDisabled` metadata is preserved and respected across Workspace, Browse, and User/Global views, startup checks, batch selection, and direct commands.
- Workspace and User/Global group actions re-resolve the current root before acting, so stale TreeItems, changed destinations, same-label roots, and Windows path casing cannot redirect a batch to another root.
- Updated the transitive HumanFS packages used by ESLint to versions that address GHSA-p498-v437-472g without adding a direct dependency.

## Compatibility

- `resourceNinja.refCatalogFormat` remains supported and unchanged.
- `resourceNinja.useSharedSourcesManifest` and `resourceNinja.useSharedResourceIndex` remain off by default.
- The shared-store lock payload, stale windows, heartbeat, and reclaim naming remain aligned with the skill-only sibling extension.
- Shared `registrationDisabled`, `remotePath`, `reinstallDisabled`, `reinstallDisabledReason`, and `reinstallDisabledAt` metadata remain forward-compatible across both extensions.
- Existing command IDs, settings, install destinations, and forced reinstall repair paths remain unchanged.
- Resource Index remains v1.28.0 with 2653 resources across 24 sources.

## Verification

- TypeScript compile, ESLint, and production build: PASS
- Offline resource regression suite: 95/95 PASS, 3 network tests skipped
- Upstream catalog suite: 98/98 PASS, 0 skipped
- Extension Host smoke test: 1/1 PASS
- Runtime and full dependency audits: 0 vulnerabilities
- Marketplace PAT preflight: PASS for publisher `yamapan`
- Current-root focused regression: PASS for Windows case normalization, same-label root isolation, stale/missing/read-only rejection, and refresh-time reload

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.56.vsix`
- Size: 519,655 bytes
- SHA256: `37F41896D86F44F2DE4BAA2CC962D2897A00CD10891CF659CA3C0CA0627B1470`
- Payload: 12 files, no `src`, `scripts`, `test`, `.github`, `.vscode`, sourcemap, or release-note content
