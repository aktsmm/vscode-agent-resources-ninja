# Changed-Only Updates

Reinstalling everything is the repair path and can overwrite local edits. For skills installed in the **ordinary local workspace** there is a separate, user-driven update: a check runs about every 14 days (and on demand), and replacement happens only when you press **Update All** or update one skill from **Details**.

## Revision authority

A remote-backed resource is compared by the **Git object id of the unit that was copied**, read at the commit the source branch points at, using the GitHub trees API (`src/resourceRevision.ts`).

| Kind | Fetch unit and revision | Changed-only in this release |
| --- | --- | --- |
| skill | Tree id of the skill folder (`remotePath`), or blob for a single-file skill | Local workspace: **Check Workspace Skill Updates** and the 14-day check, then **Update All** or **Details** |
| agent, prompt, instruction, cursor-rule | Blob id of the single file | Installs record verified baselines; update checks are not yet available |
| reference | Blob id of the single file | Out of scope: installed only to the global home, so no changed-only update check; reinstalling from the same source refreshes it |
| hook | Blob id of the hook config file; tree id of the parent folder when scripts are copied with it | Installs record verified baselines; update checks are not yet available |
| mcp | Blob id of the config file | Installs record verified baselines; update checks and review are not yet available |
| plugin | Tree id of the plugin root | Excluded. A plugin is a managed copy that can include executable assets, so only an explicit forced reinstall replaces it |
| local or custom resource | None (not remote-backed) | Never checked against a remote |
| native plugin-host installs (Copilot CLI, Claude Code, Codex, Cursor) | Owned by the host | Out of scope |

The recorded baseline is the `sourceRevision` field of the resource's metadata sidecar (`owner`, `repo`, `ref`, `remotePath`, `commitSha`, `contentSha`, `kind`). For skills, `.skill-meta.json` and the field shape are shared with Agent Skills Ninja. A malformed baseline is treated as absent.

## Decisions

- **Check is read-only; replacement needs a button press.** The check (`src/workspaceSkillUpdateCheck.ts`) runs when the extension activates in a workspace and the last successful check is 14 or more days old (kept per workspace), or on demand. It never writes. A failed or incomplete check, or a GitHub rate limit, does not advance the 14-day clock. It does not associate an installation with an index entry by name alone. The extension does not add a startup activation event, so the automatic check runs when the extension activates for another reason, such as opening its sidebar or running a command.
- **Update All / Details.** **Update All** updates only skills with a changed upstream and no saved local edits; skills that are unchanged, have no baseline, cannot be checked, or have saved local edits are skipped with a reason. **Details** lists candidates, shows a read-only diff of the saved copy against the pinned commit, and updates one skill at a time; overwriting saved local edits asks first. Closing the notification changes nothing.
- **Staged replacement.** The new version is downloaded at the pinned commit into a staging folder on the same volume outside every scanned skills root, and verified file by file against the Git objects. Just before the switch, the installed copy, its metadata and the staged copy are compared again with what was reviewed. Unsaved editor changes inside the skill, or any change after the review, stop the update. The old copy is moved aside, the new copy and its metadata are put in place and read back, and the old copy is deleted only after that succeeds. When saved local edits were overwritten, the old copy is kept and its location shown. On failure the old copy and metadata are restored; if that cannot be done safely (for example another writer changed the location), nothing is overwritten and the backup stays, with a recovery record that blocks later updates of that skill.
- **Scope.** Only ordinary local workspace folders. Remote extension hosts, network shares (other than Windows' stock `Users` share), known cloud-sync folders, other volumes, and symlink or junction paths are refused, as are staging locations that would fall inside any scanned skills root. Writes by other applications or windows between the final check and the switch cannot be fully detected.
- **A newer commit is not a change.** The content id is compared, not the commit, so commits that did not touch the folder do not trigger an update.
- **Retry Failed.** The result notification offers **Retry Failed** once: the source and location are checked again and the same staged replacement is used. Rate limits, unfinished recoveries and changed targets are not retried.
- **Legacy installs** (no baseline) are left untouched. A separate, explicitly warned first-sync action is not implemented yet.
- **Baseline timing.** Supported installs with a resolved revision download from that commit. File bytes and complete directory listings are checked against the Git object before recording it. Symlinks, submodules, oversized files, extra or missing files, and verification failures leave no baseline. Files with the executable bit are accepted as ordinary files because the installer copies bytes without file modes. A normal install that cannot resolve a revision may still download from the branch without recording one.
- **Failure and cancellation.** Forced reinstall still removes first and uses the trash as its recovery path. Batches stop further requests and retries on a GitHub rate limit and retain attempted and unstarted results. A pending revision check is aborted on cancellation.
- **Packages and groups.** Plugin children are not updated individually; a plugin is replaced as a whole by an explicit reinstall. Standalone resources are checked once each.
- **API cost.** Installs within 30 seconds share one resolver and one commit/tree snapshot per repository and branch. A truncated Git tree requires additional directory requests. The read-only check uses a fresh snapshot.
- **Local-only skills** are left untouched and counted separately. The check does not use a name-only index match to infer an upstream.
- **Forced reinstall remains** as the first button in the "Reinstall All Workspace Skills" dialog and as the default for automatic callers; its second button, **Update Changed Only**, opens the check above.

## Not covered yet

- Kinds other than skill, user/global skills, and the group reinstall entry points (tracked in #4).
- Shared, synchronized or network locations, and resource-copy writer ownership across extension hosts and the skill-only sibling. The shared store lock does not protect resource files.
- The first-sync action for installs without a baseline.
- Recovering after the host exits in the middle of a switch: a recovery record and the backup stay on disk, and the next update attempt for that skill reports "recovery required" with the retained location and does nothing else. There is no automatic restore and no startup recovery UI. The two renames are not an atomic switch, and file ACLs and timestamps are not restored.

## Verification

- `scripts/test-resource-revision.js`: shared snapshots, complete and truncated tree listings, unsupported entries, cancellation and baseline classification.
- `scripts/test-temporary-install-source.js`: pinned downloads, verified file and folder baselines, incomplete or mismatched copies and rate-limit propagation.
- `scripts/test-workspace-skill-update.js`: staged replacement, local-edit detection, rollback, recovery records, refused locations and cleanup.
- `scripts/test-workspace-skill-update-check.js`, `test-workspace-update-schedule.js`, `test-workspace-skill-update-ui.js`, `test-workspace-skill-update-adapter.js`: change detection, the 14-day schedule, bulk/individual flows and the notification and diff presentation.
- `scripts/test-reinstall-recovery.js`: the changed-only entry point only opens the staged flow, and rate-limit stops and bounded retries.
- Real GitHub check (manual, not in the suite): an older commit of a public skill was installed into a temporary workspace, detected as changed, updated, compared byte-for-byte with the upstream tree, left no staging folders, and was reported unchanged on the next check.
