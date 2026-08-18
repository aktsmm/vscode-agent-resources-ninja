# Agent Resources Ninja v0.2.54

## Highlights

- Localized the `@resources` participant display name, description, and built-in command descriptions while preserving the invocation token.
- Added verified gh CLI account recovery: the extension identifies the active account, validates a user-selected alternate account, confirms the switch, verifies the new active token, and retries approved remote operations once.
- Replaced ambiguous raw GitHub URL parsing with exact caller-supplied Contents API routes, preserving private content access on multi-segment branches such as `feature/x`.
- Routed persistent shared-store filesystem failures into per-store one-time warnings without interrupting local resource operations; successful writes clear the notice.
- Added production reachability, authenticated-content routing, release-documentation, and packaged-entrypoint guards.
- Added tracked contributor and release sources of truth through `CONTRIBUTING.md` and `docs/release-runbook.md`.

## Compatibility

- `resourceNinja.refCatalogFormat` remains supported and unchanged.
- `resourceNinja.useSharedSourcesManifest` and `resourceNinja.useSharedResourceIndex` remain off by default.
- The shared lock payload, stale windows, heartbeat, and reclaim naming remain aligned with the skill-only sibling extension.
- Public raw GitHub content remains anonymous-first; authenticated escalation now requires an exact Contents API URL from the owning caller.
- Resource Index remains v1.28.0 with 2653 resources across 24 sources.

## Verification

- TypeScript compile, ESLint and production build: PASS
- Offline resource regression suite: 89/89 PASS, 3 network tests skipped
- Upstream catalog suite: 92/92 PASS, 0 skipped
- Extension Host smoke test: 1/1 PASS
- Runtime and full dependency audits: 0 vulnerabilities
- Marketplace PAT preflight: PASS for publisher `yamapan`
- Mutation guards proved: post-switch verification, one-shot retry, NLS metadata, shared lock contention, export reachability, authenticated route composition, persistent write classification, and release publish syntax

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.54.vsix`
- Size: 510,102 bytes
- SHA256: `E4A13ECEAC1D6E5112EAC08C20E21E3869E7D16E8398075881E058FE42261440`
