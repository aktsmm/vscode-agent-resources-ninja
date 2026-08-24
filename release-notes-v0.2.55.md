# Agent Resources Ninja v0.2.55

## Highlights

- Fixed a reinstall that could hang forever: a resource missing from the current index no longer opens an unanswered "update the index?" notification while another command is awaiting it, so a group reinstall cannot stall at its last item and the post-upgrade automatic reinstall cannot stall invisibly.
- Removed the duplicate destination from the install target picker. `User Profile` and `Global Resource Home` are no longer listed separately when they resolve to the same folder, which is the case for skills, hooks, MCP configs, plugins, and Cursor rules.
- Restored two legacy setting names. `resourceNinja.includeLocalSkills` and `resourceNinja.autoUpdateSkillsOnUpgrade` were unreachable because their replacements declare a default and `WorkspaceConfiguration.get` answers with that default instead of reporting the key as unset.
- Stopped rewriting the managed instruction file and the reference catalogs when their bytes have not changed, so a refresh no longer churns modification times, file watchers, and folder sync.
- Generated writes now keep the target file's line endings. The instruction and catalog writers convert only when the file uses a single ending, so a file that already mixes them keeps every line this extension does not own.
- The bundled resource index is parsed once per extension host instead of on every command path, with the parse revalidated against the file's size and timestamp and a failed read retried rather than cached.

## Compatibility

- `resourceNinja.refCatalogFormat` remains supported and unchanged.
- `resourceNinja.useSharedSourcesManifest` and `resourceNinja.useSharedResourceIndex` remain off by default.
- The shared lock payload, stale windows, heartbeat, and reclaim naming remain aligned with the skill-only sibling extension.
- Public raw GitHub content remains anonymous-first; authenticated escalation still requires an exact Contents API URL from the owning caller.
- Legacy setting names keep their previous meaning; the current name still wins whenever it is set at any scope.
- Resource Index remains v1.28.0 with 2653 resources across 24 sources.

## Verification

- TypeScript compile, ESLint and production build: PASS
- Offline resource regression suite: 94/94 PASS, 3 network tests skipped
- Upstream catalog suite: 97/97 PASS, 0 skipped
- Extension Host smoke test: 1/1 PASS
- Runtime and full dependency audits: 0 vulnerabilities
- Marketplace PAT preflight: PASS for publisher `yamapan`
- Mutation guards proved against the real source: awaited-notification callers, cross-key setting fallbacks, unconditional instruction writes, and mirror detection

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.55.vsix`
- Size: 513,683 bytes
- SHA256: `87C5DC4000860C1C2D91B0358E3BE49234BE52C3E0FAE422305CD72DE5BDCD8D`
- Payload: 12 files, no `src`, `scripts`, `test`, `.github`, `.vscode`, sourcemap, or release-note content
