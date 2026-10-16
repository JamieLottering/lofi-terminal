// F4 settings overlay. Every change is applied and persisted immediately.
import { SCENES } from './scenes.js';

const HINT = window.bridge.platform === 'darwin'
  ? 'Cmd+, settings &middot; Ctrl+Cmd+F fullscreen &middot; Cmd+C/V copy/paste &middot; right-click copy/paste &middot; View menu: music'
  : 'F3 play/pause music &middot; F4 settings &middot; F11 fullscreen &middot; Ctrl+V paste &middot; Ctrl+C copy (with selection) &middot; right-click copy/paste';
export class SettingsPanel {
  constructor(root, update, audio, refocus) {
    this.root = root;
    this.open = false;
    this.refocus = refocus;
    root.innerHTML = `
      <h2>SETTINGS <span>F4 to close</span></h2>
      <label>Scene<select name="scene">${Object.entries(SCENES).map(([id, s]) => `<option value="${id}">${s.name}</option>`).join('')}</select></label>
      <div class="music-row"><button type="button" id="music-prev" title="Previous">◀◀</button><button type="button" id="music-toggle">Pause</button><button type="button" id="music-next" title="Next">▶▶</button></div>
      <div class="status"><b id="music-status">-</b></div>
      <label>Music volume<input name="musicVolume" type="range" min="0" max="1" step="0.01"></label>
      <label>Font<select name="font"><option value="modern">Modern</option><option value="retro">Retro (VT323)</option></select></label>
      <label>Font size<input name="fontSize" type="range" min="11" max="24" step="1"></label>
      <label>CRT effect strength<input name="crtStrength" type="range" min="0" max="1" step="0.01"></label>
      <label class="row"><input name="postFx" type="checkbox"> Screen glow</label>
      <p class="hint">${HINT}</p>
    `;
    const statusEl = root.querySelector('#music-status');
    const toggleBtn = root.querySelector('#music-toggle');
    const showStatus = (s) => {
      statusEl.textContent = s;
      toggleBtn.textContent = audio.paused ? '▶ Play' : '❚❚ Pause';
    };
    audio.onStatus = showStatus;
    showStatus(audio.status);
    toggleBtn.addEventListener('click', () => update({ musicPaused: !audio.paused }));
    // Skipping always plays; clear a saved "paused" so it sticks.
    const skip = (dir) => {
      const wasPaused = audio.paused;
      audio.skip(dir);
      if (wasPaused) update({ musicPaused: false });
    };
    root.querySelector('#music-prev').addEventListener('click', () => skip(-1));
    root.querySelector('#music-next').addEventListener('click', () => skip(1));

    root.querySelectorAll('input, select').forEach((el) => {
      const ev = el.type === 'text' ? 'change' : 'input';
      el.addEventListener(ev, () => {
        let v = el.type === 'checkbox' ? el.checked : el.value;
        if (el.type === 'range') v = Number(v);
        update({ [el.name]: v });
      });
    });
  }

  toggle(settings) {
    this.open = !this.open;
    this.root.hidden = !this.open;
    if (this.open) {
      for (const el of this.root.querySelectorAll('input, select')) {
        if (el.type === 'checkbox') el.checked = !!settings[el.name];
        else el.value = settings[el.name];
      }
    } else {
      this.refocus();
    }
  }
}
