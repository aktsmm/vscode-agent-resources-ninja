# Changelog

All notable changes to the "Agent Resources Ninja" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.10] - 2026-05-10

### Fixed

- **Configured Workspace Scan Roots** - Workspace Resources now scans configured workspace directories first and only falls back to workspace-wide discovery when those roots have no matches, preventing arbitrary local files from becoming the default resource source / Workspace Resources は設定済み workspace directories を先にスキャンし、そこに一致がない場合だけ workspace-wide discovery に fallback するようにしました。任意のローカルファイルが既定の resource source になる挙動を防ぎます。

### Changed

- **Instruction Index Fallback Safety** - `resourceNinja.includeLocalResources` now defaults to off and explicitly controls whether fallback-discovered local `SKILL.md` files outside the configured Workspace Skill Directory are included in the generated Agent Skills index / `resourceNinja.includeLocalResources` の既定値を off にし、設定済み Workspace Skill Directory 外で fallback 検出されたローカル `SKILL.md` を生成 Agent Skills index に含めるかを明示制御するようにしました。

### Tests

- **Scan Policy Regression Coverage** - Added configured-root scan policy regression tests and revalidated manifest consistency, search logic, When to Use extraction, typecheck, lint, and bundle build / configured-root scan policy の回帰テストを追加し、manifest consistency、検索ロジック、When to Use 抽出、型チェック、lint、bundle build を再検証しました。

## [0.2.9] - 2026-05-09

### Added

- **User / Global Reinstall Actions** - Added per-resource reinstall in User / Global Resource Home for remote-installed resources, plus group reinstall for kind groups and plugin groups so reinstall UX now matches Workspace Resources / User / Global Resource Home でも、リモートソースからインストールされたリソースに対する個別再インストールと、種別グループ・プラグイングループの一括再インストールを追加し、Workspace Resources と同等の再インストール導線にしました。

### Changed

- **Plugin Group Detection Fallbacks** - Plugin grouping in Workspace Resources and User / Global Resource Home now falls back across `remotePath`, `relativePath`, and `fullPath`, reducing cases where installed plugin resources appear in one view but not the other / Workspace Resources と User / Global Resource Home の plugin grouping で `remotePath` だけでなく `relativePath` と `fullPath` も使って判定するようにし、あるビューでは見えるのに別ビューでは見えないケースを減らしました。

### Tests

- Added regression coverage for User / Global Resource Home reinstall commands and context visibility, and revalidated full resource regression, smoke test, and audit / User / Global Resource Home の再インストールコマンドと context 表示の回帰テストを追加し、resource 回帰、smoke test、audit を再実行しました。

## [0.2.8] - 2026-05-09

### Added

- **Workspace Resource Group Reinstall** - Added a right-click action on Workspace Resources kind groups (for example Skill or Agent) to reinstall all installed resources in that group that were downloaded from remote sources, while keeping the existing per-resource reinstall action on individual remote-installed rows / Workspace Resources の種別グループ（例: Skill / Agent）を右クリックして、そのグループ内のリモートソースからインストールされたリソースを一括再インストールできる導線を追加しました。個別行の再インストール導線も維持しています。

### Tests

- **Resource Group Reinstall Coverage** - Added regression checks for context-menu exposure, command-palette hiding, localization keys, per-resource delegation, and the empty-group message / context menu 表示、Command Palette 非表示、localization key、個別 reinstall への委譲、空グループ時メッセージを回帰テストで固定しました。

## [0.2.7] - 2026-05-09

### Added

- ✨ **Universal One-Click Install** - Click and double-click installs in Remote Resources now apply to every resource kind, including agents, instructions, prompts, hooks, MCP config, plugin manifests, and Cursor rules. MCP config resources install as a copy-only review file under the Workspace MCP Directory; merging into `.vscode/mcp.json` remains an explicit context-menu action / Remote Resources のシングルクリック / ダブルクリックが skill 以外の agents、instructions、prompts、hooks、MCP config、plugin manifest、Cursor rules を含むすべての resource kind に適用されるようになりました。MCP config はワークスペース MCP ディレクトリへの review コピーで完了し、`.vscode/mcp.json` へのマージはコンテキストメニューでの明示操作のままです。
- 🛡️ **MCP Merge-Aware Uninstall** - When uninstalling an MCP config that has been merged into `.vscode/mcp.json`, Resource Ninja now offers an explicit modal to also remove the matching server entries with backup before deletion / `.vscode/mcp.json` にマージ済みの MCP config をアンインストールするときに、マージ済み server を `.vscode/mcp.json` から削除するか確認する明示モーダルを追加し、削除前に backup を作成するようにしました。
- 🪝 **Hook Static Diagnostics in Resource Rows** - Hook resource rows now show static diagnostics such as configured / not configured status, config source, registered events, and missing-script warnings without ever executing hooks / hook 行に静的診断を追加し、設定済み / 未設定、config source、登録イベント、missing script 警告を表示します。フックを実行することはありません。
- 🧭 **MCP Lifecycle Status in Resource Rows** - Installed MCP config resources show whether they are staged for review, merged into `.vscode/mcp.json`, or need review, in both row description and tooltip / インストール済み MCP config 行に staged / merged / Needs review のライフサイクル状態を description と tooltip に表示するようにしました。
- ✅ **Installed Badge for Every Resource Kind** - Remote Resources rows display Installed / Recently installed badges and check icons for agents, hooks, MCP, plugin, and Cursor rule resources, not only skills / Remote Resources 行に skill だけでなく agent、hook、MCP、plugin、Cursor rule のインストール状態を表示するようにしました。

