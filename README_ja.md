# 🥷 Agent Resources Ninja

<p align="center">
  <strong>AI コーディングアシスタント用 Agent Resources の検索・インストール・管理</strong>
</p>

> Agent Resources Ninja は、スキル、エージェント、プロンプト、インストラクション、フックなどの AI コーディング用リソースを管理する新しい VS Code 拡張機能です。

**Workspace Resources** でプロジェクト内リソースを、**User / Global Resource Home** でユーザー領域と共有ルートを、**Remote Resources** で同梱・GitHub ソースを扱えます。インストール先は明示選択でき、MCP config は任意マージ前に staging / review 用ディレクトリへコピーされ、VS Code / Copilot の組み込みリソースは読み取り専用として扱います。

> **ライセンス注意**: 本拡張機能は CC BY-NC-SA 4.0 で配布されています。非商用利用は可能ですが、商用利用には許諾が必要です。詳細は [LICENSE](LICENSE) を確認してください。

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
    <img src="https://img.shields.io/badge/%E4%BB%8A%E3%81%99%E3%81%90%E3%82%A4%E3%83%B3%E3%82%B9%E3%83%88%E3%83%BC%E3%83%AB-VS%20Code%20Marketplace-007ACC?style=for-the-badge&logo=visual-studio-code&logoColor=white" alt="VS Code Marketplace からインストール">
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

## 🥷 Features

### 🧭 リソース管理

- Activity Bar から **Workspace Resources**、**User / Global Resource Home**、**Remote Resources** を参照
- skills、agents、prompts、instructions、hooks、MCP config、plugin manifest、Cursor rule など複数のリソース種別を管理
- リモートリソースを source 別または Resource Type 別に参照
- VS Code User Data と選択中の Global Resource Home 配下の user/global リソースを確認
- インストール済み VS Code 拡張に同梱された chat agent や prompt などの読み取り専用リソースを確認
- インストール先を Workspace、User Profile、Global Resource Home、Custom から明示選択

### 📁 ローカルリソース管理

- ワークスペース内の skills、agents、prompts、instructions、hooks、MCP config、plugin manifest、Cursor rule リソースを自動検出
- 検出した workspace skills を生成される instruction index へ自動同期（`resourceNinja.includeLocalResources` 設定で制御）
- ローカル workspace skills の手動登録/解除コマンド
- テンプレートから skills、agents、prompts、instructions、hooks、MCP config リソースを新規作成
- Create Resource と Settings はすべてのリソースビューから利用できます。instruction index の open/update は Workspace Resources と User / Global Resource Home の両方から利用できます。
- Create Resource は install/scan と同じ Workspace、User Profile、Global Resource Home の設定済みルートを使うため、プレビューされた保存先と実際の作成先が一致します。

### 🔍 リソース検索・発見

- リソースをキーワード検索（ローカル＆GitHub）
- QuickPick 検索結果を resource kind（skills、agents、instructions、prompts、hooks、MCP config、plugins、Cursor rules）で絞り込み
- **インストールセット** は curated な選択式インストール単位です。**プラグイン別** は plugin package の manifest とインデックス済み子リソースをまとめて表示します。子リソースは各 resource kind にも表示され、行の詳細で plugin 由来が分かります。
- Remote Resources の行では agents、hooks、MCP config、plugins、Cursor rules などすべての resource kind でインストール済み状態を文字と色で表示します。
- MCP config の行は、確認用コピーなのか `.vscode/mcp.json` へマージ済みなのかを staged / merged 状態として詳細と tooltip に表示します。
- Hook の行は configured / not configured、設定ソース、イベント、script path 警告などの静的診断を表示します。Agent Resources Ninja は hook を実行しません。
- **複数キーワード検索** - 名前・パス・説明の関連度でスコアリング
- **並列フェッチ** - 50 件同時取得で高速化
- **フォールバック検索** - 結果 0 件時にキーワードを減らして自動リトライ
- 説明文・カテゴリタグ付きの検索結果
- スター数・組織バッジ表示
- 検索結果から直接インストール/プレビュー/お気に入り

### 📦 インストール・管理

