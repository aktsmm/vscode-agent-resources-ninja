#!/usr/bin/env node

const assert = require("assert");

function unquoteYamlValue(value) {
  return value.trim().replace(/^["']|["']$/g, "");
}

function stripYamlInlineComment(value) {
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

function parseInlineYamlArray(value) {
  const match = stripYamlInlineComment(value).match(/^\[(.*)\]$/);
  if (!match) {
    return [];
  }

  return match[1]
    .split(",")
    .map((item) => unquoteYamlValue(item))
    .filter(Boolean);
}

function getBlockScalarStyle(value) {
  const match = value.match(
    /^([>|])(?:([1-9])([+-])?|([+-])([1-9])?)?(?:\s+#.*)?$/,
  );
  return match ? match[1] : null;
}

function parseTopLevelFrontmatter(frontmatter) {
  const values = new Map();
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
      const blockLines = [];
      let blockIndent = null;

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

function parseSkillFrontmatter(content, filePath) {
  const normalizedContent = content.replace(/\r\n/g, "\n");
  const frontmatterMatch = normalizedContent.match(/^---\n([\s\S]*?)\n---/);

  let name = "";
  let description = "";
  let description_ja = "";
  let categories = [];
  let standalone;
  let requires;
  let bundle;
  let license;
  let author;
  let version;

  if (frontmatterMatch) {
    const frontmatter = parseTopLevelFrontmatter(frontmatterMatch[1]);
    const metadataMatch = frontmatterMatch[1].match(
      /metadata:[\s\S]*?author:\s*["']?([^"'\n]+)["']?/m,
    );
    name = frontmatter.get("name") || "";
    description = frontmatter.get("description") || "";
    description_ja = frontmatter.get("description_ja") || "";
    categories = parseInlineYamlArray(frontmatter.get("categories") || "[]");
    standalone =
      frontmatter.get("standalone") === "true"
        ? true
        : frontmatter.get("standalone") === "false"
          ? false
          : undefined;
    requires = parseInlineYamlArray(frontmatter.get("requires") || "[]");
    bundle = frontmatter.get("bundle") || undefined;
    license = frontmatter.get("license") || undefined;
    author = frontmatter.get("author") || metadataMatch?.[1]?.trim();
    version = frontmatter.get("version") || undefined;
  }

  if (!name) {
    const pathParts = filePath.split("/");
    const folderName = pathParts[pathParts.length - 2] || pathParts[0];
    if (folderName && folderName.toLowerCase() !== "skill.md") {
      name = folderName;
    }
  }

  return {
    name,
    description,
    description_ja,
    categories,
    standalone,
    requires: requires?.length ? requires : undefined,
    bundle,
    license,
    author,
    version,
  };
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("folded block scalars with chomping comments", () => {
  const skill = parseSkillFrontmatter(
    `---
name: folded-skill
description: >- # folded summary
  First line
  second line
categories: [official]
---
`,
    "skills/folded-skill/SKILL.md",
  );

  assert.strictEqual(skill.description, "First line second line");
  assert.deepStrictEqual(skill.categories, ["official"]);
});

test("literal block scalars with indentation indicators", () => {
  const skill = parseSkillFrontmatter(
    `---
name: literal-skill
description: |2-
    line one
    line two
description_ja: >2-
    日本語 一行目
    二行目
---
`,
    "skills/literal-skill/SKILL.md",
  );

  assert.strictEqual(skill.description, "line one\nline two");
  assert.strictEqual(skill.description_ja, "日本語 一行目 二行目");
});

test("windows newlines still parse block scalars", () => {
  const skill = parseSkillFrontmatter(
    "---\r\nname: crlf-skill\r\ndescription: >-\r\n  line one\r\n  line two\r\n---\r\n",
    "skills/crlf-skill/SKILL.md",
  );

  assert.strictEqual(skill.name, "crlf-skill");
  assert.strictEqual(skill.description, "line one line two");
});

test("metadata fields are preserved for preset index generation", () => {
  const skill = parseSkillFrontmatter(
    `---
name: metadata-skill
description: Example description
standalone: false
requires: [core-skill, helper-skill]
bundle: starter-kit
license: MIT
version: 1.2.3
metadata:
  author: Example Author
---
`,
    "skills/metadata-skill/SKILL.md",
  );

  assert.strictEqual(skill.standalone, false);
  assert.deepStrictEqual(skill.requires, ["core-skill", "helper-skill"]);
  assert.strictEqual(skill.bundle, "starter-kit");
  assert.strictEqual(skill.license, "MIT");
  assert.strictEqual(skill.author, "Example Author");
  assert.strictEqual(skill.version, "1.2.3");
});

test("inline comments do not leak into scalar or array values", () => {
  const skill = parseSkillFrontmatter(
    `---
name: comment-safe-skill # visible label
description: Example description # should not be included
categories: [official, azure] # visible tags
standalone: false # runtime dependency
requires: [core-skill] # one dependency
license: "MIT # literal" # parser should keep quoted hash
---
`,
    "skills/comment-safe-skill/SKILL.md",
  );

  assert.strictEqual(skill.description, "Example description");
  assert.deepStrictEqual(skill.categories, ["official", "azure"]);
  assert.strictEqual(skill.standalone, false);
  assert.deepStrictEqual(skill.requires, ["core-skill"]);
  assert.strictEqual(skill.license, "MIT # literal");
});

test("path fallback keeps metadata when frontmatter omits name", () => {
  const skill = parseSkillFrontmatter(
    `---
description: Description without explicit name
categories: [official]
standalone: false
requires: [core-skill]
bundle: starter-kit
metadata:
  author: Example Author
---
`,
    "skills/fallback-name/SKILL.md",
  );

  assert.strictEqual(skill.name, "fallback-name");
  assert.strictEqual(skill.description, "Description without explicit name");
  assert.deepStrictEqual(skill.categories, ["official"]);
  assert.strictEqual(skill.standalone, false);
  assert.deepStrictEqual(skill.requires, ["core-skill"]);
  assert.strictEqual(skill.bundle, "starter-kit");
  assert.strictEqual(skill.author, "Example Author");
});

test("quoted hash inside inline arrays stays intact", () => {
  const skill = parseSkillFrontmatter(
    `---
name: quoted-array-hash
requires: ["core # keep", helper]
---
`,
    "skills/quoted-array-hash/SKILL.md",
  );

  assert.deepStrictEqual(skill.requires, ["core # keep", "helper"]);
});

console.log("RESULT=PASS");
