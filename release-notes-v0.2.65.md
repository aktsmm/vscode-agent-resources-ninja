# Agent Resources Ninja v0.2.65

## Highlights

- The Codex home now appears in the User / Global Resource Home tree. With `resourceNinja.showAlternateGlobalHomes` on (the default), `~/.codex/skills` is listed as a read-only "Codex (~/.codex)" group next to `~/.copilot`, `~/.claude` and `~/.agents`. Only the `skills` folder is scanned, so Codex sessions, plugin caches and config never appear in the tree.
- Installs, the generated instruction block and updates keep using the selected Global Resource Home. The Codex group is display-only: it has no Reinstall or Delete actions, and a skill with the same name in two homes stays two separate entries.

## Compatibility

- No new setting, command ID or install target. Existing resource kinds, install destinations, the agent tool inputs and the shared index-store lock contract remain unchanged. `resourceNinja.refCatalogFormat` remains supported and unchanged.
- Choosing `~/.codex` yourself through `resourceNinja.globalHomeDirectory` still works and is not listed twice.
- Bundled Resource Index v1.32.0 is unchanged: 2,777 resources across 23 sources.

## Verification

- TypeScript compile, ESLint and production build: PASS
- Offline regression suite 106/106 (3 network tests skipped by default) and the upstream-sync suite 109/109
- New tests: a fixture proving only `skills` is walked under `~/.codex`, same-name skills in four homes stay four entries, a Codex home chosen as the selected home is not listed twice, and a docs guard (checked by a mutation probe) that README, README_ja and both setting descriptions list every known home
- Dependency audit: exit 0 (3 low-severity findings in the dev-only test tooling chain with no fix available; runtime audit clean)

Not claimed as verified by these gates: the Codex group rendered in a real VS Code window. The scan and read-only behavior are covered by fixture tests, and the tree reuses the existing read-only group rendering.

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.65.vsix`
- Size: 580,967 bytes
- SHA256: `84DFDDC05D14264418F79B441EEE0AFB31879AF3019FC9AD80D0135687AAB89C`
