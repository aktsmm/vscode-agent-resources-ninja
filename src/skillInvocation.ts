import * as vscode from "vscode";

/**
 * SKILL.md の `disable-model-invocation: true` を読む。
 * 手動専用スキルは、モデルが自分で使おうとしないよう既定では一覧に載せない。
 * 正本は常に SKILL.md で、`.skill-meta.json` などの写しは参照しない。
 */
export function parseDisableModelInvocation(text: string): boolean {
  const frontmatter = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .match(/^---\n([\s\S]*?)\n---/)?.[1];
  if (!frontmatter) {
    return false;
  }

  const line = frontmatter.match(/^disable-model-invocation:[ \t]*(.*)$/m);
  if (!line) {
    return false;
  }

  const value = line[1]
    .replace(/\s+#.*$/, "")
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2");
  return value.toLowerCase() === "true";
}

async function readDisableModelInvocation(filePath: string): Promise<boolean> {
  try {
    const bytes = await vscode.workspace.fs.readFile(
      vscode.Uri.file(filePath),
    );
    return parseDisableModelInvocation(Buffer.from(bytes).toString("utf8"));
  } catch {
    // 読めないスキルは一覧から消さず、従来どおり載せる。
    return false;
  }
}

/**
 * 一覧に載せない設定の手動専用スキルは、載せる対象がないため登録済みとして扱う。
 * 載っているかどうかを登録状態の根拠にすると、手書きスキルが未登録のままになる。
 */
export function markExplicitOnlySkillsRegistered(
  skills: readonly { disableModelInvocation?: boolean; isRegistered: boolean }[],
  include: boolean,
): void {
  if (include) {
    return;
  }
  for (const skill of skills) {
    if (skill.disableModelInvocation) {
      skill.isRegistered = true;
    }
  }
}

/**
 * 手動専用スキルを除いた一覧を返す。読み取りは生成のたびに行い、
 * メタデータが古くても出力が追従するようにする。
 */
export async function excludeExplicitOnlySkills<T>(
  items: readonly T[],
  getSkillFilePath: (item: T) => string | undefined,
  include: boolean,
): Promise<T[]> {
  if (include) {
    return [...items];
  }

  const flags = await Promise.all(
    items.map(async (item) => {
      const filePath = getSkillFilePath(item);
      return filePath ? readDisableModelInvocation(filePath) : false;
    }),
  );
  return items.filter((_, index) => !flags[index]);
}