### Fixed

- 🐛 **MCP Default Click Was Not Truly One-Click** - Default click and double-click installs no longer prompt for the MCP activation picker; the picker is reserved for the explicit Install Resource command, keeping click installs predictable / シングルクリック / ダブルクリックの default install が MCP の有効化方法ピッカーで止まっていた挙動を修正し、ピッカーは明示の Install Resource コマンドだけで表示するようにしました。

### Changed

- 📝 **Release Hygiene** - Updated `.gitignore` and `.vscodeignore` to keep transient `vsce ls` output, scratch backups, and tmp files out of both repository and Marketplace package / `.gitignore` と `.vscodeignore` を見直し、`vsce ls` の一時出力、スクラッチ backup、tmp ファイルが repo にも Marketplace package にも入らないようにしました。
- 📚 **README and Settings Wording** - README and README_ja now describe one-click default install for every resource kind, MCP staged/merged status, and hook static diagnostics, with no implication that hooks are executed / README と README_ja を更新し、すべての resource kind の one-click default install、MCP の staged / merged 状態、hook の静的診断を説明し、hook を実行する誤解が出ないようにしました。

### Tests

- 🧪 **Representative Resource Flow Coverage** - Added `scripts/test-representative-flows.js` covering install path, idempotent reinstall, uninstall path, click-install command, MCP copy-only default click, hook static diagnostics surfacing, and merged MCP uninstall confirmation for every resource kind / 代表 resource kind ごとに install path、idempotent reinstall、uninstall path、click install command、MCP copy-only default、hook 診断、MCP merged uninstall 確認を回帰する `scripts/test-representative-flows.js` を追加しました。
- 🧪 **Lifecycle Helper Coverage** - Extended `test-mcp-config-merge.js` and `test-hook-config.js` to cover the new merge-aware uninstall helper, lifecycle status helpers, and hook diagnostics output / `test-mcp-config-merge.js` と `test-hook-config.js` を拡張し、merge-aware uninstall helper、lifecycle 状態 helper、hook 診断出力までカバーしました。

## [0.2.6] - 2026-05-09

### Changed

- **Plugin Grouping UX** - Renamed the plugin browse section to Grouped by Plugin and grouped plugin manifests with indexed child resources, including root-level plugin packages such as Superpowers / plugin browse section を Grouped by Plugin / プラグイン別へ整理し、Superpowers のような root-level plugin package も含めて manifest とインデックス済み子リソースをまとめて表示するようにしました
- **Plugin Origin Visibility** - Resource-kind rows now show plugin origin in descriptions and tooltips, so plugin-contained skills, agents, and rules remain discoverable by kind while preserving package context / resource kind 別の行に plugin 由来を description と tooltip で表示し、plugin 内の skills、agents、rules を種別別に探しつつ package context も分かるようにしました
- **Plugin Action Copy** - Polished plugin install wording from Plugin Contents to Plugin Resources where the action installs the selected plugin resource group / 選択した plugin resource group をインストールする action の文言を Plugin Contents から Plugin Resources へ整理しました
- **README Plugin Guidance** - README and README_ja now explain plugin grouping, plugin origin, and resource-kind visibility more directly / README と README_ja で plugin grouping、plugin origin、resource kind 別表示の関係をより明確に説明しました

### Tests

- **Plugin Package Regression Coverage** - Added regression coverage for manifest-derived plugin packages, root-level plugin grouping, package-origin row details, and updated plugin grouping labels / manifest 由来 plugin package、root-level plugin grouping、package 由来の行表示、更新後の plugin grouping label に対する回帰テストを追加しました

## [0.2.5] - 2026-05-09

### Added

- **Cursor Official Plugins Source** - Added `cursor/plugins` as an official preset source, indexing plugin manifests plus plugin-contained skills, agents, and Cursor rules / `cursor/plugins` を公式プリセット source として追加し、plugin manifest と plugin 内の skills、agents、Cursor rules を index するようにしました
- **Plugin Manifest Resource Support** - Plugin manifests are now first-class resources that can be installed as managed copies while keeping hooks, executables, and MCP config inactive until explicit user action / Plugin manifest を first-class resource として扱い、managed copy としてインストールできます。hooks、実行ファイル、MCP config は明示操作まで自動有効化しません
- **Cursor Rule Support** - Added Cursor rule resource detection, search, filtering, preview URLs, install targets, icons, and User / Global Resource Home scanning for `.mdc` files / `.mdc` の Cursor rule resource 検出、検索、絞り込み、preview URL、インストール先、アイコン、User / Global Resource Home スキャンに対応しました

### Fixed

- **Plugin Preview URLs** - Fixed plugin preview and GitHub open URLs so plugin manifests preview the manifest file and open the plugin root instead of falling back to a non-existent `SKILL.md` / plugin preview と GitHub open URL を修正し、存在しない `SKILL.md` へ落ちず manifest file を preview し plugin root を開くようにしました
- **Cursor Rule Preview URLs** - Fixed `.mdc` Cursor rules so preview/raw URLs use the actual rule file path instead of appending `SKILL.md` / `.mdc` Cursor rule の preview/raw URL が `SKILL.md` を付加せず実ファイル path を使うように修正しました
- **Plugin Metadata Persistence** - Merged index persistence now detects plugin manifest metadata and plugin install-set safety metadata changes / merged index の永続化判定で plugin manifest metadata と plugin install-set safety metadata の変更を検出するようにしました

### Changed

