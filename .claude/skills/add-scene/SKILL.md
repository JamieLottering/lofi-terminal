---
name: add-scene
description: Add a new flat-image scene (a painting with a CRT monitor whose dark glass gets the terminal composited onto it) to Lo-Fi Terminal. Use when the user provides a new room/desk image to add as a scene, or asks to re-measure/fix how the terminal fits an existing scene's monitor glass.
---

# Add a scene

A scene is a painting plus measurements of its monitor's glass, registered in
`src/renderer/scenes.js`. The view (`src/renderer/image-view.js`) bends the
terminal to the glass using those numbers, and the F4 Scene picker lists
every entry automatically. No other code changes are needed.

## Steps

1. **Add the image.** Copy it to `src/assets/scenes/<id>.png`, where `<id>` is
   kebab-case and descriptive (e.g. `rainy-attic`). Keep the original
   resolution. The image must show a CRT whose glass is dark and fairly
   uniform.

2. **Measure the glass.** From the repo root:

       npx electron .claude/skills/add-scene/measure-glass.js src/assets/scenes/<id>.png

   It flood-fills the dark glass from a seed point (default: 50% across,
   45% down) and prints the bounding box, the edge bow, the corner radius,
   and a ready-to-paste `scenes.js` entry.
   - If the seed misses the glass (warning, or "region is tiny"), pass the
     seed as fractions: `... <image> 0.42 0.5`.
   - If it "leaked" (region huge, or the bbox includes bezel), lower the
     threshold: `... <image> 0.5 0.45 30`. Glare on the glass usually needs a
     higher threshold or a seed away from the glare.

3. **Register it.** Paste the printed entry into `SCENES` in
   `src/renderer/scenes.js`. Set the key to `<id>` and give it a short
   human `name` (shown in the picker). Keep the comment style of the
   existing entries: note the measured bow in px.

4. **Preview with a screenshot.** This doesn't change saved settings, and the
   window opens without taking keyboard focus:

       LOFI_SCENE=<id> LOFI_SCREENSHOT="<scratchpad>/scene-<id>.png" LOFI_SCREENSHOT_DELAY=8000 npx electron .

   Read the PNG and check:
   - The terminal sits inside the glass, with no text or dark fill spilling
     onto the bezel and no strip of the painted glass showing at the edges.
   - Rounded corners match the painting's corners.
   - The text curvature looks like it follows the glass and isn't exaggerated.

   If anything fails, check `%APPDATA%/lofi-terminal/renderer.log` for errors.

5. **Tune.** The script's bbox is reliable. Bow and radius are estimates
   (side bow tends to come out low, and corner radii vary per corner), so
   adjust them by eye and re-screenshot:
   - Dark fill overshooting at the top or bottom middle → lower `bow.top` or
     `bow.bottom`. Painted glass visible there → raise it.
   - Same idea at the sides → `bow.x`.
   - Corners spilling onto the bezel → raise `radius`. Gaps at the corners →
     lower it.
   - Text too close to the edges → raise `pad`.

   Existing scenes for reference: `night-desk` (bow 0.07/0.08/0.03,
   radius 26) and `sunlit-room` (0.08/0.10/0.03, radius 42).

6. **Commit.** Commit the image and the `scenes.js` entry together, e.g.
   `Add <Name> scene`.

## Notes

- Scene switching is live (F4 → Scene), so the user can try it right away
  with `npm start`. Release builds pick up new scenes automatically.
- Only the glass geometry matters. `width`/`height` must match the image's
  real pixel size (the script prints them).
