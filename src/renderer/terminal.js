// Hidden xterm.js instance (real keyboard focus, VT parsing, selection) whose
// buffer is painted onto an offscreen canvas that becomes the CRT texture.
import { Terminal } from '@xterm/xterm';

// Layout is computed in a fixed 4:3 reference space so the cols/rows grid
// stays stable while the window (and texture resolution) changes size.

export const REF_H = 720;


const FONTS = {
  modern: { family: '"Cascadia Mono", "Cascadia Code", Consolas, "SF Mono", Menlo, Monaco, monospace', scale: 1.0, lineHeight: 1.22 },
  retro: { family: '"VT323", monospace', scale: 1.3, lineHeight: 1.0 },
};

const THEME = {
  bg: '#0a0d0c',
  fg: '#d9e0da',
  cursor: '#e8f0e8',
  selection: 'rgba(120, 170, 150, 0.35)',
  ansi: [
    '#1b1f1e', '#e0675f', '#9cc97a', '#e6c06b', '#6fa8dc', '#c08bd1', '#6cc3c0', '#cfd6d0',
    '#5a6461', '#ff8a80', '#b9e59a', '#ffd98a', '#93c4f0', '#dcaaeb', '#8fe0dc', '#f4f8f4',
  ],
};

function buildPalette() {
  const p = THEME.ansi.slice();
  const steps = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++)
    for (let g = 0; g < 6; g++)
      for (let b = 0; b < 6; b++) p.push(`rgb(${steps[r]},${steps[g]},${steps[b]})`);
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10;
    p.push(`rgb(${v},${v},${v})`);
  }
  return p;
}
const PALETTE = buildPalette();
const rgbHex = (n) => '#' + n.toString(16).padStart(6, '0');

export class TerminalScreen {
  /**
   * @param aspect  width/height of the glass the texture is shown on
   * @param pad     inner margin in reference px ({x, y}), keeps text off curved edges
   */
  constructor(bridge, hiddenHost, { aspect = 4 / 3, pad = { x: 14, y: 14 } } = {}) {
    this.refW = Math.round(REF_H * aspect);
    this.padX = pad.x;
    this.padY = pad.y;
    this.bridge = bridge;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.dirty = true;
    this.lastActivity = performance.now();
    this.cursorOn = true;
    this.cursorVisible = true;
    this.ended = false;
    this.brightness = 0;
    this.fontKey = 'modern';
    this.fontSize = 16;

    this.term = new Terminal({
      cols: 100,
      rows: 36,
      scrollback: 5000,
      allowProposedApi: true,
      cursorBlink: false,
    });
    this.term.open(hiddenHost);
    this.cell = this.term.buffer.active.getNullCell();

    // Track DECTCEM (cursor show/hide) ourselves; Claude Code hides the cursor.
    this.term.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => {
      if (params.includes(25)) this.cursorVisible = true;
      return false;
    });
    this.term.parser.registerCsiHandler({ prefix: '?', final: 'l' }, (params) => {
      if (params.includes(25)) this.cursorVisible = false;
      return false;
    });

    const touch = () => { this.dirty = true; this.lastActivity = performance.now(); };
    this.term.onWriteParsed(touch);
    this.term.onScroll(touch);
    this.term.onSelectionChange(touch);
    this.term.onCursorMove(() => { this.cursorOn = true; touch(); });

    this.term.onData((data) => {
      if (this.ended) {
        if (data === '\r') this.restart();
        return;
      }
      console.debug('[term] input', JSON.stringify(data)); // shown only with LOFI_DEBUG=1
      bridge.pty.write(data);
    });
    this.term.onBinary((data) => !this.ended && bridge.pty.write(data));

    bridge.pty.onData((d) => this.term.write(d));
    bridge.pty.onExit(() => {
      this.ended = true;
      this.term.write('\r\n\x1b[33m[session ended - press Enter to restart]\x1b[0m\r\n');
    });

