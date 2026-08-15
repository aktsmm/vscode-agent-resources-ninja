# Changelog

All notable changes to the "Agent Resources Ninja" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.45] - 2026-08-15

### Changed

- 🛡️ **Safer Resource Operations and Recoverable Batches** - Resource installation and recursive deletion now resolve the nearest existing ancestor with `lstat` and `realpath`, reject broken links, and refuse junction or symlink paths that escape the allowed root. GitHub failures now distinguish server and transport errors, retry only those bounded transient kinds, mark internal timeouts as `ETIMEDOUT`, and expire every unverified default-branch fallback after 30 seconds, including an API response with missing branch data. Batch installs, reinstalls, skill deletions, and plugin-resource deletions can now be canceled between resources. Partial summaries use behavior-tested processed counts, report unprocessed items separately, and no longer claim failed deletions succeeded / リソースのインストールと再帰削除で、存在する最寄り祖先を `lstat` と `realpath` で解決し、壊れたリンクを拒否するとともに、許可ルート外を指す junction / symlink 経由の操作を拒否するようにしました。GitHub の失敗は server error と transport error を区別し、この一時的な種別だけを上限付きで再試行します。内部 timeout には `ETIMEDOUT` を付け、API responseにbranch情報が無い場合を含む未確認のdefault branch fallbackは30秒で失効します。一括install / reinstall / skill削除 / plugin resource削除はリソース間でキャンセルできます。部分完了summaryはbehavior test済みの処理済み件数を分母にして未処理件数を別表示し、削除失敗を成功と誤表示しません。

- 📦 **Clean Development Dependency Audit** - Refreshed development dependencies within their existing compatible ranges, including fixed `brace-expansion` and `js-yaml` releases. The complete dependency audit and the runtime-only audit now both report zero vulnerabilities; the lockfile keeps public registry URLs and SHA-512 integrity / 既存の互換range内でdevelopment dependenciesを更新し、修正版`brace-expansion`と`js-yaml`を取り込みました。全依存auditとruntime限定auditはいずれも脆弱性0件となり、lockfileは公開registry URLとSHA-512 integrityを維持します。

### Fixed

- 🪝 **Hook Config Metadata and Legacy Migration** - JSON hook configs now store their resource metadata in an adjacent `<hook>.json.resource-ninja.json` sidecar instead of attempting to write below the JSON file as though it were a directory. File-backed hook detection is shared by metadata and deletion, including custom target folders, so deleting a hook JSON never targets its parent directory. Installer, workspace scanner, user scanner, deletion, and legacy plugin-hook migration share this contract. A filesystem-backed fixture verifies that migration removes an owned legacy hook and sidecar while preserving an unowned file / JSON hook configのresource metadataを、JSON fileをdirectory扱いした配下ではなく、隣接する`<hook>.json.resource-ninja.json` sidecarへ保存するよう修正しました。custom target folderを含め、file-backed hook判定をmetadataと削除で共有するため、hook JSON削除時に親directoryを対象にしません。installer、workspace scanner、user scanner、削除、legacy plugin hook移行はこの契約を共有します。filesystem-backed fixtureで、所有権が一致するlegacy hookとsidecarだけを削除し、所有していないfileは保持することを検証します。

## [0.2.44] - 2026-08-14

### Added

- 🧰 **Codex WinGet Provenance and Alias Troubleshooting** - Codex CLI detection now distinguishes PATH, a WinGet Links executable not inherited by the current process, the official WinGet package executable when no link exists, unsupported package contents, and absence. Windows PATH candidates are restricted to shell-free executables, and multiple package installs are selected deterministically by executable timestamp, package timestamp, then path. The host picker and install/manage confirmations show the actual provenance while Native plugin lifecycle continues through the absolute executable path. A new **Copy Codex CLI Troubleshooting Command** command copies the official `winget install --id OpenAI.Codex -e --source winget --force` recovery attempt without running it or promising that WinGet will repair the alias / Codex CLI検出でPATH、現在processのPATHに含まれないWinGet Links実体、linkがない場合の公式WinGet package実体、未対応package内容、未検出を区別するようにしました。WindowsのPATH候補はshell不要の実行形式に限定し、複数packageは実行ファイル時刻、package時刻、pathの順で決定論的に選びます。host pickerとinstall/manage確認dialogには実際の検出経路を表示し、Native lifecycleはabsolute executable pathで継続します。新しい**Codex CLI のトラブルシューティングコマンドをコピー**は公式の`winget install --id OpenAI.Codex -e --source winget --force`をコピーしますが、自動実行せず、WinGetがaliasを修復することも保証しません。

- 🗂️ **Official GitHub Copilot Plugins Catalog** - Added the official `github/copilot-plugins` repository as a filtered preset source, indexing its `.github/plugin/marketplace.json` plus the five resources physically stored under `plugins/`: two plugin/marketplace rows, two skills, and one hook. External marketplace entries such as WorkIQ and Advanced Security remain catalog metadata instead of becoming fake resources that point at the wrong repository. Refreshed drifted official/community sources and removed stale or duplicate compatibility rows; the resource index advances to v1.28.0 with 2648 resources across 24 sources. The index-wide freshness date remains 2026-07-30 because these were source-filtered scans / 公式`github/copilot-plugins` repositoryをfilter付きpreset sourceとして追加し、`.github/plugin/marketplace.json`と`plugins/`配下に実体がある5resource（plugin/marketplace 2件、skill 2件、hook 1件）を収録しました。WorkIQやAdvanced Securityなど外部repositoryのmarketplace entryは、誤ったrepositoryを指す偽resourceにせずcatalog metadataとして扱います。driftした公式/community sourceを更新し、staleまたは重複したcompatibility rowを除去した結果、resource indexはv1.28.0、2648 resources、24 sourcesへ更新しました。今回はsource-filtered scanのためindex全体のfreshness dateは2026-07-30のまま維持します。

- 🪝 **Plugin Hook Install Namespacing** - Plugin-owned generic `hooks/hooks.json` resources now install as `<plugin>-hooks.json`, using one shared runtime/generator rule. Nested plugin children now bind to the longest matching plugin root before a repository-root marketplace fallback, so `build-perf-cpp` skills and hooks belong to its own manifest while manifest-free Spark skills remain marketplace-owned. This removes the previously grandfathered cross-source `hook:hooks.json` collision for existing Anthropic, AWS, Compound Engineering, and OMX resources as well as the new Copilot source / plugin所有のgenericな`hooks/hooks.json`を、runtime/generator共通規則で`<plugin>-hooks.json`へインストールするようにしました。nested plugin childはrepository rootのmarketplace fallbackより最長一致plugin rootを優先するため、`build-perf-cpp`のskill/hookは自身のmanifestへ帰属し、manifestを持たないSpark skillだけがmarketplace帰属になります。これにより新しいCopilot sourceだけでなく、Anthropic、AWS、Compound Engineering、OMXでgrandfatherされていたcross-source `hook:hooks.json` collisionも解消しました。

- 📊 **Per-host Plugin State and Installed-first Management** - The plugin host picker now checks each available host independently and shows Installed with version, Enabled/Disabled only when known, Not installed, or State unavailable/error. Recommended remains first, then installed compatible hosts are ordered before hosts without the plugin, while a failed state probe is never auto-recommended. VS Code state is read directly from installed resource metadata and combines the exact `chat.pluginLocations` entry with the global plugin switch instead of relying on an uninitialized TreeView cache. Claude Code and Codex management now start from host-reported installed IDs and resolve only exact verified `plugin@marketplace` catalog identities, including marketplace aliases that differ from manifest names. Every host probe and identity resolution has a bounded timeout, and one failure does not block the rest / plugin host pickerで利用可能な各hostの状態を独立確認し、version付きインストール済み、確定できる場合だけ有効/無効、未インストール、状態不明/取得失敗を表示します。おすすめは最上段を維持し、それ以外ではインストール済み互換hostを未導入hostより上へ置き、状態probe失敗hostは自動でおすすめしません。VS Code状態は未初期化のTreeView cacheに頼らずinstalled resource metadataを直接読み、正確な`chat.pluginLocations` entryとglobal plugin switchを組み合わせます。Claude Code/Codex管理はhostが返すinstalled IDを起点に、manifest名と異なるmarketplace aliasも含めて検証済み`plugin@marketplace` catalog identityだけを表示します。各host probeとidentity解決にはtimeoutを設け、1hostの失敗が他を止めません。

- 🚀 **Native Claude Code, Codex, and Cursor Lifecycle** - The earlier safe handoffs in this Unreleased section are now promoted when the corresponding host is available. A standalone Claude Code CLI provides marketplace install, list, update, enable, disable, and uninstall with user/project/local scopes; extension-only environments still open Claude's `/plugins` UI. Codex CLI 0.146+ provides marketplace add/list plus plugin add/list/remove, with the ChatGPT Plugins Directory retained as the extension-only fallback. Cursor, when this extension runs inside Cursor, now copies complete Agent Plugin or Cursor Plugin packages into `~/.cursor/plugins/local/<name>`, stores an ownership fingerprint, refuses overwrite, and deletes only unchanged copies it owns. Every CLI mutation runs through a one-use approved command runner bound to executable realpath/version, argv, cwd, sanitized environment, origin, and target paths / このUnreleased節で先に追加した安全なHandoffを、対応hostが利用可能な場合はNative lifecycleへ昇格しました。standalone Claude Code CLIではuser/project/local scopeのmarketplace install、list、update、enable、disable、uninstallを提供し、拡張だけの環境では従来どおり`/plugins` UIを開きます。Codex CLI 0.146以降ではmarketplace add/listとplugin add/list/removeを提供し、拡張だけの場合はChatGPT Plugins Directoryへフォールバックします。Cursor上でこの拡張を動かす場合は、完全なAgent Plugin / Cursor Plugin packageを`~/.cursor/plugins/local/<name>`へコピーし、所有fingerprintを保存して上書きを拒否し、未変更の所有copyだけを削除します。全CLI mutationは、実行ファイルrealpath/version、argv、cwd、sanitize済みenvironment、origin、target pathへ束縛されたone-use approved runnerを通ります。

- 🧭 **Recommended Plugin Hosts and Safe Fallbacks** - Plugin installs now order compatible hosts with a new `resourceNinja.defaultPluginHost` preference: `auto` recommends a detected native host, `ask` leaves every choice neutral, and explicit User preferences appear first. Workspace values are suggestion badges only and never preselect an external action. VS Code / GitHub Copilot Chat, GitHub Copilot CLI, standalone Claude Code CLI, Codex CLI 0.146+, and Cursor local plugins use native paths. Claude Code or Codex environments that have only the VS Code extension fall back to their official plugin UI. Complete source-resolved packages are required before any external host appears / plugin installの互換hostを、新しい`resourceNinja.defaultPluginHost`設定で並べられるようにしました。`auto`は検出済みNative hostをおすすめし、`ask`は全候補を中立表示、User設定で明示したhostは最上段へ置きます。Workspace値は提案badgeとして表示するだけで、外部操作を事前選択しません。VS Code / GitHub Copilot Chat、GitHub Copilot CLI、standalone Claude Code CLI、Codex CLI 0.146以降、Cursor local pluginsはNative導線を使い、Claude CodeまたはCodexのVS Code拡張だけがある環境では公式plugin UIへフォールバックします。外部hostを表示する前に、完全でsource解決済みのpackageであることを必須にします。

- 🧱 **Multi-host Plugin Foundation** - Added a pure plugin artifact, host capability, adapter registry, recommendation resolver, executable discovery, and one-use execution intent foundation. Artifact metadata separates completeness, provenance, marketplace identity, local-copy versus host-resolved content, and per-host support levels so manifest discovery alone is never treated as a successful install. The execution gate binds executable realpath and version, arguments, working directory, sanitized environment, target paths, origin, and resource identity; rejects replay or post-approval changes; and now controls Copilot CLI, Claude Code, Codex, and Cursor local-copy mutations / pureなplugin artifact、host capability、adapter registry、おすすめresolver、実行ファイル検出、one-use execution intent基盤を追加しました。artifact metadataは完全性、provenance、marketplace identity、local-copyとhost-resolved、host別対応レベルを分離し、manifestを見つけただけでinstall成功と扱わないようにします。execution gateは実行ファイルrealpath/version、引数、working directory、sanitize済みenvironment、target path、origin、resource identityを束縛し、再利用や承認後の差し替えを拒否します。現在はCopilot CLI、Claude Code、Codex、Cursor local-copy mutationをこの境界で制御します。

- 🧩 **Copilot CLI Plugin Manifest Layout** - Plugin discovery now recognizes `.github/plugin/plugin.json` and `.github/plugin/marketplace.json`, including the extra marker depth when resolving the package root for scanning and deletion. A Copilot CLI plugin using its documented `.github/plugin/` layout can therefore appear as an installable plugin instead of being missed / plugin 検出で `.github/plugin/plugin.json` と `.github/plugin/marketplace.json` を認識し、scan と削除の package root 解決でも marker の深さを正しく扱うようにしました。Copilot CLI の公式 `.github/plugin/` layout を使う plugin も見落とされず、インストール可能な plugin として表示されます。

