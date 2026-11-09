const { app, BrowserWindow, Menu, Tray, Notification, nativeImage, nativeTheme, ipcMain, screen, shell } = require('electron');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEMO = process.argv.includes('--demo');
const DATA_FILE =
  process.env.CLAUDE_USAGE_FILE || path.join(os.homedir(), '.claude', 'usage-widget.json');
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');

// Stili del widget sul desktop e dimensioni della finestra:
//   rings    = solo anelli
//   mini     = barre lineari sottili, da mettere anche sopra la barra di Windows
//   standard = riquadro con sfondo
const SIZES = {
  standard: { w: 264, h: 172 },
  rings: { w: 212, h: 108 },
  mini: { w: 184, h: 40 },
};
const STYLES = ['rings', 'mini', 'standard'];
const STYLE_LABELS = { rings: 'Anelli', mini: 'Barre (mini, anche sopra la barra di Windows)', standard: 'Riquadro' };
const MARGIN = 24;

let win = null;
// "rings" all'inizio; modeChosen diventa true quando scegli tu uno stile,
// da quel momento la tua scelta viene sempre rispettata.
// tray = icone nell'area di notifica vicino all'orologio, widget nascosto.
let settings = { x: null, y: null, opacity: 1, alwaysOnTop: true, style: 'rings', modeChosen: false, tray: false };

const currentSize = () => SIZES[settings.style] || SIZES.rings;
// Tema della barra di Windows (può essere diverso da quello delle app):
// serve per scegliere numeri neri su barra chiara e bianchi su barra scura.
function taskbarIsLight() {
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize', '/v', 'SystemUsesLightTheme'], { encoding: 'utf8', windowsHide: true });
      const m = out.match(/SystemUsesLightTheme\s+REG_DWORD\s+0x([0-9a-f]+)/i);
      if (m) return parseInt(m[1], 16) === 1;
    } catch (_) {
      /* chiave assente: Windows usa la barra scura */
    }
    return false;
  }
  return !nativeTheme.shouldUseDarkColors;
}
let taskbarLight = false;

const modePayload = () => ({
  style: settings.style,
  compact: settings.style === 'rings',
  mini: settings.style === 'mini',
  tray: settings.tray,
  taskbarLight,
});

let lastPayload = '';
let dragTimer = null;
const trays = { five_hour: null, seven_day: null };

// ---- Modalità barra di Windows ----
function destroyTrays() {
  for (const k of Object.keys(trays)) {
    if (trays[k]) {
      try {
        trays[k].destroy();
      } catch (_) {
        /* già distrutta */
      }
      trays[k] = null;
    }
  }
}

// ---- Aggiornamento manuale ("Aggiorna ora") ----
// Stessa richiesta minima dell'aggiornamento automatico (aggiorna.js, solo Haiku).
let refreshing = false;

function refreshItem() {
  return {
    label: refreshing ? 'Aggiornamento in corso…' : 'Aggiorna ora',
    enabled: !refreshing && !DEMO,
    click: refreshNow,
  };
}

function updateTrayMenus() {
  for (const k of Object.keys(trays)) if (trays[k]) trays[k].setContextMenu(trayMenu());
}

async function refreshNow(opts = {}) {
  if (refreshing) return;
  refreshing = true;
  updateTrayMenus();
  let res;
  try {
    res = await require('./aggiorna.js').refresh();
  } catch (e) {
    res = { ok: false, reason: e.message };
  }
  refreshing = false;
  updateTrayMenus();
  lastPayload = '';
  pushData();
  if (!res.ok && !opts.silent && Notification.isSupported()) {
    new Notification({ title: 'Aggiornamento non riuscito', body: String(res.reason || '').slice(0, 200) }).show();
  }
}

let lastAutoRefresh = 0;
function checkExpired() {
  if (DEMO || refreshing) return;
  const d = readData();
  if (!d.ok) return;
  const now = Date.now();
  const expired = ['five_hour', 'seven_day'].some((k) => {
    const w = d[k];
    if (!w || typeof w.resets_at !== 'number') return false;
    const ms = w.resets_at > 1e12 ? w.resets_at : w.resets_at * 1000;
    return ms <= now;
  });
  if (expired && now - lastAutoRefresh > 5 * 60 * 1000) {
    lastAutoRefresh = now;
    refreshNow({ silent: true });
  }
}

function trayMenu() {
  return Menu.buildFromTemplate([
    refreshItem(),
    { type: 'separator' },
    ...STYLES.map((st) => ({
      label: `Mostra sul desktop: ${STYLE_LABELS[st].split(' (')[0].toLowerCase()}`,
      click: () => { setTray(false); setStyle(st); },
    })),
    { type: 'separator' },
    { label: 'Esci', click: () => app.quit() },
  ]);
}

