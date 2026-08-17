# Agent Resources Ninja v0.2.48

## Highlights

- Added a GitHub credential blocklist so a credential rejected by organization SSO or classic-PAT policy is remembered per repository owner for 10 minutes instead of being re-sent on every request of the same scan.
- Changed the credential fallback walk to classify and record its own responses and to skip candidates already known to be rejected; a plain permission failure never blocklists an owner.
- Kept the raw-404 to API escalation for a blocked credential and withheld only the Authorization header, so the 404 that branch fallback depends on is preserved while a later credential can still authenticate.
- Added a single output-channel line at the moment suppression starts, naming the repository owner and the rejection reason, so a later `404` stays traceable.
- Added root-cause failure attribution so an SSO rejection is not hidden by a later rate limit, using one shared reason mapping across the authentication dialog, source-update failures, and Language Model tool results.
- Added an **Open Organization SSO Authorization** action built from the `X-GitHub-SSO` header and accepted only for an `https://github.com` organization SSO path.

## Compatibility

- `resourceNinja.refCatalogFormat` remains supported and unchanged.
- The surfaced `GitHubResponseError.kind` is unchanged, so rate-limit batch abort and 404 branch fallback behave exactly as before; the root cause is carried in a separate field used only by presentation and recovery-policy code.
- The blocklist lives only in process memory, is never persisted, and is keyed by a token fingerprint that is never written to the output channel.
- Suppression is cleared by an index update, source add, install, resource preview, GitHub search, stored-token clear, or the SSO authorization action; shared helpers that run per source or per file deliberately keep it.
- The pending SSO authorization value is stored as a non-enumerable property, so serializing or logging the error cannot leak it.
- Resource Index remains v1.28.0 with 2653 resources across 24 sources.
- Index-wide freshness remains 2026-07-30 because this release does not perform a full source regeneration.

## Verification

- `npm run compile`: PASS
- `npm run test:resources`: PASS (`78/78`, 3 network tests skipped by the offline gate)
- `npm run test:upstream`: PASS (`81/81`, no skips)
- `npm test`: PASS (`1/1` Extension Host smoke)
- `npm audit --audit-level=moderate`: PASS (0 vulnerabilities)
- `npm run audit:runtime`: PASS (0 vulnerabilities)
- GitHub credential blocklist suite: PASS (`32/32`)
- Static guards proven non-vacuous by temporarily breaking each one and observing the exact failure: reset placement, shared-helper reset absence, root-cause surface routing, and diagnostics leak

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.48.vsix`
- Size: pending
- SHA256: pending
- Payload: pending