- 🧭 **Copilot CLI Marketplace Plugin Management** - An explicit Agent Plugin install now lets you choose the existing VS Code path or delegate to GitHub Copilot CLI. The CLI path reads the repository's official `marketplace.json`, requires one exact plugin-root match, validates the plugin and marketplace names, checks that an existing marketplace alias still points to the same GitHub repository, and runs `marketplace add` plus `plugin@marketplace` without a shell. It never uses direct repository install or writes Copilot CLI's registry files itself. A modal warns that plugins may load skills, agents, hooks, MCP servers, and LSP servers. Failed installs remove only a marketplace added by that operation and only after re-proving its repository ownership; an explicit uninstall command removes the plugin but keeps its marketplace / Agent Plugin の明示インストール時に、従来の VS Code 向け導線か GitHub Copilot CLI への委譲を選べるようにしました。CLI 導線はリポジトリの正式な `marketplace.json` を読み、plugin root と一意に一致する entry、plugin / marketplace 名、既存 marketplace alias の GitHub repository 一致を検証してから、shell を介さず `marketplace add` と `plugin@marketplace` を実行します。リポジトリからの direct install や Copilot CLI registry file の直接編集は行いません。確認ダイアログでは skills、agents、hooks、MCP servers、LSP servers が読み込まれ得ることを警告します。失敗時はその操作が追加し、かつ cleanup 直前にも repository 所有を確認できた marketplace だけを削除します。明示的な uninstall command は plugin のみを削除し、marketplace は残します。

- 🔌 **Register Installed Plugin Locations** - Installing a `plugin` resource can now add its folder to the VS Code `chat.pluginLocations` setting, which is the only place VS Code loads local Agent Plugins from, so an installed plugin no longer stays inactive. The new `resourceNinja.registerPluginLocation` setting chooses `always`, `prompt` (default), or `never`; a batch install asks once for every plugin it installed; the entry is always written to user settings because the key is a machine-specific absolute path; nothing is asked and nothing is written when every folder is already registered and enabled; registering forces the folders you asked for to `true` — including one you had previously disabled, because otherwise the plugin still would not load after a message said it was registered — while every other entry keeps its value, so a location you disabled and did not ask to register stays disabled; the setting is re-read after you answer the prompt, so a change made in another window while the dialog was open is not discarded; deleting a plugin group removes only the registered entries the deleted files actually lived under, which now includes a plugin installed to a custom target folder, and never an unrelated entry; and `chat.plugins.enabled` is never changed, only reported when it is off; nothing is asked and nothing is written on a VS Code older than 1.116, which is the first version that registers `chat.pluginLocations`, so the question is never raised where the answer could not be honored; the prompt names `chat.pluginLocations` and says the entry goes into your user settings; and the success notification carries an **Open chat.pluginLocations** button so you can see and undo what was written / `plugin` リソースのインストール時に、そのフォルダーを VS Code の `chat.pluginLocations` 設定へ登録できるようにしました。VS Code はここに登録されたパスからのみローカル Agent Plugin を読み込むため、インストール済み plugin が読み込まれないままになる問題を解消します。新設定 `resourceNinja.registerPluginLocation` で `always` / `prompt`（既定）/ `never` を選べ、まとめてインストールした場合も確認は 1 回だけです。キーはマシン固有の絶対パスのため常にユーザー設定へ書き込み、すべてのフォルダーが既に登録済みかつ有効なら確認も書き込みも行いません。登録操作では、指定したフォルダーを（以前に無効化していた場合も含めて）`true` にします。そうしないと「登録しました」と表示されても plugin が読み込まれないためです。指定していない他のエントリは値をそのまま保つので、自分で無効化した場所は無効のまま残ります。設定は確認ダイアログに答えた後で読み直すため、ダイアログを開いている間に別ウィンドウで加えられた変更を破棄しません。plugin グループの削除時は、削除したファイルが実際に配置されていた登録済みエントリだけを削除し、custom ターゲットへインストールした plugin も対象になります。無関係なエントリは削除しません。`chat.plugins.enabled` は変更せず、false の場合に通知でお知らせするだけです。`chat.pluginLocations` を登録する最初のバージョンは VS Code 1.116 のため、それより古いバージョンでは確認も書き込みも行わず、反映できない質問をしません。確認メッセージには `chat.pluginLocations` という設定名と、ユーザー設定へ書き込むことを明記しました。登録完了の通知には **chat.pluginLocations を開く** ボタンを追加し、書き込んだ内容の確認と取り消しができます。

### Fixed

- 🔌 **Deleting A Plugin Any Other Way Also Clears Its Location** - Removing an installed plugin folder used to clear its `chat.pluginLocations` entry only through **Delete Plugin Resources**. Deleting the plugin row from the User / Global Resource Home view, or uninstalling it from the browse view, left the setting pointing at a folder that no longer exists. The unregistration now lives in one shared helper that every delete path calls, so the entry goes with the folder no matter which action removed it; this includes a skill uninstall, because the skills directory is a configurable path and a folder deleted under it can be a plugin, and it stays a no-op for a folder the setting never listed. It still removes only the registered entries the deleted folder actually lived under — including a plugin installed to a custom target — and never an unrelated one, and it now also removes the entries registered inside a deleted directory, so deleting a folder that holds plugin folders no longer leaves every one of them registered at a path that is gone, while a sibling whose path merely shares a prefix is left alone. It still writes to your user settings, and still does nothing on a VS Code older than 1.116. Reinstalling a plugin now offers the registration again for the folder the install actually created, instead of leaving the plugin installed but no longer loaded: the destination is the one the install itself reports having written to, so a setting changed while the reinstall was in progress can no longer register a folder that was never created, which matters because a plugin found under a configured user data directory is always reinstalled into the fixed global resource home `plugins` directory, so the old entry is dropped with the old folder and the new location is the one offered. The offer goes through the normal install prompt, so `resourceNinja.registerPluginLocation` still decides and a reinstall never registers silently when you chose `never`. Every install path now takes the destination from the install itself, including a batch install, which used to recompute it after the install had already run and so could register a folder a setting change had moved. Removing an entry now stops at the nearest folder carrying the plugin's name, so a workspace folder that happens to repeat that name keeps its own registration. And a plugin whose files could not all be downloaded is no longer registered at all: the partial folder is left for you to inspect, the warning about the missing files is unchanged, and a batch install counts it with the failures it already reports instead of quietly activating an empty plugin / インストール済み plugin のフォルダーを削除したとき、`chat.pluginLocations` のエントリが消えるのは **プラグインのリソースを削除** からだけでした。User / Global Resource Home ビューで plugin の行を削除した場合や、ブラウズビューからアンインストールした場合は、存在しないフォルダーを指したまま設定が残っていました。登録解除処理を共有ヘルパーへ集約してすべての削除経路から呼ぶようにしたため、どの操作で削除してもエントリがフォルダーと一緒に削除されます。skills ディレクトリは設定で変更できてその配下の削除対象が plugin になり得るため、skill のアンインストールも同じヘルパーを呼びます（設定に載っていないフォルダーでは何もしません）。削除したフォルダーが実際に属していた登録エントリだけを対象とする点（カスタムターゲットへインストールした plugin を含む）、無関係なエントリに触れない点、ユーザー設定へ書き込む点、VS Code 1.116 未満では何もしない点は従来どおりです。加えて、削除したディレクトリの内側に登録されていたエントリも削除するようになり、plugin フォルダーを含むディレクトリを削除したときに、存在しないパスの登録が残らなくなりました（パスの先頭が一致するだけの兄弟フォルダーには触れません）。再インストールでは、インストールが実際に作成したフォルダーに対して登録を再度提案するようにし、plugin がインストール済みなのに読み込まれない状態を解消しました。宛先はインストール自身が報告した書き込み先を使うため、再インストール中に設定が変わっても、作成されていないフォルダーを登録することはありません。設定した user data ディレクトリ配下で見つかった plugin は必ず固定のグローバルリソースホーム `plugins` ディレクトリへ再インストールされるため、古いフォルダーとともに古いエントリを削除し、新しい場所を提案します。提案は通常のインストールと同じ導線を通るため、`resourceNinja.registerPluginLocation` の設定が引き続き効き、`never` を選んでいる場合に再インストールが黙って登録することはありません。宛先はどのインストール経路でもインストール自身の報告値を使うようにし、インストール後に宛先を計算し直していたまとめてインストールでも、設定変更でインストール先が変わったフォルダーを登録することがなくなりました。エントリの削除は plugin 名を持つ最も近いフォルダーで止まるようにし、同じ名前を繰り返すワークスペースフォルダーの登録が巻き添えで消えなくなりました。さらに、一部のファイルをダウンロードできなかった plugin は登録しないようにしました。中身を確認できるようフォルダーはそのまま残し、欠落を知らせる警告も従来どおり表示し、まとめてインストールでは既存の失敗件数に数えるため、空の plugin が黙って有効化されることはありません

- 🧩 **Installed Plugins Appear In The Installed View** - A `plugin` resource installed as a whole package under `.github/plugins/<name>/` was copied to disk but never scanned, so it did not show up anywhere in this extension and its **Delete Plugin Resources** action — the action that also removes the folder from `chat.pluginLocations` — could not be reached. The workspace scan now reads each installed plugin's manifest, including the `.claude-plugin/`, `.codex-plugin/`, `.cursor-plugin/`, and `.plugin/` marker forms as well as `plugin.json`, `gemini-extension.json`, `apm.yml`, and `apm.yaml`, and the plugin appears under **Plugin Origins**. Only the manifest is read: the skills, agents, and MCP config a plugin ships stay part of their package instead of being listed a second time as standalone resources, and installing an individual child resource out of a plugin is unchanged. Deleting an installed plugin now moves the whole plugin folder to the trash instead of only its manifest, so the copied package is no longer left behind as an orphaned directory; the folder is resolved from the manifest — including the marker forms, where the plugin root is the directory above `.claude-plugin/` and friends — and the delete still refuses any target that resolves outside the resource root the plugin was scanned from. The User / Global Resource Home scan now follows the same rule: it used to walk into an installed plugin folder and list that plugin's own skills, agents, hooks, and MCP config as standalone user resources, so the same plugin showed a different resource count depending on scope and invited you to delete a piece of a package that VS Code already loads through `chat.pluginLocations`. It now stops at the plugin folder and lists only the manifest, so a plugin looks identical in every scope; the plugin itself still appears under **Plugin Origins**, and **Delete Plugin Resources** still removes the whole folder and its `chat.pluginLocations` entry. A package that ships several accepted manifests at once — `awslabs/agent-plugins` ships both `.claude-plugin/` and `.codex-plugin/`, and a package can carry a root `plugin.json` beside `gemini-extension.json` or `apm.yml` — is now one row instead of one row per manifest, and every scope picks the same manifest through a single shared precedence that ranks the marker forms above the root forms. The User / Global Resource Home guard is also scoped correctly now: it collapses only `<Global Resource Home>/plugins/<name>/`, so a `plugins` directory nested deeper in the tree, such as one inside a skill, keeps its recursive walk instead of having its contents hidden, and the directory name is matched case-insensitively so an install directory that a case-insensitive filesystem serves as `Plugins` is collapsed like any other / `.github/plugins/<name>/` へパッケージ一式としてインストールした `plugin` リソースは、ファイルはコピーされてもスキャン対象外だったため拡張機能上のどこにも表示されず、`chat.pluginLocations` からの登録解除も行う **プラグインのリソースを削除** も実行できませんでした。ワークスペーススキャンがインストール済み plugin の manifest（`plugin.json` / `gemini-extension.json` / `apm.yml` / `apm.yaml` と `.claude-plugin/` / `.codex-plugin/` / `.cursor-plugin/` / `.plugin/` のマーカー形式）を読み取るようにし、**プラグイン由来** に表示されるようにしました。読み取るのは manifest だけで、plugin に含まれる skills / agents / MCP config は単独リソースとして二重に並ばずパッケージの一部のままです。plugin 内の個別リソースをインストールする動作は変更していません。また、インストール済み plugin の削除では manifest だけでなく plugin フォルダー全体をごみ箱へ移動するようにし、コピーされたパッケージが孤立したディレクトリとして残らないようにしました。フォルダーは manifest から解決し（マーカー形式では `.claude-plugin/` などの 1 つ上のディレクトリが plugin root です）、削除対象がスキャン元のリソース root の外に解決される場合は、これまでどおり削除を拒否します。ユーザー / グローバル リソース ホームのスキャンも同じ扱いに揃えました。従来はインストール済み plugin のフォルダー内部まで再帰的に走査し、その plugin 自身の skills / agents / hooks / MCP config を単独のユーザーリソースとして列挙していたため、同じ plugin でもスコープによってリソース数が変わり、VS Code が `chat.pluginLocations` 経由ですでに読み込んでいるパッケージの一部を個別に削除できてしまう状態でした。今後は plugin フォルダーで走査を止めて manifest だけを列挙するため、どのスコープでも同じ見え方になります。plugin 自体は引き続き **プラグイン由来** に表示され、**プラグインのリソースを削除** はフォルダー全体と `chat.pluginLocations` の登録を削除します。また、`awslabs/agent-plugins` のように `.claude-plugin/` と `.codex-plugin/` を同梱する場合や、root の `plugin.json` と `gemini-extension.json` / `apm.yml` を併せ持つ場合など、1 つのパッケージが複数の manifest を持っていても manifest ごとに行が増えず 1 行になり、marker 形式を root 形式より優先する単一の共通ルールにより、どのスコープでも同じ manifest が選ばれます。User / Global Resource Home 側の判定範囲も修正し、`<Global Resource Home>/plugins/<name>/` だけを畳むようにしました。skill の中など、より深い階層にある `plugins` ディレクトリは中身が隠れず再帰的に走査され、大文字小文字を区別しないファイルシステムで `Plugins` として見えるインストール先も同様に畳まれます。

