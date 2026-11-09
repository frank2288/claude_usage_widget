# Claude Usage Widget uninstaller.
# Removes the widget, autostart and periodic refresh.
# Node.js and Claude Code stay installed.

$ErrorActionPreference = 'Continue'
$Host.UI.RawUI.WindowTitle = 'Claude Usage Widget uninstall'
$dest = Join-Path $env:LOCALAPPDATA 'ClaudeUsageWidget'

Write-Host 'Uninstalling Claude Usage Widget' -ForegroundColor Cyan
Write-Host ''

if (Test-Path (Join-Path $dest 'automation.js')) {
    Push-Location $dest
    & node (Join-Path $dest 'automation.js') remove | Out-Host
    Pop-Location
}
# Fallback, and cleanup of the names used by earlier versions
Remove-Item (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\ClaudeUsageWidget.vbs') -Force -ErrorAction SilentlyContinue
foreach ($task in @('ClaudeUsageWidget-Refresh', 'ClaudeUsageWidget-Aggiorna')) {
    & schtasks /Delete /TN $task /F 2>$null | Out-Null
}

for ($i = 0; $i -lt 5; $i++) {
    Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
}

if (Test-Path $dest) {
    Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path $dest) {
        Write-Host "Could not delete $dest : please delete it by hand." -ForegroundColor Yellow
    } else {
        Write-Host "Removed the folder $dest" -ForegroundColor Green
    }
}

Write-Host ''
Write-Host 'Done. Node.js and Claude Code stay installed.' -ForegroundColor Green
Write-Host ''
Read-Host 'Press Enter to close'
