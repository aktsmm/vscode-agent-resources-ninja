# Agent Resources Ninja v0.2.25

Release date: 2026-05-20

## Summary

This patch release makes built-in resources visible by default in User / Global Resource Home and aligns the empty-state welcome links with that behavior. The built-in visibility action now reads as a real toggle instead of a first-run show-only prompt, and the welcome copy stays compact enough for the view empty-state guard.

Ref output continues to use the native README placement model, with `resourceNinja.refCatalogFormat` remaining the detail-level switch for generated catalog indexes.

## Changes

- Enabled built-in VS Code / GitHub Copilot Chat / GitHub Copilot CLI resources by default in User / Global Resource Home.
- Updated the User / Global Resource Home welcome copy to use `resourceNinja.toggleBuiltInResources` instead of a stale show-only action.
- Shortened the English and Japanese welcome text so the empty-state compactness guard continues to pass.
- Revalidated the built-in visibility, welcome UX, localization, manifest, and release-facing checks.

## Verification

- `npm run compile`: PASS
- `npm run test:resources`: PASS
- `npm test`: PASS
- `node scripts/test-release-hygiene.js`: PASS
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities

## VSIX

- File: `agent-resources-ninja-0.2.25.vsix`
- Size: `339122 bytes`
- SHA256: `E2EF55C352DEE3D31DA660F3512A29294C91C3B17598CF23000F7CC96EF98D39`
