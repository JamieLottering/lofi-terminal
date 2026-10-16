// Measures a monitor's dark glass in a scene painting and prints a
// scenes.js entry. Runs under Electron (for nativeImage, no extra deps):
//
//   npx electron .claude/skills/add-scene/measure-glass.js <image> [seedX seedY] [threshold]
//
// seedX/seedY: a point inside the glass as fractions of width/height
// (default 0.5 0.45). threshold: max luminance (0-255) counted as glass
// (default: seed luminance + 12).
const { app, nativeImage } = require('electron');
const path = require('path');

app.whenReady().then(() => {
  try {
    // argv: [electron, <this script as typed>, ...args]
    const self = process.argv.findIndex((a) => /measure-glass\.js$/.test(a));
    run(process.argv.slice(self + 1));
  } catch (err) {
    console.error('ERROR:', err.message);
    process.exitCode = 1;
  }
  app.quit();
});

function run(args) {
  const [file, sx = '0.5', sy = '0.45', thr] = args;
  if (!file) throw new Error('usage: measure-glass.js <image> [seedX seedY] [threshold]');
  const img = nativeImage.createFromPath(path.resolve(file));
  if (img.isEmpty()) throw new Error(`could not load image: ${file}`);
  const { width: W, height: H } = img.getSize();
  const bmp = img.toBitmap(); // BGRA
  const lum = (x, y) => {
    const i = (y * W + x) * 4;
    return 0.114 * bmp[i] + 0.587 * bmp[i + 1] + 0.299 * bmp[i + 2];
  };

  // ---- flood fill the dark glass from the seed ----
  const seedX = Math.round(W * Number(sx)), seedY = Math.round(H * Number(sy));
  const L0 = lum(seedX, seedY);
  const T = thr ? Number(thr) : L0 + 12;
  if (L0 > 60) console.warn(`WARN: seed luminance ${L0.toFixed(1)} is bright - is the seed on the glass?`);
  const inGlass = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  let sp = 0, n = 0;
  stack[sp++] = seedY * W + seedX;
  const seen = new Uint8Array(W * H);
  while (sp) {
    const k = stack[--sp];
    if (seen[k]) continue;
    seen[k] = 1;
    const x = k % W, y = (k / W) | 0;
    if (lum(x, y) > T) continue;
    inGlass[k] = 1; n++;
    if (x > 0) stack[sp++] = k - 1;
    if (x < W - 1) stack[sp++] = k + 1;
    if (y > 0) stack[sp++] = k - W;
    if (y < H - 1) stack[sp++] = k + W;
  }
  let x0 = W, x1 = 0, y0 = H, y1 = 0;
  for (let k = 0; k < W * H; k++) if (inGlass[k]) {
    const x = k % W, y = (k / W) | 0;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const gw = x1 - x0, gh = y1 - y0;
  const fill = n / (W * H);
  if (fill < 0.02) throw new Error(`glass region is tiny (${(fill * 100).toFixed(1)}% of image) - move the seed or raise the threshold`);
  if (fill > 0.6) throw new Error(`glass region is huge (${(fill * 100).toFixed(0)}% of image) - the fill leaked; lower the threshold`);

  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, hw = gw / 2, hh = gh / 2;
  // Edge positions, median over a few rows/cols to ignore single-pixel noise.
  const median = (a) => a.sort((p, q) => p - q)[a.length >> 1];
  const colTop = (x) => { for (let y = y0; y <= y1; y++) if (inGlass[y * W + x]) return y; return y1; };
  const colBot = (x) => { for (let y = y1; y >= y0; y--) if (inGlass[y * W + x]) return y; return y0; };
  const rowL = (y) => { for (let x = x0; x <= x1; x++) if (inGlass[y * W + x]) return x; return x1; };
  const rowR = (y) => { for (let x = x1; x >= x0; x--) if (inGlass[y * W + x]) return x; return x0; };
  const around = (v, f) => median([-4, -2, 0, 2, 4].map((d) => f(Math.round(v + d))));

  // ---- edge bow ----
  // The view maps glass coords c -> flat q with q.y = c.y * (1 + k * c.x^2)
  // (and q.x likewise). An edge point measured at |c.x| = 0.7 sitting at
  // normalized distance t from the center gives k = (1/t - 1) / 0.49.
  const S = 0.7, bowFrom = (t) => Math.max(0, (1 / t - 1) / (S * S));
  const xs = [cx - S * hw, cx + S * hw], ys = [cy - S * hh, cy + S * hh];
  const topT = median(xs.map((x) => (cy - around(x, colTop)) / hh));
  const botT = median(xs.map((x) => (around(x, colBot) - cy) / hh));
  const sideT = median([...ys.map((y) => (cx - around(y, rowL)) / hw), ...ys.map((y) => (around(y, rowR) - cx) / hw)]);
  const bow = { x: bowFrom(sideT), top: bowFrom(topT), bottom: bowFrom(botT) };

  // ---- corner radius ----
  // Expected sharp corner (where the bowed edges would meet), then walk the
  // diagonal toward the center until the glass starts: gap = r * (sqrt2 - 1).
  const radii = [];
  for (const [sxn, syn] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const ky = syn < 0 ? bow.top : bow.bottom;
    const ccx = cx + sxn * hw / (1 + bow.x), ccy = cy + syn * hh / (1 + ky);
    for (let d = 0; d < Math.min(hw, hh) / 2; d += 0.5) {
      const px = Math.round(ccx - sxn * d / Math.SQRT2), py = Math.round(ccy - syn * d / Math.SQRT2);
      if (inGlass[py * W + px]) { radii.push(d / (Math.SQRT2 - 1)); break; }
    }
  }
  const radius = Math.round(median(radii.slice()));

  // ---- report ----
  const r2 = (v) => Math.round(v * 100) / 100;
  const padX = Math.round(30 + radius * 0.25);
  console.log(`image ${W}x${H}  seed lum ${L0.toFixed(1)}  threshold ${T.toFixed(1)}  glass ${(fill * 100).toFixed(1)}% of image`);
  console.log(`glass bbox x ${x0}-${x1}, y ${y0}-${y1} (${gw}x${gh})`);
  console.log(`edge bow: top ${Math.round((1 - topT) * hh)}px, bottom ${Math.round((1 - botT) * hh)}px, sides ${Math.round((1 - sideT) * hw)}px; corner radii ${radii.map(Math.round).join('/')}`);
  console.log('\n--- scenes.js entry (fill in id/name) ---');
  console.log(`  '<id>': {
    name: '<Name>',
    image: '../assets/scenes/${path.basename(file)}',
    width: ${W},
    height: ${H},
    glass: { x0: ${x0}, y0: ${y0}, x1: ${x1}, y1: ${y1}, radius: ${radius} },
    bow: { x: ${r2(bow.x)}, top: ${r2(bow.top)}, bottom: ${r2(bow.bottom)} },
    pad: { x: ${padX}, y: ${padX - 6} },
  },`);
}
