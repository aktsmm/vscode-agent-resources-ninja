# Agent Resources Ninja v0.2.44

## Highlights

- Added Native Agent Plugin lifecycle across VS Code / GitHub Copilot Chat, GitHub Copilot CLI, standalone Claude Code CLI, Codex CLI, and Cursor local plugins. Claude Code and Codex extension-only environments retain official UI handoffs.
- Added per-host Installed, version, Enabled/Disabled, Not installed, and unavailable/error state in the host picker. Installed hosts route to manage, remove, or reinstall actions instead of repeating an install label.
- Added one-use approved mutation execution bound to executable realpath/version, argv, working directory, sanitized environment, source identity, and target paths. Marketplace alias ownership is verified before install, management, cleanup, and rollback.
- Added the official `github/copilot-plugins` catalog as a filtered source and refreshed drifted sources. Resource Index v1.28.0 now contains 2648 resources across 24 sources; external marketplace entries remain metadata instead of becoming false local resources.
- Fixed nested plugin ownership and plugin hook config installs. Generic `hooks.json` resources are namespaced to `<plugin>-hooks.json`, written as single files, and no longer collide across sources or invoke directory-backed hook lifecycle management.
- Added architecture-aware Codex WinGet fallback. When the shell alias is absent, the extension can use the official WinGet link or package executable, display its provenance, and offer a Windows-only copy command for troubleshooting without running it automatically.
- Registered installed Agent Plugin folders through `chat.pluginLocations` on supported VS Code builds and remove only the matching registrations when a plugin package is deleted.

## Compatibility

- `resourceNinja.refCatalogFormat` remains supported and unchanged. Existing generated reference catalogs keep their configured format.
- `resourceNinja.registerPluginLocation` defaults to `prompt`; `always` and `never` remain available.
- `resourceNinja.defaultPluginHost` defaults to `auto`; explicit User preferences affect ordering, while Workspace values are suggestions only.
- Resource Index freshness remains 2026-07-30 because the catalog addition used a source-filtered scan. All live upstream contract tests pass.

## Verification

- `npm run compile`: PASS
- `npm run test:resources`: PASS (`74/74`, 3 network tests skipped by the offline gate)
- `npm run test:upstream`: PASS (`77/77`, no skips; Git transport fallbacks covered GitHub API 403 rate limits)
- `npm test`: PASS (`1/1` Extension Host smoke)
- `npm run audit:runtime`: PASS (0 vulnerabilities)
- Raw installability, no-new-collision, release hygiene, README/CHANGELOG, manifest consistency, bundle, MCP metadata, and diff checks: PASS
- Full development audit: guarded at 9 high advisories in development-only lint/test tooling (`brace-expansion`, `js-yaml` through ESLint/Mocha); the packaged runtime dependency audit is clean, and the available complete fix requires a breaking ESLint 10 upgrade.
- Packaged VSIX install: PASS in a fresh isolated `--user-data-dir` / `--extensions-dir` profile (`yamapan.agent-resources-ninja@0.2.44`)
- Exact extracted VSIX bits Extension Host smoke: PASS (`1/1`, core commands registered)

## Artifact

- VSIX: `artifacts/vsix/agent-resources-ninja-0.2.44.vsix`
- Size: 465,997 bytes
- SHA256: `4F9A226396AB2019794E318F9C4C6974CF502798895F4A6045FB24DCE878D695`
- Payload: 12 files; `extension/dist/extension.js`, package metadata, icons, and Resource Index present; no source maps, development directories, or release notes
