$ErrorActionPreference = 'Stop'
$gymosRoot = Split-Path -Parent $PSScriptRoot
$gymosStartup = [Environment]::GetFolderPath('Startup')
$gymosShell = New-Object -ComObject WScript.Shell
$gymosShortcut = $gymosShell.CreateShortcut((Join-Path $gymosStartup 'GymOS Git Sync.lnk'))
$gymosShortcut.TargetPath = Join-Path $PSHOME 'powershell.exe'
$gymosShortcut.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'start-git-sync.ps1') + '"'
$gymosShortcut.WorkingDirectory = $gymosRoot
$gymosShortcut.WindowStyle = 7
$gymosShortcut.Description = 'Validate and sync GymOS code to GitHub after stable edits.'
$gymosShortcut.Save()
Write-Output 'GymOS Git sync will start automatically at Windows sign-in.'
& (Join-Path $PSScriptRoot 'start-git-sync.ps1')
