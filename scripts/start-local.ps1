$ErrorActionPreference = "Continue"

$projectPath = Split-Path -Parent $PSScriptRoot
$nodePath = "C:\Program Files\nodejs\node.exe"
$logPath = Join-Path $projectPath ".data\local-server.log"
$pidPath = Join-Path $projectPath ".data\local-server.pid"

New-Item -ItemType Directory -Path (Split-Path -Parent $logPath) -Force | Out-Null
Set-Content -LiteralPath $logPath -Value "YAAS local server launcher started: $(Get-Date -Format s)"

function Stop-OldLocalServer {
  if (!(Test-Path $pidPath)) { return }
  $oldPid = Get-Content -LiteralPath $pidPath -ErrorAction SilentlyContinue
  if (!$oldPid -or $oldPid -eq $PID) { return }
  Stop-Process -Id $oldPid -Force -ErrorAction SilentlyContinue
}

while ($true) {
  Stop-OldLocalServer
  Set-Content -LiteralPath $pidPath -Value $PID
  Push-Location $projectPath
  try {
    $env:PORT = "4173"
    & $nodePath "server.js" 2>&1 | Tee-Object -FilePath $logPath -Append
  } catch {
    $_ | Out-File -LiteralPath $logPath -Append
  } finally {
    Pop-Location
  }
  Start-Sleep -Seconds 2
}
