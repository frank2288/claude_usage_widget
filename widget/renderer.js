// ---- Geometria ----
const R = 38; // anello della modalità standard
const LEN = 2 * Math.PI * R;
const R_MINI = 40; // anello esterno della modalità compatta
const LEN_MINI = 2 * Math.PI * R_MINI;

// Anello blu interno (tempo al reset), diviso in segmenti.
const R_IN = 29;
const SW_IN = 5; // spessore
const GAP_DEG = 8; // spazio visibile tra due segmenti
const CAP_DEG = ((SW_IN / 2) / R_IN) * (180 / Math.PI); // i bordi arrotondati sporgono di metà spessore
const INSET_DEG = GAP_DEG / 2 + CAP_DEG;

// La sessione dura 5 ore (5 segmenti da 1 ora); la settimana 7 giorni (7 segmenti da 1 giorno).
const RINGS = [
  { id: 'r-session', mini: 'm-session', bar: 'b-session', key: 'five_hour', label: 'Sessione', segments: 5, unitSec: 3600 },
  { id: 'r-week', mini: 'm-week', bar: 'b-week', key: 'seven_day', label: 'Settimana', segments: 7, unitSec: 86400 },
];

let state = null;

const clamp = (n) => Math.max(0, Math.min(100, n));
const SVG_NS = 'http://www.w3.org/2000/svg';

// resets_at può essere epoch in secondi, in millisecondi o una stringa ISO.
function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

function fmtRemaining(sec) {
  if (sec <= 0) return 'ora';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}g ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${Math.max(m, 1)}m`;
}

// Formato stretto per le barre: 2h12, 19h59, 3g3h, 40m
function fmtShort(sec) {
  if (sec <= 0) return 'ora';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}g${h}h`;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`;
  return `${Math.max(m, 1)}m`;
}

function fmtClock(ms) {
  return new Date(ms).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

const levelClass = (pct) => (pct == null ? 'empty' : pct >= 90 ? 'danger' : pct >= 75 ? 'warn' : '');

// Cosa mostrare per un anello, a partire dai dati ricevuti.
function viewOf(r, now) {
  const w = state && state.ok ? state[r.key] : null;
  const v = { pct: null, remainingSec: null, resetText: '—' };
  if (w && typeof w.used_percentage === 'number') {
    const resetMs = toMs(w.resets_at);
    if (resetMs && resetMs <= now) {
      // la finestra è scaduta: il consumo riparte da zero
      v.pct = 0;
      v.resetText = 'finestra rinnovata';
    } else {
      v.pct = clamp(w.used_percentage);
      if (resetMs) {
        v.remainingSec = (resetMs - now) / 1000;
        v.resetText = `reset tra ${fmtRemaining(v.remainingSec)}`;
      } else {
        v.resetText = '';
      }
    }
  }
  return v;
}

// ---- Anello blu segmentato ----
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

// units = tempo rimasto espresso in segmenti (es. 2.4 = due segmenti pieni e il terzo al 40%).
// I segmenti si accendono in senso orario a partire dall'alto e si spengono dall'ultimo.
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

// ---- Disegno ----
function render() {
  const now = Date.now();

  const views = {};
  for (const r of RINGS) {
    const v = viewOf(r, now);
    views[r.key] = { r, v };
    const p = v.pct == null ? 0 : v.pct;
    const shown = v.pct == null ? '—' : String(Math.round(v.pct));

    // Modalità standard
    const el = document.getElementById(r.id);
    const bar = el.querySelector('.bar');
    bar.style.strokeDasharray = `${LEN}`;
    bar.style.strokeDashoffset = `${LEN * (1 - p / 100)}`;
    el.querySelector('.num').textContent = shown;
    el.querySelector('.sym').style.display = v.pct == null ? 'none' : '';
    el.querySelector('.reset').textContent = v.resetText;
    el.className = 'ring ' + levelClass(v.pct);

    // Modalità compatta
    const m = document.getElementById(r.mini);
    const mbar = m.querySelector('.m-bar');
    mbar.style.strokeDasharray = `${LEN_MINI}`;
    mbar.style.strokeDashoffset = `${LEN_MINI * (1 - p / 100)}`;
    m.querySelector('.m-num').textContent = shown;
    m.querySelector('.m-sym').style.display = v.pct == null ? 'none' : '';
    m.querySelector('.m-timer').textContent =
      v.remainingSec != null ? fmtRemaining(v.remainingSec) : v.pct === 0 && v.resetText === 'finestra rinnovata' ? 'rinnovata' : '';
    m.className = 'mg ' + levelClass(v.pct);
    m.title = v.pct == null ? `${r.label}: nessun dato` : `${r.label}: ${Math.round(v.pct)}% usato · ${v.resetText}`;
    const units = v.remainingSec == null ? null : Math.min(r.segments, v.remainingSec / r.unitSec);
    drawSegments(m, r.segments, units);

    // Modalità barre
    const b = document.getElementById(r.bar);
    b.className = 'brow ' + (levelClass(v.pct) === 'empty' ? '' : levelClass(v.pct));
    b.querySelector('.bfill').style.width = `${p}%`;
    b.querySelector('.bpct').textContent = v.pct == null ? '—' : `${shown}%`;
    b.querySelector('.btimer').textContent = v.remainingSec != null ? fmtShort(v.remainingSec) : v.pct === 0 && v.resetText === 'finestra rinnovata' ? 'nuova' : '';
    b.title = m.title;
    b.querySelectorAll('.bseg i').forEach((seg, k) => {
      const f = units == null ? 0 : Math.max(0, Math.min(1, units - k));
      seg.style.width = `${f * 100}%`;
    });
  }

  if (mode.tray) sendTrayIcons(views);

  const foot = document.getElementById('foot');
  if (!state) foot.textContent = '';
  else if (!state.ok) foot.textContent = state.reason === 'nofile' ? 'In attesa dei dati…' : 'File dei dati non leggibile';
  else foot.textContent = `aggiornato alle ${fmtClock(state.updated)}`;
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

// ---- Icone per la barra di Windows ----
const LEVEL_COLORS = { '': '#d97757', warn: '#e9b44c', danger: '#ef5350', empty: 'rgba(160,160,170,0.5)' };

// Anellino colorato con la percentuale al centro, disegnato a "size" pixel.
// Nessun contorno sul numero: nero su barra chiara, bianco su barra scura.
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
      tooltip: v.pct == null ? `${r.label}: nessun dato` : `${r.label}: ${Math.round(v.pct)}% usato · ${v.resetText}`,
    };
  }
  // invia solo se qualcosa è cambiato
  const sig = (mode.taskbarLight ? 'L' : 'D') + Object.keys(payload).map((k) => `${k}|${Math.round(views[k].v.pct ?? -1)}|${payload[k].tooltip}`).join(';');
  if (sig === lastTraySig) return;
  lastTraySig = sig;
  call('setTrayIcons', payload);
}

// Chiamata sicura: se una funzione manca (per esempio un preload.js vecchio),
// il resto del widget continua a funzionare.
const W = window.widget || {};
function call(name, ...args) {
  try {
    return typeof W[name] === 'function' ? W[name](...args) : undefined;
  } catch (_) {
    return undefined;
  }
}

// Mouse per primo: trascinamento, menu contestuale e doppio clic per cambiare modalità.
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

// Dati e modalità
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
