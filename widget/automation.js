#!/usr/bin/env node
// Windows automations: start the widget when you sign in, and refresh the
// usage periodically, with no visible windows.
//
//   node automation.js install [minutes]   turn everything on (default: every 15 minutes)
//   node automation.js remove              turn everything off
//   node automation.js status              show what is active
//
// It creates two things, both removable:
//   1. a launcher in the Windows "Startup" folder that starts the widget
//   2. a scheduled task "ClaudeUsageWidget-Refresh" that runs refresh.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const WIDGET_DIR = __dirname;
const TASK_NAME = 'ClaudeUsageWidget-Refresh';
// Names used by earlier versions: removed on install so nothing runs twice.
const LEGACY_TASK_NAMES = ['ClaudeUsageWidget-Aggiorna'];
const LEGACY_FILES = ['aggiorna-nascosto.vbs'];
const DEFAULT_MINUTES = 15;
const MIN_MINUTES = 10;
const MAX_MINUTES = 240;

const log = (s = '') => console.log(s);

function startupFolder() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}
const startupFile = () => path.join(startupFolder(), 'ClaudeUsageWidget.vbs');
const refreshVbs = () => path.join(WIDGET_DIR, 'refresh-hidden.vbs');
const electronExe = () => path.join(WIDGET_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');

// ---- file builders (pure functions, testable without Windows) ----

const vbsQuote = (s) => s.replace(/"/g, '""');

function buildStartupVbs(widgetDir, electronPath) {
  return [
    "' Starts Claude Usage Widget when you sign in to Windows (created by automation.js).",
    'Set sh = CreateObject("WScript.Shell")',
    `sh.CurrentDirectory = "${vbsQuote(widgetDir)}"`,
    `sh.Run """${vbsQuote(electronPath)}"" ""${vbsQuote(widgetDir)}""", 1, False`,
    '',
  ].join('\r\n');
}

function buildRefreshVbs(nodePath, scriptPath) {
  return [
    "' Runs refresh.js without showing any window (created by automation.js).",
    'Set sh = CreateObject("WScript.Shell")',
    `sh.Run """${vbsQuote(nodePath)}"" ""${vbsQuote(scriptPath)}""", 0, True`,
    '',
  ].join('\r\n');
}

const xmlEscape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Local time as Task Scheduler wants it: 2026-11-10T11:20:00
function localStamp(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

// Two triggers:
//  - a time trigger that starts one minute after install and repeats forever:
//    the refresh works right away, with no need to sign out or restart;
//  - one extra run a minute after each sign-in, for fresh data at startup.
// (A sign-in trigger with repetition alone would only start at the NEXT sign-in.)
function buildTaskXml(minutes, user, vbsPath, startAt = new Date(Date.now() + 60 * 1000)) {
  const u = xmlEscape(user);
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Refreshes the Claude usage percentages for the desktop widget.</Description>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <Repetition>
        <Interval>PT${minutes}M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>${localStamp(startAt)}</StartBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
    <LogonTrigger>
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

// The .vbs files and the Windows task XML are written as UTF-16 with BOM, so they
// also work with user names or folders containing accented letters.
const utf16 = (text) => Buffer.from('\uFEFF' + text, 'utf16le');

// ---- operations ----

function requireWindows() {
  if (process.platform !== 'win32') {
    log('These automations are for Windows.');
    log('On macOS/Linux use your system\'s login items and cron instead.');
    process.exit(1);
  }
}

function schtasks(args) {
  return spawnSync('schtasks', args, { encoding: 'utf8', windowsHide: true });
}

function removeLegacy() {
  for (const name of LEGACY_TASK_NAMES) schtasks(['/Delete', '/TN', name, '/F']);
  for (const f of LEGACY_FILES) {
    try {
      fs.unlinkSync(path.join(WIDGET_DIR, f));
    } catch (_) {
      /* not there */
    }
  }
}

function parseMinutes(arg) {
  if (arg === undefined) return DEFAULT_MINUTES;
  const n = Number(arg);
  if (!Number.isInteger(n) || n < MIN_MINUTES || n > MAX_MINUTES) {
    log(`Minutes must be a whole number between ${MIN_MINUTES} and ${MAX_MINUTES}.`);
    process.exit(1);
  }
  return n;
}

async function install(minutesArg) {
  requireWindows();
  const minutes = parseMinutes(minutesArg);
  log('=== Turning on automations ===\n');

  if (!fs.existsSync(electronExe())) {
    log('The widget is not installed yet (Electron is missing).');
    log('Run INSTALL.cmd first, then try again.');
    process.exit(1);
  }

  removeLegacy();

  // 1) Start the widget at sign-in
  fs.mkdirSync(startupFolder(), { recursive: true });
  fs.writeFileSync(startupFile(), utf16(buildStartupVbs(WIDGET_DIR, electronExe())));
  log('✓ The widget will start automatically when you sign in to Windows.');

  // 2) Periodic refresh
  fs.writeFileSync(refreshVbs(), utf16(buildRefreshVbs(process.execPath, path.join(WIDGET_DIR, 'refresh.js'))));
  const user = `${process.env.USERDOMAIN || os.hostname()}\\${process.env.USERNAME || os.userInfo().username}`;
  const xmlPath = path.join(os.tmpdir(), 'claude-usage-widget-task.xml');
  fs.writeFileSync(xmlPath, utf16(buildTaskXml(minutes, user, refreshVbs())));
  const r = schtasks(['/Create', '/TN', TASK_NAME, '/XML', xmlPath, '/F']);
  try {
    fs.unlinkSync(xmlPath);
  } catch (_) {
    /* not critical */
  }
  if (r.status !== 0) {
    log(`✗ Could not create the scheduled task:\n  ${(r.stderr || r.stdout || '').trim()}`);
    process.exit(1);
  }
  log(`✓ Usage will refresh every ${minutes} minutes, with no visible windows.`);

  // 3) First test right away
  log('\nTesting a refresh now (it can take a few tens of seconds)...');
  const { refresh } = require('./refresh.js');
  const res = await refresh();
  if (res.ok) {
    const d = res.data;
    log(`✓ It works. Session ${d.five_hour ? d.five_hour.used_percentage + '%' : '—'}, ` +
        `week ${d.seven_day ? d.seven_day.used_percentage + '%' : '—'}.`);
  } else {
    log(`✗ The test failed: ${res.reason}`);
    log('  The automations are on anyway; data will not refresh until the test works.');
  }

  // 4) Start the widget now, unless it is already running (a second copy quits by itself)
  spawnSync('wscript.exe', ['//B', '//Nologo', startupFile()], { windowsHide: true });

  log('\nTo remove everything:  node automation.js remove');
  log('If you move the widget folder, run  node automation.js install  again');
}

function remove() {
  requireWindows();
  log('=== Removing automations ===\n');
  for (const f of [startupFile(), refreshVbs()]) {
    try {
      fs.unlinkSync(f);
      log(`✓ Removed ${f}`);
    } catch (_) {
      /* not there */
    }
  }
  const r = schtasks(['/Delete', '/TN', TASK_NAME, '/F']);
  removeLegacy();
  log(r.status === 0 ? '✓ Scheduled task removed.' : '• No scheduled task to remove.');
  log('\nA running widget stays open until you close it (right-click → Quit).');
}

function status() {
  requireWindows();
  log('=== Automation status ===\n');
  log(fs.existsSync(startupFile()) ? '✓ Widget autostart: on' : '✗ Widget autostart: off');

  const q = schtasks(['/Query', '/TN', TASK_NAME, '/FO', 'LIST']);
  log(q.status === 0 ? '✓ Periodic refresh: on' : '✗ Periodic refresh: off');
  if (q.status === 0) log((q.stdout || '').split(/\r?\n/).filter((l) => l.trim()).map((l) => '    ' + l).join('\n'));

  const logFile = path.join(os.homedir(), '.claude', 'usage-widget-refresh.log');
  try {
    const lines = fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter(Boolean);
    log('\nLatest refreshes (UTC):');
    for (const l of lines.slice(-5)) log('  ' + l);
  } catch (_) {
    log('\nNo refresh recorded yet.');
  }
}

// Writes the files that would be created into a folder, without turning anything on.
function preview(dir) {
  const out = dir || path.join(os.tmpdir(), 'claude-usage-widget-preview');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'startup.vbs'), utf16(buildStartupVbs('C:\\Test Path\\widget', 'C:\\Test Path\\widget\\node_modules\\electron\\dist\\electron.exe')));
  fs.writeFileSync(path.join(out, 'refresh-hidden.vbs'), utf16(buildRefreshVbs('C:\\Program Files\\nodejs\\node.exe', 'C:\\Test Path\\widget\\refresh.js')));
  fs.writeFileSync(path.join(out, 'task.xml'), utf16(buildTaskXml(30, 'TEST-PC\\jane', 'C:\\Test Path\\widget\\refresh-hidden.vbs')));
  log(`Preview files written to ${out}`);
}

module.exports = { buildStartupVbs, buildRefreshVbs, buildTaskXml };

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  // Italian command names from earlier versions are still accepted.
  if (cmd === 'install' || cmd === 'installa') install(arg);
  else if (cmd === 'remove' || cmd === 'rimuovi') remove();
  else if (cmd === 'status' || cmd === 'stato') status();
  else if (cmd === 'preview') preview(arg);
  else {
    log('Usage:');
    log('  node automation.js install [minutes]   turn on autostart and periodic refresh (default 15)');
    log('  node automation.js remove              turn everything off');
    log('  node automation.js status              show what is active');
  }
}
