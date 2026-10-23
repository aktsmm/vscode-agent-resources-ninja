# Agent Resources Ninja v0.2.63

## Highlights

- Agent tools now target a resource by ID, not by name. `installResource` and `localizeResource` take `source` and `path` (the Source and Path columns that `searchResources` shows), and `uninstallResource` takes `path` (the Path column of `listResources`). A same-name resource in two sources, or in two folders, can be chosen exactly. An ambiguous name never picks the first match: the tool returns the candidates and changes nothing. `localizeResource` used to edit the first same-name entry.
- A partial name is no longer a target. In the tools and in chat `/install`, a name that merely contains the text used to install or delete the only matching resource. Close names are now listed as suggestions only. An unknown `kind` stops the tool instead of being ignored, and `uninstallResource` also accepts the absolute folder path or a `SKILL.md` path.
- `installResource` does not overwrite silently. If the destination already exists it stops and reports it; pass `overwrite: true` only after you agreed to replace it (local edits are lost). After an install it reads the written file back and reports a failure if it is missing, and it shows the destination the install actually wrote to.
- Index entries are reduced to the types they declare when the index is loaded. The local cache, the bundled catalog and a sibling extension's shared index are files another writer can change, and one entry with a mistyped field (for example a numeric `description`) could stop a search for every resource. Wrong-typed optional fields are dropped, text is length-bounded, and an entry whose name, source, path or kind cannot be identified is ignored with a warning instead of being guessed. The reduction is idempotent and leaves the bundled catalog unchanged.

## Compatibility

- Existing resource kinds, install destinations, command IDs, settings and the shared index-store lock contract remain unchanged. `resourceNinja.refCatalogFormat` remains supported and unchanged.
- The new tool inputs (`source`, `path`, `overwrite`, `kind` on `localizeResource`) are optional. A call with an exact, unique name behaves as before, except that an existing install destination now needs `overwrite: true`.
- Bundled Resource Index v1.32.0 is unchanged: 2,777 resources across 23 sources.

## Verification

- TypeScript compile, ESLint and production build: PASS
- Offline regression suite 106/106 (3 network tests skipped by default) and the upstream-sync suite 109/109, including new behavioral tests that drive the registered tools with stubs, a selector unit suite, and an index field-type suite that pins the bundled catalog as unchanged
- Isolated Extension Host: PASS (9 tests). The host now invokes the registered tools through the language model API: refusals for unknown kind, partial and missing names, the Source/Path columns of search, and a real uninstall of two same-name skills where the name alone removes nothing and the path removes only the chosen one
- Mutation probes: disabling the overwrite guard, the unknown-kind guard, the index sanitizer, or making the selector pick the first of several matches each failed the matching test, and was restored
- Dependency audit and runtime audit: 0 vulnerabilities
- An independent read-only review found a wrong "multiple match" label, an unknown kind that silently widened the target, and path forms that did not match; all were fixed and tested

Not claimed as verified by these gates: a state-changing `installResource` or `localizeResource` call in a real host (install needs a GitHub fetch and localize rewrites the shared index; both are covered by stub tests with mutation probes).

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.63.vsix`
- Size: 580,263 bytes
- SHA256: `0975B6EDB1C5A3F486BCC779B95D7CD3D3B1331F9EFDA8383F6DBCE815691C71`
