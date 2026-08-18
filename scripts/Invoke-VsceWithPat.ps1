<#
.SYNOPSIS
Runs vsce with a validated VSCE_PAT from Process or User environment.

.DESCRIPTION
Use `npm run release:vsce -- verify-pat` for credential preflight. To publish a
prebuilt VSIX, invoke this wrapper directly from PowerShell and pass every vsce
argument through `-VsceArgs @(...)` so `-i` is not parsed as a script parameter.

.EXAMPLE
npm run release:vsce -- verify-pat

.EXAMPLE
& .\scripts\Invoke-VsceWithPat.ps1 -VsceArgs @('publish', '-i', '.\artifacts\vsix\agent-resources-ninja-X.Y.Z.vsix', '--skip-duplicate')
#>

param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$VsceArgs
)

$ErrorActionPreference = 'Stop'

function Test-VscePat {
  param([string]$Pat)

  if ([string]::IsNullOrWhiteSpace($Pat)) {
    return $false
  }

  & npx --yes @vscode/vsce verify-pat -p $Pat *> $null
  return ($LASTEXITCODE -eq 0)
}

function Get-ResolvedVscePat {
  $processPat = [System.Environment]::GetEnvironmentVariable('VSCE_PAT', 'Process')
  if (Test-VscePat $processPat) {
    return @{ Value = $processPat; Source = 'Process' }
  }

  $userPat = [System.Environment]::GetEnvironmentVariable('VSCE_PAT', 'User')
  if (Test-VscePat $userPat) {
    return @{ Value = $userPat; Source = 'User' }
  }

  return $null
}

if (-not $VsceArgs -or $VsceArgs.Count -eq 0) {
  throw 'Usage: npm run release:vsce -- verify-pat | publish a built VSIX with: & .\scripts\Invoke-VsceWithPat.ps1 -VsceArgs @(''publish'', ''-i'', ''.\artifacts\vsix\agent-resources-ninja-X.Y.Z.vsix'', ''--skip-duplicate'')'
}

$patInfo = Get-ResolvedVscePat
if (-not $patInfo) {
  throw 'No valid VSCE_PAT found in Process or User environment. Update the User environment variable and rerun the wrapper.'
}

$env:VSCE_PAT = $patInfo.Value
Write-Host "Using VSCE_PAT from $($patInfo.Source) environment."

$effectiveArgs = @($VsceArgs)
if (
  $effectiveArgs[0] -eq 'verify-pat' -and
  -not ($effectiveArgs -contains '-p' -or $effectiveArgs -contains '--pat')
) {
  $effectiveArgs += @('-p', $patInfo.Value)
}

& npx --yes @vscode/vsce @effectiveArgs
exit $LASTEXITCODE