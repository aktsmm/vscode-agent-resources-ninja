// サイドバー TreeView プロバイダー
// ワークスペーススキル（統合）とブラウズ用のツリービューを提供

import * as vscode from "vscode";
import {
  SkillIndex,
  Skill,
  loadSkillIndex,
  Source,
  Bundle,
  Category,
  ResourceKind,
  getLocalizedDescription,
  getResourceKind,
  getResourceKindIcon,
  getResourceKindLabel,
} from "./skillIndex";
import { getInstalledSkillsWithMeta } from "./skillInstaller";
import { LocalSkill, scanLocalSkills } from "./localSkillScanner";
import { isJapanese } from "./i18n";
import { getSkillId } from "./skillPreview";
import {
  getInstalledResourceKey,
  getPluginIdFromPath,
  getPluginPackageCandidates,
  getPluginPackageId,
  getPluginPackageLabel,
  getResourceIdentityKeys,
  PluginPackageInfo,
} from "./resourceKinds";
import {
  getConfiguredSkillsDirectory,
  getRelativeSkillsPathForWorkspace,
} from "./customizationPaths";

const RESOURCE_KIND_ORDER: ResourceKind[] = [
  "skill",
  "agent",
  "instruction",
  "prompt",
  "hook",
  "mcp",
  "plugin",
  "cursor-rule",
];

type RemoteResourceViewMode = "repositoryFirst" | "resourceTypeFirst";

interface PluginGroup {
  id: string;
  label: string;
  resources: Skill[];
  packageInfo?: PluginPackageInfo;
}

interface WorkspacePluginGroup {
  id: string;
  resources: WorkspaceSkill[];
}

/**
 * ワークスペーススキル情報（統合型）
 */
export interface WorkspaceSkill {
  kind?: Skill["kind"];
  name: string;
  description: string;
  description_ja?: string;
  relativePath: string;
  fullPath: string;
  isInstalled: boolean; // configured skills directory 配下か
  isRegistered: boolean; // instruction file に登録済みか
  isBuiltIn?: boolean; // VS Code / Copilot Chat built-in resource
  source?: string; // インストール元ソース
  remotePath?: string;
  categories?: string[];
  // 公式仕様に基づくメタデータ
  license?: string; // ライセンス（例: MIT, Apache-2.0）
  author?: string; // 作成者
  version?: string; // バージョン
}

/**
 * ワークスペーススキル統合ビュー
 * - インストール済みスキル (configured skills directory 配下)
 * - ローカルスキル (それ以外の SKILL.md)
 * を統合表示
 */
