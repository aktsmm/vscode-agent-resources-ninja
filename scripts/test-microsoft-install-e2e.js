#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");

const INDEX_PATH = path.join(__dirname, "..", "resources", "skill-index.json");
const FETCH_TIMEOUT = 15000;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

function sanitizeSkillName(name) {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[()[\]{}]/g, "")
    .replace(/[^a-z0-9\-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function fetchWithTimeout(url, options = {}, timeout = FETCH_TIMEOUT) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function githubApiFetch(url) {
  const headers = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "ResourceNinja-Microsoft-E2E",
  };
  if (GITHUB_TOKEN) {
    headers.Authorization = `token ${GITHUB_TOKEN}`;
  }

  let response = await fetchWithTimeout(url, { headers });
  if (response.status === 403 && headers.Authorization) {
    const bodyText = await response.clone().text();
    if (
      bodyText.includes("forbids access via a personal access tokens (classic)")
    ) {
      response = await fetchWithTimeout(url, {
        headers: {
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "ResourceNinja-Microsoft-E2E",
        },
      });
    }
  }

  return response;
}

async function fetchFileContent(url) {
  const response = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": "ResourceNinja-Microsoft-E2E",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText} (${url})`);
  }
  return response.text();
}

function resolveSymlinkTargetPath(currentPath, targetPath) {
  const normalizedCurrent = currentPath.replace(/^\/+|\/+$/g, "");
  const normalizedTarget = targetPath.replace(/\\/g, "/").trim();

  if (!normalizedTarget) {
    return normalizedCurrent;
  }

  const baseDir = normalizedCurrent.includes("/")
    ? normalizedCurrent.substring(0, normalizedCurrent.lastIndexOf("/"))
    : "";

  return path.posix
    .normalize(path.posix.join("/", baseDir, normalizedTarget))
    .replace(/^\/+/, "");
}

async function listGitHubDirectoryInternal(
  owner,
  repo,
  remotePath,
  branch,
  visitedPaths = new Set(),
) {
  const normalizedPath = remotePath.replace(/^\/+|\/+$/g, "");
  if (visitedPaths.has(normalizedPath)) {
    throw new Error(`Symlink loop detected: ${normalizedPath}`);
  }
  visitedPaths.add(normalizedPath);

  const encodedPath = normalizedPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${branch}`;
  const response = await githubApiFetch(url);
  if (!response.ok) {
    throw new Error(`Failed to list directory: ${response.status}`);
  }

  const data = await response.json();
  if (Array.isArray(data)) {
    return data;
  }

  if (data.type === "symlink" && data.target) {
    const resolvedTarget = resolveSymlinkTargetPath(
      normalizedPath,
      data.target,
    );
    return listGitHubDirectoryInternal(
      owner,
      repo,
      resolvedTarget,
      branch,
      visitedPaths,
    );
  }

  throw new Error(`Path is not a directory: ${normalizedPath}`);
}

async function downloadDirectory(owner, repo, remotePath, localPath, branch) {
  const entries = await listGitHubDirectoryInternal(
    owner,
    repo,
    remotePath,
    branch,
  );
  const files = entries.filter(
    (entry) => entry.type === "file" && entry.download_url,
  );
  const dirs = entries.filter((entry) => entry.type === "dir");

  for (const file of files) {
    const targetPath = path.join(localPath, file.name);
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    const content = await fetchFileContent(file.download_url);
    await fsp.writeFile(targetPath, content, "utf8");
  }

  for (const dir of dirs) {
    const targetDir = path.join(localPath, dir.name);
    await fsp.mkdir(targetDir, { recursive: true });
    await downloadDirectory(
      owner,
      repo,
      `${remotePath}/${dir.name}`,
      targetDir,
      branch,
    );
  }
}

async function main() {
  console.log("=== MicrosoftDocs Agent Skills E2E install test ===");

  const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
  const source = index.sources.find((entry) =>
    /github\.com\/MicrosoftDocs\/Agent-Skills\/?$/i.test(entry.url),
  );
  assert(source, "MicrosoftDocs/Agent-Skills source not found");

  const actualSkill = index.skills.find(
    (entry) =>
      entry.source === source.id && entry.name === "azure-active-directory-b2c",
  );
  assert(
    actualSkill,
    "Representative MicrosoftDocs skill not found in bundled index",
  );

  const repoMatch = source.url.match(/github\.com\/([^/]+)\/([^/]+)/);
  assert(repoMatch, "Invalid source URL");
  const owner = repoMatch[1];
  const repo = repoMatch[2].replace(/\.git$/, "");
  const branch = source.branch || "main";

  const tempRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), "resource-ninja-ms-e2e-"),
  );
  const installDir = path.join(
    tempRoot,
    ".github",
    "skills",
    sanitizeSkillName(actualSkill.name),
  );

  try {
    await fsp.mkdir(installDir, { recursive: true });
    await downloadDirectory(owner, repo, actualSkill.path, installDir, branch);

    const skillMdPath = path.join(installDir, "SKILL.md");
    const stat = await fsp.stat(skillMdPath);
    assert(stat.size > 0, "Installed SKILL.md is empty");

    const referencesDir = path.join(installDir, "references");
    const referencesExists = await fsp
      .stat(referencesDir)
      .then(() => true)
      .catch(() => false);

    const skillMdContent = await fsp.readFile(skillMdPath, "utf8");
    assert(
      skillMdContent.includes("Azure Active Directory B2C") ||
        skillMdContent.includes(actualSkill.name),
      "Installed SKILL.md content does not match expected MicrosoftDocs skill",
    );

    console.log(`Skill: ${actualSkill.name}`);
    console.log(`Actual install path: ${actualSkill.path}`);
    console.log(`Installed to: ${installDir}`);
    console.log(`SKILL.md bytes: ${stat.size}`);
    console.log(`references/ exists: ${referencesExists}`);
    console.log("RESULT=PASS");
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("RESULT=FAIL");
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
