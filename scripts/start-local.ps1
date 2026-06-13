$ErrorActionPreference = "Continue"

$projectPath = Split-Path -Parent $PSScriptRoot
$nodePath = "C:\Program Files\nodejs\node.exe"
$logPath = Join-Path $projectPath ".data\local-server.log"
$pidPath = Join-Path $projectPath ".data\local-server.pid"

New-Item -ItemType Directory -Path (Split-Path -Parent $logPath) -Force | Out-Null

while ($true) {
  Set-Content -LiteralPath $pidPath -Value $PID
  Push-Location $projectPath
  try {
    & $nodePath "server.js" *>> $logPath
  } catch {
    $_ | Out-File -LiteralPath $logPath -Append
  } finally {
    Pop-Location
  }
  Start-Sleep -Seconds 2
}
