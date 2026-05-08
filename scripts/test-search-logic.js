// 検索ロジックのテストスクリプト
// 実際のAPIは呼ばず、クエリ生成ロジックのみテスト

function testSearchLogic(query) {
  // クエリをキーワードに分割（3文字以上のみ、ノイズ削減）
  const rawKeywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((k) => k.length > 0);
  const keywords = rawKeywords.filter(
    (k) => k.length >= 3 || /^[a-z0-9]+$/i.test(k),
  );

  // user: または repo: プレフィックスを抽出
  const userMatch = query.match(/\buser:([^\s]+)/i);
  const repoMatch = query.match(/\brepo:([^\s]+)/i);
  let userPrefix = userMatch ? `user:${userMatch[1]}` : "";
  const repoPrefix = repoMatch ? `repo:${repoMatch[1]}` : "";

  // プレフィックスを除いたキーワード
  let keywordsWithoutPrefix = keywords.filter(
    (k) => !k.startsWith("user:") && !k.startsWith("repo:"),
  );

  // 単一キーワードがユーザー名っぽいかどうかを判定する関数
  const looksLikeUsername = (keyword) => {
    return (
      /^[a-z][a-z0-9-]*$/i.test(keyword) &&
      keyword.length >= 3 &&
      keyword.length <= 39 &&
      !keyword.includes("--")
    );
  };

  const buildResourceQueries = (baseQuery) => [
    `filename:SKILL.md ${baseQuery}`,
    `extension:md path:agents ${baseQuery}`,
    `extension:md path:instructions ${baseQuery}`,
    `extension:md path:prompts ${baseQuery}`,
    `filename:README.md path:hooks ${baseQuery}`,
    `filename:mcp.json ${baseQuery}`,
    `extension:json path:mcp ${baseQuery}`,
    `filename:plugin.json ${baseQuery}`,
    `filename:marketplace.json ${baseQuery}`,
    `filename:gemini-extension.json ${baseQuery}`,
    `filename:apm.yml ${baseQuery}`,
    `extension:mdc path:rules ${baseQuery}`,
  ];

  // 検索クエリを生成する関数
  const buildSearchQueries = (kws) => {
    const queries = [];

    // user: または repo: が明示的に指定されている場合
    if (userPrefix || repoPrefix) {
      const prefix = userPrefix || repoPrefix;
      if (keywordsWithoutPrefix.length > 0) {
        // プレフィックス + キーワード
        const orQuery = keywordsWithoutPrefix.join(" OR ");
        queries.push(...buildResourceQueries(`${prefix} ${orQuery}`));
        queries.push(...buildResourceQueries(`${prefix} ${orQuery} in:path`));
      }
      // プレフィックスのみ（全リソース取得）
      queries.push(...buildResourceQueries(prefix));
    } else if (query.includes("/")) {
      // owner/repo 形式
      queries.push(...buildResourceQueries(`repo:${query}`));
    } else if (kws.length > 1) {
      const orQuery = kws.join(" OR ");
      queries.push(...buildResourceQueries(orQuery));
      queries.push(...buildResourceQueries(`${orQuery} in:path`));
    } else if (kws.length === 1) {
      queries.push(...buildResourceQueries(kws[0]));
      queries.push(...buildResourceQueries(`${kws[0]} in:path`));
    }
    return [...new Set(queries)];
  };

  // 最初のキーワードがユーザー名っぽい & 明示的プレフィックスなし → 並列検索
  const firstKeyword = keywordsWithoutPrefix[0];
  const shouldParallelSearch =
    !userPrefix &&
    !repoPrefix &&
    !query.includes("/") &&
    keywordsWithoutPrefix.length >= 1 &&
    looksLikeUsername(firstKeyword);

  let parallelQueries = null;
  if (shouldParallelSearch) {
    const normalQueries = buildSearchQueries(keywords);
    const remainingKeywords = keywordsWithoutPrefix.slice(1);
    let userQueries;
    if (remainingKeywords.length > 0) {
      const orQuery = remainingKeywords.join(" OR ");
      userQueries = [
        ...buildResourceQueries(`user:${firstKeyword} ${orQuery}`),
        ...buildResourceQueries(`user:${firstKeyword} ${orQuery} in:path`),
        ...buildResourceQueries(`user:${firstKeyword}`),
      ];
    } else {
      userQueries = buildResourceQueries(`user:${firstKeyword}`);
    }
    parallelQueries = { normal: normalQueries, user: userQueries };
  }

  return {
    input: query,
    keywords,
    keywordsWithoutPrefix,
    userPrefix,
    repoPrefix,
    shouldParallelSearch,
    queries: shouldParallelSearch ? null : buildSearchQueries(keywords),
    parallelQueries,
  };
}

// テストケース
const testCases = [
  // 単一キーワード
  "azure",
  "pdf",
  "ai",
  "k8s",
  "123abc",

  // 複数キーワード
  "azure devops",
  "pdf viewer",
  "aktsmm agentic",
  "agentic aktsmm",

  // 明示的なプレフィックス
  "user:anthropics",
  "user:anthropics mcp",
  "repo:owner/repo",

  // owner/repo形式
  "microsoft/vscode",

  // エッジケース
  "azure-devops",
  "my--skill",
  "a",
  "ab",
];

console.log("=== 検索ロジック テスト結果 ===\n");

for (const testCase of testCases) {
  const result = testSearchLogic(testCase);
  console.log(`【入力】"${result.input}"`);
  console.log(`  keywords: [${result.keywords.join(", ")}]`);
  console.log(
    `  keywordsWithoutPrefix: [${result.keywordsWithoutPrefix.join(", ")}]`,
  );
  console.log(`  userPrefix: "${result.userPrefix}"`);
  console.log(`  repoPrefix: "${result.repoPrefix}"`);
  console.log(`  shouldParallelSearch: ${result.shouldParallelSearch}`);
  if (result.parallelQueries) {
    console.log(`  並列実行:`);
    console.log(`    normal: ${JSON.stringify(result.parallelQueries.normal)}`);
    console.log(`    user: ${JSON.stringify(result.parallelQueries.user)}`);
  } else {
    console.log(`  queries: ${JSON.stringify(result.queries)}`);
  }
  console.log("");
}
