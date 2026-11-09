#!/usr/bin/env node
// Status line script for Claude Code (optional, see statusline-setup.js).
// Reads the JSON that Claude Code passes on stdin, saves rate_limits
// (5-hour and 7-day windows) to ~/.claude/usage-widget.json and ALWAYS
// prints a short status line, so you can tell the script is running.
//
// If you already had a status line, statusline-setup.js stores its command in
// statusline-wrap.txt and this script runs it and shows its output instead.

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

// An old value is kept only while its window has not expired yet.
function stillValid(w) {
  if (!w || typeof w.resets_at !== 'number') return null;
  const ms = w.resets_at > 1e12 ? w.resets_at : w.resets_at * 1000;
  return ms > Date.now() ? w : null;
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
    /* invalid input */
  }

  const rl = (input && input.rate_limits) || {};
  const five = pick(rl.five_hour);
  const seven = pick(rl.seven_day);

  // Diagnostics: only the NAMES of the fields received and the rate_limits block
  // (no paths, no conversation text).
  try {
    fs.mkdirSync(path.dirname(DEBUG), { recursive: true });
    fs.writeFileSync(
      DEBUG,
      JSON.stringify(
        {
          time: new Date().toISOString(),
          fields_received: Object.keys(input || {}),
          rate_limits: input && input.rate_limits !== undefined ? input.rate_limits : '(missing)',
        },
        null,
        2
      )
    );
  } catch (_) {
    /* not critical */
  }

  // The field only appears for Pro/Max plans, after the first response of the
  // session, and each window disappears after its reset. When it is missing,
  // the last valid value is not overwritten.
  if (five || seven) {
    let previous = {};
    try {
      previous = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    } catch (_) {
      /* first save */
    }
    const data = {
      updated: Date.now(),
      five_hour: five || stillValid(previous.five_hour),
      seven_day: seven || stillValid(previous.seven_day),
    };
    try {
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      const tmp = OUT + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, OUT);
    } catch (_) {
      /* never break the status line over a write error */
    }
  }

  const parts = [];
  if (five) parts.push(`Session ${Math.round(five.used_percentage)}%`);
  if (seven) parts.push(`Week ${Math.round(seven.used_percentage)}%`);
  const ours = parts.length
    ? parts.join(' · ')
    : 'Widget: connected, waiting for usage (it arrives after the first response)';

  const wrap = readWrapCommand();
  if (wrap) {
    const res = spawnSync(wrap, { input: raw, shell: true, encoding: 'utf8', timeout: 4000 });
    const theirs = (res.stdout || '').replace(/\s+$/, '');
    process.stdout.write(theirs || ours);
    return;
  }

  process.stdout.write(ours);
});
