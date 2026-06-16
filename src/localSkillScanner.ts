// ローカルスキルのスキャンと AGENTS.md 同期
// ワークスペース内の SKILL.md を検出し、AGENTS.md と同期

import * as path from "path";
import * as vscode from "vscode";
import { Skill } from "./skillIndex";
import {
  detectResourceKindFromPath,
  getBuiltInResourceSourceLabel,
  getDefaultResourceCategories,
  getFallbackResourceName,
  getResourceMetadataPath,
  isBuiltInResourcePath,
} from "./resourceKinds";
import { updateInstructionFile } from "./instructionManager";
import {
  DISABLED_INSTRUCTION_FILE,
  DEFAULT_WORKSPACE_AGENTS_DIRECTORY,
  DEFAULT_WORKSPACE_HOOKS_DIRECTORY,
  DEFAULT_WORKSPACE_INSTRUCTIONS_DIRECTORY,
  DEFAULT_WORKSPACE_MCP_DIRECTORY,
  DEFAULT_WORKSPACE_PROMPTS_DIRECTORY,
  DEFAULT_SKILLS_DIRECTORY,
  getConfiguredAdditionalSkillRoots,
  getConfiguredInstructionFilePath,
  getConfiguredIncludeLocalResources,
  getConfiguredSkillsDirectory,
  getConfiguredWorkspaceAgentsDirectory,
  getConfiguredWorkspaceHooksDirectory,
  getConfiguredWorkspaceInstructionsDirectory,
  getConfiguredWorkspaceMcpDirectory,
  getConfiguredWorkspacePromptsDirectory,
  getRelativeSkillsPathForWorkspace,
  isSameOrChildWorkspacePath,
  resolveConfiguredUri,
  resolveInstructionFileUri,
} from "./customizationPaths";
import { logger } from "./logger";

const MAX_LOCAL_RESOURCE_FILES = 1000;

interface ResourceInstallMeta {
  name?: string;
  source?: string;
  description?: string;
  description_ja?: string;
  categories?: string[];
  remotePath?: string;
  pluginRoot?: string;
  pluginManifestPath?: string;
  pluginManifestKind?: string;
}

interface ScanCandidate {
  uri: vscode.Uri;
  detectionPath?: string;
  displayPath?: string;
}

interface ConfiguredResourceRoot {
  rootUri: vscode.Uri;
  glob: string;
  detectionBase: string;
}

type WorkspaceFallbackMode = "auto" | "always" | "none";

interface ScanLocalSkillsOptions {
  workspaceFallback?: WorkspaceFallbackMode;
}

function normalizeSeparators(value: string): string {
  return value.replace(/\\/g, "/");
}

function getWorkspaceRelativeOrAbsolutePath(
  workspaceUri: vscode.Uri,
  fileUri: vscode.Uri,
): string {
  const relativePath = path.relative(workspaceUri.fsPath, fileUri.fsPath);
  if (!relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
    return normalizeSeparators(relativePath);
  }
  return normalizeSeparators(fileUri.fsPath);
}

function getConfiguredWorkspaceResourceRoots(
  workspaceUri: vscode.Uri,
  config: vscode.WorkspaceConfiguration,
): ConfiguredResourceRoot[] {
  const skillRoots: ConfiguredResourceRoot[] = [
    getConfiguredSkillsDirectory(config),
    ...getConfiguredAdditionalSkillRoots(config),
  ].map((configuredPath) => ({
    rootUri: resolveConfiguredUri(
      workspaceUri,
      configuredPath,
      DEFAULT_SKILLS_DIRECTORY,
    ),
    glob: "**/SKILL.md",
    detectionBase: "skills",
  }));

  return [
    ...skillRoots,
    {
      rootUri: resolveConfiguredUri(
        workspaceUri,
        getConfiguredWorkspaceAgentsDirectory(config),
        DEFAULT_WORKSPACE_AGENTS_DIRECTORY,
      ),
      glob: "**/*.agent.md",
      detectionBase: "agents",
    },
    {
      rootUri: resolveConfiguredUri(
        workspaceUri,
        getConfiguredWorkspaceInstructionsDirectory(config),
        DEFAULT_WORKSPACE_INSTRUCTIONS_DIRECTORY,
      ),
      glob: "**/*.instructions.md",
      detectionBase: "instructions",
    },
    {
      rootUri: resolveConfiguredUri(
        workspaceUri,
        getConfiguredWorkspacePromptsDirectory(config),
        DEFAULT_WORKSPACE_PROMPTS_DIRECTORY,
      ),
      glob: "**/*.prompt.md",
      detectionBase: "prompts",
    },
    {
      rootUri: resolveConfiguredUri(
        workspaceUri,
        getConfiguredWorkspaceHooksDirectory(config),
        DEFAULT_WORKSPACE_HOOKS_DIRECTORY,
      ),
      glob: "**/README.md",
      detectionBase: "hooks",
    },
    {
      rootUri: resolveConfiguredUri(
        workspaceUri,
        getConfiguredWorkspaceHooksDirectory(config),
        DEFAULT_WORKSPACE_HOOKS_DIRECTORY,
      ),
      glob: "*.json",
      detectionBase: "hooks",
    },
    {
      rootUri: resolveConfiguredUri(
        workspaceUri,
        getConfiguredWorkspaceMcpDirectory(config),
        DEFAULT_WORKSPACE_MCP_DIRECTORY,
      ),
      glob: "**/*.json",
      detectionBase: "mcp",
    },
  ];
}

