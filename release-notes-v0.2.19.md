# Agent Resources Ninja v0.2.19

Release date: 2026-05-18

## Summary

This patch release refines output-opening behavior around managed instruction targets. View toolbar and empty-state actions now stay scoped to their current view, while the Command Palette adds an explicit scope picker so users can choose workspace or global output intentionally.

## Changes

- Added a new generic `Open Resource Output...` command for Command Palette usage, with an explicit workspace vs global scope QuickPick.
- Kept workspace and User / Global Resource Home toolbar actions scoped to their current view instead of routing them through a generic picker.
- Hid scoped open commands from Command Palette so view-scoped actions and generic actions have clearly separated roles.
- Synced localization, README, CHANGELOG, and static regression coverage with the new output-opening split.

## Verification

- `npx vsce show yamapan.agent-resources-ninja --json`: PASS, Marketplace latest published version is 0.2.18 before publish
- `git ls-remote --tags origin v0.2.19`: PASS, `TAG_NOT_FOUND`
- `gh release view v0.2.19 --json tagName,name,url,isDraft,isPrerelease`: PASS, release not found before publish
- `node scripts/test-whenToUse.js`: PASS
- `node scripts/test-search-logic.js`: PASS
- `node scripts/test-ux-scope-actions.js`: PASS
- `node scripts/test-instruction-target-ux.js`: PASS
- `node scripts/test-localization-ux.js`: PASS
- `node scripts/test-manifest-consistency.js`: PASS
- `npm run test:resources`: PASS
- `npm test`: PASS
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities
- `npm run compile`: PASS
- `npm run package`: PASS
- `node scripts/test-release-hygiene.js`: PASS
- `code --install-extension .\agent-resources-ninja-0.2.19.vsix --force`: PASS

## VSIX

- File: `agent-resources-ninja-0.2.19.vsix`
- Size: `334,413 bytes`
- SHA256: `62175183E26BD64E4F4F95BAE39B8A4A89FE5D3618021140A114D848711F2CCB`