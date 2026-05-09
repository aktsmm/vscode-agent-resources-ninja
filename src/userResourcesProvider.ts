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
import {
  formatMcpLifecycleLabel,
  formatMcpLifecycleTooltipLines,
  getMcpConfigLifecycleStatus,
} from "./mcpConfigManager";
import {
  getHookConfigDiagnostics,
  HookConfigDiagnostics,
} from "./hookConfigManager";

type UserResourceNodeType =
  | "scope"
  | "builtInScope"
  | "builtInTool"
  | "pluginSection"
  | "plugin"
  | "kind"
  | "builtInKind"
  | "remoteResource"
  | "resource"
  | "placeholder";

const KIND_ORDER: ResourceKind[] = [
  "skill",
  "agent",
  "instruction",
  "prompt",
  "hook",
  "mcp",
  "plugin",
  "cursor-rule",
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

function formatHookEventCounts(
  eventCounts: Record<string, number>,
): string | undefined {
  const entries = Object.entries(eventCounts);
  if (entries.length === 0) {
    return undefined;
  }
  return entries
    .map(([eventName, count]) => `${eventName}(${count})`)
    .join(", ");
}

function formatHookDiagnosticsLabel(
  diagnostics: HookConfigDiagnostics,
  isJa: boolean,
): string {
  switch (diagnostics.status) {
    case "configured":
      return isJa ? "設定済み" : "Configured";
    case "needsReview":
      return isJa ? "確認が必要" : "Needs review";
    case "notConfigured":
    default:
      return isJa ? "未設定" : "Not configured";
  }
}

function formatHookDiagnosticsTooltipLines(
  diagnostics: HookConfigDiagnostics,
  isJa: boolean,
): string[] {
  const sourceLabel = isJa ? "設定ソース" : "Config source";
  const rootLabel = isJa ? "Root hooks.json" : "Root hooks.json";
  const eventsLabel = isJa ? "イベント" : "Events";
  const missingLabel = isJa ? "未登録イベント" : "Missing events";
  const warningsLabel = isJa ? "警告" : "Warnings";
  const reasonLabel = isJa ? "理由" : "Reason";
  const lines = [
    `${sourceLabel}: ${diagnostics.source}`,
    `${rootLabel}: ${diagnostics.configUri.fsPath}`,
  ];
  const events = formatHookEventCounts(diagnostics.eventCounts);
  if (events) lines.push(`${eventsLabel}: ${events}`);
  const missing = formatHookEventCounts(diagnostics.missingByEvent);
  if (missing) lines.push(`${missingLabel}: ${missing}`);
  if (diagnostics.reason) lines.push(`${reasonLabel}: ${diagnostics.reason}`);
  if (diagnostics.warnings.length > 0) {
    lines.push(`${warningsLabel}: ${diagnostics.warnings.join("; ")}`);
  }
  return lines;
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
      await this.enrichResourceStatuses();
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
            this.getPluginId(resource) === element.pluginId,
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

  private getPluginId(resource: UserResource): string | undefined {
    return (
      getPluginIdFromPath(resource.remotePath) ||
      getPluginIdFromPath(resource.relativePath) ||
      getPluginIdFromPath(resource.fullPath)
    );
  }

  private isRemoteInstalled(resource: UserResource): boolean {
    return (
      !resource.isBuiltIn &&
      !!resource.remotePath &&
      !!resource.source &&
      resource.source !== "local"
    );
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
      const pluginId = this.getPluginId(resource);
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
      isJapanese() ? "プラグイン別" : "Grouped by Plugin",
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

  private async enrichResourceStatuses(): Promise<void> {
    for (const resource of this.resources) {
      if (resource.isBuiltIn) {
        continue;
      }
      if (resource.kind === "mcp") {
        const status = await getMcpConfigLifecycleStatus(
          this.workspaceUri,
          vscode.Uri.file(resource.fullPath),
        );
        resource.lifecycleLabel = `${getResourceKindLabel(resource.kind, isJapanese())}: ${formatMcpLifecycleLabel(status, isJapanese())}`;
        resource.lifecycleTooltipLines = formatMcpLifecycleTooltipLines(
          status,
          isJapanese(),
        );
      }
      if (resource.kind === "hook") {
        const diagnostics = await getHookConfigDiagnostics(
          vscode.Uri.file(resource.rootFsPath),
          vscode.Uri.file(resource.fullPath),
        );
        const events = formatHookEventCounts(diagnostics.eventCounts);
        resource.lifecycleLabel = [
          `${getResourceKindLabel(resource.kind, isJapanese())}: ${formatHookDiagnosticsLabel(diagnostics, isJapanese())}`,
          events,
        ]
          .filter((part): part is string => !!part)
          .join(" · ");
        resource.lifecycleTooltipLines = formatHookDiagnosticsTooltipLines(
          diagnostics,
          isJapanese(),
        );
      }
    }
  }

  private createResourceItem(resource: UserResource): UserResourceTreeItem {
    const isRecent = getResourceIdentityKeys(resource).some((key) =>
      this.recentlyInstalled?.has(key),
    );
    const pluginId = this.getPluginId(resource);
    const pluginLabel = pluginId
      ? `${isJapanese() ? "プラグイン" : "Plugin"}: ${pluginId}`
      : undefined;
    const description = resource.isBuiltIn
      ? `built-in · ${resource.tool}`
      : [
          pluginLabel,
          resource.lifecycleLabel,
          resource.description || resource.relativePath,
        ]
          .filter((part): part is string => !!part)
          .join(" · ");
    return new UserResourceTreeItem(
      `${isRecent ? "🆕 " : ""}${resource.name}`,
      description,
      vscode.TreeItemCollapsibleState.None,
      this.isRemoteInstalled(resource) ? "remoteResource" : "resource",
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
      nodeType === "resource" || nodeType === "remoteResource"
        ? resource?.isBuiltIn
          ? "builtInUserResource"
          : nodeType === "remoteResource"
            ? "userRemoteResource"
            : "userResource"
        : nodeType;

    if (resource) {
      this.resourceUri = vscode.Uri.file(resource.fullPath);
      this.iconPath = new vscode.ThemeIcon(getResourceKindIcon(resource.kind));
      const status = resource.isBuiltIn
        ? `Built-in · ${resource.tool}`
        : resource.scopeLabel;
      const pluginId =
        getPluginIdFromPath(resource.remotePath) ||
        getPluginIdFromPath(resource.relativePath) ||
        getPluginIdFromPath(resource.fullPath);
      const pluginLine = pluginId
        ? `\n${isJapanese() ? "プラグイン" : "Plugin"}: ${pluginId}`
        : "";
      const lifecycleLines = resource.lifecycleTooltipLines?.length
        ? `\n${resource.lifecycleTooltipLines.join("\n")}`
        : "";
      this.tooltip = `${resource.name}\n${resource.description || "No description"}${pluginLine}${lifecycleLines}\n${status}\n${resource.relativePath}\n${resource.fullPath}`;
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
