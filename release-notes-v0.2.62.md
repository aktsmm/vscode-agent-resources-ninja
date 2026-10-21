# Agent Resources Ninja v0.2.62

## Highlights

- Dead source warnings now appear once per cause. A source whose scan returns no resources, or whose URL now points to a different repository, used to raise the same warning at every startup. Scan failures are classified by error type (not by message text), reported once per cause with Open URL / Stop Updating / Remove, and checked again later (7 days for a changed repository, 30 days for an empty source). A successful manual update clears the record, and a source you stopped updating is marked "auto-update off" in the tree. Unreadable candidate files and registry fetch failures are treated as failed reads, so they stay actionable. At most 3 causes are shown per startup; the rest follow on the next one.
- The OpenAI Codex preset (`openai/codex`) is retired because the repository no longer publishes resources under `.codex/skills/`. The catalog now lists it as retired (index v1.32.0); it is removed from your local index and is not imported again from the shared stores, but it stays in the shared file for any extension that has not retired it yet.
- The Gitignore synchronization warning names the cause and the folder in English and Japanese and offers Show Folder and, for a leftover `.gitignore.agent-ninja.lock`, Show Lock File. A failure while removing the managed block is worded apart because the exclusions stay in `.gitignore`. The lock is never deleted automatically.

## Compatibility

- Existing resource kinds, install destinations, command IDs, settings and the shared index-store lock contract remain unchanged. `resourceNinja.refCatalogFormat` remains supported and unchanged.
- The shared `sources.json` rewrite keeps ids this extension retired, so a sibling extension that has not retired them is not affected.
- Bundled Resource Index v1.32.0 contains 2,777 resources across 23 sources (OpenAI Codex removed).

## Verification

- TypeScript compile, ESLint and production build: PASS
- Offline regression suite 103/103 (3 network tests skipped by default) and the upstream-sync suite 106/106, including new tests for failure classification, once-per-cause notices, retired sources and the Gitignore failure wording
- Isolated Extension Host: PASS; the Gitignore cause text was observed in the test window
- Dependency audit and runtime audit: 0 vulnerabilities
- An independent different-model review found a lost freshness stamp inside a multi-source batch, a failure record that was never pruned, and a misleading retry wording; all three were fixed and tested

The toast action buttons for a stopped or removed source and the real cause of the Gitignore failure reported from another workspace are not claimed as verified by these gates.

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.62.vsix`
- Size: 576,323 bytes
- SHA256: `8DF1EFCEAE48C713A74860FE770AC3511D5BE9B76E77E2472CBDEBAC9D2CDCA3`