async function readResourceInstallMetadata(
  fileUri: vscode.Uri,
  kind: NonNullable<LocalSkill["kind"]>,
): Promise<ResourceInstallMeta | undefined> {
  try {
    const metadataUri = vscode.Uri.file(
      getResourceMetadataPath(fileUri.fsPath, kind),
    );
    const content = await vscode.workspace.fs.readFile(metadataUri);
    return JSON.parse(Buffer.from(content).toString("utf8"));
  } catch {
    return undefined;
  }
}

const WORKSPACE_SCAN_EXCLUDE_PATTERN =
  "{**/node_modules/**,**/.vscode-test/**}";

function getWorkspaceFallbackPatterns(
  includeNonSkillResources: boolean,
): string[] {
  return includeNonSkillResources
    ? [
        "**/SKILL.md",
        "**/*.agent.md",
        "**/*.instructions.md",
        "**/*.prompt.md",
        "**/hooks/**/README.md",
        "**/.github/hooks/*.json",
        "**/hooks/*.json",
        "**/mcp.json",
        "**/mcp-config.json",
        "**/.mcp.json",
        "**/mcp/*.json",
        "**/.github/mcp/*.json",
        "**/plugin.json",
        "**/.claude-plugin/*.json",
        "**/.codex-plugin/*.json",
        "**/.cursor-plugin/*.json",
        "**/.plugin/*.json",
        "**/gemini-extension.json",
        "**/apm.{yml,yaml}",
        "**/rules/*.mdc",
      ]
    : ["**/SKILL.md"];
}

async function findWorkspaceFallbackCandidates(
  workspaceUri: vscode.Uri,
  includeNonSkillResources: boolean,
): Promise<ScanCandidate[]> {
  const foundFiles = await Promise.all(
    getWorkspaceFallbackPatterns(includeNonSkillResources).map((glob) =>
      vscode.workspace.findFiles(
        new vscode.RelativePattern(workspaceUri, glob),
        WORKSPACE_SCAN_EXCLUDE_PATTERN,
        MAX_LOCAL_RESOURCE_FILES,
      ),
    ),
  );

  return foundFiles.flat().map((uri) => ({ uri }));
}

async function findConfiguredWorkspaceCandidates(
  workspaceUri: vscode.Uri,
  config: vscode.WorkspaceConfiguration,
  includeNonSkillResources: boolean,
): Promise<ScanCandidate[]> {
  const roots = getConfiguredWorkspaceResourceRoots(
    workspaceUri,
    config,
  ).filter(
    (root) => includeNonSkillResources || root.detectionBase === "skills",
  );

  const configuredRootFiles = await Promise.all(
    roots.map(async (root) => {
      const files = await vscode.workspace.findFiles(
        new vscode.RelativePattern(root.rootUri, root.glob),
        WORKSPACE_SCAN_EXCLUDE_PATTERN,
        MAX_LOCAL_RESOURCE_FILES,
      );
      return files.map((uri): ScanCandidate => {
        const relativeToRoot = normalizeSeparators(
          path.relative(root.rootUri.fsPath, uri.fsPath),
        );
        return {
          uri,
          detectionPath: `${root.detectionBase}/${relativeToRoot}`,
          displayPath: getWorkspaceRelativeOrAbsolutePath(workspaceUri, uri),
        };
      });
    }),
  );

  return configuredRootFiles.flat();
}

