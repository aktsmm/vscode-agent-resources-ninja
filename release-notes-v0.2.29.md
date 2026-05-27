# Agent Resources Ninja v0.2.29

Release date: 2026-05-28

## Summary

This patch release finishes two quality loops that were still open after the 0.2.28 line: runtime wording drift and unreliable local Extension Host smoke launches on Windows.

Generated instruction output and Workspace Resources empty-state hints now use the same runtime-localized search command copy as package NLS and README, removing the remaining hardcoded English command label path. This keeps English and Japanese guidance aligned across package metadata, runtime UI, and generated files.

For local smoke validation, `npm test` now routes through a Windows preflight wrapper that detects the `vscode-updating` mutex and aborts early with a clear message instead of launching the known popup/EPIPE path while update activity is still in progress. Successful smoke runs use the machine-installed VS Code executable plus isolated `.vscode-test/manual-local-launch` user-data and extensions directories.

Ref output behavior is unchanged in this patch release: `resourceNinja.refCatalogFormat` remains the detail-level switch for generated README indexes when Ref Output is enabled.

## Changes

- Replaced hardcoded search-command literals in generated instruction output and Workspace Resources empty-state hints with runtime-localized copy.
- Added a Windows preflight wrapper for `npm test` that detects the `vscode-updating` mutex and stops before the known popup/EPIPE route.
- Pointed `.vscode-test.mjs` at the machine-installed VS Code executable with isolated `.vscode-test/manual-local-launch` sandbox paths.
- Added manifest and README regression guards for the smoke mutex preflight and isolated sandbox contract.
- Updated README and README_ja so smoke-test expectations and retry guidance match the current Windows guard behavior.

## Verification

- `npm run compile`: PASS
- `npm run test:resources`: PASS
- `node scripts/test-whenToUse.js`: PASS
- `node scripts/test-search-logic.js`: PASS
- `node scripts/test-manifest-consistency.js`: PASS
- `node scripts/test-readme-release-ux.js`: PASS
- `node scripts/test-localization-ux.js`: PASS
- `node scripts/test-ux-scope-actions.js`: PASS
- `npm test`: GUARD, exit 2 while local `vscode-updating` mutex is held
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities

## VSIX

- File: `agent-resources-ninja-0.2.29.vsix`
- Size: `335133 bytes`
- SHA256: `4db64b0f2ac47c79699e827619296888ff9048861dc05dec804cc4c47ab29f40`

