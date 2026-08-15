# Agent Resources Ninja v0.2.46

## Highlights

- Hardened external `search-index.json` and `registry.json` parsing. Malformed rows, non-string text/tags, missing name/path values, and nonnumeric star counts are rejected or normalized before they become resources.
- Added defense in depth for preview star rendering by normalizing and HTML-escaping the formatted value at the webview sink.
- Replaced fixed Markdown placeholders and `Math.random` CSP nonces with independent cryptographic random tokens, preventing resource text from spoofing internal placeholders.
- Bounded shared GitHub bug-report URLs to 7,500 encoded characters with Unicode-safe truncation and an explicit notice.
- Added one 60-second operation budget across GitHub request retries, backoff waits, raw-to-API escalation, anonymous fallback, token resolution, and credential fallback.
- Added a release-history guard that keeps tagged CHANGELOG sections immutable and requires new work to remain under `Unreleased`.

## Compatibility

- `resourceNinja.refCatalogFormat` remains supported and unchanged.
- Resource Index remains v1.28.0 with 2653 resources across 24 sources. Index-wide freshness remains 2026-07-30 because this release does not perform a full source regeneration.
- Per-request GitHub timeout and retry-count limits remain unchanged. The new operation budget only bounds the complete multi-stage flow.
- Caller cancellation remains an `AbortError`; internal operation deadline exhaustion reports `ETIMEDOUT`.

## Verification

- `npm run compile`: PASS
- `npm run test:resources`: PASS (`77/77`, 3 network tests skipped by the offline gate)
- `npm run test:upstream`: PASS (`80/80`, no skips)
- `npm test`: PASS (`1/1` Extension Host smoke)
- `npm audit --audit-level=moderate`: PASS (0 vulnerabilities)
- `npm run audit:runtime`: PASS (0 vulnerabilities)
- Raw installability, no-new-collision, release hygiene, tagged CHANGELOG immutability, manifest consistency, and diff checks: PASS
- Packaged VSIX install and exact-bits smoke: pending

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.46.vsix`
- Size: pending
- SHA256: pending
- Payload: pending final package inspection