# Installatore di Claude Usage Widget per Windows.
# Si avvia con un doppio clic su INSTALLA.cmd. Si può rilanciare quante volte serve:
# salta i passaggi già fatti e aggiorna i file del widget.

$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'Installazione Claude Usage Widget'

$src  = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'widget'
$dest = Join-Path $env:LOCALAPPDATA 'ClaudeUsageWidget'
$bin  = Join-Path $env:USERPROFILE '.local\bin'

function Step($n, $t) { Write-Host ''; Write-Host "[$n/6] $t" -ForegroundColor Cyan }
function Ok($t)       { Write-Host "  OK  $t" -ForegroundColor Green }
function Info($t)     { Write-Host "      $t" }
function Fail($t) {
    Write-Host ''
    Write-Host "  ERRORE: $t" -ForegroundColor Red
    Write-Host ''
    Read-Host 'Premi Invio per chiudere'
    exit 1
}
function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
                [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Has($cmd) { return [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

Write-Host '=============================================' -ForegroundColor Cyan
Write-Host '   Installazione di Claude Usage Widget' -ForegroundColor Cyan
Write-Host '=============================================' -ForegroundColor Cyan

if (-not (Test-Path (Join-Path $src 'main.js'))) {
    Fail "Non trovo la cartella 'widget' accanto all'installatore. Hai estratto tutto lo zip prima di avviarlo?"
}

# ---------------------------------------------------------------- 1. Node.js
Step 1 'Node.js'
Refresh-Path
if (Has 'node') {
    Ok ("Node.js presente (" + (& node -v) + ")")
} else {
    if (-not (Has 'winget')) {
        Fail 'Node.js non è installato. Scaricalo da https://nodejs.org (versione LTS), installalo e rilancia INSTALLA.cmd.'
    }
    Info 'Installo Node.js (versione LTS). Se Windows chiede conferma, rispondi Sì...'
    & winget install --id OpenJS.NodeJS.LTS -e --silent --accept-source-agreements --accept-package-agreements | Out-Host
    Refresh-Path
    if (-not (Has 'node')) {
        Fail 'Installazione di Node.js non riuscita. Installalo da https://nodejs.org (versione LTS) e rilancia INSTALLA.cmd.'
    }
    Ok ("Node.js installato (" + (& node -v) + ")")
}

# ---------------------------------------------------------------- 2. Claude Code
Step 2 'Claude Code'
$claudeExe = Join-Path $bin 'claude.exe'
if ((Test-Path $claudeExe) -or (Has 'claude')) {
    Ok 'Claude Code presente'
} else {
    Info 'Installo Claude Code (non mostra avanzamento, attendi)...'
    # In un processo separato: lo script ufficiale può chiudere la sessione in cui gira.
    & powershell -NoProfile -ExecutionPolicy Bypass -Command 'irm https://claude.ai/install.ps1 | iex' | Out-Host
    if (-not (Test-Path $claudeExe)) {
        Fail 'Installazione di Claude Code non riuscita. Controlla la connessione e rilancia INSTALLA.cmd.'
    }
    Ok 'Claude Code installato'
}
# Cartella di Claude Code nel PATH dell'utente (l'installer ufficiale a volte non la aggiunge)
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not $userPath) { $userPath = '' }
if (($userPath -split ';') -notcontains $bin) {
    [Environment]::SetEnvironmentVariable('Path', ($userPath.TrimEnd(';') + ';' + $bin).TrimStart(';'), 'User')
    Info 'Aggiunto Claude Code al PATH'
}
Refresh-Path
if (-not (Test-Path $claudeExe)) { $claudeExe = (Get-Command claude).Source }

# ---------------------------------------------------------------- 3. Copia dei file
Step 3 'File del widget'
# Versione precedente: il lanciatore dell'avvio automatico dice in che cartella era installata.
$startupVbs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\ClaudeUsageWidget.vbs'
$oldDir = $null
if (Test-Path $startupVbs) {
    $vbs = Get-Content $startupVbs -Raw
    if ($vbs -match 'CurrentDirectory = "([^"]+)"') { $oldDir = $Matches[1].TrimEnd('\') }
}
if ($oldDir -and ($oldDir -ne $dest.TrimEnd('\'))) {
    Info "Trovata una versione precedente in: $oldDir"
    Info 'Verrà sostituita da questa (avvio automatico e aggiornamenti passeranno alla nuova).'
} elseif ($oldDir) {
    Info 'Trovata una versione precedente nella stessa cartella: la aggiorno.'
    $oldDir = $null
}
# Chiude il widget se è già aperto (serve per sostituire i file)
for ($i = 0; $i -lt 5; $i++) {
    Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
}
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Get-ChildItem -Path $src -File | Copy-Item -Destination $dest -Force
Ok "Copiati in $dest"
if ($oldDir) {
    & node (Join-Path $dest 'migra.js') $oldDir | Out-Host
}

# ---------------------------------------------------------------- 4. Electron
Step 4 'Componenti del widget (la prima volta scarica circa 100 MB, qualche minuto)'
Push-Location $dest
try {
    & npm.cmd install --no-audit --no-fund --loglevel=error | Out-Host
    $electronExe = Join-Path $dest 'node_modules\electron\dist\electron.exe'
    if (-not (Test-Path $electronExe)) {
        Info 'Completo lo scaricamento di Electron...'
        & node (Join-Path $dest 'node_modules\electron\install.js') | Out-Host
    }
    if (-not (Test-Path $electronExe)) {
        Fail 'Electron non è stato scaricato. Controlla la connessione e rilancia INSTALLA.cmd.'
    }
    Ok 'Componenti installati'
} finally {
    Pop-Location
}

# ---------------------------------------------------------------- 5. Accesso a Claude
Step 5 'Accesso al tuo account Claude'
function Test-Login {
    # 'Continue': con PowerShell 5.1 un avviso su stderr non deve far sembrare fallito il controllo
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
    Ok 'Accesso già fatto'
} else {
    Info 'Si apre il browser: accedi con il tuo account Claude (abbonamento Pro o Max).'
    Info 'Quando il browser dice che hai finito, torna a questa finestra.'
    & $claudeExe auth login --claudeai
    if (-not (Test-Login)) {
        Fail 'Accesso non completato. Rilancia INSTALLA.cmd e completa l''accesso nel browser.'
    }
    Ok 'Accesso fatto'
}

# ---------------------------------------------------------------- 6. Automazioni
Step 6 'Avvio automatico, aggiornamento ogni 15 minuti e prima lettura dei dati'
Push-Location $dest
try {
    & node (Join-Path $dest 'automazione.js') installa | Out-Host
    if ($LASTEXITCODE -ne 0) { Fail 'Attivazione delle automazioni non riuscita (vedi messaggio sopra).' }
} finally {
    Pop-Location
}

# Versione precedente ormai sostituita: si può cancellare la sua cartella
if ($oldDir -and (Test-Path $oldDir)) {
    $isWidget = (Test-Path (Join-Path $oldDir 'main.js')) -and (Test-Path (Join-Path $oldDir 'aggiorna.js'))
    Write-Host ''
    Ok 'La versione precedente è stata sostituita: ora parte e si aggiorna quella nuova.'
    if ($isWidget) {
        $ans = Read-Host "      Vuoi cancellare la vecchia cartella $oldDir ? (S/N)"
        if ($ans -match '^[sSyY]') {
            Remove-Item $oldDir -Recurse -Force -ErrorAction SilentlyContinue
            if (Test-Path $oldDir) { Info 'Non sono riuscito a cancellarla del tutto: puoi farlo a mano.' }
            else { Ok 'Vecchia cartella cancellata.' }
        } else {
            Info 'Lasciata dove si trova: non viene più usata, puoi cancellarla quando vuoi.'
        }
    }
}

Write-Host ''
Write-Host '=============================================' -ForegroundColor Green
Write-Host '   Fatto! Il widget è sullo schermo.' -ForegroundColor Green
Write-Host '=============================================' -ForegroundColor Green
Write-Host ''
Write-Host '  - Parte da solo a ogni accensione del PC.'
Write-Host '  - Trascinalo dove vuoi; doppio clic per cambiare stile.'
Write-Host '  - Tasto destro: Aggiorna ora, barra di Windows, opacità, Esci.'
Write-Host "  - Installato in: $dest"
Write-Host '  - Per toglierlo: DISINSTALLA.cmd'
Write-Host ''
Read-Host 'Premi Invio per chiudere'
