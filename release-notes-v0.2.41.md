# Agent Resources Ninja v0.2.41

## Highlights

- The GitHub token now lives in VS Code SecretStorage instead of a settings value, is migrated from the legacy setting on activation, stays in sync when that setting changes, and can be removed with the new `Clear Stored GitHub Token` command from the Command Palette or from install and index-update recovery dialogs.
- A source remembers the GitHub repository id it was indexed from and refuses to update when the URL later resolves to a different repository, so a name that was deleted or renamed away cannot be re-registered by someone else and served as the same source. Re-adding the source offers an explicit approval action.
- A scan that succeeds but returns no resources no longer wipes that source. A full refresh keeps the existing resources, and a single-source refresh offers `Apply Empty Result` so shrinking the index stays a deliberate choice.
- The startup refresh of stale source indexes now handles at most 5 sources per launch and rotates the starting point, so a large workspace does not spend its GitHub quota at once and a repeatedly failing source cannot starve the ones behind it.
- GitHub failure diagnosis was corrected: an SSO failure on a request escalated to the authenticated API is retried anonymously, an exhausted anonymous rate limit is no longer reported as `SSO required`, and code search failures are classified instead of always claiming a rate limit.
- Source scans resolve the canonical owner and repository name before building request URLs and write the result back, so a renamed upstream repository keeps working without editing the source.

## Settings

- No settings were added or removed in this release. The `resourceNinja.refCatalogFormat` setting and its default behavior are unchanged.
- The GitHub token value moved from the setting into VS Code SecretStorage; the legacy setting is still read and migrated for compatibility.

## Verification

- `npm run compile`: PASS
- `scripts/test-*.js` (63 scripts): PASS
- `npm run test:resources`: PASS
- `node scripts/test-whenToUse.js`: PASS (19/19)
- `node scripts/test-search-logic.js`: PASS
- `npm test`: PASS (Extension Host smoke 1/1)
- Full development audit: guarded; the remaining `brace-expansion` advisory reports no patched version and does not affect packaged runtime dependencies.

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.41.vsix`
- Size: 372,379 bytes (363.65 KB)
- SHA256: `5F3324EA9A614CC8470604CE0048FC62ECF735023B33BB4F79D6EB975D1A9021`
- Payload: 12 files (manifest, localization, LICENSE, README, CHANGELOG, bundled `dist/extension.js`, icons, resource index). No sources, tests, sourcemaps, or internal documents are included.