## [0.2.43] - 2026-08-13

### Added

- 📚 **Refreshed Azure Skills Catalog** - The bundled resource index now carries 2572 resources, picking up `azure-kubernetes-app-deploy` that the upstream `microsoft/azure-skills` repository added after the previous scan / 同梱リソース index を 2572 件に更新し、前回スキャン以降に上流 `microsoft/azure-skills` へ追加された `azure-kubernetes-app-deploy` を取り込みました。

- 🧩 **Agent Plugins 1.0.0 Manifests** - A `plugin.json` is now recorded as the `agent-plugins` manifest kind instead of a generic plugin manifest when it declares `$schema` exactly `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json` and satisfies the manifest rules the specification makes fatal: a `name` of 1-64 characters of lowercase letters, digits, hyphens, and periods that starts and ends with a letter or digit and contains no `--` or `..`; string `version`, `description`, `homepage`, `repository`, and `license` when present; a `keywords` array of strings; and an `author` object whose only fields are `name`, `email`, and `url`, each a string. Nothing else is checked, because the specification requires an unknown top-level field and a non-object `extensions` to be ignored rather than rejected, forbids inspecting the contents of `extensions` members, and forbids rejecting a manifest merely because `version` is not SemVer, `license` is not an SPDX identifier, or a URL or email field is not in a recognized format. A manifest that declares the schema but breaks one of the fatal rules keeps the plain `plugin` manifest kind and stays in the catalog, with the violated rule prefixed to its description as `[Agent Plugins 1.0.0: <reason>]` and also written to the **Agent Resources Ninja** Output Channel on every index update that parses it, so an install is never offered as conformant when a conformant client would reject the whole plugin. A conformant manifest that carries no description of its own is described as `Agent Plugins 1.0.0 manifest for <name>`. The schema value is only compared as an exact string because the specification forbids retrieving the schema while a plugin is being loaded, so nothing is fetched and a future Agent Plugins schema version is recorded as a plain plugin. `.claude-plugin/`, `.codex-plugin/`, `.cursor-plugin/`, and `.plugin/` marker manifests keep their existing path-derived kind / `$schema` が `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json` と完全一致し、かつ仕様が fatal とする manifest ルール（小文字英字・数字・ハイフン・ピリオドで 1〜64 文字、先頭と末尾は英数字、`--` と `..` を含まない `name`、存在する場合は文字列の `version` / `description` / `homepage` / `repository` / `license`、文字列配列の `keywords`、`name` / `email` / `url` だけを持ち各値が文字列の `author` オブジェクト）を満たす `plugin.json` を、汎用の plugin manifest ではなく `agent-plugins` manifest kind として記録するようにしました。これ以外は検査しません。仕様は未知のトップレベルフィールドと非オブジェクトの `extensions` を拒否せず無視することを求め、`extensions` の中身の検査を禁じ、`version` が SemVer でない、`license` が SPDX 識別子でない、URL や email の形式が認識できないという理由だけでの拒否も禁じているためです。schema を宣言していても fatal なルールに違反する manifest は通常の `plugin` manifest kind のままカタログに残し、違反したルールを description の先頭に `[Agent Plugins 1.0.0: <理由>]` として付け、その manifest を解析するインデックス更新のたびに **Agent Resources Ninja** Output Channel にも出力します。仕様準拠クライアントが plugin 全体を拒否するものを、適合済みとして提示しません。適合していて説明を持たない manifest は `Agent Plugins 1.0.0 manifest for <name>` と表示します。仕様は plugin 読み込み時に schema を取得することを禁じているため、値は文字列の完全一致だけで判定し、取得は行いません。将来の Agent Plugins schema バージョンは通常の plugin として記録します。`.claude-plugin/` / `.codex-plugin/` / `.cursor-plugin/` / `.plugin/` のマーカー manifest は従来どおりパス由来の kind を保ちます。
- 🔌 **Plugin MCP and Hook Locations** - A plugin's `.mcp.json` is now indexed as an MCP config resource, and a `hooks.json` at the plugin root is now indexed as a hook resource, so Copilot-style plugins expose the same child resources as the `mcp.json` and `hooks/<name>.json` layouts already did / plugin 直下の `.mcp.json` を MCP config リソースとして、plugin root の `hooks.json` を hook リソースとして index するようにしました。Copilot 形式の plugin でも、`mcp.json` や `hooks/<name>.json` 配置と同じ子リソースが見えるようになります。

### Changed

- 🗂️ **Nested Plugin Manifests** - `plugin.json`, `gemini-extension.json`, `apm.yml`, and `apm.yaml` are now recognized by file name at any depth instead of only at the repository root, and the plugin root resolves to the directory that holds the manifest. A `plugins/<name>/plugin.json` layout is therefore indexed as its own plugin package rooted at `plugins/<name>` rather than being missed or attributed to the repository root / `plugin.json` / `gemini-extension.json` / `apm.yml` / `apm.yaml` を、リポジトリ root だけでなく任意の階層でファイル名から認識するようにし、plugin root は manifest を含むディレクトリとして解決するようにしました。`plugins/<name>/plugin.json` 形式は、見落としやリポジトリ root への誤帰属ではなく、`plugins/<name>` を root とする独立した plugin package として index されます。

### Fixed

