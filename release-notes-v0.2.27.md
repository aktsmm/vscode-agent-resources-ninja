# Agent Resources Ninja v0.2.27

Release date: 2026-05-23

## Summary

This patch release fixes the startup warning symmetry around metadata-less personal skills. Personal skills under Global Resource Home and other user-managed locations are now normalized to `local` instead of lingering as `unknown`, so startup index-mismatch warnings stop treating them like missing remote installs.

The same normalization now runs through bulk metadata refresh, single-skill refresh, installed metadata fallback, and manual metadata bootstrap. This release also tightens the upgrade prompt's remote-skill count so only real remote installs with `remotePath` are considered remotely reinstallable.

Ref output continues to use the native README placement model, with `resourceNinja.refCatalogFormat` remaining the detail-level switch for generated indexes.

## Changes

- Normalized metadata-less personal skills to `local` when no remote install metadata is present.
- Applied the same source cleanup across bulk refresh, single refresh, installed-metadata fallback, and manual metadata bootstrap.
- Tightened the upgrade remote-skill count so local personal skills are not counted as remote reinstall targets.
- Added static regression guards for source normalization symmetry and upgrade remote-skill counting.

## Verification

- `npm run compile`: PASS
- `npm run test:resources`: PASS
- `node scripts/test-whenToUse.js`: PASS
- `node scripts/test-search-logic.js`: PASS
- `npm test`: PASS
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities

## VSIX

- File: `agent-resources-ninja-0.2.27.vsix`
- Size: `340404 bytes`
- SHA256: `FE2F3C589F74976119522F6928CD4E85FE8DF281D7F7ECD7CB68A799A5B6A386`
