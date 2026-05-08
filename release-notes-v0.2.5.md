# v0.2.5 - Cursor Official Plugins and Release Quality Update

## Highlights

- Added Cursor official plugins as a bundled official resource source.
- Plugin manifests are now browsable and installable as managed copies.
- Cursor rules (`.mdc`) are detected, searchable, previewable, and installable with native target paths.
- Plugin preview now reads the manifest file and opens the plugin root on GitHub, avoiding missing `SKILL.md` paths.
- README and README_ja now document plugin manifests, Cursor rules, and managed-copy safety boundaries.
- Release coverage now includes Cursor plugin source indexing, plugin manifest parsing, full plugin model behavior, preview URL routing, install targets, and release consistency checks.

## Verification

- `npx vsce show yamapan.agent-resources-ninja --json`
- `git ls-remote --tags origin v0.2.5`
- `gh release view v0.2.5 --json "tagName,name,url,isDraft,isPrerelease"`
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

- File: `agent-resources-ninja-0.2.5.vsix`
- Size: 299,120 bytes
- SHA256: `71362F8C6BA1597F5C83775F6F290005711B8184DAB45F3079063C1AD01A318B`

## Notes

- Plugin resources are copied for review and are not run or activated automatically.
- MCP config files included in plugins remain reviewable resources and require explicit merge confirmation before changing `.vscode/mcp.json`.
