# Agent Resources Ninja v0.2.57

## Highlights

- Incomplete skill and hook downloads no longer count as successful installs. A failure while updating output, registering a plugin, or refreshing a view after a completed install is reported separately.
- Reinstall requires the recorded source and remote path to match the index. A same-name resource at another path cannot silently replace the old copy.
- Failed batch reinstalls can open an optional GitHub issue draft containing counts and known failure categories, without resource names, paths, or raw errors. No issue is submitted automatically.
- Index updates list bounded added and removed resource names even when the total is unchanged. These index changes are not treated as proof of an upstream rename.
- User Profile installs disclose when a resource actually goes to Global Resource Home, including mixed-kind install sets.
- The Microsoft Azure Skills catalog no longer includes the upstream-deleted `azure-cost` path. Only that source was rescanned; the catalog-wide scan date and other sources remain unchanged.
- Updated the development-only `js-yaml` override to 5.4.2; a clean install and full dependency audit passed. The lockfile retains public npm URLs.

## Compatibility

- `resourceNinja.refCatalogFormat` remains supported and unchanged.
- Command IDs, settings, shared-store contracts, and existing install destinations remain unchanged.
- The bundled resource index is v1.29.0 with 2,652 resources across 24 sources.
- A renamed skill still requires a separately verified identity; the old installed copy is not removed automatically.

## Verification

- TypeScript compile, ESLint, and production build: PASS
- Offline Resource regression suite: 95/95 PASS, 3 network tests skipped
- Upstream catalog suite: 98/98 PASS, 0 skipped
- Extension Host smoke test: 1/1 PASS
- Azure Skills raw installability audit: PASS for the refreshed source
- Runtime and full dependency audits: 0 vulnerabilities
- Marketplace PAT preflight: PASS for publisher `yamapan`
- VSIX content and release hygiene: PASS; 12 runtime files, without source, tests, or sourcemaps
- Isolated VSIX installation and extension-version readback: `yamapan.agent-resources-ninja@0.2.57` PASS

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.57.vsix`
- Size: 522,455 bytes
- SHA256: `1D79A943D228D3A6BA2D339D47E62F8BC80B4EE1B0F2F67342D701253394CCF2`
