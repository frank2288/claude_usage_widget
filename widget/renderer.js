// ---- Geometry ----
const R = 38; // ring of the "panel" style
const LEN = 2 * Math.PI * R;
const R_MINI = 40; // outer ring of the "rings" style
const LEN_MINI = 2 * Math.PI * R_MINI;

// Inner blue ring (time to reset), split into segments.
const R_IN = 29;
const SW_IN = 5; // stroke width
const GAP_DEG = 8; // visible gap between two segments
const CAP_DEG = ((SW_IN / 2) / R_IN) * (180 / Math.PI); // round caps stick out by half the stroke
const INSET_DEG = GAP_DEG / 2 + CAP_DEG;

// The session lasts 5 hours (5 one-hour segments); the week 7 days (7 one-day segments).
const RINGS = [
  { id: 'r-session', mini: 'm-session', bar: 'b-session', key: 'five_hour', label: 'Session', segments: 5, unitSec: 3600 },
  { id: 'r-week', mini: 'm-week', bar: 'b-week', key: 'seven_day', label: 'Week', segments: 7, unitSec: 86400 },
];

let state = null;

const clamp = (n) => Math.max(0, Math.min(100, n));
const SVG_NS = 'http://www.w3.org/2000/svg';

// resets_at can be epoch seconds, epoch milliseconds or an ISO string.
function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

function fmtRemaining(sec) {
  if (sec <= 0) return 'now';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${Math.max(m, 1)}m`;
}

// Narrow format for the bars style: 2h12, 19h59, 3d3h, 40m
function fmtShort(sec) {
  if (sec <= 0) return 'now';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d${h}h`;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`;
  return `${Math.max(m, 1)}m`;
}

// Clock time in the user's own locale format.
function fmtClock(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

const levelClass = (pct) => (pct == null ? 'empty' : pct >= 90 ? 'danger' : pct >= 75 ? 'warn' : '');

// What to show for one window, based on the data received.
function viewOf(r, now) {
  const w = state && state.ok ? state[r.key] : null;
  const v = { pct: null, remainingSec: null, renewed: false, resetText: '—' };
  if (w && typeof w.used_percentage === 'number') {
    const resetMs = toMs(w.resets_at);
    if (resetMs && resetMs <= now) {
      // the window has expired: usage starts again from zero
      v.pct = 0;
      v.renewed = true;
      v.resetText = 'window renewed';
    } else {
      v.pct = clamp(w.used_percentage);
      if (resetMs) {
        v.remainingSec = (resetMs - now) / 1000;
        v.resetText = `resets in ${fmtRemaining(v.remainingSec)}`;
      } else {
        v.resetText = '';
      }
    }
  }
  return v;
}

const tooltipOf = (r, v) =>
  v.pct == null ? `${r.label}: no data` : `${r.label}: ${Math.round(v.pct)}% used · ${v.resetText}`;

// ---- Segmented blue ring ----
function pointAt(deg) {
  const rad = (deg * Math.PI) / 180;
  return [48 + R_IN * Math.cos(rad), 48 + R_IN * Math.sin(rad)];
}

function arcPath(a0, a1) {
  const [x0, y0] = pointAt(a0);
  const [x1, y1] = pointAt(a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${R_IN} ${R_IN} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function pathEl(d) {
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', d);
  return p;
}

// units = remaining time expressed in segments (e.g. 2.4 = two full segments and the third at 40%).
// Segments light up clockwise from the top and switch off from the last one.
function drawSegments(el, n, units) {
  const gTrack = el.querySelector('.seg-track');
  const gLit = el.querySelector('.seg-lit');
  gTrack.textContent = '';
  gLit.textContent = '';
  const step = 360 / n;
  for (let k = 0; k < n; k++) {
    const s0 = -90 + k * step + INSET_DEG;
    const s1 = -90 + (k + 1) * step - INSET_DEG;
    gTrack.appendChild(pathEl(arcPath(s0, s1)));
    const f = units == null ? 0 : Math.max(0, Math.min(1, units - k));
    if (f > 0.02) gLit.appendChild(pathEl(arcPath(s0, s0 + f * (s1 - s0))));
  }
}

// ---- Drawing ----
function render() {
  const now = Date.now();

  const views = {};
  for (const r of RINGS) {
    const v = viewOf(r, now);
    views[r.key] = { r, v };
    const p = v.pct == null ? 0 : v.pct;
    const shown = v.pct == null ? '—' : String(Math.round(v.pct));
    const tip = tooltipOf(r, v);

    // Panel style
    const el = document.getElementById(r.id);
    const bar = el.querySelector('.bar');
    bar.style.strokeDasharray = `${LEN}`;
    bar.style.strokeDashoffset = `${LEN * (1 - p / 100)}`;
    el.querySelector('.num').textContent = shown;
    el.querySelector('.sym').style.display = v.pct == null ? 'none' : '';
    el.querySelector('.reset').textContent = v.resetText;
    el.className = 'ring ' + levelClass(v.pct);

    // Rings style
    const m = document.getElementById(r.mini);
    const mbar = m.querySelector('.m-bar');
    mbar.style.strokeDasharray = `${LEN_MINI}`;
    mbar.style.strokeDashoffset = `${LEN_MINI * (1 - p / 100)}`;
    m.querySelector('.m-num').textContent = shown;
    m.querySelector('.m-sym').style.display = v.pct == null ? 'none' : '';
    m.querySelector('.m-timer').textContent = v.remainingSec != null ? fmtRemaining(v.remainingSec) : v.renewed ? 'renewed' : '';
    m.className = 'mg ' + levelClass(v.pct);
    m.title = tip;
    const units = v.remainingSec == null ? null : Math.min(r.segments, v.remainingSec / r.unitSec);
    drawSegments(m, r.segments, units);

    // Bars style
    const b = document.getElementById(r.bar);
    b.className = 'brow ' + (levelClass(v.pct) === 'empty' ? '' : levelClass(v.pct));
    b.querySelector('.bfill').style.width = `${p}%`;
    b.querySelector('.bpct').textContent = v.pct == null ? '—' : `${shown}%`;
    b.querySelector('.btimer').textContent = v.remainingSec != null ? fmtShort(v.remainingSec) : v.renewed ? 'new' : '';
    b.title = tip;
    b.querySelectorAll('.bseg i').forEach((seg, k) => {
      const f = units == null ? 0 : Math.max(0, Math.min(1, units - k));
      seg.style.width = `${f * 100}%`;
    });
  }

  if (mode.tray) sendTrayIcons(views);

  const foot = document.getElementById('foot');
  if (!state) foot.textContent = '';
  else if (!state.ok) foot.textContent = state.reason === 'nofile' ? 'Waiting for data…' : 'Data file unreadable';
  else foot.textContent = `updated at ${fmtClock(state.updated)}`;
}

let mode = { style: 'rings', compact: false, mini: false, tray: false, taskbarLight: false };
let lastTraySig = '';

function applyMode(m) {
  if (m) mode = { style: m.style, compact: !!m.compact, mini: !!m.mini, tray: !!m.tray, taskbarLight: !!m.taskbarLight };
  const root = document.documentElement.classList;
  root.toggle('compact', mode.compact);
  root.toggle('barmode', mode.mini);
  root.toggle('tb-light', mode.taskbarLight);
  lastTraySig = '';
  render();
}

// ---- Icons next to the clock (notification area) ----
const LEVEL_COLORS = { '': '#d97757', warn: '#e9b44c', danger: '#ef5350', empty: 'rgba(160,160,170,0.5)' };

// Small coloured ring with the percentage in the middle, drawn at "size" pixels.
// No outline on the number: black on a light taskbar, white on a dark one.
function drawTrayIcon(size, pct, light) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  const sw = Math.max(1.5, size * 0.11);
  const rad = size / 2 - sw / 2;
  const cx = size / 2;
  const cy = size / 2;
  g.lineWidth = sw;
  g.strokeStyle = light ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.2)';
  g.beginPath();
  g.arc(cx, cy, rad, 0, Math.PI * 2);
  g.stroke();
  if (pct != null && pct > 0) {
    g.lineCap = 'round';
    g.strokeStyle = LEVEL_COLORS[levelClass(pct)];
    g.beginPath();
    g.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * Math.min(pct, 100)) / 100);
    g.stroke();
  }
  const text = pct == null ? '–' : String(Math.round(pct));
  const fs = size * (text.length >= 3 ? 0.34 : 0.46);
  g.font = `700 ${fs}px "Segoe UI", system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = light ? '#000' : '#fff';
  g.fillText(text, cx, cy + size * 0.04);
  return c.toDataURL('image/png');
}

