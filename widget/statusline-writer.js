#!/usr/bin/env node
// Script di status line per Claude Code.
// Legge dallo stdin il JSON che Claude Code gli passa, salva rate_limits
// (finestra di 5 ore e finestra di 7 giorni) in ~/.claude/usage-widget.json
// e stampa SEMPRE una breve riga di stato, così si vede se lo script gira.
//
// Se prima avevi già una status line, setup.js ne salva il comando in
// statusline-wrap.txt e questo script la esegue e ne mostra l'output.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const OUT = process.env.CLAUDE_USAGE_FILE || path.join(os.homedir(), '.claude', 'usage-widget.json');
const DEBUG = path.join(path.dirname(OUT), 'usage-widget-debug.json');
const WRAP_FILE = path.join(__dirname, 'statusline-wrap.txt');

function toEpochSeconds(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v > 1e12 ? Math.round(v / 1000) : v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.round(t / 1000);
}

function pick(win) {
  if (!win || typeof win.used_percentage !== 'number') return null;
  return { used_percentage: win.used_percentage, resets_at: toEpochSeconds(win.resets_at) };
}

function readWrapCommand() {
  try {
    const c = fs.readFileSync(WRAP_FILE, 'utf8').trim();
    return c || null;
  } catch (_) {
    return null;
  }
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let input = {};
  try {
    input = JSON.parse(raw);
  } catch (_) {
    /* input non valido */
  }

  const rl = (input && input.rate_limits) || {};
  const five = pick(rl.five_hour);
  const seven = pick(rl.seven_day);

  // Diagnosi: solo i NOMI dei campi ricevuti e il blocco rate_limits
  // (nessun percorso o testo delle conversazioni).
  try {
    fs.mkdirSync(path.dirname(DEBUG), { recursive: true });
    fs.writeFileSync(
      DEBUG,
      JSON.stringify(
        {
          time: new Date().toISOString(),
          fields_received: Object.keys(input || {}),
          rate_limits: input && input.rate_limits !== undefined ? input.rate_limits : '(campo assente)',
        },
        null,
        2
      )
    );
  } catch (_) {
    /* non critico */
  }

  // Il campo compare solo per gli abbonamenti Pro/Max, dopo la prima risposta
  // della sessione, e ogni finestra sparisce dopo il suo reset. Se manca non
  // sovrascriviamo l'ultimo dato valido.
  if (five || seven) {
    let previous = {};
    try {
      previous = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    } catch (_) {
      /* primo salvataggio */
    }
    const data = {
      updated: Date.now(),
      five_hour: five || previous.five_hour || null,
      seven_day: seven || previous.seven_day || null,
    };
    try {
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      const tmp = OUT + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, OUT);
    } catch (_) {
      /* non bloccare la status line per un errore di scrittura */
    }
  }

  const parts = [];
  if (five) parts.push(`Sessione ${Math.round(five.used_percentage)}%`);
  if (seven) parts.push(`Settimana ${Math.round(seven.used_percentage)}%`);
  const ours = parts.length
    ? parts.join(' · ')
    : 'Widget: collegato, in attesa delle percentuali (arrivano dopo la prima risposta)';

  const wrap = readWrapCommand();
  if (wrap) {
    const res = spawnSync(wrap, { input: raw, shell: true, encoding: 'utf8', timeout: 4000 });
    const theirs = (res.stdout || '').replace(/\s+$/, '');
    process.stdout.write(theirs || ours);
    return;
  }

  process.stdout.write(ours);
});
