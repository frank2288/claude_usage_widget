#!/usr/bin/env node
// OPTIONAL: hooks the widget into the Claude Code status line, so it also
// refreshes after every Claude Code response. Not needed for normal use:
// the installer's periodic refresh already keeps the widget up to date.
//
//   node statusline-setup.js           connect the status line
//   node statusline-setup.js --check   check the connection
//
// Edits only the "statusLine" entry of ~/.claude/settings.json, keeping every
// other setting, and saves a backup copy before writing.

const fs = require('fs');
const os = require('os');
const path = require('path');

const WIDGET_DIR = __dirname;
const CLAUDE_DIR = path.join(os.homedir(), '.claude');
const SETTINGS = path.join(CLAUDE_DIR, 'settings.json');
const DATA = path.join(CLAUDE_DIR, 'usage-widget.json');
const DEBUG = path.join(CLAUDE_DIR, 'usage-widget-debug.json');
const WRAP_FILE = path.join(WIDGET_DIR, 'statusline-wrap.txt');
const WRITER = path.join(WIDGET_DIR, 'statusline-writer.js').replace(/\\/g, '/');

const log = (s = '') => console.log(s);
const stripBom = (s) => s.replace(/^﻿/, '');

function ourCommand() {
  // Always quoted: works even if the path contains spaces.
  return `node "${WRITER}"`;
}

function readSettings() {
  if (!fs.existsSync(SETTINGS)) return { exists: false, data: {} };
  const text = stripBom(fs.readFileSync(SETTINGS, 'utf8'));
  if (text.trim() === '') return { exists: true, data: {} };
  try {
    const data = JSON.parse(text);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('not a JSON object');
    return { exists: true, data };
  } catch (e) {
    return { exists: true, error: e.message };
  }
}

function age(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 90) return `${s} seconds ago`;
  if (s < 5400) return `${Math.round(s / 60)} minutes ago`;
  return `${Math.round(s / 3600)} hours ago`;
}

function check() {
  log('=== Status line check ===\n');

  const st = readSettings();
  if (st.error) {
    log(`✗ settings.json is not readable (${st.error}). It was not modified.`);
  } else if (!st.exists) {
    log('✗ settings.json does not exist: run  node statusline-setup.js  first');
  } else {
    const cmd = st.data.statusLine && st.data.statusLine.command;
    if (cmd && cmd.includes('statusline-writer.js')) {
      log('✓ Claude Code is set to use the widget script.');
      log(`  command: ${cmd}`);
      const m = cmd.match(/"([^"]+statusline-writer\.js)"/) || cmd.match(/node\s+(\S+statusline-writer\.js)/);
      if (m && !fs.existsSync(m[1])) {
        log(`✗ ...but that file no longer exists: ${m[1]}`);
        log('  Did you move the folder? Run  node statusline-setup.js  again from the new one.');
      }
    } else {
      log('✗ The status line does NOT point to the widget script. Run  node statusline-setup.js');
    }
    if (st.data.disableAllHooks === true) {
      log('! settings.json contains "disableAllHooks": true, which turns the status line off.');
    }
  }

  log('');
  if (fs.existsSync(DEBUG)) {
    const stat = fs.statSync(DEBUG);
    log(`✓ The script was run by Claude Code (${age(stat.mtimeMs)}).`);
    try {
      const d = JSON.parse(fs.readFileSync(DEBUG, 'utf8'));
      if (d.rate_limits === '(missing)' || d.rate_limits === '(campo assente)') {
        log('✗ But Claude Code did NOT pass the percentages (rate_limits field missing).');
        log('  This happens if the account is not Pro/Max, or if there has been no response');
        log('  yet in this session. Send a message in Claude Code and run the check again.');
      } else {
        log('✓ Claude Code passed the percentages.');
      }
    } catch (_) {
      log('! The diagnostic file is not readable.');
    }
  } else {
    log('✗ The script has never been run by Claude Code.');
    log('  Check that: 1) you closed and reopened  claude  after the setup;');
    log('  2) you accepted "Do you trust this folder?" in Claude Code (until you do,');
    log('  the status line stays empty); 3) you sent a message.');
  }

  log('');
  if (fs.existsSync(DATA)) {
    try {
      const d = JSON.parse(fs.readFileSync(DATA, 'utf8'));
      const f = d.five_hour && Math.round(d.five_hour.used_percentage);
      const w = d.seven_day && Math.round(d.seven_day.used_percentage);
      log(`✓ Data saved (${age(d.updated)}): session ${f ?? '—'}%, week ${w ?? '—'}%.`);
    } catch (_) {
      log('! The data file exists but is not readable.');
    }
  } else {
    log('✗ No usage data saved yet.');
  }
}

function setup() {
  log('=== Connecting the Claude Code status line ===\n');

  const st = readSettings();
  if (st.error) {
    log(`Cannot read ${SETTINGS}:\n  ${st.error}\n`);
    log('To be safe it was not modified. Open it and check that it is valid JSON.');
    process.exit(1);
  }

  const settings = st.data;
  const current = settings.statusLine;
  const alreadyOurs = current && typeof current.command === 'string' && current.command.includes('statusline-writer.js');

  // If you already had a status line, keep it: our script runs it and shows its output.
  if (current && !alreadyOurs && current.type === 'command' && typeof current.command === 'string') {
    fs.writeFileSync(WRAP_FILE, current.command);
    log('• You already had a status line: it is kept and will keep showing.');
  } else if (!alreadyOurs && fs.existsSync(WRAP_FILE)) {
    fs.unlinkSync(WRAP_FILE);
  }
  if (alreadyOurs) log('• The status line was already connected: updating the path only.');

  settings.statusLine = { type: 'command', command: ourCommand() };

  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  if (st.exists) {
    const bak = `${SETTINGS}.bak-widget`;
    if (!fs.existsSync(bak)) fs.copyFileSync(SETTINGS, bak);
    log(`• Backup: ${bak}`);
  }
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
  log(`• Written ${SETTINGS}`);

  log('\nDone. Restart Claude Code; after the next response the status line shows');
  log('"Session …% · Week …%" and the widget refreshes. To check:  node statusline-setup.js --check');
}

if (process.argv.includes('--check') || process.argv.includes('--verifica')) check();
else setup();
