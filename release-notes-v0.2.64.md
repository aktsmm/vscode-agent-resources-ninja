# Agent Resources Ninja v0.2.64

## Highlights

- Files downloaded from GitHub are now written byte for byte. They were read as text and written back as UTF-8, so binary files shipped inside a resource (`.pptx`, `.tar.gz`, images) were corrupted and a UTF-8 BOM was dropped from text files. The directory download, the single-resource install (agent, prompt and similar), the single `.md` skill install and the `SKILL.md` recovery now keep the response as bytes and write it unchanged. If you installed a resource that contains binary files with an earlier version, reinstall it with this version.

## Compatibility

- Existing resource kinds, install destinations, command IDs, settings, the agent tool inputs and the shared index-store lock contract remain unchanged. `resourceNinja.refCatalogFormat` remains supported and unchanged. This release changes how downloaded bytes are written, nothing else.
- Bundled Resource Index v1.32.0 is unchanged: 2,777 resources across 23 sources.

## Verification

- TypeScript compile, ESLint and production build: PASS
- Offline regression suite 106/106 (3 network tests skipped by default) and the upstream-sync suite, including two new byte-level tests: one for the directory download (binary bytes and a UTF-8 BOM) and one for the three other write paths (BOM plus an invalid UTF-8 byte)
- Mutation probes: rewriting each of the four write paths back to a text round-trip failed the new tests, one path at a time, and was restored
- Isolated Extension Host: PASS (9 tests). The host test was also made load-tolerant (per-test timeouts, deadline-based waits, a re-touching file watcher wait): under CPU load on every core it passed 4 of 4 runs, against 1 of 4 before
- Dependency audit and runtime audit: 0 vulnerabilities

Not claimed as verified by these gates: an install of a binary file from a live GitHub repository in the real host. The byte path is covered by stub tests that return a response whose `text()` and `arrayBuffer()` differ, as a real response does.

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.64.vsix`
- Size: 580,653 bytes
- SHA256: `98C4B0E9132033F5355CC28DB597F735A2D3C0A9AADC5FDE3BF880C49A8E0BE4`
