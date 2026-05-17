# Agent Resources Ninja v0.2.18

Release date: 2026-05-17

## Summary

This patch release fixes official plugin source indexing so plugin manifests are included alongside plugin child resources. Microsoft Azure plugin-distributed sources now appear in the Remote Resources plugin section as actual plugin packages, while skill and MCP child resources remain individually installable.

## Changes

- Indexed plugin manifests for official plugin-distributed sources, including Microsoft Azure marketplace-style sources, instead of indexing only the child skills / MCP resources.
- Propagated plugin root and manifest metadata to non-plugin child resources so plugin grouping works even when install paths do not live under `plugins/`.
- Normalized multiple manifest variants under the same plugin root to a single canonical plugin package entry.
- Synced stale Azure and AWS curated install sets with the current upstream indexed resource lists.

## Verification

- `gh release view v0.2.18 --json tagName,name,url,isDraft,isPrerelease`: PASS, release does not exist before publish
- `npx --yes vsce show yamapan.agent-resources-ninja --json`: PASS, Marketplace latest published version is 0.2.17 before publish
- `node scripts/test-azure-plugin-source.js`: PASS
- `node scripts/test-azure-skills-source.js`: PASS
- `node scripts/test-whenToUse.js`: PASS
- `node scripts/test-search-logic.js`: PASS
- `node scripts/test-manifest-consistency.js`: PASS
- `npm run test:resources`: PASS
- `npm test`: PASS
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities
- `node scripts/test-plugin-bundles.js`: PASS
- `node scripts/test-plugin-manifests.js`: PASS
- `node scripts/test-full-plugin-index.js`: PASS
- `node scripts/test-ux-scope-actions.js`: PASS
- `npm run compile`: PASS
- `npm run package`: PASS
- `npx --yes vsce package --no-dependencies -o .\agent-resources-ninja-0.2.18.vsix`: PASS
- `node scripts/test-release-hygiene.js`: PASS
- `code --install-extension .\agent-resources-ninja-0.2.18.vsix --force`: PASS

## VSIX

- File: `agent-resources-ninja-0.2.18.vsix`
- Size: `329,823 bytes`
- SHA256: `CC906BA15FC40698F9EB6C54F8E9676A631D725B343ED8FFA84DB86060EC0835`
