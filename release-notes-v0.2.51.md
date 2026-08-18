# Agent Resources Ninja v0.2.51

## Highlights

- Fixed the shared store accepting a repository owner, repository name or branch that could point a download somewhere the source never named. A value of `..`, or a branch such as `../../other/repo/main`, passed a length check and was then interpolated straight into a `raw.githubusercontent.com` path. Each part is now validated on its own, an entry that fails is never used at runtime, and every raw URL escapes the branch per path segment so an ordinary name like `feature/x` keeps working.
- Fixed the cross-process lock being unable to tell that it had been taken. It now carries a generation, is published atomically from a staging file, is never taken from a living process inside the stale window, is refreshed by a heartbeat while it is held, is re-checked immediately before a commit, and is deleted only by the holder it belongs to.
- Fixed each extension deleting the other's scanner setting. Both implement scanners the other does not, and an unrecognised name was dropped rather than kept, so every save silently erased the other side's configuration.
- Fixed one shared file pausing taking the other down with it. The two files are now guarded separately, and losing a race for the lock is left to the next sync and only logged, because it resolves itself and is not the permanent pause the notification exists for.
- Fixed publishing an entry that would then be refused on the next read. Incoming entries were validated while our own outgoing entries were not, so a source carrying an unusable branch would have been written and then dropped whole.
- Fixed resource search throwing on a damaged index. The source list is now read through the guarded accessor everywhere, unusable elements are skipped, and a wholly unusable index simply returns nothing.
- Fixed the same source id appearing twice producing two runtime sources.
- Changed the GitHub Token documentation to lead with GitHub CLI, then the environment variable, then the VS Code setting marked as kept for backward compatibility, and replaced an example placeholder that was shaped like a real classic token.

## Compatibility

- `resourceNinja.refCatalogFormat` remains supported and unchanged.
- `resourceNinja.useSharedSourcesManifest` and `resourceNinja.useSharedResourceIndex` remain off by default; machines that never enabled them are unaffected.
- The lock payload, the stale windows and the reclaim file name are matched to the skill-only sibling extension so both sides read the same `index.lock`. A lock written by an earlier version carries no generation, which never matches one this version produces, so neither side can adopt or delete the other's lock by mistake.
- Running alongside a sibling extension that predates the generation is safe: a lock taken away mid-write is detected before the commit and the write is abandoned rather than completed over the new holder.
- A branch containing `%` is now refused on every path. Such a name is legal in Git but does not occur in practice, and refusing it uniformly keeps one repository from resolving differently depending on where its branch came from.
- A scanner name this extension cannot run is preserved on disk instead of being deleted, so enabling shared sources no longer erases the sibling extension's configuration.
- Resource Index remains v1.28.0 with 2653 resources across 24 sources.
