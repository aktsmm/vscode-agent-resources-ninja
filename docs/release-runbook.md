# Release Runbook

This is the tracked release source of truth for Agent Resources Ninja. Local `.github` instructions may add operator context, but they must not contradict this runbook.

## 1. Confirm the Target Version

Before changing files, confirm that `vX.Y.Z` is not already published:

```powershell
npx --yes @vscode/vsce show yamapan.agent-resources-ninja --json
git ls-remote --tags origin vX.Y.Z
gh release view vX.Y.Z --json "tagName,name,url,isDraft,isPrerelease"
```

If the version already exists in the Marketplace or remote tags, increment the version. Do not move an existing release tag.

## 2. Run Quality Gates

```powershell
npm run compile
npm run test:resources
npm run test:upstream
npm test
npm run audit:runtime
npm audit --audit-level=moderate
```

All gates must pass before packaging. Network-backed upstream checks are release-only requirements and must not be replaced by the offline suite.

## 3. Synchronize Release Metadata

Update these files together:

- `package.json`: extension version
- `package-lock.json`: package version
- `package.nls.json`: extension version and release date
- `package.nls.ja.json`: extension version and release date
- `CHANGELOG.md`: move `Unreleased` entries into `X.Y.Z`
- `release-notes-vX.Y.Z.md`: release summary, verification, final VSIX size, and SHA256

When the bundled catalog changes, also synchronize the resource-index version and resource/source counts from `resources/skill-index.json` into both NLS files.

## 4. Build and Inspect the VSIX

```powershell
npm run package
npx --yes @vscode/vsce package --out .\artifacts\vsix\agent-resources-ninja-X.Y.Z.vsix
node scripts/test-release-hygiene.js
Get-Item -LiteralPath .\artifacts\vsix\agent-resources-ninja-X.Y.Z.vsix | Select-Object Name,Length,LastWriteTime
Get-FileHash -Algorithm SHA256 -LiteralPath .\artifacts\vsix\agent-resources-ninja-X.Y.Z.vsix
```

Treat the file's existence, size, timestamp, and hash as the build result. Confirm the package excludes source maps, tests, `.github`, `.vscode`, and local artifacts while retaining `dist/extension.js`.

## 5. Validate Marketplace Credentials

```powershell
npm run release:vsce -- verify-pat
```

The wrapper checks the Process-scoped PAT first and then the User-scoped PAT. Never print, commit, or paste `VSCE_PAT` into logs or documentation. A publishing PAT needs a future expiration and `Marketplace > Manage` scope.

## 6. Commit and Tag

Review the exact staged files before committing. Then commit, push `master`, and push a new annotated `vX.Y.Z` tag according to the repository Git policy. Never force-push or replace an existing release tag.

## 7. Publish the Built VSIX

For a prebuilt VSIX, invoke the PowerShell wrapper directly and pass all vsce arguments through the array parameter:

```powershell
& .\scripts\Invoke-VsceWithPat.ps1 -VsceArgs @(
  'publish',
  '-i',
  '.\artifacts\vsix\agent-resources-ninja-X.Y.Z.vsix',
  '--skip-duplicate'
)
```

Do not use `npm run release:vsce -- publish -i <path>` or `--packagePath <path>`. PowerShell parameter binding can consume the short option and make vsce interpret the path as a version.

## 8. Create and Verify the GitHub Release

Create the GitHub Release from the exact annotated tag, use `release-notes-vX.Y.Z.md` as the body, and attach the same VSIX. Verify Marketplace, GitHub Release, Git tag, and asset bytes independently. Download the Marketplace package and GitHub asset, then compare both size and SHA256 with the local VSIX.

A release is complete only when version, commit, tag, push, Marketplace publish, GitHub Release, and independent artifact verification are each done or explicitly recorded as blocked.

## 日本語要点

- 生成済み VSIX の publish は `-VsceArgs` 配列形式だけを使用します。
- `npm run release:vsce -- publish -i <path>` は使いません。
- release 前は offline test に加えて `npm run test:upstream` が必須です。
- Marketplace と GitHub Release の成果物は、ローカル VSIX とサイズ・SHA256 を照合します。
- PAT、秘密情報、個人環境の絶対パスを成果物やログへ残しません。