function sendTrayIcons(views) {
  const payload = {};
  for (const key of Object.keys(views)) {
    const { r, v } = views[key];
    payload[key] = {
      reps: { 1: drawTrayIcon(16, v.pct, mode.taskbarLight), 1.5: drawTrayIcon(24, v.pct, mode.taskbarLight), 2: drawTrayIcon(32, v.pct, mode.taskbarLight) },
      tooltip: tooltipOf(r, v),
    };
  }
  // send only when something changed
  const sig = (mode.taskbarLight ? 'L' : 'D') + Object.keys(payload).map((k) => `${k}|${Math.round(views[k].v.pct ?? -1)}|${payload[k].tooltip}`).join(';');
  if (sig === lastTraySig) return;
  lastTraySig = sig;
  call('setTrayIcons', payload);
}

// Safe call: if a function is missing (e.g. an outdated preload.js),
// the rest of the widget keeps working.
const W = window.widget || {};
function call(name, ...args) {
  try {
    return typeof W[name] === 'function' ? W[name](...args) : undefined;
  } catch (_) {
    return undefined;
  }
}

// Mouse first: dragging, context menu and double-click to switch style.
document.addEventListener('mousedown', (e) => {
  if (e.button === 0) call('dragStart');
});
window.addEventListener('mouseup', () => call('dragEnd'));
window.addEventListener('blur', () => call('dragEnd'));
document.addEventListener('dblclick', () => call('toggleCompact'));
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  call('dragEnd');
  call('menu');
});

// Data and mode
call('onData', (d) => {
  state = d;
  render();
});
call('onMode', applyMode);
Promise.resolve(call('getMode')).then(applyMode).catch(() => {});
Promise.resolve(call('getData'))
  .then((d) => {
    if (d) {
      state = d;
      render();
    }
  })
  .catch(() => {});
setInterval(render, 20000);
