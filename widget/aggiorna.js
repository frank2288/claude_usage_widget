#!/usr/bin/env node
// Aggiornatore silenzioso dei dati di utilizzo.
//
// Fa UNA chiamata minima a Claude Code in modalità automatica (claude -p) e
// legge le percentuali di sessione e settimana dall'evento "rate_limit_event",
// che Claude Code emette a ogni risposta. Le salva nello stesso file che
// legge il widget (~/.claude/usage-widget.json).
//
// Le percentuali sono quelle dell'account, quindi includono anche l'uso da
// claude.ai e dall'app. Ogni chiamata consuma pochissimo (modello Haiku,
// niente strumenti).
//
//   node aggiorna.js           una passata, silenziosa
//   node aggiorna.js --prova   una passata con spiegazione di cosa succede

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DATA = process.env.CLAUDE_USAGE_FILE || path.join(os.homedir(), '.claude', 'usage-widget.json');
const LOG = path.join(path.dirname(DATA), 'usage-widget-refresh.log');
const WORKDIR = path.join(os.tmpdir(), 'claude-usage-widget-refresh');
const TIMEOUT_MS = 90000;
const VERBOSE = process.argv.includes('--prova');

const say = (s = '') => {
  if (VERBOSE) console.log(s);
};

function claudeBinary() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const name = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const p = path.join(os.homedir(), '.local', 'bin', name);
  return fs.existsSync(p) ? p : 'claude';
}

// utilization è una frazione da 0 a 1 (0.24 = 24%): Claude Code stesso la
// converte con round(x * 1000) / 10 per la sua barra di stato.
function convertWindow(w) {
  if (!w || !Number.isFinite(w.utilization) || !Number.isFinite(w.resetsAt)) return null;
  return {
    used_percentage: Math.max(0, Math.min(100, Math.round(w.utilization * 1000) / 10)),
    resets_at: w.resetsAt,
  };
}

function parseOutput(text) {
  let windows = null;
  let result = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch (_) {
      continue;
    }
    if (j.type === 'rate_limit_event' && j.rate_limit_info && j.rate_limit_info.unifiedWindows) {
      const uw = j.rate_limit_info.unifiedWindows;
      const five = convertWindow(uw.five_hour);
      const seven = convertWindow(uw.seven_day);
      if (five || seven) windows = { five_hour: five, seven_day: seven };
    } else if (j.type === 'result') {
      result = { isError: !!j.is_error, text: String(j.result || '').slice(0, 200) };
    }
  }
  return { windows, result };
}

// Usa SEMPRE e solo il modello più leggero (Haiku): nessun ripiego su modelli più pesanti.
function runClaude() {
  return new Promise((resolve) => {
    try {
      fs.mkdirSync(WORKDIR, { recursive: true });
    } catch (_) {
      /* proseguiamo comunque */
    }
    const args = ['-p', 'ok', '--model', 'haiku'];
    args.push(
      '--tools', '',
      '--disable-slash-commands',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--max-turns', '1',
      '--system-prompt', 'ok',
      '--output-format', 'stream-json',
      '--verbose'
    );

    // Se nell'ambiente c'è una chiave API, Claude Code la userebbe fatturando a
    // consumo: la togliamo, così si usa solo l'accesso con l'account.
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;

    let out = '';
    let err = '';
    let finished = false;
    const finish = (r) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(r);
    };

    let child;
    try {
      child = spawn(claudeBinary(), args, { cwd: WORKDIR, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      return finish({ error: `impossibile avviare Claude Code: ${e.message}` });
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch (_) {
        /* già terminato */
      }
      finish({ error: 'Claude Code non ha risposto entro 90 secondi' });
    }, TIMEOUT_MS);

    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.on('error', (e) =>
      finish({
        error:
          e.code === 'ENOENT'
            ? 'comando "claude" non trovato (installa Claude Code oppure imposta CLAUDE_BIN)'
            : `errore di avvio: ${e.message}`,
      })
    );
    child.on('close', (code) => finish({ out, err, code }));
  });
}

// Un dato vecchio si tiene solo se la sua finestra non è ancora scaduta:
// dopo il reset non deve restare in giro un valore che non vale più.
function stillValid(w) {
  if (!w || typeof w.resets_at !== 'number') return null;
  const ms = w.resets_at > 1e12 ? w.resets_at : w.resets_at * 1000;
  return ms > Date.now() ? w : null;
}

function saveData(windows) {
  let previous = {};
  try {
    previous = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  } catch (_) {
    /* primo salvataggio */
  }
  const data = {
    updated: Date.now(),
    five_hour: windows.five_hour || stillValid(previous.five_hour),
    seven_day: windows.seven_day || stillValid(previous.seven_day),
  };
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  const tmp = DATA + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, DATA);
  return data;
}

function writeLog(line) {
  try {
    let lines = [];
    try {
      lines = fs.readFileSync(LOG, 'utf8').split(/\r?\n/).filter(Boolean);
    } catch (_) {
      /* primo log */
    }
    lines.push(`${new Date().toISOString()} ${line}`);
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.writeFileSync(LOG, lines.slice(-30).join('\n') + '\n');
  } catch (_) {
    /* non critico */
  }
}

async function refresh() {
  say(`Eseguo Claude Code (${claudeBinary()}) con una richiesta minima...`);
  const attempt = await runClaude();
  const parsed = attempt.out ? parseOutput(attempt.out) : { windows: null, result: null };

  if (attempt.error) {
    writeLog(`ERRORE ${attempt.error}`);
    return { ok: false, reason: attempt.error };
  }
  if (!parsed.windows) {
    let reason = 'Claude Code non ha restituito le percentuali';
    if (parsed.result && parsed.result.isError) reason += ` (risposta: ${parsed.result.text})`;
    else if (attempt.err && attempt.err.trim()) reason += ` (${attempt.err.trim().split(/\r?\n/)[0].slice(0, 160)})`;
    reason += '. Succede se non hai fatto l\'accesso con l\'account, se il piano non è Pro/Max o se il modello Haiku non è disponibile.';
    writeLog(`ERRORE ${reason}`);
    return { ok: false, reason };
  }

  const data = saveData(parsed.windows);
  const f = data.five_hour && data.five_hour.used_percentage;
  const w = data.seven_day && data.seven_day.used_percentage;
  writeLog(`OK sessione ${f ?? '-'}% settimana ${w ?? '-'}%`);
  return { ok: true, data };
}

module.exports = { refresh, parseOutput, convertWindow };

if (require.main === module) {
  refresh().then((r) => {
    if (VERBOSE) {
      console.log();
      if (r.ok) {
        const d = r.data;
        console.log('✓ Fatto. Percentuali lette dall\'account:');
        console.log(`  sessione:  ${d.five_hour ? d.five_hour.used_percentage + '%' : '—'}`);
        console.log(`  settimana: ${d.seven_day ? d.seven_day.used_percentage + '%' : '—'}`);
        console.log(`  salvate in ${DATA}`);
      } else {
        console.log(`✗ Non riuscito: ${r.reason}`);
      }
    }
    process.exit(r.ok ? 0 : 1);
  });
}
