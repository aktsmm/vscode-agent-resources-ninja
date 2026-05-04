# v0.2.3 - Nested Skill Contents Quality Update

## Highlights

- Remote index updates now detect directories that contain `SKILL.md` and treat files under those directory-based roots as internal skill contents.
- Helper prompts and instructions nested under skill folders, such as `templates/*.prompt.md` and `templates/*.instructions.md`, no longer appear as separate Remote Resources.
- Standalone prompts, agents, instructions, hooks, and MCP config resources outside detected skill roots remain visible and installable.
- The same pruning behavior is applied to bundled preset index generation and runtime GitHub source updates.
- README and README_ja now document why nested skill contents are not shown as standalone remote resources.

## Verification

- `git ls-remote --tags origin v0.2.3`
- `gh release view v0.2.3 --json 'tagName,name,url,isDraft,isPrerelease'`
- `node scripts/test-resource-kinds.js`
- `node scripts/test-readme-release-ux.js`
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

- File: `agent-resources-ninja-0.2.3.vsix`
- Size: 289,332 bytes
- SHA256: `F3508A5E4A3970530188C2686ECEF93B126E16D60B8F39BCE456F0757DE4CA00`

## Notes

- This release reduces search and browse noise for complete SKILL workspaces that include internal prompt or instruction templates.
