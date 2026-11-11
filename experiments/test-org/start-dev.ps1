# Arranque estable de la instancia local de Paperclip (sin modificar el código de Paperclip).
#
#   powershell -File experiments/test-org/start-dev.ps1            # BD + servidor + UI
#   powershell -File experiments/test-org/start-dev.ps1 -NoUi      # sin la UI (menos carga)
#
# Requisitos:
#   - Docker Desktop en marcha.
#   - .paperclip/.env en la raíz del repo (ignorado por git) con, como mínimo:
#       DATABASE_URL, PAPERCLIP_HOME, PAPERCLIP_INSTANCE_ID,
#       PAPERCLIP_AGENT_JWT_SECRET, PAPERCLIP_TOOL_ACTION_SIGNING_SECRET, BETTER_AUTH_SECRET
#     Los tres secretos son valores aleatorios (openssl rand -hex 32), nunca se suben a git.
#
# Por qué existe este script (problemas de Windows con `pnpm dev`):
#   - Sin PAPERCLIP_AGENT_JWT_SECRET el servidor no puede firmar el token de API de cada run y los
#     agentes se quedan sin acceso a Paperclip ("Empty bearer token").
#   - Los scripts de pnpm usan cmd.exe y fallan con `mkdir -p`/`cp`: se fuerza Git Bash.
#   - `pnpm dev` (dev-runner) compila el Runner nativo, que falla en este equipo; se usa dev:server.
param([switch]$NoUi)

$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $root

$envFile = Join-Path $root ".paperclip\.env"
if (-not (Test-Path $envFile)) { throw "Falta $envFile (ver cabecera de este script)." }
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') { Set-Item -Path ("Env:" + $Matches[1]) -Value $Matches[2].Trim() }
}
foreach ($k in 'DATABASE_URL','PAPERCLIP_HOME','PAPERCLIP_INSTANCE_ID','PAPERCLIP_AGENT_JWT_SECRET','PAPERCLIP_TOOL_ACTION_SIGNING_SECRET','BETTER_AUTH_SECRET') {
  if (-not (Test-Path ("Env:" + $k))) { throw "Falta la variable $k en $envFile" }
}

$bash = "C:\Program Files\Git\bin\bash.exe"
$env:npm_config_script_shell = $bash

Write-Host "Postgres (Docker)..."
docker compose -f docker/docker-compose.dev-db.yml up -d

if (-not $NoUi) {
  Write-Host "UI en http://localhost:5173 (ventana aparte)..."
  Start-Process powershell -ArgumentList "-NoProfile", "-Command", "Set-Location '$root'; `$env:npm_config_script_shell='$bash'; pnpm dev:ui"
}

Write-Host "Servidor en http://localhost:3100 ..."
pnpm dev:server
