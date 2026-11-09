# Disinstallazione di Claude Usage Widget.
# Toglie widget, avvio automatico e aggiornamento periodico.
# Node.js e Claude Code restano installati.

$ErrorActionPreference = 'Continue'
$Host.UI.RawUI.WindowTitle = 'Disinstallazione Claude Usage Widget'
$dest = Join-Path $env:LOCALAPPDATA 'ClaudeUsageWidget'

Write-Host 'Disinstallazione di Claude Usage Widget' -ForegroundColor Cyan
Write-Host ''

if (Test-Path (Join-Path $dest 'automazione.js')) {
    Push-Location $dest
    & node (Join-Path $dest 'automazione.js') rimuovi | Out-Host
    Pop-Location
} else {
    # Ripiego se i file non ci sono più
    Remove-Item (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\ClaudeUsageWidget.vbs') -Force -ErrorAction SilentlyContinue
    & schtasks /Delete /TN 'ClaudeUsageWidget-Aggiorna' /F 2>$null | Out-Null
}

for ($i = 0; $i -lt 5; $i++) {
    Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
}

if (Test-Path $dest) {
    Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path $dest) {
        Write-Host "Non sono riuscito a cancellare $dest : cancellala a mano." -ForegroundColor Yellow
    } else {
        Write-Host "Rimossa la cartella $dest" -ForegroundColor Green
    }
}

Write-Host ''
Write-Host 'Fatto. Node.js e Claude Code restano installati.' -ForegroundColor Green
Write-Host ''
Read-Host 'Premi Invio per chiudere'
