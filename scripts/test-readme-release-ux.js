#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
);
const skillIndex = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "resources", "skill-index.json"), "utf8"),
);
const nls = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.nls.json"), "utf8"),
);
const nlsJa = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "package.nls.ja.json"), "utf8"),
);
const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
const readmeJa = fs.readFileSync(path.join(repoRoot, "README_ja.md"), "utf8");
const releaseNotes = fs.readFileSync(
  path.join(repoRoot, `release-notes-v${packageJson.version}.md`),
  "utf8",
);

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function allDocsText() {
  return [readme, readmeJa, releaseNotes].join("\n");
}

function getOutputFormatSection(text) {
  const section = text.split(/## .*Output Formats|## .*出力フォーマット/)[1];
  assert.ok(section, "README should include the output format section");
  return section.split(/\n---\n|\n## /)[0];
}

function getLanguageModelToolReferences() {
  return (packageJson.contributes?.languageModelTools || [])
    .map((tool) => tool.toolReferenceName)
    .sort();
}

function assertIncludesAllLmTools(text, docName) {
  for (const toolName of getLanguageModelToolReferences()) {
    assert.match(
      text,
      new RegExp(`#${toolName}(?=\\W|$)`),
      `${docName} should document #${toolName}`,
    );
  }
}

function assertMentionsMcpResourceKind(text, docName) {
  assert.match(
    text,
    /MCP config/,
    `${docName} should mention MCP config resources`,
  );
  assert.match(
    text,
    /skills?[、,].*agents?[、,].*instructions?[、,].*prompts?[、,].*hooks?[、,].*MCP config/s,
    `${docName} should list MCP config with the other resource kinds`,
  );
}

function getSourceTableRows(text) {
  const section = text.split(
    /## .*Included Resource Sources|## .*収録リソースソース/,
  )[1];
  assert.ok(section, "README should include the source section");
  const table = section.split(/\n\nAzure |\n\nAzure は/)[0];
  return table
    .split(/\r?\n/)
    .filter((line) => /^\| \[[^\]]+\]\(https:\/\/github\.com\//.test(line));
}

function getUrlsFromSourceRows(text) {
  return getSourceTableRows(text)
    .map((line) => line.match(/\]\((https:\/\/github\.com\/[^)]+)\)/)?.[1])
    .filter(Boolean)
    .sort();
}

test("README Agent Mode tool count matches package manifest", () => {
  const toolCount = getLanguageModelToolReferences().length;
  assert.match(readme, new RegExp(`\\*\\*${toolCount} Tools\\*\\*`));
  assert.match(readmeJa, new RegExp(`\\*\\*${toolCount} ツール\\*\\*`));
});

test("README documents every Agent Mode tool reference", () => {
  assertIncludesAllLmTools(readme, "README.md");
  assertIncludesAllLmTools(readmeJa, "README_ja.md");
});

test("README documents localizeResource tool", () => {
  assert.match(readme, /#localizeResource/);
  assert.match(readmeJa, /#localizeResource/);
});

test("feature overview includes MCP config resources", () => {
  assertMentionsMcpResourceKind(readme, "README.md");
  assertMentionsMcpResourceKind(readmeJa, "README_ja.md");
});

test("workspace usage includes MCP config grouping and creation", () => {
  assert.match(readme, /Groups resources by kind:.*MCP config resources/);
  assert.match(
    readme,
    /Create new skills.*MCP config resources from the toolbar/,
  );
  assert.match(readmeJa, /リソース種別ごとに分類/);
  assert.match(readmeJa, /MCP config リソースを新規作成/);
});

test("remote layout docs include MCP config resources", () => {
  assert.match(
    readme,
    /Repository-first groups by source.*MCP config resources/,
  );
  assert.match(
    readme,
    /Resource-type-first groups by skills.*MCP config resources/,
  );
  assert.match(readmeJa, /リポジトリ起点ではソース.*MCP config リソース/);
  assert.match(readmeJa, /リソース種別起点では skills.*MCP config リソース/);
});

test("README preview terminology is resource-oriented", () => {
  assert.match(readme, /Resource preview in Webview/);
  assert.match(readmeJa, /リソースプレビュー/);
  assert.doesNotMatch(readme, /Skill preview in Webview/);
  assert.doesNotMatch(readmeJa, /スキルプレビュー/);
});

test("README token guidance follows least privilege", () => {
  const docs = [readme, readmeJa].join("\n");
  assert.doesNotMatch(docs, /scopes=/);
  assert.doesNotMatch(docs, /public_repo/);
  assert.doesNotMatch(docs, /repo,read:org|read:org/);
  assert.doesNotMatch(docs, /Required scopes/i);
  assert.match(readme, /leave scopes unchecked/);
  assert.match(readmeJa, /scope は未選択/);
});

test("README documents release preflight for installability audit and VSCE_PAT", () => {
  assert.match(
    readme,
    /node scripts\/audit-resource-installability\.js --raw-only/,
  );
  assert.match(readme, /npx --yes vsce verify-pat -p "\$env:VSCE_PAT"/);
  assert.match(readme, /stale bundled entries/i);
  assert.match(
    readmeJa,
    /node scripts\/audit-resource-installability\.js --raw-only/,
  );
  assert.match(readmeJa, /npx --yes vsce verify-pat -p "\$env:VSCE_PAT"/);
  assert.match(readmeJa, /期限切れ publisher credential|期限切れ publisher/);
});

test("README MCP config safety copy explains explicit merge choice", () => {
  assert.match(readme, /Workspace MCP Directory/);
  assert.match(readme, /merge compatible servers into `\.vscode\/mcp\.json`/);
  assert.match(readme, /overwrite confirmation/);
  assert.match(
    readme,
    /copy-only review file under the Workspace MCP Directory|copy the file to the Workspace MCP Directory for review/,
  );
  assert.match(readmeJa, /Workspace MCP Directory/);
  assert.match(
    readmeJa,
    /`\.vscode\/mcp\.json` (?:へ明示的にマージ|にマージしたい)/,
  );
  assert.match(readmeJa, /上書きは必ず確認|上書き(?:は|を)?必ず確認/);
  assert.match(readmeJa, /レビュー用にコピーするのみ|確認用にコピー/);
});

test("README documents browse double-click install and reinstall behavior", () => {
  assert.match(
    readme,
    /double-click keeps the same row action as the inline button: uninstalled rows install, already-installed remote rows reinstall/,
  );
  assert.match(
    readme,
    /local-only rows do not present remote install\/reinstall actions/,
  );
  assert.match(
    readmeJa,
    /ダブルクリックの動作は行の inline action に合わせています/,
  );
  assert.match(
    readmeJa,
    /未インストール行は install、インストール済みの remote 行は.*reinstall/,
  );
  assert.match(
    readmeJa,
    /local-only 行には remote install\/reinstall action を出しません/,
  );
});

test("README documents Copilot CLI Global Resource Home resources", () => {
  assert.match(readme, /copilot-instructions\.md/);
  assert.match(readme, /skills\/\*\/SKILL\.md/);
  assert.match(readme, /hooks\/\*\.json/);
  assert.match(readme, /mcp-config\.json/);
  assert.match(readme, /runtime logs, session state/);
  assert.match(readmeJa, /copilot-instructions\.md/);
  assert.match(readmeJa, /skills\/\*\/SKILL\.md/);
  assert.match(readmeJa, /hooks\/\*\.json/);
  assert.match(readmeJa, /mcp-config\.json/);
  assert.match(readmeJa, /runtime logs、session state/);
});

test("README explains nested SKILL contents are not standalone remote resources", () => {
  assert.match(readme, /nested under a directory-based `SKILL\.md` root/);
  assert.match(readme, /do not appear as separate Remote Resources/);
  assert.match(readmeJa, /ディレクトリ型の `SKILL\.md` root 配下/);
  assert.match(readmeJa, /Remote Resources に別リソースとして表示しません/);
});

test("README marketplace identity matches package metadata", () => {
  const displayName = nls.displayName;
  assert.match(
    readme,
    new RegExp(displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.match(
    readmeJa,
    new RegExp(displayName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.match(
    readme,
    new RegExp(`ext install ${packageJson.publisher}\\.${packageJson.name}`),
  );
  assert.match(
    readmeJa,
    new RegExp(`ext install ${packageJson.publisher}\\.${packageJson.name}`),
  );
});

test("README links Japanese edition through GitHub absolute URL", () => {
  assert.match(
    readme,
    /https:\/\/github\.com\/aktsmm\/vscode-agent-resources-ninja\/blob\/master\/README_ja\.md/,
  );
});

test("README introduces the companion Agent Skills Ninja flow", () => {
  const docs = [readme, readmeJa].join("\n");
  assert.match(docs, /Companion Extension/);
  assert.match(docs, /Agent Skills Ninja/);
  assert.match(
    docs,
    /marketplace\.visualstudio\.com\/items\?itemName=yamapan\.agent-skill-ninja/,
  );
  assert.match(docs, /coexistenceMode = auto/);
});

test("README front matter summarizes the ref-first output model", () => {
  assert.match(readme, /Managed output follows a ref-first model by default/);
  assert.match(readme, /Use Ref Output/);
  assert.match(readmeJa, /生成リソース出力は既定で ref-first/);
  assert.match(readmeJa, /Use Ref Output/);
});

test("README_ja avoids stale managed-output wording", () => {
  assert.doesNotMatch(readmeJa, /managed output/);
  assert.match(readmeJa, /生成リソース出力/);
});

test("README docs avoid legacy release-facing claims", () => {
  const docs = allDocsText();
  assert.doesNotMatch(docs, /8 Tools|8 ツール/);
  assert.doesNotMatch(docs, /Skill preview in Webview|スキルプレビュー/);
  assert.doesNotMatch(
    docs,
    /GitHub Token is \*\*required\*\*|GitHub Token が\*\*必須\*\*/,
  );
});

test("README output format table uses professional release copy", () => {
  const outputFormatText = [
    getOutputFormatSection(readme),
    getOutputFormatSection(readmeJa),
  ].join("\n");
  assert.doesNotMatch(outputFormatText, /[✅📦🕰️❌]/u);
  assert.doesNotMatch(outputFormatText, /\bOLD\b/);
  assert.match(outputFormatText, /compatibility scenarios|互換性が必要な場合/);
  assert.match(outputFormatText, /Use Ref Output|Ref 出力/);
});

test("README source tables include every bundled source", () => {
  const expectedUrls = skillIndex.sources.map((source) => source.url).sort();
  assert.deepStrictEqual(getUrlsFromSourceRows(readme), expectedUrls);
  assert.deepStrictEqual(getUrlsFromSourceRows(readmeJa), expectedUrls);
});

test("README source table row count matches index metadata", () => {
  assert.strictEqual(
    getSourceTableRows(readme).length,
    skillIndex.sources.length,
  );
  assert.strictEqual(
    getSourceTableRows(readmeJa).length,
    skillIndex.sources.length,
  );
});

test("README source tables keep qdhenry row inside the table", () => {
  assert.ok(
    getSourceTableRows(readme).some((line) =>
      line.includes("qdhenry/Claude-Command-Suite"),
    ),
  );
  assert.ok(
    getSourceTableRows(readmeJa).some((line) =>
      line.includes("qdhenry/Claude-Command-Suite"),
    ),
  );
  const afterMcpSafety =
    readme.split(
      "MCP files are still copied for review and are not auto-activated.",
    )[1] || "";
  const afterMcpSafetyJa =
    readmeJa.split(
      "MCP ファイルは引き続き確認用にコピーし、自動有効化しません。",
    )[1] || "";
  assert.doesNotMatch(afterMcpSafety, /\| \[qdhenry\/Claude-Command-Suite\]/);
  assert.doesNotMatch(afterMcpSafetyJa, /\| \[qdhenry\/Claude-Command-Suite\]/);
});

test("README distinguishes full plugin install from indexed plugin contents", () => {
  assert.match(readme, /Curated Install Sets/);
  assert.match(readme, /Pick from a Plugin/);
  assert.match(
    readme,
    /Use \*\*Plugin\*\* rows to install a whole plugin package/,
  );
  assert.match(readmeJa, /おすすめまとめインストール/);
  assert.match(readmeJa, /プラグイン中身を選択/);
  assert.match(
    readmeJa,
    /プラグインをまるごとインストールしたい場合は \*\*プラグイン\*\* の行/,
  );
});

test("README source tables use only known source type labels", () => {
  for (const row of getSourceTableRows(readme).concat(
    getSourceTableRows(readmeJa),
  )) {
    const columns = row.split("|").map((column) => column.trim());
    assert.match(columns[2], /^(Official|Curated|Community)$/);
  }
});

test("release-facing source count matches bundled index", () => {
  const sourceCount = String(skillIndex.sources.length);
  assert.match(
    nls["config.versionInfo.markdownDescription"],
    new RegExp(`Sources \\| ${sourceCount}`),
  );
  assert.match(
    nlsJa["config.versionInfo.markdownDescription"],
    new RegExp(`Sources \\| ${sourceCount}`),
  );
});

console.log("RESULT=PASS");
