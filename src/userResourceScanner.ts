import * as vscode from "vscode";
import { ResourceKind } from "./skillIndex";
import {
  DEFAULT_GLOBAL_HOME_DIRECTORY,
  getConfiguredGlobalHomeDirectory,
  getConfiguredUserAgentsDirectory,
  getConfiguredUserInstructionsDirectory,
  getConfiguredUserPromptsDirectory,
  resolveConfiguredUri,
} from "./customizationPaths";
import {
  detectResourceKindFromPath,
  getBuiltInResourceSourceLabel,
  getBuiltInResourceDedupeKey,
  getDefaultResourceCategories,
  getFallbackResourceName,
  getResourceMetadataPath,
  isBuiltInResourcePath,
  shouldReplaceBuiltInResourcePath,
} from "./resourceKinds";
import { getVsCodeUserDataPath } from "./userDataPaths";

export type UserResourceScope = "userData" | "globalHome";

export interface UserResourceRoot {
  scope: UserResourceScope;
  label: string;
  tool: string;
  uri: vscode.Uri;
  relativeBase?: string;
  builtInOnly?: boolean;
}

export interface UserResource {
  kind: ResourceKind;
  name: string;
  description: string;
  categories: string[];
  relativePath: string;
  remotePath?: string;
  fullPath: string;
  scope: UserResourceScope;
  scopeLabel: string;
  tool: string;
  rootLabel: string;
  isBuiltIn?: boolean;
}

interface ResourceInstallMeta {
  name?: string;
  source?: string;
  description?: string;
  description_ja?: string;
  categories?: string[];
  remotePath?: string;
}

function normalizeSeparators(value: string): string {
  return value.replace(/\\/g, "/");
}

function getRelativeFsPath(baseFsPath: string, targetFsPath: string): string {
  const base = normalizeSeparators(baseFsPath).replace(/\/+$/, "");
  const target = normalizeSeparators(targetFsPath);
  const baseCompare = base.toLowerCase();
  const targetCompare = target.toLowerCase();

  if (targetCompare === baseCompare) {
    return "";
  }

  const basePrefix = `${baseCompare}/`;
  if (targetCompare.startsWith(basePrefix)) {
    return target.slice(base.length + 1);
  }

  return target;
}

