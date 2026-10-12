# Agent Resources Ninja v0.2.58

## Highlights

- Added `resourceNinja.autoManageGitignore`, enabled by default and configurable per workspace/folder. Workspace skill roots ignore external skill folders and only `.skill-meta.json` for local skills, without replacing user rules or the Skills Ninja block.
- Turning gitignore management off removes only the Resources block. Old destinations are reconciled, unsaved files and malformed markers are preserved, and synchronization failures remain separate from installation results. Activation alone does not create an ignore file.
- Preview actions now work inside the existing nonce-based CSP without inline handlers. Action rows wrap in narrow Webviews.
- Refreshed PRP, Google Skills and Azure Skills, including current PRP companion paths and `discover-azure-skills`. Unrelated sources and the catalog-wide scan date remain unchanged.
- Updated development dependencies to resolve reported High/Critical vulnerabilities while retaining public npm URLs and verified SHA-512 integrity in the lockfile.
- Strengthened inventory-order tests with a production AST mutation probe and explicitly configured English/Japanese product-language checks. Unsupported smoke-test locale/path input is rejected before fixture creation.

## Compatibility

- Existing resource kinds, install destinations, command IDs and shared index-store contracts remain unchanged.
- Gitignore management is limited to workspace skill roots; user/global roots and other resource kinds are excluded.
- The skill-root `.gitignore.agent-ninja.lock` contract matches Agent Skills Ninja v0.9.54 and remains separate from the shared index lock.
- `resourceNinja.refCatalogFormat` remains supported and unchanged.
- Bundled Resource Index v1.31.0 contains 2,788 resources across 24 sources.
- General cross-process resource-output locking, atomic staged replacement and provable rename identity remain separate coordinated design work, not new capabilities of this release.

## Verification

- TypeScript compile, ESLint and production build: PASS
- Offline Resource regression suite: 96/96 PASS, 3 network tests skipped
- Upstream catalog suite: 99/99 PASS, 0 skipped
- English and Japanese isolated Extension Hosts: 3/3 PASS per locale, including both Ninja extensions in the same destination
- Runtime and full dependency audits: 0 vulnerabilities
- Marketplace PAT preflight: PASS for publisher `yamapan`
- VSIX content and deterministic packaged-input hygiene: PASS, 12 runtime files without source, tests or sourcemaps
- Isolated VSIX installation and version readback: `yamapan.agent-resources-ninja@0.2.58` PASS

Native notification/Cursor activation and the VS Code Webview command bridge are not claimed as end-to-end verified by these gates. Their existing behavioral and adapter guards remain applicable.

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.58.vsix`
- Size: 552,284 bytes
- SHA256: `161476E5C4D9AD7005F1071ECE6CF13B9AB5154E402B48A588E55CFA32188A42`
