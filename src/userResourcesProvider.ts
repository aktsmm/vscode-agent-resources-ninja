import * as path from "path";
import * as vscode from "vscode";
import {
  ResourceKind,
  getResourceKindIcon,
  getResourceKindLabel,
} from "./skillIndex";
import {
  UserResource,
  UserResourceScope,
  scanUserResources,
} from "./userResourceScanner";
import { isJapanese } from "./i18n";
import { getPluginIdFromPath, getResourceIdentityKeys } from "./resourceKinds";

type UserResourceNodeType =
  | "scope"
  | "builtInScope"
  | "builtInTool"
  | "pluginSection"
  | "plugin"
  | "kind"
  | "builtInKind"
  | "resource"
  | "placeholder";

const KIND_ORDER: ResourceKind[] = [
  "skill",
  "agent",
  "instruction",
  "prompt",
  "hook",
  "mcp",
];

function getScopeIcon(scope: UserResourceScope): string {
  switch (scope) {
    case "userData":
      return "account";
    case "globalHome":
    default:
      return "home";
  }
}

export class UserResourcesProvider implements vscode.TreeDataProvider<UserResourceTreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    UserResourceTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private resources: UserResource[] = [];
  private hasLoaded = false;

  constructor(
    private workspaceUri: vscode.Uri | undefined,
    private recentlyInstalled?: Set<string>,
  ) {}

  refresh(): void {
    this.resources = [];
    this.hasLoaded = false;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: UserResourceTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(
    element?: UserResourceTreeItem,
  ): Promise<UserResourceTreeItem[]> {
    if (!this.hasLoaded) {
      this.resources = await scanUserResources(
        this.workspaceUri,
        this.shouldShowBuiltInResources(),
      );
      this.hasLoaded = true;
    }

    if (!element) {
      const regularResources = this.getRegularResources();
      const builtInResources = this.getBuiltInResources();
      if (regularResources.length === 0 && builtInResources.length === 0) {
        return [
          new UserResourceTreeItem(
            isJapanese()
              ? "User / Global Resource Home にリソースが見つかりません"
              : "No resources found in User / Global Resource Home",
            isJapanese()
              ? "Remote Resources からインストールするか、Settings で Global Resource Home の場所を確認してください"
              : "Install from Remote Resources or check Settings for the selected Global Resource Home location",
            vscode.TreeItemCollapsibleState.None,
            "placeholder",
          ),
        ];
      }

      const scopes = Array.from(
        new Map(
          regularResources.map((resource) => [
            `${resource.scope}:${resource.scopeLabel}`,
            resource,
          ]),
        ).values(),
      );
      const items = scopes.map((resource) => {
        const count = regularResources.filter(
          (candidate) =>
            candidate.scope === resource.scope &&
            candidate.scopeLabel === resource.scopeLabel,
        ).length;
        const item = new UserResourceTreeItem(
          resource.scopeLabel,
          `${count} resources · ${resource.tool}`,
          vscode.TreeItemCollapsibleState.Expanded,
          "scope",
          undefined,
          resource.scope,
          undefined,
          resource.scopeLabel,
        );
        item.iconPath = new vscode.ThemeIcon(getScopeIcon(resource.scope));
        return item;
      });

      if (builtInResources.length > 0) {
        const tools = Array.from(
          new Set(builtInResources.map((resource) => resource.tool)),
        ).sort((a, b) => a.localeCompare(b));
        const item = new UserResourceTreeItem(
          isJapanese() ? "組み込みリソース" : "Built-in Resources",
          `${builtInResources.length} resources · ${tools.join(" / ")}`,
          vscode.TreeItemCollapsibleState.Collapsed,
          "builtInScope",
        );
        item.iconPath = new vscode.ThemeIcon("extensions");
        items.push(item);
      }

      return items;
    }

    if (element.nodeType === "scope" && element.scope) {
      const scopedResources = this.getRegularResources().filter(
        (resource) =>
          resource.scope === element.scope &&
          resource.scopeLabel === element.scopeLabel,
      );
      const items: UserResourceTreeItem[] = [];
      this.addPluginSection(items, scopedResources, element);
      items.push(...this.createKindItems(scopedResources, "kind", element));
      return items;
    }

    if (element.nodeType === "pluginSection" && element.scope) {
      const scopedResources = this.getRegularResources().filter(
        (resource) =>
          resource.scope === element.scope &&
          resource.scopeLabel === element.scopeLabel,
      );
      return this.getPluginGroups(scopedResources).map((plugin) => {
        const item = new UserResourceTreeItem(
          plugin.id,
          `${plugin.resources.length} resources`,
          vscode.TreeItemCollapsibleState.Collapsed,
          "plugin",
          undefined,
          element.scope,
          undefined,
          element.scopeLabel,
          plugin.id,
        );
        item.iconPath = new vscode.ThemeIcon(
          "extensions",
          new vscode.ThemeColor("charts.purple"),
        );
        return item;
      });
    }

    if (element.nodeType === "plugin" && element.scope && element.pluginId) {
      return this.getRegularResources()
        .filter(
          (resource) =>
            resource.scope === element.scope &&
            resource.scopeLabel === element.scopeLabel &&
            getPluginIdFromPath(resource.remotePath) === element.pluginId,
        )
        .map((resource) => this.createResourceItem(resource));
    }

    if (element.nodeType === "builtInScope") {
      const tools = Array.from(
        new Set(this.getBuiltInResources().map((resource) => resource.tool)),
      ).sort((a, b) => a.localeCompare(b));
      return tools.map((tool) => {
        const resources = this.getBuiltInResources().filter(
          (resource) => resource.tool === tool,
        );
        const item = new UserResourceTreeItem(
          tool,
          `${resources.length} resources`,
          vscode.TreeItemCollapsibleState.Collapsed,
          "builtInTool",
          undefined,
          undefined,
          undefined,
          tool,
        );
        item.iconPath = new vscode.ThemeIcon("extensions");
        return item;
      });
    }

    if (element.nodeType === "builtInTool" && element.scopeLabel) {
      return this.createKindItems(
        this.getBuiltInResources().filter(
          (resource) => resource.tool === element.scopeLabel,
        ),
        "builtInKind",
        element,
      );
    }

    if (element.nodeType === "kind" && element.scope && element.kind) {
      return this.getRegularResources()
        .filter(
          (resource) =>
            resource.scope === element.scope &&
            resource.scopeLabel === element.scopeLabel &&
            resource.kind === element.kind,
        )
        .map((resource) => this.createResourceItem(resource));
    }

    if (element.nodeType === "builtInKind" && element.kind) {
      return this.getBuiltInResources()
        .filter(
          (resource) =>
            resource.kind === element.kind &&
            (!element.scopeLabel || resource.tool === element.scopeLabel),
        )
        .map((resource) => this.createResourceItem(resource));
    }

    return [];
  }

  private shouldShowBuiltInResources(): boolean {
    return vscode.workspace
      .getConfiguration("resourceNinja")
      .get<boolean>("showBuiltInResources", false);
  }

  private getRegularResources(): UserResource[] {
    return this.resources.filter((resource) => !resource.isBuiltIn);
  }

  private getBuiltInResources(): UserResource[] {
    return this.resources.filter((resource) => resource.isBuiltIn);
  }

  private createKindItems(
    resources: UserResource[],
    nodeType: "kind" | "builtInKind",
    parent: UserResourceTreeItem,
  ): UserResourceTreeItem[] {
    const presentKinds = KIND_ORDER.filter((kind) =>
      resources.some((resource) => resource.kind === kind),
    );
    return presentKinds.map((kind) => {
      const count = resources.filter(
        (resource) => resource.kind === kind,
      ).length;
      const item = new UserResourceTreeItem(
        getResourceKindLabel(kind, isJapanese()),
        `${count} resources`,
        vscode.TreeItemCollapsibleState.Collapsed,
        nodeType,
        undefined,
        parent.scope,
        kind,
        parent.scopeLabel,
      );
      item.iconPath = new vscode.ThemeIcon(getResourceKindIcon(kind));
      return item;
    });
  }

  private getPluginGroups(
    resources: UserResource[],
  ): Array<{ id: string; resources: UserResource[] }> {
    const groups = new Map<string, UserResource[]>();
    for (const resource of resources) {
      const pluginId = getPluginIdFromPath(resource.remotePath);
      if (!pluginId) {
        continue;
      }
      const groupResources = groups.get(pluginId) || [];
      groupResources.push(resource);
      groups.set(pluginId, groupResources);
    }
    return [...groups.entries()]
      .map(([id, groupResources]) => ({ id, resources: groupResources }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  private addPluginSection(
    items: UserResourceTreeItem[],
    resources: UserResource[],
    parent: UserResourceTreeItem,
  ): void {
    const pluginGroups = this.getPluginGroups(resources);
    if (pluginGroups.length === 0) {
      return;
    }
    const resourceCount = pluginGroups.reduce(
      (total, plugin) => total + plugin.resources.length,
      0,
    );
    const item = new UserResourceTreeItem(
      isJapanese() ? "プラグイン由来" : "Plugin-derived",
      `${pluginGroups.length} groups · ${resourceCount} resources`,
      vscode.TreeItemCollapsibleState.Collapsed,
      "pluginSection",
      undefined,
      parent.scope,
      undefined,
      parent.scopeLabel,
    );
    item.iconPath = new vscode.ThemeIcon(
      "extensions",
      new vscode.ThemeColor("charts.purple"),
    );
    items.push(item);
  }

  getResources(): UserResource[] {
    return this.resources;
  }

  private createResourceItem(resource: UserResource): UserResourceTreeItem {
    const isRecent = getResourceIdentityKeys(resource).some((key) =>
      this.recentlyInstalled?.has(key),
    );
    return new UserResourceTreeItem(
      `${isRecent ? "🆕 " : ""}${resource.name}`,
      resource.isBuiltIn
        ? `built-in · ${resource.tool}`
        : resource.description || resource.relativePath,
      vscode.TreeItemCollapsibleState.None,
      "resource",
      resource,
      resource.scope,
      resource.kind,
      resource.scopeLabel,
    );
  }
}

export class UserResourceTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    description: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly nodeType: UserResourceNodeType,
    public readonly resource?: UserResource,
    public readonly scope?: UserResourceScope,
    public readonly kind?: ResourceKind,
    public readonly scopeLabel?: string,
    public readonly pluginId?: string,
  ) {
    super(label, collapsibleState);
    this.description = description;
    this.contextValue =
      nodeType === "resource"
        ? resource?.isBuiltIn
          ? "builtInUserResource"
          : "userResource"
        : nodeType;

    if (resource) {
      this.resourceUri = vscode.Uri.file(resource.fullPath);
      this.iconPath = new vscode.ThemeIcon(getResourceKindIcon(resource.kind));
      const status = resource.isBuiltIn
        ? `Built-in · ${resource.tool}`
        : resource.scopeLabel;
      this.tooltip = `${resource.name}\n${resource.description || "No description"}\n${status}\n${resource.relativePath}\n${resource.fullPath}`;
      this.command = {
        command: "resourceNinja.openUserResource",
        title: isJapanese() ? "リソースを開く" : "Open Resource",
        arguments: [this],
      };
    } else if (nodeType === "placeholder") {
      this.iconPath = new vscode.ThemeIcon("info");
    } else if (nodeType === "plugin" || nodeType === "pluginSection") {
      this.iconPath = new vscode.ThemeIcon("extensions");
    }
  }

  get folderUri(): vscode.Uri | undefined {
    if (!this.resource) {
      return undefined;
    }
    return vscode.Uri.file(path.dirname(this.resource.fullPath));
  }
}
