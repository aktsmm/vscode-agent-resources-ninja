# Changed-Only Updates

Reinstalling everything is the repair path. A changed-only update replaces only the resources whose upstream content differs from what was installed. This note records the decisions for each resource kind and what is deliberately not covered yet.

## Revision authority

A remote-backed resource is compared by the **Git object id of the unit that was copied**, read at the commit the source branch points at, using the GitHub trees API (`src/resourceRevision.ts`).

| Kind | Fetch unit and revision | Changed-only in this release |
| --- | --- | --- |
| skill | Tree id of the skill folder (`remotePath`) | Yes: workspace "Reinstall All Workspace Skills" → **Update Changed Only** |
| agent, prompt, instruction, cursor-rule | Blob id of the single file | Not yet. The resolver already returns blob ids; installs do not record a baseline for these kinds yet |
| hook | Blob id of the hook config file; tree id of the parent folder when scripts are copied with it | Not yet |
| mcp | Blob id of the config file | Not yet. MCP config is staged for review, so an update needs its own decision |
| plugin | Tree id of the plugin root | Excluded. A plugin is a managed copy that can include executable assets, so only an explicit forced reinstall replaces it |
| local or custom resource | None (not remote-backed) | Never checked against a remote |
| native plugin-host installs (Copilot CLI, Claude Code, Codex, Cursor) | Owned by the host | Out of scope |

The recorded baseline is the `sourceRevision` field of `.skill-meta.json` (`owner`, `repo`, `ref`, `remotePath`, `commitSha`, `contentSha`, `kind`). The name and shape are shared with Agent Skills Ninja, so a baseline written by either extension is usable by the other. The field is validated on read; a malformed value is treated as no baseline.

## Decisions

- **Only a proven "unchanged" skips.** A resource is skipped only when its baseline has the same repository, ref, path and kind as upstream now and the same content id. A missing baseline, a baseline from a different source, and a failed read are all updated like a forced reinstall. The check can therefore never leave a changed resource behind; at worst it updates one that did not need it.
- **A newer commit is not a change.** The content id is compared, not the commit, so commits that did not touch the folder do not trigger an update.
- **Legacy installs** (no baseline) are reinstalled once by Update Changed Only, which records the baseline. The confirmation dialog says so. They are never reported as changed or unchanged.
- **Baseline timing.** The revision is read before the download and written only for a complete install. If upstream moves in between, the baseline is older than the copied files, which can only cause one extra update later. An incomplete copy keeps no baseline.
- **Failure and cancellation** use the existing reinstall behavior (bounded retry of transient failures, removed copies recoverable from the trash, a failure summary that keeps resources outside the retry set, cancelled resources counted as not started). A revision check that is still waiting is aborted on cancel.
- **Packages and groups.** Plugin children are not updated individually; a plugin is replaced as a whole by an explicit reinstall. Standalone resources are checked once each.
- **API cost.** Installs within 30 seconds share one resolver, so a batch from one repository costs one commit and one tree request instead of two per skill; the changed-only check itself always uses a fresh snapshot so it never compares against stale upstream data.
- **Local-only skills** (no recorded source and no remote path, `isLocalInstalledSkillMeta`) are classified before counting: they are left untouched, counted separately and never reported as a failure. The check runs after the index lookup, so a legacy skill with an unknown source that still matches an indexed name is reinstalled as before. The reinstall picker does not offer local-only skills.
- **Forced reinstall remains** as the first button in the same dialog and as the default for automatic callers.

## Not covered yet

- Kinds other than skill, and the user/global and group reinstall entry points.
- Staged replacement: an update removes the old copy and installs the new one, as reinstall always did, with the trash as the recovery path. Keeping the old copy until the new one is complete needs an identity and ownership decision shared with the sibling.
- Pinning the download to the verified commit; the download still follows the branch.

## Verification

- `scripts/test-resource-revision.js`: tree and blob resolution, one shared snapshot per branch, truncated listings, a missing path, malformed targets and responses, cancellation, and the classification rules (a foreign, malformed or missing baseline is never "unchanged"). Mutation probes on the comparison make it fail.
- `scripts/test-temporary-install-source.js`: an install records the baseline, an unreadable revision leaves no stale baseline and does not fail the install, and `checkSkillRevisionStatus` reports unchanged, changed, no baseline, different source and unknown (failed read or a kind without a folder baseline).
