# Agent Resources Ninja v0.2.52

## Highlights

- Prevented a scanner implemented only by the sibling extension from being executed as this extension's fallback scanner. Foreign scanner declarations now remain runtime-only guards, preserve sibling-owned resources and freshness, and survive shared-store rewrites unchanged.
- Fixed shared-lock contention on filesystems without hard-link support. A fallback `EEXIST` now returns to the bounded retry loop instead of escaping as a raw filesystem error.
- Fixed Japanese GitHub rate-limit messages missing the authentication-help flow, and centralized localized authentication-message classification.
- Tightened HTTP status matching so names, paths and byte counts containing status-like digits are not mistaken for HTTP failures. GitHub Contents API refs are now query-encoded.
- Fixed activation publishing a newly bundled source without its bundled resources. Sources and resources now converge together after shared state is read.
- Bounded the locally writable shared resource index to 32 MB, 10,000 resources, 10,000 translation or scan records, and 64 fields per resource. Metadata is validated before runtime use, malformed auxiliary scan fields cannot transfer sibling ownership, and rejected bootstrap writes use the existing one-time sync warning.

## Compatibility

- `resourceNinja.refCatalogFormat` remains supported and unchanged.
- `resourceNinja.useSharedSourcesManifest` and `resourceNinja.useSharedResourceIndex` remain off by default.
- The shared lock payload, stale windows and reclaim naming remain aligned with the skill-only sibling extension.
- Resource Index remains v1.28.0 with 2653 resources across 24 sources.

## Verification

- TypeScript compile, ESLint and production build: PASS
- Offline resource regression suite: 84/84 PASS, 3 network tests skipped
- Upstream catalog suite: 87/87 PASS, 0 skipped
- Extension Host smoke test: 1/1 PASS
- Isolated VSIX install: `yamapan.agent-resources-ninja@0.2.52` PASS
- Runtime and full dependency audits: 0 vulnerabilities

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.52.vsix`
- Size: 504,145 bytes
- SHA256: `017F0EC37487E3CB8FE8CD978B5A91FE968613F5756C71FB92FFBC741A7F7E88`
