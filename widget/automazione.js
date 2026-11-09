#!/usr/bin/env node
// Automazioni per Windows: avvio del widget all'accensione del PC e
// aggiornamento periodico delle percentuali, senza finestre visibili.
//
//   node automazione.js installa [minuti]   attiva tutto (default: ogni 15 minuti)
//   node automazione.js rimuovi             disattiva tutto
//   node automazione.js stato               mostra cosa è attivo
//
// Crea due cose, entrambe rimovibili:
//   1. un file nella cartella "Esecuzione automatica" di Windows, che avvia il widget
//   2. un'attività pianificata "ClaudeUsageWidget-Aggiorna" che lancia aggiorna.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const WIDGET_DIR = __dirname;
const TASK_NAME = 'ClaudeUsageWidget-Aggiorna';
const DEFAULT_MINUTES = 15;
const MIN_MINUTES = 10;
const MAX_MINUTES = 240;

const log = (s = '') => console.log(s);

function startupFolder() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}
const startupFile = () => path.join(startupFolder(), 'ClaudeUsageWidget.vbs');
const refreshVbs = () => path.join(WIDGET_DIR, 'aggiorna-nascosto.vbs');
const electronExe = () => path.join(WIDGET_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');

// ---- generatori di file (funzioni pure, verificabili senza Windows) ----

const vbsQuote = (s) => s.replace(/"/g, '""');

function buildStartupVbs(widgetDir, electronPath) {
  return [
    "' Avvia Claude Usage Widget all'accesso a Windows (creato da automazione.js).",
    'Set sh = CreateObject("WScript.Shell")',
    `sh.CurrentDirectory = "${vbsQuote(widgetDir)}"`,
    `sh.Run """${vbsQuote(electronPath)}"" ""${vbsQuote(widgetDir)}""", 1, False`,
    '',
  ].join('\r\n');
}

function buildRefreshVbs(nodePath, scriptPath) {
  return [
    "' Lancia aggiorna.js senza mostrare finestre (creato da automazione.js).",
    'Set sh = CreateObject("WScript.Shell")',
    `sh.Run """${vbsQuote(nodePath)}"" ""${vbsQuote(scriptPath)}""", 0, True`,
    '',
  ].join('\r\n');
}

const xmlEscape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function buildTaskXml(minutes, user, vbsPath) {
  const u = xmlEscape(user);
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Aggiorna le percentuali di utilizzo di Claude per il widget da desktop.</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Repetition>
        <Interval>PT${minutes}M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <Enabled>true</Enabled>
      <UserId>${u}</UserId>
      <Delay>PT1M</Delay>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${u}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT3M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>wscript.exe</Command>
      <Arguments>//B //Nologo "${xmlEscape(vbsPath)}"</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

// I file .vbs e il file XML di Windows vanno scritti in UTF-16 con BOM, così
// funzionano anche con nomi utente o cartelle con lettere accentate.
const utf16 = (text) => Buffer.from('\uFEFF' + text, 'utf16le');

// ---- operazioni ----

function requireWindows() {
  if (process.platform !== 'win32') {
    log('Queste automazioni sono pensate per Windows.');
    log('Su macOS/Linux usa invece l\'avvio automatico del sistema e cron.');
    process.exit(1);
  }
}

function schtasks(args) {
  return spawnSync('schtasks', args, { encoding: 'utf8', windowsHide: true });
}

function parseMinutes(arg) {
  if (arg === undefined) return DEFAULT_MINUTES;
  const n = Number(arg);
  if (!Number.isInteger(n) || n < MIN_MINUTES || n > MAX_MINUTES) {
    log(`I minuti devono essere un numero intero tra ${MIN_MINUTES} e ${MAX_MINUTES}.`);
    process.exit(1);
  }
  return n;
}

async function install(minutesArg) {
  requireWindows();
  const minutes = parseMinutes(minutesArg);
  log('=== Attivazione delle automazioni ===\n');

  if (!fs.existsSync(electronExe())) {
    log('Il widget non è ancora installato (manca Electron).');
    log('Lancia prima  node setup.js  e poi riprova.');
    process.exit(1);
  }

  // 1) Avvio del widget all'accesso
  fs.mkdirSync(startupFolder(), { recursive: true });
  fs.writeFileSync(startupFile(), utf16(buildStartupVbs(WIDGET_DIR, electronExe())));
  log('✓ Il widget partirà da solo quando accedi a Windows.');

  // 2) Aggiornamento periodico
  fs.writeFileSync(refreshVbs(), utf16(buildRefreshVbs(process.execPath, path.join(WIDGET_DIR, 'aggiorna.js'))));
  const user = `${process.env.USERDOMAIN || os.hostname()}\\${process.env.USERNAME || os.userInfo().username}`;
  const xmlPath = path.join(os.tmpdir(), 'claude-usage-widget-task.xml');
  fs.writeFileSync(xmlPath, utf16(buildTaskXml(minutes, user, refreshVbs())));
  const r = schtasks(['/Create', '/TN', TASK_NAME, '/XML', xmlPath, '/F']);
  try {
    fs.unlinkSync(xmlPath);
  } catch (_) {
    /* non critico */
  }
  if (r.status !== 0) {
    log(`✗ Non sono riuscito a creare l'attività pianificata:\n  ${(r.stderr || r.stdout || '').trim()}`);
    process.exit(1);
  }
  log(`✓ Le percentuali verranno aggiornate ogni ${minutes} minuti, senza finestre visibili.`);

  // 3) Prima prova subito
  log('\nProvo subito un aggiornamento (può volerci qualche decina di secondi)...');
  const { refresh } = require('./aggiorna.js');
  const res = await refresh();
  if (res.ok) {
    const d = res.data;
    log(`✓ Funziona. Sessione ${d.five_hour ? d.five_hour.used_percentage + '%' : '—'}, ` +
        `settimana ${d.seven_day ? d.seven_day.used_percentage + '%' : '—'}.`);
  } else {
    log(`✗ La prova non è riuscita: ${res.reason}`);
    log('  Le automazioni sono comunque attive; finché la prova non funziona i dati non si aggiorneranno.');
  }

  // 4) Avvia il widget adesso, se non è già in esecuzione (la seconda copia si chiude da sola)
  spawnSync('wscript.exe', ['//B', '//Nologo', startupFile()], { windowsHide: true });

  log('\nPer togliere tutto:  node automazione.js rimuovi');
  log('Se sposti la cartella del widget, rilancia  node automazione.js installa');
}

function remove() {
  requireWindows();
  log('=== Rimozione delle automazioni ===\n');
  for (const f of [startupFile(), refreshVbs()]) {
    try {
      fs.unlinkSync(f);
      log(`✓ Rimosso ${f}`);
    } catch (_) {
      /* non c'era */
    }
  }
  const r = schtasks(['/Delete', '/TN', TASK_NAME, '/F']);
  log(r.status === 0 ? '✓ Attività pianificata rimossa.' : '• Nessuna attività pianificata da rimuovere.');
  log('\nIl widget in esecuzione resta aperto fino a quando lo chiudi (tasto destro → Esci).');
}

function status() {
  requireWindows();
  log('=== Stato delle automazioni ===\n');
  log(fs.existsSync(startupFile()) ? '✓ Avvio automatico del widget: attivo' : '✗ Avvio automatico del widget: non attivo');

  const q = schtasks(['/Query', '/TN', TASK_NAME, '/FO', 'LIST']);
  log(q.status === 0 ? '✓ Aggiornamento periodico: attivo' : '✗ Aggiornamento periodico: non attivo');
  if (q.status === 0) log((q.stdout || '').split(/\r?\n/).filter((l) => l.trim()).map((l) => '    ' + l).join('\n'));

  const logFile = path.join(os.homedir(), '.claude', 'usage-widget-refresh.log');
  try {
    const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter(Boolean);
    log('\nUltimi aggiornamenti:');
    for (const l of lines.slice(-5)) log('  ' + l);
  } catch (_) {
    log('\nNessun aggiornamento registrato finora.');
  }
}

// Scrive i file che verrebbero creati in una cartella, senza attivare nulla.
function preview(dir) {
  const out = dir || path.join(os.tmpdir(), 'claude-usage-widget-anteprima');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'avvio.vbs'), utf16(buildStartupVbs('C:\\Percorso Di Prova\\widget', 'C:\\Percorso Di Prova\\widget\\node_modules\\electron\\dist\\electron.exe')));
  fs.writeFileSync(path.join(out, 'aggiorna-nascosto.vbs'), utf16(buildRefreshVbs('C:\\Program Files\\nodejs\\node.exe', 'C:\\Percorso Di Prova\\widget\\aggiorna.js')));
  fs.writeFileSync(path.join(out, 'attivita.xml'), utf16(buildTaskXml(30, 'PC-DI-PROVA\\mario', 'C:\\Percorso Di Prova\\widget\\aggiorna-nascosto.vbs')));
  log(`File di anteprima scritti in ${out}`);
}

module.exports = { buildStartupVbs, buildRefreshVbs, buildTaskXml };

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'installa') install(arg);
  else if (cmd === 'rimuovi') remove();
  else if (cmd === 'stato') status();
  else if (cmd === 'anteprima') preview(arg);
  else {
    log('Uso:');
    log('  node automazione.js installa [minuti]   attiva avvio automatico e aggiornamento (default 15)');
    log('  node automazione.js rimuovi             disattiva tutto');
    log('  node automazione.js stato               mostra cosa è attivo');
  }
}