- **Release Readiness Docs** - README and README_ja now describe plugin manifests, Cursor rules, Cursor official plugins, and managed-copy safety boundaries / README と README_ja に plugin manifest、Cursor rules、Cursor 公式 plugins、managed-copy safety boundary を反映しました
- **Release Regression Coverage** - Added Cursor plugin source, plugin manifest parser, full plugin model, preview URL, target path, and release consistency regression coverage / Cursor plugin source、plugin manifest parser、full plugin model、preview URL、target path、release consistency の回帰テストを追加しました

## [0.2.4] - 2026-05-05

### Changed

- **Per-resource reinstall actions** - Workspace Resources now shows reinstall as an inline action only on remote-installed resources with source metadata, instead of placing the bulk reinstall command in the view title toolbar / Workspace Resources では一括再インストールをビュータイトルから外し、source metadata を持つ remote-installed resource の行にだけリソース単位の再インストール action を表示するようにしました
- **Workspace resource action scope** - Reinstall now supports remote-installed skills, agents, instructions, prompts, hooks, and MCP config resources while local/manual resources without remote metadata do not show the action / 再インストールは remote-installed の skills、agents、instructions、prompts、hooks、MCP config resources に対応し、remote metadata のない local/manual resource には表示しないようにしました

### Tests

- **Workspace Resources UX Coverage** - Added menu and manifest regression coverage that keeps reinstall scoped to remote-installed resource rows and keeps local/manual resources free of misleading reinstall actions / reinstall を remote-installed resource 行に限定し、local/manual resource に誤解を招く再インストール action を出さない UI 回帰テストを追加

## [0.2.3] - 2026-05-05

### Changed

- **Nested Skill Contents** - Remote index updates now treat files under a detected `SKILL.md` root as internal skill contents, preventing helper prompts and instructions in folders such as `templates` from appearing as separate Remote Resources / Remote index 更新で検出済み `SKILL.md` root 配下のファイルを skill 内部構成として扱い、`templates` などの補助 prompt / instruction が Remote Resources に別リソースとして出ないようにしました

### Tests

- **Nested Resource Regression Coverage** - Added regression coverage that keeps standalone prompts and agents visible while pruning non-skill resources nested under a skill root / standalone prompt / agent は維持しつつ、skill root 配下の non-skill resource を除外する回帰テストを追加

## [0.2.2] - 2026-05-04

### Fixed

- **Resource Preview URLs** - Fixed MCP, agent, prompt, instruction, and hook preview/open/copy URLs so single-file resources use their actual raw/blob file paths instead of appending `SKILL.md` / MCP、agent、prompt、instruction、hook の preview/open/copy URL を修正し、単一ファイルリソースでは `SKILL.md` を付けず実ファイルの raw/blob path を使うようにしました
- **MCP preview metadata** - Fixed bundled MCP config descriptions so JSON content does not appear as `{` in Remote Resources / Remote Resources で bundled MCP config の説明が `{` と表示されないように修正

### Changed

- **MCP Settings Clarity** - Clarified Workspace MCP Directory as a staging/review directory before optional `.vscode/mcp.json` merge / Workspace MCP Directory が任意の `.vscode/mcp.json` merge 前の staging / review 用ディレクトリであることを明確化
- **README Release Readiness** - Refined README / README_ja first-screen copy for current resource-management behavior and MCP review flow / README / README_ja の冒頭説明を現在の resource management と MCP review flow に合わせて整理

### Tests

- **Preview URL Regression Coverage** - Added resource preview URL regression tests for MCP, agent, prompt, hook, and directory skill resources, and wired them into `npm run test:resources` / MCP、agent、prompt、hook、directory skill の preview URL 回帰テストを追加し、`npm run test:resources` に組み込み

## [0.2.1] - 2026-05-04

### Fixed

- **Language switch refresh** - User / Global Resource Home now refreshes when the UI language setting changes, matching Workspace Resources and Remote Resources / UI 言語設定変更時に User / Global Resource Home も Workspace Resources / Remote Resources と同じく再描画するように修正
- **Report Bug locale handling** - Report Bug now uses the shared runtime language helper so `auto` follows the active VS Code locale / Report Bug が共通の runtime 言語判定を使い、`auto` が VS Code の有効 locale に追随するように修正
- **Installer auth fallback test** - Updated the auth fallback regression test stubs for current MCP and customization path dependencies / auth fallback 回帰テストの stub を現在の MCP / customization path 依存に追随

### Changed

- **README release positioning** - README and README_ja now lead with the three resource-management views, explicit install target safety, and read-only built-in resources instead of generated Agent Skills index output formats / README / README_ja の冒頭を生成 Agent Skills index の出力形式ではなく、3 つの resource view、明示的な install target、安全な組み込みリソース説明へ整理
- **Release hygiene guardrails** - Release hygiene tests now ensure VSIX packaging keeps `dist/extension.js` while excluding sourcemaps and development artifacts / release hygiene テストで `dist/extension.js` を残しつつ sourcemap と開発用 artifact を VSIX から除外することを検証

## [0.2.0] - 2026-05-03

### Added

