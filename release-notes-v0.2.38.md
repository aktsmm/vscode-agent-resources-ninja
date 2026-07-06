# Agent Resources Ninja v0.2.38

## Highlights

- Excluded GitHub Copilot cloud-agent working copies under the global home (`~/.copilot/repos/copilot-worktrees/**`) and other runtime state directories from resource scanning, so worktree `.github/skills/**` no longer leaks into the tree.
- Genuine `~/.copilot/skills` and built-in resources keep showing as before.
- Removed 7 unused `config.*.description` keys (superseded by `markdownDescription`) from `package.nls.json` and `package.nls.ja.json`.
- Added a `repos` runtime-skip assertion and a dead localization-key guard test to prevent regressions.

## Settings

- No settings were added or removed in this release. The `resourceNinja.refCatalogFormat` setting is unchanged; the localization cleanup only removed dead `config.*.description` entries that were already superseded by their `markdownDescription` counterparts.

## Verification

- `npm run compile`: PASS
- `node scripts/test-global-home-routing.js`: PASS
- `node scripts/test-localization-ux.js`: PASS
- `node scripts/test-manifest-consistency.js`: PASS
- `node scripts/test-whenToUse.js`: PASS
- `node scripts/test-search-logic.js`: PASS
- `npm audit --audit-level=moderate`: PASS

## Artifact

- VSIX: `agent-resources-ninja-0.2.38.vsix`
- Size: 354,889 bytes (346.57 KB)
- SHA256: `4786E2FF6251421F6031666504A9835FD66265753C85FAB1CC90730304BD2EC7`
