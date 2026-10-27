# Agent Resources Ninja v0.2.69

## Highlights

- **Local-only skills are no longer reported as reinstall failures.** "Reinstall All Workspace Skills" (including Update Changed Only) used to treat skills you created yourself, which have no recorded upstream, as "not found" failures and showed a failure warning although nothing was wrong. They are now left untouched, counted separately in the result message, and no longer offered in the "Reinstall Multiple" picker. A legacy skill with an unknown source that still matches an indexed name is reinstalled as before. See `docs/changed-only-updates.md`.
- **Lockfile guard.** A new regression test fails if `package-lock.json` resolves any package from a non-public registry, so a personal or corporate mirror cannot leak into the repository through `npm update`.

## Compatibility

- No new setting or command ID. Existing resource kinds, install destinations, the agent tool inputs and the shared index-store lock contract remain unchanged. `resourceNinja.refCatalogFormat` remains supported and unchanged.
- Bundled Resource Index v1.32.0 is unchanged: 2,777 resources across 23 sources.

## Verification

- TypeScript compile, ESLint and production build: PASS
- Offline regression suite 109/109 (3 network tests skipped by default), the upstream-sync suite 112/112 (0 skipped), `npm test` and the extension host smoke test in English and Japanese (9 passing each)
- New tests: the local-only predicate (unknown source with and without a remote path, named source without a path), the index lookup running before the local-only skip, and the lockfile registry guard with a mutation probe.
- Dependency audit: exit 0 (3 low-severity findings in the dev-only test tooling chain with no fix available; runtime audit clean)

Not claimed as verified by these gates: the reinstall dialogs and picker rendered in a real VS Code window.

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.69.vsix`
- Size: 588,152 bytes
- SHA256: `D295647153F29EBA489AC36B4B447B98B024020A3A8DB7A06A6061A98CAC2388`
