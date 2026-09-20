$ErrorActionPreference = 'Stop'
$gymosRoot = Split-Path -Parent $PSScriptRoot
$gymosNode = (Get-Command node -ErrorAction Stop).Source
$gymosLocal = Join-Path $gymosRoot '.local'
New-Item -ItemType Directory -Path $gymosLocal -Force | Out-Null
Start-Process -FilePath $gymosNode -ArgumentList ('"' + (Join-Path $PSScriptRoot 'git-sync.mjs') + '"') -WorkingDirectory $gymosRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $gymosLocal 'git-sync.log') -RedirectStandardError (Join-Path $gymosLocal 'git-sync-error.log')
