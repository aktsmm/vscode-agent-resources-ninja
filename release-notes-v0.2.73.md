# Agent Resources Ninja v0.2.73

## Highlights

- **Single reinstall keeps your copy.** Reinstalling one workspace skill downloads and verifies upstream in a staging folder first, shows the differences, asks before overwriting saved edits, and swaps it in; a failed swap restores the previous copy or keeps a backup. Reinstalling one agent, prompt, instruction or cursor rule saves the current file and its metadata, overwrites only after the download is verified, and writes both back if anything fails. Hooks, MCP configs, plugins and user / global skills are refused with the reason before anything is removed. Reinstall All, group and multiple-selection reinstall keep the trash-first repair.
- **Detected skill folders.** `.github/skills`, `.agents/skills` and `.claude/skills` that already hold a `SKILL.md` and are not configured are listed in Installed Skills and offered in the install-target picker for skills. They are display and an explicit target only (not in the generated skill list, `.gitignore` management, metadata, updates or reinstall); linked folders are never detected. Turn it off with `resourceNinja.autoDetectWorkspaceSkillRoots`.
- **Installs and updates no longer overlap.** A skill install, reinstall and update claim their folder (and a parent or child folder) inside one extension host, and a skill whose interrupted update still has a retained copy is neither installed over nor removed by a trash-first reinstall until the recovery record is cleared.

## Compatibility

- Workspace and Global Resource Home behavior is otherwise unchanged. `resourceNinja.refCatalogFormat` remains supported and unchanged. The shared index-store lock is not a resource-file lock.
- Bundled Resource Index remains v1.33.0 (2,774 resources across 23 sources).
- A single reinstall of a hook, MCP config, plugin or user / global skill now stops with a reason instead of removing the current copy first; use Reinstall All, or uninstall and install again.

## Verification

- TypeScript compilation and lint passed. The resource regression suite and the upstream suite passed all 123 scripts. The Extension Host smoke test passed (10 passing, one sibling-integration test pending).
- Dependency check: the configured registry proxy rejected the runtime `npm audit` request with `Invalid package tree`; the full `npm audit` listed 16 development-only advisories (1 low, 15 moderate) and no new package was added (the lockfile differs from 0.2.72 only by the version). No npm audit pass is claimed. OSV returned no advisory for the only runtime dependency, `vscode-nls` 5.2.0; that result is supplementary, not equivalent to npm audit.
- Independent code reviews found two real defects (an install retry that re-entered its own folder claim, and a trash-first removal that was not gated by the same guard); both were fixed and covered by tests before this release. The picker, the review dialogs and the new single-file reinstall were not driven in a live VS Code window; they are covered by controller, source and stub tests.

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.73.vsix`
- Size: 631,644 bytes
- SHA256: `C2C7FB9906CAF391AB56DDC4830D59452761A1B6AFAAF358F5EB4D0BFC76E69F`
- Installed in an isolated profile and runtime assets matched the VSIX.
