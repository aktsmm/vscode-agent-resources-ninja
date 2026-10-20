# Agent Resources Ninja v0.2.61

## Highlights

- User / Global Resource Home no longer lists duplicates. The global home scan used to walk `~/.copilot/backup/...` and show every backed-up skill, agent, and instruction a second time. Backup folders (`backup`, `backups`, `backup-*`, `.bak`, `archive`, `trash`, `tmp`), browser profile folders, and state folders such as `workspaces` and `plugin-data` are now skipped, but only directly under the home root, so a `backup` folder inside your own skill is still scanned. A plugin that ships several manifests (for example `.claude-plugin` and `.codex-plugin`) is one row instead of three.
- The other known homes (`~/.copilot`, `~/.claude`, `~/.agents`) now appear as separate read-only groups, limited to their `skills`, `agents`, `instructions`, `prompts`, and `hooks` folders. Each group is named by its tool and folder, for example `GitHub Copilot CLI (~/.copilot)`, and the selected one is marked "install target". Turn it off with the new `resourceNinja.showAlternateGlobalHomes` setting (default on).
- Installs, reinstalls, deletes, the generated instruction block, and updates keep using the selected home only. Other-home groups hide Reinstall and Delete, and the plugin-group delete command re-resolves the clicked group against the current state and refuses read-only, stale, or other-home groups.
- The view's welcome text and the README (English and Japanese) describe the multi-home tree.

## Compatibility

- Existing resource kinds, install destinations, command IDs and the shared index-store contracts remain unchanged. The new setting is additive; later settings shift by one `order` value, which only affects the settings UI order.
- `resourceNinja.refCatalogFormat` remains supported and unchanged.
- Bundled Resource Index v1.31.0 contains 2,788 resources across 24 sources (unchanged).

## Verification

- TypeScript compile, ESLint and production build: PASS
- Offline regression suite 100/100 (3 network tests skipped by default), including a new fixture-based scan test for backup/state skipping, multi-manifest plugins, and alternate homes
- Isolated Extension Host: PASS, including a live check that the plugin-group delete command refuses read-only and stale groups (a production mutation probe made that check fail)
- Dependency audit: 0 vulnerabilities
- Three rounds of an independent different-model review closed the scanner, deduplication, and delete-routing findings

Visual confirmation of the new group names in a real window and a reinstall or delete from another home (not offered) are not claimed as verified by these gates.

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.61.vsix`
- Size: 571,941 bytes
- SHA256: `9647D6DC72E73F6B1E86A3D91A5A2669CF6BB2A119FFC06F717F95D6D2D72FBA`