function setTray(on) {
  settings.tray = !!on;
  settings.modeChosen = true;
  if (win && !win.isDestroyed()) {
    if (settings.tray) {
      win.hide();
    } else {
      destroyTrays();
      win.show();
      applyOnTop();
    }
    win.webContents.send('mode', modePayload());
  }
  saveSettings();
}

// Il renderer disegna le icone (in tre dimensioni, per i vari zoom dello schermo)
// e le manda qui; ogni icona è un anellino con la percentuale al centro.
ipcMain.on('tray-icons', (_e, payload) => {
  if (!settings.tray || !payload) return;
  for (const key of ['five_hour', 'seven_day']) {
    const p = payload[key];
    if (!p || !p.reps) continue;
    const img = nativeImage.createEmpty();
    for (const [scale, url] of Object.entries(p.reps)) {
      img.addRepresentation({ scaleFactor: Number(scale), dataURL: url });
    }
    if (img.isEmpty()) continue;
    if (!trays[key]) {
      trays[key] = new Tray(img);
      trays[key].setContextMenu(trayMenu());
      trays[key].on('click', () => trays[key] && trays[key].popUpContextMenu());
    } else {
      trays[key].setImage(img);
    }
    trays[key].setToolTip(String(p.tooltip || '').slice(0, 120));
  }
});

function loadSettings() {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) || {};
    settings = { ...settings, ...raw };
  } catch (_) {
    /* prima esecuzione */
  }
  // Impostazioni delle versioni precedenti: "compact" vero/falso diventa uno stile.
  if (!STYLES.includes(raw.style)) settings.style = raw.compact === false ? 'standard' : 'rings';
  delete settings.compact;
  if (!settings.modeChosen) settings.style = 'rings';
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings));
  } catch (_) {
    /* non critico */
  }
}

function defaultPosition() {
  const wa = screen.getPrimaryDisplay().workArea;
  return { x: wa.x + wa.width - currentSize().w - MARGIN, y: wa.y + MARGIN };
}

// Si usa l'intero schermo (bounds), non l'area di lavoro: così il widget può
// stare anche sopra la barra di Windows e ritrovarsi lì al riavvio.
function positionIsVisible(x, y) {
  const { w, h } = currentSize();
  return screen.getAllDisplays().some((d) => {
    const b = d.bounds;
    return x >= b.x - w / 2 && x <= b.x + b.width - w / 2 && y >= b.y && y <= b.y + b.height - Math.min(h, 30);
  });
}

// Cambia stile mantenendo l'angolo in alto a sinistra e tenendo la finestra nello schermo.
function setStyle(style) {
  if (!STYLES.includes(style)) return;
  settings.style = style;
  settings.modeChosen = true;
  if (win && !win.isDestroyed()) {
    const { w, h } = currentSize();
    const [x0, y0] = win.getPosition();
    const b = screen.getDisplayNearestPoint({ x: x0, y: y0 }).bounds;
    const x = Math.max(b.x, Math.min(x0, b.x + b.width - w));
    const y = Math.max(b.y, Math.min(y0, b.y + b.height - h));
    win.setResizable(true);
    win.setBounds({ x, y, width: w, height: h });
    win.setResizable(false);
    settings.x = x;
    settings.y = y;
    win.webContents.send('mode', modePayload());
  }
  saveSettings();
}

function demoData() {
  const now = Math.floor(Date.now() / 1000);
  const t = Date.now() / 1000;
  return {
    ok: true,
    updated: Date.now(),
    five_hour: { used_percentage: 50 + 45 * Math.sin(t / 6), resets_at: now + 2 * 3600 + 13 * 60 },
    seven_day: { used_percentage: 41, resets_at: now + 3 * 86400 + 4 * 3600 },
  };
}

function readData() {
  if (DEMO) return demoData();
  try {
    const st = fs.statSync(DATA_FILE);
    const j = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return {
      ok: true,
      updated: j.updated || st.mtimeMs,
      five_hour: j.five_hour || null,
      seven_day: j.seven_day || null,
    };
  } catch (e) {
    return { ok: false, reason: e.code === 'ENOENT' ? 'nofile' : 'bad' };
  }
}

function pushData() {
  if (!win || win.isDestroyed()) return;
  const data = readData();
  const payload = JSON.stringify(data);
  if (payload === lastPayload) return;
  lastPayload = payload;
  win.webContents.send('data', data);
}

