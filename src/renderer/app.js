import * as THREE from 'three';
import { TerminalScreen } from './terminal.js';
import { createImageView, terminalOptions } from './image-view.js';
import { getScene } from './scenes.js';
import { SoundSystem } from './audio.js';
import { SettingsPanel } from './panel.js';

const bridge = window.bridge;

async function main() {
  let settings = await bridge.settings.get();

  // Fonts must be ready before the terminal measures cells.
  await Promise.all([
    document.fonts.load('16px "VT323"'),
    document.fonts.load('16px "Cascadia Mono"'),
  ]).catch(() => {});

  // ---------- renderer ----------
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (err) {
    document.getElementById('fatal').hidden = false;
    document.getElementById('fatal-msg').textContent = String(err);
    return;
  }
  renderer.setPixelRatio(window.devicePixelRatio);
  document.getElementById('stage').appendChild(renderer.domElement);

  // ---------- terminal ----------
  let sceneId = settings.scene;
  const scene = getScene(sceneId);
  const termScreen = new TerminalScreen(bridge, document.getElementById('xterm-host'), terminalOptions(scene));
  termScreen.setFont(settings.font, settings.fontSize);
  const screenTex = new THREE.CanvasTexture(termScreen.canvas);
  screenTex.colorSpace = THREE.SRGBColorSpace;
  screenTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  screenTex.generateMipmaps = true;
  screenTex.minFilter = THREE.LinearMipmapLinearFilter;

  let view = createImageView(renderer, termScreen, screenTex, scene);

  /** Swap to another painting live; the shell keeps running, only the grid resizes. */
  function switchScene(id) {
    console.debug('[scene] switch', sceneId, '->', id);
    sceneId = id;
    const sc = getScene(id);
    view.dispose();
    termScreen.setLayout(terminalOptions(sc));
    view = createImageView(renderer, termScreen, screenTex, sc);
    view.setStrength(settings.crtStrength);
    view.setPostFx(settings.postFx);
    resize();
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h);
    // Texture resolution ~ on-screen pixel height of the glass (x1.25 headroom).
    const glassPx = view.resize(w, h);
    if (termScreen.setResolution(glassPx * 1.25)) screenTex.dispose(); // reallocate GPU texture at the new size
    view.setTexSize(termScreen.canvas.width, termScreen.canvas.height);
    poke();
  }

  // ---------- settings application ----------
  const audio = new SoundSystem(await bridge.music.list());
  function apply(s) {
    settings = s;
    if (s.scene !== sceneId) switchScene(s.scene);
    termScreen.setFont(s.font, s.fontSize);
    view.setStrength(s.crtStrength);
    view.setPostFx(s.postFx);
    audio.apply(s);
    poke();
  }
  async function update(patch) { apply(await bridge.settings.set(patch)); }
  const panel = new SettingsPanel(document.getElementById('panel'), update, audio, () => termScreen.focus());

  // ---------- input ----------
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F3') { e.preventDefault(); update({ musicPaused: !settings.musicPaused }); }
    else if (e.key === 'F4') { e.preventDefault(); panel.toggle(settings); }
    else if (e.key === 'F11') { e.preventDefault(); bridge.toggleFullscreen(); }
  }, true);

  termScreen.term.attachCustomKeyEventHandler((e) => {
    if (['F3', 'F4', 'F11'].includes(e.key)) return false;
    if (e.ctrlKey && e.shiftKey && e.type === 'keydown') {
      if (e.code === 'KeyC') { copySelection(); return false; }
      if (e.code === 'KeyV') { paste(); return false; }
    }
    return true;
  });

  function copySelection() {
    const t = termScreen.term;
    if (t.hasSelection()) { bridge.clipboard.write(t.getSelection()); t.clearSelection(); }
  }
  async function paste() { termScreen.term.paste(await bridge.clipboard.read()); }

  const cellFromEvent = (e) => view.cellFromEvent(e);

  const canvasEl = renderer.domElement;
  let dragAnchor = null;
  canvasEl.addEventListener('mousedown', (e) => {
    // Without preventDefault the browser moves focus to <body> after this
    // handler runs, stealing it back from xterm's hidden textarea.
    e.preventDefault();
    termScreen.focus();
    if (e.button !== 0) return;
    const c = cellFromEvent(e);
    termScreen.term.clearSelection();
    dragAnchor = c;
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragAnchor) return;
    const c = cellFromEvent(e);
    if (!c) return;
    const cols = termScreen.term.cols;
    let a = dragAnchor.absRow * cols + dragAnchor.col;
    let b = c.absRow * cols + c.col;
    if (b < a) [a, b] = [b, a];
    termScreen.term.select(a % cols, Math.floor(a / cols), b - a + 1);
  });
  window.addEventListener('mouseup', () => { dragAnchor = null; });
  canvasEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (termScreen.term.hasSelection()) copySelection(); else paste();
  });
  canvasEl.addEventListener('wheel', (e) => {
    const t = termScreen.term;
    const lines = Math.sign(e.deltaY) * Math.max(1, Math.round(Math.abs(e.deltaY) / 40));
    if (t.modes.mouseTrackingMode !== 'none') {
      const c = cellFromEvent(e) || { col: 0, row: 0 };
      const btn = lines < 0 ? 64 : 65;
      for (let i = 0; i < Math.abs(lines); i++) bridge.pty.write(`\x1b[<${btn};${c.col + 1};${c.row + 1}M`);
    } else if (t.buffer.active.type === 'alternate') {
      bridge.pty.write((lines < 0 ? '\x1b[A' : '\x1b[B').repeat(Math.abs(lines)));
    } else {
      t.scrollLines(lines);
    }
  }, { passive: true });
  window.addEventListener('focus', () => !panel.open && termScreen.focus());
  // Safety net: if focus ever lands outside the terminal (and the settings
  // panel isn't in use), hand it back so typing always reaches the shell.
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      const el = document.activeElement;
      if (!panel.open && document.hasFocus() && (!el || el === document.body)) termScreen.focus();
    }, 0);
  });
  // Last resort: a keypress arriving while focus is elsewhere refocuses the terminal.
  window.addEventListener('keydown', (e) => {
    const el = document.activeElement;
    if (!panel.open && !(el && el.classList.contains('xterm-helper-textarea'))) termScreen.focus();
  }, true);

  // ---------- loop ----------
  // 60fps while things are happening, ~20fps when idle. Chromium stops rAF
  // entirely while the window is hidden/minimized.
  let lastFrame = 0;
  let activeUntil = 0;
  function poke() { activeUntil = performance.now() + 1500; }
  termScreen.term.onWriteParsed(poke);
  window.addEventListener('keydown', poke);
  window.addEventListener('mousemove', poke);

  const t0 = performance.now();
  let glow = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const interval = now < activeUntil ? 0 : 50;
    if (now - lastFrame < interval) return;
    lastFrame = now;

    const t = (now - t0) / 1000;
    if (termScreen.draw()) screenTex.needsUpdate = true;
    glow += (termScreen.brightness - glow) * 0.1;
    view.render(t, glow);
  }

  window.addEventListener('resize', resize);
  resize();
  apply(settings);
  termScreen.start();
  termScreen.focus();
  requestAnimationFrame(frame);
}

main().catch((err) => {
  console.error(err);
  document.getElementById('fatal').hidden = false;
  document.getElementById('fatal-msg').textContent = err && err.stack ? err.stack : String(err);
});
