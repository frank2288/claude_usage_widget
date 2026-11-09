#!/usr/bin/env node
// Silent usage refresher.
//
// Makes ONE minimal call to Claude Code in non-interactive mode (claude -p) and
// reads the session and weekly percentages from the "rate_limit_event" that
// Claude Code emits with every response. Saves them to the same file the
// widget reads (~/.claude/usage-widget.json).
//
// The percentages belong to the account, so they include usage from
// claude.ai and the apps too. Each call costs very little (Haiku model,
// no tools).
//
//   node refresh.js          one silent pass
//   node refresh.js --test   one pass explaining what happens

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DATA = process.env.CLAUDE_USAGE_FILE || path.join(os.homedir(), '.claude', 'usage-widget.json');
const LOG = path.join(path.dirname(DATA), 'usage-widget-refresh.log');
const WORKDIR = path.join(os.tmpdir(), 'claude-usage-widget-refresh');
const TIMEOUT_MS = 90000;
const VERBOSE = process.argv.includes('--test') || process.argv.includes('--prova');

const say = (s = '') => {
  if (VERBOSE) console.log(s);
};

function claudeBinary() {
  if (process.env.CLAUDE_BIN) return process.env.CLAUDE_BIN;
  const name = process.platform === 'win32' ? 'claude.exe' : 'claude';
  const p = path.join(os.homedir(), '.local', 'bin', name);
  return fs.existsSync(p) ? p : 'claude';
}

// utilization is a fraction from 0 to 1 (0.24 = 24%): Claude Code itself
// converts it with round(x * 1000) / 10 for its status line.
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

// ALWAYS and only the lightest model (Haiku): no fallback to heavier models.
function runClaude() {
  return new Promise((resolve) => {
    try {
      fs.mkdirSync(WORKDIR, { recursive: true });
    } catch (_) {
      /* carry on anyway */
    }
    const args = [
      '-p', 'ok',
      '--model', 'haiku',
      '--tools', '',
      '--disable-slash-commands',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--max-turns', '1',
      '--system-prompt', 'ok',
      '--output-format', 'stream-json',
      '--verbose',
    ];

    // If an API key is set in the environment, Claude Code would use it and bill
    // per token: remove it, so only the account login is used.
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
      return finish({ error: `cannot start Claude Code: ${e.message}` });
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch (_) {
        /* already gone */
      }
      finish({ error: 'Claude Code did not answer within 90 seconds' });
    }, TIMEOUT_MS);

    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.on('error', (e) =>
      finish({
        error:
          e.code === 'ENOENT'
            ? '"claude" command not found (install Claude Code or set CLAUDE_BIN)'
            : `startup error: ${e.message}`,
      })
    );
    child.on('close', (code) => finish({ out, err, code }));
  });
}

// An old value is kept only while its window has not expired yet:
// after a reset a stale value must not linger.
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
    /* first save */
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
      /* first entry */
    }
    lines.push(`${new Date().toISOString()} ${line}`);
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.writeFileSync(LOG, lines.slice(-30).join('\n') + '\n');
  } catch (_) {
    /* not critical */
  }
}

async function refresh() {
  say(`Running Claude Code (${claudeBinary()}) with a minimal request...`);
  const attempt = await runClaude();
  const parsed = attempt.out ? parseOutput(attempt.out) : { windows: null, result: null };

  if (attempt.error) {
    writeLog(`ERROR ${attempt.error}`);
    return { ok: false, reason: attempt.error };
  }
  if (!parsed.windows) {
    let reason = 'Claude Code did not return the usage percentages';
    if (parsed.result && parsed.result.isError) reason += ` (response: ${parsed.result.text})`;
    else if (attempt.err && attempt.err.trim()) reason += ` (${attempt.err.trim().split(/\r?\n/)[0].slice(0, 160)})`;
    reason += '. This happens if you are not signed in with your account, your plan is not Pro/Max, or the Haiku model is unavailable.';
    writeLog(`ERROR ${reason}`);
    return { ok: false, reason };
  }

  const data = saveData(parsed.windows);
  const f = data.five_hour && data.five_hour.used_percentage;
  const w = data.seven_day && data.seven_day.used_percentage;
  writeLog(`OK session ${f ?? '-'}% week ${w ?? '-'}%`);
  return { ok: true, data };
}

module.exports = { refresh, parseOutput, convertWindow };

if (require.main === module) {
  refresh().then((r) => {
    if (VERBOSE) {
      console.log();
      if (r.ok) {
        const d = r.data;
        console.log('✓ Done. Usage read from your account:');
        console.log(`  session: ${d.five_hour ? d.five_hour.used_percentage + '%' : '—'}`);
        console.log(`  week:    ${d.seven_day ? d.seven_day.used_percentage + '%' : '—'}`);
        console.log(`  saved to ${DATA}`);
      } else {
        console.log(`✗ Failed: ${r.reason}`);
      }
    }
    process.exit(r.ok ? 0 : 1);
  });
}
