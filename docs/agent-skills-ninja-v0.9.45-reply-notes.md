# Agent Skills Ninja v0.9.45 の伝言への返信メモ

## 対象

Agent Skills Ninja v0.9.45 のリリース時にいただいた 6 件の指摘への回答です。指摘は Agent Resources Ninja v0.2.52 より前のコードを読んだものとみられ、6 件のうち 5 件は v0.2.52 で修正済みでした。残っていた 1 件と、その調査中に見つかった別の不整合をこの版で直しています。

`v0.9.45` の `src/shared-manifest.ts` と `src/shared-sources-manifest-store.ts` は tag 指定で取得して照合しました。

## すでに修正済みだったもの（v0.2.52）

| 指摘                                                      | 現行コード                                                                                                                          |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `publishLockFile` の EEXIST が retry に戻らない           | `src/sharedStoreLock.ts` の `isAlreadyExistsError` を `fs.link` と fallback の `wx` の両方で使用。取得失敗として `false` を返します |
| 日本語 UI で認証エラーが認証ヘルプへ届かない              | `src/githubResponse.ts` の `isGitHubAuthFailureMessage` に集約し、`src/extension.ts` から呼び出し                                   |
| ステータスコードの裸の部分一致                            | `src/githubResponse.ts` の `containsHttpStatus` が境界付きで判定。`src/skillInstaller.ts` の 404 判定はこれ経由                     |
| scanner の走査抑止                                        | 後述                                                                                                                                |
| `SHARED_STORE_LOCK_RECLAIM_SUFFIX` / 失敗分類 / test seam | ご指摘のとおり当方が先行しています                                                                                                  |

検証も挙動側で行っています。

- `scripts/test-shared-store-lock.js`: `fs/promises` を差し替えて `fs.link` を EPERM で落とし、fallback の `wx` を EEXIST にした上で、`withSharedStoreLock` が `SHARED_STORE_LOCK_UNAVAILABLE_MESSAGE` で reject し、投げられた error に `code` が付いていないことを確認しています。
- `scripts/test-auth-failure-surface.js`: `src/i18n.ts` を `vscode.env.language` の stub 付きで読み込み、**出荷中の日本語・英語文字列そのもの**を分類にかけています。テスト側に文言を書き写していません。

## `resolveSourceScanner` に相当するもの

こちらに `resolveSourceScanner` という関数はありませんが、同じ問題は `Source.foreignScanner` フィールドと `hasForeignScanner()`（`src/indexUpdater.ts`）で扱っています。

- 共有マニフェストから読むとき、自分が実装していない scanner 名は `scanner` からは外し、`foreignScanner` に移します（`src/sharedSourcesManifestStore.ts`）。書き戻しでは元の `scanner` 値をそのまま復元します。
- `hasForeignScanner(source)` が true の source は**走査そのものを行いません**。既存の skills / bundles を残し、`lastIndexedAt` / `lastIndexedBy` も進めません。
- 適用箇所は走査へ到達し得る全経路です: `updateIndexFromSources`（一括）、`updateIndexFromSingleSource`（単一）、`addSource`（既登録判定を経て走査へ入る経路）。

「未宣言」と「宣言済みだが自分は未実装」を分けるという指摘の趣旨は、`scanner` が `undefined`（repo 名推定へ落ちる）と `foreignScanner` が非 undefined（走査しない）という 2 つのフィールドで表現しています。

## 認証マーカーに `forbidden` / `unauthorized` を入れていない理由

`GITHUB_AUTH_MESSAGE_MARKERS` は次の 4 つです。

```ts
const GITHUB_AUTH_MESSAGE_MARKERS = [
  "rate limit",
  "authentication",
  "github api の制限に達しました",
  "github トークンで認証",
];
```

`forbidden` と `unauthorized` は意図的に入れていません。こちらには `Local write forbidden` のようにローカル書き込み失敗を表す文言があり、これを認証ヘルプへ流すと誤誘導になるためです。`scripts/test-auth-failure-surface.js` がこの否定ケースを固定しています。そちら側で同じ語を使っていないのであれば、そちらの広いマーカー集合のままで問題ないと思います。

## この版で直したもの

### 1. `?ref=` の未エスケープ（ご指摘の残り 1 件）

`src/skillInstaller.ts` と `src/indexUpdater.ts` は `encodeURIComponent(branch)` 済みでしたが、`src/githubFetch.ts` の `buildAuthenticatedContentUrl` が素通しでした。

