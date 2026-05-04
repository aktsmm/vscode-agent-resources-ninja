# v0.2.4 - Per-resource Reinstall UX Update

## Highlights

- Workspace Resources now exposes reinstall as an inline action on each remote-installed resource row.
- The bulk `Reinstall All Workspace Skills` command no longer occupies the Workspace Resources title toolbar.
- Remote-installed skills, agents, instructions, prompts, hooks, and MCP config resources can be reinstalled from their own row when source metadata is available.
- Local or manually created resources without remote install metadata do not show the reinstall action, avoiding misleading no-op UI.
- README and README_ja now describe the per-resource reinstall workflow.

## Verification

- `npx vsce show yamapan.agent-resources-ninja`
- `git ls-remote --tags origin v0.2.4`
- `gh release view v0.2.4 --json 'tagName,name,url,isDraft,isPrerelease'`
- `node scripts/test-ux-scope-actions.js`
- `node scripts/test-manifest-consistency.js`
- `node scripts/test-readme-release-ux.js`
- `node scripts/test-resource-kinds.js`
- `node scripts/test-resource-targets.js`
- `node scripts/test-resource-preview-urls.js`
- `node scripts/test-skill-search.js`
- `node scripts/test-plugin-bundles.js`
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

- File: `agent-resources-ninja-0.2.4.vsix`
- Size: 289,961 bytes
- SHA256: `FB5863E93429C49123CDBB9F526BBB3A616AAC970D8264C003A557AE97D43C3B`

## Notes

- This release focuses on reducing Workspace Resources toolbar clutter and matching action placement to the resource being acted on.