- 🛡️ **Downloads Stay Inside The Install Root** - File and directory names come from third-party repositories, and a name such as `..\..\..\evil.txt` is a single valid file name in git that turns into real separators on Windows, so a download could write outside the resource being installed. Every remote entry name is now checked before it becomes a local path: `.`, `..`, a name containing `/`, `\`, `:`, a NUL byte or another control character, a name ending in a dot or a space, and a Windows reserved device name such as `CON` or `COM1` are skipped with a warning in the **Agent Resources Ninja** Output Channel while the remaining entries still install, as the Agent Plugins 1.0.0 specification requires. Each resolved destination is additionally asserted to stay inside the download root, and every recursive delete reachable from an uninstall or an install rollback now refuses to run when its target resolves outside the root that operation is allowed to touch. A file named exactly `.skill-meta.json` or `.resource-ninja.json` that arrives inside a downloaded directory is now skipped instead of installed, while a repository file that merely ends with that suffix, such as `payload.resource-ninja.json`, still installs normally. More importantly, a filesystem path is never taken from sidecar content anywhere in the read path: every reader of `.skill-meta.json` now drops the recorded `skillFilePath` and `relativePath`, and the scan overwrites them with where it actually found the resource, so a sidecar already sitting on disk — placed by a repository before the download-time skip existed, or restored from a backup — can no longer supply the absolute path a later uninstall would delete; an uninstall handed an absolute path is now bounded by the roots this extension installs into (the workspace folder, the configured resources directory and additional resource roots, the configured global resource home, and the VS Code user data directories) instead of by the delete target's own parent. A resource whose dependent file was rejected is no longer reported as a clean install either: the rejection is recorded as `incomplete` in `.skill-meta.json` and raised to the caller, exactly as an install that only wrote the generated template already was. `CONIN$`, `CONOUT$`, and the superscript forms `COM¹` and `LPT¹` that Win32 resolves to the `COM1` and `LPT1` devices are rejected as reserved names as well / ファイル名やディレクトリ名は第三者リポジトリ由来で、`..\..\..\evil.txt` のような名前は git 上は 1 つの正当なファイル名でありながら Windows では実際の区切り文字になるため、インストール対象の外へ書き込めてしまう状態でした。リモートの entry 名をローカルパスにする前に検証し、`.` / `..`、`/` `\` `:` や NUL などの制御文字を含む名前、末尾がドットまたは空白の名前、`CON` や `COM1` などの Windows 予約デバイス名をスキップして **Agent Resources Ninja** Output Channel に警告を出し、Agent Plugins 1.0.0 仕様どおり残りの entry はインストールを継続します。解決後の書き込み先がダウンロード root の内側に収まることも併せて検証し、アンインストールとインストールのロールバックから到達する再帰削除は、対象がその操作に許された root の外へ解決された場合に実行を拒否するようにしました。ダウンロードしたディレクトリに含まれる `.skill-meta.json` / `.resource-ninja.json` は、その 2 つのファイル名完全一致のときだけインストールせずにスキップし、`payload.resource-ninja.json` のように末尾が一致するだけのリポジトリファイルは通常どおりインストールします。さらに重要な点として、読み取り経路のどこでも sidecar の内容からファイルシステムパスを受け取らないようにしました。`.skill-meta.json` の全読み取り箱所で記録済みの `skillFilePath` / `relativePath` を破棄し、走査側が実際に見つけた場所で上書きするため、ダウンロード時のスキップが入る前に置かれたりバックアップから戻ったりして既にディスク上にある sidecar でも、後のアンインストールで削除される絶対パスを与えられなくなります。絶対パスを渡されたアンインストールは、削除対象自身の親ではなく、この拡張機能がインストール先に使う root（ワークスペースフォルダー、設定されたリソースディレクトリと追加リソース root、設定されたグローバルリソース home、VS Code のユーザーデータディレクトリ）で境界を取ります。依存ファイルが拒否されたリソースも成功としては返さず、生成テンプレートだけが残ったインストールと同じく `.skill-meta.json` へ `incomplete` を記録して呼び出し元へ失敗を返します。Win32 が `COM1` / `LPT1` デバイスとして解決する `COM¹` / `LPT¹` などの上付き数字形式と、`CONIN$` / `CONOUT$` も予約名として拒否します。

## [0.2.42] - 2026-08-08

### Fixed

- 🔒 **Overlapping Updates No Longer Drop An Entry** - `AGENTS.md`, `hooks.json`, and `mcp.json` are rewritten in full, and commands, configuration changes, the chat participant, and the language-model tools all trigger those rewrites independently. Two overlapping passes could read the same starting state and let the later write discard what the earlier one had just added, so a freshly installed resource could silently go missing from the generated block. Each of those files now has a serialized in-process update queue that also covers the section-removal and hook-config restore paths. Two VS Code windows on the same workspace are still independent processes / `AGENTS.md` / `hooks.json` / `mcp.json` は毎回まるごと書き直しており、コマンド、設定変更、チャット参加者、言語モデル用ツールがそれぞれ独立にその書き直しを起動します。処理が重なると同じ開始状態を読み、後の書き込みが直前の追加を捨てることがあり、インストール直後のリソースが生成ブロックから黙って消える場合がありました。これら 3 ファイルごとにプロセス内の直列化キューを設け、セクション削除と hook config 復元の経路も対象にしました。同じワークスペースを開いた 2 つの VS Code ウィンドウは別プロセスのままです。

- 🛡️ **Untrusted Resource Text Cannot Break The Generated Block** - Resource names, descriptions, sources, and paths come from third-party repositories and are written into the generated instruction file and ref catalogs, which an agent loads on every turn. They are now collapsed to a single line, stripped of HTML comment delimiters, and escaped in the table cell, the markdown link label, and the link destination, so a resource can no longer break out of its row, inject a heading, or terminate the managed section. The resource tables returned to the language model are escaped the same way. Six descriptions in the bundled index already contained a line break / リソースの name / description / source / path は第三者リポジトリ由来で、エージェントが毎ターン読み込む instruction file と ref カタログに書き込まれます。これらを 1 行へ畳み、HTML コメント記号を無効化し、テーブルセル・Markdown リンクのラベル・リンク先をエスケープするようにしました。行から抜け出して見出しを注入したり、管理ブロックを終端させたりできなくなります。言語モデルへ返すリソース表も同じ経路でエスケープします。同梱インデックスの 6 件は既に改行を含んでいました。

- 🧱 **Placeholder Installs Are Failures** - A skill install that could only write the generated template is no longer reported as success. It records `incomplete` in `.skill-meta.json`, raises a failure so batch summaries count it, and offers `Reinstall` / `Update Index` / `Report Bug` / `Delete`. Bulk operations and the language-model install tool stay silent and report the failure in their own summary / 生成テンプレートしか書けなかった skill インストールを成功として扱わなくなりました。`.skill-meta.json` に `incomplete` を記録し、失敗として扱うためバッチ集計にも反映され、`再インストール` / `インデックス更新` / `バグ報告` / `削除` を提示します。一括操作と言語モデル用インストールツールではダイアログを出さず、それぞれのサマリで失敗として報告します。
- 🔑 **Credential Fallback From Any Source** - A failed GitHub request now walks every credential source instead of only continuing when the failed token came from SecretStorage, so a stale environment variable, `gh` CLI, or legacy setting no longer makes a private repository look like a 404. Tokens already tried are excluded so the walk cannot ping-pong between sources / GitHub リクエストの失敗時に、失敗したトークンが SecretStorage 由来のときだけでなく全ての認証ソースを順に試すようになりました。環境変数、`gh` CLI、旧設定のトークンが古い場合でも private repository が 404 に見えなくなります。試行済みトークンは除外するため、同じソース間を往復しません。

### Added

- ⏱️ **Rate-limit Backoff** - GitHub requests now retry `429`, `502`, `503`, and `504` with a single bounded backoff layer that honors `Retry-After` and `x-ratelimit-reset`, gives up rather than waiting more than 20 seconds, and never retries `401` / `403` / `404` so it cannot fight the credential fallback. Cancellation is honored during the wait / GitHub リクエストが `429` / `502` / `503` / `504` を単一のバックオフ層で再試行するようになりました。`Retry-After` と `x-ratelimit-reset` を尊重し、20 秒を超える待機は諦めます。`401` / `403` / `404` は再試行しないため認証フォールバックと衝突しません。待機中のキャンセルも効きます。
- ⚠️ **Incomplete Resource Visibility** - A resource whose content was never downloaded now shows a warning icon and an `Incomplete` status on every metadata-backed listing: the workspace tree, the user and global resource tree, the reinstall picker, the `/list` chat reply, and the workspace resource tables the language-model tools return, which are also told not to rely on its contents. In every generated list (`AGENTS.md` block, ref catalogs, and the legacy / compact / full sections) the description cell is prefixed with `[incomplete]` so an agent does not trust a broken resource. Skills installed before this flag existed are detected from content already read during the scan / 実体をダウンロードできなかったリソースを、metadata を持つ一覧面すべてで警告アイコンと `不完全` 表示にしました。対象はワークスペースツリー、ユーザー/グローバルリソースツリー、再インストールピッカー、`/list` のチャット応答、言語モデル用ツールが返すワークスペースリソース表で、モデルには内容を信用しないよう伝えます。生成される一覧（`AGENTS.md` ブロック、ref カタログ、legacy / compact / full セクション）では説明欄の先頭に `[incomplete]` を付け、エージェントが壊れたリソースを信用しないようにします。このフラグ導入前に入れた skill も、スキャン時に既に読んでいる本文から判定します。
- 🧪 **Release Guards** - The regression suite now checks that the newest released `CHANGELOG` heading matches `package.json`, and that `CHANGELOG.md`, both READMEs, and both NLS files contain no `U+FFFD` replacement characters. Two replacement characters that had shipped in the `0.2.41` changelog were repaired / 回帰テストで、`CHANGELOG` の最新リリース見出しが `package.json` と一致すること、および `CHANGELOG.md` / README 2 種 / NLS 2 種に `U+FFFD` 置換文字が無いことを検証するようにしました。`0.2.41` の changelog に混入していた置換文字 2 件も修正しました。
- 🔭 **Retry Diagnostics** - Each backoff wait, each credential-source switch, and each retry abandoned because the required wait exceeded the cap is now written to the **Agent Resources Ninja** Output Channel, so a slow source update is explainable instead of silent. Diagnostics carry only the host and path, never a token or a query string, and the request-timeout error was narrowed the same way / バックオフの待機、認証ソースの切り替え、待機上限超過による再試行の打ち切りを **Agent Resources Ninja** Output Channel に出力するようにしました。source 更新が遅いときに理由を追えます。出力するのは host と path だけで、トークンや query string は含みません。リクエストのタイムアウトエラーも同じ形式に絞りました。

### Changed

- 📏 **Marker Fits The Row Budget** - The `[incomplete]` marker is now counted inside the generated row's character budget instead of being prepended after truncation, so a marked row no longer exceeds the documented 200 / 100 character limits / `[incomplete]` マーカーを切り詰めの後ろに付け足すのをやめ、生成行の文字数予算に含めて計算するようにしました。マーカー付きの行が 200 / 100 文字の上限を超えなくなります。

## [0.2.41] - 2026-08-07

### Added

- 🔑 **GitHub Token in SecretStorage** - The GitHub token is now kept in VS Code SecretStorage instead of a settings value. An existing token in the legacy setting is migrated on activation and kept in sync when the setting changes, and a new `Clear Stored GitHub Token` / `保存済み GitHub トークンをクリア` command removes it. The command is available from the Command Palette and is offered directly from the install and index-update recovery dialogs, and it only clears SecretStorage so environment variables and the `gh` CLI credential are left untouched / GitHub トークンを設定値ではなく VS Code SecretStorage で保持するようにしました。旧設定にトークンがある場合は起動時に移行し、設定変更時も同期します。新しい `Clear Stored GitHub Token` コマンドで削除でき、コマンドパレットのほかインストールや index 更新の復旧ダイアログからも実行できます。削除するのは SecretStorage だけで、環境変数や `gh` CLI の認証情報は変更しません。
- 🛡️ **Repository Identity Check** - A source records the GitHub repository id whenever a scan can resolve it, and refuses to update when the URL later resolves to a different repository, so a deleted or renamed-away repository name cannot be re-registered by someone else and silently served as the same source. When GitHub does not return an id the check stays disabled and the skip is logged. Re-adding the source shows a confirmation dialog with an explicit `Approve Repository Change` / `別リポジトリへの差し替えを承認` action / source はスキャンで解決できたときに GitHub の repository id を記録し、以降その URL が別 repository に解決された場合は更新を拒否します。削除や rename 後に同名 repository が第三者へ再登録されても、同じ source として黙って配信されません。id を取得できない場合は検証を無効化してログに残します。同じ source を再追加すると確認ダイアログが出て、明示的に承認できます。
- 🧭 **Declarative Source Scanner** - A source can declare which scan strategy it uses instead of relying on repository-name matching. Repository-name matching remains only as a fallback for sources that do not declare one / source は repository 名の一致に頼らず、使用するスキャン方式を宣言できるようになりました。repository 名一致は未宣言 source 向けの fallback としてのみ残ります。

### Changed

- 🧯 **Empty Scan Protection** - A scan that succeeds but returns no resources no longer wipes that source. A full refresh keeps the existing resources and records it in the output channel, and a single-source refresh reports the result with an `Apply Empty Result` / `空の結果を反映` action so shrinking the index stays an explicit choice / スキャンが成功してもリソースが 0 件だった場合、その source を消さなくなりました。全体更新は既存リソースを保持して output channel に記録し、単一 source 更新は結果を報告して明示操作でのみ縮退できます。
- ⏳ **Stale Refresh Cap** - The startup refresh of stale source indexes now updates at most 5 sources per launch and rotates the starting point, so a large workspace no longer spends its GitHub quota in one go and a repeatedly failing source cannot starve the ones behind it. Deferred sources are listed in the output channel / 起動時の stale source index 更新は 1 回あたり最大 5 source までにし、開始位置をローテーションします。GitHub の quota を一度に使い切らず、失敗し続ける source が後続を止めることもありません。繰り越した source は output channel に出力します。
- 🔗 **Renamed Repository Follow-up** - A source scan resolves the canonical owner and repository name before building request URLs and writes the result back, so a renamed upstream repository keeps working without editing the source / source スキャンはリクエスト URL を組み立てる前に canonical な owner / repository 名を解決して書き戻すため、upstream の rename 後も source を編集せずに使えます。

### Fixed

- 🔐 **GitHub Failure Diagnosis** - An organization SSO failure on a request that was escalated to the authenticated API is now retried anonymously, an exhausted anonymous rate limit is no longer reported as `SSO required`, and code search failures are classified instead of always claiming a rate limit. Rate-limit failures now correctly stop a batch update early / 認証付き API へ昇格したリクエストで発生した組織 SSO エラーも匿名リトライの対象になりました。匿名側のレート制限枯渇が `SSO 認証が必要` と誤表示されることがなくなり、コード検索の失敗も一律 rate limit と断定せず分類します。rate limit 失敗はバッチ更新を正しく早期停止させます。
- 🧩 **Bundled Preset Precedence** - The bundled preset index no longer overwrites the repository facts a scan resolved, so a followed rename is not reverted on every launch, and preset merging tolerates older index files that omit categories or bundles / 同梱プリセット index がスキャンで解決した repository 情報を上書きしなくなり、追従した rename が起動のたびに巻き戻ることがなくなりました。categories や bundles を持たない古い index file もマージできます。

## [0.2.40] - 2026-07-30

### Changed

- ☁️ **Canonical Azure Source** - Consolidated the retired `microsoft/GitHub-Copilot-for-Azure` plugin payload source into `microsoft/azure-skills`, removing 38 stale duplicate resources and refreshing Resource Index v1.27.0 to 2571 resources across 23 sources / 廃止された `microsoft/GitHub-Copilot-for-Azure` plugin payload source を `microsoft/azure-skills` へ統合し、stale な重複リソース38件を削除しました。Resource Index v1.27.0 は23 sources・2571 resourcesです。

### Fixed

- 🔄 **Retired Source Metadata Migration** - Added a compatibility alias so installed skill metadata using the retired Azure source ID resolves to the canonical source during index matching and reinstall / 廃止済み Azure source ID を使うインストール済み skill metadata が index 照合・再インストール時に canonical source へ解決される互換 alias を追加しました。
- 🚦 **Manual Source Update Results** - Explicit full-index updates now force-scan configured sources, advance progress only after each source completes, stop after a classified GitHub rate-limit failure, preserve failed and unattempted source entries, log per-source `OK` / `FAILED` / `SKIPPED` diagnostics, and return one localized partial-result summary to notifications and the Language Model Tool. The authentication recovery action opens the relevant setting directly without a duplicate error dialog / 明示的な全 index 更新は設定済み source を force scan し、各 source の完了後だけ進捗を進め、分類済み GitHub rate limit 後に停止して失敗・未試行 source の既存 entry を保持するようにしました。source ごとの `OK` / `FAILED` / `SKIPPED` 診断を記録し、通知と Language Model Tool へ日英の1件の部分結果 summary を返します。認証復旧 action は重複エラーダイアログを出さず該当設定を直接開きます。

## [0.2.39] - 2026-07-29

### Added

- 🔍 **Source-scoped Installability Audit** - Added `--sources` and `RESOURCE_NINJA_SOURCES` filtering with hard failures for empty or unknown source IDs, allowing stale source migrations to be validated without auditing or pruning unrelated resources / `--sources` と `RESOURCE_NINJA_SOURCES` による絞り込みを追加し、空または未知の source ID はエラーにしました。stale source migration を他リソースの監査・prune と切り離して検証できます。
- 🛡️ **Rate-limit-safe Preset Updates** - Added a credential-free, non-interactive shallow Git fallback when the GitHub Trees API returns `403` or `429`, plus explicit source-synchronized bundle metadata so complete-source bundles update atomically with their allowed resource kinds / GitHub Trees API が `403` または `429` を返した場合に credential を使わない非対話の shallow Git fallback を追加し、complete-source bundle が許可された resource kind と原子的に同期する明示メタデータを追加しました。

### Changed

- 🔄 **PAI to LifeOS Migration** - Kept the compatible `pai-packs` source ID while migrating it to `danielmiessler/LifeOS` under `LifeOS/install/skills` and updating the `pai-kai` bundle to valid LifeOS successor skills / 互換用 `pai-packs` source ID を維持したまま `danielmiessler/LifeOS` の `LifeOS/install/skills` へ移行し、`pai-kai` bundle を実在する LifeOS successor skills へ更新しました。
- ☁️ **Azure Preset Refresh** - Regenerated both official Azure preset sources, removed retired entries such as `azure-rbac`, added current upstream skills, and refreshed Resource Index v1.26.0 to 2609 resources across 24 sources / Microsoft公式Azure preset 2 sourceを再生成し、`azure-rbac` など廃止済みentryを除去して現行upstream skillsを追加しました。Resource Index v1.26.0 は24 sources・2609 resourcesです。

### Fixed

- 🔐 **Private Raw Resource Downloads** - Kept public raw GitHub requests anonymous, retried authenticated private raw downloads once only after an anonymous `404` with redirects disabled, and routed multi-resource file downloads through the shared helper / public raw GitHub request は匿名のまま維持し、匿名 `404` の場合だけ redirect を無効化した認証付き request を1回再試行するようにしました。multi-resource の file download も共通 helper 経由に統一しました。
- 🩹 **Authentication-aware Skill Recovery** - Centralized single-file and directory skill `404` cleanup, distinguished missing authentication from stale paths or missing Contents access, preserved Update Index and Report Bug actions, and kept suppressed recovery free of UI while preventing token leakage in bug reports / skill の単一ファイル・directory `404` cleanup を共通化し、未認証と stale path / Contents 権限不足を区別しました。インデックス更新・バグ報告を維持し、suppression 時は UI を出さず、bug report に token 値を含めません。
- 🧹 **Atomic Non-skill Install Cleanup** - Deferred non-skill directory creation until source resolution and rolled back only newly created file, plugin, hook, and empty parent artifacts after fatal download or metadata failures, while preserving every pre-existing install path / non-skill directory作成をsource解決後まで遅延し、致命的なdownload/metadata失敗時は今回新規作成したfile・plugin・hook・空parentだけをrollbackするようにしました。既存install pathはすべて保持します。
- 🔒 **Development Dependency Security** - Updated transitive development overrides for `brace-expansion`, `js-yaml`, and patched `shell-quote@1.10.0`, added a clean packaged-runtime audit gate, and kept the remaining no-fix `brace-expansion` development advisory visible in the full audit / transitive development overrideの`brace-expansion`、`js-yaml`、修正版`shell-quote@1.10.0`を更新し、packaged runtime用のclean audit gateを追加しました。修正版未提供の`brace-expansion` development advisoryはfull auditで引き続き表示します。

### Tests

- 🧪 Added raw authentication retry, exact-host, suppression, token non-leakage, source filter, scoped apply, LifeOS bundle integrity, Git tree fallback, source-synchronized bundle, and live Azure tree coverage / raw 認証再試行、exact host、suppression、token 非漏洩、source filter、scoped apply、LifeOS bundle 整合、Git tree fallback、source同期bundle、Azure live treeの回帰検証を追加しました。

## [0.2.38] - 2026-07-07

### Fixed

- **Global Home Runtime Directory Noise** - Excluded GitHub Copilot cloud-agent working copies and other runtime state directories under the global home (`~/.copilot`) from resource scanning. In particular, `repos/copilot-worktrees/<repo>/<branch>/.github/skills/**` worktrees checked out by the Copilot cloud agent no longer leak into the tree as global-home resources, while genuine `~/.copilot/skills` and built-in resources keep showing / グローバルホーム（`~/.copilot`）配下の GitHub Copilot cloud agent 作業コピーやランタイム状態ディレクトリを resource スキャンから除外しました。特に Copilot cloud agent が展開する `repos/copilot-worktrees/<repo>/<branch>/.github/skills/**` の worktree がグローバルリソースとしてツリーに混入しなくなり、本来の `~/.copilot/skills` や組み込みリソースは引き続き表示されます。

### Changed

- **Localization Cleanup** - Removed 7 unused `config.*.description` keys from `package.nls.json` and `package.nls.ja.json` that were superseded by `markdownDescription`, keeping the localized settings surface free of dead entries / `markdownDescription` に置き換わって未使用になっていた `config.*.description` キー 7 件を `package.nls.json` と `package.nls.ja.json` から削除し、ローカライズされた設定サーフェスから dead entry を排除しました。

### Tests

- Extended `scripts/test-global-home-routing.js` to assert that `repos` is part of the global-home runtime skip set so Copilot cloud-agent worktrees stay excluded from scanning / `scripts/test-global-home-routing.js` を拡張し、`repos` がグローバルホームのランタイムスキップ対象に含まれること（Copilot cloud agent の worktree がスキャンから除外され続けること）を検証しました。
- Added a dead-key guard in `scripts/test-localization-ux.js` that fails when a `package.nls.json` key is not referenced as `%key%` in `package.json`, preventing future unused localization keys / `scripts/test-localization-ux.js` に dead-key guard を追加し、`package.nls.json` のキーが `package.json` で `%key%` として参照されていない場合に失敗するようにして、将来の未使用ローカライズキーを防止します。

## [0.2.37] - 2026-06-30

### Changed

- **Skill Index Resilience** - Added safe resource index accessors and routed Browse view, Chat Participant, MCP tools, selected command flows, preview, search, instruction sync, and shared-index export through them so malformed runtime index shapes fall back to empty resource arrays with OutputChannel diagnostics instead of `undefined.skills`-style crashes / 安全な resource index accessor を追加し、Browse view、Chat Participant、MCP tools、主要 command flow、preview、search、instruction sync、shared-index export を accessor 経由に寄せました。これにより runtime の index shape が壊れていても `undefined.skills` 系で落ちず、空 resource 配列 fallback と OutputChannel 診断へ退避します。

### Tests

- Added bundled index content validation, direct user-facing/read-only `.skills` read guards, safe accessor and load-recovery regression coverage, index updater mutation-boundary checks, and script-side index shape checks for audit, preset update, and migration flows / bundled index content validation、ユーザー向け・読み取り系 runtime の `.skills` 直参照 guard、安全 accessor と load recovery の回帰テスト、index updater mutation boundary check、audit / preset update / migration flow の script-side index shape check を追加しました。

## [0.2.36] - 2026-06-25

### Added

- **SecretStorage-first GitHub Authentication** - GitHub tokens are now resolved in the order SecretStorage → `GITHUB_TOKEN` / `GH_TOKEN` environment variable → GitHub CLI → legacy `resourceNinja.githubToken` setting. The legacy setting value is migrated into VS Code SecretStorage on startup, synced when changed, and removed on reset, while remaining a backward-compatible fallback / GitHub トークンを SecretStorage → `GITHUB_TOKEN` / `GH_TOKEN` 環境変数 → GitHub CLI → 旧 `resourceNinja.githubToken` 設定 の順で解決するようにしました。旧設定値は起動時に SecretStorage へ移行し、変更時は同期、reset 時は削除しつつ、後方互換の fallback として維持します。

### Changed

- **Install Flow Hardening** - Bounded the `gh auth token` lookup with a timeout, routed Web Search token retrieval through the shared resolver, isolated post-install tree reveal failures so they no longer fail an otherwise successful install, and guarded resource search against an unloaded or malformed index / `gh auth token` 取得に timeout を付け、Web Search のトークン取得を共有 resolver 経由に統一し、インストール後の tree reveal 失敗を分離して成功済みインストールを失敗扱いにしないようにし、未ロード/不正な index に対する resource 検索を guard しました。

### Tests

- Added `scripts/test-github-auth.js` (9 cases) covering SecretStorage precedence, legacy migration, config-change sync, bounded gh CLI exec, and token deletion, and wired it into the `test:resources` suite. Revalidated typecheck, lint, bundle build, resource regression, manifest consistency, localization guards, and npm audit before release / SecretStorage 優先順位、旧設定移行、設定変更同期、bounded gh CLI exec、トークン削除をカバーする `scripts/test-github-auth.js`（9 ケース）を追加し、`test:resources` suite に組み込みました。リリース前に typecheck、lint、bundle build、resource 回帰、manifest consistency、localization guard、npm audit を再検証しました。

## [0.2.35] - 2026-06-24

### Added

- **Stale Source Index Freshness** - Added per-source `lastIndexedAt` metadata, 30-day stale source detection, and startup handling with `resourceNinja.staleSourceIndexUpdateMode` (`always` / `prompt` / `never`) so stale source repositories can be refreshed without reinstalling local files / source ごとの `lastIndexedAt` metadata、30日超の stale source 検出、`resourceNinja.staleSourceIndexUpdateMode`（`always` / `prompt` / `never`）による起動時処理を追加し、ローカルファイルを再インストールせず source repository index を更新できるようにしました。
- **Chat and MCP Runtime i18n Guards** - Localized short Chat Participant and MCP tool responses through runtime helpers, and added guards for source freshness, shared manifest round-trip, startup flow coordination, and i18n helper usage / Chat Participant と MCP tool の短い応答を runtime helper 経由でローカライズし、source freshness、shared manifest round-trip、startup flow coordination、i18n helper 利用の guard を追加しました。

### Fixed

- **Source Refresh Retry Safety** - Stale source prompts now record the daily prompt state only after the user defers or prompt-driven refreshes succeed, keeping failed sources retryable, and MCP tool errors now return sanitized error messages / stale source prompt はユーザーが延期した場合または prompt 経由更新が成功した場合だけ日次状態を記録するようにし、失敗 source を retry 対象に残します。MCP tool error もサニタイズした error message を返すようにしました。
- **Release Script Reliability** - Simplified the package/prepublish scripts to run the production build directly, keeping typecheck and lint as explicit release gates so VSIX packaging is less sensitive to nested npm wrapper behavior on Windows / package/prepublish script を production build 直接実行に簡素化し、typecheck と lint は明示的な release gate として扱うことで、Windows の nested npm wrapper 挙動に VSIX packaging が影響されにくくしました。

### Tests

- Revalidated typecheck, lint, bundle build, resource regression, manifest consistency, localization guards, source freshness tests, shared source manifest tests, When to Use extraction, search logic, npm audit, and VS Code Extension Host smoke before release / リリース前に typecheck、lint、bundle build、resource 回帰、manifest consistency、localization guard、source freshness test、shared source manifest test、When to Use 抽出、検索ロジック、npm audit、VS Code Extension Host smoke を再検証しました。

## [0.2.34] - 2026-06-21

### Added

- **Private Source Repository Support** - Added private GitHub repository indexing for user-added resource sources by falling back from unauthenticated raw file reads to authenticated GitHub Contents API reads for `SKILL.md`, resource files, `bundle.json`, `LICENSE*`, `registry.json`, `docs/search-index.json`, and `.claude/commands/**/*.md` / user-added source repository で private GitHub repository を index できるよう、`SKILL.md`、resource files、`bundle.json`、`LICENSE*`、`registry.json`、`docs/search-index.json`、`.claude/commands/**/*.md` の取得を未認証 raw 読み取りから認証付き GitHub Contents API へ fallback するようにしました。
- **Source Removal Tool** - Added the Agent Mode tool `#removeResourceSource` so agents can remove a source repository by source ID, source name, repository URL, or `owner/repo` without deleting installed workspace, user, or global resource files / Agent Mode tool `#removeResourceSource` を追加し、source ID、source name、repository URL、`owner/repo` から source repository を index から削除できるようにしました。インストール済みの workspace / user / global resource files は削除しません。

