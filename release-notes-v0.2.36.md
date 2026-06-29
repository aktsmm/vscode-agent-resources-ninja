# Agent Resources Ninja v0.2.36

## Highlights

- SecretStorage-first GitHub authentication: tokens resolve in the order SecretStorage → `GITHUB_TOKEN` / `GH_TOKEN` environment variable → GitHub CLI → legacy `resourceNinja.githubToken` setting.
- The legacy `resourceNinja.githubToken` setting is migrated into VS Code SecretStorage on startup, synced when changed, and removed on reset, while remaining a backward-compatible fallback.
- Bounded the `gh auth token` lookup with a timeout and routed Web Search token retrieval through the shared resolver.
- Isolated post-install tree reveal failures so they no longer fail an otherwise successful install.
- Guarded resource search against an unloaded or malformed index.
- Kept `resourceNinja.refCatalogFormat` as the README index detail switch after native README index placement cleanup.
- Added `scripts/test-github-auth.js` (9 cases) and wired it into the `test:resources` suite.

## Verification

- `node scripts/test-github-auth.js`: PASS
- `npm run compile`: PASS
- `npm run test:resources`: PASS
- `node scripts/test-whenToUse.js`: PASS
- `node scripts/test-search-logic.js`: PASS
- `node scripts/test-manifest-consistency.js`: PASS
- `node scripts/test-localization-ux.js`: PASS
- `npm audit --audit-level=moderate`: PASS

## Artifact

- VSIX: `agent-resources-ninja-0.2.36.vsix`
- Size: 353,393 bytes (345.11 KB packaged, 12 files)
- SHA256: `E39D297A26E6CEBA86E308DB599FA163AF2EABA72E723354008FE3F727FFBD6A`
