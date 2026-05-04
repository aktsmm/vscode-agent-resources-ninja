# v0.2.0 - Initial Public Release

## Highlights

- Multi-kind resource management for skills, agents, prompts, instructions, hooks, and MCP config resources.
- Workspace Resources, User / Global Resource Home, and Remote Resources views.
- Expanded bundled preset catalog: 2418 resources across 22 sources.
- Official and curated sources include GitHub Awesome Copilot, MicrosoftDocs Agent Skills, GitHub Copilot for Azure Plugin Skills, Microsoft Azure Skills Plugin, AWS Labs Agent Plugins, Elastic Agent Skills, Gemini CLI, Codex, Claude Code, Cline, Goose, and more.
- GitHub Awesome Copilot plugin resources are browsable through both distribution-ready top-level resource paths and raw `plugins/` paths so users can discover and install them by plugin or by resource kind.
- Microsoft Azure Skills Plugin resources from `microsoft/azure-skills` are bundled with top-level skill paths plus the Azure MCP config as a safe reviewable MCP resource.
- The Microsoft Azure Skills Plugin bundle is selectable and includes skills plus the Azure MCP config; MCP files are copied for review and are not auto-activated.
- README source guidance now distinguishes Copilot for Azure plugin-embedded skills from the top-level Microsoft Azure Skills Plugin distribution to reduce duplicate-name confusion.
- Search results disambiguate duplicate resource names with friendly source names and source/path details, while tied results prefer distribution-ready top-level paths over embedded plugin paths.
- Generic MCP config names such as `mcp.json` and `.mcp.json` install with a source prefix to avoid cross-source overwrite collisions.
- Bundle-facing UI is now described as install sets, plugin path grouping is shown as plugin contents / plugin-derived resources, and Remote plugin groups can be installed through the same selectable checklist flow.
- Create Resource and Settings actions are available from every resource view; instruction index open/update actions are available from Workspace Resources and User / Global Resource Home.
- Instruction-file creation prompts are localized, User / Global skill deletion and plugin cleanup refresh instruction indexes when needed, and hook plugin cleanup removes the hook folder rather than leaving README-sidecar remnants.
- Create Resource previews and actual creation paths now honor the same configured Workspace, User Profile, and Global Resource Home roots used by install and scan paths.
- User-facing labels now use Global Resource Home for the shared resource root (`~/.copilot` by default, or `~/.claude`, `~/.agents`, or a custom path) while preserving existing setting keys.
- Create Resource templates now safely quote YAML frontmatter values, normalize generated body text, and escape MCP server keys so punctuation, quotes, and newlines in user input do not corrupt generated files.
- Create Resource now stops cleanly when the description prompt is canceled, shows workspace destination roots directly instead of stripping example filenames, and reports file creation failures with localized error messages.
- Create Resource now validates resource name slugs, final destination path length, and description length before writing files, with localized guidance and an MCP-specific placeholder.
- Workspace and User / Global resource views expose plugin-installed resources by plugin and support deleting the installed plugin resources as a group.
- Bundle install failures now offer to refresh the affected source index, which helps recover when upstream plugin paths or generated skills are renamed.
- Bundle install progress now closes cleanly before showing any failure/recovery prompt, preventing stuck progress notifications on partial failures.
- Recently installed badges now appear for all resource kinds and install targets, including Workspace, User Profile, and Global Resource Home resources.
- User Profile `.agent.md` installs now default to the VS Code User `prompts` folder so custom agents appear in the agent picker.
- Workspace-default double-click install, with configurable default target and explicit target picker from the context menu.
- Resource-kind-aware install paths for Workspace, User Profile, Global Resource Home, and Custom targets.
- Configurable install/scan roots for Workspace non-skill resources, User Profile resources, and selectable Global Resource Home presets.
- Global Resource Home presets cover GitHub Copilot/Copilot CLI (`~/.copilot`), Claude-compatible resources (`~/.claude`), open agent resources (`~/.agents`), and custom overrides.
- Copilot CLI local instructions can now use `~/.copilot/copilot-instructions.md` as the Agent Skills index sync target, and Global Resource Home instruction targets index Global Resource Home skills.
- Global Resource Home routing now handles home-relative Copilot CLI instruction targets, external absolute custom targets, mixed-case paths, mixed path separators, trailing slashes, and sibling-prefix path boundaries safely.
- Settings documentation now explains the workflow-oriented setting groups and makes `globalHomeDirectory` override precedence explicit.
- Settings ordering puts default install behavior and destination roots before secondary sync/display options.
- Settings order values and README tables now match the install/destination-first UX exactly.
- Reset Settings is available from every resource view and resets every non-secret Resource Ninja setting; Open Instruction File shows the resolved target path and offers a Settings fallback for disabled or missing global/compatibility instruction targets.
- Reset Settings now uses a warning icon, ellipsis label, and modal confirmation for destructive resets; the GitHub token setting uses password-style input in VS Code Settings.
- Edit When To Use and manual instruction updates show the configured instruction target, avoiding AGENTS.md-only wording when using Copilot CLI, repository, Claude, Cursor, Windsurf, Cline, or custom instruction files.
- Manual instruction updates no longer report success when instruction sync is disabled; Edit When To Use distinguishes metadata-only saves from generated Agent Skills index updates.
- Report a Bug is reachable from every resource view toolbar, with Settings, Reset Settings, and Support actions grouped consistently.
- Localization UX tests now cover EN/JA key parity, placeholder parity, command label safety, Global Resource Home wording, MCP safety copy, and resource-oriented preview text.
- Context-only commands and the legacy Create Skill alias are hidden from the Command Palette while remaining available from views and compatibility paths.
- GitHub token guidance no longer preselects or requires broad repository scopes for public resource browsing; settings and README now recommend leaving scopes unchecked unless private repositories are intentionally indexed.
- README and README_ja now match the manifest for Agent Mode tool count, `#localizeResource`, MCP config resource coverage, and resource-oriented preview wording.
- Included source tables now render all 22 bundled sources inside the table, including `qdhenry/Claude-Command-Suite`, and are checked against the bundled index.
- First-run empty views now show localized safe next actions for Workspace Resources, User / Global Resource Home, and Remote Resources.
- User / Global Resource Home now opens and updates the product-native global instruction file for the selected Global Resource Home preset instead of reusing the workspace instruction target.
- Settings copy was polished for release: Output Format labels no longer use emoji or `OLD`, and Instruction File choices show the exact target paths.
- User / Global Resource Home toolbar tooltips now explicitly say Open/Update Global Instruction File.
- Startup activation was removed; the extension now activates lazily from contributed views, commands, Chat participant use, and Language Model Tool use.
- Command Palette now keeps context-only or destructive actions out of the top-level list while preserving them in the relevant resource views.
- MCP config installs can now either stay staged for review or explicitly merge compatible servers into workspace `.vscode/mcp.json` with conflict confirmation and backup.
- Release hygiene was tightened with broader `.gitignore` / `.vscodeignore` coverage and stale local artifacts removed.
- Configured external and home-relative Workspace resource roots are scanned and uninstalled consistently.
- Copilot Chat generated Ask, Explore, and Plan agents are treated as built-in read-only resources.
- Built-in resources are centralized in User / Global Resource Home and grouped by VS Code, GitHub Copilot Chat, or GitHub Copilot CLI origin.
- Built-in detection covers Copilot Chat globalStorage, bundled `assets/prompts` `/create-*` skills, VS Code app roots, and versioned Copilot CLI `builtin-*` layouts to tolerate future additions.
- Built-in scanning limits extension `skills` roots to VS Code bundled extensions and avoids Node-only `path` / `Buffer` APIs in the scanner.
- Installed non-skill resources preserve source labels instead of showing `installed from unknown` after double-click installs.
- Legacy missing source metadata now displays as `installed` instead of `installed from unknown`.
- Skill-entry-only actions and generated instruction empty states use clearer wording around When To Use and native non-skill resource views.
- Stable installed display names for non-skill remote resources via sidecar metadata.
- User / Global Resource Home can delete non-built-in resources from the context menu; built-ins remain read-only.
- Safer Workspace Resources context menus that separate skill-only actions from generic resource actions.
- Settings screen copy now clearly separates Agent Skills index sync from native agents/prompts/instructions/hooks paths.
- Chat and Agent Mode list commands now show multi-kind workspace resources.
- Agent Mode uninstall can remove non-skill workspace resources and avoids ambiguous deletes.
- Skill-only bulk actions stay hidden until installed skills exist.
- QuickPick search now supports resource-kind filtering and ranks stronger matches before source-type preference.
- Selectable plugin bundle install now asks for resource selection and install target selection. Hook resources and MCP config resources can participate in the same safe checklist flow; MCP config files are copied for review and are not auto-merged into `.vscode/mcp.json`.
- Workspace scanning excludes `.vscode-test` archives even when built-in resources are visible, so test-only VS Code SKILL copies do not pollute Workspace Resources.
- Bundle resource selection uses resource-kind icons and calls out that MCP config resources are copied for review without auto-activation.
- Release packaging hygiene was reviewed: `.vscode-test`, `.hiker`, scripts, tests, local planning notes, and release drafts are excluded from the VSIX payload.
- The README demo GIF is served from GitHub raw content, keeping the VSIX payload small while preserving Marketplace visuals.
- Output Channel diagnostics, duplicate pruning, path-filtered official presets, and broad regression coverage.

## Verification

- `npm run compile`
- `npm run test:resources`
- `node scripts/test-*.js`
- `node scripts/test-skill-search.js`
- `node scripts/test-global-home-routing.js` (19 path/config/UI copy patterns)
- `node scripts/test-azure-plugin-source.js`
- `node scripts/test-azure-skills-source.js`
- `npm run package`
- `npm test` was attempted, but the local VS Code test harness is currently blocked by `Code is currently being updated. Please wait for the update to complete before launching.` across cached 1.117.0, 1.118.0, and 1.118.1 test builds.
- `npm audit --audit-level=moderate`
- `npx vsce package --no-dependencies`
- VSIX expanded manifest and payload inspection

## Artifact

- File: `agent-resources-ninja-0.2.0.vsix`
- Size: 287,311 bytes
- SHA256: `9E77358F4DCE0E8FB5FE61999F6EAE21D4364EA7BE8417C31E24DE7DB4FC0652`

## Notes

- Non-skill reinstall remains intentionally hidden until source metadata is stored for agents, prompts, instructions, hooks, and MCP config resources.