function getKnownRoots(
  workspaceUri?: vscode.Uri,
  includeBuiltInResources: boolean = false,
): UserResourceRoot[] {
  const roots: UserResourceRoot[] = [];
  const config = vscode.workspace.getConfiguration("resourceNinja");
  const userDataUri = vscode.Uri.file(
    getVsCodeUserDataPath({ appName: vscode.env.appName }),
  );
  roots.push(
    {
      scope: "userData",
      label: "VS Code User Customizations",
      tool: "VS Code",
      uri: resolveConfiguredUri(
        workspaceUri,
        getConfiguredUserAgentsDirectory(config),
        vscode.Uri.joinPath(userDataUri, "agents").fsPath,
      ),
    },
    {
      scope: "userData",
      label: "VS Code User Customizations",
      tool: "VS Code",
      uri: resolveConfiguredUri(
        workspaceUri,
        getConfiguredUserInstructionsDirectory(config),
        vscode.Uri.joinPath(userDataUri, "instructions").fsPath,
      ),
    },
    {
      scope: "userData",
      label: "VS Code User Customizations",
      tool: "VS Code",
      uri: resolveConfiguredUri(
        workspaceUri,
        getConfiguredUserPromptsDirectory(config),
        vscode.Uri.joinPath(userDataUri, "prompts").fsPath,
      ),
    },
  );

  roots.push({
    scope: "globalHome",
    label: "Global Resource Home",
    tool: "Shared resource root",
    uri: resolveConfiguredUri(
      workspaceUri,
      getConfiguredGlobalHomeDirectory(config),
      DEFAULT_GLOBAL_HOME_DIRECTORY,
    ),
  });

  if (includeBuiltInResources) {
    roots.push(
      {
        scope: "userData",
        label: "Built-in Resources",
        tool: "GitHub Copilot Chat",
        uri: vscode.Uri.joinPath(
          userDataUri,
          "globalStorage",
          "github.copilot-chat",
        ),
        builtInOnly: true,
      },
      {
        scope: "userData",
        label: "Built-in Resources",
        tool: "GitHub Copilot Chat",
        uri: vscode.Uri.joinPath(
          vscode.Uri.file(vscode.env.appRoot),
          "extensions",
          "copilot",
          "assets",
          "prompts",
        ),
        builtInOnly: true,
      },
      {
        scope: "userData",
        label: "Built-in Resources",
        tool: "VS Code",
        uri: vscode.Uri.joinPath(
          vscode.Uri.file(vscode.env.appRoot),
          "out",
          "vs",
          "sessions",
        ),
        builtInOnly: true,
      },
      {
        scope: "userData",
        label: "Built-in Resources",
        tool: "VS Code",
        uri: vscode.Uri.joinPath(
          vscode.Uri.file(vscode.env.appRoot),
          "node_modules",
          "@github",
          "copilot",
          "builtin-skills",
        ),
        builtInOnly: true,
      },
    );

    for (const extension of vscode.extensions.all) {
      const extensionId = extension.id.toLowerCase();
      const extensionPath = normalizeSeparators(extension.extensionPath);
      const isVsCodeBundledExtension =
        /(^|\/)resources\/app\/extensions\/[^/]+$/.test(
          extensionPath.toLowerCase(),
        );
      if (
        extensionId === "github.copilot-chat" ||
        /(^|\/)github\.copilot-chat-[^/]+$/.test(extensionPath.toLowerCase())
      ) {
        roots.push({
          scope: "userData",
          label: "Built-in Resources",
          tool: "GitHub Copilot Chat",
          uri: vscode.Uri.joinPath(extension.extensionUri, "assets", "prompts"),
          builtInOnly: true,
        });
      }

      if (isVsCodeBundledExtension) {
        roots.push({
          scope: "userData",
          label: "Built-in Resources",
          tool: "VS Code",
          uri: vscode.Uri.joinPath(extension.extensionUri, "skills"),
          builtInOnly: true,
        });
      }
    }
  }

  return roots;
}

async function pathExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function collectMarkdownFiles(
  root: vscode.Uri,
  includeBuiltInResources: boolean,
): Promise<vscode.Uri[]> {
  const files: vscode.Uri[] = [];
  const maxFiles = 2000;

  async function walk(current: vscode.Uri): Promise<void> {
    if (files.length >= maxFiles) {
      return;
    }

    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(current);
    } catch {
      return;
    }

    for (const [name, type] of entries) {
      if (
        name === "node_modules" ||
        name === ".git" ||
        (!includeBuiltInResources && name === "pkg")
      ) {
        continue;
      }

      const child = vscode.Uri.joinPath(current, name);
      if (type === vscode.FileType.Directory) {
        await walk(child);
      } else if (
        type === vscode.FileType.File &&
        (name.toLowerCase().endsWith(".md") ||
          name.toLowerCase().endsWith(".json"))
      ) {
        files.push(child);
        if (files.length >= maxFiles) {
          return;
        }
      }
    }
  }

  await walk(root);
  return files;
}

