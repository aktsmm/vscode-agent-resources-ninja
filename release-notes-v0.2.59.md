# Agent Resources Ninja v0.2.59

## Highlights

- Skills whose `SKILL.md` sets `disable-model-invocation: true` are manual-only, so they are now left out of generated instruction blocks by default; a listed skill invites the model to use it on its own. The new `resourceNinja.instructionBlock.includeExplicitOnlySkills` setting (default off) opts them back in.
- The flag is read from `SKILL.md` on every update (a UTF-8 BOM is tolerated), so there is no metadata copy to go stale. Manual-only skills stay in the tree as "Manual-only" and are never shown as unregistered, even when they are not listed.
- Saving, creating, or deleting a `SKILL.md` now regenerates the instruction block even when the skill has no `.skill-meta.json` change. This covers `resourcesDirectory` and every `additionalSkillRoots` entry, and the watchers are rebuilt when those settings change.
- README and README_ja describe the manual-only behavior, the opt-in setting and its limit.

## Compatibility

- The policy applies only while Resource NINJA owns the shared block. When Agent Skills Ninja owns it, that extension's own policy decides.
- `user-invocable: false` (model-only) skills stay listed.
- Existing resource kinds, install destinations, command IDs and shared index-store contracts remain unchanged.
- `resourceNinja.refCatalogFormat` remains supported and unchanged.
- Bundled Resource Index v1.31.0 contains 2,788 resources across 24 sources (unchanged).

## Verification

- TypeScript compile, ESLint and production build: PASS
- Upstream catalog suite (includes the offline suite): 100/100 PASS, 0 skipped
- Isolated Extension Host: 3/3 PASS, including a live-host check that a `SKILL.md` edit in an additional root adds, removes and restores a skill in the generated block; a production mutation probe made that check fail
- Dependency audit: 0 vulnerabilities

Native notification/Cursor activation and the VS Code Webview command bridge are not claimed as end-to-end verified by these gates. Their existing behavioral and adapter guards remain applicable.

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.59.vsix`
- Size: 554,102 bytes
- SHA256: `0460B50B5DA53434E50F589DF96320528D3FCC023909EAF8B0928D8360D65A6A`
