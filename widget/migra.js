#!/usr/bin/env node
// Usato dall'installatore quando trova una versione precedente del widget in
// un'altra cartella: sposta sulla nuova cartella i riferimenti che puntavano alla vecchia.
//
//   node migra.js "C:\percorso\vecchia\cartella"

const fs = require('fs');
const os = require('os');
const path = require('path');

const oldDir = process.argv[2] || '';
const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const writer = path.join(__dirname, 'statusline-writer.js').replace(/\\/g, '/');

// 1) Status line di Claude Code (se era stata collegata alla versione vecchia)
try {
  const text = fs.readFileSync(SETTINGS, 'utf8').replace(/^\uFEFF/, '');
  const j = JSON.parse(text);
  const cmd = j && j.statusLine && j.statusLine.command;
  if (typeof cmd === 'string' && cmd.includes('statusline-writer.js') && !cmd.includes(writer)) {
    fs.copyFileSync(SETTINGS, SETTINGS + '.bak-widget-migrazione');
    j.statusLine.command = `node "${writer}"`;
    fs.writeFileSync(SETTINGS, JSON.stringify(j, null, 2) + '\n');
    console.log('  Status line di Claude Code collegata alla nuova cartella.');
  }
} catch (_) {
  /* nessuna impostazione di Claude Code da aggiornare */
}

// 2) Eventuale status line personale conservata dalla versione vecchia
if (oldDir) {
  const from = path.join(oldDir, 'statusline-wrap.txt');
  const to = path.join(__dirname, 'statusline-wrap.txt');
  try {
    if (fs.existsSync(from) && !fs.existsSync(to)) {
      fs.copyFileSync(from, to);
      console.log('  Conservata la tua status line personale.');
    }
  } catch (_) {
    /* non critico */
  }
}
