// Bundled music (src/assets/music) played "in the room": low-pass + small
// reverb. Tracks play in order and loop.

export class SoundSystem {
  constructor(tracks) {
    this.ctx = new AudioContext();
    this.tracks = tracks;
    this.index = 0;
    this.status = tracks.length ? 'paused' : 'no tracks in assets/music';
    this.onStatus = () => {};
    this.paused = true;

    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);

    // Music chain
    this.el = new window.Audio();
    const src = ctx.createMediaElementSource(this.el);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 6000; lp.Q.value = 0.4;
    const verb = ctx.createConvolver();
    verb.buffer = impulse(ctx, 1.4, 3);
    const dry = ctx.createGain(); dry.gain.value = 0.85;
    const wet = ctx.createGain(); wet.gain.value = 0.22;
    this.music = ctx.createGain();
    src.connect(lp);
    lp.connect(dry).connect(this.music);
    lp.connect(verb).connect(wet).connect(this.music);
    this.music.connect(this.master);

    this.el.addEventListener('playing', () => this.setStatus(`playing: ${this.trackName()}`));
    // Reload the source on each track change/loop instead of seeking, since
    // the app:// protocol doesn't serve byte ranges.
    this.el.addEventListener('ended', () => {
      this.index = (this.index + 1) % this.tracks.length;
      this.load();
    });
    this.el.addEventListener('error', () => this.setStatus(`can't play: ${this.trackName()}`));
  }

  trackName() {
    return (this.tracks[this.index] || '').replace(/\.[^.]+$/, '');
  }

  setStatus(s) { this.status = s; this.onStatus(s); console.debug('[music]', s); }

  apply(s) {
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.music.gain.value = s.musicVolume;
    if (s.musicPaused) this.pause();
    else if (this.paused) this.play();
  }

  load() {
    if (!this.tracks.length) return;
    this.el.src = '/src/assets/music/' + encodeURIComponent(this.tracks[this.index]);
    this.el.play().catch(() => {});
  }

  play() {
    if (!this.tracks.length) return;
    this.paused = false;
    if (this.el.src) this.el.play().catch(() => {});
    else this.load();
  }

  /**
   * Skip to the next (+1) or previous (-1) track and play it. "Previous"
   * restarts the current track if it's more than 3s in, like most players.
   */
  skip(dir) {
    if (!this.tracks.length) return;
    if (!(dir < 0 && this.el.currentTime > 3)) {
      this.index = (this.index + dir + this.tracks.length) % this.tracks.length;
    }
    this.paused = false;
    this.load();
  }

  pause() {
    this.paused = true;
    this.el.pause();
    if (this.tracks.length) this.setStatus(`paused: ${this.trackName()}`);
  }
}

function noise(ctx, seconds) {
  const b = ctx.createBuffer(2, ctx.sampleRate * seconds, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return b;
}

function impulse(ctx, seconds, decay) {
  const b = noise(ctx, seconds);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < d.length; i++) d[i] *= Math.pow(1 - i / d.length, decay);
  }
  return b;
}
