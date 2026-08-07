# Agent Resources Ninja v0.2.42

## Highlights

- A skill install that could only write the generated template is no longer reported as success. It records the state, raises a failure so batch summaries count it, and offers `Reinstall`, `Update Index`, `Report Bug`, or `Delete`.
- The `Incomplete` state is now visible wherever a resource is listed: the workspace tree, the user and global resource tree, the reinstall picker, the `/list` chat reply, and the workspace resource tables the language-model tools return, which are also told not to rely on the contents.
- A failed GitHub request now walks every credential source instead of continuing only when the failed token came from SecretStorage, so a stale environment variable, `gh` CLI, or legacy setting no longer makes a private repository look like a `404`.
- `429`, `502`, `503`, and `504` are retried with a single bounded backoff layer that honors `Retry-After` and the rate-limit reset and gives up rather than waiting more than 20 seconds. Each wait, credential switch, and abandoned retry is written to the Output Channel with the host and path only.
- Resource text from third-party repositories can no longer break the generated instruction file or the ref catalogs. Names, descriptions, sources, and paths are collapsed to one line, stripped of HTML comment delimiters, and escaped in the table cell, the link label, and the link destination. Six descriptions in the bundled index already contained a line break.
- `AGENTS.md`, `hooks.json`, and `mcp.json` rewrites are serialized per file, so two overlapping updates can no longer let the later write discard what the earlier one had just added.

## Settings

- No settings were added or removed in this release. The `resourceNinja.refCatalogFormat` setting and its default behavior are unchanged.

## Verification

- `npm run compile`: PASS
- `npm run test:resources`: PASS
- `node scripts/test-no-mirror-implementations.js`: PASS
- `node scripts/test-whenToUse.js`: PASS (19/19)
- `npm test`: PASS (Extension Host smoke 1/1)
- `npm run audit:runtime`: PASS (0 vulnerabilities)
- Full development audit: guarded; the remaining `brace-expansion` advisory reports no patched version and does not affect packaged runtime dependencies.

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.42.vsix`
- Size: 377,982 bytes (369.12 KB)
- SHA256: `2D1D0DDD104B4AD91CE28BF65CA36C883E3508F8F3FE48E85F17200C8819D4A2`
- Payload: 12 files (manifest, localization, LICENSE, README, CHANGELOG, bundled `dist/extension.js`, icons, resource index). No sources, tests, sourcemaps, or internal documents are included.