- **Mixed remote resource presets** - Bundled `github/awesome-copilot` now indexes skills, agents, instructions, prompts, and hooks instead of skills only / 同梱 `github/awesome-copilot` インデックスが skills だけでなく agents、instructions、prompts、hooks も含むように更新
- **Plugin-browsable Awesome Copilot resources** - `github/awesome-copilot` plugin resources are available from both top-level resource kinds and a dedicated Plugins section / `github/awesome-copilot` の plugin リソースを top-level resource kind と専用 Plugins セクションの両方から参照可能にしました
- **Plugin cleanup and recovery flow** - Plugin-installed resources can be deleted by plugin from Workspace/User/Global resource views, and failed bundle installs offer a source index refresh / plugin から入れたリソースを Workspace/User/Global resource view で plugin 単位削除でき、bundle install 失敗時は該当 source の index 更新を提案します
- **Expanded official presets** - Added path-filtered official resources from Gemini CLI, Codex, Claude Code, Cline, and Goose / Gemini CLI、Codex、Claude Code、Cline、Goose の公式リポジトリから path filter 済みリソースを追加
- **AWS and Elastic official presets** - Added path-filtered skills from AWS Labs Agent Plugins and Elastic Agent Skills / AWS Labs Agent Plugins と Elastic Agent Skills から path filter 済み skills を追加
- **GitHub Copilot for Azure plugin presets** - Added path-filtered official Azure plugin skills from `microsoft/GitHub-Copilot-for-Azure` / `microsoft/GitHub-Copilot-for-Azure` から path filter 済み Azure 公式プラグイン skills を追加
- **Microsoft Azure Skills Plugin preset** - Added official resources from `microsoft/azure-skills`, including top-level Azure skills and the Azure MCP config as a reviewable MCP resource / `microsoft/azure-skills` から top-level Azure skills と確認用 Azure MCP config を公式リソースとして追加
- **Microsoft Azure Skills bundle** - Added a selectable Azure Skills Plugin bundle that includes Azure skills and the Azure MCP config while preserving MCP review/no-auto-activation safety / Azure skills と Azure MCP config を含む選択式 Azure Skills Plugin bundle を追加し、MCP は確認用コピー・自動有効化なしの安全境界を維持
- **Duplicate resource search UX** - Search results now show friendly source names and source/path details for duplicate resource names, preferring distribution-ready paths over embedded plugin paths when relevance ties / 重複 resource name の検索結果に読みやすい source 名と source/path 詳細を表示し、関連度が同じ場合は embedded plugin path より distribution-ready path を優先
- **MCP config collision safety** - Generic MCP config file names such as `mcp.json` and `.mcp.json` now install with a source prefix to avoid overwriting configs from other sources / `mcp.json` や `.mcp.json` などの汎用 MCP config は source prefix 付きで保存し、別 source の設定上書きを回避
- **Clearer install set and plugin-content UX** - Renamed bundle-facing UI to install sets, renamed plugin grouping to plugin contents / plugin-derived groups, added plugin-content checklist install, and exposed create/settings/instruction index actions from the relevant resource views / bundle 向け UI をインストールセットへ寄せ、plugin grouping をプラグイン内リソース/プラグイン由来として整理。プラグイン内リソースのチェックリストインストールと、作成・設定・instruction index 操作の導線を関連ビューに追加
- **Scope and localization hardening** - Localized instruction-file creation prompts, refreshed instruction indexes after User / Global skill deletion and plugin cleanup, cleaned up hook plugin folders, and added dedicated UI scope regression tests / instruction file 作成プロンプトを英日ローカライズし、User / Global skill 削除や plugin cleanup 後に instruction index を更新。hook plugin フォルダー cleanup と UI scope 専用回帰テストを追加
- **Create Resource destination consistency** - Create Resource previews and actual creation paths now use the same configured Workspace, User Profile, and Global Resource Home roots as install/scan paths / Create Resource のプレビューと実際の作成先を install/scan と同じ Workspace、User Profile、Global Resource Home の設定済みルートに統一
- **Global Resource Home terminology** - Clarified user-facing labels so the shared resource root is shown as Global Resource Home, while existing settings keys remain compatible / 共有リソースルートの user-facing 表示を Global Resource Home に統一し、既存の設定キー互換性は維持
- **Create Resource template hardening** - Generated resource templates now quote YAML frontmatter values, normalize body text, escape MCP server keys, and include dedicated regression coverage / 新規リソース作成テンプレートで YAML frontmatter 値を quote し、本文を正規化、MCP server key を escape。専用回帰テストも追加
- **Create Resource flow hardening** - Description cancellation now stops creation, workspace destination previews use configured roots directly, and file write failures show localized errors / 説明入力のキャンセル時は作成を中止し、workspace 保存先プレビューは設定済み root を直接表示。ファイル書き込み失敗時はローカライズ済みエラーを表示
- **Create Resource validation hardening** - Resource names, generated destination paths, and descriptions now have explicit limits with localized validation messages / リソース名、生成先パス、説明文に明示的な上限を設け、ローカライズ済み validation message を表示
- **Curated prompt/instruction presets** - Added Code and Sorts Copilot agents/instructions/prompts and Taches Claude Code resources / Code and Sorts の Copilot agents/instructions/prompts と Taches Claude Code resources を追加
- **Install target path previews** - Install target picker now shows resource-kind-aware destination previews / インストール先選択にリソース種別ごとの保存先プレビューを表示
- **Default click install target** - Remote resource single-click and double-click installs now use a configurable default target, with Workspace as the default / リモートリソースのシングルクリック/ダブルクリックインストールで設定可能な既定インストール先を使い、既定を Workspace にしました
- **User Profile routing tests** - Added regression coverage for User Profile agent/instruction/prompt install paths / User Profile 配下の agent、instruction、prompt 保存先に対する回帰テストを追加
- **Create Resource flow** - The toolbar create action now creates skills, agents, instructions, prompts, or hooks with Workspace, User Profile, Global Resource Home, and custom folder targets / ツールバーの作成アクションで skills、agents、instructions、prompts、hooks を作成でき、Workspace、User Profile、Global Resource Home、カスタムフォルダーを保存先に選べるようにしました
- **Global Resource Home presets** - Added selectable Global Resource Home presets for GitHub Copilot/Copilot CLI, Claude-compatible resources, and open agent resources / GitHub Copilot/Copilot CLI、Claude 互換、Open Agent 系の代表的な Global Resource Home preset を選択できるようにしました
- **Copilot CLI instruction sync target** - Added `~/.copilot/copilot-instructions.md` as a first-class Agent Skills index sync target for Copilot CLI local instructions / Copilot CLI の local instructions 向けに `~/.copilot/copilot-instructions.md` を Agent Skills index の同期先として追加
- **Global Resource Home routing coverage** - Added regression coverage for Global Resource Home preset resolution, override precedence, instruction sync scope, and mixed-case/mixed-separator path boundaries / Global Resource Home preset 解決、override 優先順位、instruction sync scope、大小文字混在・区切り文字混在 path boundary の回帰テストを追加

