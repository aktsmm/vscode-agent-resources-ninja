# v0.2.7 - One-click install for every resource kind

## Highlights

- **Universal one-click install**: Click and double-click installs in Remote Resources now apply to every resource kind, including agents, instructions, prompts, hooks, MCP config, plugin manifests, and Cursor rules.
- **Predictable MCP click installs**: MCP config resources install as a copy-only review file under the Workspace MCP Directory on click / double-click. Merging into `.vscode/mcp.json` is reserved for the explicit Install Resource context menu action.
- **Merge-aware MCP uninstall**: When you uninstall an MCP config that was merged into `.vscode/mcp.json`, Resource Ninja shows an explicit modal to also remove the matching server entries with a backup before deletion.
- **Hook static diagnostics in resource rows**: Hook rows display configured / not configured status, config source, registered events, and missing-script warnings. No hook is ever executed.
- **MCP lifecycle status in resource rows**: Installed MCP config resources show staged / merged / Needs review status in row description and tooltip.
- **Installed badge for every resource kind**: Remote rows show Installed / Recently installed badges and check icons for agents, hooks, MCP, plugin, and Cursor rule resources, not only skills.

## Fixes

- MCP default click no longer prompts the activation picker; the picker is reserved for the explicit Install Resource command.

## Tests

- Added `scripts/test-representative-flows.js` covering install path, idempotent reinstall, uninstall path, click-install command, MCP copy-only default click, hook static diagnostics surfacing, and merged MCP uninstall confirmation for every resource kind.
- Extended `test-mcp-config-merge.js` and `test-hook-config.js` to cover the merge-aware uninstall helper, lifecycle status helpers, and hook diagnostics output.
- Verified `npm run check-types`, `npm run lint`, `npm run test:resources`, `npm test`, and `npm audit --audit-level=moderate`.

## VSIX

| Item   | Value                                                              |
| ------ | ------------------------------------------------------------------ |
| File   | `agent-resources-ninja-0.2.7.vsix`                                 |
| Size   | 297.82 KB (304,966 bytes), 14 files                                |
| SHA256 | `B2051B104D9829588C456506D5240B6D4BDF4EAE211651A29083300DE53BBB11` |
