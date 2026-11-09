const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  getData: () => ipcRenderer.invoke('get-data'),
  onData: (cb) => ipcRenderer.on('data', (_e, d) => cb(d)),
  getMode: () => ipcRenderer.invoke('get-mode'),
  onMode: (cb) => ipcRenderer.on('mode', (_e, m) => cb(m)),
  toggleCompact: () => ipcRenderer.send('toggle-compact'),
  setTrayIcons: (p) => ipcRenderer.send('tray-icons', p),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  menu: () => ipcRenderer.send('show-menu'),
});
