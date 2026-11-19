# Agent Resources Ninja v0.2.71

## Highlights

- **Changed-only upgrade checks.** After an extension upgrade, installed remote skills in the first local workspace are compared with their recorded upstream revisions. Only confirmed changes are offered for update, with confirmation before replacement. Skills without a baseline are left untouched by automatic checks; eligible legacy installs can be synchronized through an explicitly started manual check.
- **Safer reference notes.** Existing Global Home reference notes are not overwritten by installation. Reinstall actions confirm and revalidate the destination; ambiguous or changed targets are rejected.
- **Interrupted updates.** Recovery records for open local workspaces are reported without modifying their files. Restoration and cleanup remain manual.
- **Accurate batch results.** Resources not started or without a typed result are classified as failures rather than incorrectly reported as missing from the index.

## Compatibility

- Forced reinstall remains a separate repair operation using the existing trash-first behavior. Shared, synchronized, network and linked locations remain excluded from automatic changed-skill replacement.
- `resourceNinja.refCatalogFormat` remains supported and unchanged. The shared index-store lock is not a resource-file lock.
- Bundled Resource Index remains v1.33.0 (2,774 resources across 23 sources).

## Verification

- TypeScript compilation and lint passed. The resource regression suite passed 116 tests with three network tests skipped; the upstream suite passed all 119 tests.
- Extension Host smoke tests passed in English and Japanese (10 passing, one sibling-integration test pending in each). An earlier English run had two failures while another suite was running; the isolated rerun passed both locales without the competing suite.
- Dependency check: the configured registry proxy rejected both runtime and full `npm audit` requests with HTTP 400 `Invalid package tree`; no npm audit pass is claimed. An OSV query of 373 unique public lockfile package/version pairs found no advisory for the runtime dependency and three advisories affecting development dependencies (two moderate, one low). OSV is supplementary, not equivalent to npm audit.
- A production build matching the VSIX entrypoint byte for byte has no `node_modules` inputs; the archive contains no development dependency files.
- Interactive upgrade and first-sync flows, Global Home Browse against a live source, persistent-profile restart and the sibling-extension integration require additional live verification. Recovery records do not automatically restore files.

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.71.vsix`
- Size: 613,236 bytes
- SHA256: `20C861B1C04EBAF5651AD40536640E2477B1AC2373D96C28D1486B1560EBAF7D`
- Installed in an isolated profile and runtime assets matched the VSIX.
