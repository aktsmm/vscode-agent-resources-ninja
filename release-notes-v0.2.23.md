# Agent Resources Ninja v0.2.23

Release date: 2026-05-19

## Summary

This patch release makes Browse view double-click behavior consistent with the row action for remote resources, documents the install vs reinstall split in both READMEs, and restores release-note hygiene for the current release line.

Ref output continues to use the native README placement introduced in v0.2.21, with `resourceNinja.refCatalogFormat` remaining the detail-level control.

## Changes

- Browse view double-click now mirrors the row action for remote resources: uninstalled rows install with the default target, already-installed remote rows reinstall from recorded source metadata.
- Tightened Browse-side installed detection so local-only installs without remote metadata no longer appear as remotely reinstallable.
- Documented the Remote Resources install / reinstall split in README and README_ja.
- Restored the missing `release-notes-v0.2.22.md` artifact and kept current release-facing metadata in sync.

## Verification

- `npm run compile`: PASS
- `npm run test:resources`: PASS
- `npm test`: PASS
- `node scripts/test-readme-release-ux.js`: PASS
- `node scripts/test-ref-resource-catalog.js`: PASS
- `node scripts/test-manifest-consistency.js`: PASS
- `node scripts/test-release-hygiene.js`: PASS
- `node scripts/test-whenToUse.js`: PASS
- `node scripts/test-search-logic.js`: PASS
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities

## VSIX

- File: `agent-resources-ninja-0.2.23.vsix`
- Size: `338,058 bytes`
- SHA256: `E4BB37F799E14DCCF747CABE82D9A681CC85C8DC5F2B74A7F42883E5C9B43D53`
