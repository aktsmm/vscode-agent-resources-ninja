# 🥷 Agent Resources Ninja

<p align="center">
  <strong>Search, Install, and Manage Agent Resources for AI Coding Assistants</strong>
</p>

> Agent Resources Ninja is a new resource-oriented VS Code extension for managing skills, agents, prompts, instructions, hooks, and related AI coding resources.

It gives you three practical views for everyday resource management: **Workspace Resources** for project files, **User / Global Resource Home** for machine-wide customizations, and **Remote Resources** for bundled and GitHub sources. Install targets are explicit, MCP config files are staged before any optional merge, and built-in VS Code / Copilot resources stay read-only.

> **License notice**: This extension is distributed under CC BY-NC-SA 4.0. Non-commercial use is allowed; commercial use requires permission. See [LICENSE](LICENSE).

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=yamapan.agent-resources-ninja">
    <img src="https://img.shields.io/badge/VS%20Code-Marketplace-007ACC?style=for-the-badge&logo=visual-studio-code&logoColor=white" alt="VS Code Marketplace">
  </a>
  <a href="https://github.com/aktsmm/vscode-agent-resources-ninja/blob/master/LICENSE">
    <img src="https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey?style=for-the-badge" alt="License CC BY-NC-SA 4.0">
  </a>
  <a href="https://github.com/aktsmm/vscode-agent-resources-ninja">
    <img src="https://img.shields.io/badge/GitHub-Source-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub">
  </a>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=yamapan.agent-resources-ninja">
    <img src="https://img.shields.io/badge/Install%20Now-VS%20Code%20Marketplace-007ACC?style=for-the-badge&logo=visual-studio-code&logoColor=white" alt="Install from VS Code Marketplace">
  </a>
</p>

<p align="center">
  <b>GitHub Copilot • Claude Code • Cursor • Windsurf • Cline</b>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#installation">Installation</a> •
  <a href="#usage">Usage</a> •
  <a href="#copilot-chat">Copilot Chat</a> •
  <a href="#settings">Settings</a> •
  <a href="#development">Development</a>
</p>

<p align="center">
  <a href="https://github.com/aktsmm/vscode-agent-resources-ninja/blob/master/README_ja.md">Japanese / 日本語版はこちら</a>
</p>

## 🥷 Features

### 🧭 Resource Management

- Browse **Workspace Resources**, **User / Global Resource Home**, and **Remote Resources** from the Activity Bar
- Manage multiple resource kinds: skills, agents, prompts, instructions, hooks, MCP config resources, plugin manifests, and Cursor rules
- Browse remote resources by source or by Resource Type
- Inspect user/global resources from VS Code User Data and the selected Global Resource Home
- Choose explicit install targets: Workspace, User Profile, Global Resource Home, or Custom

### 📁 Local Resource Management

- Auto-detect skills, agents, prompts, instructions, hooks, MCP config resources, plugin manifests, and Cursor rules in workspace
- Automatically sync detected workspace skills to the generated instruction index (with `resourceNinja.includeLocalResources` setting)
- Manual register / unregister commands for local workspace skills
- Create new skills, agents, prompts, instructions, hooks, and MCP config resources from templates
- Create Resource and Settings actions are available from every resource view; instruction index open/update actions are available from Workspace Resources and User / Global Resource Home.
- Create Resource uses the same configured Workspace, User Profile, and Global Resource Home roots as install/scan paths, so the previewed destination matches the created file.

### 🔍 Resource Search & Discovery

- Search resources by keyword (local & GitHub)
- Filter QuickPick search results by resource kind: skills, agents, instructions, prompts, hooks, MCP config resources, plugins, or Cursor rules
- **Install Sets** are curated, selectable install groups. **Grouped by Plugin** shows plugin package manifests and their indexed child resources together; each child resource also remains visible under its own resource kind with plugin origin shown in the row details.
- Remote rows show installed state in text and color for every resource kind, including agents, hooks, MCP config resources, plugins, and Cursor rules.
- MCP config rows distinguish review copies from `.vscode/mcp.json` merges with staged / merged status in row details and tooltips.
- Hook rows show static configuration diagnostics such as configured / not configured status, config source, events, and missing script warnings. Agent Resources Ninja does not run hooks.
- **Multi-keyword Search** - Scored by name, path, description relevance
- **Parallel Fetch** - Fast results with 50 concurrent requests
- **Fallback Search** - Auto-retry with fewer keywords if no results
- Search results with descriptions & category tags
- Star counts & organization badges
- Install / Preview / Favorite directly from search results

