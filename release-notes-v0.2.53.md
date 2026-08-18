# Agent Resources Ninja v0.2.53

## Highlights

- Fixed repository paths reaching GitHub URLs unescaped. A legal `#` or space in a file name ended the URL early, so a download, preview or "open on GitHub" link could silently address a different file. Every URL composed from a repository path now escapes it per segment, while a path taken back out of an existing URL is left alone because it is already encoded.
- Fixed branch names reaching the resource URL builder unescaped, so a branch containing `#` or `?` no longer produces a link that points at the repository root.
- Fixed the authenticated retry that follows a public raw 404 copying the branch segment straight into `?ref=`. The ref is now decoded once and re-encoded for the query, so an already-escaped ref round-trips unchanged and an unescaped one cannot add parameters to the API request.
- Aligned the shared sources manifest size limit with the skill-only sibling extension. A reader stricter than the other writer refuses a file it is not allowed to repair, which stops sharing for good.
- Held every shared-store writer to the limits its own reader enforces. The merged sources manifest, the shared resource index and the rate-limit resume record are now serialized once and checked against the same entry and byte limits used on read; a resume record that cannot be written is discarded rather than left behind.

## Compatibility

- `resourceNinja.refCatalogFormat` remains supported and unchanged.
- `resourceNinja.useSharedSourcesManifest` and `resourceNinja.useSharedResourceIndex` remain off by default.
- The shared lock payload, stale windows and reclaim naming remain aligned with the skill-only sibling extension, now pinned against v0.9.45 together with the sources caps and the scanner name format.
- Ordinary ASCII resource paths and branch names produce byte-identical URLs to v0.2.52.
- Resource Index remains v1.28.0 with 2653 resources across 24 sources.

## Verification

- TypeScript compile, ESLint and production build: PASS
- Offline resource regression suite: 84/84 PASS, 3 network tests skipped
- Upstream catalog suite: 87/87 PASS, 0 skipped
- Extension Host smoke test: 1/1 PASS
- Runtime and full dependency audits: 0 vulnerabilities
- New guards falsified: disabling the path escape, the shared-store limit checks, or the static URL check makes the corresponding test fail

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.53.vsix`
- Size: 506,368 bytes
- SHA256: `43888B36477628D23D6AEA0605D036B97EA58C41B75A23C6DAD7D5A1543486FB`
