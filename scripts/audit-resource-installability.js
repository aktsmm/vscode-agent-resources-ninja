#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const DEFAULT_INDEX_PATH = path.join(
  __dirname,
  "..",
  "resources",
  "skill-index.json",
);
const DEFAULT_CONCURRENCY = 8;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

function normalizeGitHubRepoUrl(url) {
  const trimmed = String(url || "")
    .trim()
    .replace(/\.git$/i, "")
    .replace(/\/$/, "");
  const match = trimmed.match(
    /^(https:\/\/github\.com\/[^/]+\/[^/]+)(?:\/(?:tree|blob)\/.*)?$/i,
  );
  return match ? match[1] : trimmed;
}

function extractOwnerRepo(repoUrl) {
  const match = normalizeGitHubRepoUrl(repoUrl).match(
    /github\.com\/([^/]+)\/([^/]+)/i,
  );
  if (!match) {
    return undefined;
  }

  return {
    owner: match[1],
    repo: match[2],
  };
}

function isResourceFilePath(resourcePath) {
  const fileName = String(resourcePath || "")
    .replace(/\\/g, "/")
    .split("/")
    .pop();
  return /\.(?:agent\.md|instructions\.md|prompt\.md|md|mdx|mdc|json|ya?ml|toml|txt)$/i.test(
    fileName || "",
  );
}

function getResourceContentPath(resource, defaultFileName = "SKILL.md") {
  if (resource.kind === "plugin" && resource.pluginManifestPath) {
    return resource.pluginManifestPath;
  }
  if (isResourceFilePath(resource.path)) {
    return resource.path;
  }
  return `${resource.path.replace(/\/+$/, "")}/${defaultFileName}`;
}

function buildResourceKey(resource) {
  return [resource.source, resource.kind || "skill", resource.path].join(":");
}

function buildRawUrl(source, branch, resource) {
  const ownerRepo = extractOwnerRepo(source.url);
  if (!ownerRepo) {
    return undefined;
  }

  return `https://raw.githubusercontent.com/${ownerRepo.owner}/${ownerRepo.repo}/${branch}/${getResourceContentPath(resource)}`;
}

function createHeaders({ token, raw = false } = {}) {
  const headers = {
    Accept: raw ? "*/*" : "application/vnd.github.v3+json",
    "User-Agent": "ResourceNinja-InstallabilityAudit",
  };
  if (token && !raw) {
    headers.Authorization = `token ${token}`;
  }
  return headers;
}

async function githubFetch(url, fetchImpl, token, options = {}) {
  const response = await fetchImpl(url, {
    method: options.method || "GET",
    headers: createHeaders({ token, raw: options.raw }),
  });

  if (
    response.status === 403 &&
    token &&
    !options.raw &&
    response.text instanceof Function
  ) {
    const bodyText = await response.clone().text();
    if (
      bodyText.includes(
        "forbids access via a personal access tokens (classic)",
      )
    ) {
      return fetchImpl(url, {
        method: options.method || "GET",
        headers: createHeaders({ raw: options.raw }),
      });
    }
  }

  return response;
}

async function resolveDefaultBranch(source, fetchImpl, token, branchCache) {
  if (source.branch) {
    return source.branch;
  }

  const normalizedUrl = normalizeGitHubRepoUrl(source.url);
  if (branchCache.has(normalizedUrl)) {
    return branchCache.get(normalizedUrl);
  }

  const ownerRepo = extractOwnerRepo(normalizedUrl);
  if (!ownerRepo) {
    branchCache.set(normalizedUrl, "main");
    return "main";
  }

  const response = await githubFetch(
    `https://api.github.com/repos/${ownerRepo.owner}/${ownerRepo.repo}`,
    fetchImpl,
    token,
  );
  let branch = "main";
  if (response.ok) {
    const payload = await response.json();
    branch = payload.default_branch || "main";
  }
  branchCache.set(normalizedUrl, branch);
  return branch;
}

async function checkRawUrl(rawUrl, fetchImpl, token) {
  const headResponse = await githubFetch(rawUrl, fetchImpl, token, {
    method: "HEAD",
    raw: true,
  });
  if (headResponse.status === 405) {
    const getResponse = await githubFetch(rawUrl, fetchImpl, token, {
      method: "GET",
      raw: true,
    });
    return getResponse.ok;
  }
  return headResponse.ok;
}