export class WorkspaceSkillsProvider implements vscode.TreeDataProvider<SkillTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    SkillTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private workspaceSkills: WorkspaceSkill[] = [];

  constructor(
    private workspaceUri: vscode.Uri | undefined,
    private recentlyInstalled?: Set<string>,
  ) {}

  refresh(): void {
    this.workspaceSkills = [];
    void vscode.commands.executeCommand(
      "setContext",
      "resourceNinja.hasInstalledSkills",
      false,
    );
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SkillTreeItem): vscode.TreeItem {
    return element;
  }

  // reveal() を使うために必要
  getParent(element: SkillTreeItem): SkillTreeItem | undefined {
    return element.parent;
  }

  async getChildren(element?: SkillTreeItem): Promise<SkillTreeItem[]> {
    if (!this.workspaceUri) {
      return [];
    }

    if (!element) {
      // ワークスペーススキルを取得
      if (this.workspaceSkills.length === 0) {
        await this.loadWorkspaceSkills();
      }

      if (this.workspaceSkills.length === 0) {
        return [
          new SkillTreeItem(
            isJapanese() ? "リソースが見つかりません" : "No resources found",
            isJapanese()
              ? "「リソースを検索」でインストールしてください"
              : "Use 'Search Resources' to install resources",
            vscode.TreeItemCollapsibleState.None,
            "placeholder",
          ),
        ];
      }

      const items: SkillTreeItem[] = [];
      this.addWorkspacePluginSection(items);
      items.push(
        ...this.getPresentWorkspaceResourceKinds().map((kind) => {
          const count = this.getWorkspaceResourceCountForKind(kind);
          const item = new SkillTreeItem(
            getResourceKindLabel(kind, isJapanese()),
            `${count} resources`,
            vscode.TreeItemCollapsibleState.Expanded,
            "workspaceResourceType",
            undefined,
            undefined,
            undefined,
            undefined,
            kind,
          );
          item.iconPath = new vscode.ThemeIcon(getResourceKindIcon(kind));
          return item;
        }),
      );

      return items;
    }

    if (element.contextValue === "workspacePluginSection") {
      return this.getWorkspacePluginGroups().map((plugin) => {
        const item = new SkillTreeItem(
          plugin.id,
          `${plugin.resources.length} resources`,
          vscode.TreeItemCollapsibleState.Collapsed,
          "workspacePlugin",
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          plugin.id,
        );
        item.iconPath = new vscode.ThemeIcon(
          "extensions",
          new vscode.ThemeColor("charts.purple"),
        );
        return item;
      });
    }

    if (element.contextValue === "workspacePlugin" && element.pluginId) {
      return this.getWorkspacePluginResources(element.pluginId).map((skill) =>
        this.createWorkspaceResourceItem(skill, element),
      );
    }

    if (
      element.contextValue === "workspaceResourceType" &&
      element.resourceKind
    ) {
      return this.workspaceSkills
        .filter(
          (skill) =>
            !skill.isBuiltIn &&
            (skill.kind || "skill") === element.resourceKind,
        )
        .map((skill) => this.createWorkspaceResourceItem(skill, element));
    }

    return [];
  }

  private getPresentWorkspaceResourceKinds(): ResourceKind[] {
    const present = new Set(
      this.workspaceSkills
        .filter((skill) => !skill.isBuiltIn)
        .map((skill) => skill.kind || "skill"),
    );
    return RESOURCE_KIND_ORDER.filter((kind) => present.has(kind));
  }

  private getWorkspaceResourceCountForKind(kind: ResourceKind): number {
    return this.workspaceSkills.filter(
      (skill) => !skill.isBuiltIn && (skill.kind || "skill") === kind,
    ).length;
  }

  private getWorkspacePluginGroups(): WorkspacePluginGroup[] {
    const groups = new Map<string, WorkspaceSkill[]>();
    for (const resource of this.workspaceSkills) {
      if (resource.isBuiltIn) {
        continue;
      }
      const pluginId = getPluginIdFromPath(resource.remotePath);
      if (!pluginId) {
        continue;
      }
      const resources = groups.get(pluginId) || [];
      resources.push(resource);
      groups.set(pluginId, resources);
    }
    return [...groups.entries()]
      .map(([id, resources]) => ({ id, resources }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  private getWorkspacePluginResources(pluginId: string): WorkspaceSkill[] {
    return this.workspaceSkills.filter(
      (resource) => getPluginIdFromPath(resource.remotePath) === pluginId,
    );
  }

  private addWorkspacePluginSection(items: SkillTreeItem[]): void {
    const pluginGroups = this.getWorkspacePluginGroups();
    if (pluginGroups.length === 0) {
      return;
    }
    const resourceCount = pluginGroups.reduce(
      (total, plugin) => total + plugin.resources.length,
      0,
    );
    const item = new SkillTreeItem(
      isJapanese() ? "プラグイン別" : "Grouped by Plugin",
      `${pluginGroups.length} groups · ${resourceCount} resources`,
      vscode.TreeItemCollapsibleState.Collapsed,
      "workspacePluginSection",
    );
    item.iconPath = new vscode.ThemeIcon(
      "extensions",
      new vscode.ThemeColor("charts.purple"),
    );
    items.push(item);
  }

  private createWorkspaceResourceItem(
    skill: WorkspaceSkill,
    parent?: SkillTreeItem,
  ): SkillTreeItem {
    let statusIcon: string;
    let iconId: string;
    let iconColor: vscode.ThemeColor;

    const isRecent =
      getResourceIdentityKeys(skill).some((key) =>
        this.recentlyInstalled?.has(key),
      ) ?? false;
    const newBadge = isRecent ? "🆕 " : "";

    if (skill.isBuiltIn) {
      statusIcon = "";
      iconId = getResourceKindIcon(skill.kind || "skill");
      iconColor = new vscode.ThemeColor("charts.orange");
    } else if (skill.isInstalled || skill.isRegistered) {
      statusIcon = "✓";
      iconId = getResourceKindIcon(skill.kind || "skill");
      iconColor = new vscode.ThemeColor("charts.green");
    } else {
      statusIcon = "○";
      iconId = getResourceKindIcon(skill.kind || "skill");
      iconColor = new vscode.ThemeColor("charts.yellow");
    }

    const kind = skill.kind || "skill";
    const sourceLabel =
      skill.source && skill.source !== "unknown" ? skill.source : undefined;
    const workspacePluginId = getPluginIdFromPath(skill.remotePath);
    const workspacePluginLabel = workspacePluginId
      ? `${isJapanese() ? "プラグイン" : "Plugin"}: ${workspacePluginId}`
      : undefined;
    const isRemoteInstalled = !!sourceLabel && !!skill.remotePath;
    const contextValue = skill.isBuiltIn
      ? "builtInResource"
      : skill.isInstalled
        ? isRemoteInstalled
          ? kind === "skill"
            ? "installedRemoteSkill"
            : "installedRemoteResource"
          : kind === "skill"
            ? "installedSkill"
            : "installedResource"
        : kind === "skill"
          ? "localSkill"
          : "localResource";
    const labelPrefix = statusIcon ? `${newBadge}${statusIcon} ` : newBadge;
    const item = new SkillTreeItem(
      `${labelPrefix}${skill.name}`,
      skill.isBuiltIn
        ? `built-in · ${sourceLabel || "Built-in"}`
        : skill.isInstalled
          ? [
              sourceLabel ? `installed from ${sourceLabel}` : "installed",
              workspacePluginLabel,
            ]
              .filter((part): part is string => !!part)
              .join(" · ")
          : skill.relativePath,
      vscode.TreeItemCollapsibleState.None,
      contextValue,
      {
        name: skill.name,
        kind,
        description: isJapanese()
          ? skill.description_ja || skill.description
          : skill.description,
        source: sourceLabel || "local",
        path: skill.relativePath,
        remotePath: skill.remotePath,
        categories: skill.categories || [],
        isLocal: !skill.isInstalled,
        fullPath: skill.fullPath,
        relativePath: skill.relativePath,
        isRegistered: skill.isRegistered,
        isBuiltIn: skill.isBuiltIn,
      } as Skill & Partial<LocalSkill>,
      undefined,
      undefined,
      undefined,
      undefined,
      parent,
    );

    item.iconPath = new vscode.ThemeIcon(iconId, iconColor);
    item.resourceUri = vscode.Uri.file(skill.fullPath);

    const statusText = skill.isBuiltIn
      ? isJapanese()
        ? "組み込み"
        : "Built-in"
      : skill.isInstalled
        ? isJapanese()
          ? "インストール済み"
          : "Installed"
        : skill.isRegistered
          ? isJapanese()
            ? "ローカル（登録済み）"
            : "Local (Registered)"
          : isJapanese()
            ? "ローカル（未登録）"
            : "Local (Not registered)";
    const noDesc = isJapanese() ? "説明なし" : "No description";
    const pathLabel = isJapanese() ? "パス" : "Path";
    const statusLabel = isJapanese() ? "状態" : "Status";
    const descText = isJapanese()
      ? skill.description_ja || skill.description || noDesc
      : skill.description || noDesc;

    let metaInfo = "";
    if (skill.author) {
      metaInfo += `\n${isJapanese() ? "作成者" : "Author"}: ${skill.author}`;
    }
    if (skill.license) {
      metaInfo += `\n${isJapanese() ? "ライセンス" : "License"}: ${skill.license}`;
    }
    if (skill.version) {
      metaInfo += `\nVersion: ${skill.version}`;
    }

    const pluginInfo = workspacePluginLabel ? `\n${workspacePluginLabel}` : "";
    item.tooltip = `${skill.name}\n${descText}${pluginInfo}\n${pathLabel}: ${skill.relativePath}\n${statusLabel}: ${statusText}${metaInfo}`;
    item.command = {
      command: "vscode.open",
      title: isJapanese() ? "リソースを開く" : "Open Resource",
      arguments: [vscode.Uri.file(skill.fullPath)],
    };

    return item;
  }

  /**
   * ワークスペース内の全スキルを読み込み
   */
  private async loadWorkspaceSkills(): Promise<void> {
    if (!this.workspaceUri) {
      return;
    }

    const config = vscode.workspace.getConfiguration("resourceNinja");
    const skillsDir = getRelativeSkillsPathForWorkspace(
      getConfiguredSkillsDirectory(config),
    );

    // 1. 全 SKILL.md をスキャン（.github/skills 含む）
    const allLocalSkills = await scanLocalSkills(
      this.workspaceUri,
      true,
      true,
      false,
    );

    // 2. インストール済みスキル（メタデータ付き）
    const installedMeta = await getInstalledSkillsWithMeta(this.workspaceUri);
    await vscode.commands.executeCommand(
      "setContext",
      "resourceNinja.hasInstalledSkills",
      installedMeta.length > 0,
    );

    // 3. 統合
    const skillMap = new Map<string, WorkspaceSkill>();

    // まず全てのスキャン結果を追加
    for (const local of allLocalSkills) {
      const isInstalled =
        local.kind && local.kind !== "skill"
          ? true
          : skillsDir
            ? local.relativePath.startsWith(skillsDir)
            : false;
      const resourceKey = getInstalledResourceKey(local);
      skillMap.set(resourceKey, {
        kind: local.kind,
        name: local.name,
        description: local.description || "",
        description_ja: local.description_ja,
        relativePath: local.relativePath,
        fullPath: local.fullPath, // スキャン結果の実際のパスを使用
        isInstalled,
        isRegistered: local.isRegistered,
        isBuiltIn: local.isBuiltIn,
        source: local.source || (isInstalled ? undefined : "local"),
        remotePath: local.remotePath,
        categories: local.categories,
      });
    }

    // インストール済みスキルのメタデータで補完
    for (const meta of installedMeta) {
      const metaKey = getInstalledResourceKey({
        kind: "skill",
        name: meta.name,
        relativePath: meta.relativePath,
      });
      const existing = skillMap.get(metaKey);
      if (existing) {
        existing.kind = "skill";
        // メタデータがあれば補完
        existing.description = meta.description || existing.description;
        existing.description_ja = meta.description_ja;
        existing.source = meta.source || existing.source;
        existing.remotePath = meta.remotePath || existing.remotePath;
        existing.categories = meta.categories?.length
          ? meta.categories
          : existing.categories;
        existing.isInstalled = true;
        existing.isRegistered = true; // インストール済みは常に登録済み扱い
        // メタデータ情報を追加
        existing.license = meta.license;
        existing.author = meta.author;
        existing.version = meta.version;
        existing.fullPath = meta.skillFilePath || existing.fullPath;
      } else if (meta.skillFilePath) {
        skillMap.set(metaKey, {
          kind: "skill",
          name: meta.name,
          description: meta.description || "",
          description_ja: meta.description_ja,
          relativePath: meta.relativePath || meta.name,
          fullPath: meta.skillFilePath,
          isInstalled: true,
          isRegistered: true,
          source: meta.source || "unknown",
          remotePath: meta.remotePath,
          categories: meta.categories,
          license: meta.license,
          author: meta.author,
          version: meta.version,
        });
      }
    }

    // ソート: インストール済み → ローカル登録済み → ローカル未登録
    this.workspaceSkills = Array.from(skillMap.values()).sort((a, b) => {
      const orderA = a.isInstalled ? 0 : a.isRegistered ? 1 : 2;
      const orderB = b.isInstalled ? 0 : b.isRegistered ? 1 : 2;
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * ワークスペーススキル一覧を取得
   */
  getWorkspaceSkills(): WorkspaceSkill[] {
    return this.workspaceSkills;
  }
}

// 後方互換性のためのエイリアス
export const InstalledSkillsProvider = WorkspaceSkillsProvider;
export const LocalSkillsProvider = WorkspaceSkillsProvider;

/**
 * ブラウズ用ツリービュー（ソース別）
 */
export class BrowseSkillsProvider implements vscode.TreeDataProvider<SkillTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<
    SkillTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private skillIndex: SkillIndex | undefined;
  private installedSkillNames: Set<string> = new Set();

  constructor(private context: vscode.ExtensionContext) {}

  refresh(): void {
    this.skillIndex = undefined;
    this.installedSkillNames.clear();
    this._onDidChangeTreeData.fire();
  }

  /**
   * インデックスを直接設定してリフレッシュ
   */
  setIndex(index: SkillIndex): void {
    this.skillIndex = index;
    this.installedSkillNames.clear();
    this._onDidChangeTreeData.fire();
  }

  /**
   * スキルがインストール済みかどうかを確認
   */
  isSkillInstalled(skill: Skill | string): boolean {
    if (typeof skill === "string") {
      return this.installedSkillNames.has(`skill:${skill.toLowerCase()}`);
    }

    return this.installedSkillNames.has(getInstalledResourceKey(skill));
  }

  getTreeItem(element: SkillTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SkillTreeItem): Promise<SkillTreeItem[]> {
    // インデックスを読み込む
    if (!this.skillIndex) {
      this.skillIndex = await loadSkillIndex(this.context);
    }

    // インストール済みスキルを取得（メタデータの name を使用）
    if (this.installedSkillNames.size === 0) {
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (wsFolder) {
        const installedMeta = await getInstalledSkillsWithMeta(wsFolder.uri);
        installedMeta.forEach((meta) =>
          this.installedSkillNames.add(
            getInstalledResourceKey({
              kind: "skill",
              name: meta.name,
              relativePath: meta.relativePath,
            }),
          ),
        );

        const installedResources = await scanLocalSkills(
          wsFolder.uri,
          true,
          true,
        );
        installedResources.forEach((resource) => {
          if (resource.kind && resource.kind !== "skill") {
            this.installedSkillNames.add(getInstalledResourceKey(resource));
          }
        });
      }
    }

    if (!element) {
      const items: SkillTreeItem[] = [];

      // お気に入りセクション
      const favorites = this.context.globalState.get<string[]>("favorites", []);
      if (favorites.length > 0) {
        // 実際にインデックスに存在するお気に入りスキルの数をカウント
        const favoriteSkillCount = this.skillIndex.skills.filter((skill) =>
          favorites.includes(getSkillId(skill)),
        ).length;

        if (favoriteSkillCount > 0) {
          const favItem = new SkillTreeItem(
            isJapanese() ? "お気に入り" : "Favorites",
            `${favoriteSkillCount} resources`,
            vscode.TreeItemCollapsibleState.Collapsed,
            "favorites",
          );
          favItem.iconPath = new vscode.ThemeIcon(
            "star-full",
            new vscode.ThemeColor("charts.yellow"),
          );
          items.push(favItem);
        }
      }

      if (this.getRemoteResourceViewMode() === "resourceTypeFirst") {
        for (const kind of this.getPresentResourceKinds(
          this.skillIndex.skills,
        )) {
          const count = this.getResourceCountForKind(
            this.skillIndex.skills,
            kind,
          );
          const item = new SkillTreeItem(
            getResourceKindLabel(kind, isJapanese()),
            `${count} resources`,
            vscode.TreeItemCollapsibleState.Collapsed,
            "remoteResourceType",
            undefined,
            undefined,
            undefined,
            undefined,
            kind,
          );
          item.iconPath = new vscode.ThemeIcon(getResourceKindIcon(kind));
          items.push(item);
        }

        this.addBundleSection(items);
        this.addPluginSection(items);

        return items;
      }

      this.addBundleSection(items);
      this.addPluginSection(items);

      for (const source of this.getOrderedSources()) {
        items.push(this.createSourceItem(source));
      }

      return items;
    }

    if (element.contextValue === "remoteResourceType" && element.resourceKind) {
      return this.getOrderedSources()
        .filter(
          (source) =>
            this.getResourceCountForSourceAndKind(
              source.id,
              element.resourceKind!,
            ) > 0,
        )
        .map((source) => this.createSourceItem(source, element.resourceKind));
    }

    if (
      element.contextValue === "remoteKindSource" &&
      element.source &&
      element.resourceKind
    ) {
      return this.createResourceItems(
        this.getResourcesForSource(element.source.id).filter(
          (resource) => getResourceKind(resource) === element.resourceKind,
        ),
      );
    }

    if (element.contextValue === "source" && element.source) {
      const sourceResources = this.getResourcesForSource(element.source.id);
      return this.getPresentResourceKinds(sourceResources).map((kind) => {
        const count = this.getResourceCountForKind(sourceResources, kind);
        const item = new SkillTreeItem(
          getResourceKindLabel(kind, isJapanese()),
          `${count} resources`,
          vscode.TreeItemCollapsibleState.Collapsed,
          "sourceResourceType",
          undefined,
          element.source,
          undefined,
          undefined,
          kind,
        );
        item.iconPath = new vscode.ThemeIcon(getResourceKindIcon(kind));
        return item;
      });
    }

    if (
      element.contextValue === "sourceResourceType" &&
      element.source &&
      element.resourceKind
    ) {
      const resources = this.getResourcesForSource(element.source.id).filter(
        (resource) => getResourceKind(resource) === element.resourceKind,
      );
      return this.createResourceItems(resources);
    }

    // Bundleセクション配下: Bundle一覧
    if (element.contextValue === "bundleSection") {
      const isJa = isJapanese();
      return this.getOrderedBundles().map((bundle) => {
        const source = this.getSourceForBundle(bundle);
        const sourceTypeLabel = this.getBundleSourceTypeLabel(source);
        const description =
          isJa && bundle.description_ja
            ? bundle.description_ja
            : bundle.description;
        const item = new SkillTreeItem(
          bundle.name,
          sourceTypeLabel ? `${sourceTypeLabel} · ${description}` : description,
          vscode.TreeItemCollapsibleState.Collapsed,
          "bundle",
          undefined,
          undefined,
          bundle,
        );
        item.iconPath = this.getBundleIcon(source);
        return item;
      });
    }

    // Bundle配下: そのBundleのスキル一覧
    if (element.contextValue === "bundle" && element.bundle) {
      const isJa = isJapanese();
      // bundle.skills 配列にあるスキル名でマッチング
      const bundleSkillNames = element.bundle.skills || [];
      let bundleSkills = this.skillIndex.skills.filter(
        (skill) =>
          bundleSkillNames.includes(skill.name) ||
          bundleSkillNames.includes(skill.path) ||
          bundleSkillNames.some(
            (bName: string) =>
              skill.name.toLowerCase() === bName.toLowerCase() ||
              skill.path.toLowerCase().includes(bName.toLowerCase()),
          ),
      );

      // マッチするスキルがない場合、同じソースのスキルを表示
      if (bundleSkills.length === 0 && element.bundle.source) {
        bundleSkills = this.skillIndex.skills.filter(
          (skill) => skill.source === element.bundle!.source,
        );
      }

      // それでもない場合はメッセージを表示
      if (bundleSkills.length === 0) {
        return [
          new SkillTreeItem(
            isJa ? "リソースが見つかりません" : "No resources found",
            isJa
              ? "このバンドルのリソースはインデックスに登録されていません"
              : "Resources for this bundle are not indexed",
            vscode.TreeItemCollapsibleState.None,
            "placeholder",
          ),
        ];
      }

      return this.createResourceItems(bundleSkills, element.bundle.coreSkill);
    }

    if (element.contextValue === "pluginSection") {
      return this.getPluginGroups().map((plugin) => {
        const source = this.getSourceForPlugin(plugin);
        const sourceLabel = this.getBundleSourceTypeLabel(source);
        const description = sourceLabel
          ? `${sourceLabel} · ${plugin.resources.length} indexed resources`
          : `${plugin.resources.length} indexed resources`;
        const installOrder = plugin.resources.map((resource) => resource.path);
        const virtualBundle: Bundle = {
          id: `plugin:${plugin.id}`,
          name: isJapanese()
            ? `${plugin.label} のインデックス済みリソース`
            : `${plugin.label} indexed resources`,
          source: source?.id || plugin.resources[0]?.source || "",
          description:
            "Selectable install set generated from indexed resources in this plugin path. Only indexed resources are installed; executable plugin setup is not enabled automatically.",
          description_ja:
            "この plugin path 内のインデックス済みリソースから生成した選択式インストールセット。インデックス済みリソースのみをインストールし、実行系 plugin セットアップは自動有効化しません。",
          skills: installOrder,
          installOrder,
        };
        const item = new SkillTreeItem(
          plugin.label,
          description,
          vscode.TreeItemCollapsibleState.Collapsed,
          "plugin",
          undefined,
          undefined,
          virtualBundle,
          undefined,
          undefined,
          undefined,
          plugin.id,
        );
        item.iconPath = this.getPluginIcon(source);
        return item;
      });
    }

    if (element.contextValue === "plugin" && element.pluginId) {
      return this.createResourceItems(
        this.getResourcesForPlugin(element.pluginId),
      );
    }

    // Favorites 配下
    if (element.contextValue === "favorites") {
      const favorites = this.context.globalState.get<string[]>("favorites", []);
      const favoriteSkills = this.skillIndex.skills.filter((skill) =>
        favorites.includes(getSkillId(skill)),
      );

      return this.createResourceItems(favoriteSkills);
    }

    return [];
  }

  private getResourcesForSource(sourceId: string): Skill[] {
    if (!this.skillIndex) {
      return [];
    }
    return this.skillIndex.skills.filter(
      (resource) => resource.source === sourceId,
    );
  }

  private getRemoteResourceViewMode(): RemoteResourceViewMode {
    return vscode.workspace
      .getConfiguration("resourceNinja")
      .get<RemoteResourceViewMode>("remoteResourceViewMode", "repositoryFirst");
  }

  private getOrderedSources(): Source[] {
    if (!this.skillIndex) {
      return [];
    }

    const officialSources = this.skillIndex.sources.filter(
      (source) => source.type === "official",
    );
    const awesomeSources = this.skillIndex.sources.filter(
      (source) => source.type === "awesome-list",
    );
    const communitySources = this.skillIndex.sources.filter(
      (source) =>
        source.type === "community" ||
        source.type === "user-added" ||
        !source.type,
    );
    return [...officialSources, ...awesomeSources, ...communitySources];
  }

  private getSourceForBundle(bundle: Bundle): Source | undefined {
    return this.skillIndex?.sources.find(
      (source) => source.id === bundle.source,
    );
  }

  private getPluginGroups(): PluginGroup[] {
    const resources = this.skillIndex?.skills || [];
    const packages = getPluginPackageCandidates(resources);
    const groups = new Map<string, PluginGroup>();

    for (const resource of resources) {
      const pluginPackageId = getPluginPackageId(resource, packages);
      if (!pluginPackageId) {
        continue;
      }
      const pluginPackage = packages.find((pkg) => pkg.id === pluginPackageId);
      const group = groups.get(pluginPackageId) || {
        id: pluginPackageId,
        label:
          getPluginPackageLabel(pluginPackageId, packages) || pluginPackageId,
        resources: [],
        packageInfo: pluginPackage,
      };
      group.resources.push(resource);
      groups.set(pluginPackageId, group);
    }

    return [...groups.values()].sort((a, b) => {
      const sourceWeightDiff =
        this.getPluginSortWeight(a) - this.getPluginSortWeight(b);
      if (sourceWeightDiff !== 0) {
        return sourceWeightDiff;
      }
      return a.label.localeCompare(b.label);
    });
  }

  private getResourcesForPlugin(pluginPackageId: string): Skill[] {
    const resources = this.skillIndex?.skills || [];
    const packages = getPluginPackageCandidates(resources);
    return resources.filter(
      (resource) => getPluginPackageId(resource, packages) === pluginPackageId,
    );
  }

  private getSourceForPlugin(plugin: PluginGroup): Source | undefined {
    const sourceId = plugin.packageInfo?.source || plugin.resources[0]?.source;
    return sourceId
      ? this.skillIndex?.sources.find((source) => source.id === sourceId)
      : undefined;
  }

  private getPluginSortWeight(plugin: PluginGroup): number {
    const source = this.getSourceForPlugin(plugin);
    if (source?.type === "official") {
      return 0;
    }
    if (source?.type === "awesome-list") {
      return 1;
    }
    return 2;
  }

  private getBundleSortWeight(bundle: Bundle): number {
    const source = this.getSourceForBundle(bundle);
    if (source?.type === "official") {
      return 0;
    }
    if (source?.type === "awesome-list") {
      return 1;
    }
    return 2;
  }

  private getOrderedBundles(): Bundle[] {
    return [...(this.skillIndex?.bundles || [])].sort((a, b) => {
      const weightDiff =
        this.getBundleSortWeight(a) - this.getBundleSortWeight(b);
      if (weightDiff !== 0) {
        return weightDiff;
      }
      return a.name.localeCompare(b.name);
    });
  }

  private getBundleSourceTypeLabel(source: Source | undefined): string {
    if (!source) {
      return "";
    }
    const isJa = isJapanese();
    switch (source.type) {
      case "official":
        return isJa ? "公式" : "Official";
      case "awesome-list":
        return isJa ? "キュレーション" : "Curated";
      case "user-added":
        return isJa ? "ユーザー追加" : "User";
      case "community":
        return isJa ? "コミュニティ" : "Community";
      default:
        return source.type || "";
    }
  }

  private getBundleIcon(source: Source | undefined): vscode.ThemeIcon {
    if (source?.type === "official") {
      return new vscode.ThemeIcon(
        "verified",
        new vscode.ThemeColor("charts.blue"),
      );
    }
    if (source?.type === "awesome-list") {
      return new vscode.ThemeIcon(
        "star",
        new vscode.ThemeColor("charts.yellow"),
      );
    }
    return new vscode.ThemeIcon(
      "package",
      new vscode.ThemeColor("charts.purple"),
    );
  }

  private getPluginIcon(source: Source | undefined): vscode.ThemeIcon {
    if (source?.type === "official") {
      return new vscode.ThemeIcon(
        "extensions",
        new vscode.ThemeColor("charts.blue"),
      );
    }
    if (source?.type === "awesome-list") {
      return new vscode.ThemeIcon(
        "extensions",
        new vscode.ThemeColor("charts.yellow"),
      );
    }
    return new vscode.ThemeIcon(
      "extensions",
      new vscode.ThemeColor("charts.purple"),
    );
  }

  private createSourceItem(
    source: Source,
    resourceKind?: ResourceKind,
  ): SkillTreeItem {
    const count = resourceKind
      ? this.getResourceCountForSourceAndKind(source.id, resourceKind)
      : this.getSkillCountForSource(source.id);
    const item = new SkillTreeItem(
      source.name,
      `${count} resources`,
      vscode.TreeItemCollapsibleState.Collapsed,
      resourceKind ? "remoteKindSource" : "source",
      undefined,
      source,
      undefined,
      undefined,
      resourceKind,
    );
    if (source.type === "official") {
      item.iconPath = new vscode.ThemeIcon(
        "verified",
        new vscode.ThemeColor("charts.blue"),
      );
    } else if (source.type === "awesome-list") {
      item.iconPath = new vscode.ThemeIcon(
        "star",
        new vscode.ThemeColor("charts.yellow"),
      );
    } else if (source.type === "user-added") {
      item.iconPath = new vscode.ThemeIcon(
        "repo-forked",
        new vscode.ThemeColor("charts.green"),
      );
    } else {
      item.iconPath = new vscode.ThemeIcon("repo");
    }
    return item;
  }

  private addBundleSection(items: SkillTreeItem[]): void {
    if (!this.skillIndex?.bundles || this.skillIndex.bundles.length === 0) {
      return;
    }

    const bundleItem = new SkillTreeItem(
      isJapanese() ? "インストールセット" : "Install Sets",
      `${this.skillIndex.bundles.length} sets`,
      vscode.TreeItemCollapsibleState.Collapsed,
      "bundleSection",
    );
    bundleItem.iconPath = new vscode.ThemeIcon(
      "package",
      new vscode.ThemeColor("charts.purple"),
    );
    items.push(bundleItem);
  }

  private addPluginSection(items: SkillTreeItem[]): void {
    const pluginGroups = this.getPluginGroups();
    if (pluginGroups.length === 0) {
      return;
    }

    const resourceCount = pluginGroups.reduce(
      (total, plugin) => total + plugin.resources.length,
      0,
    );
    const item = new SkillTreeItem(
      isJapanese() ? "プラグイン別" : "Grouped by Plugin",
      `${pluginGroups.length} groups · ${resourceCount} resources`,
      vscode.TreeItemCollapsibleState.Collapsed,
      "pluginSection",
    );
    item.iconPath = new vscode.ThemeIcon(
      "extensions",
      new vscode.ThemeColor("charts.purple"),
    );
    items.push(item);
  }

  private getSkillCountForSource(sourceId: string): number {
    if (!this.skillIndex) {
      return 0;
    }
    return this.skillIndex.skills.filter((s) => s.source === sourceId).length;
  }

  private getPresentResourceKinds(resources: Skill[]): ResourceKind[] {
    const present = new Set(
      resources.map((resource) => getResourceKind(resource)),
    );
    return RESOURCE_KIND_ORDER.filter((kind) => present.has(kind));
  }

  private getResourceCountForKind(
    resources: Skill[],
    kind: ResourceKind,
  ): number {
    return resources.filter((resource) => getResourceKind(resource) === kind)
      .length;
  }

  private getResourceCountForSourceAndKind(
    sourceId: string,
    kind: ResourceKind,
  ): number {
    return this.getResourcesForSource(sourceId).filter(
      (resource) => getResourceKind(resource) === kind,
    ).length;
  }

  private createResourceItems(
    resources: Skill[],
    coreSkill?: string,
  ): SkillTreeItem[] {
    const isJa = isJapanese();
    const pluginPackages = getPluginPackageCandidates(
      this.skillIndex?.skills || resources,
    );
    return resources.map((skill) => {
      const isInstalled = this.isSkillInstalled(skill);
      const isCore = skill.name === coreSkill;
      const prefix = isCore ? "⭐ " : skill.standalone === false ? "🔗 " : "";
      const kind = getResourceKind(skill);
      const kindLabel = getResourceKindLabel(kind, isJa);
      const pluginPackageId = getPluginPackageId(skill, pluginPackages);
      const pluginLabel =
        kind === "plugin"
          ? undefined
          : getPluginPackageLabel(pluginPackageId, pluginPackages);
      const descriptionParts = [
        pluginLabel
          ? `${isJa ? "プラグイン" : "Plugin"}: ${pluginLabel}`
          : undefined,
        kindLabel,
        getLocalizedDescription(skill, isJa),
      ].filter((part): part is string => !!part);
      const item = new SkillTreeItem(
        isInstalled ? `✓ ${prefix}${skill.name}` : `${prefix}${skill.name}`,
        descriptionParts.join(" · "),
        vscode.TreeItemCollapsibleState.None,
        "skill",
        skill,
        undefined,
        undefined,
        this.skillIndex?.categories,
      );

      if (isInstalled) {
        item.iconPath = new vscode.ThemeIcon(
          getResourceKindIcon(kind),
          new vscode.ThemeColor("charts.green"),
        );
      } else {
        item.iconPath = new vscode.ThemeIcon(getResourceKindIcon(kind));
        const singleClickInstall = vscode.workspace
          .getConfiguration("resourceNinja")
          .get<boolean>("singleClickInstall", false);
        item.command = {
          command: singleClickInstall
            ? "resourceNinja.installDefault"
            : "resourceNinja.onSkillClick",
          title: isJa ? "リソースをインストール" : "Install Resource",
          arguments: [skill],
        };
      }

      if (skill.requires?.length) {
        const requiresLabel = isJa ? "依存" : "Requires";
        item.tooltip = `${item.tooltip}\n\n${requiresLabel}: ${skill.requires.join(", ")}`;
      }

      if (pluginLabel) {
        const pluginLabelName = isJa ? "プラグイン" : "Plugin";
        const pathLabel = isJa ? "リモートパス" : "Remote path";
        item.tooltip = `${item.tooltip}\n${pluginLabelName}: ${pluginLabel}\n${pathLabel}: ${skill.path}`;
      }

      return item;
    });
  }
}

/**
 * ツリーアイテム
 */
export class SkillTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly description: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly contextValue: string,
    public readonly skill?: Skill,
    public readonly source?: Source,
    public readonly bundle?: Bundle,
    public readonly categories?: Category[],
    public readonly resourceKind?: ResourceKind,
    public readonly parent?: SkillTreeItem,
    public readonly pluginId?: string,
  ) {
    super(label, collapsibleState);
    this.description = description;
    this.contextValue = contextValue;

    // アイコン設定
    if (contextValue === "source") {
      this.iconPath = new vscode.ThemeIcon("repo");
    } else if (contextValue === "skill") {
      this.iconPath = new vscode.ThemeIcon("package");
    } else if (contextValue === "installedSkill") {
      this.iconPath = new vscode.ThemeIcon("check");
    } else if (contextValue === "bundle") {
      this.iconPath = new vscode.ThemeIcon("package");
    } else if (contextValue === "plugin" || contextValue === "pluginSection") {
      this.iconPath = new vscode.ThemeIcon("extensions");
    }

    // ツールチップ
    if (skill) {
      const isJa = isJapanese();
      const localizedDesc = getLocalizedDescription(skill, isJa);

      // メタデータ情報を構築
      let metaInfo = "";
      if (skill.author) {
        metaInfo += `\n${isJa ? "作成者" : "Author"}: ${skill.author}`;
      }
      if (skill.license) {
        metaInfo += `\n${isJa ? "ライセンス" : "License"}: ${skill.license}`;
      }
      if (skill.version) {
        metaInfo += `\nVersion: ${skill.version}`;
      }

      this.tooltip = `${skill.name}\n${localizedDesc}${metaInfo}`;
    } else if (source) {
      const isJa = isJapanese();
      const localizedDesc =
        isJa && source.description_ja
          ? source.description_ja
          : source.description;
      this.tooltip = `${source.name}\n${localizedDesc}\n${source.url}`;
    } else if (bundle) {
      const isJa = isJapanese();
      const skillsLabel = isJa ? "スキル" : "Skills";
      this.tooltip = `${bundle.name}\n${
        isJa && bundle.description_ja
          ? bundle.description_ja
          : bundle.description
      }\n${skillsLabel}: ${bundle.skills.join(", ")}`;
    }
  }
}