### Changed

- **Runtime diagnostics logging** - Moved extension diagnostics from process console output to the Agent Resources Ninja output channel to reduce local test runner pipe errors / 拡張機能の診断ログをプロセス標準出力から Agent Resources Ninja の Output Channel に移し、ローカルテスト時の pipe エラーを起こしにくくしました
- **Built-in resource visibility** - Built-in VS Code / GitHub Copilot Chat / GitHub Copilot CLI resources are hidden by default and can be toggled into source-specific groups in User / Global Resource Home / VS Code / GitHub Copilot Chat / GitHub Copilot CLI の組み込みリソースは既定で非表示にし、必要なときだけ User / Global Resource Home の由来別グループに表示できるようにしました
- **Workspace resource grouping** - Workspace Resources now groups installed and local resources by resource kind, and files nested inside skill folders no longer count as standalone agents, prompts, instructions, or hooks / Workspace Resources はインストール済み・ローカルリソースをリソース種別ごとに表示し、skill フォルダー内のファイルは独立した agents、prompts、instructions、hooks として数えないようにしました
- **Workspace resource context menus** - Workspace Resources now separates skill-only actions from generic resource actions so agents, prompts, instructions, and hooks get safe open/uninstall/register actions without skill-only metadata commands / Workspace Resources のコンテキストメニューで skill 専用操作と汎用リソース操作を分離し、agents、prompts、instructions、hooks には安全な open/uninstall/register 操作だけを表示するようにしました
- **Remote resource browsing** - Remote Resources can switch between repository-first and resource-type-first layouts / Remote Resources はリポジトリ起点とリソース種別起点の表示を切り替えられるようにしました
- **Search UX relevance** - QuickPick search now supports resource-kind filtering and ranks stronger matches before source-type preference / QuickPick 検索でリソース種別フィルターに対応し、source 種別より一致度を優先して表示するようにしました
- **Selectable plugin bundles** - Official plugin-derived bundles can be installed through a checklist and install target picker. Hooks and MCP config resources are selectable resources; MCP config files are copied for review and are not auto-merged into `.vscode/mcp.json` / 公式 plugin 由来 bundle をチェックリストとインストール先選択で導入できるようにしました。hooks と MCP config は選択可能なリソースとして扱い、MCP config は確認用にコピーして `.vscode/mcp.json` へ自動マージしません
- **Built-in scan guardrails** - Workspace scanning now excludes `.vscode-test` archives even when built-in resources are visible, keeping test-only VS Code SKILL copies out of workspace UX / built-in 表示時でも Workspace scan から `.vscode-test` archive を除外し、テスト用 VS Code 内の SKILL コピーが Workspace UX に混ざらないようにしました
- **MCP resource UX polish** - MCP config resources now appear in resource-kind ordering and bundle pickers use kind-specific icons plus an explicit no-auto-activation notice / MCP config resources をリソース種別順へ追加し、bundle 選択 UI では種別別アイコンと自動有効化しない旨を明示しました
- **Goose official source** - Updated the Goose preset source from `block/goose` to the current `aaif-goose/goose` repository / Goose プリセットソースを `block/goose` から現在の `aaif-goose/goose` リポジトリに更新
- **Preset duplicate pruning** - Remote preset generation now removes display-equivalent duplicate resources while preferring shorter distribution-ready paths / リモートプリセット生成で表示上同一の重複リソースを除去し、短い配布向けパスを優先するようにしました
- **User / Global Resource Home scope** - User / Global Resource Home now scans only VS Code User Data and the selected Global Resource Home; workspace `.github` stays in Workspace Resources / User / Global Resource Home は VS Code User Data と選択中の Global Resource Home のみを対象にし、workspace `.github` は Workspace Resources 側に分離
- **Instruction sync scope** - Global Resource Home instruction targets now index Global Resource Home skills, while workspace instruction targets continue to index workspace skills / Global Resource Home の instruction target では Global Resource Home skills を、workspace の instruction target では従来通り workspace skills を一覧化するようにしました
- **Instruction sync classification** - Home-relative and external absolute instruction targets are now treated as Global Resource Home targets even when the selected Global Resource Home preset points somewhere else / home-relative と workspace 外の absolute instruction target は、選択中の Global Resource Home preset が別の場所でも Global Resource Home target として扱うようにしました
- **Settings toolbar UX** - Removed the extension settings gear from the Workspace Resources view title because settings are extension-wide rather than workspace-resource-specific / 設定は Workspace Resources 固有ではなく拡張機能全体の操作であるため、Workspace Resources のタイトル右側から設定ギアを外しました
- **User Profile install routing** - User Profile installs `.agent.md` files into the VS Code User `prompts` folder by default so they appear in the agent picker; explicit agent directory overrides are still honored / User Profile への `.agent.md` インストールは既定で agent picker が検出する VS Code User `prompts` に保存し、明示的な agent directory override は引き続き尊重
- **Install feedback consistency** - Recently installed badges now work across resource kinds and install targets, and bundle failure prompts are shown only after progress has closed / 最近インストールしたリソースのバッジをリソース種別・インストール先を問わず表示し、bundle 失敗時の通知は progress が閉じた後に表示するようにしました
- **Source filtering** - Preset sources can now define `includePaths` and `excludePaths` so official product repositories do not index internal samples or test fixtures / プリセットソースに `includePaths` / `excludePaths` を追加し、公式プロダクトリポジトリの内部サンプルやテスト fixture を除外
- **Settings clarity** - Settings now explain the default click install target and clarify that `resourcesDirectory` controls workspace skills while other resource kinds use native `.github` paths / 設定画面でクリックインストールの既定先を説明し、`resourcesDirectory` は workspace skills 用で他のリソース種別は `.github` 配下のネイティブパスを使うことを明確化
- **Settings screen alignment** - Settings now distinguish the Agent Skills index sync from native agents/prompts/instructions/hooks paths, and show default install target routing before single-click install / 設定画面で Agent Skills index 同期と agents/prompts/instructions/hooks のネイティブ保存先を区別し、既定インストール先のルーティングをシングルクリック設定より先に表示するようにしました
- **Configurable resource roots** - Workspace agents/instructions/prompts/hooks, User Profile agents/instructions/prompts, and Global Resource Home roots can now be configured instead of using only built-in defaults / Workspace agents/instructions/prompts/hooks、User Profile agents/instructions/prompts、Global Resource Home の保存先を既定値だけでなく設定で変更できるようにしました
- **Settings ordering** - Install behavior and destination settings now appear before secondary instruction-sync and display settings / インストール動作と保存先設定を、instruction 同期や表示関連の補助設定より先に表示するようにしました
- **Settings order consistency** - Settings order values and README tables now match the install/destination-first UX exactly / 設定の `order` 値と README の設定表を、インストール動作と保存先を先に見せる UX に完全に揃えました
- **Settings and instruction-file navigation** - Reset Settings is now available from every resource view, resets every non-secret Resource Ninja setting, and Open Instruction File shows the resolved target path with a Settings fallback for global or compatibility targets / Reset Settings を全リソースビューから利用可能にし、token 以外の全 Resource Ninja 設定をリセット。Open Instruction File は global / 互換 target でも解決先パスと Settings 導線を表示
- **Settings reset safety** - Reset Settings now uses a warning icon, command label ellipsis, modal confirmation for destructive resets, and password-style GitHub token input / Reset Settings は warning icon と省略記号付きラベルを使い、破壊的 reset 前に modal confirmation を表示。GitHub Token は password 表示に変更
- **Instruction target UX** - Edit When To Use and manual instruction updates now show the configured instruction target instead of hardcoding AGENTS.md / Edit When To Use と手動 instruction 更新は AGENTS.md 固定ではなく、設定中の instruction target を表示
- **Instruction sync disabled UX** - Manual instruction updates no longer report success when sync is disabled, and Edit When To Use now distinguishes metadata-only saves from generated index updates / instruction sync 無効時に手動更新が成功表示を出さないようにし、Edit When To Use は metadata 保存のみと index 更新を区別
- **Support navigation consistency** - Report a Bug is now reachable from every resource view toolbar, and Settings / Reset / Support groups are ordered consistently / Report a Bug を全リソースビューの toolbar から利用可能にし、Settings / Reset / Support の並びを統一
- **Localization UX quality gate** - Added release tests for EN/JA key parity, placeholder parity, command label safety, Global Resource Home wording, MCP safety copy, and resource-oriented preview text / 日英キー・placeholder・危険操作ラベル・Global Resource Home 表記・MCP安全文言・resource-oriented preview 文言を検証する release test を追加
- **Command Palette clarity** - Context-only commands and the legacy Create Skill alias are hidden from the Command Palette while remaining available from views and compatibility paths / context 専用 command と互換用 Create Skill alias を Command Palette から非表示にし、ビューや互換経路からは利用可能なまま維持
- **GitHub token least privilege** - Settings and README token guidance no longer preselect or require broad repository scopes for public resource browsing / Settings と README の token 案内から広い repository scope の事前選択・必須表現を削除し、公開リソースでは scope 不要と明記
- **README release UX consistency** - README / README_ja now match the manifest for Agent Mode tool count, `#localizeResource`, MCP config resource coverage, and resource-oriented preview wording / README / README_ja の Agent Mode tool 数、`#localizeResource`、MCP config resource 対応、resource preview 文言を manifest と一致させました
- **README source table integrity** - Fixed the included source table so all 22 bundled sources, including `qdhenry/Claude-Command-Suite`, render inside the table and are checked against the bundled index / 収録 source 表を修正し、`qdhenry/Claude-Command-Suite` を含む 22 source が表内に表示されることを index と照合するテストで保証
- **Empty-state view guidance** - Added localized `viewsWelcome` actions for Workspace Resources, User / Global Resource Home, and Remote Resources so first-run empty views point to safe next actions / Workspace Resources、User / Global Resource Home、Remote Resources に localized `viewsWelcome` 導線を追加し、初回空状態から安全な次アクションへ進めるよう改善
- **Global instruction file routing** - User / Global Resource Home now opens and updates the product-native global instruction file (`~/.copilot/copilot-instructions.md`, `~/.claude/CLAUDE.md`, or `~/.agents/AGENTS.md`) instead of reusing the workspace instruction target / User / Global Resource Home の「インストラクションファイルを開く/更新」は workspace 側を再利用せず、Global Resource Home preset に応じた global instruction file を対象にするよう修正
- **Settings copy polish** - Output Format settings now use professional text without emoji or `OLD` labels, and Instruction File enum descriptions show the exact target paths users select / Output Format 設定から絵文字と `OLD` 表記を除去し、Instruction File の選択肢説明を実際の target path と一致させました
- **Global instruction toolbar clarity** - User / Global Resource Home toolbar actions now show explicit Open/Update Global Instruction File labels instead of sharing the workspace instruction labels / User / Global Resource Home の toolbar action は workspace 側と同じラベルを使わず、Global の対象であることが分かる Open/Update Global Instruction File 表示にしました
- **Lazy activation** - Removed startup activation and rely on VS Code contribution auto-activation for views/commands plus explicit Chat and Language Model Tool activation, reducing idle startup impact / 起動完了時の常時 activation をやめ、view/command は VS Code の contribution auto-activation、Chat/Language Model Tool は明示 activation に整理して、未使用時の起動負荷を減らしました
- **Safer Command Palette** - Context-only and destructive actions such as uninstall, remove source, and preview are hidden from the top-level Command Palette while remaining available in the relevant views / uninstall、remove source、preview など対象依存・破壊的操作は関連ビューには残しつつ、トップレベルの Command Palette からは非表示にしました
- **Selectable MCP activation** - MCP config installs now let users keep files staged for review or explicitly merge compatible servers into workspace `.vscode/mcp.json`; existing server keys require overwrite confirmation and existing files are backed up before writes / MCP config インストール時にレビュー用コピーまたは workspace `.vscode/mcp.json` への明示マージを選べるようにし、既存 server key の上書き確認と書き込み前 backup に対応しました
- **Release hygiene guardrails** - `.gitignore` and `.vscodeignore` now cover validation logs, exit files, stale backups, and local release artifacts; old `AGENTS.md.backup` and `compile-output.txt` were removed / `.gitignore` と `.vscodeignore` に検証ログ、終了コードファイル、古い backup、ローカルリリース成果物の除外を追加し、旧 `AGENTS.md.backup` と `compile-output.txt` を削除しました
- **Configured path consistency** - Workspace resource scans and uninstall now honor configured external or home-relative non-skill resource roots / Workspace resource のスキャンと削除が、外部パスや `~/` の非skill保存先設定にも追従するようにしました
- **Built-in agent detection** - Copilot Chat generated Ask, Explore, and Plan agent files are now classified as built-in resources instead of deletable installed agents / Copilot Chat が生成する Ask、Explore、Plan agent ファイルを、削除可能な installed agent ではなく組み込みリソースとして分類するようにしました
- **Built-in resource UX boundary** - Built-in resources are now centralized in User / Global Resource Home and grouped by origin such as VS Code, GitHub Copilot Chat, and GitHub Copilot CLI / 組み込みリソースは User / Global Resource Home に集約し、VS Code、GitHub Copilot Chat、GitHub Copilot CLI など由来別に表示するようにしました
- **Forward-compatible built-in detection** - Copilot Chat globalStorage, bundled `assets/prompts` `/create-*` skills, VS Code app roots, and versioned Copilot CLI `builtin-*` layouts are detected defensively for future built-in additions / Copilot Chat の globalStorage、同梱 `assets/prompts` の `/create-*` skill、VS Code app root、バージョン付き Copilot CLI `builtin-*` レイアウトを防御的に検出し、今後の組み込み追加にも追従しやすくしました
- **Built-in scan performance** - User / Global built-in scanning now limits extension `skills` roots to VS Code bundled extensions and avoids Node-only `path` / `Buffer` APIs in the scanner / User / Global の組み込みスキャンでは extension `skills` root を VS Code 同梱拡張に限定し、scanner から Node 専用の `path` / `Buffer` 依存を外しました
- **Installed source labels** - Installed non-skill resources now preserve sidecar source metadata so the tree avoids `installed from unknown` after double-click installs / 非skillリソースのインストール時に sidecar source metadata を表示へ反映し、ダブルクリックインストール後の `installed from unknown` を避けるようにしました
- **Workspace tree cleanup** - Workspace Resources no longer keeps obsolete built-in grouping code, and legacy missing source metadata now displays as installed instead of `installed from unknown` / Workspace Resources から不要になった組み込みグループ表示コードを削除し、古い source metadata がない場合も `installed from unknown` ではなく installed と表示するようにしました
- **Skill-entry wording clarity** - Skill-only actions and generated instruction empty states now explicitly say skill entry or When To Use, avoiding confusion with agents/prompts/instructions/hooks / skill 専用アクションと生成される instruction の空状態文言を skill entry / When To Use と明確化し、agents/prompts/instructions/hooks との混同を避けました
- **Stable installed display names** - Non-skill remote installs now keep their Remote Resources display name in sidecar metadata so local views do not switch to document headings / 非skillのリモートインストール時に Remote Resources の表示名を sidecar metadata に保存し、ローカル表示が本文見出しへ変わらないようにしました
- **User / Global Resource Home deletion** - Non-built-in User / Global Resource Home resources can now be deleted from the context menu, while built-in resources remain read-only / 組み込み以外の User / Global Resource Home resources をコンテキストメニューから削除できるようにし、組み込みリソースは読み取り専用のままにしました
- **Workspace resource list alignment** - Chat and Agent Mode list commands now report workspace skills, agents, prompts, instructions, and hooks instead of skills only / Chat と Agent Mode の list コマンドが skill のみではなく workspace の skills、agents、prompts、instructions、hooks を表示するようにしました
- **Agent Mode uninstall coverage** - The `#uninstallResource` tool can now remove non-skill workspace resources and asks for a more specific name when matches are ambiguous / `#uninstallResource` ツールで非skillの workspace resource も削除できるようにし、曖昧一致が複数ある場合はより具体的な名前を求めるようにしました
- **Skill-only toolbar gating** - Skill-only bulk reinstall/delete actions are hidden until installed skills exist / skill 専用の一括再インストール/削除アクションはインストール済み skill がある時だけ表示するようにしました
- **Bulk action wording** - Bulk reinstall/delete settings now clearly describe their current skill-only scope / 一括再インストール/削除とアップグレード時更新の表記を、現在の skill 対象範囲に合わせて明確化
- **Uninstall path handling** - Workspace skill uninstall now handles both configured-skill-relative paths and full workspace-relative paths without duplicating `.github/skills` / workspace skill の削除で、設定skillsディレクトリ相対パスとワークスペース相対パスの両方を扱い、`.github/skills` が二重化しないようにしました
- **Resource index metadata** - Bumped bundled resource index metadata to v1.22.0 for plugin-browsable resources / plugin から辿れるリソース追加に合わせ、同梱リソースインデックスのメタデータを v1.22.0 に更新

