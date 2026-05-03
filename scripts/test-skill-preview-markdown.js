/**
 * markdownToHtml 関数の回帰テスト（skillPreview.ts 由来）
 * 実行: node scripts/test-skill-preview-markdown.js
 */

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeHref(href) {
  const trimmed = href.trim();
  if (!trimmed) return "#";
  if (trimmed.startsWith("#")) return trimmed;
  if (trimmed.startsWith("//")) return "#";

  try {
    const url = new URL(trimmed);
    if (
      url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "mailto:"
    ) {
      return url.toString();
    }
  } catch {
    if (
      (trimmed.startsWith("/") && !trimmed.startsWith("//")) ||
      trimmed.startsWith("./") ||
      trimmed.startsWith("../")
    ) {
      return trimmed;
    }
  }
  return "#";
}

function normalizeListMarkup(html) {
  const lines = html.split("\n");
  const normalized = [];
  let listItems = [];
  let currentListType;

  const flushList = () => {
    if (listItems.length === 0) {
      return;
    }
    const listTag = currentListType || "ul";
    normalized.push(`<${listTag}>${listItems.join("")}</${listTag}>`);
    listItems = [];
    currentListType = undefined;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^<li(?:\s+data-list="(ul|ol)")?>.*<\/li>$/);
    if (match) {
      const listType = match[1] || "ul";

      if (currentListType && currentListType !== listType) {
        flushList();
      }

      currentListType = listType;
      listItems.push(trimmed.replace(/\s+data-list="(?:ul|ol)"/, ""));
      continue;
    }
    flushList();
    normalized.push(line);
  }

  flushList();
  return normalized.join("\n");
}

function formatHtmlBlocks(html) {
  const blockPattern =
    /(<pre>[\s\S]*?<\/pre>|<ul>[\s\S]*?<\/ul>|<ol>[\s\S]*?<\/ol>|<h[1-3]>[\s\S]*?<\/h[1-3]>)/g;
  const segments = html
    .split(blockPattern)
    .filter((segment) => segment.length > 0);

  return segments
    .map((segment) => {
      const trimmed = segment.trim();
      if (!trimmed) {
        return "";
      }

      if (/^<(?:pre|ul|ol|h[1-3])/.test(trimmed)) {
        return trimmed;
      }

      return trimmed
        .split(/\n{2,}/)
        .filter((paragraph) => paragraph.trim().length > 0)
        .map((paragraph) => `<p>${paragraph.replace(/\n/g, "<br>")}</p>`)
        .join("\n");
    })
    .filter((segment) => segment.length > 0)
    .join("\n");
}

function markdownToHtml(markdown) {
  const normalized = markdown.replace(/\r\n/g, "\n");

  const placeholders = new Map();
  let placeholderId = 0;
  const makePlaceholder = (html) => {
    const key = `@@SKILL_NINJA_PH_${placeholderId++}@@`;
    placeholders.set(key, html);
    return key;
  };

  let text = normalized.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_match, lang, code) => {
      const safeLang = escapeHtml(lang);
      const safeCode = escapeHtml(code);
      return makePlaceholder(
        `<pre><code class="language-${safeLang}">${safeCode}</code></pre>`,
      );
    },
  );

  text = text.replace(/`([^`]+)`/g, (_match, code) => {
    return makePlaceholder(`<code>${escapeHtml(code)}</code>`);
  });

  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, href) => {
    const safeLabel = escapeHtml(label);
    const safeHref = escapeHtml(sanitizeHref(href));
    return makePlaceholder(
      `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`,
    );
  });

  let html = escapeHtml(text);

  html = html
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>");

  html = html
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  html = html
    .replace(/^- (.+)$/gm, '<li data-list="ul">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li data-list="ol">$2</li>');

  html = normalizeListMarkup(html);

  for (const [key, value] of placeholders.entries()) {
    html = html.replaceAll(key, value);
  }

  return formatHtmlBlocks(html);
}

function assertIncludes(actual, expected, message) {
  if (!actual.includes(expected)) {
    throw new Error(
      `${message}\nExpected to include: ${expected}\nActual: ${actual}`,
    );
  }
}

function runTest(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (error) {
    console.error(`❌ ${name}`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

console.log("=== skillPreview markdownToHtml テスト ===");

runTest("見出しが h1/h2 に変換される", () => {
  const html = markdownToHtml("# Title\n\n## Section");
  assertIncludes(html, "<h1>Title</h1>", "H1 conversion failed");
  assertIncludes(html, "<h2>Section</h2>", "H2 conversion failed");
});

runTest("箇条書きが ul に正規化される", () => {
  const html = markdownToHtml("- A\n- B");
  assertIncludes(
    html,
    "<ul><li>A</li><li>B</li></ul>",
    "List normalization failed",
  );
});

runTest("段落が p と br に変換される", () => {
  const html = markdownToHtml("line1\nline2\n\nline3");
  assertIncludes(
    html,
    "<p>line1<br>line2</p>",
    "Paragraph line break conversion failed",
  );
  assertIncludes(html, "<p>line3</p>", "Second paragraph conversion failed");
});

runTest("javascript: リンクが無効化される", () => {
  const html = markdownToHtml("[x](javascript:alert(1))");
  assertIncludes(html, 'href="#"', "Unsafe href should be sanitized to #");
});

runTest("プロトコル相対URL(//)が無効化される", () => {
  const html = markdownToHtml("[x](//evil.example.com)");
  assertIncludes(
    html,
    'href="#"',
    "Protocol-relative URL should be sanitized to #",
  );
});

runTest("コードフェンスが pre/code に変換される", () => {
  const html = markdownToHtml("```ts\nconst x = 1;\n```");
  assertIncludes(
    html,
    '<pre><code class="language-ts">const x = 1;\n</code></pre>',
    "Code fence conversion failed",
  );
});

if (process.exitCode === 1) {
  console.error("\n❌ markdownToHtml tests failed");
} else {
  console.log("\n✅ All markdownToHtml tests passed");
}
