# Agent Resources Ninja v0.2.35

## Highlights

- Added per-source index freshness metadata and startup stale source handling with `resourceNinja.staleSourceIndexUpdateMode`.
- Preserved `lastIndexedAt` in the shared sources manifest and kept failed source refreshes retryable.
- Localized short Chat Participant and MCP tool responses through runtime helpers.
- Added source freshness, shared sources manifest, startup flow, and i18n guard coverage.
- `resourceNinja.refCatalogFormat` remains the supported setting for Ref output detail; no removed Ref output directory setting is reintroduced.
- Packaging scripts now run the production build directly; typecheck and lint remain explicit release gates.

## Verification

- `node scripts/test-source-index-freshness.js`: PASS
- `node scripts/test-shared-sources-manifest.js`: PASS
- `node scripts/test-manifest-consistency.js`: PASS
- `node scripts/test-localization-ux.js`: PASS
- `node .\node_modules\typescript\bin\tsc --noEmit`: PASS
- `node .\node_modules\eslint\bin\eslint.js src --format json`: PASS
- `node esbuild.js`: PASS
- `npm run test:resources`: PASS
- `node scripts/test-whenToUse.js`: PASS
- `node scripts/test-search-logic.js`: PASS
- `npm audit --audit-level=moderate`: PASS
- `npm test`: PASS

## Artifact

- VSIX: `agent-resources-ninja-0.2.35.vsix`
- Size: 352,004 bytes
- SHA256: `6cc9d6a3c7d757212f1dc5f3c46634b110cdfee3fe8adea1b3cf8e1c2bfaede3`