### Fixed

- **Source Scan Safety** - Added explicit Git Trees API truncation detection to avoid partial indexes, improved private repository authentication errors, and normalized root-level resource content paths so root `LICENSE` files are fetched correctly / Git Trees API の truncated response を明示エラーにして partial index を避け、private repository authentication error を分かりやすくし、root-level resource の content path を正規化して root `LICENSE` を正しく取得できるようにしました。

### Tests

- Added regression coverage for private source Contents API fallback, public raw fetch behavior, source removal persistence, shared-store synchronization, Git tree truncation failures, and root-level license path normalization / private source の Contents API fallback、public raw fetch、source removal persistence、shared-store synchronization、Git tree truncation failure、root-level license path normalization の回帰テストを追加しました。

## [0.2.33] - 2026-06-21

### Added

- **Oh My Codex Bundled Source** - Added `Yeachan-Heo/oh-my-codex` as a community bundled preset source, path-filtered to the `plugins/oh-my-codex/` distribution plugin so OMX skills, prompts, hooks, and Codex plugin metadata can be discovered without indexing repository internals / `Yeachan-Heo/oh-my-codex` を community bundled preset source として追加し、`plugins/oh-my-codex/` の配布 plugin に path filter することで、repo 内部実装を index せず OMX skills、prompts、hooks、Codex plugin metadata を discovery できるようにしました。

## [0.2.32] - 2026-06-16

### Added

- **Additional Skill Roots** - Added `resourceNinja.additionalSkillRoots` so workspace skill discovery can include separate roots such as `copilot-skills/skills` and `copilot-skills/m-skills` without changing the default install directory / `resourceNinja.additionalSkillRoots` を追加し、既定のインストール先を変えずに `copilot-skills/skills` や `copilot-skills/m-skills` など別 root の workspace skill を discovery 対象にできるようにしました。

### Fixed

- **Skill Root Boundary Checks** - Replaced raw prefix checks with path-boundary-aware workspace root matching so sibling folders such as `.github/skills-old` are not treated as installed skill roots / 生の prefix 判定を path boundary aware な workspace root 判定へ置き換え、`.github/skills-old` のような sibling folder を installed skill root と誤判定しないようにしました。
- **Additional Root Documentation** - Clarified that additional skill roots are root directories, not glob patterns, affect discovery and generated instruction output only, and also honor `skillNinja.additionalSkillRoots` for sibling-extension compatibility / additional skill roots は glob ではなく root directory であり、discovery と生成 instruction output のみに影響し、sibling extension 互換として `skillNinja.additionalSkillRoots` も尊重することを明記しました。

