# v0.2.1 - Release Quality Update

## Highlights

- Fixed language switching so User / Global Resource Home refreshes together with Workspace Resources and Remote Resources when `resourceNinja.language` changes.
- Updated Report Bug locale handling so `auto` follows the shared runtime language helper.
- Reworked README and README_ja to lead with the extension's three resource-management views instead of generated Agent Skills index output formats.
- Clarified license scope, read-only built-in resources, MCP config coverage, and skill-only instruction-index/bulk-skill flows.
- Added `#localizeResource` to the Agent Mode tool tables and kept README tool coverage aligned with package metadata.
- Hardened release hygiene tests so VSIX packaging keeps `dist/extension.js` while excluding sourcemaps and development artifacts.
- Updated auth fallback regression test stubs to match current installer dependencies.
- Rebuilt the VSIX for Marketplace update after the 0.2.0 Marketplace release.

## Verification

- `npm run compile`
- `npm run test:resources`
- `node scripts/test-*.js`
- `node scripts/test-whenToUse.js`
- `node scripts/test-search-logic.js`
- `npm test`
- `npm audit --audit-level=moderate`
- `npm run package`
- `npx vsce package --no-dependencies`
- VSIX payload hygiene check via `node scripts/test-release-hygiene.js`

## Artifact

- File: `agent-resources-ninja-0.2.1.vsix`
- Size: 288,095 bytes
- SHA256: `9724E0D636DDBE16AE82A20214FFB33694F70968FE78C354CFD01E0CC48F7987`

## Notes

- Non-skill reinstall remains intentionally hidden until source metadata is stored for agents, prompts, instructions, hooks, and MCP config resources.
