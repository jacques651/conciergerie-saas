# =============================================================
# Lance le backend (API + Socket.io) et le frontend (Vite) dans
# deux fenetres PowerShell separees.
# Usage : .\start.ps1        (ou double-clic sur start.bat)
# =============================================================
$root   = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path $root 'server'
$client = Join-Path $root 'client'

# NODE_ENV=production ferait ignorer les devDependencies (Vite, Tailwind)
$env:NODE_ENV = ''

# Installation automatique si node_modules est absent ou incomplet
if (-not (Test-Path (Join-Path $server 'node_modules\better-sqlite3'))) {
  Write-Host 'Installation des dependances du serveur...' -ForegroundColor Yellow
  Push-Location $server; npm install; Pop-Location
}
if (-not (Test-Path (Join-Path $client 'node_modules\vite\bin\vite.js'))) {
  Write-Host 'Installation des dependances du client...' -ForegroundColor Yellow
  Push-Location $client; npm install --include=dev; Pop-Location
}

# Base vide -> seed initial
if (-not (Test-Path (Join-Path $server 'data.sqlite'))) {
  Write-Host 'Creation des donnees de test (seed)...' -ForegroundColor Yellow
  Push-Location $server; node seed.js; Pop-Location
}

# Arrete d'eventuelles instances deja lancees sur les ports 4000 / 5173
foreach ($port in 4000, 5173) {
  Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}

Write-Host 'Demarrage du backend (port 4000)...' -ForegroundColor Green
Start-Process powershell -WorkingDirectory $server -ArgumentList '-NoExit', '-Command',
  "`$host.UI.RawUI.WindowTitle='Conciergerie - BACKEND'; `$env:NODE_ENV=''; npm run dev"

Start-Sleep -Seconds 2

Write-Host 'Demarrage du frontend (port 5173)...' -ForegroundColor Green
Start-Process powershell -WorkingDirectory $client -ArgumentList '-NoExit', '-Command',
  "`$host.UI.RawUI.WindowTitle='Conciergerie - FRONTEND'; `$env:NODE_ENV=''; npm run dev"

Write-Host ''
Write-Host 'Application lancee :' -ForegroundColor Cyan
Write-Host '  PC        : https://localhost:5173'
Write-Host '  Reseau    : https://192.168.100.235:5173'
Write-Host '  Pour arreter : fermez les deux fenetres (ou Ctrl+C dans chacune).'

Start-Sleep -Seconds 4
Start-Process 'https://localhost:5173'
