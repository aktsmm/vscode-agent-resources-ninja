# Agent Resources Ninja v0.2.40

## Highlights

- Source updates now fetch public raw content anonymously, retry private content through authenticated GitHub APIs only after an anonymous `404`, classify authentication and rate-limit failures, and keep tokens out of public requests, logs, and notifications.
- Explicit full-index and stale-source updates stop after a classified GitHub rate limit, preserve failed and unattempted source entries, and record per-source `OK` / `FAILED` / `SKIPPED` diagnostics.
- Progress advances only after each source finishes, partial results use one localized notification, and authentication recovery opens the relevant setting directly without a duplicate error dialog.
- `#updateResourceIndex` reports truthful resource-oriented English/Japanese results instead of treating partial updates as full success.
- Consolidated the retired GitHub Copilot for Azure plugin payload source into canonical `microsoft/azure-skills`; Resource Index v1.27.0 contains 2,571 resources across 23 sources, with a compatibility alias for existing installs.

## Settings

- No settings were added or removed in this release. The `resourceNinja.refCatalogFormat` setting and its default behavior are unchanged.

## Verification

- `npm run compile`: PASS
- `npm run test:resources`: PASS
- `node scripts/test-whenToUse.js`: PASS (19/19)
- `node scripts/test-search-logic.js`: PASS
- `npm test`: PASS (Extension Host smoke 1/1)
- `npm run audit:runtime`: PASS (0 vulnerabilities)
- Full development audit: guarded; the remaining `brace-expansion` advisory reports no patched version and does not affect packaged runtime dependencies.

## Artifact

- VSIX: `agent-resources-ninja-0.2.40.vsix`
- Size: 367,540 bytes (358.93 KB)
- SHA256: `A99EE8BDA6B8FC169E804681C439DAA6C2C33177E0AF053B0966DE077C46134B`
