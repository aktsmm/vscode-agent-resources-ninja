# Agent Resources Ninja v0.2.30

Release date: 2026-05-28

## Summary

This patch release finishes the reinstall and uninstall hardening work that remained after the 0.2.29 line.

When a reinstall target is missing from the current index, Agent Resources Ninja now tells users which source index will be refreshed and limits the refresh to the affected source whenever that upstream repository is known. This makes the recovery path faster and easier to understand, especially during reinstall flows that already know the original repository.

This release also closes two metadata consistency gaps. Install-time writes now normalize `source` for `.skill-meta.json` and non-skill sidecars, and local resource scans preserve plugin manifest metadata from those sidecars so plugin-derived resources keep their package context across reinstall and grouping flows.

Finally, hook uninstall is now rollback-safe. If `hooks.json` is updated but the hook directory delete fails afterward, the extension restores `hooks.json` from a backup so the user does not end up in a partial uninstall state.

## Changes

- Added source-aware missing-index prompts and progress titles for reinstall flows.
- Kept missing-index refresh scoped to the affected source whenever possible.
- Normalized install-time `source` metadata for skills and non-skill sidecars.
- Preserved plugin sidecar metadata during local scans.
- Added automatic `hooks.json` backup and restore during hook uninstall rollback.
- Added regression guards for batch reinstall partial failures and hook uninstall rollback.

## Verification

- `npm run compile`: PASS
- `npm run test:resources`: PASS
- `node scripts/test-whenToUse.js`: PASS
- `node scripts/test-search-logic.js`: PASS
- `node scripts/test-manifest-consistency.js`: PASS
- `node scripts/test-readme-release-ux.js`: PASS
- `node scripts/test-hook-config.js`: PASS
- `npm test`: PASS (exit 0, verified from `artifacts/tmp-release-validation/npm-test.log`)
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities
- `node esbuild.js`: PASS

## VSIX

- File: `agent-resources-ninja-0.2.30.vsix`
- Size: `337211 bytes`
- SHA256: `8cd28cbfeeb4293d1e9dc6b88245364bdbf053d89d1c93fcb8b7c32448a421ad`