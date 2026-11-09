# Claude Usage Widget installer for Windows.
# Start it by double-clicking INSTALL.cmd. It can be run as many times as needed:
# it skips the steps already done and updates the widget files.

$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'Claude Usage Widget setup'

$src  = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'widget'
$dest = Join-Path $env:LOCALAPPDATA 'ClaudeUsageWidget'
$bin  = Join-Path $env:USERPROFILE '.local\bin'

function Step($n, $t) { Write-Host ''; Write-Host "[$n/6] $t" -ForegroundColor Cyan }
function Ok($t)       { Write-Host "  OK  $t" -ForegroundColor Green }
function Info($t)     { Write-Host "      $t" }
function Fail($t) {
    Write-Host ''
    Write-Host "  ERROR: $t" -ForegroundColor Red
    Write-Host ''
    Read-Host 'Press Enter to close'
    exit 1
}
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Has($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

Write-Host '=============================================' -ForegroundColor Cyan
Write-Host '   Claude Usage Widget setup' -ForegroundColor Cyan
Write-Host '=============================================' -ForegroundColor Cyan

if (-not (Test-Path (Join-Path $src 'main.js'))) {
    Fail "Cannot find the 'widget' folder next to the installer. Did you extract the whole zip before running it?"
}

# ---------------------------------------------------------------- 1. Node.js
Step 1 'Node.js'
Refresh-Path
if (Has 'node') {
    Ok ("Node.js found (" + (& node -v) + ")")
} else {
    if (-not (Has 'winget')) {
        Fail 'Node.js is not installed. Download it from https://nodejs.org (LTS version), install it and run INSTALL.cmd again.'
    }
    Info 'Installing Node.js (LTS). If Windows asks for permission, answer Yes...'
    & winget install --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements | Out-Host
    Refresh-Path
    if (-not (Has 'node')) {
        Fail 'Node.js installation failed. Install it from https://nodejs.org (LTS version) and run INSTALL.cmd again.'
    }
    Ok ("Node.js installed (" + (& node -v) + ")")
}

# ---------------------------------------------------------------- 2. Claude Code
Step 2 'Claude Code'
$claudeExe = Join-Path $bin 'claude.exe'
if ((Test-Path $claudeExe) -or (Has 'claude')) {
    Ok 'Claude Code found'
} else {
    Info 'Installing Claude Code (no progress is shown, please wait)...'
    # In a separate process: the official script may close the session it runs in.
    & powershell -NoProfile -ExecutionPolicy Bypass -Command 'irm https://claude.ai/install.ps1 | iex' | Out-Host
    if (-not (Test-Path $claudeExe)) {
        Fail 'Claude Code installation failed. Check your connection and run INSTALL.cmd again.'
    }
    Ok 'Claude Code installed'
}
# Claude Code folder in the user PATH (the official installer sometimes does not add it)
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not $userPath) { $userPath = '' }
if (($userPath -split ';') -notcontains $bin) {
    [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ';' + $bin).TrimStart(';'), 'User')
    Info 'Added Claude Code to the PATH'
}
Refresh-Path
if (-not (Test-Path $claudeExe)) { $claudeExe = (Get-Command claude).Source }