function shouldUseWorkspaceFallback(
  mode: WorkspaceFallbackMode,
  configuredSkills: LocalSkill[],
): boolean {
  if (mode === "always") {
    return true;
  }
  if (mode === "none") {
    return false;
  }
  return configuredSkills.length === 0;
}

/**
 * ローカルスキル情報（拡張版）
 */
export interface LocalSkill extends Skill {
  isLocal: true;
  fullPath: string; // フルパス
  relativePath: string; // ワークスペース相対パス
  isRegistered: boolean; // AGENTS.md に登録済みか
  isBuiltIn?: boolean; // VS Code / Copilot Chat built-in resource
  registrationFile?: string; // 登録されているファイル (AGENTS.md など)
}

/**
 * AGENTS.md のスキル参照情報
 */
export interface SkillReference {
  name: string;
  path: string;
  line: number;
  isLocal: boolean;
}

function unquoteYamlValue(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "");
}

function stripYamlInlineComment(value: string): string {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let bracketDepth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      continue;
    }

    if (char === "[") {
      bracketDepth += 1;
      continue;
    }

    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }

    if (char === "#" && bracketDepth === 0) {
      const previousChar = index > 0 ? value[index - 1] : "";
      if (index === 0 || /\s/.test(previousChar)) {
        return value.slice(0, index).trimEnd();
      }
    }
  }

  return value.trimEnd();
}

function parseInlineYamlArray(value: string): string[] {
  const match = stripYamlInlineComment(value).match(/^\[(.*)\]$/);
  if (!match) {
    return [];
  }

  return match[1]
    .split(",")
    .map((item) => unquoteYamlValue(item))
    .filter(Boolean);
}

function getBlockScalarStyle(value: string): ">" | "|" | null {
  const match = value.match(
    /^([>|])(?:([1-9])([+-])?|([+-])([1-9])?)?(?:\s+#.*)?$/,
  );
  if (!match) {
    return null;
  }

  return match[1] as ">" | "|";
}

function parseTopLevelFrontmatter(frontmatter: string): Map<string, string> {
  const values = new Map<string, string>();
  const lines = frontmatter.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyMatch) {
      continue;
    }

    const [, key, rawValue] = keyMatch;
    const trimmedValue = rawValue.trim();
    const blockScalarStyle = getBlockScalarStyle(trimmedValue);

    if (blockScalarStyle) {
      const blockLines: string[] = [];
      let blockIndent: number | null = null;

      while (index + 1 < lines.length) {
        const nextLine = lines[index + 1];
        if (!nextLine.trim()) {
          blockLines.push("");
          index += 1;
          continue;
        }

        const indentMatch = nextLine.match(/^(\s+)/);
        if (!indentMatch) {
          break;
        }

        const indentLength = indentMatch[1].length;
        if (blockIndent === null) {
          blockIndent = indentLength;
        }
        if (indentLength < blockIndent) {
          break;
        }

        blockLines.push(nextLine.slice(blockIndent));
        index += 1;
      }

      values.set(
        key,
        (blockScalarStyle === ">"
          ? blockLines.join(" ")
          : blockLines.join("\n")
        ).trim(),
      );
      continue;
    }

    values.set(key, unquoteYamlValue(stripYamlInlineComment(trimmedValue)));
  }

  return values;
}

/**
 * ワークスペース内の SKILL.md をスキャン
 * @param workspaceUri ワークスペースの URI
 * @param includeInstalled true の場合、.github/skills 配下も含める
 */
