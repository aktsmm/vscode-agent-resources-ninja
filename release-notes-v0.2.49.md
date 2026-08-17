# Agent Resources Ninja v0.2.49

## Highlights

- Added automatic resume after a GitHub rate limit: the source that hit the limit and the ones never attempted are recorded and retried once the window resets, with the deadline taken from `Retry-After`, then `x-ratelimit-reset`, then a one-minute minimum.
- Added status-bar progress for that resume and a report of both terminal outcomes, so a promised retry no longer runs and finishes invisibly.
- Changed the full index update to scan the oldest sources first, so a run cut short by a rate limit cannot leave the same tail of sources permanently stale.
- Added a separate `lastScannedAt` so the index stops reporting itself weeks old right after a scan; `lastUpdated` now means the bundled catalog date only.
- Added a warning icon and a last-indexed tooltip to a source row that holds no resources, so a retired preset is distinguishable from a scan that came back empty.
- Fixed retired preset sources lingering in the cached index as empty `0 resources` rows, and consolidated a retired source only for the resources its successor already ships.

## Compatibility

- `resourceNinja.refCatalogFormat` remains supported and unchanged.
- An index written by an earlier version keeps working: `lastScannedAt` is optional, and freshness falls back to `lastUpdated` when it is absent.
- The fetch layer still treats rate limits as non-retryable; the resume is orchestrated one level up and never retries before the recorded deadline.
- User-added sources are never pruned, and a retired source that still holds a resource or a bundle is kept.
- The resume record shares a directory with the skill-only sibling extension and is read as untrusted input: an oversized file is rejected before parsing, the source list is bounded and deduplicated, and over-long claim fields are dropped.
- Only one automatic resume runs per record, and the claim is taken inside the existing cross-process lock so two windows cannot resume the same set.
- Resource Index remains v1.28.0 with 2653 resources across 24 sources.
- Index-wide freshness remains 2026-07-30 because this release does not perform a full source regeneration.

## Verification

- `npm run compile`, `npm run test:resources`, the Extension Host smoke test, and `npm audit --audit-level=moderate` all pass.
