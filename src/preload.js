const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bridge', {
  pty: {
    start: (cols, rows) => ipcRenderer.send('pty:start', cols, rows),
    write: (data) => ipcRenderer.send('pty:write', data),
    resize: (cols, rows) => ipcRenderer.send('pty:resize', cols, rows),
    onData: (fn) => ipcRenderer.on('pty:data', (_e, d) => fn(d)),
    onExit: (fn) => ipcRenderer.on('pty:exit', (_e, code) => fn(code)),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },
  music: { list: () => ipcRenderer.invoke('music:list') },
  clipboard: {
    read: () => ipcRenderer.invoke('clip:read'),
    write: (text) => ipcRenderer.send('clip:write', text),
  },
  toggleFullscreen: () => ipcRenderer.send('win:fullscreen'),
});
