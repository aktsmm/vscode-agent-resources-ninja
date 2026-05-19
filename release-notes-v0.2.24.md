# Agent Resources Ninja v0.2.24

Release date: 2026-05-19

## Summary

This patch release hardens uninstall recovery and coexistence safety. MCP uninstall now avoids mutating `.vscode/mcp.json` before the staged MCP file is actually removed, shared `.skill-meta.json` fields stay compatible with Agent Skills Ninja, and the tracked PowerShell helper task now runs correctly inside VS Code.

Ref output continues to use the native README placement introduced in v0.2.21, with `resourceNinja.refCatalogFormat` remaining the detail-level control.

## Changes

- Reordered MCP uninstall cleanup so staged MCP files are deleted before shared workspace config is mutated.
- Preserved the shared `.skill-meta.json` coexistence fields `registrationDisabled` and `remotePath` during reinstall and documented them as cross-extension contract fields.
- Fixed the tracked `temp-confirm-location-branch` helper task to invoke `pwsh` with `-Command`.
- Added regression guards for MCP uninstall sequencing, shared skill metadata contracts, and PowerShell task invocation.

## Verification

- `npm run compile`: PASS
- `npm run test:resources`: PASS
- `npm test`: PASS
- `node scripts/test-skill-meta-contract.js`: PASS
- `node scripts/test-whenToUse.js`: PASS
- `node scripts/test-search-logic.js`: PASS
- `node scripts/test-release-hygiene.js`: PASS
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities

## VSIX

- File: `agent-resources-ninja-0.2.24.vsix`
- Size: `338,792 bytes`
- SHA256: `B1EC9C73CF58B97C435EA49F77D2A3B23D35ED0B7491AA40991E42DA6676D987`