- ワンクリックの default install は skill だけでなく agents、instructions、prompts、hooks、MCP config、plugin manifest、Cursor rules を含むすべての resource kind に適用されます。クリック / ダブルクリックインストールは **Default Install Target** を使い、コンテキストメニューの **Install Resource** は毎回インストール先を選択でき、Custom も選べます。
- MCP config リソースのクリック / ダブルクリックインストールは Workspace MCP Directory へレビュー用にコピーするのみで、`.vscode/mcp.json` は変更しません。互換 server を `.vscode/mcp.json` にマージしたい場合は、コンテキストメニューの **Install Resource** を使って merge オプションを選択してください。既存 server key の上書きは必ず確認します。
- `.vscode/mcp.json` にマージ済みの MCP config をアンインストールすると、対応する server entry も削除するか確認する明示モーダルを表示し、削除前に backup を作成します。
- インストール済み MCP config は、確認用コピーだけの状態か `.vscode/mcp.json` に反映済みかを行の詳細とツールチップで確認できます。
- インストール済み hook は、推奨設定が root `hooks.json` に入っているかと参照スクリプトの欠落を表示します。この診断は静的チェックのみで、hook 実行ではありません。
- Plugin manifest リソースは `.github/plugins/<plugin>` または Global Resource Home の `plugins/<plugin>` へ managed copy としてインストールします。plugin に含まれる hooks、実行可能ファイル、MCP config は確認用にコピーされ、自動実行や自動有効化はしません。
- resource 変更時に instruction file 内の生成 instruction block を自動更新（AGENTS.md / copilot-instructions.md / CLAUDE.md）
- **テーブル形式** - 「When to Use」列付きの表形式で skill entry を生成
- **「When to Use」自動抽出** - SKILL.md の `## When to Use` セクションから自動取得
- **説明を編集** - インストール済み skill の instruction file 向け説明を右クリックでカスタマイズ
- 対象ビューから workspace / user / global リソースをアンインストール
- **ワークスペース skill の一括再インストール** - インストール済み skill をソースメタデータから一括再インストール（インデックス自動更新付き）
- **リソースグループの再インストール** - Workspace Resources の Skills や Agents などの種別グループを右クリックし、そのグループ内のリモートソースからインストールされたリソースを一括再インストール
- **User / Global 側の再インストール** - User / Global Resource Home でも、リモート由来の個別行の再インストールと、種別グループ・プラグイングループ単位の再インストールを行えます
- **インストール通知** - NEW バッジ、ステータスバー表示、ツリービューで自動選択
- **フォルダを開く** - インストール済みリソースのフォルダにクイックアクセス
- **インデックス整合性チェック** - 未登録リソースを自動検出し、インデックス更新を提案

### 🔧 マルチツール対応

- ワークスペース内の AI ツールを**自動検出**（Cursor, Windsurf, Cline, Claude Code, GitHub Copilot）
- 検出されたツールに基づいて出力形式を自動選択
- 設定で手動オーバーライド可能
- 対応出力形式:
  - Markdown（AGENTS.md, CLAUDE.md, copilot-instructions.md）
  - Cursor Rules（.cursor/rules/）
  - Windsurf Rules（.windsurfrules）
  - Cline Rules（.clinerules）

### 💬 GitHub Copilot Chat 連携

- `@resources` コマンドでチャットから直接操作
- `/search`, `/install`, `/list`, `/recommend`
- プロジェクトに基づくリソース推奨

### 🤖 MCP ツール連携

- **Agent Mode** で自動的にツールとして利用可能
- **9 ツール**: `#searchResources`, `#installResource`, `#uninstallResource`, `#listResources`, `#recommendResources`, `#updateResourceIndex`, `#webSearchResources`, `#addResourceSource`, `#localizeResource`
- 信頼度バッジ（Official / Curated / Community）
- skill のインストール時に必要に応じて instruction file を自動更新

### 🌐 多言語・UI

- 日本語 / 英語 UI（自動検出 + 手動切替）
- Webview でリソースプレビュー
- お気に入り機能

## 🎬 Demo

