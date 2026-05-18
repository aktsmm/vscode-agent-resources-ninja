# Agent Resources Ninja v0.2.20

Release date: 2026-05-18

## Summary

This patch release makes managed output settings easier to understand and safer to operate. Ref output is now controlled by its own toggle, inline output formats remain available for direct instruction-file rendering, and output-related setting changes regenerate managed output immediately even when automatic resource-change sync is disabled.

## Changes

- Split Ref mode from inline output formatting by adding `resourceNinja.useRefOutput`, leaving `resourceNinja.outputFormat` for `full` / `compact` / `legacy` only.
- Regenerated managed output immediately when `useRefOutput`, `outputFormat`, `refCatalogDirectory`, or `refCatalogFormat` changes, even if `resourceNinja.autoUpdateInstruction` is off.
- Added dedicated Ref catalog enum descriptions and a quick decision guide in README / README_ja so users can see when Ref output or inline output applies.
- Updated migration, manifest consistency, localization, and ref catalog regressions so older `outputFormat = ref` settings continue to upgrade safely.

## Verification

- `npx vsce show yamapan.agent-resources-ninja --json`: PASS, Marketplace latest published version is 0.2.19 before publish
- `git ls-remote --tags origin`: PASS, remote tag `v0.2.20` not present before release
- `gh release view v0.2.20 --json "tagName,name,url,isDraft,isPrerelease"`: PASS, release not found before publish
- `npm run compile`: PASS
- `npm run test:resources`: PASS
- `node scripts/test-whenToUse.js`: PASS
- `node scripts/test-search-logic.js`: PASS
- `npm test`: PASS, smoke test completed with exit 0 despite a transient VS Code mutex warning in the test harness log
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities
- `npm run package`: PASS
- `npx --yes vsce package -o .\agent-resources-ninja-0.2.20.vsix`: PASS
- `node scripts/test-release-hygiene.js`: PASS
- `code --install-extension .\agent-resources-ninja-0.2.20.vsix --force --verbose`: PASS, exit 0

## VSIX

- File: `agent-resources-ninja-0.2.20.vsix`
- Size: `335,634 bytes`
- SHA256: `1F69FB4925A9A74052811667C86291198EFE96FF3788FFA3BA051D3CFDC5D9BC`
