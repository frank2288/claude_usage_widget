#!/usr/bin/env node
// Installatore del widget. Uso:
//   node setup.js             collega Claude Code e installa il widget
//   node setup.js --verifica  controlla a che punto è il collegamento
//
// Collega la status line in ~/.claude/settings.json SENZA toccare le altre
// impostazioni, e prima di scrivere salva una copia di sicurezza.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

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
  // Virgolette sempre presenti: funzionano anche se il percorso ha spazi.
  return `node "${WRITER}"`;
}

function readSettings() {
  if (!fs.existsSync(SETTINGS)) return { exists: false, data: {} };
  const text = stripBom(fs.readFileSync(SETTINGS, 'utf8'));
  if (text.trim() === '') return { exists: true, data: {} };
  try {
    const data = JSON.parse(text);
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('non è un oggetto');
    return { exists: true, data };
  } catch (e) {
    return { exists: true, error: e.message };
  }
}

function age(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 90) return `${s} secondi fa`;
  if (s < 5400) return `${Math.round(s / 60)} minuti fa`;
  return `${Math.round(s / 3600)} ore fa`;
}

function verify() {
  log('=== Verifica del collegamento ===\n');

  const st = readSettings();
  if (st.error) {
    log(`✗ settings.json non è leggibile (${st.error}). Non l'ho modificato.`);
  } else if (!st.exists) {
    log('✗ settings.json non esiste: lancia prima  node setup.js');
  } else {
    const cmd = st.data.statusLine && st.data.statusLine.command;
    if (cmd && cmd.includes('statusline-writer.js')) {
      log('✓ Claude Code è configurato per usare lo script del widget.');
      log(`  comando: ${cmd}`);
      const m = cmd.match(/"([^"]+statusline-writer\.js)"/) || cmd.match(/node\s+(\S+statusline-writer\.js)/);
      if (m && !fs.existsSync(m[1])) {
        log(`✗ ...ma quel file non esiste più: ${m[1]}`);
        log('  Hai spostato la cartella? Rilancia  node setup.js  da quella nuova.');
      }
    } else {
      log('✗ La status line NON punta allo script del widget. Lancia  node setup.js');
    }
    if (st.data.disableAllHooks === true) {
      log('! In settings.json c\'è "disableAllHooks": true, che spegne la status line.');
    }
  }

  log('');
  if (fs.existsSync(DEBUG)) {
    const stat = fs.statSync(DEBUG);
    log(`✓ Lo script è stato eseguito da Claude Code (${age(stat.mtimeMs)}).`);
    try {
      const d = JSON.parse(fs.readFileSync(DEBUG, 'utf8'));
      if (d.rate_limits === '(campo assente)') {
        log('✗ Ma Claude Code NON ha passato le percentuali (campo rate_limits assente).');
        log('  Succede se: l\'account non è Pro/Max, oppure se non c\'è ancora stata una risposta');
        log('  in questa sessione. Manda un messaggio in Claude Code e rilancia la verifica.');
      } else {
        log('✓ Claude Code ha passato le percentuali.');
      }
    } catch (_) {
      log('! Il file di diagnosi non è leggibile.');
    }
  } else {
    log('✗ Lo script non è mai stato eseguito da Claude Code.');
    log('  Controlla che: 1) tu abbia chiuso e riaperto  claude  dopo l\'installazione;');
    log('  2) in Claude Code tu abbia accettato "ti fidi di questa cartella?" (finché non');
    log('  accetti, la barra di stato resta vuota); 3) tu abbia mandato un messaggio.');
  }

  log('');
  if (fs.existsSync(DATA)) {
    try {
      const d = JSON.parse(fs.readFileSync(DATA, 'utf8'));
      const f = d.five_hour && Math.round(d.five_hour.used_percentage);
      const w = d.seven_day && Math.round(d.seven_day.used_percentage);
      log(`✓ Dati salvati (${age(d.updated)}): sessione ${f ?? '—'}%, settimana ${w ?? '—'}%.`);
      log('  Se gli anelli del widget restano vuoti, chiudi il widget e riavvialo con  npm start');
    } catch (_) {
      log('! Il file dei dati esiste ma non è leggibile.');
    }
  } else {
    log('✗ Nessun dato di utilizzo salvato ancora: gli anelli resteranno vuoti.');
  }
}

function install() {
  log('=== Installazione del widget ===\n');

  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) {
    log(`Serve Node.js 18 o successivo (hai la ${process.versions.node}). Aggiornalo da https://nodejs.org`);
    process.exit(1);
  }

  const st = readSettings();
  if (st.error) {
    log(`Non riesco a leggere ${SETTINGS}:\n  ${st.error}\n`);
    log('Per sicurezza non l\'ho modificato. Aprilo, controlla che sia un JSON valido');
    log('(virgole e graffe) oppure incollami il contenuto in chat.');
    process.exit(1);
  }

  const settings = st.data;
  const current = settings.statusLine;
  const alreadyOurs = current && typeof current.command === 'string' && current.command.includes('statusline-writer.js');

  // Se avevi già una status line tua, la conserviamo: la esegue il nostro script.
  if (current && !alreadyOurs && current.type === 'command' && typeof current.command === 'string') {
    fs.writeFileSync(WRAP_FILE, current.command);
    log('• Avevi già una status line: l\'ho conservata e continuerà a comparire.');
  } else if (!alreadyOurs && fs.existsSync(WRAP_FILE)) {
    fs.unlinkSync(WRAP_FILE);
  }

  if (alreadyOurs) {
    log('• La status line era già collegata: aggiorno solo il percorso.');
  }

  settings.statusLine = { type: 'command', command: ourCommand() };

  fs.mkdirSync(CLAUDE_DIR, { recursive: true });
  if (st.exists) {
    const bak = `${SETTINGS}.bak-widget`;
    if (!fs.existsSync(bak)) fs.copyFileSync(SETTINGS, bak);
    log(`• Copia di sicurezza: ${bak}`);
  }
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2) + '\n');
  log(`• Scritto ${SETTINGS}`);

  if (process.env.WIDGET_SKIP_NPM !== '1') {
    log('\n• Installo il widget (la prima volta scarica Electron: ci vuole qualche minuto)...\n');
    const r = spawnSync('npm', ['install'], {
      cwd: WIDGET_DIR,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (r.status !== 0) {
      log('\n✗ npm install non è riuscito. Controlla la connessione e rilancia  node setup.js');
      process.exit(1);
    }
  }

  log('\n=== Fatto. Ora: ===');
  log('1. Chiudi Claude Code se è aperto e riaprilo con  claude');
  log('2. Se chiede "ti fidi di questa cartella?" rispondi di sì');
  log('3. Manda un messaggio qualsiasi e aspetta la risposta');
  log('   (in basso deve comparire "Sessione …% · Settimana …%")');
  log('4. In un\'altra finestra, nella cartella del widget:  npm start');
  log('5. Se qualcosa non va:  node setup.js --verifica');
}

if (process.argv.includes('--verifica')) verify();
else install();
