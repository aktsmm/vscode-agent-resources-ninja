# Agent Resources Ninja v0.2.22

Release date: 2026-05-19

## Summary

This patch release tightens Browse view install affordances so installed remote resources can be reinstalled from the same surface, and double-click behavior now follows the same install vs reinstall split without treating local-only rows as remote-installed.

Ref output continues to use the native README placement introduced in v0.2.21, with `resourceNinja.refCatalogFormat` remaining the detail-level control.

## Changes

- Replaced the misleading Install inline action on already-installed remote Browse rows with Reinstall while keeping local-only rows out of the remote install/reinstall path.
- Double-click on Remote Resources now mirrors the row action: uninstalled rows install, already-installed remote rows reinstall from recorded source metadata.
- Tightened Browse-side installed detection so local-only installs without remote metadata no longer appear as remotely reinstallable.

## Verification

- `npm run compile`: PASS
- `node scripts/test-ux-scope-actions.js`: PASS
- `node scripts/test-representative-flows.js`: PASS
- `node scripts/test-manifest-consistency.js`: PASS
- `node scripts/test-release-hygiene.js`: PASS
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities

## VSIX

- File: `agent-resources-ninja-0.2.22.vsix`
- Size: `337,433 bytes`
- SHA256: `60EE28025754F8DF26DFC417CC80543A00A87F60521DD5C8DC98D940FEE9C37F`
