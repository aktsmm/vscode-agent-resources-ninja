# Agent Resources Ninja v0.2.66

## Highlights

- Skills inside skills are grouped under their parent. A skill folder that sits inside another skill folder (for example `deploy-model/capacity`) is shown as a child of that parent in the Installed and User-Global views instead of a separate entry with a long relative path. A parent row shows how many skills it holds. When a filter hides the parent, the child stays visible at the top level.
- A contained skill is not counted as unregistered and is left out of the generated skill lists, so the tree and the instruction block share one rule.
- Gitignore synchronization no longer reports a folder replaced or locked during the scan (`ENOENT`, `EBUSY`, `EPERM`) as corrupt `.skill-meta.json`. Only unparsable or incomplete metadata is reported that way; a folder that changed during the scan and file access failures get their own wording.

## Compatibility

- No new setting, command ID or install target. Existing resource kinds, install destinations, the agent tool inputs and the shared index-store lock contract remain unchanged. `resourceNinja.refCatalogFormat` remains supported and unchanged.
- Bundled Resource Index v1.32.0 is unchanged: 2,777 resources across 23 sources.

## Verification

- TypeScript compile, ESLint and production build: PASS
- Offline regression suite 106/106 (3 network tests skipped by default), the upstream-sync suite 109/109 and the extension host smoke test (9 passing, 1 pending)
- New tests: the shared contained-skill rule over Windows paths, nested and sibling-prefix cases; the Installed and User-Global trees (parent expands, `getParent` chain, filtered parent, English and Japanese count label); the user and workspace scanner flags; the generated catalog leaving a contained skill out; Gitignore scan races (`ENOENT`, `EBUSY`, `EPERM`) against the old classification. Each consumer was proven by a mutation probe that makes its test fail.
- Dependency audit: exit 0 (3 low-severity findings in the dev-only test tooling chain with no fix available; runtime audit clean)

Not claimed as verified by these gates: the nested-skill tree and the new Gitignore wording rendered in a real VS Code window. They are covered by behavior tests with the real providers and scanners.

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.66.vsix`
- Size: 582,796 bytes
- SHA256: `99B366442A5DCA9B3BB45566883B04585A93BB0823848A23E88CFCE087AAD6BB`
