$ErrorActionPreference = "Stop"

$launcherPath = Join-Path $PSScriptRoot "start-local.ps1"
$startupDirectory = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDirectory "YAAS Local.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPath`""
$shortcut.WorkingDirectory = Split-Path -Parent $PSScriptRoot
$shortcut.WindowStyle = 7
$shortcut.Save()

$existingPidPath = Join-Path (Split-Path -Parent $PSScriptRoot) ".data\local-server.pid"
if (Test-Path $existingPidPath) {
  $existingPid = Get-Content -LiteralPath $existingPidPath -ErrorAction SilentlyContinue
  if ($existingPid) {
    Stop-Process -Id $existingPid -Force -ErrorAction SilentlyContinue
  }
}

Start-Process -FilePath "powershell.exe" `
  -ArgumentList "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPath`"" `
  -WindowStyle Hidden

Write-Output "YAAS local startup installed."
