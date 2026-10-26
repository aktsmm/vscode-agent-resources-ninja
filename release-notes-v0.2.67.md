# Agent Resources Ninja v0.2.67

## Highlights

- Report Bug on a batch reinstall failure now previews the exact issue title and body in a confirmation dialog first, and the GitHub draft opens only after you choose Open GitHub Draft. Nothing is posted automatically. The diagnostics also count the failed resources by a fixed resource-kind list and the failed stages by a fixed stage list; anything outside the lists is counted as `other`, so resource names, repository URLs, local paths and raw errors never reach the draft.
- New release gates for the built VSIX (developer tooling, no runtime change): `npm run verify:vsix` installs the VSIX into a temporary profile with the VS Code CLI, reads it back and compares the installed compiled entrypoint, both NLS files and the resource index with the VSIX bytes; `npm run test:locales` runs the Extension Host smoke test in English and Japanese in isolated directories; the release hygiene test rejects a development bundle that references a sourcemap.
- The Japanese Extension Host smoke run now passes: two assertions accepted only the English tool messages although the product answered correctly in Japanese.

## Compatibility

- No new setting, command ID or install target. `resourceNinja.reportBug` and the existing reinstall flows keep their behavior; the batch failure Report Bug action only adds the confirmation step. Existing resource kinds, install destinations, the agent tool inputs and the shared index-store lock contract remain unchanged. `resourceNinja.refCatalogFormat` remains supported and unchanged.
- Bundled Resource Index v1.32.0 is unchanged: 2,777 resources across 23 sources.

## Verification

- TypeScript compile, ESLint and production build: PASS
- Offline regression suite 107/107 (3 network tests skipped by default), the upstream-sync suite 110/110 and the extension host smoke test in English and Japanese (9 passing, 1 pending each)
- New tests: fixed kind and stage counts with free-text values falling into `other`, the preview that must be confirmed before the draft opens (the draft equals what was previewed), and negative tests proving a changed, missing or development runtime asset is reported. A mutation probe on the fixed-list mapping makes the report test fail.
- Dependency audit: exit 0 (3 low-severity findings in the dev-only test tooling chain with no fix available; runtime audit clean)

Not claimed as verified by these gates: the native modal confirmation clicked in a real VS Code window; the preview wiring is covered by behavior tests with a stubbed window.

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.67.vsix`
- Size: 584,150 bytes
- SHA256: `4DEBDD7370AA884639D62935EE7021A7920E9CDF2C3B1AFDB99F8A5C37DA9674`