## [0.1.0] - 2026-04-25

### Added

- **Initial Agent Resources Ninja release** - Introduced a new resource-oriented VS Code extension derived from Agent Skills Ninja / Agent Skills Ninja から派生した、リソース指向の新しい VS Code 拡張機能として初回リリース
- **Resource views** - Added Workspace Resources, User / Global Resource Home, and Remote Resources views / Workspace Resources、User / Global Resource Home、Remote Resources ビューを追加
- **Resource kind support** - Added first-class handling for skills, agents, prompts, instructions, and hooks / skills、agents、prompts、instructions、hooks の種別管理に対応
- **Remote resource grouping** - Added Resource Types grouping to Remote Resources / Remote Resources に Resource Types グルーピングを追加
- **User resource scanning** - Added read-only scanning for VS Code User Data and `~/.copilot` resources / VS Code User Data と `~/.copilot` 配下のリソースを読み取り専用でスキャン
- **Explicit install targets** - Added install target selection for Workspace, User Profile, Global Resource Home, and Custom locations / Workspace、User Profile、Global Resource Home、Custom のインストール先選択を追加
- **Resource identity** - Added a distinct Agent Resources Ninja icon and resource-oriented display text / Agent Resources Ninja 用の差別化アイコンとリソース前提の表示文言を追加
- **Regression tests** - Added resource kind and install target path regression tests / ResourceKind 判定とインストール先パス解決の回帰テストを追加

