# Agent Resources Ninja v0.2.68

## Highlights

- **Update Changed Only for workspace skills.** "Reinstall All Workspace Skills" now offers **Update Changed Only** next to Reinstall. Installs record the upstream revision they were read at (`sourceRevision` in `.skill-meta.json`, the same field Agent Skills Ninja uses), and this option replaces only the skills whose upstream folder changed since then. A skill is skipped only when its baseline provably equals upstream; a missing or foreign baseline and a failed check all update like a forced reinstall, and a skill with no baseline is reinstalled once to record one. Reinstall stays as the repair path. Installs within 30 seconds share one revision snapshot, so a batch from one repository adds one commit and one tree request. Per-kind decisions and the remaining scope are in `docs/changed-only-updates.md`.
- **User/global outputs are written under the shared writer lock.** Updating a user/global instruction file or reference catalog now runs under the same shared store lock Agent Skills Ninja already takes for those files, so two extension hosts no longer interleave a read-modify-write. If the other extension holds the lock past the retry budget, or the lease is lost before the write, the update ends as `locked` with every existing byte untouched and is retried by the next automatic update. Workspace outputs are unchanged. See `docs/output-write-locking.md`.

## Compatibility

- No new setting or command ID. The lock payload, stale windows and reclaim file name are unchanged, so no coordinated release with the sibling is needed. `.skill-meta.json` gains an optional `sourceRevision` field that is validated on read; older metadata without it keeps working. Existing resource kinds, install destinations, the agent tool inputs and the shared index-store lock contract remain unchanged. `resourceNinja.refCatalogFormat` remains supported and unchanged.
- Bundled Resource Index v1.32.0 is unchanged: 2,777 resources across 23 sources.

## Verification

- TypeScript compile, ESLint and production build: PASS
- Offline regression suite 108/108 (3 network tests skipped by default), the upstream-sync suite 111/111 and the extension host smoke test in English and Japanese (9 passing, 1 pending each)
- New tests: the writer helper against a real directory (refused while another process holds the lock with the other lock untouched, lease lost before commit, real faults propagating) and the instruction update path (a refused global write leaves the file byte for byte unchanged, a workspace target never asks for the lock); revision resolution, shared snapshots, truncated listings, malformed input and the classification rules; the baseline recorded by installs and its absence after a failed check; resolver sharing. Mutation probes make the lock-scope, comparison, baseline and sharing tests fail.
- Dependency audit: exit 0 (3 low-severity findings in the dev-only test tooling chain with no fix available; runtime audit clean)

Not claimed as verified by these gates: the Update Changed Only dialog rendered in a real VS Code window. Other resource kinds, the user/global and group reinstall entry points, staged replacement and commit-pinned downloads are not part of this release.

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.68.vsix`
- Size: 587,825 bytes
- SHA256: `148DD5427B5CD25ECFF66D121EB6C8C40AC2DCABA86C3C47B02D12EE495096BD`