export async function scanLocalSkills(
  workspaceUri: vscode.Uri,
  includeInstalled: boolean = false,
  includeNonSkillResources: boolean = false,
  includeBuiltInResources: boolean = false,
  options: ScanLocalSkillsOptions = {},
): Promise<LocalSkill[]> {
  const skills: LocalSkill[] = [];

  // 設定からスキルディレクトリを取得
  const config = vscode.workspace.getConfiguration("resourceNinja");
  const skillsDir = getRelativeSkillsPathForWorkspace(
    getConfiguredSkillsDirectory(config),
  );

  const workspaceFallback = options.workspaceFallback || "auto";
  const configuredCandidates = await findConfiguredWorkspaceCandidates(
    workspaceUri,
    config,
    includeNonSkillResources,
  );
  const builtInNodeModuleFiles = includeBuiltInResources
    ? await vscode.workspace.findFiles(
        new vscode.RelativePattern(
          workspaceUri,
          "**/resources/app/node_modules/**/SKILL.md",
        ),
        "**/.vscode-test/**",
        MAX_LOCAL_RESOURCE_FILES,
      )
    : [];
  const seenPaths = new Set<string>();

  const parseCandidates = async (
    candidates: ScanCandidate[],
  ): Promise<LocalSkill[]> => {
    const parsedSkills: LocalSkill[] = [];
    for (const candidate of candidates) {
      const file = candidate.uri;
      try {
        if (seenPaths.has(file.fsPath)) {
          continue;
        }
        seenPaths.add(file.fsPath);

        const relativePath =
          candidate.displayPath ||
          getWorkspaceRelativeOrAbsolutePath(workspaceUri, file);
        const isBuiltInResource =
          isBuiltInResourcePath(relativePath) ||
          isBuiltInResourcePath(file.fsPath);
        if (isBuiltInResource && !includeBuiltInResources) {
          continue;
        }

        const kind = detectResourceKindFromPath(
          candidate.detectionPath || relativePath,
        );
        if (!kind) {
          continue;
        }

        // インストール済みスキル（.github/skills 配下）を除外するか
        if (
          kind === "skill" &&
          !includeInstalled &&
          skillsDir &&
          isSameOrChildWorkspacePath(relativePath, skillsDir)
        ) {
          continue;
        }

        const skill = await parseLocalSkillFile(
          file,
          workspaceUri,
          candidate.detectionPath,
          relativePath,
        );
        if (skill) {
          parsedSkills.push(skill);
        }
      } catch (error) {
        logger.warn(`Failed to parse ${file.fsPath}:`, error);
      }
    }
    return parsedSkills;
  };

  const configuredSkills = await parseCandidates(configuredCandidates);
  skills.push(...configuredSkills);

  if (shouldUseWorkspaceFallback(workspaceFallback, configuredSkills)) {
    const fallbackCandidates = await findWorkspaceFallbackCandidates(
      workspaceUri,
      includeNonSkillResources,
    );
    skills.push(...(await parseCandidates(fallbackCandidates)));
  }

  skills.push(
    ...(await parseCandidates(builtInNodeModuleFiles.map((uri) => ({ uri })))),
  );

  // AGENTS.md の登録状態をチェック
  await checkRegistrationStatus(skills, workspaceUri);

  return skills;
}

/**
 * SKILL.md ファイルを解析してスキル情報を取得
 */
