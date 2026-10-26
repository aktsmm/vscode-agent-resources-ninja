# Output Write Locking

Agent Resources Ninja and Agent Skills Ninja can both write the same user/global instruction file and reference catalogs from two extension host processes. This note records how those writes are serialized and what is deliberately not covered.

## Contract

- A user/global output is written under the **shared store lock** (`index.lock` in the shared Agent Ninja directory). The payload shape, stale windows, heartbeat and reclaim file name are the cross-extension contract documented at the top of `src/sharedStoreLock.ts` and pinned by `scripts/test-shared-store-contract.js`. No new lock file or payload exists, so nothing about the contract changes.
- Agent Skills Ninja already takes the same lock around its user/global output writes (`withOutputWriteLock("userGlobal", ...)` in its `src/instructionManager.ts`), so the two extensions exclude each other without a coordinated release.
- A workspace output is written by one extension host at a time through the in-process serial queue, as before. It never takes the cross-process lock.

## Behavior

- The writer starts only after it holds the lock. It reads the current file, builds the new block and writes inside that critical section.
- Immediately before the first write the writer asks the lease whether it is still the owner (`assertStillOwned`). A paused process whose lock was reclaimed refuses to commit.
- If the lock is held by the other extension past the retry budget, or the lease was lost, the result is `locked` with the message `shared output lock: lock-unavailable` or `shared output lock: lease-lost`. No existing byte is changed and no file is created. The existing failure notice applies, and the next automatic update retries.
- An unrelated fault inside the writer (for example a permission error) is not turned into `locked`; it keeps its own status.

## Not covered

- Explicit removal of the managed block (`removeSkillSection`, `removeSkillSectionFromFile`) is a user-started command that edits only the marker section. It does not take the cross-process lock.
- The lock is advisory between the two extensions. A third tool editing the same file is outside the contract; hand-written content outside the managed markers is preserved by the marker-based update.

## Verification

- `scripts/test-shared-store-lock.js` runs the writer helper against a real directory: refused while another process holds the lock (the writer never starts and the other lock is untouched), value returned and lock released, lease lost before commit, and an unrelated fault propagating.
- `scripts/test-coexistence-ref-catalog-cleanup.js` drives `updateInstructionFileAtUri`: a global target asks for the lock, a refused global write leaves the file byte for byte unchanged, a granted one keeps hand-written text, and a workspace target never asks for the lock. Mutation probes on the scope check make it fail.