### Changed

- **Product identity reset** - Reset release history for the new `agent-resources-ninja` product line / 新しい `agent-resources-ninja` 製品ラインとしてリリース履歴をリセット
- **Search coverage** - Expanded GitHub search queries from `SKILL.md` only to skills, agents, instructions, prompts, and hooks / GitHub 検索対象を `SKILL.md` だけでなく skills、agents、instructions、prompts、hooks に拡張
- **Dependency hardening** - Updated development tooling and dependency overrides so `npm audit` reports zero vulnerabilities / 開発ツールと依存 overrides を更新し、`npm audit` が 0 vulnerabilities になるよう整理

### Notes

- The original Agent Skills Ninja release history is intentionally not carried into this changelog. Migration context is tracked in [MIGRATION_NOTES.md](MIGRATION_NOTES.md). / 旧 Agent Skills Ninja のリリース履歴はこの CHANGELOG には引き継ぎません。移行経緯は [MIGRATION_NOTES.md](MIGRATION_NOTES.md) に記録します。

[Unreleased]: https://github.com/aktsmm/vscode-agent-resources-ninja/compare/v0.2.9...HEAD
[0.2.9]: https://github.com/aktsmm/vscode-agent-resources-ninja/compare/v0.2.8...v0.2.9
[0.2.8]: https://github.com/aktsmm/vscode-agent-resources-ninja/compare/v0.2.7...v0.2.8
[0.2.7]: https://github.com/aktsmm/vscode-agent-resources-ninja/compare/v0.2.6...v0.2.7
[0.2.6]: https://github.com/aktsmm/vscode-agent-resources-ninja/compare/v0.2.5...v0.2.6
[0.2.5]: https://github.com/aktsmm/vscode-agent-resources-ninja/compare/v0.2.4...v0.2.5
[0.2.4]: https://github.com/aktsmm/vscode-agent-resources-ninja/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/aktsmm/vscode-agent-resources-ninja/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/aktsmm/vscode-agent-resources-ninja/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/aktsmm/vscode-agent-resources-ninja/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/aktsmm/vscode-agent-resources-ninja/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/aktsmm/vscode-agent-resources-ninja/releases/tag/v0.1.0
