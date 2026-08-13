# Agent Resources Ninja v0.2.43

## Highlights

- Agent Plugins 1.0.0 packages are recognized. A `plugin.json` is recorded as the `agent-plugins` manifest kind only when it declares the canonical `$schema` and satisfies the manifest rules the specification makes fatal, including the `name` character, length, and boundary constraints. The schema value is compared as a string and never fetched, because the specification forbids retrieving it while a plugin is loaded.
- A manifest that declares the Agent Plugins schema but breaks one of those rules keeps the plain `plugin` kind, stays in the catalog, and carries a `[Agent Plugins 1.0.0: <reason>]` prefix on its description, so an install is never offered as conformant when a conformant client would reject the whole plugin.
- Plugin manifests are found at any depth instead of only at the repository root, so a `plugins/<name>/plugin.json` layout is indexed as its own package rooted at that directory. A plugin's `.mcp.json` and a `hooks.json` at the plugin root are indexed as MCP config and hook resources.
- Downloads stay inside the resource being installed. Names come from third-party repositories, and a name such as `..\..\..\evil.txt` is a single valid file name in git that turns into real separators on Windows. Every remote entry name is now checked before it becomes a local path, each resolved destination is asserted to stay inside the download root, and a rejected entry marks the install incomplete instead of reporting success.
- Filesystem paths are never read from file content. A repository could previously ship its own `.skill-meta.json`, and the path it claimed survived into stored metadata and reached a recursive delete on the next reinstall. Such sidecars are no longer written during a download, every reader recomputes the path from where the scan actually found the file, and every recursive delete now refuses to run when its target resolves outside the root that operation is allowed to touch.
- The bundled resource index carries 2572 resources, picking up `azure-kubernetes-app-deploy` that the upstream `microsoft/azure-skills` repository added after the previous scan.

## Settings

- No settings were added or removed in this release. The `resourceNinja.refCatalogFormat` setting and its default behavior are unchanged.

## Verification

- `npm run compile`: PASS
- `npm run test:resources`: PASS (62/62 executed, 2 network tests skipped by design)
- `npm run test:upstream`: PASS (64/64 including the live upstream catalog check)
- `npm test`: PASS (Extension Host smoke 1/1)
- `npm run audit:runtime`: PASS (0 vulnerabilities)
- Full development audit: guarded; the remaining advisories report no patched version and do not affect packaged runtime dependencies.

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.43.vsix`
- Size: 385,133 bytes (376.11 KB)
- SHA256: `8594A7FDFE25E6B1FB914B1919C607EFA34584D6FF047C195053FBB5C841A00D`
- Payload: 12 files (manifest, localization, LICENSE, README, CHANGELOG, bundled `dist/extension.js`, icons, resource index). No sources, tests, sourcemaps, or internal documents are included.
