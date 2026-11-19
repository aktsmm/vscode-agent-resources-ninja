# Agent Resources Ninja v0.2.70

## Highlights

- **Update changed workspace skills, on your terms.** About every 14 days (when the extension activates in a workspace) or on **Check Workspace Skill Updates**, skills installed in an ordinary local workspace whose upstream changed are detected without writing anything. The notification offers **Update All** (changed skills without saved local edits) and **Details** (per-skill diff against the pinned upstream commit, individual updates, an explicit confirmation before overwriting saved local edits, and **Retry Failed**). Closing the notification changes nothing. The new version is downloaded and verified file by file in a staging folder first; if the switch fails the old version and its metadata are restored, and if that cannot be done safely the backup and its location are kept. Shared, synchronized, network and linked locations, remote extension hosts and other resource kinds are excluded; other applications' simultaneous saves cannot be fully detected. See `docs/changed-only-updates.md`.
- **Install baselines are verified.** Supported installs download from the resolved commit and record the comparison baseline (`sourceRevision`, unchanged format) only when the installed bytes match the complete Git object. A GitHub rate limit now stops a batch instead of retrying.
- **Reference notes (#9).** Files opted in with `.github/references/*.md` or `.github/references/references.json` install as a separate **Reference** kind to `<Global Resource Home>/references/` with the exact file name, never into instructions or generated instruction output.
- **View options per profile.** Filter and sort choices follow the VS Code profile (not synced).

## Compatibility

- One new command, `resourceNinja.checkWorkspaceSkillUpdates`; no new setting. The shared index-store lock contract and the `sourceRevision` field are unchanged. The shared resource index only gains a `reference` bucket when a reference note exists, so an index without them is byte-identical to before. `resourceNinja.refCatalogFormat` remains supported and unchanged.
- "Reinstall All Workspace Skills" → **Update Changed Only** now opens the update check described above instead of reinstalling; Reinstall remains the repair path and still moves the current copy to the trash first.
- Bundled Resource Index is v1.33.0 (2,774 resources across 23 sources). Only the Microsoft Azure Skills source changed: three removed nested skills (`azure-app-onboard/deploy`, `prepare`, `scaffold`), refreshed plugin metadata and descriptions, and the matching bundle. The catalog was patched from the previous file rather than regenerated, because the generator drops `retiredSources` and uses a different layout.

## Verification

- TypeScript compile, ESLint and production build: PASS (the bundled Azure Skills catalog entry and two test expectations were updated to match the current upstream)
- Offline regression suite 116/116 (3 network tests skipped by default), the upstream-sync suite 119/119 (0 skipped), and the extension host smoke test in English and Japanese (10 passing each, 1 pending)
- A real GitHub run: an older commit of a public skill was installed into a temporary workspace, detected as changed, updated, compared byte for byte with the upstream tree, left no staging folder, and was reported unchanged on the next check.
- Dependency check: `npm audit` could not run because the configured registry proxy rejected the audit request (HTTP 400, invalid package tree), so no npm audit result is claimed. A lockfile query against the public OSV database found no advisory for any runtime dependency; five advisories affect dev-only tooling that is not shipped in the VSIX.

Not claimed as verified by these gates: the update notification and diff views rendered and operated in a real VS Code window, `references.json` against a live repository, and recovery after the host exits in the middle of a switch (the record and backup are kept; there is no automatic restore).

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.70.vsix`
- Size: 607,075 bytes
- SHA256: `14BBF0947981C161E62FFEC8B7CD474266B52A9563F2BF3DF968AFE449F44785`
- Installed in an isolated profile and its runtime assets matched the VSIX (`npm run verify:vsix`)