async function auditIndexInstallability(index, options = {}) {
  const fetchImpl = options.fetchImpl || global.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is not available in this environment");
  }

  const branchCache = new Map();
  const findings = [];
  const normalizedSources = (index.sources || []).map((source) => ({
    ...source,
    normalizedUrl: normalizeGitHubRepoUrl(source.url),
  }));
  const sourceMap = new Map(normalizedSources.map((source) => [source.id, source]));
  const concurrency = Math.max(1, options.concurrency || DEFAULT_CONCURRENCY);
  const resources = Array.isArray(index.skills) ? index.skills : [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < resources.length) {
      const resource = resources[cursor];
      cursor += 1;

      const source = sourceMap.get(resource.source);
      if (!source) {
        findings.push({
          type: "missing-source",
          key: buildResourceKey(resource),
          sourceId: resource.source,
          name: resource.name,
          kind: resource.kind || "skill",
          path: resource.path,
        });
        continue;
      }

      const branch = await resolveDefaultBranch(
        { ...source, url: source.normalizedUrl },
        fetchImpl,
        options.token,
        branchCache,
      );
      const rawUrl = buildRawUrl(
        { ...source, url: source.normalizedUrl },
        branch,
        resource,
      );
      if (!rawUrl) {
        findings.push({
          type: "invalid-source-url",
          key: buildResourceKey(resource),
          sourceId: source.id,
          sourceUrl: source.url,
          name: resource.name,
          kind: resource.kind || "skill",
          path: resource.path,
        });
        continue;
      }

      const reachable = await checkRawUrl(rawUrl, fetchImpl, options.token);
      if (!reachable) {
        findings.push({
          type: "unreachable",
          key: buildResourceKey(resource),
          sourceId: source.id,
          sourceUrl: source.url,
          name: resource.name,
          kind: resource.kind || "skill",
          path: resource.path,
          rawUrl,
        });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, resources.length || 1) }, () =>
      worker(),
    ),
  );

  return {
    findings,
    normalizedSourceUrls: normalizedSources
      .filter((source) => source.url !== source.normalizedUrl)
      .map((source) => ({
        id: source.id,
        from: source.url,
        to: source.normalizedUrl,
      })),
  };
}

function applyAuditFixes(index, auditResult) {
  const failingKeys = new Set(auditResult.findings.map((finding) => finding.key));
  const skills = (index.skills || []).filter(
    (resource) => !failingKeys.has(buildResourceKey(resource)),
  );
  const availableNamesBySource = new Map();
  for (const resource of skills) {
    if (!availableNamesBySource.has(resource.source)) {
      availableNamesBySource.set(resource.source, new Set());
    }
    availableNamesBySource.get(resource.source).add(resource.name);
  }

  const bundles = (index.bundles || [])
    .map((bundle) => {
      const availableNames = availableNamesBySource.get(bundle.source) || new Set();
      const skillsInBundle = bundle.skills.filter((name) => availableNames.has(name));
      const installOrder = (bundle.installOrder || []).filter((name) =>
        skillsInBundle.includes(name),
      );
      return {
        ...bundle,
        skills: skillsInBundle,
        installOrder,
        coreSkill:
          bundle.coreSkill && skillsInBundle.includes(bundle.coreSkill)
            ? bundle.coreSkill
            : undefined,
      };
    })
    .filter((bundle) => bundle.skills.length > 0);

  return {
    ...index,
    sources: (index.sources || []).map((source) => ({
      ...source,
      url: normalizeGitHubRepoUrl(source.url),
    })),
    skills,
    bundles,
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const apply = args.has("--apply");
  const rawOnly = args.has("--raw-only");
  const indexPath = DEFAULT_INDEX_PATH;
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const auditResult = await auditIndexInstallability(index, {
    token: GITHUB_TOKEN,
    rawOnly,
  });

  for (const sourceFix of auditResult.normalizedSourceUrls) {
    console.log(
      `WARN normalize source.url ${sourceFix.id}: ${sourceFix.from} -> ${sourceFix.to}`,
    );
  }
  for (const finding of auditResult.findings) {
    console.log(
      `FAIL ${finding.type} ${finding.sourceId} ${finding.kind} ${finding.path}${finding.rawUrl ? ` -> ${finding.rawUrl}` : ""}`,
    );
  }

  if (apply) {
    const nextIndex = applyAuditFixes(index, auditResult);
    if (JSON.stringify(nextIndex) !== JSON.stringify(index)) {
      fs.writeFileSync(indexPath, `${JSON.stringify(nextIndex, null, 2)}\n`, "utf8");
      console.log(
        `APPLY updated ${path.relative(process.cwd(), indexPath)} (${auditResult.findings.length} stale resources pruned)`,
      );
    } else {
      console.log("APPLY no changes");
    }
    console.log("RESULT=PASS");
    return;
  }

  if (
    auditResult.findings.length > 0 ||
    auditResult.normalizedSourceUrls.length > 0
  ) {
    process.exitCode = 1;
    return;
  }

  console.log("RESULT=PASS");
}

module.exports = {
  normalizeGitHubRepoUrl,
  extractOwnerRepo,
  getResourceContentPath,
  buildRawUrl,
  buildResourceKey,
  auditIndexInstallability,
  applyAuditFixes,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exit(1);
  });
}