function createWindow() {
  const pos = settings.x != null && positionIsVisible(settings.x, settings.y)
    ? { x: settings.x, y: settings.y }
    : defaultPosition();

  win = new BrowserWindow({
    width: currentSize().w,
    height: currentSize().h,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    alwaysOnTop: settings.alwaysOnTop,
    show: !settings.tray,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  applyOnTop();
  win.setOpacity(settings.opacity);
  win.loadFile('index.html');
  win.webContents.on('did-finish-load', () => {
    lastPayload = '';
      win.webContents.send('mode', modePayload());
    pushData();
  });
}

function applyOnTop() {
  if (!win) return;
  if (settings.alwaysOnTop) {
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } else {
    win.setAlwaysOnTop(false);
    win.setVisibleOnAllWorkspaces(false);
  }
}

function showMenu() {
  const opacityItem = (label, value) => ({
    label,
    type: 'radio',
    checked: Math.abs(settings.opacity - value) < 0.01,
    click: () => {
      settings.opacity = value;
      win.setOpacity(value);
      saveSettings();
    },
  });

  const menu = Menu.buildFromTemplate([
    refreshItem(),
    { type: 'separator' },
    {
      label: 'Sempre in primo piano',
      type: 'checkbox',
      checked: settings.alwaysOnTop,
      click: (item) => {
        settings.alwaysOnTop = item.checked;
        applyOnTop();
        saveSettings();
      },
    },
    {
      label: 'Stile',
      submenu: STYLES.map((st) => ({
        label: STYLE_LABELS[st],
        type: 'radio',
        checked: settings.style === st,
        click: () => setStyle(st),
      })),
    },
    {
      label: 'Icone vicino all\'orologio (nasconde il widget)',
      click: () => setTray(true),
    },
    {
      label: 'Opacità',
      submenu: [opacityItem('100%', 1), opacityItem('85%', 0.85), opacityItem('70%', 0.7), opacityItem('50%', 0.5)],
    },
    {
      label: 'Riporta in alto a destra',
      click: () => {
        const p = defaultPosition();
        const { w, h } = currentSize();
        win.setBounds({ x: p.x, y: p.y, width: w, height: h });
        settings.x = p.x;
        settings.y = p.y;
        saveSettings();
      },
    },
    { label: 'Mostra file dei dati', enabled: !DEMO, click: () => shell.showItemInFolder(DATA_FILE) },
    { type: 'separator' },
    { label: 'Esci', click: () => app.quit() },
  ]);
  menu.popup({ window: win });
}

// Trascinamento gestito dal main process: coerente con la scala DPI e
// compatibile con il menu contestuale (le regioni "drag" di Electron su
// Windows lo bloccherebbero).
ipcMain.on('drag-start', () => {
  if (!win) return;
  clearInterval(dragTimer);
  const start = screen.getCursorScreenPoint();
  const [wx, wy] = win.getPosition();
  const { w, h } = currentSize();
  dragTimer = setInterval(() => {
    const p = screen.getCursorScreenPoint();
    win.setBounds({ x: wx + (p.x - start.x), y: wy + (p.y - start.y), width: w, height: h });
  }, 8);
});

ipcMain.on('drag-end', () => {
  if (!dragTimer) return;
  clearInterval(dragTimer);
  dragTimer = null;
  const [x, y] = win.getPosition();
  settings.x = x;
  settings.y = y;
  saveSettings();
});

ipcMain.on('show-menu', showMenu);
// Doppio clic: anelli -> barre -> riquadro -> anelli
ipcMain.on('toggle-compact', () => setStyle(STYLES[(STYLES.indexOf(settings.style) + 1) % STYLES.length]));
ipcMain.handle('get-data', () => readData());
ipcMain.handle('get-mode', () => modePayload());

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    loadSettings();
    taskbarLight = taskbarIsLight();
    nativeTheme.on('updated', () => {
      taskbarLight = taskbarIsLight();
      if (win && !win.isDestroyed()) win.webContents.send('mode', modePayload());
    });
    if (process.platform === 'darwin' && app.dock) app.dock.hide();
    createWindow();
    setInterval(pushData, 3000);
    // Controllo del reset: appena una finestra scade, chiede subito il consumo nuovo
    // (al massimo una volta ogni 5 minuti, senza notifiche se non riesce).
    setTimeout(checkExpired, 5000);
    setInterval(checkExpired, 60 * 1000);
    // Sopra la barra di Windows: cliccando la barra, Windows la riporta davanti;
    // ogni 2 secondi rimettiamo il widget in primo piano (senza rubare il focus).
    setInterval(() => {
      if (win && !win.isDestroyed() && win.isVisible() && settings.alwaysOnTop && settings.style === 'mini') {
        win.setAlwaysOnTop(true, 'screen-saver');
        win.moveTop();
      }
    }, 2000);
  });
  app.on('window-all-closed', () => app.quit());
}