ただし単純な `encodeURIComponent` は**二重エンコードになります**。この関数の入力は `new URL(rawUrl).pathname` を分割した値で、raw URL 側は `encodeGitRefForPath`（segment ごとに `encodeURIComponent`）を通っているため、既に percent-encoded です。`release%231` をさらに encode すると `release%25231` になり、存在しない branch を要求します。

そこで query 値だけを正規化する形にしました。

```ts
function encodeRefForQuery(pathSegment: string): string {
  let decoded = pathSegment;
  try {
    decoded = decodeURIComponent(pathSegment);
  } catch {
    // A malformed escape is encoded as written rather than dropped.
  }
  return encodeURIComponent(decoded);
}
```

これで、正しく escape された raw URL は byte 一致で round-trip し、未 escape のまま届いた raw URL（例: host 文字列置換で作られたもの）の `&` が API の query にパラメータを足すことはなくなります。

既知の限界として、この関数は branch を `segments[2]` から復元するため `feature/x` を `feature` と誤解釈します。これは別件として残し、branch を知っている呼び出し元は `options.authenticatedUrl` を渡す運用です。

### 2. web URL 側の branch 未エスケープ

`src/skillIndex.ts` の `buildGitHubResourceUrl` だけが `encodeGitRefForPath` を通っていませんでした（`buildGitHubRawUrl` などは適用済み）。3 箇所の補間すべてを `encodeGitRefForPath` 経由にしています。

### 3. 共有 sources マニフェストの上限（そちらとの非対称）

`SHARED_SOURCES_MANIFEST_MAX_BYTES` が当方 1 MB、そちら 2 MB でした。entry cap は双方 500 で一致しています。**読み手の方が厳しいと、相手が書いた正当なファイルを読めず、しかもこちらは読めないファイルへ書き戻さない設計なので、共有が恒久的に止まります。** 2 MB に揃えました。

あわせて、こちらの writer 側に集約上限の検査がありませんでした。`writeSharedSourcesManifest` は disk 上の他 writer のエントリ（最大 500 件）と自分のエントリを merge するため、**自分の reader が拒否するファイルを書き得る**状態でした。merge 後・temp 書き込み前に検査し、超過なら既存の `{ status: "rejected", reason }` を返して書きません。

検査対象と書き込み対象が食い違わないよう、`JSON.stringify(..., null, 2)` は 1 回だけ実行し、同じ payload 変数を検査して書いています。compact JSON を測って pretty JSON を書くと上限をすり抜けます。

そちらの `writeSharedSourcesManifestUnderLease` も、per-entry の `sanitizeSourceEntry` は通していますが、`SHARED_SOURCES_MANIFEST_MAX_ENTRIES` と `SHARED_SOURCES_MANIFEST_MAX_BYTES` は write 側で見ていないように読めました。`keptFromCurrent` を足す経路があるので、同じ状況が起こり得ると思います。

同じ原因を共有ディレクトリの他のファイルにも横展開しました。`index.json` は件数上限を読み書き両方で見ていた一方、32 MB のサイズ上限は読み取り側だけでした。`rate-limit-resume.json` も 64 KB の上限が読み取り側だけで、しかも読み取り側は超過を黙って無視するため、延期した source が痕跡なく再開されなくなります。いずれも書き込み前に payload を 1 度だけ直列化し、読み取りと同じ上限で検査する形に揃えました。**読み取り側にだけ上限がある共有ファイルは、その上限がそのまま自分の書き込みの穴になります。**

### 4. 契約テストの pin

`scripts/test-shared-store-contract.js` に次を追加しました。

- sources マニフェストの byte cap（2 MB）と entry cap（500）
- scanner の書式 `/^[A-Za-z0-9._-]{1,64}$/`（そちらの `SHARED_SOURCE_SCANNER_PATTERN` と一致することを確認済み）

`FOREIGN_SCANNER_PATTERN` は、ソースを regex で見るのではなく実値を assert できるよう export しました。出所コメントは `src/sharedStoreLock.ts` / `src/gitHubRefSafety.ts` / 契約テストのいずれも v0.9.45 に更新しています。

## 確認していないこと

そちらのコードで確認したのは v0.9.45 の `src/shared-manifest.ts` と `src/shared-sources-manifest-store.ts` だけです。`shared-store-lock.ts` の v0.9.45 時点の実装、テスト、通知 UI は読んでいないため、上の 3. の指摘は「該当するなら」という条件付きです。
