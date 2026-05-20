# Agent Resources Ninja v0.2.26

Release date: 2026-05-21

## Summary

This patch release fixes explicit remote source refresh in both Remote Resources layouts. `Update This Source` now works from repository-first and resource-type-first views, and manual single-source refreshes force a real rescan instead of being skipped by the shared-index dedup window.

This release also adds a regression guard for the refresh contract and documents the behavior in both README editions so the source-refresh path stays discoverable and protected. Ref output continues to use the native README placement model, with `resourceNinja.refCatalogFormat` remaining the detail-level switch for generated indexes.

## Changes

- Fixed `Update This Source` to accept both `source` and `remoteKindSource` browse items.
- Forced manual single-source refresh to bypass the shared 5-minute scan dedup window.
- Added manifest-consistency regression coverage for the explicit refresh contract.
- Updated README and README_ja to state that Remote Resources source refresh works from either layout.

## Verification

- `npm run compile`: PASS
- `npm run test:resources`: PASS
- `node scripts/test-whenToUse.js`: PASS
- `node scripts/test-search-logic.js`: PASS
- `npm test`: PASS
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities

## VSIX

- File: `agent-resources-ninja-0.2.26.vsix`
- Size: `339715 bytes`
- SHA256: `12DF7799DE3C28F6DCC858E9DAE0BB0EBE581384C1E5F4208949AB0B5DD06DD7`