### 📦 Install & Manage

- One-click default install applies to every resource kind: skills, agents, instructions, prompts, hooks, MCP config, plugin manifests, and Cursor rules. Click and double-click installs use **Default Install Target**; the context menu **Install Resource** still asks for a target and supports Custom.
- Click and double-click installs of MCP config resources copy the file to the Workspace MCP Directory for review without modifying `.vscode/mcp.json`. To merge compatible servers into `.vscode/mcp.json`, use the context-menu **Install Resource** action and pick the merge option; existing server keys always require overwrite confirmation.
- Uninstalling an MCP config that has been merged into `.vscode/mcp.json` shows an explicit modal to also remove the matching server entries with a backup before deletion.
- Installed MCP config resources continue to show whether they are only staged for review or already represented in `.vscode/mcp.json`.
- Installed hook resources show whether their recommended entries are present in root `hooks.json` and whether referenced scripts are missing; diagnostics are static checks only, not hook execution.
- Plugin manifest resources install as managed copies under `.github/plugins/<plugin>` or Global Resource Home `plugins/<plugin>`. Hooks, executable assets, and MCP config included in a plugin are copied for review and are not run or activated automatically.
- Auto-update the generated instruction block in instruction files (AGENTS.md / copilot-instructions.md / CLAUDE.md) when resources change
- **Table Format** - Skill entries displayed in a generated table with a "When to Use" column
- **Auto-extract "When to Use"** - Extracted from SKILL.md `## When to Use` section
- **Edit Description** - Right-click installed skills to customize the instruction-file description
- Uninstall workspace and user/global resources from the relevant resource view
- **Reinstall All Workspace Skills** - Batch reinstall installed workspace skills from latest source metadata (with auto index update)
- **Reinstall Resource Groups** - Right-click a Workspace Resources kind group, such as Skills or Agents, to reinstall all installed resources in that group that were downloaded from remote sources
- **User / Global Reinstall** - User / Global Resource Home also exposes per-resource reinstall for remote-installed rows and group reinstall for kind and plugin groups, so plugin-managed resources can be refreshed from either installed view
- **Install Feedback** - NEW badge, status bar notification, auto-select in tree view
- **Open Folder** - Quick access to installed resource folder
- **Index Integrity Check** - Auto-detect missing resources and prompt for index update

### 🔧 Multi-Tool Support

- **Auto-detection** of AI tools in workspace (Cursor, Windsurf, Cline, Claude Code, GitHub Copilot)
- Automatic format selection based on detected tool
- Manual override available in settings
- Supported output formats:
  - Markdown (AGENTS.md, CLAUDE.md, copilot-instructions.md)
  - Cursor Rules (.cursor/rules/)
  - Windsurf Rules (.windsurfrules)
  - Cline Rules (.clinerules)

### 💬 GitHub Copilot Chat Integration

- `@resources` commands for direct chat operations
- `/search`, `/install`, `/list`, `/recommend`
- Project-based resource recommendations

### 🤖 MCP Tools Integration

- Automatically available as tools in **Agent Mode**
- **9 Tools**: `#searchResources`, `#installResource`, `#uninstallResource`, `#listResources`, `#recommendResources`, `#updateResourceIndex`, `#webSearchResources`, `#addResourceSource`, `#localizeResource`
- Trust badges (Official / Curated / Community)
- Auto-update instruction file for skill installs where applicable

### 🌐 Multi-language & UI

- Japanese / English UI (auto-detect + manual switch)
- Resource preview in Webview
- Favorites feature

## 🎬 Demo

