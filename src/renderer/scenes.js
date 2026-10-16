// Flat-image scenes. To add one: drop the painting in src/assets/scenes/,
// measure the monitor's glass in image pixels, and add an entry here.
export const SCENES = {
  'night-desk': {
    name: 'Night desk',
    image: '../assets/scenes/night-desk.png',
    width: 1672,
    height: 941,
    // Glass bounding box (top-left origin, px) and its corner radius.
    glass: { x0: 358, y0: 213, x1: 944, y1: 618, radius: 26 },
    // How far the glass edges bow outward (fraction of the half-size): the
    // top bulges ~10px, the bottom ~3px and the sides ~6px in this painting.
    bow: { x: 0.07, top: 0.08, bottom: 0.03 },
    // Inner margin for text, in terminal reference px (720 = glass height).
    pad: { x: 36, y: 30 },
  },
  'sunlit-room': {
    name: 'Sunlit room',
    image: '../assets/scenes/sunlit-room.png',
    width: 1672,
    height: 941,
    glass: { x0: 472, y0: 257, x1: 1163, y1: 735, radius: 42 },
    // Top bulges ~14px, bottom ~4px, sides ~7-10px.
    bow: { x: 0.08, top: 0.1, bottom: 0.03 },
    pad: { x: 40, y: 34 },
  },
};

export const DEFAULT_SCENE = 'night-desk';

export function getScene(id) {
  return SCENES[id] || SCENES[DEFAULT_SCENE];
}
