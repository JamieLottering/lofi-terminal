# Lo-Fi Terminal

Claude Code on a 90s CRT, composited onto a painted lo-fi bedroom, with
bundled music playing.

## Run / build

Works on Windows (PowerShell) and macOS (your login shell, usually zsh).
Claude Code must be installed and working in a normal terminal first.

    npm install
    npm start            # dev
    npm run dist:win     # on Windows -> dist/ installer + portable .exe
    npm run dist:mac     # on a Mac   -> dist/ .dmg + .zip (arm64 and x64)

Each platform's build must be made on that platform.

On launch it opens a shell with Claude Code running:
- **Windows:** PowerShell running `claude.cmd` (sidesteps the script execution policy).
- **macOS:** `$SHELL -l -i` running `claude`, so PATH from `~/.zprofile` / `~/.zshrc`
  (nvm, Homebrew) is available even when launched from Finder.

When Claude exits you're left at a normal shell prompt.

The builds aren't code-signed. Windows SmartScreen: "More info" -> "Run anyway".
macOS Gatekeeper: right-click the app -> Open (or `xattr -cr "/Applications/Lo-Fi Terminal.app"`).

## Controls

| Action | Windows | macOS |
| --- | --- | --- |
| Settings | F4 | Cmd+, |
| Play / pause music | F3 | View menu (or fn+F3) |
| Fullscreen | F11 | Ctrl+Cmd+F |
| Paste | Ctrl+V, Ctrl+Shift+V, right-click | Cmd+V, right-click |
| Copy selection | Ctrl+C (with selection), Ctrl+Shift+C, right-click | Cmd+C, right-click |
| Interrupt | Ctrl+C (no selection) | Ctrl+C |
| Select text | Drag on screen | Drag on screen |
| Scroll | Wheel | Trackpad / wheel |

Every other key goes straight to the terminal. Settings are saved in
`%APPDATA%/lofi-terminal/settings.json` (Windows) or
`~/Library/Application Support/lofi-terminal/settings.json` (macOS).

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

## Releases

Publishing a GitHub release builds the app and attaches the installers to it:

1. GitHub -> Releases -> **Draft a new release**
2. Create a tag like `v0.2.0` (the tag sets the app version), add notes, **Publish**
3. The *Release* workflow (Actions tab) builds on Windows and macOS runners and
   uploads `LoFi-Terminal-Setup-x.y.z.exe`, `LoFi-Terminal-Portable-x.y.z.exe`
   and the macOS `.dmg` / `.zip` files to the release (takes ~5-10 minutes).

To test a build without releasing: Actions -> Release -> **Run workflow**;
the files appear as artifacts on that run.
