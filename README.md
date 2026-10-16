# Lo-Fi Terminal

Claude Code on a 90s CRT, composited onto a painted lo-fi bedroom, with
bundled music playing.

## Run / build

    npm install
    npm start        # dev
    npm run dist     # dist/ -> installer + portable .exe

On launch it starts PowerShell running `claude.cmd` (Claude Code must be installed).

## Controls

| Key | Action |
| --- | --- |
| F3 | Play / pause music |
| F4 | Settings (scene, volume, font, CRT strength, screen glow) |
| F11 | Fullscreen |
| Ctrl+V or Ctrl+Shift+V | Paste |
| Ctrl+C (with selection) or Ctrl+Shift+C | Copy (Ctrl+C with no selection still interrupts) |
| Right-click | Copy selection, or paste if nothing selected |
| Drag on screen | Select text |
| Wheel | Scroll |

Every other key goes straight to the terminal. Settings are saved in
`%APPDATA%/lofi-terminal/settings.json`.

## Music

Every audio file in `src/assets/music/` is bundled and played in order, looping.

## Adding a scene

1. Put the painting in `src/assets/scenes/`.
2. Measure the monitor glass in image pixels (bounding box, corner radius, how
   much each edge bows outward).
3. Add an entry to `src/renderer/scenes.js`. It shows up under F4 -> Scene.

## Layout

- `src/main.js` - window, node-pty shell, settings, `app://` protocol, music list
- `src/renderer/terminal.js` - hidden xterm.js painted onto a canvas
- `src/renderer/scenes.js` - scene registry (image + glass geometry)
- `src/renderer/image-view.js` - painting + curved terminal glass shader
- `src/renderer/app.js` - input, render loop, settings wiring
- `src/renderer/audio.js` - bundled music (low-pass + reverb)

Debug: `LOFI_DEBUG=1` logs renderer output to `%APPDATA%/lofi-terminal/renderer.log`;
`LOFI_SCREENSHOT=out.png` captures a frame and quits.