![Demo](https://raw.githubusercontent.com/aktsmm/vscode-agent-resources-ninja/master/docs/screenshots/demo.gif)

## 📥 Installation

### VS Code Marketplace

```
ext install yamapan.agent-resources-ninja
```

Or search for **"Agent Resources Ninja"** in VS Code Extensions (`Ctrl+Shift+X`)

### Manual Installation

1. Download `.vsix` from [Releases](https://github.com/aktsmm/vscode-agent-resources-ninja/releases)
2. In VS Code: `Ctrl+Shift+P` → `Extensions: Install from VSIX...`
3. Select the downloaded `.vsix` file

## 📚 Included Resource Sources

Preset index includes skills, agents, prompts, instructions, hooks, MCP config resources, plugin manifests, and Cursor rules from official, curated, and community sources out of the box.

| Source                                                                                                                        | Type      | Description                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------- |
| [anthropics/skills](https://github.com/anthropics/skills)                                                                     | Official  | Anthropic official Claude Skills                                                |
| [openai/skills](https://github.com/openai/skills)                                                                             | Official  | OpenAI official Codex Skills (1.7k+)                                            |
| [github/awesome-copilot](https://github.com/github/awesome-copilot)                                                           | Official  | GitHub official Copilot resources, including plugin-published skills and agents |
| [cursor/plugins](https://github.com/cursor/plugins)                                                                           | Official  | Cursor official plugin manifests, skills, agents, and rules                     |
| [MicrosoftDocs/Agent-Skills](https://github.com/MicrosoftDocs/Agent-Skills)                                                   | Official  | Microsoft official Azure agent skills                                           |
| [microsoft/GitHub-Copilot-for-Azure](https://github.com/microsoft/GitHub-Copilot-for-Azure)                                   | Official  | GitHub Copilot for Azure plugin skills                                          |
| [microsoft/azure-skills](https://github.com/microsoft/azure-skills)                                                           | Official  | Microsoft Azure Skills plugin resources, including Azure skills and MCP config  |
| [awslabs/agent-plugins](https://github.com/awslabs/agent-plugins)                                                             | Official  | AWS Labs agent plugin skills                                                    |
| [elastic/agent-skills](https://github.com/elastic/agent-skills)                                                               | Official  | Elastic official agent skills                                                   |
| [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli)                                                       | Official  | Gemini CLI official skills                                                      |
| [openai/codex](https://github.com/openai/codex)                                                                               | Official  | Codex repository skills                                                         |
| [anthropics/claude-code](https://github.com/anthropics/claude-code)                                                           | Official  | Claude Code plugin skills                                                       |
| [cline/cline](https://github.com/cline/cline)                                                                                 | Official  | Cline repository skills                                                         |
| [aaif-goose/goose](https://github.com/aaif-goose/goose)                                                                       | Official  | Goose repository skills from AAIF                                               |
| [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills)                                       | Curated   | Curated Claude Skills list                                                      |
| [Code-and-Sorts/awesome-copilot-agents](https://github.com/Code-and-Sorts/awesome-copilot-agents)                             | Curated   | Copilot agents, instructions, prompts, and skills                               |
| [obra/superpowers](https://github.com/obra/superpowers)                                                                       | Community | Superpowers plugin manifests and plugin-derived skills                          |
| [glittercowboy/taches-cc-resources](https://github.com/glittercowboy/taches-cc-resources)                                     | Community | Claude Code resources and skills                                                |
| [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering) | Community | Context Engineering skills (5k+)                                                |
| [danielmiessler/Personal_AI_Infrastructure](https://github.com/danielmiessler/Personal_AI_Infrastructure)                     | Community | PAI Packs - Skills & Features                                                   |
| [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin)                               | Community | Compound Engineering (3.5k+)                                                    |
| [Wirasm/PRPs-agentic-eng](https://github.com/Wirasm/PRPs-agentic-eng)                                                         | Community | PRP (Prompt Recipe Patterns)                                                    |
| [qdhenry/Claude-Command-Suite](https://github.com/qdhenry/Claude-Command-Suite)                                               | Community | Claude commands & skills                                                        |

Azure appears through two official Microsoft sources. `microsoft/GitHub-Copilot-for-Azure` indexes plugin-embedded skills from the Copilot for Azure repository, while `microsoft/azure-skills` indexes the top-level Azure Skills Plugin distribution and its Azure MCP config. The Azure Skills bundle is selectable: skills can be installed together, and the MCP config can be copied for review or explicitly merged into `.vscode/mcp.json`.

Cursor official plugins and Superpowers are indexed both as plugin manifest resources and as individual plugin-contained resources such as skills, agents, rules, hooks, and MCP config when present. Installing a plugin resource creates a managed copy for review; it does not run plugin hooks or merge MCP configuration without a separate explicit action.

When two sources provide the same resource name, search results show the friendly source name and add source/path details for duplicates. Distribution-ready top-level paths are listed ahead of embedded plugin paths when relevance is otherwise tied.

Generic MCP config file names such as `mcp.json` and `.mcp.json` are installed with a source prefix, for example `microsoft-azure-skills-mcp.json`, to avoid overwriting MCP configs from another source. MCP files are copied first, and merging into `.vscode/mcp.json` is an explicit install-time choice with backup and overwrite confirmation.

> Use `Update Index` to refresh the latest resources and metadata from these sources.
> Official product and plugin repositories are path-filtered so bundled presets include distribution-ready resource roots and selected plugin manifests, not samples or test fixtures.
> For `github/awesome-copilot`, resources published from `plugins/` are indexed from distribution-ready top-level resource paths when available, avoiding duplicate raw plugin paths.
> Files nested under a directory-based `SKILL.md` root are treated as internal skill contents, so helper prompts or instructions in a skill's `templates` folder do not appear as separate Remote Resources.

## 🥷 Usage

### Sidebar Operations

1. Click the **spiral shuriken icon** in the Activity Bar
2. **Workspace Resources** - Installed & local resources list

- Groups resources by kind: skills, agents, instructions, prompts, hooks, and MCP config resources
- Installed workspace resources with the same display name used in Remote Resources
- Local workspace skills that can be registered in the generated instruction index
- Built-in VS Code / Copilot resources are centralized in **User / Global Resource Home** to avoid duplicating environment resources in the workspace list
- Create new skills, agents, instructions, prompts, hooks, or MCP config resources from the toolbar
- Choose Workspace, User Profile, Global Resource Home, or a custom folder when creating resources
- Newly installed resources (temporary badge)
- Toolbar: Instruction File / Create / Refresh / Settings
- Remote-installed resource rows expose per-resource reinstall from the inline action buttons
- Skill-only bulk commands remain available from Command Palette or overflow actions for maintenance workflows
- Open resource folder (right-click menu)

3. **User / Global Resource Home** - Browser for this machine

- VS Code User `prompts` (including `.agent.md`), `instructions`, and legacy `agents`
- Global Resource Home resources under the selected preset (`~/.copilot`, `~/.claude`, or `~/.agents`), including product-native instruction files such as `copilot-instructions.md`, skills under `skills/*/SKILL.md`, agents under `agents/`, Copilot hook config files under `hooks/*.json`, and Copilot CLI `mcp-config.json`

- Built-in VS Code / GitHub Copilot Chat / GitHub Copilot CLI resources are hidden by default and can be toggled into source-specific groups, including Copilot Chat `/create-*` prompt skills bundled under `assets/prompts`
- Built-in resources are read-only definitions scanned from known VS Code, GitHub Copilot Chat, and GitHub Copilot CLI locations; they are shown for discovery, not modification.
- Copilot CLI runtime logs, session state, OAuth cache, and restart state under `~/.copilot` are skipped so user-authored resources remain visible even when the CLI home contains many session files.
- Non-built-in User / Global Resource Home resources can be opened, revealed, copied, or deleted from the right-click menu
- Built-in resources are read-only and can never be selected as install targets
- Workspace `.github` resources stay in **Workspace Resources**

4. **Remote Resources** - Browse web resources by source repository
   - **Favorites** section at top

- Toggle between repository-first and resource-type-first layouts from the toolbar
- Repository-first groups by source, then skills, agents, instructions, prompts, hooks, MCP config resources, plugins, and Cursor rules
- Resource-type-first groups by skills, agents, instructions, prompts, hooks, MCP config resources, plugins, and Cursor rules, then source
- Repository sections are ordered Official → Curated → Community
- Shows installed status with green icons and explicit `Installed` row details across all resource kinds
- Double-click install from list; optional single-click install uses the configured default target

### Icon Legend

| Icon               | Meaning                                                |
| ------------------ | ------------------------------------------------------ |
| check (green)      | Installed resource                                     |
| circle (yellow)    | Local resource (not registered in instruction file)    |
| NEW badge          | Recently installed (temporary badge)                   |
| star-full (yellow) | Favorites section                                      |
| verified (blue)    | Official source (Anthropic, OpenAI, GitHub, Microsoft) |
| star (yellow)      | Curated awesome-list                                   |
| repo               | Community repository                                   |

### Command Palette

| Command                                            | Description                                                                    |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| `Agent Resources Ninja: Search Resources`          | Search and install resources                                                   |
| `Agent Resources Ninja: Update Index`              | Update index from all sources                                                  |
| `Agent Resources Ninja: Search on GitHub`          | Search resources on GitHub                                                     |
| `Agent Resources Ninja: Add Source Repository`     | Add new source repository                                                      |
| `Agent Resources Ninja: Remove Source Repository`  | Remove source repository                                                       |
| `Agent Resources Ninja: Uninstall Resource`        | Uninstall a resource                                                           |
| `Agent Resources Ninja: Show Workspace Resources`  | Show workspace resources                                                       |
| `Agent Resources Ninja: Create New Resource`       | Create a local skill, agent, prompt, instruction, hook, or MCP config resource |
| `Agent Resources Ninja: Register Local Resource`   | Register a local skill in the instruction file                                 |
| `Agent Resources Ninja: Unregister Local Resource` | Unregister a local skill from the instruction file                             |
| `Agent Resources Ninja: Reinstall All`             | Reinstall installed skills from latest source metadata                         |
| `Agent Resources Ninja: Uninstall All`             | Uninstall all installed workspace skills (with confirmation)                   |
| `Agent Resources Ninja: Uninstall Multiple`        | Select multiple installed skills to uninstall                                  |
| `Agent Resources Ninja: Reinstall Multiple`        | Select multiple installed skills to reinstall                                  |
| `Agent Resources Ninja: Update Instruction`        | Update instruction file manually                                               |
| `Agent Resources Ninja: Open Resource Folder`      | Open installed resource folder in OS                                           |

### Quick Start

```
1. Ctrl+Shift+P → "Agent Resources Ninja: Search Resources"
2. Enter keywords (e.g., "pdf", "azure", "git")
3. Select resource → Choose action (Install / Preview / Favorite / GitHub)
4. Choose install target from the context menu, or double-click to install to the default target
5. Done! Skill installs can auto-update the matching generated instruction index
```

### Install Targets

| Target               | Best for                                            | Resource placement                                                                                                                                         |
| -------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace            | Project-specific resources                          | Configured workspace directories; defaults to `.github/skills`, `.github/agents`, `.github/instructions`, `.github/prompts`, `.github/hooks`               |
| User Profile         | VS Code user customizations and shared skills/hooks | Agents and prompts use VS Code User `prompts` by default; instructions use VS Code User `instructions`; skills/hooks use the selected Global Resource Home |
| Global Resource Home | Shared resources for Copilot CLI, Claude, or agents | Selected preset (`~/.copilot`, `~/.claude`, `~/.agents`) or override, with kind-specific subfolders                                                        |
| Custom               | Manual placement                                    | Chosen folder                                                                                                                                              |

The install picker shows a destination preview for the selected resource kind before writing files. Built-in VS Code / Copilot resources are scan-only and are never used as install targets.

### Search Tips 💡

| Example            | Effect                                 |
| ------------------ | -------------------------------------- |
| `azure`            | Keyword search                         |
| `azure devops`     | Multiple keywords, ranked by relevance |
| `username keyword` | First word searched as username        |
| `user:anthropics`  | Explicit user search                   |
| `repo:owner/repo`  | Repository search                      |

> If no results found, keywords are automatically reduced and retried.

## 💬 Copilot Chat

Use `@resources` in GitHub Copilot Chat for resource operations:

```
@resources /search MCP server      # Search resources
@resources /install github-mcp     # Install a resource
@resources /list                   # List workspace resources
@resources /recommend              # Project-based recommendations
@resources what tools for Python?  # Natural language search
```

### Commands

| Command           | Description                        |
| ----------------- | ---------------------------------- |
| `/search <query>` | Search resources by keyword        |
| `/install <name>` | Install a resource                 |
| `/list`           | List workspace resources           |
| `/recommend`      | Recommendations based on workspace |

> Search results include install buttons for direct installation

## 🤖 MCP Tools (Agent Mode)

In GitHub Copilot's **Agent Mode**, tools are automatically available.

### Tool List

| Tool Reference         | Description                       |
| ---------------------- | --------------------------------- |
| `#searchResources`     | Search resources by keyword       |
| `#installResource`     | Install a resource                |
| `#uninstallResource`   | Uninstall a resource              |
| `#listResources`       | List workspace resources          |
| `#recommendResources`  | Get project-based recommendations |
| `#updateResourceIndex` | Update resource index             |
| `#webSearchResources`  | Web search resources on GitHub    |
| `#addResourceSource`   | Add new resource source           |
| `#localizeResource`    | Localize resource descriptions    |

### Usage Examples

```
💬 "Find Azure-related resources"
  → #searchResources automatically invoked, displays results

💬 "Install the bicep-mcp resource"
  → #installResource installs, auto-updates instruction file

💬 "Search GitHub for MCP servers"
  → #webSearchResources searches GitHub repositories

💬 "What resources would you recommend for this project?"
  → #recommendResources analyzes workspace and recommends
```

### Features

- **Trust Badges**: Shows Official / Curated / Community
- **Recommended Resources**: Suggests best resources from search results
- **Index Update Info**: Shows last update date with warnings if outdated
- **Settings Integration**: Respects `resourceNinja.autoUpdateInstruction` / `resourceNinja.includeLocalResources`
- **Token Efficiency**: Save conversation context by using MCP tools

### Disable MCP Tools

If you don't need MCP tools, you can disable them from GitHub Copilot Chat:

1. Copilot Chat panel → Settings → Tools
2. Toggle off "Agent Resources Ninja" tools

## ⚙️ Settings

Settings are ordered by the workflow users usually follow:

| Group                   | Settings                                                                                                                         | Purpose                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Install behavior        | `defaultInstallTarget`, `singleClickInstall`                                                                                     | Decide where click installs go                                            |
| Workspace roots         | `resourcesDirectory`, `workspace*Directory`                                                                                      | Project-specific resources tracked with the workspace                     |
| User roots              | `user*Directory`                                                                                                                 | VS Code User Profile agents, prompts, and instructions                    |
| Global Resource Home    | `globalResourceHomePreset`, `globalHomeDirectory`                                                                                | Shared resources for Copilot CLI, Claude-compatible tools, or open agents |
| Instruction sync        | `autoUpdateInstruction`, `instructionFile`, `customInstructionPath`, `includeLocalResources`, `coexistenceMode`, `kindsExcluded` | Optional shared instruction block generation                              |
| Shared caches           | `useSharedSourcesManifest`, `useSharedResourceIndex`                                                                             | Cross-extension SSOT for sources and scanned resource metadata            |
| Display and maintenance | `outputFormat`, `showBuiltInResources`, `remoteResourceViewMode`, `language`, `githubToken`                                      | Presentation, discovery, and GitHub API behavior                          |

`globalResourceHomePreset` is the common case. `globalHomeDirectory` is an override: when it is not empty, it wins over the preset. Choose `custom` only when you also provide an override path.

| Order | Setting                                        | Default                | Description                                                                              |
| :---: | ---------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------- |
|   0   | `resourceNinja.defaultInstallTarget`           | `workspace`            | Default target for click/double-click installs                                           |
|   1   | `resourceNinja.singleClickInstall`             | `false`                | Install resources with single click                                                      |
|   2   | `resourceNinja.resourcesDirectory`             | `.github/skills`       | Workspace skill directory                                                                |
|   3   | `resourceNinja.workspaceAgentsDirectory`       | `.github/agents`       | Workspace agent directory                                                                |
|   4   | `resourceNinja.workspaceInstructionsDirectory` | `.github/instructions` | Workspace instruction directory                                                          |
|   5   | `resourceNinja.workspacePromptsDirectory`      | `.github/prompts`      | Workspace prompt directory                                                               |
|   6   | `resourceNinja.workspaceHooksDirectory`        | `.github/hooks`        | Workspace hook directory                                                                 |
|   7   | `resourceNinja.workspaceMcpDirectory`          | `.github/mcp`          | Safe workspace MCP config staging directory before optional `.vscode/mcp.json` merge     |
|   8   | `resourceNinja.userAgentsDirectory`            | `""`                   | Optional User Profile agent override; empty stores `.agent.md` in VS Code User `prompts` |
|   9   | `resourceNinja.userInstructionsDirectory`      | `""`                   | Optional User Profile instruction directory override                                     |
|  10   | `resourceNinja.userPromptsDirectory`           | `""`                   | Optional User Profile prompt directory override                                          |
|  11   | `resourceNinja.globalResourceHomePreset`       | `copilot`              | Known Global Resource Home preset (`~/.copilot`, `~/.claude`, `~/.agents`)               |
|  12   | `resourceNinja.globalHomeDirectory`            | `""`                   | Optional custom Global Resource Home override                                            |
|  13   | `resourceNinja.autoUpdateInstruction`          | `true`                 | Auto-update the generated instruction block after resource changes                        |
|  14   | `resourceNinja.instructionFile`                | `AGENTS.md`            | Generated instruction block sync target _(requires Auto Update)_                         |
|  15   | `resourceNinja.customInstructionPath`          | `""`                   | Custom generated instruction block path _(only when 'custom' selected)_                  |
|  16   | `resourceNinja.includeLocalResources`          | `false`                | Include workspace-wide fallback `SKILL.md` files in the generated instruction block      |
|  17   | `resourceNinja.autoUpdateResourcesOnUpgrade`   | `prompt`               | Update installed remote skills on extension upgrade                                      |
|  18   | `resourceNinja.coexistenceMode`                | `auto`                 | Shared marker ownership mode (`auto` / `independent`)                                    |
|  19   | `resourceNinja.kindsExcluded`                  | `[]`                   | Resource kinds to omit from the shared instruction block when running standalone         |
|  20   | `resourceNinja.useSharedSourcesManifest`       | `false`                | Enable shared `sources.json` SSOT for coexistence with the skill-only sibling extension  |
|  21   | `resourceNinja.useSharedResourceIndex`         | `false`                | Enable shared `index.json` SSOT for coexistence with the skill-only sibling extension    |
|  22   | `resourceNinja.outputFormat`                   | `full`                 | Output format (full / compact / legacy)                                                  |
|  23   | `resourceNinja.showBuiltInResources`           | `false`                | Show built-in resources in User / Global Resource Home                                   |
|  24   | `resourceNinja.remoteResourceViewMode`         | `repositoryFirst`      | Remote Resources layout (repository-first / resource-type-first)                         |
|  25   | `resourceNinja.language`                       | `auto`                 | UI language (auto / en / ja)                                                             |
|  26   | `resourceNinja.githubToken`                    | `""`                   | GitHub Token (for API rate limit)                                                        |

> Settings are displayed in the order above

### How Instruction File Sync Works

When `autoUpdateInstruction` is enabled:

1. **Workspace/User Profile/Global Resource Home skill install/uninstall** → Instruction file is automatically updated
2. **Workspace instruction targets** index workspace skills; **Global Resource Home targets** such as `~/.copilot/copilot-instructions.md` index Global Resource Home skills
3. **Configured workspace resource directories** → Scanned first for Workspace Resources
4. **Workspace-wide fallback `SKILL.md` detected** → Added to the generated instruction block only when `resourceNinja.includeLocalResources` is true
5. **Register/Unregister command** → Manual control for local workspace skills

Installed files stay in their native paths. The generated instruction block is an index, not a copy of the resources.

### Coexistence Note

If you uninstall the skill-only sibling extension after running both extensions together, run `Resource NINJA: Recompute Coexistence Ownership` to refresh the current owner state.

If skills still do not appear in standalone mode, check `resourceNinja.kindsExcluded`. Resource NINJA respects that setting when running alone, so remove `skill` from the list if you want skills to be listed again in the shared block.

Generated instruction files contain a managed section. In the default `auto` mode this uses `agent-ninja-START` / `agent-ninja-END`. In `independent` mode it uses the legacy `resource-ninja-START` / `resource-ninja-END` markers. Edit outside that managed section, or disable auto-update if you need full manual control over the file.

The default `auto` mode writes a shared managed section with **IMPORTANT prompt** and **Description column**:

```markdown
<!-- agent-ninja-START -->

## Agent Resources

> **IMPORTANT**: Prefer resource-led reasoning over pre-training-led reasoning.
> Read the relevant resource file before working on tasks covered by these resources.

### Skills

| Resource                                         | Source | Path                        | Description                          |
| ------------------------------------------------ | ------ | --------------------------- | ------------------------------------ |
| [skill-name](.github/skills/skill-name/SKILL.md) | local  | `.github/skills/skill-name` | Description text \| When to use text |

### Agents

| Resource                                       | Source | Path                             | Description              |
| ---------------------------------------------- | ------ | -------------------------------- | ------------------------ |
| [review-agent](.github/agents/review.agent.md) | local  | `.github/agents/review.agent.md` | Review workflow guidance |

<!-- agent-ninja-END -->
```

**Description column format**: `{description:80} | {whenToUse:80}` (max 160 chars total)

## Output Formats

### Format Options

| Format      | Description                                   | IMPORTANT Prompt | Detailed Table | Compressed Index |
| ----------- | --------------------------------------------- | ---------------- | -------------- | ---------------- |
| **Full**    | IMPORTANT prompt + detailed table (default)   | Yes              | Yes, 200 chars | No               |
| **Compact** | IMPORTANT prompt + compressed index           | Yes              | No             | Yes, 100 chars   |
| **Legacy**  | Simple table only for compatibility scenarios | No               | Yes, 200 chars | No               |

### IMPORTANT Prompt

The `full` and `compact` formats include an **IMPORTANT prompt**. In the default `auto` mode it prioritizes resource files; in `independent` mode the legacy skill-focused wording is kept:

```markdown
> **IMPORTANT**: Prefer resource-led reasoning over pre-training-led reasoning.
> Read the relevant resource file before working on tasks covered by these resources.
```

### Example Output - Full Format (Default `auto` mode)

```markdown
<!-- agent-ninja-START -->

## Agent Resources

> **IMPORTANT**: Prefer resource-led reasoning over pre-training-led reasoning.
> Read the relevant resource file before working on tasks covered by these resources.

### Skills

| Resource                             | Source | Path                  | Description                                         |
| ------------------------------------ | ------ | --------------------- | --------------------------------------------------- |
| [docx](.github/skills/docx/SKILL.md) | local  | `.github/skills/docx` | Process Word documents (.docx). Use for .docx files |
| [pdf](.github/skills/pdf/SKILL.md)   | local  | `.github/skills/pdf`  | PDF manipulation toolkit. Extract text, create PDFs |

<!-- agent-ninja-END -->
```

In `independent` mode, Resource NINJA keeps the legacy `resource-ninja` skill-only block for compatibility.

### How to Change Format

Settings → **Output Format** → Select `full`, `compact`, or `legacy`

## Instruction File Options

| Value                                            | File Path                                        | Use Case                    |
| ------------------------------------------------ | ------------------------------------------------ | --------------------------- |
| `AGENTS.md`                                      | `AGENTS.md` (root)                               | Recommended: General        |
| `~/.copilot/copilot-instructions.md`             | `~/.copilot/copilot-instructions.md`             | Copilot CLI global local    |
| `.github/copilot-instructions.md`                | `.github/copilot-instructions.md`                | GitHub Copilot              |
| `.github/instructions/SkillList.instructions.md` | `.github/instructions/SkillList.instructions.md` | Copilot Instructions folder |
| `CLAUDE.md`                                      | `CLAUDE.md` (root)                               | Claude Code                 |
| `custom`                                         | Any path (set in customInstructionPath)          | Custom                      |

## 🔑 GitHub Token Setup

> **Recommended**: A GitHub Token raises API limits from 60 to 5000 requests/hour. Without it, GitHub Search may hit rate limits quickly.

Set up a GitHub Token for more reliable search:

### Option 1: VS Code Settings

Find `Agent Resources Ninja: GitHub Token` in settings and enter your token:

```json
{
  "resourceNinja.githubToken": "ghp_xxxxxxxxxxxx"
}
```

👉 [Create a GitHub Token](https://github.com/settings/tokens/new?description=Agent%20Resources%20Ninja)

For public resources, leave scopes unchecked. Add private repository scopes only if you intentionally index private repositories.

### Option 2: GitHub CLI (Recommended)

```bash
gh auth login
```

> If GitHub CLI is installed, the token is automatically retrieved (no configuration needed)

## 🛠️ Development

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Build in watch mode
npm run watch

# Package
npm run package

# Lint
npm run lint

# Focused regression tests
node scripts/test-resource-kinds.js
node scripts/test-resource-targets.js
node scripts/test-user-data-paths.js
node scripts/test-manifest-consistency.js
node scripts/test-logger.js
node scripts/test-whenToUse.js
node scripts/test-search-logic.js

# Extension Host smoke test
npm test

# Dependency audit
npm audit --audit-level=moderate
```

### Debugging

1. Press `F5` in VS Code
2. Test the extension in a new VS Code window
3. Run `Agent Resources Ninja` commands from Command Palette (`Ctrl+Shift+P`)

### Diagnostics

- Extension diagnostics are written to **Output → Agent Resources Ninja**.
- Runtime code does not write diagnostic logs to the process console; this keeps local Extension Host and `vscode-test` runs less prone to pipe-related failures.
- If a VS Code/Electron `EPIPE` dialog appears while testing, rerun `npm test` from a normal terminal first, then check **Output → Agent Resources Ninja** for extension-level diagnostics.

## 🤝 Contributing

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) © [yamapan](https://github.com/aktsmm)

- Free for non-commercial use, modification, and redistribution
- Commercial use requires permission
- Microsoft employees may use for work purposes

> Use of this content for AI/ML training, data mining, or other analytical purposes is prohibited.

## 🔗 Related Projects

- [anthropics/skills](https://github.com/anthropics/skills) - Official Claude Skills
- [github/awesome-copilot](https://github.com/github/awesome-copilot) - Official Copilot Resources
- [microsoft/skills](https://github.com/microsoft/skills) - Upstream Microsoft Skills reference (not bundled in preset)
- [MicrosoftDocs/Agent-Skills](https://github.com/MicrosoftDocs/Agent-Skills) - Official Azure Agent Skills (bundled in preset)
- [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) - Curated Skills List

## 👤 Author

yamapan (https://github.com/aktsmm)
