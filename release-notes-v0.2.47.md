# Agent Resources Ninja v0.2.47

## Highlights

- Added recoverable GitHub authentication UX that reports the active credential source and gives source-specific actions for stale tokens, rate limits, organization SSO, classic PAT policy, private repositories, and unavailable GitHub CLI.
- Added a GitHub authentication status command without exposing credential values, machine-scoped the legacy token setting, and made clear/reset remove SecretStorage plus inspectable legacy configuration values.
- Changed workspace uninstall and reinstall to move existing resources to the trash, with accurate confirmation and restoration guidance across GUI and Language Model tool flows.
- Prevented partial downloads, cancelled operations, and failed upgrade reinstalls from being reported as successful.
- Fixed Source-row Copy URL, file-backed Open in Terminal, orphan marker cleanup, output-regeneration failure feedback, and upgrade reinstall confirmation behavior.
- Localized Language Model tool search, recommendation, install, uninstall, GitHub search, and source-management output; removed replacement-character corruption, malformed tables, and skill-only terminology.
- Unified install destination name normalization across production and collision/path tests.

## Compatibility

- `resourceNinja.refCatalogFormat` remains supported and unchanged.
- Resource Index remains v1.28.0 with 2653 resources across 24 sources.
- Index-wide freshness remains 2026-07-30 because this release does not perform a full source regeneration.
- Existing `GH_TOKEN`, `GITHUB_TOKEN`, GitHub CLI, SecretStorage, and legacy setting support remains available; credential precedence and recovery guidance are now explicit.
- Old plaintext `resourceNinja.githubToken` entries already present in `.vscode/settings.json` are ignored by the machine-scoped setting but should be removed manually from that file.

## Verification

- `npm run compile`: PASS
- `npm run test:resources`: PASS (`77/77`, 3 network tests skipped by the offline gate)
- `npm run test:upstream`: PASS (`80/80`, no skips)
- `npm test`: PASS (`1/1` Extension Host smoke)
- `npm audit --audit-level=moderate`: PASS (0 vulnerabilities)
- `npm run audit:runtime`: PASS (0 vulnerabilities)
- Authentication unit tests: PASS (`27/27`)
- Manifest, localization, installability, collision, release hygiene, Language Model output, and diff checks: PASS

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.47.vsix`
- Size: pending packaging
- SHA256: pending packaging
- Payload verification: pending packaging
