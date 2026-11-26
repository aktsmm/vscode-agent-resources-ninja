# Agent Resources Ninja v0.2.74

## Highlights

- **Skills with large files can be updated.** A skill with files above 20 MiB (up to 100 MiB per file and 500 MiB in total) is no longer refused. Large files are not read into memory: between two looks they are compared by size and modification time, against upstream they are streamed into their Git blob id, and they are streamed once more right before the switch, so a same-size, same-time rewrite still stops the update. A large file has no text preview and is listed as "cannot be previewed" when it differs. Anything above the caps is still refused before anything is written, and shown as skipped.
- **Independent child skills are carried over.** A folder inside a skill that upstream does not ship and that holds a skill of its own (a `SKILL.md` and a `.skill-meta.json` naming the skill and its source) is no longer a saved local edit. It is copied byte for byte into the new copy after the new version is verified, so Update All no longer skips the parent and no overwrite confirmation is needed. The confirmation says how many are carried. An update whose new version uses the path (or drops the parent folder) of a carried child stops before staging.
- **Fewer false failures on Windows.** A brief lock on the recovery record no longer turns a finished update into "recovery required" (a few short retries for temporary lock errors only), and a slow Windows share check is retried once and then stops with a readable reason instead of a generic failure. A hard-linked file is reported as linked, not as too large.

## Compatibility

- Workspace and Global Resource Home behavior is otherwise unchanged. `resourceNinja.refCatalogFormat` remains supported and unchanged. The shared index-store lock is not a resource-file lock.
- Bundled Resource Index remains v1.33.0 (2,774 resources across 23 sources).
- Single reinstall of a hook, MCP config, plugin or user / global skill is still refused with a reason; use Reinstall All, or uninstall and install again.

## Verification

- TypeScript compilation and lint passed. The resource regression suite (120 scripts) and the upstream suite (all 123 scripts) passed. The Extension Host smoke test passed (10 passing, one sibling-integration test pending).
- Dependency check: `npm run audit:runtime` found 0 vulnerabilities. The full `npm audit` request was rejected by the configured registry proxy (HTTP 400), so no full-audit pass is claimed. The lockfile differs from 0.2.73 only by the version and no package was added.
- Independent read-only reviews of the engine and of the user-facing surface found four real defects (a carried child under a folder upstream no longer has, a large copy that failed byte verification not being recorded as owned so rollback refused, a temporary lock on the recovery record, and a hard link reported as a size problem); all were fixed and covered by tests before this release. The review dialogs and the new reasons were not driven in a live VS Code window; they are covered by controller, source and stub tests.

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.74.vsix`
- Size: 635,398 bytes
- SHA256: `858847C4766CAD4178696CFE187A4FD33BC128085C74C568FAB6DDB2CD0F6E0B`
