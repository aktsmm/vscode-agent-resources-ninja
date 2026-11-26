# Changed-Only Updates

Reinstalling everything is the repair path and can overwrite local edits. For skills installed in the **ordinary local workspace** there is a separate, user-driven update: a check runs about every 14 days (and on demand), and replacement happens only when you press **Update All** or update one skill from **Details**. After an extension version change, the upgrade setting can also check the first workspace for upstream changes; that check updates changed skills only after confirmation and does not replace installs without a recorded baseline. An explicitly started manual check can offer a first sync for eligible legacy installs; it compares the saved files with the current source, and bulk update still skips saved local edits. This upgrade check does not expand the separate periodic check's scope.

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

The recorded baseline is the `sourceRevision` field of the resource's metadata sidecar (`owner`, `repo`, `ref`, `remotePath`, `commitSha`, `contentSha`, `kind`). For skills, `.skill-meta.json` and the field shape are shared with Agent Skills Ninja. Missing or malformed baselines are unverified by automatic checks; only a genuinely absent baseline can be considered for the manual first-sync flow.

## Decisions

- **Check is read-only; replacement needs confirmation.** The periodic check (`src/workspaceSkillUpdateCheck.ts`) runs when the extension activates in a workspace and the last successful check is 14 or more days old (kept per workspace), or on demand. After a version change, the upgrade setting checks only the first local workspace and only when remote skills exist and the setting is not `never`; both `prompt` and `always` check first and ask before replacing changed skills. It never writes without confirmation. A failed or incomplete check, or a GitHub rate limit, does not advance the 14-day clock. It does not associate an installation with an index entry by name alone. The extension does not add a startup activation event, so the automatic check runs when the extension activates for another reason, such as opening its sidebar or running a command.
- **Update All / Details.** **Update All** updates only skills with a changed upstream and no saved local edits; skills that are unchanged, cannot be checked, or have saved local edits are skipped with a reason. **Details** lists candidates, shows a read-only diff of the saved copy against the pinned commit, and updates one skill at a time; overwriting saved local edits asks first. Closing the notification changes nothing.
- **Staged replacement.** The new version is downloaded at the pinned commit into a staging folder on the same volume outside every scanned skills root, and verified file by file against the Git objects. Just before the switch, the installed copy, its metadata and the staged copy are compared again with what was reviewed. Unsaved editor changes inside the skill, or any change after the review, stop the update. The old copy is moved aside, the new copy and its metadata are put in place and read back, and the old copy is deleted only after that succeeds. When saved local edits were overwritten, the old copy is kept and its location shown. On failure the old copy and metadata are restored; if that cannot be done safely (for example another writer changed the location), nothing is overwritten and the backup stays, with a recovery record that blocks later updates of that skill.
- **Scope.** Only ordinary local workspace folders. Remote extension hosts, network shares (other than Windows' stock `Users` share), known cloud-sync folders, other volumes, and symlink or junction paths are refused, as are staging locations that would fall inside any scanned skills root. Writes by other applications or windows between the final check and the switch cannot be fully detected.
- **A newer commit is not a change.** The content id is compared, not the commit, so commits that did not touch the folder do not trigger an update.
- **Retry Failed.** The result notification offers **Retry Failed** once: the source and location are checked again and the same staged replacement is used. Rate limits, unfinished recoveries and changed targets are not retried.
- **Legacy installs** (no baseline) are left untouched by automatic checks. A manual check can offer first sync only when the exact source and path uniquely match an index entry. It pins the current source revision and compares local files against it; differences do not establish which side changed. **Update All** skips differing copies; **Details** asks before replacing one. After confirmed first sync, the verified old copy is removed on success or after a fully verified rollback; if cleanup cannot be verified, the retained location is shown. Invalid metadata, missing index entries, and unsupported sources remain unverified.
- **Baseline timing.** Supported installs with a resolved revision download from that commit. File bytes and complete directory listings are checked against the Git object before recording it. Symlinks, submodules, oversized files, extra or missing files, and verification failures leave no baseline. Files with the executable bit are accepted as ordinary files because the installer copies bytes without file modes. A normal install that cannot resolve a revision may still download from the branch without recording one.
- **Failure and cancellation.** Reinstall All, group and multiple-selection reinstall still remove first and use the trash as their recovery path; a single reinstall of a workspace skill is staged (see below). Batches stop further requests and retries on a GitHub rate limit and retain attempted and unstarted results. A pending revision check is aborted on cancellation.
- **Packages and groups.** Plugin children are not updated individually; a plugin is replaced as a whole by an explicit reinstall. Standalone resources are checked once each.
- **API cost.** Installs within 30 seconds share one resolver and one commit/tree snapshot per repository and branch. A truncated Git tree requires additional directory requests. The read-only check uses a fresh snapshot.
- **Local-only skills** are left untouched and counted separately. The check does not use a name-only index match to infer an upstream.
- **Forced reinstall remains** as the first button in the "Reinstall All Workspace Skills" dialog and as the default for automatic callers; its second button, **Update Changed Only**, opens the check above.

## Single reinstall (explicit)

Choosing **Reinstall** on one installed item is an explicit repair, but it never removes the current copy before a verified replacement exists (`src/singleReinstallPolicy.ts`, checked before anything is removed in both single-reinstall entry points).

| Kind | Workspace | User / Global | Behavior |
| --- | --- | --- | --- |
| skill | Staged replacement | Refused | Uses the same prepare / review / swap flow as **Details**: upstream is downloaded at the pinned commit and verified in a staging folder, the differences are shown, saved local edits are overwritten only after confirmation, and a failed swap restores the old copy or keeps a backup. A skill with no recorded baseline is bound to its exact index entry first (never by name). A copy that already matches upstream is reported as unchanged; a copy with saved edits is offered for restore even when the baseline equals upstream |
| agent, prompt, instruction, cursor-rule | In place, current copy saved | In place, current copy saved | The current file and its metadata sidecar are read into memory and copied under the extension's storage first. Upstream is downloaded and verified before the file is overwritten, using the normal installer. If anything fails or the install is incomplete, the file and sidecar are written back and verified; if that cannot be verified the saved copy stays and its location is shown. A confirmation precedes it, unsaved editor changes or a change after the check stop it, and the install destination must equal the existing file (a link, a file above 5 MiB or a destination mismatch is refused) |
| hook, mcp | Refused | Refused | The install also rewrites a shared configuration file, which a file-level restore cannot cover |
| plugin | Refused | Refused | A plugin is a managed folder with registrations and executable assets |
| reference | Global Home only | Browse reinstall keeps its own confirmation | Installed only to the global home; reinstalling from the same source refreshes it |

A refusal changes nothing and points to the explicit alternatives: **Reinstall All**, a group or a multiple selection (these remain the trash-first repair, documented above), or uninstall followed by install. The staged flow also refuses locations it cannot guarantee (remote hosts, network, synchronized, other volume, linked folders, a pending recovery record) and reports the reason instead of falling back to delete-and-install.

## Overlapping operations

A skill install, a reinstall and an update claim their folder through one registry inside the extension host (`beginSkillPathOperation` in `src/pathSafety.ts`). A claim excludes the same folder, a parent and a child, so an install cannot run under an update (or the reverse) and the second operation stops before writing. This does not coordinate other windows or applications.

## Not covered yet

- Any single reinstall of hook, mcp or plugin resources and of user/global skills (tracked in #4). They are refused rather than falling back to delete-first. Single-file kinds are written in place with a restore, which is not an atomic rename: a crash during the overwrite leaves the saved copy only under the storage folder.
- A fresh install into a skill folder with an unresolved recovery record is blocked inside the workspace. A record that cannot be looked up (a path outside the workspace, an unreadable parent) does not block.
- Files above 20 MiB, more than 100 MiB in total or more than 10,000 entries make a skill non-updatable with `unsafe-or-oversize-file` instead of degrading to a size and modification-time comparison. The refusal is safe (nothing is written) but permanent for such skills.
- A skill folder that contains independently installed child skills reports them as saved local additions, so they need the confirmed overwrite path and the old copy is kept.
- Kinds other than skill, user/global skills, and the group reinstall entry points (tracked in #4).
- Shared, synchronized or network locations, and resource-copy writer ownership across extension hosts and the skill-only sibling. The shared store lock does not protect resource files.
- Recovering after the host exits in the middle of a switch: activation inspects ancestor directories for recovery records associated with open local workspaces and offers a read-only list of targets, backup locations and record paths, even when the target is missing. The record may belong to another still-running window. An unreadable or malformed record is reported as an incomplete inspection. No restore or cleanup is offered yet: existing records do not contain a verified snapshot of the old copy, so their contents alone cannot prove restoration is safe. The next update attempt still reports "recovery required" and makes no changes. The two renames are not an atomic switch, and file ACLs and timestamps are not restored.

## Verification

- `scripts/test-resource-revision.js`: shared snapshots, complete and truncated tree listings, unsupported entries, cancellation and baseline classification.
- `scripts/test-temporary-install-source.js`: pinned downloads, verified file and folder baselines, incomplete or mismatched copies and rate-limit propagation.
- `scripts/test-workspace-skill-update.js`: staged replacement, first sync without a baseline, local-edit detection, rollback, recovery records, refused locations and cleanup.
- `scripts/test-workspace-skill-update-check.js`, `test-workspace-update-schedule.js`, `test-workspace-skill-update-ui.js`, `test-workspace-skill-update-adapter.js`: change detection, the 14-day schedule, bulk/individual flows and the notification and diff presentation.
- `scripts/test-reinstall-recovery.js`: the changed-only entry point only opens the staged flow, and rate-limit stops and bounded retries.
- `scripts/test-single-reinstall-policy.js`: the kind and scope matrix, batch callers never treated as a single reinstall, folder claims (same, parent, child, case on Windows), the install guard, and static guards that the policy runs before the first removal.
- `scripts/test-single-file-replace.js`: clean replacement, restore after a failure or an incomplete result, a missing sidecar staying missing, a restore that cannot be verified keeping the saved copy, a change after the check, and refused links, folders and oversized files.
- Real GitHub check (manual, not in the suite): an older commit of a public skill was installed into a temporary workspace, detected as changed, updated, compared byte-for-byte with the upstream tree, left no staging folders, and was reported unchanged on the next check.