![Demo](https://raw.githubusercontent.com/aktsmm/vscode-agent-resources-ninja/master/docs/screenshots/demo.gif)

## 📥 Installation

### VS Code Marketplace

```
ext install yamapan.agent-resources-ninja
```

または VS Code の拡張機能（`Ctrl+Shift+X`）で **"Agent Resources Ninja"** を検索

### 手動インストール

1. [Releases](https://github.com/aktsmm/vscode-agent-resources-ninja/releases) から `.vsix` をダウンロード
2. VS Code で `Ctrl+Shift+P` → `Extensions: Install from VSIX...`
3. ダウンロードした `.vsix` を選択

## 📚 Included Resource Sources

プリセットインデックスには、公式・キュレーション・コミュニティの各ソースから skills、agents、prompts、instructions、hooks、MCP config、plugin manifest、Cursor rule リソースが初期状態で含まれます。

| Source                                                                                                                        | Type      | 説明                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------- |
| [anthropics/skills](https://github.com/anthropics/skills)                                                                     | Official  | Anthropic 公式 Claude Skills                                              |
| [openai/skills](https://github.com/openai/skills)                                                                             | Official  | OpenAI 公式 Codex Skills (1.7k+)                                          |
| [github/awesome-copilot](https://github.com/github/awesome-copilot)                                                           | Official  | plugin から公開された skills / agents を含む GitHub 公式 Copilot リソース |
| [cursor/plugins](https://github.com/cursor/plugins)                                                                           | Official  | Cursor 公式 plugin manifest、skills、agents、rules                        |
| [MicrosoftDocs/Agent-Skills](https://github.com/MicrosoftDocs/Agent-Skills)                                                   | Official  | Microsoft 公式 Azure Agent Skills                                         |
| [microsoft/GitHub-Copilot-for-Azure](https://github.com/microsoft/GitHub-Copilot-for-Azure)                                   | Official  | GitHub Copilot for Azure 公式プラグイン skills                            |
| [microsoft/azure-skills](https://github.com/microsoft/azure-skills)                                                           | Official  | Azure skills と MCP config を含む Microsoft Azure Skills Plugin リソース  |
| [awslabs/agent-plugins](https://github.com/awslabs/agent-plugins)                                                             | Official  | AWS Labs の Agent Plugins skills                                          |
| [elastic/agent-skills](https://github.com/elastic/agent-skills)                                                               | Official  | Elastic 公式 Agent Skills                                                 |
| [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli)                                                       | Official  | Gemini CLI 公式 skills                                                    |
| [openai/codex](https://github.com/openai/codex)                                                                               | Official  | Codex リポジトリの skills                                                 |
| [anthropics/claude-code](https://github.com/anthropics/claude-code)                                                           | Official  | Claude Code 公式プラグイン skills                                         |
| [cline/cline](https://github.com/cline/cline)                                                                                 | Official  | Cline リポジトリの skills                                                 |
| [aaif-goose/goose](https://github.com/aaif-goose/goose)                                                                       | Official  | AAIF の Goose リポジトリ skills                                           |
| [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills)                                       | Curated   | Claude Skills キュレーションリスト                                        |
| [Code-and-Sorts/awesome-copilot-agents](https://github.com/Code-and-Sorts/awesome-copilot-agents)                             | Curated   | Copilot agents、instructions、prompts、skills                             |
| [obra/superpowers](https://github.com/obra/superpowers)                                                                       | Community | Superpowers plugin manifest と plugin 由来 skills                         |
| [glittercowboy/taches-cc-resources](https://github.com/glittercowboy/taches-cc-resources)                                     | Community | Claude Code resources と skills                                           |
| [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering) | Community | Context Engineering スキル (5k+)                                          |
| [danielmiessler/Personal_AI_Infrastructure](https://github.com/danielmiessler/Personal_AI_Infrastructure)                     | Community | PAI Packs - スキル・フィーチャー集                                        |
| [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin)                               | Community | Compound Engineering (3.5k+)                                              |
| [Wirasm/PRPs-agentic-eng](https://github.com/Wirasm/PRPs-agentic-eng)                                                         | Community | PRP (Prompt Recipe Patterns)                                              |
| [qdhenry/Claude-Command-Suite](https://github.com/qdhenry/Claude-Command-Suite)                                               | Community | Claude コマンド・スキル集                                                 |

Azure は Microsoft 公式 source が 2 系統あります。`microsoft/GitHub-Copilot-for-Azure` は Copilot for Azure リポジトリ内の plugin-embedded skills を index し、`microsoft/azure-skills` は top-level の Azure Skills Plugin 配布物と Azure MCP config を index します。Azure Skills bundle は選択式で、skills をまとめて入れられます。MCP config は確認用にコピーするか、`.vscode/mcp.json` へ明示的にマージするかを選べます。

Cursor 公式 plugins と Superpowers は、plugin manifest リソースとしても、plugin 内の skills、agents、rules、hooks、MCP config などの個別リソースとしても index します。plugin リソースのインストールは確認用の managed copy を作成するだけで、plugin hooks の実行や MCP config のマージは別途明示操作がない限り行いません。

複数 source が同じ resource name を提供する場合、検索結果には読みやすい source 名を表示し、重複候補には source/path の詳細を追加します。関連度が同じ場合は、embedded plugin path より distribution-ready な top-level path を先に表示します。

`mcp.json` や `.mcp.json` のような汎用 MCP config ファイル名は、別 source の MCP config を上書きしないよう `microsoft-azure-skills-mcp.json` のように source prefix 付きでインストールします。MCP ファイルはいったんコピーされ、`.vscode/mcp.json` へのマージは backup と上書き確認つきの明示選択です。

> `Update Index` コマンドで、これらのソースから最新のリソースとメタデータを再取得できます
> 公式プロダクト/プラグインリポジトリは path filter で配布向けの場所と選択した plugin manifest だけを対象にし、サンプルやテスト用 skill は同梱プリセットに含めません。
> `github/awesome-copilot` では、`plugins/` から公開されたリソースも、利用可能な場合は重複する raw plugin path ではなく配布向け top-level resource path から収録します。
> ディレクトリ型の `SKILL.md` root 配下のファイルは skill 内部の構成要素として扱い、`templates` 配下の補助 prompt / instruction などは Remote Resources に別リソースとして表示しません。

## 🥷 Usage

### サイドバーから操作

1. アクティビティバーの **螺旋手裏剣アイコン** をクリック
2. **Workspace Resources** - インストール済み＆ローカルリソース一覧

- skills、agents、instructions、prompts、hooks、MCP config リソースをリソース種別ごとに分類
- Remote Resources と同じ表示名でインストール済みワークスペースリソースを表示
- 生成される instruction index に登録可能なローカル workspace skills
- VS Code / Copilot の組み込みリソースは **User / Global Resource Home** に集約し、ワークスペース一覧には重複表示しません
- ツールバーから skills、agents、instructions、prompts、hooks、MCP config リソースを新規作成
- 作成時に Workspace、User Profile、Global Resource Home、カスタムフォルダーを保存先に選択
- 新しくインストールしたリソース（一時的なバッジ）
- ツールバー: Instruction / 新規作成 / 更新 / 設定
- リモートからインストールしたリソースは、各行の inline action からリソース単位で再インストール可能
- skill 専用の一括コマンドは、メンテナンス用に Command Palette または overflow action から利用可能
- リソースフォルダを開く（右クリックメニュー）

3. **User / Global Resource Home** - このPC上のユーザー領域と共有リソースルートを確認

- VS Code User の `prompts`（`.agent.md` を含む）、`instructions`、旧 `agents`
- 選択中の preset（`~/.copilot`, `~/.claude`, `~/.agents`）配下の Global Resource Home リソース。`copilot-instructions.md` などの product-native instruction file、`skills/*/SKILL.md` 配下の skills、`agents/` 配下の agents、`hooks/*.json` の Copilot hook config file、Copilot CLI の `mcp-config.json` も含みます
- marketplace 拡張の `resources/agents`、`resources/skills`、`resources/prompts`、`resources/instructions`、`resources/hooks`、`resources/mcp`、および manifest の `chatAgents` / `chatPromptFiles` から検出した installed extension resources
- VS Code / GitHub Copilot Chat / GitHub Copilot CLI の組み込みリソースは既定で非表示、必要なときだけ由来別グループで表示。Copilot Chat の `assets/prompts` 配下に同梱される `/create-*` prompt skill も対象です
- 組み込みリソースは、VS Code / GitHub Copilot Chat / GitHub Copilot CLI の既知の場所からスキャンする読み取り専用定義です。発見用に表示し、変更対象にはしません。
- installed extension resources も読み取り専用で、確認用に表示します。
- `~/.copilot` 配下の Copilot CLI runtime logs、session state、OAuth cache、restart state は除外するため、CLI home に多数の session file があってもユーザー作成リソースを優先して表示できます。
- 組み込み以外の User / Global リソースは右クリックで開く、表示、パスコピー、削除が可能
- 組み込みリソースと installed extension resources は読み取り専用で、インストール先にはなりません
- workspace `.github` 配下は **Workspace Resources** 側で確認

4. **Remote Resources** - ソースリポジトリ別に Web 上のリソースを閲覧
   - **お気に入り** セクションが最上部に表示

- ツールバーからリポジトリ起点とリソース種別起点のレイアウトを切り替え
- リポジトリ起点ではソース、skills、agents、instructions、prompts、hooks、MCP config リソース、plugins、Cursor rules の順に分類
- リソース種別起点では skills、agents、instructions、prompts、hooks、MCP config リソース、plugins、Cursor rules、ソースの順に分類
- リポジトリセクションは Official → Curated → Community の順に表示
- すべての resource kind でインストール済みを緑アイコンと `Installed` 相当の行詳細で表示
- リストからダブルクリックでインストール。シングルクリック設定時は既定インストール先を使用

### アイコン凡例

| アイコン       | 意味                                               |
| -------------- | -------------------------------------------------- |
| check (緑)     | インストール済みリソース                           |
| circle (黄)    | ローカルリソース（instruction file 未登録）        |
| NEW badge      | 最近インストール（一時的なバッジ）                 |
| star-full (黄) | お気に入りセクション                               |
| verified (青)  | 公式ソース（Anthropic, OpenAI, GitHub, Microsoft） |
| star (黄)      | キュレーション awesome-list                        |
| repo           | コミュニティリポジトリ                             |

### コマンドパレット

| コマンド                                           | 説明                                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| `Agent Resources Ninja: Search Resources`          | リソースを検索してインストール                                                |
| `Agent Resources Ninja: Update Index`              | 全ソースからインデックスを更新                                                |
| `Agent Resources Ninja: Search on GitHub`          | GitHub でリソースを検索                                                       |
| `Agent Resources Ninja: Add Source Repository`     | 新しいソースリポジトリを追加                                                  |
| `Agent Resources Ninja: Remove Source Repository`  | ソースリポジトリを削除                                                        |
| `Agent Resources Ninja: Uninstall Resource`        | リソースをアンインストール                                                    |
| `Agent Resources Ninja: Show Workspace Resources`  | ワークスペースリソースを表示                                                  |
| `Agent Resources Ninja: Create New Resource`       | ローカルの skill、agent、prompt、instruction、hook、MCP config リソースを作成 |
| `Agent Resources Ninja: Register Local Resource`   | ローカル skill を instruction file に登録                                     |
| `Agent Resources Ninja: Unregister Local Resource` | ローカル skill を instruction file から登録解除                               |
| `Agent Resources Ninja: Reinstall All`             | インストール済み skill をソースメタデータから再インストール                   |
| `Agent Resources Ninja: Uninstall All`             | インストール済み workspace skills を全削除（確認ダイアログあり）              |
| `Agent Resources Ninja: Uninstall Multiple`        | 複数のインストール済み skill を選択して削除                                   |
| `Agent Resources Ninja: Reinstall Multiple`        | 複数のインストール済み skill を選択して再インストール                         |
| `Agent Resources Ninja: Update Instruction`        | instruction file を手動更新                                                   |
| `Agent Resources Ninja: Open Resource Folder`      | インストール済みリソースのフォルダを開く                                      |

### クイックスタート

```
1. Ctrl+Shift+P → "Agent Resources Ninja: Search Resources"
2. キーワードを入力（例: "pdf", "azure", "git"）
3. リソースを選択 → アクションを選択（Install / Preview / Favorite / GitHub）
4. コンテキストメニューではインストール先を選択。ダブルクリックでは既定インストール先へインストール
5. 完了！skill のインストールは、対応する生成済み instruction index を自動更新できます
```

### インストール先

| Target               | 主な用途                                    | 配置先                                                                                                                                    |
| -------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace            | プロジェクト固有のリソース                  | 設定された workspace directories。既定は `.github/skills`, `.github/agents`, `.github/instructions`, `.github/prompts`, `.github/hooks`   |
| User Profile         | VS Code ユーザー設定と共有 skills/hooks     | agents/prompts は既定で VS Code User `prompts`、instructions は VS Code User `instructions`; skills/hooks は選択中の Global Resource Home |
| Global Resource Home | Copilot CLI、Claude、agent 系の共有リソース | 選択中の preset（`~/.copilot`, `~/.claude`, `~/.agents`）または override。リソース種別ごとのサブフォルダーに配置                          |
| Custom               | 任意配置                                    | 選択したフォルダー                                                                                                                        |

インストール先選択では、選択中のリソース種別に応じた保存先プレビューが表示されます。VS Code / Copilot の組み込みリソースはスキャン表示専用で、インストール先にはなりません。

### 検索のコツ 💡

| 例                 | 効果                               |
| ------------------ | ---------------------------------- |
| `azure`            | キーワード検索                     |
| `azure devops`     | 複数キーワード、関連度でランキング |
| `username keyword` | 最初の語をユーザー名として検索     |
| `user:anthropics`  | 明示的にユーザー指定               |
| `repo:owner/repo`  | リポジトリ指定                     |

> 結果が 0 件の場合、キーワードを減らして自動リトライします。

## 💬 Copilot Chat

GitHub Copilot Chat から `@resources` でリソース操作が可能です：

```
@resources /search MCP server      # リソース検索
@resources /install github-mcp     # リソースインストール
@resources /list                   # ワークスペースリソース一覧
@resources /recommend              # プロジェクトに基づく推奨
@resources what tools for Python?  # 自然言語で検索
```

### コマンド一覧

| コマンド          | 説明                       |
| ----------------- | -------------------------- |
| `/search <query>` | キーワードでリソース検索   |
| `/install <name>` | リソースをインストール     |
| `/list`           | ワークスペースリソース一覧 |
| `/recommend`      | ワークスペースに基づく推奨 |

> 検索結果にはインストールボタンが付いており、直接インストールできます

## 🤖 MCP Tools (Agent Mode)

GitHub Copilot の **Agent Mode** では、自動的に MCP ツールとして利用されます。

### ツール一覧

| Tool Reference         | 説明                         |
| ---------------------- | ---------------------------- |
| `#searchResources`     | キーワードでリソース検索     |
| `#installResource`     | リソースをインストール       |
| `#uninstallResource`   | リソースをアンインストール   |
| `#listResources`       | ワークスペースリソース一覧   |
| `#recommendResources`  | プロジェクトに合った推奨     |
| `#updateResourceIndex` | リソースインデックスを更新   |
| `#webSearchResources`  | GitHub でリソースを Web 検索 |
| `#addResourceSource`   | 新しいリソースソースを追加   |
| `#localizeResource`    | リソース説明をローカライズ   |

### 使用例

```
💬 "Azure 関連のリソースを探して"
  → 自動的に #searchResources が呼び出され、結果を表示

💬 "bicep-mcp リソースをインストールして"
  → #installResource でインストール、instruction file 自動更新

💬 "GitHub で MCP サーバーを検索して"
  → #webSearchResources で GitHub リポジトリを検索

💬 "このプロジェクトにおすすめのリソースは？"
  → #recommendResources でワークスペースを分析して推奨
```

### 特徴

- **信頼度バッジ**: Official / Curated / Community を表示
- **おすすめリソース**: 検索結果から最適なリソースを推奨
- **インデックス更新情報**: 最終更新日と古い場合の警告
- **設定連動**: `resourceNinja.autoUpdateInstruction` / `resourceNinja.includeLocalResources` を尊重
- **トークン効率**: MCP ツール経由で操作することで、会話コンテキストを節約

### MCP ツールを無効化

MCP ツールが不要な場合は、GitHub Copilot Chat のツール一覧からオフにできます：

1. Copilot Chat パネル → Settings → Tools
2. 「Agent Resources Ninja」のツールをトグルオフ

## ⚙️ Settings

設定は、ユーザーが実際に決める順番に近い並びにしています。

| グループ             | 設定                                                                                                                                                                                                                                                                                                       | 目的                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| インストール動作     | `defaultInstallTarget`, `singleClickInstall`                                                                                                                                                                                                                                                               | クリック操作でどこへ保存するかを決める                              |
| Workspace roots      | `resourcesDirectory`, `workspace*Directory`                                                                                                                                                                                                                                                                | ワークスペースで管理する project-specific resources                 |
| User roots           | `user*Directory`                                                                                                                                                                                                                                                                                           | VS Code User Profile の agents、prompts、instructions               |
| Global Resource Home | `globalResourceHomePreset`, `globalHomeDirectory`                                                                                                                                                                                                                                                          | Copilot CLI、Claude 互換、Open Agent 系で共有するグローバルリソース |
| Instruction sync     | `autoUpdateInstruction`, `instructionFile`, `customInstructionPath`, `includeLocalResources`, `coexistenceMode`, `kindsExcluded`, `instructionBlock.includeAgents`, `instructionBlock.includeInstructions`, `instructionBlock.globalHome.includeAgents`, `instructionBlock.globalHome.includeInstructions` | 共有 instruction block の生成と掲載 kind ポリシー                   |
| Shared caches        | `useSharedSourcesManifest`, `useSharedResourceIndex`                                                                                                                                                                                                                                                       | source 一覧と scan metadata の cross-extension SSOT                 |
| 表示とメンテナンス   | `outputFormat`, `showBuiltInResources`, `remoteResourceViewMode`, `language`, `githubToken`                                                                                                                                                                                                                | 表示、探索、GitHub API 利用の調整                                   |

通常は `globalResourceHomePreset` を選ぶだけで十分です。`globalHomeDirectory` は override なので、空でない場合は preset より優先されます。`custom` を選ぶ場合は、あわせて override path を指定してください。

| 順序 | Setting                                                         | Default                | Description                                                                            |
| :--: | --------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------- |
|  0   | `resourceNinja.defaultInstallTarget`                            | `workspace`            | クリック/ダブルクリックインストールの既定保存先                                        |
|  1   | `resourceNinja.singleClickInstall`                              | `false`                | シングルクリックでリソースをインストール                                               |
|  2   | `resourceNinja.resourcesDirectory`                              | `.github/skills`       | Workspace skill directory                                                              |
|  3   | `resourceNinja.workspaceAgentsDirectory`                        | `.github/agents`       | Workspace agent directory                                                              |
|  4   | `resourceNinja.workspaceInstructionsDirectory`                  | `.github/instructions` | Workspace instruction directory                                                        |
|  5   | `resourceNinja.workspacePromptsDirectory`                       | `.github/prompts`      | Workspace prompt directory                                                             |
|  6   | `resourceNinja.workspaceHooksDirectory`                         | `.github/hooks`        | Workspace hook directory                                                               |
|  7   | `resourceNinja.workspaceMcpDirectory`                           | `.github/mcp`          | 任意の `.vscode/mcp.json` マージ前に使う安全な Workspace MCP config staging directory  |
|  8   | `resourceNinja.userAgentsDirectory`                             | `""`                   | User Profile agent override。空の場合 `.agent.md` は VS Code User `prompts` に保存     |
|  9   | `resourceNinja.userInstructionsDirectory`                       | `""`                   | User Profile instruction directory override                                            |
|  10  | `resourceNinja.userPromptsDirectory`                            | `""`                   | User Profile prompt directory override                                                 |
|  11  | `resourceNinja.globalResourceHomePreset`                        | `copilot`              | 代表的な Global Resource Home preset（`~/.copilot`, `~/.claude`, `~/.agents`）         |
|  12  | `resourceNinja.globalHomeDirectory`                             | `""`                   | 任意の Global Resource Home override                                                   |
|  13  | `resourceNinja.autoUpdateInstruction`                           | `true`                 | resource 変更後に生成 instruction block を自動更新                                     |
|  14  | `resourceNinja.instructionFile`                                 | `AGENTS.md`            | 生成 instruction block の同期先 _(要: Auto Update)_                                    |
|  15  | `resourceNinja.customInstructionPath`                           | `""`                   | カスタム生成 instruction block パス _(instructionFile が 'custom' の時のみ)_           |
|  16  | `resourceNinja.includeLocalResources`                           | `false`                | workspace-wide fallback で検出した `SKILL.md` を生成 instruction block に含める        |
|  17  | `resourceNinja.autoUpdateResourcesOnUpgrade`                    | `prompt`               | 拡張機能アップグレード時にインストール済みリソースを更新                               |
|  18  | `resourceNinja.coexistenceMode`                                 | `auto`                 | 共有 marker の ownership mode (`auto` / `independent`)                                 |
|  19  | `resourceNinja.kindsExcluded`                                   | `[]`                   | shared instruction block 用の旧 standalone 互換 exclusion                              |
|  20  | `resourceNinja.useSharedSourcesManifest`                        | `false`                | skill-only sibling extension と source 一覧を共有する `sources.json` SSOT を有効化     |
|  21  | `resourceNinja.useSharedResourceIndex`                          | `false`                | skill-only sibling extension と scan cache を共有する `index.json` SSOT を有効化       |
|  22  | `resourceNinja.outputFormat`                                    | `full`                 | 出力形式（full / compact / legacy）                                                    |
|  23  | `resourceNinja.showBuiltInResources`                            | `false`                | User / Global Resource Home に組み込みリソースを表示                                   |
|  24  | `resourceNinja.remoteResourceViewMode`                          | `repositoryFirst`      | Remote Resources の表示レイアウト                                                      |
|  25  | `resourceNinja.language`                                        | `auto`                 | UI 言語（auto / en / ja）                                                              |
|  26  | `resourceNinja.githubToken`                                     | `""`                   | GitHub Token（API 制限緩和用）                                                         |
|  27  | `resourceNinja.instructionBlock.includeAgents`                  | `false`                | workspace の instruction block に `agent` を含める                                     |
|  28  | `resourceNinja.instructionBlock.includeInstructions`            | `false`                | workspace の instruction block に `instruction` を含める                               |
|  29  | `resourceNinja.instructionBlock.globalHome.includeAgents`       | `inherit`              | Global Resource Home 向け agent 掲載ポリシーの上書き（`inherit` / `on` / `off`）       |
|  30  | `resourceNinja.instructionBlock.globalHome.includeInstructions` | `inherit`              | Global Resource Home 向け instruction 掲載ポリシーの上書き（`inherit` / `on` / `off`） |

> 設定画面では上記の順序で表示されます

### Instruction File 同期の仕組み

`autoUpdateInstruction` が有効な場合：

1. **Workspace/User Profile/Global Resource Home skill のインストール/アンインストール** → instruction file が自動更新
2. **Workspace の同期先** では workspace skills、`~/.copilot/copilot-instructions.md` など **Global Resource Home の同期先** では Global Resource Home skills を一覧化
3. **設定済み workspace resource directories** → Workspace Resources ではここを先にスキャン
4. **workspace-wide fallback `SKILL.md` 検出** → `resourceNinja.includeLocalResources` が true の場合だけ生成 instruction block に追加
5. **登録/解除コマンド** → ローカル workspace skill の手動制御

インストール済みファイル自体はネイティブパスに残ります。生成される instruction block はコピーではなく index として機能します。

既定では shared instruction block を意図的に薄く保ちます。`skill` は常に掲載、`agent` と `instruction` は opt-in、`prompt` / `hook` / `mcp` / `plugin` / `cursor-rule` はネイティブ view に残します。Global Resource Home 向けの同期先は workspace の方針を継承するか、必要なときだけ個別に上書きできます。

### Coexistence 注記

両拡張を同居させたあとで skill-only sibling extension を uninstall した場合は、まず `Resource NINJA: Recompute Coexistence Ownership` を実行して owner 状態を更新してください。

旧 `resourceNinja.kindsExcluded` は standalone モードでの互換レイヤーとして引き続き使えますが、既定の掲載ポリシーは `instructionBlock.*` 設定で制御します。legacy exclusion で `skill` が消えることはなく、skill-only sibling extension と同居中は無視されます。

生成される instruction file には管理セクションが入ります。既定の `auto` モードでは `agent-ninja-START` / `agent-ninja-END`、`independent` モードでは従来の `resource-ninja-START` / `resource-ninja-END` を使います。手動編集は管理セクション外で行うか、ファイル全体を手動管理したい場合は自動更新を無効にしてください。生成済みセクションを安全にリセットしたいときは、`Resource NINJA: 管理マーカーブロックを削除` を実行してから `Update Instruction File` で再生成してください。

既定の `auto` モードでは、instruction file に **IMPORTANT プロンプト** と **Description 列** を含む共有管理セクションが追加されます：

```markdown
<!-- agent-ninja-START -->

## Agent Resources

> **IMPORTANT**: Prefer resource-led reasoning over pre-training-led reasoning.
> Read the relevant resource file before working on tasks covered by these resources.

### Skills

| Resource                                         | Source | Path                        | Description                |
| ------------------------------------------------ | ------ | --------------------------- | -------------------------- |
| [skill-name](.github/skills/skill-name/SKILL.md) | local  | `.github/skills/skill-name` | 説明テキスト \| いつ使うか |

### Agents

| Resource                                       | Source | Path                             | Description  |
| ---------------------------------------------- | ------ | -------------------------------- | ------------ |
| [review-agent](.github/agents/review.agent.md) | local  | `.github/agents/review.agent.md` | レビュー補助 |

<!-- agent-ninja-END -->
```

**Description 列の形式**: `{description:80} | {whenToUse:80}`（合計最大160文字）

## 出力フォーマット

### フォーマットオプション

| フォーマット | 説明                                         | IMPORTANT | 詳細テーブル | 圧縮インデックス |
| ------------ | -------------------------------------------- | --------- | ------------ | ---------------- |
| **Full**     | IMPORTANT prompt + 詳細テーブル（既定）      | Yes       | Yes, 200文字 | No               |
| **Compact**  | IMPORTANT prompt + 圧縮インデックス          | Yes       | No           | Yes, 100文字     |
| **Legacy**   | 互換性が必要な場合向けのシンプルテーブルのみ | No        | Yes, 200文字 | No               |

### IMPORTANT プロンプト

`full` と `compact` フォーマットには **IMPORTANT プロンプト** が含まれます。既定の `auto` モードでは resource file 優先、`independent` モードでは従来の skill-focused wording を維持します：

```markdown
> **IMPORTANT**: Prefer resource-led reasoning over pre-training-led reasoning.
> Read the relevant resource file before working on tasks covered by these resources.
```

### 出力例 - Full フォーマット（既定 `auto` モード）

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

`independent` モードでは、互換性のため従来の `resource-ninja` skill-only block を維持します。

### フォーマットの変更方法

設定 → **Output Format (出力フォーマット)** → `full`, `compact`, `legacy` から選択

## Instruction File オプション

| 値                                               | ファイルパス                                     | 用途                          |
| ------------------------------------------------ | ------------------------------------------------ | ----------------------------- |
| `AGENTS.md`                                      | `AGENTS.md` (root)                               | 推奨：汎用                    |
| `~/.copilot/copilot-instructions.md`             | `~/.copilot/copilot-instructions.md`             | Copilot CLI global local      |
| `.github/copilot-instructions.md`                | `.github/copilot-instructions.md`                | GitHub Copilot                |
| `.github/instructions/SkillList.instructions.md` | `.github/instructions/SkillList.instructions.md` | Copilot Instructions フォルダ |
| `CLAUDE.md`                                      | `CLAUDE.md` (root)                               | Claude Code                   |
| `custom`                                         | 任意のパス (customInstructionPath で指定)        | カスタム                      |

## 🔑 GitHub Token 設定

> **推奨**: GitHub Token を設定すると API 制限が 60 → 5000 リクエスト/時間に緩和されます。未設定の場合、GitHub 検索が rate limit に達しやすくなります。

検索を安定して使うには GitHub Token を設定してください：

### 方法 1: VS Code 設定

設定画面から `Agent Resources Ninja: GitHub Token` を探し、トークンを入力：

```json
{
  "resourceNinja.githubToken": "ghp_xxxxxxxxxxxx"
}
```

👉 [GitHub Token を作成する](https://github.com/settings/tokens/new?description=Agent%20Resources%20Ninja)

公開リソースだけを扱う場合、scope は未選択のままで問題ありません。private repository を意図的に index する場合だけ、必要な scope を追加してください。

### 方法 2: GitHub CLI（推奨）

```bash
gh auth login
```

> GitHub CLI がインストールされていれば自動でトークンを取得します（設定不要）

## 🛠️ Development

```bash
# 依存関係をインストール
npm install

# コンパイル
npm run compile

# 監視モードでビルド
npm run watch

# パッケージ作成
npm run package

# リント
npm run lint

# 集中回帰テスト
node scripts/test-resource-kinds.js
node scripts/test-resource-targets.js
node scripts/test-user-data-paths.js
node scripts/test-manifest-consistency.js
node scripts/test-logger.js
node scripts/test-whenToUse.js
node scripts/test-search-logic.js

# Extension Host smoke test
npm test

# 依存関係監査
npm audit --audit-level=moderate
```

### デバッグ

1. VS Code で `F5` を押す
2. 新しい VS Code ウィンドウで拡張機能をテスト
3. コマンドパレット (`Ctrl+Shift+P`) で `Agent Resources Ninja` コマンドを実行

### 診断ログ

- 拡張機能の診断ログは **Output → Agent Resources Ninja** に出力されます。
- runtime code は診断ログをプロセス標準出力へ直接書きません。これにより、Extension Host や `vscode-test` のローカル実行で pipe 関連エラーが起きにくくなります。
- テスト中に VS Code/Electron の `EPIPE` ダイアログが出た場合は、まず通常ターミナルで `npm test` を再実行し、その後 **Output → Agent Resources Ninja** で拡張機能側の診断ログを確認してください。

## 🤝 Contributing

1. Fork this repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) © [yamapan](https://github.com/aktsmm)

- 非営利目的での利用・改変・再配布が可能
- 商用利用は要相談
- Microsoft 社員は業務利用可

> 本コンテンツの AI/ML トレーニング、データマイニング、その他の解析目的での使用を禁止します。

## 🔗 Related Projects

- [anthropics/skills](https://github.com/anthropics/skills) - Official Claude Skills
- [github/awesome-copilot](https://github.com/github/awesome-copilot) - Official Copilot Resources
- [microsoft/skills](https://github.com/microsoft/skills) - 参考: Official Microsoft Skills（プリセット未同梱）
- [MicrosoftDocs/Agent-Skills](https://github.com/MicrosoftDocs/Agent-Skills) - Official Azure Agent Skills（プリセット同梱）
- [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) - Curated Skills List

## 👤 Author

yamapan (https://github.com/aktsmm)
