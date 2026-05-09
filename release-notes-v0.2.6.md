# v0.2.6 - Plugin Grouping and Release Polish

## Highlights

- Improved Remote Resources plugin grouping from a path-only "Plugin Contents" view to a clearer "Grouped by Plugin" model.
- Plugin package manifests and indexed child resources are now shown together, including root-level plugin packages such as Superpowers.
- Resource-kind rows now show plugin origin in row details and tooltips, so plugin-contained agents, skills, and rules remain discoverable by kind while still showing package context.
- Workspace Resources and User / Global Resource Home now surface plugin origin for installed plugin resources.
- README and README_ja now describe plugin grouping, plugin origin, and resource-kind visibility more clearly.
- Release wording was polished from "Plugin Contents" to "Plugin Resources" where the action installs a selectable group.

## Verification

- `npx vsce show yamapan.agent-resources-ninja --json`
- `git ls-remote --tags origin v0.2.6`
- `gh release view v0.2.6 --json "tagName,name,url,isDraft,isPrerelease"`
- `npm run check-types`
- `npm run lint`
- `node esbuild.js`
- `npm run test:resources`
- `npm test`
- `npm audit --audit-level=moderate`
- `npm run package`
- `npx vsce package --no-dependencies`
- `node scripts/test-release-hygiene.js`
- `git diff --check`

## Artifact

- File: `agent-resources-ninja-0.2.6.vsix`
- Size: `300,065 bytes`
- SHA256: `741E7758D5BB085A5B0198B137EACFE898B43CB322DD9CC31EFFB78C6D2FADF8`

## Notes

- Grouped plugin resources remain managed copies only. Hooks, executable assets, and MCP configuration are not activated automatically.
- Plugin-contained resources can still be installed individually from their resource-kind views.
