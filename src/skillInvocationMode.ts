// SKILL.md の呼び出しモード（frontmatter の disable-model-invocation / user-invocable）を扱う。
// vscode にも他の src モジュールにも依存しない純粋関数だけを置く。
// スキャナ・インデックス生成・生成スクリプト・テストが同じ判定規則を読み込めるようにするため。
// 値・判定規則は姉妹拡張 Agent Skills Ninja と共有ストア上で一致させる必要がある。

/**
 * - auto: モデルも `/name` も使える（既定）
 * - explicitOnly: `disable-model-invocation: true`。`/name` での明示呼び出し専用
 * - modelOnly: `user-invocable: false`。スラッシュメニューに出さず、モデルだけが使う
 */
export type SkillInvocation = "auto" | "explicitOnly" | "modelOnly";

export const DISABLE_MODEL_INVOCATION_KEY = "disable-model-invocation";
export const USER_INVOCABLE_KEY = "user-invocable";

const TOP_LEVEL_KEY = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/;

function parseBoolean(rawValue: string): boolean | undefined {
  const value = rawValue
    .replace(/\s+#.*$/, "")
    .trim()
    .replace(/^(["'])(.*)\1$/, "$2")
    .toLowerCase();
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return undefined;
}

/** 両方のキーが立っている場合は、誰も自動では使わない explicitOnly を優先する。 */
export function resolveSkillInvocation(flags: {
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
}): SkillInvocation {
  if (flags.disableModelInvocation === true) {
    return "explicitOnly";
  }
  if (flags.userInvocable === false) {
    return "modelOnly";
  }
  return "auto";
}

/**
 * 既にパース済みの frontmatter 値（引用符・コメント除去済み）から呼び出しモードを決める。
 * リモートスキルのインデックス生成が、ローカル走査と同じ判定規則を使うための入口。
 */
export function resolveSkillInvocationFromValues(values: {
  disableModelInvocation?: string;
  userInvocable?: string;
}): SkillInvocation {
  return resolveSkillInvocation({
    disableModelInvocation: parseBoolean(values.disableModelInvocation ?? ""),
    userInvocable: parseBoolean(values.userInvocable ?? ""),
  });
}

/** `context: fork`（サブエージェントで実行）だけを認識する。実験的機能なので他の値は無視する。 */
export type SkillExecutionContext = "fork";

export function parseSkillExecutionContext(
  value: string | undefined,
): SkillExecutionContext | undefined {
  return value?.trim().toLowerCase() === "fork" ? "fork" : undefined;
}

/** SKILL.md 全文から、トップレベルの frontmatter キーだけを読んで呼び出しモードを決める。 */
export function readSkillInvocationFromText(text: string): SkillInvocation {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") {
    return "auto";
  }
  const closeIndex = lines.findIndex(
    (line, index) => index > 0 && line.trimEnd() === "---",
  );
  if (closeIndex < 0) {
    return "auto";
  }

  const flags: { disableModelInvocation?: boolean; userInvocable?: boolean } =
    {};
  for (let index = 1; index < closeIndex; index += 1) {
    const match = lines[index].match(TOP_LEVEL_KEY);
    if (!match) {
      continue;
    }
    if (match[1] === DISABLE_MODEL_INVOCATION_KEY) {
      flags.disableModelInvocation = parseBoolean(match[2]);
    } else if (match[1] === USER_INVOCABLE_KEY) {
      flags.userInvocable = parseBoolean(match[2]);
    }
  }
  return resolveSkillInvocation(flags);
}

export function normalizeSkillInvocation(value: unknown): SkillInvocation {
  return value === "explicitOnly" || value === "modelOnly" ? value : "auto";
}

export function getInvocationLabelText(
  invocation: unknown,
  isJa: boolean,
): string {
  switch (normalizeSkillInvocation(invocation)) {
    case "explicitOnly":
      return isJa ? "手動専用" : "Manual only";
    case "modelOnly":
      return isJa ? "モデル専用" : "Model only";
    default:
      return isJa ? "自動" : "Auto";
  }
}

export function getInvocationExplanationText(
  invocation: unknown,
  name: string,
  isJa: boolean,
): string {
  switch (normalizeSkillInvocation(invocation)) {
    case "explicitOnly":
      return isJa
        ? `モデルは自動では使いません。/${name} で明示的に呼び出します (disable-model-invocation: true)`
        : `The model does not load it on its own. Invoke it explicitly with /${name} (disable-model-invocation: true)`;
    case "modelOnly":
      return isJa
        ? "スラッシュメニューには出ず、モデルだけが使います (user-invocable: false)"
        : "Hidden from the slash menu; only the model uses it (user-invocable: false)";
    default:
      return isJa
        ? "モデルの自動利用と /name の明示呼び出しの両方（既定）"
        : "Both automatic model use and explicit /name calls (default)";
  }
}

/** 手動専用 / モデル専用を一覧で見分けるための codicon id。通常スキルは fallback を使う。 */
export function getInvocationIconId(
  invocation: unknown,
  fallback: string,
): string {
  switch (normalizeSkillInvocation(invocation)) {
    case "explicitOnly":
      return "play-circle";
    case "modelOnly":
      return "hubot";
    default:
      return fallback;
  }
}