### Security

- **Dependency Audit Cleanup** - Updated development dependencies so `npm audit --audit-level=moderate` reports zero vulnerabilities before packaging / packaging 前の `npm audit --audit-level=moderate` が 0 vulnerabilities になるよう development dependencies を更新しました。

### Tests

- Added regression guards for additional skill root discovery, boundary-aware root matching, README/settings consistency, and mocked path helper consumers, then revalidated compile, resource regression, extension-host smoke, and npm audit before release prep / additional skill root discovery、boundary-aware root matching、README/settings consistency、path helper 利用側 mock の回帰ガードを追加し、release prep 前に compile、resource 回帰、extension-host smoke、npm audit を再検証しました。

## [0.2.31] - 2026-06-14

### Added

- **Google Skills Bundled Source** - Added the official `google/skills` repository as a bundled preset source (31 Google Cloud / Google product skills such as `gemini-api`, `gcloud`, `bigquery-basics`, `cloud-run-basics`, `firebase-basics`), bumping the preset index to `v1.23.0` and updating README source tables, Related Projects, and the skill-index instruction Official basis / 公式 `google/skills` リポジトリを bundled preset source として追加し（`gemini-api`、`gcloud`、`bigquery-basics`、`cloud-run-basics`、`firebase-basics` など Google Cloud / Google プロダクト向け skill 31 件）、preset index を `v1.23.0` に更新し、README の source 表 / Related Projects / skill-index instruction の Official 基準を同期しました。

### Fixed

- **Directory Listing Failure Recovery for Skills** - When the GitHub Contents API directory listing fails with a non-404 error (e.g. SAML / classic PAT 403) and no `SKILL.md` was written, the installer now tries to recover the real `SKILL.md` directly from its raw URL before falling back to the generated template, and never attaches a token to `raw.githubusercontent.com` so public raw fetches are not blocked by org token policies / GitHub Contents API の directory listing が 404 以外（SAML / classic PAT 403 など）で失敗し `SKILL.md` が取得できなかった場合に、template fallback に進む前に raw URL から実体の `SKILL.md` を直接復旧するようにし、`raw.githubusercontent.com` には token を付けず組織 token policy で public raw 取得が落ちないようにしました。

### Tests

- Added `test-skill-installer-remote-fallback.js` covering raw `SKILL.md` recovery, no-token-on-raw enforcement, HTTP-error and short-content rejection, and `remotePath` slash normalization, and wired it into `test:resources` / raw `SKILL.md` 復旧、raw への token 非付与、HTTP エラー / 短すぎる内容の拒否、`remotePath` のスラッシュ正規化を検証する `test-skill-installer-remote-fallback.js` を追加し、`test:resources` に組み込みました。

## [0.2.30] - 2026-05-28

### Fixed

- **Source-Aware Missing Index Recovery** - Reinstall flows now tell users which source index will be refreshed when an installed resource is missing from the current index, and they refresh only the affected source whenever that upstream repository is known instead of presenting a generic full-index update path / 再インストール対象が現在のインデックスに見つからない場合、どの source を更新するかをユーザーへ明示し、upstream repository が分かるときは generic な全体更新ではなく該当 source だけを更新するようにしました。
- **Install-Time Metadata Normalization** - Normalized `source` when writing `.skill-meta.json` and non-skill install sidecars so freshly installed local resources do not keep stale `unknown` metadata until a later refresh path happens to clean them up / `.skill-meta.json` と non-skill sidecar metadata の書き込み時に `source` を正規化し、あとから refresh が走るまで stale な `unknown` が残る経路をなくしました。
- **Plugin Sidecar Preservation in Local Scans** - Local resource scanning now preserves plugin root and manifest metadata from install sidecars, so plugin-derived resources can reconnect to their original package context during reinstall and grouping flows / ローカルリソースのスキャン時に install sidecar 由来の plugin root / manifest metadata を保持するようにし、plugin 由来リソースが再インストールや grouping で元の package context を失わないようにしました。
- **Hook Uninstall Rollback Safety** - Hook uninstall now keeps a `hooks.json` backup and restores it automatically when the hook directory delete fails after config mutation, preventing partial uninstall state where configuration is removed but the installed hook files remain / hook のアンインストールでは `hooks.json` のバックアップを保持し、設定更新後に hook directory の削除が失敗した場合は自動で復元するようにして、設定だけが先に消えてファイルが残る partial uninstall 状態を防ぎました。
- **Batch Reinstall Failure Guards** - Added explicit regression guards for partial-failure reporting in batch reinstall paths so mixed success and failure cases keep warning summaries instead of silently regressing to false-success notifications / batch reinstall で success と failure が混在した場合の warning 集計を回帰テストで固定し、誤って false-success 通知へ戻らないようにしました。

### Tests

- Revalidated compile, resource regression, hook config rollback coverage, README/release UX, manifest consistency, search logic, When to Use extraction, extension-host smoke, npm audit, and one-shot packaging build before release / リリース前に compile、resource 回帰、hook config rollback の動的テスト、README/release UX、manifest consistency、search logic、When to Use 抽出、extension-host smoke、npm audit、one-shot packaging build を再検証しました。

## [0.2.29] - 2026-05-28

### Fixed

- **Localized Search CTA Parity** - Replaced hardcoded `Agent Resources Ninja: Search Resources` literals in generated instruction output and Workspace Resources empty-state hints with runtime-localized copy so package NLS, runtime i18n, README, and TreeView guidance stay aligned across English and Japanese / 生成される instruction output と Workspace Resources の empty-state hint に残っていた `Agent Resources Ninja: Search Resources` 直書きを runtime-localized copy に置き換え、package NLS、runtime i18n、README、TreeView 導線が英日でずれないようにしました。
- **Smoke Launch Guard for Windows Update Mutex** - Added a Windows preflight wrapper for `npm test` that detects the `vscode-updating` mutex and aborts with a clear message instead of launching the known popup/EPIPE path while update activity is still in progress / `npm test` に Windows 向け preflight wrapper を追加し、`vscode-updating` mutex を検出した場合は更新処理中の既知 popup/EPIPE 経路を起動せず、明示メッセージで中断するようにしました。
- **Isolated Extension Host Smoke Sandbox** - Pointed `.vscode-test.mjs` at the machine-installed VS Code executable and isolated `.vscode-test/manual-local-launch` user-data and extensions paths so successful smoke runs are less likely to inherit stale shared test state / `.vscode-test.mjs` を machine-installed な VS Code executable と `.vscode-test/manual-local-launch` 配下の分離 user-data / extensions path に向け、smoke 実行が stale な共有 test state を引き継ぎにくいようにしました。

### Tests

- Added regression guards for the Windows smoke mutex preflight and isolated sandbox contract, then revalidated compile, manifest consistency, README release UX, localization UX, and scope-action UX. `npm test` now exits early with a guarded status while the local `vscode-updating` mutex is held instead of launching the known popup path / Windows smoke mutex preflight と isolated sandbox 契約の回帰ガードを追加し、compile、manifest consistency、README release UX、localization UX、scope-action UX を再検証しました。`npm test` はローカルの `vscode-updating` mutex 保持中、既知 popup 経路を起動せず guard status で早期終了するようになりました。

## [0.2.28] - 2026-05-26

### Fixed

- **Temporary Remote Install Recovery** - Restored remote install behavior for temporary search or preview entries without a persisted source by reconstructing owner or repo or branch or path from raw GitHub URLs, tree URLs, and blob URLs instead of falling back to placeholder content or aborting non-skill installs / 永続 source を持たない検索 or preview 由来の temporary entry でも、raw GitHub URL と tree or blob URL から owner or repo or branch or path を復元して remote install できるようにし、placeholder content へのフォールバックや non-skill install 中断を防ぎました。
- **GitHub Source URL Normalization** - Normalized saved GitHub source URLs to repository roots across add-source, runtime index persistence, and temporary install fallback flows so tree or blob URLs do not survive as source metadata / add-source、runtime index 保存、temporary install fallback の各経路で GitHub source URL を repository root に正規化し、tree or blob URL が source metadata として残らないようにしました。
- **Bundled Remote Catalog Hygiene** - Pruned unreachable bundled remote resources, removed the now-empty goose-official preset source, synchronized release-facing resource counts, and tightened coexistence cleanup so stale `agent-ninja` compressed catalog blocks are stripped from shared ref README files while the current `resource-ninja-catalog` block remains / 到達不能な bundled remote resource を prune し、空になった goose-official preset source を削除して release 向け件数表示を同期しました。さらに shared ref README では stale な `agent-ninja` compressed catalog block を除去しつつ、現在の `resource-ninja-catalog` block は維持するよう coexistence cleanup を強化しました。
- **Release Preflight Guardrails** - Added release preflight guidance and regression coverage for raw-only installability audit and `vsce verify-pat`, reducing the risk of stale presets and expired Marketplace credentials being discovered late in publish / raw-only installability audit と `vsce verify-pat` の release preflight と回帰ガードを追加し、stale preset や期限切れ Marketplace credential の発見が publish 直前まで遅れるリスクを下げました。

### Tests

- Added regression guards for temporary remote install recovery, bundled remote installability audit, compressed coexistence catalog cleanup, and release preflight docs, then revalidated compile, resource regression, manifest consistency, README release UX, raw-only audit, and release hygiene flows before release / temporary remote install recovery、bundled remote installability audit、compressed coexistence catalog cleanup、release preflight docs の回帰ガードを追加し、リリース前に compile、resource 回帰、manifest consistency、README release UX、raw-only audit、release hygiene 系を再検証しました。

## [0.2.27] - 2026-05-23

### Fixed

- **Metadata-less Personal Skill Source Symmetry** - Normalized metadata-less personal skills under Global Resource Home and related user-managed locations to `local` instead of leaving them as `unknown`, so startup index-mismatch warnings no longer treat those personal skills as remote-source anomalies / Global Resource Home や関連する user-managed location 配下の metadata-less personal skill を `unknown` のまま残さず `local` に正規化するようにし、起動時の index mismatch warning がそれらの personal skill を remote-source 異常として扱わないようにしました。
- **Skill Metadata Refresh Source Cleanup** - Applied the same source normalization during bulk metadata refresh, single-skill refresh, installed metadata fallback, and manual metadata bootstrap so stale `unknown` values are cleaned up consistently instead of surviving on one code path / bulk metadata refresh、single-skill refresh、installed metadata fallback、manual metadata bootstrap の各経路でも同じ source 正規化を適用し、stale な `unknown` が一部のコードパスだけに残らないようにしました。
- **Upgrade Remote Skill Count Guard** - Tightened the upgrade prompt's remote-skill count to require both a real remote source and `remotePath`, preventing local personal skills from being counted as remotely reinstallable after the normalization change / アップグレード時の remote skill 件数判定を、実際の remote source と `remotePath` の両方を持つものに限定し、正規化変更後に local personal skill が remote 再インストール対象として誤カウントされないようにしました。

### Tests

- Added regression guards for metadata-less personal skill source normalization and upgrade remote-skill counting, then revalidated compile, resource regression, When to Use extraction, search logic, VS Code extension-host smoke, and npm audit before release / metadata-less personal skill の source 正規化と upgrade remote-skill count の回帰ガードを追加し、リリース前に compile、resource 回帰、When to Use 抽出、検索ロジック、VS Code extension-host smoke、npm audit を再検証しました。

## [0.2.26] - 2026-05-21

### Fixed

- **Remote Source Refresh Across Layouts** - Fixed `Update This Source` so it accepts source nodes from both Remote Resources layouts, including the resource-type-first `remoteKindSource` rows that previously failed with a selection error / `Update This Source` が Remote Resources の両レイアウトで source ノードを受け付けるように修正し、従来は選択エラーで失敗していた resource-type-first の `remoteKindSource` 行からも更新できるようにしました。
- **Explicit Source Refresh Bypasses Shared Dedup** - Manual single-source refresh now forces a rescan instead of being skipped by the 5-minute shared index dedup window, so upstream additions such as newly published Agent-Skills entries appear immediately after an explicit refresh / 手動の単一ソース更新は 5 分間の shared index dedup によるスキップを迂回して必ず再スキャンするようにし、Agent-Skills の新規追加のような upstream 変更が明示更新直後に反映されるようにしました。
- **Remote Refresh Regression Guard and Docs Sync** - Added a regression guard for the explicit source refresh contract and documented that source refresh works from either Remote Resources layout in both README editions / 明示ソース更新の契約を固定する回帰ガードを追加し、README / README_ja に Remote Resources のどちらのレイアウトからでも source 更新できることを追記しました。

### Tests

