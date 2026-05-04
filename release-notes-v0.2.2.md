# v0.2.2 - MCP Preview and Release Quality Update

## Highlights

- Fixed MCP config previews so single-file resources such as `.vscode/mcp.json` and `.mcp.json` are fetched directly instead of treating them as skill directories.
- Unified preview, open, and copy URL generation for MCP, agents, prompts, instructions, hooks, and directory-based skills.
- Improved JSON/MCP preview rendering and fetch error messages so the failing raw URL is visible during troubleshooting.
- Cleaned bundled MCP metadata so Remote Resources no longer shows raw JSON fragments such as `{` as a description.
- Clarified Workspace MCP Directory settings copy as a staging/review location before optional explicit `.vscode/mcp.json` merge.
- Refined README and README_ja first-screen copy for the current resource-management workflow and MCP review flow.
- Added preview URL regression tests and wired them into `npm run test:resources`.

## Verification

- `npx vsce show yamapan.agent-resources-ninja --json`
- `git ls-remote --tags origin v0.2.2`
- `gh release view v0.2.2 --json "tagName,name,url,isDraft,isPrerelease"`
- Representative preview raw URL `HEAD` checks for MCP, agent, instruction, hook, prompt, and directory skill resources
- `node scripts/test-resource-preview-urls.js`
- `node scripts/test-localization-ux.js`
- `node scripts/test-azure-skills-source.js`
- `node scripts/test-manifest-consistency.js`
- `npm run compile`
- `npm run test:resources`
- all executable `scripts/test-*.js`
- `npm test`
- `npm audit --audit-level=moderate`
- `npm run package`
- `npx vsce package --no-dependencies`
- `node scripts/test-release-hygiene.js`
- `git diff --check`

## Artifact

- File: `agent-resources-ninja-0.2.2.vsix`
- Size: 288,781 bytes
- SHA256: `757268F39E5C14B20E60D54B8D4D1E232CC9282B8266D36D7B2808D1AE2E8F07`

## Notes

- MCP config resources remain staged for review and are not auto-activated. Merging into `.vscode/mcp.json` remains an explicit install-time choice with conflict confirmation.
