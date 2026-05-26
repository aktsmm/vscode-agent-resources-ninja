# Agent Resources Ninja v0.2.28

Release date: 2026-05-26

## Summary

This patch release hardens remote resource install and coexistence cleanup paths that were still fragile around temporary entries and shared catalog handoff. Temporary search or preview entries without a persisted source now reconstruct their remote GitHub origin from raw URLs and tree or blob URLs, so install no longer drops to placeholder skill content or aborts for non-skill resources.

The bundled preset index was also audited against current raw GitHub content paths. Unreachable preset entries were pruned, the now-empty goose-official source was removed, and release-facing resource counts were synchronized. On the coexistence side, shared ref catalog README cleanup now removes stale `agent-ninja` compressed blocks while preserving the current `resource-ninja-catalog` content and any manual README text around it.

Ref output continues to use the native README placement model, with `resourceNinja.refCatalogFormat` remaining the detail-level switch for generated indexes.

## Changes

- Restored temporary remote install for search or preview entries without a persisted source by reconstructing owner or repo or branch or path from raw GitHub, tree, and blob URLs.
- Normalized saved GitHub source URLs to repository roots so tree or blob URLs do not persist as source metadata.
- Added a raw-only bundled installability audit and pruned unreachable preset entries.
- Removed the zero-resource goose-official preset source and synchronized the release-facing source and resource counts.
- Added an integration-style coexistence fixture for shared ref catalog cleanup so stale `agent-ninja` compressed blocks are removed while current `resource-ninja-catalog` blocks remain.
- Documented release preflight checks for `node scripts/audit-resource-installability.js --raw-only` and `npx --yes vsce verify-pat -p "$env:VSCE_PAT"`.

## Verification

- `npm run compile`: PASS
- `npm run test:resources`: PASS
- `node scripts/test-whenToUse.js`: PASS
- `node scripts/test-search-logic.js`: PASS
- `npm test`: PASS
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities
- `node scripts/audit-resource-installability.js --raw-only`: PASS

## VSIX

- File: `agent-resources-ninja-0.2.28.vsix`
- Size: `333832 bytes`
- SHA256: `8de8a84e6a03085349960a4088b2922e8cdacc1d29281794575e6663485ebb8b`