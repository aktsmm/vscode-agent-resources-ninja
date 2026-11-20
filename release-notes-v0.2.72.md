# Agent Resources Ninja v0.2.72

## Highlights

- **Instructions for Codex and Claude Code.** When every selected resource is an instruction, Install Resource can install to `.claude/rules/` (Claude Code) or to an `instructions/` folder next to `AGENTS.md` (Codex), in the workspace or, as an explicit choice, in the personal `~/.claude` / `$CODEX_HOME`. A preview shows the files and the `AGENTS.md` change first. Codex gets one managed link block (not a file list; it is not auto-loaded and `applyTo` is not applied); text outside the markers is preserved, `AGENTS.override.md` is never edited, reinstalling does not duplicate the block, and removing the last instruction removes only that block. For Claude Code, `applyTo` becomes `paths` only when the meaning is the same; anything unclear is not installed unless you choose an always-loaded rule.
- **Destination names, paths and states.** The install picker names each destination like the side view and shows its real path and state (empty and created on first install, browse only, read-only). The side view shows the same state.
- **Old VS Code User Profile hidden from new installs.** The user-data folder is no longer offered for new installs and new files unless `resourceNinja.legacyUserProfileInstallTarget` is on. Existing files stay visible and are never moved or deleted. A default install target of `userData` asks you to choose a destination instead of writing elsewhere.
- **Reinstall never deletes then writes elsewhere.** A user or global reinstall stops before removing anything when the install would write outside the folder the copy was found in.

## Compatibility

- Workspace and a configured Global Resource Home are unchanged. A folder set through `userInstructionsDirectory`, `userAgentsDirectory` or `userPromptsDirectory` outside the user-data folder is unaffected by the new setting.
- `resourceNinja.refCatalogFormat` remains supported and unchanged. The shared index-store lock is not a resource-file lock.
- Bundled Resource Index remains v1.33.0 (2,774 resources across 23 sources).

## Verification

- TypeScript compilation and lint passed. The resource regression suite passed 117 tests with three network tests skipped; the upstream suite passed all 120 tests. The Extension Host smoke test passed (10 passing, one sibling-integration test pending).
- Dependency check: the configured registry proxy rejected both runtime and full `npm audit` requests with `Invalid package tree` (the lockfile differs from 0.2.71 only by the version). No npm audit pass is claimed; the OSV result recorded for 0.2.71 (no advisory for the runtime dependency, development-only advisories) is carried over for the unchanged dependency set and is supplementary, not equivalent to npm audit.
- An independent code review found no issues. Actual reads of the installed files by Codex or Claude Code in a fresh session were not verified (their CLI sessions could not authenticate here), and the picker, the preview dialog and the always-loaded retry were not driven in a live VS Code window; they are covered by source and stub tests.

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.72.vsix`
- Size: 624,864 bytes
- SHA256: `2A43223CDD3B97DAA1F52EB18EEF1A0EC63084724569E0CF9424679B17B6DB28`
- Installed in an isolated profile and runtime assets matched the VSIX.