async function parseLocalSkillFile(
  fileUri: vscode.Uri,
  workspaceUri: vscode.Uri,
  detectionPathOverride?: string,
  displayPathOverride?: string,
): Promise<LocalSkill | null> {
  const content = await vscode.workspace.fs.readFile(fileUri);
  const text = Buffer.from(content).toString("utf8");
  const normalizedText = text.replace(/\r\n/g, "\n");

  // frontmatter を解析
  const frontmatterMatch = normalizedText.match(/^---\n([\s\S]*?)\n---/);
  const relativeFilePath =
    displayPathOverride ||
    getWorkspaceRelativeOrAbsolutePath(workspaceUri, fileUri);
  const detectionPath = detectionPathOverride || relativeFilePath;
  const kind = detectResourceKindFromPath(detectionPath);
  if (!kind) {
    return null;
  }
  const installMeta = await readResourceInstallMetadata(fileUri, kind);

  let name = "";
  let description = "";
  let description_ja = "";
  let categories: string[] = [];

  if (frontmatterMatch) {
    const frontmatter = parseTopLevelFrontmatter(frontmatterMatch[1]);
    name = frontmatter.get("name")?.trim() || "";
    description = frontmatter.get("description")?.trim() || "";
    description_ja = frontmatter.get("description_ja")?.trim() || "";
    categories = parseInlineYamlArray(frontmatter.get("categories") || "[]");
  }

  // 名前がない場合は # ヘッダーから取得
  if (!name) {
    const headerMatch = normalizedText.match(/^#\s+(.+)$/m);
    if (headerMatch) {
      name = headerMatch[1].trim();
    }
  }

  // まだ名前がない場合はディレクトリ名を使用
  if (!name) {
    name = getFallbackResourceName(detectionPath.replace(/\\/g, "/"), kind);
  }
  name = installMeta?.name || name;
  description = installMeta?.description || description;
  description_ja = installMeta?.description_ja || description_ja;
  categories = installMeta?.categories?.length
    ? installMeta.categories
    : categories;

  // 相対パスを計算
  const relativePath = relativeFilePath;
  const skillDir =
    kind === "skill"
      ? relativePath.replace(/[/\\]SKILL\.md$/, "")
      : relativePath;
  const isBuiltIn =
    isBuiltInResourcePath(relativePath) ||
    isBuiltInResourcePath(fileUri.fsPath);

  return {
    kind,
    name,
    description,
    description_ja,
    categories:
      categories.length > 0 ? categories : getDefaultResourceCategories(kind),
    source: isBuiltIn
      ? getBuiltInResourceSourceLabel(fileUri.fsPath)
      : installMeta?.source || "local",
    path: skillDir,
    remotePath: installMeta?.remotePath,
    pluginRoot: installMeta?.pluginRoot,
    pluginManifestPath: installMeta?.pluginManifestPath,
    pluginManifestKind: installMeta?.pluginManifestKind,
    isLocal: true,
    fullPath: fileUri.fsPath,
    relativePath: skillDir,
    isRegistered: false,
    isBuiltIn,
  };
}

/**
 * AGENTS.md などの instruction file を読み取り、登録状態をチェック
 * ※ resource-ninja マーカー内のみをチェック（手動記載との重複を避けるため）
 */
async function checkRegistrationStatus(
  skills: LocalSkill[],
  workspaceUri: vscode.Uri,
): Promise<void> {
  const config = vscode.workspace.getConfiguration("resourceNinja");
  const instructionPath = getConfiguredInstructionFilePath(config);
  if (instructionPath === DISABLED_INSTRUCTION_FILE) {
    return;
  }

  const instructionUri = resolveInstructionFileUri(workspaceUri, config);
  if (!instructionUri) {
    return;
  }

  // マーカー
  const MARKER_START = "<!-- agent-ninja-START -->";
  const MARKER_END = "<!-- agent-ninja-END -->";
  const LEGACY_RESOURCE_MARKER_START = "<!-- resource-ninja-START -->";
  const LEGACY_RESOURCE_MARKER_END = "<!-- resource-ninja-END -->";
  const LEGACY_MARKER_START = "<!-- skill-ninja-START -->";
  const LEGACY_MARKER_END = "<!-- skill-ninja-END -->";

  try {
    const content = await vscode.workspace.fs.readFile(instructionUri);
    const text = Buffer.from(content).toString("utf8");

    // マーカー内の部分のみを抽出
    let startIndex = text.indexOf(MARKER_START);
    let endIndex = text.indexOf(MARKER_END);
    let markerEnd = MARKER_END;

    if (startIndex === -1 || endIndex === -1) {
      startIndex = text.indexOf(LEGACY_RESOURCE_MARKER_START);
      endIndex = text.indexOf(LEGACY_RESOURCE_MARKER_END);
      markerEnd = LEGACY_RESOURCE_MARKER_END;
    }

    if (startIndex === -1 || endIndex === -1) {
      startIndex = text.indexOf(LEGACY_MARKER_START);
      endIndex = text.indexOf(LEGACY_MARKER_END);
      markerEnd = LEGACY_MARKER_END;
    }

    // マーカーがない場合は未登録として扱う
    if (startIndex === -1 || endIndex === -1) {
      return;
    }

    const markerContent = text.substring(
      startIndex,
      endIndex + markerEnd.length,
    );

    // リソース参照を検出（マーカー内のみ）
    for (const skill of skills) {
      const patterns = [
        skill.relativePath,
        `./${skill.relativePath}`,
        skill.path,
        `./${skill.path}`,
        skill.name,
      ];

      for (const pattern of patterns) {
        if (markerContent.includes(pattern)) {
          skill.isRegistered = true;
          skill.registrationFile = instructionUri.fsPath;
          break;
        }
      }
    }
  } catch {
    // instruction file が存在しない場合は無視
  }
}

/**
 * AGENTS.md からスキル参照を抽出
 */
export async function parseInstructionFile(
  workspaceUri: vscode.Uri,
): Promise<SkillReference[]> {
  const config = vscode.workspace.getConfiguration("resourceNinja");
  const instructionPath = getConfiguredInstructionFilePath(config);
  if (instructionPath === DISABLED_INSTRUCTION_FILE) {
    return [];
  }

  const instructionUri = resolveInstructionFileUri(workspaceUri, config);
  if (!instructionUri) {
    return [];
  }

  try {
    const content = await vscode.workspace.fs.readFile(instructionUri);
    const text = Buffer.from(content).toString("utf8");
    const lines = text.split("\n");
    const references: SkillReference[] = [];

    // Skills セクションを探す
    let inSkillsSection = false;
    const skillsSectionPattern = /^##\s*(Skills|Installed Skills|スキル)/i;
    const nextSectionPattern = /^##\s/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (skillsSectionPattern.test(line)) {
        inSkillsSection = true;
        continue;
      }

      if (
        inSkillsSection &&
        nextSectionPattern.test(line) &&
        !skillsSectionPattern.test(line)
      ) {
        inSkillsSection = false;
        continue;
      }

      if (inSkillsSection) {
        // - [スキル名](パス) または - スキル名: パス 形式を検出
        const linkMatch = line.match(/^-\s*\[([^\]]+)\]\(([^)]+)\)/);
        const colonMatch = line.match(/^-\s*([^:]+):\s*(.+)/);
        const simpleMatch = line.match(/^-\s*`?([^`\n]+)`?\s*$/);

        if (linkMatch) {
          references.push({
            name: linkMatch[1].trim(),
            path: linkMatch[2].trim(),
            line: i + 1,
            isLocal: !linkMatch[2].startsWith("http"),
          });
        } else if (colonMatch) {
          references.push({
            name: colonMatch[1].trim(),
            path: colonMatch[2].trim(),
            line: i + 1,
            isLocal: !colonMatch[2].startsWith("http"),
          });
        } else if (simpleMatch && simpleMatch[1].includes("/")) {
          references.push({
            name: simpleMatch[1].split("/").pop() || simpleMatch[1],
            path: simpleMatch[1].trim(),
            line: i + 1,
            isLocal: true,
          });
        }
      }
    }

    return references;
  } catch {
    return [];
  }
}

/**
 * ローカルスキルを AGENTS.md に登録
 * ※ updateInstructionFile を呼び出してマーカー内で統一管理
 */
export async function registerLocalSkill(
  _skill: LocalSkill,
  workspaceUri: vscode.Uri,
  context: vscode.ExtensionContext,
): Promise<boolean> {
  try {
    // instructionManager の updateInstructionFile を使用
    // これにより、全てのスキル（インストール済み＋ローカル）がマーカー内で管理される
    await updateInstructionFile(workspaceUri, context);
    return true;
  } catch (error) {
    logger.error("Failed to register local skill:", error);
    return false;
  }
}

/**
 * ローカルスキルを AGENTS.md から登録解除
 * ※ includeLocalResources を一時的に false にして updateInstructionFile を呼ぶか、
 *   または手動で除外リストを管理する必要がある
 *   現在は updateInstructionFile を再呼び出しして同期
 */
export async function unregisterLocalSkill(
  _skill: LocalSkill,
  workspaceUri: vscode.Uri,
  context: vscode.ExtensionContext,
): Promise<boolean> {
  try {
    // 注: 現在の実装では、ローカルスキルは自動的にスキャンされるため、
    // 「登録解除」は実質的に意味がない（次回 updateInstructionFile で再登録される）
    // 本当に除外するには、除外リストを設定に持つ必要がある
    //
    // 暫定: includeLocalResources が false の場合のみ解除が有効
    const config = vscode.workspace.getConfiguration("resourceNinja");
    if (!getConfiguredIncludeLocalResources(config)) {
      await updateInstructionFile(workspaceUri, context);
    }
    return true;
  } catch (error) {
    logger.error("Failed to unregister local skill:", error);
    return false;
  }
}

/**
 * 正規表現用エスケープ（未使用だが将来用に保持）
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
