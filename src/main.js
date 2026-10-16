const { app, BrowserWindow, Menu, ipcMain, protocol, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const pty = require('node-pty');

const ROOT = path.join(__dirname, '..');
const MUSIC_DIR = path.join(ROOT, 'src', 'assets', 'music');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.png': 'image/png', '.svg': 'image/svg+xml',
};

const DEFAULTS = {
  scene: 'night-desk', // id from src/renderer/scenes.js
  musicVolume: 0.5,
  musicPaused: false,
  font: 'modern',
  fontSize: 16,
  crtStrength: 0.3,
  postFx: true,
  bounds: null,
};

// ---------- settings ----------
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
let settings = { ...DEFAULTS };

function loadSettings() {
  try {
    settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) };
  } catch {
    settings = { ...DEFAULTS };
  }
}

let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
      fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  }, 300);
}

// ---------- protocols ----------
// app:// serves project files (proper origin so ES modules + importmaps work;
//         stream privilege lets <audio> play the bundled music from it)
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

function registerProtocols() {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const filePath = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
    if (!filePath.startsWith(ROOT)) return new Response('Forbidden', { status: 403 });
    // Read via fs (asar-aware) rather than fetching a file:// URL, which doesn't
    // resolve paths inside app.asar in packaged builds.
    try {
      const body = fs.readFileSync(filePath);
      const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      return new Response(body, { headers: { 'content-type': type } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

// ---------- pty ----------
let shell = null;

/** The shell to run, with Claude Code started in it. */
function shellCommand() {
  if (process.platform === 'win32') {
    // claude.cmd rather than claude: the npm .ps1 shim is blocked when the
    // PowerShell execution policy is Restricted (the Windows default).
    return { file: 'powershell.exe', args: ['-NoLogo', '-NoExit', '-Command', 'claude.cmd'] };
  }
  // macOS/Linux: a login + interactive shell loads PATH from ~/.zprofile and
  // ~/.zshrc (nvm, Homebrew), which apps launched from Finder don't inherit.
  // When claude exits, fall back to a normal shell, like PowerShell's -NoExit.
  const sh = process.env.SHELL || '/bin/zsh';
  return { file: sh, args: ['-l', '-i', '-c', `claude; exec "${sh}" -l -i`] };
}

function startShell(win, cols, rows) {
  if (shell) {
    try { shell.kill(); } catch {}
    shell = null;
  }
  const { file, args } = shellCommand();
  const proc = pty.spawn(file, args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: os.homedir(),
    // Apps launched from Finder get no LANG; without it zsh mangles UTF-8.
    env: { LANG: 'en_US.UTF-8', ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
  });
  shell = proc;
  proc.onData((data) => {
    if (!win.isDestroyed()) win.webContents.send('pty:data', data);
  });
  proc.onExit(({ exitCode }) => {
    if (shell === proc) shell = null;
    if (!win.isDestroyed()) win.webContents.send('pty:exit', exitCode);
  });
}

// ---------- window ----------
function createWindow() {
  const b = settings.bounds || {};
  const win = new BrowserWindow({
    width: b.width || 1440,
    height: b.height || 900,
    // Screenshot runs open without activating, so they don't steal keyboard focus.
    show: !process.env.LOFI_SCREENSHOT,
    x: b.x,
    y: b.y,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#05060a',
    title: 'Lo-Fi Terminal',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  const rememberBounds = () => {
    if (!win.isFullScreen() && !win.isMinimized()) {
      settings.bounds = win.getBounds();
      saveSettings();
    }
  };
  win.on('resize', rememberBounds);
  win.on('move', rememberBounds);
  win.on('closed', () => {
    if (shell) { try { shell.kill(); } catch {} shell = null; }
  });

  win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning' || process.env.LOFI_DEBUG) {
      const line = `[renderer:${e.level}] ${e.message}`;
      console.log(line);
      // Packaged builds have no console; keep a log next to settings.json.
      try { fs.appendFileSync(path.join(app.getPath('userData'), 'renderer.log'), line + '\n'); } catch {}
    }
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    const line = `[load-failed] ${code} ${desc} ${url}`;
    console.log(line);
    try { fs.appendFileSync(path.join(app.getPath('userData'), 'renderer.log'), line + '\n'); } catch {}
  });
  win.loadURL('app://local/src/renderer/index.html');

  // Debug helper: LOFI_SCREENSHOT=out.png npm start  -> capture after load and quit
  if (process.env.LOFI_SCREENSHOT) {
    win.showInactive();
    win.webContents.once('did-finish-load', () => {
      // Optional: run renderer JS (e.g. flip a setting) 3s before the capture.
      if (process.env.LOFI_EVAL) {
        setTimeout(() => win.webContents.executeJavaScript(process.env.LOFI_EVAL).catch(console.error),
          Number(process.env.LOFI_SCREENSHOT_DELAY || 6000) - 3000);
      }
      setTimeout(async () => {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(process.env.LOFI_SCREENSHOT, img.toPNG());
        app.quit();
      }, Number(process.env.LOFI_SCREENSHOT_DELAY || 6000));
    });
  }
  return win;
}

app.whenReady().then(() => {
  loadSettings();
  // Debug: LOFI_SCENE=<id> previews a scene without changing saved settings.
  const sceneOverride = process.env.LOFI_SCENE;
  registerProtocols();
  const win = createWindow();

  ipcMain.handle('settings:get', () => (sceneOverride ? { ...settings, scene: sceneOverride } : settings));
  ipcMain.handle('settings:set', (_e, patch) => {
    settings = { ...settings, ...patch };
    saveSettings();
    return settings;
  });
  ipcMain.on('pty:start', (_e, cols, rows) => startShell(win, cols, rows));
  ipcMain.on('pty:write', (_e, data) => shell && shell.write(data));
  ipcMain.on('pty:resize', (_e, cols, rows) => {
    if (shell) { try { shell.resize(cols, rows); } catch {} }
  });
  ipcMain.handle('music:list', () => {
    // Bundled tracks: every audio file in src/assets/music, alphabetical.
    try {
      return fs.readdirSync(MUSIC_DIR).filter((f) => /\.(mp3|ogg|wav|m4a|flac)$/i.test(f)).sort();
    } catch {
      return [];
    }
  });
  ipcMain.handle('clip:read', () => clipboard.readText());
  ipcMain.on('clip:write', (_e, text) => clipboard.writeText(text));
  ipcMain.on('win:fullscreen', () => win.setFullScreen(!win.isFullScreen()));
  buildMenu(win);
});

/**
 * Windows/Linux: no menu at all, so Electron's default accelerators (Ctrl+W
 * close, Ctrl+R reload, Ctrl+V paste) never fight the terminal for keys.
 * macOS: a real menu bar. Copy/Paste/Settings only *show* their shortcuts
 * (registerAccelerator: false); the renderer handles the keys itself so a
 * paste can't fire twice.
 */
function buildMenu(win) {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  const send = (action) => () => win.webContents.send('menu', action);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', registerAccelerator: false, click: send('settings') },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Copy', accelerator: 'Cmd+C', registerAccelerator: false, click: send('copy') },
        { label: 'Paste', accelerator: 'Cmd+V', registerAccelerator: false, click: send('paste') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Play / Pause Music', click: send('music') },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]));
}

app.on('window-all-closed', () => app.quit());
