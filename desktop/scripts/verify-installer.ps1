# Smoke test for the Windows installer: silent install, first start, silent
# uninstall. It runs the app on its own port and with its own Paperclip home so
# it never touches a developer instance.
#
#   powershell -File scripts/verify-installer.ps1 [-Installer <path>] [-InstallDir <dir>] [-Port 3199]
param(
  [string]$Installer = "",
  [string]$InstallDir = "",
  [int]$Port = 3199,
  [int]$StartTimeoutSec = 420
)

$ErrorActionPreference = "Stop"
$desktopDir = Split-Path -Parent $PSScriptRoot
if (-not $Installer) { $Installer = (Get-ChildItem (Join-Path $desktopDir "release") -Filter "*Setup*.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName }
if (-not $InstallDir) { $InstallDir = Join-Path ([IO.Path]::GetTempPath()) "paperclip-installer-check" }
$work = Join-Path ([IO.Path]::GetTempPath()) "paperclip-installer-check-home"
$failures = New-Object System.Collections.Generic.List[string]

function Step($text) { Write-Host "==> $text" }
function Fail($text) { Write-Host "FAIL: $text" -ForegroundColor Red; $failures.Add($text) }

# Never leave a previous run's files in the way.
foreach ($dir in @($InstallDir, $work)) { if (Test-Path $dir) { cmd /c rd /s /q "\\?\$dir" } }

Step "Installing $Installer into $InstallDir"
$sw = [Diagnostics.Stopwatch]::StartNew()
# /D must be the last argument and must not be quoted.
$install = Start-Process -FilePath $Installer -ArgumentList @("/S", "/D=$InstallDir") -PassThru -Wait
Write-Host ("installer exit code {0} after {1:N0}s" -f $install.ExitCode, $sw.Elapsed.TotalSeconds)
if ($install.ExitCode -ne 0) { Fail "installer exit code $($install.ExitCode)" }

$exe = Join-Path $InstallDir "Paperclip Desktop.exe"
$runtime = Join-Path $InstallDir "resources\runtime\server"
if (-not (Test-Path $exe)) { Fail "missing $exe" }
foreach ($needed in @("dist\index.js", "ui-dist\index.html", "node_modules\@paperclipai\db\package.json", "node_modules\express\package.json")) {
  if (-not (Test-Path (Join-Path $runtime $needed))) { Fail "missing $needed in the installed runtime" }
}
$fileCount = (Get-ChildItem -LiteralPath "\\?\$InstallDir" -Recurse -File -Force -ErrorAction SilentlyContinue | Measure-Object).Count
Write-Host "installed files: $fileCount"

$app = $null
if ($failures.Count -eq 0) {
  Step "Starting the installed app on port $Port"
  New-Item -ItemType Directory -Force $work | Out-Null
  $env:PORT = "$Port"
  $env:PAPERCLIP_HOME = $work
  $logFile = Join-Path $env:APPDATA "Paperclip Desktop\logs\server.log"
  if (Test-Path $logFile) { Remove-Item $logFile -Force }
  $app = Start-Process -FilePath $exe -PassThru
  $deadline = (Get-Date).AddSeconds($StartTimeoutSec)
  $health = $null
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    try { $health = Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 3; if ($health.status) { break } } catch { $health = $null }
    if ($app.HasExited) { break }
  }
  if ($health -and $health.status) {
    Write-Host "health status: $($health.status)"
    try {
      $page = Invoke-WebRequest "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 10
      Write-Host "UI status code: $($page.StatusCode)"
      if ($page.StatusCode -ne 200) { Fail "UI answered $($page.StatusCode)" }
    } catch { Fail "UI request failed: $($_.Exception.Message)" }
  } else {
    Fail "the server did not answer /api/health within ${StartTimeoutSec}s (app exited: $($app.HasExited))"
    if (Test-Path $logFile) { Write-Host "--- server.log (tail) ---"; Get-Content $logFile -Tail 25 }
  }
}

Step "Stopping the app"
if ($app -and -not $app.HasExited) { taskkill /F /T /PID $app.Id | Out-Null }
Start-Sleep -Seconds 3
# Embedded PostgreSQL started by this install must not outlive it.
Get-CimInstance Win32_Process -Filter "Name='postgres.exe'" | Where-Object { $_.CommandLine -like "*$InstallDir*" -or $_.CommandLine -like "*$work*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Step "Uninstalling"
$uninstaller = Join-Path $InstallDir "Uninstall Paperclip Desktop.exe"
if (Test-Path $uninstaller) {
  # _?= makes the uninstaller run in place and lets -Wait see it finish.
  $un = Start-Process -FilePath $uninstaller -ArgumentList @("/S", "_?=$InstallDir") -PassThru -Wait
  Write-Host "uninstaller exit code $($un.ExitCode)"
  if ($un.ExitCode -ne 0) { Fail "uninstaller exit code $($un.ExitCode)" }
} else {
  Fail "no uninstaller found at $uninstaller"
}
# Count what the uninstaller left behind before cleaning up. With _?= the
# uninstaller cannot delete itself, so ignore that one file.
$left = 0
if (Test-Path $InstallDir) {
  $left = (Get-ChildItem -LiteralPath "\\?\$InstallDir" -Recurse -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne "Uninstall Paperclip Desktop.exe" } | Measure-Object).Count
}
if ($left -gt 0) { Fail "$left items left after uninstall" }
foreach ($dir in @($InstallDir, $work)) { if (Test-Path $dir) { cmd /c rd /s /q "\\?\$dir" } }

if ($failures.Count -eq 0) { Write-Host "OK: install, start and uninstall verified"; exit 0 }
Write-Host ("{0} problem(s):" -f $failures.Count); $failures | ForEach-Object { Write-Host " - $_" }
exit 1