function parseFrontmatterValue(frontmatter: string, key: string): string {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*([^\\n]+)`, "m"));
  return match?.[1]?.trim().replace(/^["']|["']$/g, "") || "";
}

async function readResourceInstallMetadata(
  fileUri: vscode.Uri,
  kind: ResourceKind,
): Promise<ResourceInstallMeta | undefined> {
  try {
    const metadataUri = vscode.Uri.file(
      getResourceMetadataPath(fileUri.fsPath, kind),
    );
    const document = await vscode.workspace.openTextDocument(metadataUri);
    return JSON.parse(document.getText());
  } catch {
    return undefined;
  }
}

async function parseResourceFile(
  fileUri: vscode.Uri,
  root: UserResourceRoot,
): Promise<UserResource | undefined> {
  const relativePath = normalizeSeparators(
    getRelativeFsPath(root.uri.fsPath, fileUri.fsPath),
  );
  const detectionPath = root.relativeBase
    ? `${root.relativeBase}/${relativePath}`
    : relativePath;
  const kind = detectResourceKindFromPath(detectionPath);
  if (!kind) {
    return undefined;
  }
  const installMeta = await readResourceInstallMetadata(fileUri, kind);

  let name = "";
  let description = "";
  try {
    const document = await vscode.workspace.openTextDocument(fileUri);
    const text = document.getText().replace(/\r\n/g, "\n");
    const frontmatterMatch = text.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      name = parseFrontmatterValue(frontmatterMatch[1], "name");
      description = parseFrontmatterValue(frontmatterMatch[1], "description");
    }
    if (!name) {
      name = text.match(/^#\s+(.+)$/m)?.[1]?.trim() || "";
    }
  } catch {
    // Keep fallback metadata if the file cannot be read.
  }

  const normalizedDetectionPath = normalizeSeparators(detectionPath);
  const isBuiltIn =
    isBuiltInResourcePath(normalizedDetectionPath) ||
    isBuiltInResourcePath(fileUri.fsPath);
  if (root.builtInOnly && !isBuiltIn) {
    return undefined;
  }
  if (!name) {
    name = getFallbackResourceName(normalizedDetectionPath, kind);
  }
  name = installMeta?.name || name;
  description = installMeta?.description || description;

  return {
    kind,
    name,
    description,
    categories: installMeta?.categories?.length
      ? installMeta.categories
      : getDefaultResourceCategories(kind),
    relativePath: normalizedDetectionPath,
    remotePath: installMeta?.remotePath,
    fullPath: fileUri.fsPath,
    scope: root.scope,
    scopeLabel: root.label,
    tool: isBuiltIn ? getBuiltInResourceSourceLabel(fileUri.fsPath) : root.tool,
    rootLabel: root.label,
    isBuiltIn,
  };
}

export async function scanUserResources(
  workspaceUri?: vscode.Uri,
  includeBuiltInResources: boolean = false,
): Promise<UserResource[]> {
  const roots = getKnownRoots(workspaceUri, includeBuiltInResources);
  const resources = new Map<string, UserResource>();
  const seenPaths = new Set<string>();

  for (const root of roots) {
    if (!(await pathExists(root.uri))) {
      continue;
    }

    const files = await collectMarkdownFiles(root.uri, includeBuiltInResources);
    for (const file of files) {
      const key = file.fsPath.toLowerCase();
      if (seenPaths.has(key)) {
        continue;
      }
      seenPaths.add(key);

      const resource = await parseResourceFile(file, root);
      if (resource) {
        if (resource.isBuiltIn && !includeBuiltInResources) {
          continue;
        }
        const resourceKey = resource.isBuiltIn
          ? getBuiltInResourceDedupeKey(resource)
          : `${resource.scope}:${resource.kind}:${resource.relativePath.toLowerCase()}`;
        const existing = resources.get(resourceKey);
        if (
          existing?.isBuiltIn &&
          !shouldReplaceBuiltInResourcePath(
            existing.fullPath,
            resource.fullPath,
          )
        ) {
          continue;
        }
        resources.set(resourceKey, resource);
      }
    }
  }

  return Array.from(resources.values()).sort((a, b) => {
    const scopeCompare = a.scopeLabel.localeCompare(b.scopeLabel);
    if (scopeCompare !== 0) return scopeCompare;
    const kindCompare = a.kind.localeCompare(b.kind);
    if (kindCompare !== 0) return kindCompare;
    return a.name.localeCompare(b.name);
  });
}
