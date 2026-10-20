// 一括インストールで、同じ場所へ書き込まれるリソースの組を見つける。
// vscode に依存しない純粋関数だけを置く。宛先の決め方は呼び出し側（getResourceTargetUri）が持ち、
// ここでは「宛先が同じか」だけを判定する。名前が違っても、フォルダ名への変換
// （`Code Review` と `code-review` と `code.review` が同じフォルダになる）や、
// 別パスの同名ファイルで、宛先は同じになる。

export interface InstallCollision<T> {
  /** 衝突した宛先（比較用に正規化する前の、最初の項目の値） */
  destination: string;
  /** 同じ宛先になる項目。選択順のまま、2 件以上 */
  items: T[];
}

function normalizeDestination(value: string, caseSensitive: boolean): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/g, "");
  return caseSensitive ? normalized : normalized.toLowerCase();
}

/**
 * 同じ宛先になる項目の組を、最初に現れた順に返す。
 * `getDestination` が undefined を返した項目（宛先を決められないもの）は、衝突の対象にしない。
 * 大文字小文字を区別しないファイルシステム（Windows / macOS）では、`caseSensitive` を false にする。
 */
export function findInstallCollisions<T>(
  items: readonly T[],
  getDestination: (item: T) => string | undefined,
  caseSensitive: boolean,
): InstallCollision<T>[] {
  const groups = new Map<string, InstallCollision<T>>();
  for (const item of items) {
    const destination = getDestination(item);
    if (!destination) {
      continue;
    }
    const key = normalizeDestination(destination, caseSensitive);
    const group = groups.get(key);
    if (group) {
      group.items.push(item);
    } else {
      groups.set(key, { destination, items: [item] });
    }
  }
  return [...groups.values()].filter((group) => group.items.length > 1);
}

/** 衝突した組は、最初の 1 件だけを残す。それ以外の項目と順序はそのまま。 */
export function keepFirstOfEachCollision<T>(
  items: readonly T[],
  collisions: readonly InstallCollision<T>[],
): T[] {
  const dropped = new Set<T>();
  for (const collision of collisions) {
    for (const item of collision.items.slice(1)) {
      dropped.add(item);
    }
  }
  return items.filter((item) => !dropped.has(item));
}