    setInterval(() => { this.cursorOn = !this.cursorOn; this.dirty = true; }, 530);
  }

  start() {
    this.bridge.pty.start(this.term.cols, this.term.rows);
  }

  restart() {
    this.ended = false;
    this.cursorVisible = true;
    this.term.reset();
    this.start();
  }

  focus() { this.term.focus(); }

  /** Re-fit to a different glass shape (aspect/padding), e.g. on scene change. */
  setLayout({ aspect, pad }) {
    this.refW = Math.round(REF_H * aspect);
    this.padX = pad.x;
    this.padY = pad.y;
    this.setFont(this.fontKey, this.fontSize);
  }

  /** Apply font choice; recomputes the cols/rows grid if needed. */
  setFont(fontKey, fontSize) {
    this.fontKey = FONTS[fontKey] ? fontKey : 'modern';
    this.fontSize = fontSize;
    const f = FONTS[this.fontKey];
    this.fontPx = fontSize * f.scale;
    this.font = `${this.fontPx}px ${f.family}`;
    this.boldFont = `bold ${this.fontPx}px ${f.family}`;
    this.ctx.font = this.font;
    this.cellW = this.ctx.measureText('M').width;
    this.cellH = Math.round(this.fontPx * f.lineHeight);
    const cols = Math.max(40, Math.floor((this.refW - this.padX * 2) / this.cellW));
    const rows = Math.max(12, Math.floor((REF_H - this.padY * 2) / this.cellH));
    this.offX = (this.refW - cols * this.cellW) / 2;
    this.offY = (REF_H - rows * this.cellH) / 2;
    if (cols !== this.term.cols || rows !== this.term.rows) {
      this.term.resize(cols, rows);
      this.bridge.pty.resize(cols, rows);
    }
    this.dirty = true;
  }

  /** Set backing resolution (height in device pixels). */
  setResolution(heightPx) {
    const h = Math.max(360, Math.min(2160, Math.round(heightPx)));
    const w = Math.round(h * (this.refW / REF_H));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.dirty = true;
      return true;
    }
    return false;
  }

  /** Reference-space point (0..refW, 0..REF_H) -> buffer cell. */
  cellAt(x, y) {
    const col = Math.min(this.term.cols - 1, Math.max(0, Math.floor((x - this.offX) / this.cellW)));
    const row = Math.min(this.term.rows - 1, Math.max(0, Math.floor((y - this.offY) / this.cellH)));
    return { col, row, absRow: row + this.term.buffer.active.viewportY };
  }

  colorFor(cell, fg) {
    if (fg) {
      if (cell.isFgRGB()) return rgbHex(cell.getFgColor());
      if (cell.isFgPalette()) {
        let c = cell.getFgColor();
        if (cell.isBold() && c < 8) c += 8;
        return PALETTE[c];
      }
      return THEME.fg;
    }
    if (cell.isBgRGB()) return rgbHex(cell.getBgColor());
    if (cell.isBgPalette()) return PALETTE[cell.getBgColor()];
    return null;
  }

  /** Repaint if dirty. Returns true when the canvas changed. */
  draw() {
    if (!this.dirty) return false;
    this.dirty = false;
    const { ctx, term, cell } = this;
    const s = this.canvas.height / REF_H;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, this.refW, REF_H);
    ctx.textBaseline = 'middle';

    const buf = term.buffer.active;
    const top = buf.viewportY;
    const sel = term.getSelectionPosition();
    const cw = this.cellW, ch = this.cellH;
    let lit = 0;

    for (let r = 0; r < term.rows; r++) {
      const line = buf.getLine(top + r);
      if (!line) continue;
      const y = this.offY + r * ch;
      const absRow = top + r;
      for (let c = 0; c < term.cols; c++) {
        if (!line.getCell(c, cell)) continue;
        const w = cell.getWidth();
        if (w === 0) continue;
        const x = this.offX + c * cw;
        let fg = this.colorFor(cell, true);
        let bg = this.colorFor(cell, false);
        if (cell.isInverse()) {
          const t = fg; fg = bg || THEME.bg; bg = t;
        }
        if (bg) {
          ctx.fillStyle = bg;
          ctx.fillRect(x, y, cw * w + 0.5, ch + 0.5);
        }
        if (sel && inSelection(sel, c, absRow)) {
          ctx.fillStyle = THEME.selection;
          ctx.fillRect(x, y, cw * w + 0.5, ch + 0.5);
        }
        const chars = cell.getChars();
        if (!chars || chars === ' ' || cell.isInvisible()) continue;
        lit++;
        ctx.globalAlpha = cell.isDim() ? 0.55 : 1;
        ctx.fillStyle = fg;
        ctx.font = cell.isBold() ? this.boldFont : this.font;
        if (cell.isItalic()) ctx.font = 'italic ' + ctx.font;
        ctx.fillText(chars, x, y + ch / 2 + 1, cw * w + 2);
        if (cell.isUnderline()) ctx.fillRect(x, y + ch - 2, cw * w, 1.2);
        if (cell.isStrikethrough()) ctx.fillRect(x, y + ch / 2, cw * w, 1.2);
      }
      ctx.globalAlpha = 1;
    }

    // Cursor
    const cy = buf.baseY + buf.cursorY - top;
    if (this.cursorVisible && this.cursorOn && !this.ended && cy >= 0 && cy < term.rows) {
      ctx.fillStyle = THEME.cursor;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(this.offX + buf.cursorX * cw, this.offY + cy * ch, cw, ch);
      ctx.globalAlpha = 1;
    }

    this.brightness = Math.min(1, lit / (term.cols * term.rows * 0.35));
    return true;
  }
}

function inSelection(sel, col, row) {
  // Selection positions are 1-based in xterm's public API.
  const sx = sel.start.x - 1, sy = sel.start.y - 1, ex = sel.end.x - 1, ey = sel.end.y - 1;
  if (row < sy || row > ey) return false;
  if (row === sy && col < sx) return false;
  if (row === ey && col >= ex) return false;
  return true;
}
