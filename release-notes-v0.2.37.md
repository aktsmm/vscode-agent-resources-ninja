# Agent Resources Ninja v0.2.37

## Highlights

- Added safe resource index accessors and routed Browse view, Chat Participant, MCP tools, selected command flows, preview/search helpers, instruction sync, and shared-index export through them.
- Malformed runtime index shapes now fall back to empty resource arrays with OutputChannel diagnostics instead of `undefined.skills`-style crashes.
- Added bundled index content validation, user-facing/read-only `.skills` read guards, safe accessor and load-recovery regression coverage, and script-side index shape checks.
- Added explicit fail-fast validation at index updater mutation boundaries so malformed mutable index arrays are reported with field-specific errors.
- Kept `resourceNinja.refCatalogFormat` as the README index detail switch after native README index placement cleanup.

## Verification

- `npm run compile`: PASS
- `npm run test:resources`: PASS
- `node scripts/test-whenToUse.js`: PASS
- `node scripts/test-search-logic.js`: PASS
- `npm test`: PASS
- `npm audit --audit-level=moderate`: PASS

## Artifact

- VSIX: `agent-resources-ninja-0.2.37.vsix`
- Size: 354,193 bytes (345.89 KB packaged, 12 files)
- SHA256: `911FD113C6AEFBE851B416CB12500AF86C625BC1211B8DD7C5936DCB4756174F`
