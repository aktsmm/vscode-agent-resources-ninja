<#
.SYNOPSIS
Compares a published release across the local VSIX, the GitHub Release asset, and the Marketplace package.

.DESCRIPTION
`vsce show` and the Marketplace page can keep returning the previous version for a few minutes after a
publish, so neither is evidence that the release is out. This downloads the same version from each place
and compares size and SHA256. Read-only: it never publishes or edits anything, and it removes the
temporary downloads it created.

.PARAMETER Version
Version to check, for example 0.2.59. Defaults to the version in package.json.

.PARAMETER LocalVsix
Optional path to the locally built VSIX. When omitted, only the GitHub Release asset and the Marketplace
package are compared.

.PARAMETER Publisher
Marketplace publisher id.

.PARAMETER Extension
Marketplace extension name.

.EXAMPLE
pwsh -File scripts/Compare-ReleaseArtifact.ps1 -LocalVsix artifacts/vsix/agent-resources-ninja-0.2.59.vsix
#>
[CmdletBinding()]
param(
    [string]$Version,
    [string]$LocalVsix,
    [string]$Publisher = 'yamapan',
    [string]$Extension = 'agent-resources-ninja'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

if (-not $Version) {
    $packageJson = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $Version = $packageJson.version
}

$work = Join-Path ([System.IO.Path]::GetTempPath()) "release-compare-$Extension-$Version-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $work | Out-Null
$rows = @()

try {
    if ($LocalVsix) {
        $resolved = (Resolve-Path -LiteralPath $LocalVsix).Path
        $rows += [pscustomobject]@{ Source = 'local'; Path = $resolved }
    }

    $release = Join-Path $work 'github-release.vsix'
    gh release download "v$Version" --pattern '*.vsix' --output $release --clobber
    if ($LASTEXITCODE -ne 0) { throw "gh release download v$Version failed (exit $LASTEXITCODE)" }
    $rows += [pscustomobject]@{ Source = 'github-release'; Path = $release }

    $marketplace = Join-Path $work 'marketplace.vsix'
    $url = "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/$Publisher/vsextensions/$Extension/$Version/vspackage"
    Invoke-WebRequest -Uri $url -OutFile $marketplace -Headers @{ 'Accept-Encoding' = 'gzip' } | Out-Null
    $rows += [pscustomobject]@{ Source = 'marketplace'; Path = $marketplace }

    $report = foreach ($row in $rows) {
        [pscustomobject]@{
            Source = $row.Source
            Length = (Get-Item -LiteralPath $row.Path).Length
            Sha256 = (Get-FileHash -LiteralPath $row.Path -Algorithm SHA256).Hash
        }
    }
    $report | Format-Table -AutoSize | Out-String | Write-Host

    $distinct = @($report | Select-Object -ExpandProperty Sha256 -Unique)
    if ($distinct.Count -eq 1) {
        Write-Host "MATCH: $($report.Count) sources are byte-identical for v$Version."
        exit 0
    }
    Write-Host "MISMATCH: sources differ for v$Version. Find which one is stale before publishing again."
    exit 1
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
