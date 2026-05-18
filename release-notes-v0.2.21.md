# Agent Resources Ninja v0.2.21

Release date: 2026-05-19

## Summary

This patch release moves Ref output fully onto native README indexes for each resource kind and cleans up the remaining Resource Output wording drift across documentation, localization, and coexistence runbooks.

## Changes

- Replaced the old shared Ref catalog root with native README indexes such as `.github/skills/README.md`, `.github/agents/README.md`, and product-native global-home README targets.
- Removed the `resourceNinja.refCatalogDirectory` setting and kept `resourceNinja.refCatalogFormat` as the detail-level switch for Ref output.
- Preserved manual README text by using managed `resource-ninja-catalog` sections inside generated Ref indexes.
- Aligned Resource Output wording across README, README_ja, Japanese settings copy, instruction-target UX, and coexistence fixture runbooks.

## Verification

- `npx --yes vsce show yamapan.agent-resources-ninja --json`: PASS, Marketplace latest published version is 0.2.20 before publish
- `git ls-remote --tags origin`: PASS, remote tag `v0.2.21` not present before release
- `gh release view v0.2.21 --json 'tagName,name,url,isDraft,isPrerelease'`: PASS, release not found before publish
- `npm run compile`: PASS
- `npm run test:resources`: PASS
- `node scripts/test-whenToUse.js`: PASS
- `node scripts/test-search-logic.js`: PASS
- `node scripts/test-readme-release-ux.js`: PASS
- `node scripts/test-localization-ux.js`: PASS
- `node scripts/test-coexistence.js`: PASS
- `node scripts/test-ref-resource-catalog.js`: PASS
- `node scripts/test-manifest-consistency.js`: PASS
- `npm test`: PASS, smoke test completed with exit 0 despite a transient VS Code mutex warning in the test harness log
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities
- `npx --yes vsce package -o .\agent-resources-ninja-0.2.21.vsix`: PASS, artifact created successfully
- `node scripts/test-release-hygiene.js`: PASS
- `code --install-extension .\agent-resources-ninja-0.2.21.vsix --force --verbose`: PASS, exit 0

## VSIX

- File: `agent-resources-ninja-0.2.21.vsix`
- Size: `336,838 bytes`
- SHA256: `58B2C57843FC1B31B0C9E2017A927D09AEB6BA36A2F76926DB06447E1AEB1669`