- Revalidated compile, resource regression, manifest consistency, README release UX, browse-view action scope regression, When to Use extraction, search logic, VS Code extension-host smoke, and npm audit before release / リリース前に compile、resource 回帰、manifest consistency、README release UX、browse view action scope 回帰、When to Use 抽出、検索ロジック、VS Code extension-host smoke、npm audit を再検証しました。

## [0.2.25] - 2026-05-20

### Changed

- **Built-in Resources Default Visibility** - Enabled built-in VS Code / GitHub Copilot Chat / GitHub Copilot CLI resources by default in User / Global Resource Home so built-in discovery no longer depends on a first-run manual toggle / User / Global Resource Home で VS Code / GitHub Copilot Chat / GitHub Copilot CLI の built-in resources を既定で表示するようにし、初回表示で手動 toggle しないと発見できない状態を解消しました。
- **Welcome Toggle Alignment** - Updated the User / Global Resource Home empty-state welcome links to use a visibility toggle instead of a stale show-only action, and shortened the copy so the empty-state compactness guard still passes / User / Global Resource Home の empty-state welcome を stale な show-only action ではなく visibility toggle に合わせ、compactness guard を満たすよう文言も短縮しました。

### Tests

- Revalidated resource regression, welcome UX, localization, manifest consistency, compile, extension-host smoke, and npm audit before release / リリース前に resource 回帰、welcome UX、localization、manifest consistency、compile、extension-host smoke、npm audit を再検証しました。

## [0.2.24] - 2026-05-19

### Fixed

- **MCP Uninstall Recovery Ordering** - Reordered MCP uninstall cleanup so the staged MCP file is deleted before `.vscode/mcp.json` is mutated, preventing partial uninstall failures from leaving orphaned workspace config state / MCP アンインストール時の cleanup 順序を見直し、`.vscode/mcp.json` を変更する前に staged MCP ファイルを削除するようにしました。これにより部分失敗で workspace 設定だけが先に壊れる orphan state を防ぎます。
- **Shared Skill Metadata Contract Guard** - Fixed `.skill-meta.json` handling so reinstall continues to preserve the shared `registrationDisabled` and `remotePath` fields used by Agent Skills Ninja for coexistence registration state and cross-extension index matching / `.skill-meta.json` の扱いを修正し、Agent Skills Ninja が共存時の登録状態判定と cross-extension index matching に使う共有フィールド `registrationDisabled` と `remotePath` を、再インストール時も保持し続けるようにしました。
- **PowerShell Helper Task Invocation** - Fixed the tracked `temp-confirm-location-branch` helper task to call `pwsh` with an explicit `-Command`, so the task works in VS Code instead of passing a bare script string as the first argument / tracked helper task `temp-confirm-location-branch` が `pwsh` を裸の script 文字列で呼んでいた問題を修正し、明示的な `-Command` 付きで VS Code 上でも正しく動作するようにしました。

### Tests

- Added regression guards for MCP uninstall sequencing, shared `.skill-meta.json` coexistence fields, and PowerShell task invocation, then revalidated compile, resource regression, extension-host smoke, helper-task execution, targeted metadata contract tests, and npm audit / MCP アンインストール順序、共有 `.skill-meta.json` 共存フィールド、PowerShell task 呼び出し形式の回帰ガードを追加し、compile、resource 回帰、extension-host smoke、helper task 実行、metadata 契約テスト、npm audit を再検証しました。

## [0.2.23] - 2026-05-19

## [0.2.22] - 2026-05-19

### Fixed

- **Browse View Double-Click Reinstall** - Browse view double-click now mirrors the row action for remote resources: uninstalled rows install with the default target, already-installed remote rows reinstall from recorded source metadata, and local-only rows no longer appear as remotely reinstallable / Browse view のダブルクリックは remote resource の行アクションと一致するようにし、未インストール行は default target で install、インストール済み remote 行は記録済み source metadata から reinstall、local-only 行は remote 再インストール対象に見えないようにしました。
- **Browse UX Documentation Sync** - Documented the Browse view install/reinstall split in README and README_ja so the Remote Resources behavior is explained where click / double-click install is introduced / README と README_ja に Browse view の install / reinstall 分岐を追記し、click / double-click install の説明箇所で Remote Resources の挙動が分かるようにしました。
- **Release Hygiene Follow-up** - Restored the missing `release-notes-v0.2.22.md` artifact and synchronized the current release metadata files so release-facing guards keep the version contract intact / 欠落していた `release-notes-v0.2.22.md` を補完し、現行リリース用メタデータを同期して release-facing guard が version 契約を維持できるようにしました。

### Tests

- Revalidated compile, resource regression, README/release-note guards, extension-host smoke, ref catalog guards, and npm audit after the Browse double-click and release-hygiene follow-up / Browse のダブルクリック修正と release hygiene の追補後に、compile、resource 回帰、README/release-note guard、extension-host smoke、ref catalog guard、npm audit を再検証しました。

### Fixed

- **Browse View Install Button on Installed Remote Rows** - Replaced the misleading Install button with a Reinstall action for already-installed remote resources in the Browse view, so users can update installed resources without confusion while local-only rows no longer show install/reinstall at all / Browse ビューでインストール済みリモートリソースに表示されていた紛らわしい Install ボタンを Reinstall に置き換えました。ローカルのみの行には install/reinstall を表示しなくなりました。
- **Reinstall from Browse View** - Reinstall now resolves installed workspace resources by remotePath matching when invoked from Browse view rows, enabling reinstall of resources originally installed by Agent Skills Ninja or earlier versions / Browse ビューからの再インストール時に remotePath マッチングでワークスペース内のインストール済みリソースを解決できるようにし、旧 Agent Skills Ninja やそれ以前のバージョンで入れたリソースの再インストールを可能にしました。

### Tests

- Added regression guards for browse-installed-remote context split, reinstall inline action visibility, and workspace-state-based reinstall resolution / Browse view の installed remote context 分離、reinstall inline action 表示条件、workspace state ベースの reinstall 解決の回帰テストを追加しました。

## [0.2.21] - 2026-05-19

### Changed

- Replaced the unified Ref catalog root with native README indexes for every resource kind, so Ref output now writes to paths such as `.github/skills/README.md`, `.github/agents/README.md`, and `~/.copilot/prompts/README.md` instead of `.github/resource-catalog/*.md` / Ref 出力の統一 catalog root を廃止し、すべての resource kind を native README index へ統一しました。これにより `.github/resource-catalog/*.md` ではなく `.github/skills/README.md`、`.github/agents/README.md`、`~/.copilot/prompts/README.md` などへ出力します。
- Removed the `resourceNinja.refCatalogDirectory` setting and simplified Ref output to a single native-README placement rule, while keeping `resourceNinja.refCatalogFormat` as the detail-level switch / `resourceNinja.refCatalogDirectory` 設定を削除し、Ref 出力の配置ルールを native README へ一本化しました。詳細粒度の切り替えは `resourceNinja.refCatalogFormat` に集約しています。
- Ref README indexes now use managed `resource-ninja-catalog` sections so cleanup can remove only generated content while preserving any manually authored README text outside the managed block / Ref 用 README index は `resource-ninja-catalog` の managed section を使うようにし、cleanup では生成部分だけを消して README の手書き内容を保持できるようにしました。
- Aligned Resource Output wording across README, README_ja, Japanese settings copy, coexistence runbooks, and instruction-target UX so command names and user-visible guidance no longer mix the old instruction-file terminology / README、README_ja、日本語 settings copy、coexistence runbook、instruction-target UX の Resource Output 文言を揃え、旧 instruction-file 用語がコマンド名や利用者向けガイダンスに混ざらないようにしました。

### Tests

- Revalidated compile, extension-host smoke, resource regression, README/localization/coexistence guards, manifest consistency, and npm audit before release / リリース前に compile、extension-host smoke、resource 回帰、README/localization/coexistence guard、manifest consistency、npm audit を再検証しました。

## [0.2.20] - 2026-05-18

### Changed

- Split Ref mode from inline output formatting by adding `resourceNinja.useRefOutput`, leaving `resourceNinja.outputFormat` for `full` / `compact` / `legacy`, and updating the settings copy so the two responsibilities are separate / `resourceNinja.useRefOutput` を追加して Ref モードと inline 出力形式を分離し、`resourceNinja.outputFormat` は `full` / `compact` / `legacy` 専用に整理しました。設定文言も責務が混ざらないよう更新しました。
- Managed output now regenerates immediately when output-related settings change even if `resourceNinja.autoUpdateInstruction` is off; that setting now controls resource-change sync only / 出力関連の設定変更時は `resourceNinja.autoUpdateInstruction` が off でも managed output を即時再生成するようにし、この設定は resource 変更時の自動同期だけを制御する形に整理しました。
- Added a quick decision guide for Ref output vs inline output, and separated Ref catalog enum descriptions from inline format copy so future settings wording can evolve independently / Ref 出力と inline 出力の選び分けを README に判断表として追加し、Ref catalog の enum 説明を inline 出力の文言から分離して、将来の設定文言変更が相互にずれないようにしました。

## [0.2.19] - 2026-05-18

### Added

- **Ref Output Format for Managed Instruction Blocks** - Added `resourceNinja.outputFormat = ref` plus per-kind resource catalogs so AGENTS.md / CLAUDE.md / copilot-instructions.md style always-loaded files can stay lightweight while details move into catalog files such as `.github/resource-catalog/skills.md` or `.catalog/resources/skills.md` / `resourceNinja.outputFormat = ref` と kind 別 resource catalog を追加し、AGENTS.md / CLAUDE.md / copilot-instructions.md のような always-loaded file を軽量に保ちつつ、詳細は `.github/resource-catalog/skills.md` や `.catalog/resources/skills.md` へ分離できるようにしました。

### Changed

- **Skill-Only IMPORTANT Wording** - In `ref` mode, only the Skills reference keeps the IMPORTANT wording, while agents / instructions / prompts / hooks / MCP configs / plugins / cursor rules use plain `See ...` references / `ref` モードでは Skills 参照だけに IMPORTANT wording を残し、agents / instructions / prompts / hooks / MCP configs / plugins / cursor rules は単純な `See ...` 参照にしました。
- **Catalog Metadata Links** - Ref catalogs now include resource file links plus repository / remote URLs when install metadata or bundled index metadata can resolve them, and fall back to `local` when the resource is user-created / ref catalog では resource file link に加え、install metadata や bundled index metadata から解決できる場合は repository / remote URL も表示し、ユーザー作成 resource は `local` へフォールバックするようにしました。
- **Generated Catalog Safety** - Ref catalogs now carry a generated marker, and cleanup only removes marked Resource NINJA catalogs so manually authored files in the same catalog directory are preserved / ref catalog に generated marker を付与し、cleanup では marker 付きの Resource NINJA catalog だけを削除することで、同じ catalog directory にある手書きファイルを保持するようにしました。
- **Open Resource Output Flow** - The open-output commands now prefer the ref skills catalog when `outputFormat = ref`, regenerate managed output if the catalog is missing, and only then fall back to the sync target file; toolbar, welcome copy, and command labels now describe this behavior as opening resource output rather than opening the instruction file directly / `outputFormat = ref` のとき、出力を開くコマンドは instruction file ではなく ref skills catalog を優先して開きます。catalog が未生成なら managed output を再生成し、それでも無ければ同期先ファイルへフォールバックします。これに合わせてツールバー、welcome copy、コマンド名も「instruction file を開く」ではなく「resource output を開く」挙動に揃えました。
- **Scoped Output Command Split** - View toolbar and empty-state open actions now stay scoped to their current view, while the Command Palette adds `Open Resource Output...` as an explicit scope picker for workspace vs global output / view のツールバーと empty state の open action は現在の view 文脈に固定し、Command Palette には workspace と global 出力を明示選択できる `Open Resource Output...` を追加しました。

### Tests

- **Ref Catalog Coverage** - Added regression coverage for `ref` setting exposure, recommended tool defaults, catalog directory resolution rules, documentation sync, generated catalog safety markers, and managed section generation hooks, then revalidated compile and resource-facing regression suites / `ref` 設定公開、推奨ツール既定、catalog directory 解決ルール、ドキュメント同期、generated catalog safety marker、managed section generation hook の回帰テストを追加し、compile と resource 系回帰スイートで再検証しました。

## [0.2.18] - 2026-05-17

### Fixed

- **Plugin Manifest Source Coverage** - Official plugin-distributed sources such as Microsoft Azure now index their plugin manifests alongside skills / MCP configs, so the Remote Resources plugin section can show actual plugin packages instead of hiding them behind skill-only groupings / Microsoft Azure などの公式 plugin 配布 source で、skills / MCP config だけでなく plugin manifest も同時に index するようにしました。これにより Remote Resources の plugin section で実際の plugin package を表示できます。
- **Plugin Package Root Propagation** - Child resources now preserve plugin root / manifest metadata even when their install path does not start with `plugins/`, so plugin grouping works for top-level marketplace layouts as well as nested plugin payloads / child resource が `plugins/` で始まらない install path でも plugin root / manifest metadata を保持するようにし、top-level marketplace layout と nested plugin payload の両方で plugin grouping が機能するようにしました。
- **Stale Official Install Sets** - Synced the Azure and AWS curated install sets with the current upstream indexed resource lists, including newly added skills such as `azure-reliability` and the latest AWS plugin skills / Azure と AWS の curated install set を現在の upstream index に同期し、`azure-reliability` などの追加 skill や最新の AWS plugin skills を含めるようにしました。

