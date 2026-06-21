# Agent Resources Ninja v0.2.33

Release date: 2026-06-21

## Summary

This release adds Oh My Codex (OMX) as a bundled community preset source. The preset index now discovers the distribution-ready Codex plugin package under `plugins/oh-my-codex/`, including OMX skills, the plugin hook manifest, and Codex plugin metadata without indexing repository internals.

The bundled resource index is updated to `v1.24.0` with 2,598 resources across 24 sources. The new `oh-my-codex` source contributes 31 resources: 29 skills, 1 hook config, and 1 Codex plugin manifest.

Ref output catalog detail remains controlled by `refCatalogFormat`.

## Changes

- Added `Yeachan-Heo/oh-my-codex` as a bundled community preset source.
- Path-filtered the source to `plugins/oh-my-codex/` to keep indexing scoped to the distributable plugin payload.
- Updated README source tables and version info metadata for Resource Index `v1.24.0`.
- Verified all `oh-my-codex` raw resource URLs are installable.

## Verification

- `npm run compile`: PASS
- `npm run test:resources`: PASS
- `npm test`: PASS
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities
- `oh-my-codex` installability audit: PASS, 31/31 reachable resources
- `git diff --check`: PASS

## VSIX

- File: `agent-resources-ninja-0.2.33.vsix`
- Path: `artifacts/vsix/agent-resources-ninja-0.2.33.vsix`
- Size: 346,247 bytes
- SHA256: `FF75F35527DDC22DC7B5F2ED292A9F4B6BB46F1F3606086D5F86DF631D6F524A`
- Payload: 12 files; runtime files only (`dist/extension.js`, package metadata/NLS, README, CHANGELOG, LICENSE, icon assets, bundled resource index).
