# Agent Resources Ninja v0.2.17

Release date: 2026-05-17

## Summary

This patch release makes plugin-related install paths easier to understand by separating plugin package installs, indexed plugin contents, curated install sets, and installed plugin origins across the Remote Resources and User / Global Resource Home views.

## Changes

- Clarified the Remote Resources IA with distinct labels for plugin packages, `Pick from a Plugin`, and `Curated Install Sets`.
- Renamed Microsoft Azure plugin-derived labels so they read as skills / MCP resource sets instead of full plugin package installs.
- Added resource-kind count summaries such as `31 skills + 1 MCP` to curated sets and plugin-content picks.
- Made checklist installs state that all items are preselected unless the user deselects them.
- Renamed installed plugin grouping in Workspace and User / Global views to `Plugin Origins` / `プラグイン由来`.

## Verification

- `npx --yes vsce show yamapan.agent-resources-ninja --json`: PASS, Marketplace already has v0.2.16 so the next free version is v0.2.17
- `git ls-remote --tags origin v0.2.16`: PASS, remote tag exists
- `git ls-remote --tags origin v0.2.17`: PASS, remote tag does not exist before release
- `gh release view v0.2.16 --json "tagName,name,url,isDraft,isPrerelease"`: PASS, GitHub Release v0.2.16 already exists
- `gh release view v0.2.17 --json "tagName,name,url,isDraft,isPrerelease"`: PASS, GitHub Release v0.2.17 does not exist before release
- `npm run compile`: PASS
- `npm run test:resources`: PASS
- `node scripts/test-whenToUse.js`: PASS
- `node scripts/test-search-logic.js`: PASS
- `node scripts/test-manifest-consistency.js`: PASS
- `node scripts/test-readme-release-ux.js`: PASS
- `node scripts/test-skill-search.js`: PASS
- `node scripts/test-plugin-bundles.js`: PASS
- `node scripts/test-ux-scope-actions.js`: PASS
- `node scripts/test-azure-skills-source.js`: PASS
- `node scripts/test-azure-plugin-source.js`: PASS
- `node scripts/test-localization-ux.js`: PASS
- `npm audit --audit-level=moderate`: PASS, 0 vulnerabilities
- `npm test`: PASS
- `npm run package`: PASS
- `npx --yes vsce package --no-dependencies -o .\agent-resources-ninja-0.2.17.vsix`: PASS
- `node scripts/test-release-hygiene.js`: PASS
- `code --install-extension .\agent-resources-ninja-0.2.17.vsix --force`: PASS
- `git diff --check`: PASS before release commit

## VSIX

- File: `agent-resources-ninja-0.2.17.vsix`
- Size: `311,431 bytes`
- SHA256: `C3C03A188ACABEFE6A0C58C8A88676209B4548AB44540FB387EB4D22C4537B4D`
