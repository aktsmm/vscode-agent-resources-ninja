# Agent Resources Ninja v0.2.10

Release date: 2026-05-10

## Summary

This patch release tightens Workspace Resources local discovery so configured workspace directories are treated as the primary source of truth. Workspace-wide discovery remains available only as a fallback path, and fallback local `SKILL.md` entries are no longer included in generated Agent Skills indexes by default.

## Changes

- Workspace Resources now scans configured workspace directories first.
- Workspace-wide discovery is used only after configured roots return no matches.
- `resourceNinja.includeLocalResources` now defaults to `false` and explicitly controls fallback-discovered local `SKILL.md` inclusion in Agent Skills indexes.
- README / README_ja and settings descriptions now describe the configured-roots-first behavior.
- Added scan-policy regression coverage.

## Verification

- `npm run check-types`: PASS
- `npm run lint`: PASS
- `node esbuild.js`: PASS
- `node scripts/test-whenToUse.js`: PASS
- `node scripts/test-search-logic.js`: PASS
- `node scripts/test-configured-root-scan-policy.js`: PASS
- `node scripts/test-manifest-consistency.js`: PASS
- `npm run test:resources`: PASS
- `npm audit --audit-level=moderate`: PASS
- `npm run package`: PASS
- `npx --yes vsce package --no-dependencies`: PASS
- `node scripts/test-release-hygiene.js`: PASS

## VSIX

- File: `agent-resources-ninja-0.2.10.vsix`
- Size: 307,541 bytes
- SHA256: `8F3BDAEEAEEB82E5DA5C29092777E287183B56B4CF88BBF3805AFFC85642EBE8`