### Tests

- **Plugin Source Regression Coverage** - Revalidated Azure plugin sources, Azure skills marketplace sources, plugin bundle completeness, plugin manifest parsing, full plugin index modeling, UI scope actions, and compile after widening official plugin manifest coverage / 公式 plugin manifest coverage を広げたあと、Azure plugin source、Azure skills marketplace source、plugin bundle 完全性、plugin manifest parser、full plugin index model、UI scope actions、compile を再検証しました。

## [0.2.17] - 2026-05-17

### Changed

- **Plugin Package vs Contents UX** - Remote Resources now separates plugin package install, indexed plugin contents selection, curated install sets, and installed plugin-origin grouping with distinct labels such as `Pick from a Plugin`, `Curated Install Sets`, and `Plugin Origins` / Remote Resources と Installed views で、plugin package install、インデックス済み plugin 中身の選択、curated install set、installed 側の plugin 由来グループを別ラベルに分離しました。`Pick from a Plugin`、`Curated Install Sets`、`Plugin Origins` などで役割を明確化しています。
- **Microsoft Azure Resource Set Naming** - Renamed Microsoft Azure plugin-derived bundle and source labels so they read as skills / MCP resource sets instead of full plugin package installs / Microsoft Azure の plugin 由来 bundle と source の表示名を、plugin 本体の install ではなく skills / MCP resource set と読める名称へ変更しました。
- **Bundle Summary and Checklist Affordance** - Curated sets and plugin-content picks now show resource-kind count summaries such as `31 skills + 1 MCP`, and checklist installs explicitly state that everything is preselected unless the user deselects items / curated set と plugin-content pick に `31 skills + 1 MCP` のような resource kind 件数サマリーを表示し、チェックリスト install では全件が事前選択済みで不要なものだけ外せばよいことを明示するようにしました。

### Tests

- **Plugin UX Regression Coverage** - Revalidated manifest consistency, README release UX, search/source disambiguation, plugin-derived bundle safety, Azure source indexing, localization UX, smoke test, and audit after clarifying plugin package vs indexed contents vs curated sets / plugin package と indexed contents と curated set の区別を明確化したあと、manifest consistency、README release UX、検索時の source 識別、plugin-derived bundle safety、Azure source indexing、localization UX、smoke test、audit を再検証しました。

## [0.2.16] - 2026-05-17

### Added

- **Installed Extension Resource Discovery** - User / Global Resource Home now discovers read-only resources packaged in installed marketplace extensions, including `resources/agents`, `resources/skills`, `resources/prompts`, `resources/instructions`, `resources/hooks`, and `resources/mcp`, plus manifest-declared `chatAgents` / `chatPromptFiles` files / User / Global Resource Home で、インストール済み marketplace 拡張に同梱された読み取り専用リソースを検出するようにしました。`resources/agents`、`resources/skills`、`resources/prompts`、`resources/instructions`、`resources/hooks`、`resources/mcp` に加え、manifest の `chatAgents` / `chatPromptFiles` で宣言されたファイルも対象です。

### Changed

- **Read-only Extension Grouping** - Installed extension resources are grouped separately from built-in resources, shown by extension and kind, and remain openable/copyable without exposing delete or reinstall actions / installed extension resources を built-in resources と分離し、拡張ごと・種別ごとに表示するようにしました。開く・表示・パスコピーは可能ですが、削除や再インストールは出しません。
- **Localization and Docs Alignment** - Localized the Installed Extensions scope label and updated README / README_ja plus welcome copy so the User / Global view behavior matches the current read-only discovery model / Installed Extensions のスコープ名をローカライズし、README / README_ja と welcome copy を更新して、User / Global view の現在の読み取り専用 discovery 挙動と一致させました。

### Tests

- **Release Validation** - Revalidated compile, resource regression, manifest consistency, view welcome UX, localization UX, npm audit, and VS Code integration tests after adding installed extension discovery and manifest-aware exact-file scanning / installed extension discovery と manifest-aware exact-file scanning の追加後、compile、resource 回帰、manifest consistency、view welcome UX、localization UX、npm audit、VS Code integration test を再検証しました。

## [0.2.15] - 2026-05-13

### Fixed

- **Installed Skill Index False Positives** - Startup and bulk reinstall flows now skip local-only skills that lack remote install metadata, so manually managed or sibling-managed skills under Global Resource Home are no longer incorrectly reported as missing from the bundled index / 起動時と一括再インストール時の index 整合性チェックで、remote install metadata を持たない local-only skill を除外するようにしました。これにより Global Resource Home 配下の手動管理 skill や sibling-managed skill が、bundled index にないものとして誤警告されなくなりました。
- **Release Build Log Clarity** - One-shot bundle builds now log `[build]` instead of `[watch]`, avoiding false watch-mode cues during release and CI verification / one-shot bundle build のログを `[watch]` ではなく `[build]` に変更し、release と CI の検証中に watch 実行と誤解しにくくしました。

### Changed

- **Bug Report Helper Consolidation** - Centralized GitHub Issue URL generation and browser launch into a shared helper so report-bug flows in commands and installer recovery paths stay consistent / GitHub Issue URL の生成とブラウザ起動を shared helper に集約し、command と installer recovery path の bug report 導線を一貫化しました。
- **Managed Block Reset Wording** - Renamed the cleanup command and related copy to describe the actual behavior as removing the generated managed marker block, and documented the safe reset flow in README / README_ja and coexistence fixture docs / cleanup command と関連文言を、生成済み managed marker block を削除する実際の挙動に合わせて見直しました。README / README_ja と coexistence fixture docs にも安全な reset 手順を追記しました。

### Tests

- **Release Regression Coverage** - Revalidated typecheck, lint, production build, resource regression, manifest consistency, coexistence coverage, installed-skill index guards, When to Use extraction, search logic, npm audit, and attempted VS Code extension-host tests with the existing local update-state failure captured as a release note fallback / typecheck、lint、production build、resource 回帰、manifest consistency、coexistence coverage、installed-skill index guard、When to Use 抽出、検索ロジック、npm audit を再検証し、VS Code extension-host test は既存の local update-state failure を release note に記録する fallback で扱いました。

## [0.2.14] - 2026-05-13

### Changed

- **Instruction Block Agent Listing Default** - `resourceNinja.instructionBlock.includeAgents` now defaults to off, so generated instruction blocks list only mandatory `skill` entries unless agents are explicitly enabled / `resourceNinja.instructionBlock.includeAgents` の既定値を off にし、agents を明示的に有効化しない限り、生成 instruction block は必須の `skill` のみを掲載するようにしました。
- **Settings UI Clarification** - Instruction-block settings now explain that they add agents or instructions to generated instruction blocks such as `AGENTS.md`, while `skill` stays mandatory and prompts/hooks/MCP configs/plugins/Cursor rules remain in their native views / instruction-block 設定の文言を更新し、`AGENTS.md` などの生成 instruction block に agents / instructions を追加する設定であること、`skill` は必須、prompts/hooks/MCP configs/plugins/Cursor rules はネイティブ view に残ることを明確化しました。

### Tests

- **Instruction Block Default-Off Coverage** - Revalidated instruction-block policy defaults, manifest consistency, README/settings alignment, coexistence fixtures, resource regressions, smoke test, and npm audit after switching the workspace agent listing default to off / workspace の agent 掲載既定値を off に切り替えたあと、instruction-block policy 既定値、manifest consistency、README/settings 整合、coexistence fixture、resource 回帰、smoke test、npm audit を再検証しました。

## [0.2.13] - 2026-05-13

### Changed

- **Instruction Block Kind Policy** - Shared instruction blocks now default to listing `skill` plus `agent`, keep `instruction` opt-in, leave prompts/hooks/MCP/plugins/cursor rules in their native views, and add Global Resource Home overrides that can inherit the workspace policy without duplicate input / 共有 instruction block の既定掲載ポリシーを `skill` + `agent` に変更し、`instruction` は opt-in、prompts/hooks/MCP/plugins/cursor rules はネイティブ view に残すようにしました。Global Resource Home 向けには workspace 方針を継承できる override も追加しました。
- **Legacy Exclusion Compatibility** - `resourceNinja.kindsExcluded` is now documented and treated as a legacy standalone compatibility layer; it no longer removes `skill` and is ignored while the skill-only sibling extension is active / `resourceNinja.kindsExcluded` を旧 standalone 互換レイヤーとして扱うよう整理しました。`skill` は除外されず、skill-only sibling extension と同居中は無視されます。

### Tests

- **Instruction Block Policy Coverage** - Added regression coverage for workspace/global instruction-block defaults and overrides, legacy exclusion compatibility, manifest settings exposure, and updated coexistence fixtures/docs / workspace/global の instruction-block 既定値と override、legacy exclusion 互換、manifest settings 公開、coexistence fixture/docs の回帰テストを追加しました。

## [0.2.12] - 2026-05-12

### Added

- **Coexistence Owner Handoff** - Added shared-block coexistence controls for the skill-only sibling extension, including owner recompute/status commands, standalone exclusions hints, and Resource-side B/F fixtures for the uninstall handoff cases / skill-only sibling extension との shared block coexistence 制御を追加し、owner 再計算/状態表示コマンド、standalone exclusions hint、uninstall handoff 用の Resource 側 B/F fixture を実装しました。
- **Shared Coexistence Stores** - Added shared `sources.json` and `index.json` stores plus locking helpers so Resource NINJA can reuse the sibling extension's SSOT safely during coexistence / coexistence 中に sibling extension と同じ SSOT を安全に共有できるよう、共有 `sources.json` と `index.json` store、および lock helper を追加しました。

### Changed

- **Instruction Sync Documentation Alignment** - Updated README / README_ja, settings copy, and instruction-target UX to describe the generated instruction block and the default shared `agent-ninja` markers instead of the old skill-only wording / README / README_ja、settings copy、instruction-target UX を更新し、旧 skill-only wording ではなく生成 instruction block と既定の共有 `agent-ninja` marker を説明するようにしました。
- **Release Hygiene and VSIX Size** - Tightened `.vscodeignore`, excluded docs/output/local artifacts from VSIX payloads, and added release guards for both release/dev VSIX payloads plus icon asset presence / `.vscodeignore` を見直し、docs/output/ローカル artifact を VSIX payload から除外しました。release/dev 両 VSIX payload と icon asset 実在を検証する guard も追加しました。

### Tests

- **Coexistence and Packaging Validation** - Added coexistence regression coverage, README/settings order drift guards, README absolute-link guards for marketplace rendering, dev/release VSIX hygiene checks, and revalidated compile, resource regression, README UX, localization UX, instruction-target UX, coexistence tests, and npm audit / coexistence 回帰、README/settings order drift guard、Marketplace 向け README absolute-link guard、dev/release VSIX hygiene check を追加し、compile、resource 回帰、README UX、localization UX、instruction-target UX、coexistence test、npm audit を再検証しました。

## [0.2.11] - 2026-05-11

### Fixed

- **Global Resource Home Copilot CLI Parity** - User / Global Resource Home now prioritizes product resource folders such as `skills/` and `instructions/` before Copilot CLI runtime logs/state, so `~/.copilot/skills/*/SKILL.md` remains visible even when the home contains many session files. Product-native instruction files such as `copilot-instructions.md`, Copilot hook config files such as `hooks/*.json`, and `mcp-config.json` are also recognized. Global Resource Home scope rows now show the selected product root and compact path / User / Global Resource Home で Copilot CLI の runtime log/state より `skills/` や `instructions/` などの product resource folder を先にスキャンし、`~/.copilot` に多数の session file があっても `~/.copilot/skills/*/SKILL.md` が表示されるようにしました。`copilot-instructions.md` などの product-native instruction file、`hooks/*.json` の Copilot hook config、`mcp-config.json` も認識します。Global Resource Home の scope row には選択中の product root と短いパスを表示します。

### Tests

- **Release Validation** - Revalidated resource regression, typecheck, lint, bundle build, VS Code extension test, search smoke, When to Use extraction, npm audit, and Copilot CLI Global Resource Home preflight / resource 回帰、型チェック、lint、bundle build、VS Code extension test、検索 smoke、When to Use 抽出、npm audit、Copilot CLI Global Resource Home preflight を再検証しました。

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

[Unreleased]: https://github.com/aktsmm/vscode-agent-resources-ninja/compare/v0.2.44...HEAD
[0.2.44]: https://github.com/aktsmm/vscode-agent-resources-ninja/compare/v0.2.43...v0.2.44
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