# ---------------------------------------------------------------- 3. Widget files
Step 3 'Widget files'
# Earlier version: the autostart launcher says which folder it was installed in.
$startupVbs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\ClaudeUsageWidget.vbs'
$oldDir = $null
if (Test-Path $startupVbs) {
    $vbs = Get-Content $startupVbs -Raw
    if ($vbs -match 'CurrentDirectory = "([^"]+)"') { $oldDir = $Matches[1].TrimEnd('\') }
}
if ($oldDir -and ($oldDir -ne $dest.TrimEnd('\'))) {
    Info "Found an earlier version in: $oldDir"
    Info 'It will be replaced by this one (autostart and refresh will move to the new one).'
} elseif ($oldDir) {
    Info 'Found an earlier version in the same folder: updating it.'
    $oldDir = $null
}
# Close the widget if it is running (needed to replace the files)
for ($i = 0; $i -lt 5; $i++) {
    Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
}
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Get-ChildItem -Path $src -File | Copy-Item -Destination $dest -Force
# Files with the old (Italian) names from earlier versions are no longer used
foreach ($f in @('aggiorna.js', 'automazione.js', 'migra.js', 'setup.js', 'aggiorna-nascosto.vbs', 'README.md')) {
    Remove-Item (Join-Path $dest $f) -Force -ErrorAction SilentlyContinue
}
Ok "Copied to $dest"
if ($oldDir) {
    & node (Join-Path $dest 'migrate.js') $oldDir | Out-Host
}

# ---------------------------------------------------------------- 4. Electron
Step 4 'Widget components (the first time it downloads about 100 MB, a few minutes)'
Push-Location $dest
try {
    & npm.cmd install --no-audit --no-fund --loglevel=error | Out-Host
    $electronExe = Join-Path $dest 'node_modules\electron\dist\electron.exe'
    if (-not (Test-Path $electronExe)) {
        Info 'Finishing the Electron download...'
        & node (Join-Path $dest 'node_modules\electron\install.js') | Out-Host
    }
    if (-not (Test-Path $electronExe)) {
        Fail 'Electron was not downloaded. Check your connection and run INSTALL.cmd again.'
    }
    Ok 'Components installed'
} finally {
    Pop-Location
}

# ---------------------------------------------------------------- 5. Claude sign-in
Step 5 'Sign in to your Claude account'
function Test-Login {
    # 'Continue': in PowerShell 5.1 a warning on stderr must not make the check look failed
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $raw = & $claudeExe auth status --json 2>$null | Out-String
        return [bool](($raw | ConvertFrom-Json).loggedIn)
    } catch {
        return $false
    } finally {
        $ErrorActionPreference = $prev
    }
}
if (Test-Login) {
    Ok 'Already signed in'
} else {
    Info 'Your browser will open: sign in with your Claude account (Pro or Max plan).'
    Info 'When the browser says you are done, come back to this window.'
    & $claudeExe auth login --claudeai
    if (-not (Test-Login)) {
        Fail 'Sign-in not completed. Run INSTALL.cmd again and finish signing in in the browser.'
    }
    Ok 'Signed in'
}

# ---------------------------------------------------------------- 6. Automations
Step 6 'Autostart, refresh every 15 minutes and first data read'
Push-Location $dest
try {
    & node (Join-Path $dest 'automation.js') install | Out-Host
    if ($LASTEXITCODE -ne 0) { Fail 'Could not turn on the automations (see the message above).' }
} finally {
    Pop-Location
}

# Earlier version replaced: its folder can be deleted
if ($oldDir -and (Test-Path $oldDir)) {
    $isWidget = (Test-Path (Join-Path $oldDir 'main.js')) -and
                ((Test-Path (Join-Path $oldDir 'aggiorna.js')) -or (Test-Path (Join-Path $oldDir 'refresh.js')))
    Write-Host ''
    Ok 'The earlier version has been replaced: the new one now starts and refreshes.'
    if ($isWidget) {
        $ans = Read-Host "      Delete the old folder $oldDir ? (Y/N)"
        if ($ans -match '^[yYsS]') {
            Remove-Item $oldDir -Recurse -Force -ErrorAction SilentlyContinue
            if (Test-Path $oldDir) { Info 'Could not delete it completely: you can do it by hand.' }
            else { Ok 'Old folder deleted.' }
        } else {
            Info 'Left where it is: it is no longer used, you can delete it whenever you like.'
        }
    }
}

Write-Host ''
Write-Host '=============================================' -ForegroundColor Green
Write-Host '   Done! The widget is on your screen.' -ForegroundColor Green
Write-Host '=============================================' -ForegroundColor Green
Write-Host ''
Write-Host '  - It starts automatically every time you sign in.'
Write-Host '  - Drag it anywhere; double-click to change style.'
Write-Host '  - Right-click: Refresh now, Style, Icons next to the clock, Opacity, Quit.'
Write-Host "  - Installed in: $dest"
Write-Host '  - To remove it: UNINSTALL.cmd'
Write-Host ''
Read-Host 'Press Enter to close'
