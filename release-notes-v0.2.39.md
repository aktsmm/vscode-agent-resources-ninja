# Agent Resources Ninja v0.2.39

## Highlights

- Added authentication-aware private GitHub resource downloads while keeping public raw requests anonymous and preventing token leakage in recovery reports.
- Migrated the compatible `pai-packs` preset to LifeOS and refreshed both official Azure preset sources. Resource Index v1.26.0 now contains 2,609 resources across 24 sources.
- Added a credential-free shallow Git fallback for GitHub Trees API rate limits and synchronized complete-source bundles atomically with source updates.
- Made failed non-skill and plugin installs atomic: only newly created partial artifacts are rolled back, while pre-existing files, directories, and non-empty parents are preserved.
- Updated development dependency overrides, added a packaged-runtime audit gate, and enforced public npm registry URLs with SHA-512 integrity in the lockfile.

## Settings

- No settings were added or removed in this release. The `resourceNinja.refCatalogFormat` setting and its default behavior are unchanged.

## Verification

- `npm run compile`: PASS
- `npm run test:resources`: PASS
- All `scripts/test-*.js`: PASS (52/52)
- `node scripts/test-whenToUse.js`: PASS (19/19)
- `node scripts/test-search-logic.js`: PASS
- `npm run audit:runtime`: PASS (0 vulnerabilities)
- Full development audit: guarded; the remaining `brace-expansion` advisory reports no patched version and does not affect packaged runtime dependencies.
- Extension Host smoke: guarded by the active VS Code updater mutex; the generated VSIX is installed locally before publication.

## Artifact

- VSIX: `agent-resources-ninja-0.2.39.vsix`
- Size: 365,712 bytes (357.14 KB)
- SHA256: `04932268DF07AD89DC5ECE82CCCD34C21A38FD1A2EFCF2DDBF6983AD2B151617`
