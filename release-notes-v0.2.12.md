# Agent Resources Ninja v0.2.12

Release date: 2026-05-12

## Summary

This patch release ships the coexistence/shared-block work for the skill-only sibling extension, aligns instruction-sync documentation with the current behavior, and further reduces VSIX payload size while adding stronger packaging guardrails.

## Changes

- Added shared-block coexistence owner handoff and status/recompute commands for Resource NINJA.
- Added standalone `kindsExcluded` hints so uninstall handoff behavior is explicit when the sibling extension is removed.
- Added shared `sources.json` and `index.json` stores plus lock helpers for coexistence SSOT reuse.
- Added Resource-side coexistence fixtures for the B/F validation scenarios.
- Updated README / README_ja and settings wording to describe generated instruction blocks and shared `agent-ninja` markers.
- Tightened VSIX packaging by excluding docs, output, artifacts, and README_ja from the payload while keeping marketplace rendering intact.
- Added hygiene guards for both release and dev VSIX payloads, icon asset presence, and README marketplace-safe Japanese link routing.

## Verification

- `npx --yes @vscode/vsce show yamapan.agent-resources-ninja --json`: PASS, latest Marketplace version is 0.2.11 before v0.2.12 prep
- `git ls-remote --tags origin v0.2.11`: PASS, matching remote tag exists
- `gh release view v0.2.11 --json "tagName,name,url,isDraft,isPrerelease"`: PASS, existing GitHub Release confirmed
- `npm run compile`: PASS
- `npm run test:resources`: PASS
- `node scripts/test-whenToUse.js`: PASS
- `node scripts/test-search-logic.js`: PASS
- `npm test`: PASS
- `node scripts/test-readme-release-ux.js`: PASS
- `node scripts/test-release-hygiene.js`: PASS
- `git diff --check`: PASS
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities
- `Code.exe --install-extension .\agent-resources-ninja-0.2.12.vsix --force`: PASS

## VSIX

- File: `agent-resources-ninja-0.2.12.vsix`
- Size: `305,540 bytes`
- SHA256: `9EF9DBE31F052B17BDEB4FB36138B8FAE800A762F596E65F6A1FC4F0192EC8A8`