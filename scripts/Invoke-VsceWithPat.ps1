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

  & npx --yes vsce verify-pat -p $Pat *> $null
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
  throw 'Usage: npm run release:vsce -- <vsce arguments>'
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

& npx --yes vsce @effectiveArgs
exit $LASTEXITCODE