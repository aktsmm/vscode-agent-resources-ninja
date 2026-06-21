# Agent Resources Ninja v0.2.34

Release date: 2026-06-21

## Summary

This release adds private GitHub repository support for user-added resource sources and completes the source removal workflow for Agent Mode. Resource source scans now preserve public repository behavior while falling back to authenticated GitHub Contents API reads when private repository files cannot be read through public raw URLs.

Source removal remains index-only: it removes the source, indexed resources, and bundles from the resource index and shared stores when enabled, but it does not delete installed workspace, user, or global resource files.

The bundled resource index remains `v1.24.0` with 2,598 resources across 24 sources.

Ref output catalog detail remains controlled by `refCatalogFormat`.

## Changes

- Added private GitHub repository indexing for user-added source repositories.
- Added authenticated GitHub Contents API fallback for indexed resource file reads.
- Added explicit Git Trees API truncation detection to avoid partial source indexes.
- Added Agent Mode tool `#removeResourceSource` for source repository removal.
- Extended Remote Resources context menus so source removal works from repository-first and resource-type-first layouts.
- Clarified GitHub token guidance for fine-grained PAT `Contents: Read`, classic PAT `repo`, SSO, and organization approval cases.
- Normalized root-level resource content paths so root `LICENSE` files are fetched correctly.

## Verification

- `npm run compile`: PASS
- `npm run test:resources`: PASS
- `npm test`: PASS
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities
- `node scripts/test-index-updater-private-source.js`: PASS
- `git diff --check`: PASS

## VSIX

- File: `agent-resources-ninja-0.2.34.vsix`
- Path: `artifacts/vsix/agent-resources-ninja-0.2.34.vsix`
- Size: 348,356 bytes
- SHA256: `57A9578B78C3282A86948B8713BC69F3A314F0FF80096ED7B53328615D5B87C6`
- Payload: 12 files; runtime files only (`dist/extension.js`, package metadata/NLS, README, CHANGELOG, LICENSE, icon assets, bundled resource index).
