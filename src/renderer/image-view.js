// Flat scene view: a static painting with the terminal composited onto the
// monitor glass. Everything is in image-pixel space (origin bottom-left).
// Scene geometry comes from scenes.js.
import * as THREE from 'three';
import { REF_H } from './terminal.js';

/** TerminalScreen options (aspect + padding) for a scene's glass. */
export function terminalOptions(sc) {
  const g = sc.glass;
  return { aspect: (g.x1 - g.x0) / (g.y1 - g.y0), pad: sc.pad };
}

export function createImageView(renderer, termScreen, screenTex, sc) {
  const IW = sc.width, IH = sc.height, GLASS = sc.glass, BOW = sc.bow;
  const GW = GLASS.x1 - GLASS.x0, GH = GLASS.y1 - GLASS.y0;
  const GCX = (GLASS.x0 + GLASS.x1) / 2, GCY = IH - (GLASS.y0 + GLASS.y1) / 2;

  /** Centered glass coords c (-1..1, y up) -> flat terminal coords q. */
  const flatten = (cx, cy) => {
    const ky = cy > 0 ? BOW.top : BOW.bottom;
    return { x: cx * (1 + BOW.x * cy * cy), y: cy * (1 + ky * cx * cx) };
  };

  renderer.toneMapping = THREE.NoToneMapping;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, IW, IH, 0, -10, 10);

  const bgTex = new THREE.TextureLoader().load(sc.image);
  bgTex.colorSpace = THREE.SRGBColorSpace;
  bgTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(IW, IH), new THREE.MeshBasicMaterial({ map: bgTex }));
  bg.position.set(IW / 2, IH / 2, 0);
  scene.add(bg);

  // Soft light the screen casts on the bezel/desk, driven by text brightness.
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { glow: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform float glow; varying vec2 vUv;
      void main(){
        vec2 d = (vUv - 0.5) * 2.0;
        float f = pow(clamp(1.0 - length(d * vec2(0.85, 1.0)), 0.0, 1.0), 2.2);
        gl_FragColor = vec4(vec3(0.55, 0.7, 0.85) * f * glow * 0.10, 1.0);
      }`,
  });
  const glowQuad = new THREE.Mesh(new THREE.PlaneGeometry(GW * 2.2, GH * 2.4), glowMat);
  glowQuad.position.set(GCX, GCY - 20, 1);
  scene.add(glowQuad);

  // The terminal on the glass. The quad covers the glass bbox; the shader
  // bends the text to the bowed edges and masks the rounded corners.
  const screenMat = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: screenTex },
      photo: { value: bgTex },
      strength: { value: 0.3 },
      time: { value: 0 },
      texSize: { value: new THREE.Vector2(1, 1) },
      halfSize: { value: new THREE.Vector2(GW / 2, GH / 2) },
      center: { value: new THREE.Vector2(GCX, GCY) },
      imageSize: { value: new THREE.Vector2(IW, IH) },
      radius: { value: GLASS.radius },
      bow: { value: new THREE.Vector3(BOW.x, BOW.top, BOW.bottom) },
    },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform sampler2D photo;
      uniform float strength; uniform float time; uniform vec2 texSize;
      uniform vec2 halfSize; uniform vec2 center; uniform vec2 imageSize;
      uniform float radius; uniform vec3 bow;
      varying vec2 vUv;

      float roundedBox(vec2 p, vec2 b, float r){
        vec2 q = abs(p) - b + r;
        return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
      }

      void main(){
        vec2 c = vUv * 2.0 - 1.0;
        float ky = c.y > 0.0 ? bow.y : bow.z;
        vec2 q = vec2(c.x * (1.0 + bow.x * c.y * c.y), c.y * (1.0 + ky * c.x * c.x));

        // Mask in pixel units for a crisp, anti-aliased rounded edge.
        float d = roundedBox(q * halfSize, halfSize, radius);
        float mask = 1.0 - smoothstep(-1.0, 0.75, d);
        if (mask <= 0.0) discard;

        vec2 uv = q * 0.5 + 0.5;
        vec3 col = texture2D(map, uv).rgb;

        // Phosphor halo
        vec2 px = 1.5 / texSize;
        vec3 halo = texture2D(map, uv + vec2(px.x, 0.0)).rgb + texture2D(map, uv - vec2(px.x, 0.0)).rgb
                  + texture2D(map, uv + vec2(0.0, px.y)).rgb + texture2D(map, uv - vec2(0.0, px.y)).rgb;
        col += halo * 0.25 * 0.35 * strength;

        // Scanlines + tube vignette + faint flicker
        col *= 1.0 - strength * 0.22 * (0.5 + 0.5 * sin(uv.y * 480.0 * 3.14159));
        col *= 1.0 - strength * 0.9 * dot(c * 0.5, c * 0.5);
        col *= 1.0 - strength * 0.012 * sin(time * 60.0);

        // Keep the painting's glass reflections on top of the terminal.
        vec2 photoUv = (center + c * halfSize) / imageSize;
        vec3 glass = texture2D(photo, photoUv).rgb;
        col = col + glass * 0.55;

        // Darken toward the rim like the painted glass does.
        col *= smoothstep(-28.0, -6.0, d) * 0.35 + 0.65;

        gl_FragColor = vec4(col, mask);
        #include <colorspace_fragment>
      }`,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(GW, GH), screenMat);
  screen.position.set(GCX, GCY, 2);
  scene.add(screen);

  let view = { x: 0, y: 0, w: IW, h: IH }; // visible image region (image px, y up)

  return {
    resize(w, h) {
      // "Cover" fit, cropping around the monitor and clamped to the image.
      const a = w / h;
      if (a > IW / IH) {
        const vh = IW / a;
        const y = Math.min(Math.max(GCY - vh / 2, 0), IH - vh);
        view = { x: 0, y, w: IW, h: vh };
      } else {
        const vw = IH * a;
        const x = Math.min(Math.max(GCX - vw / 2, 0), IW - vw);
        view = { x, y: 0, w: vw, h: IH };
      }
      camera.left = view.x; camera.right = view.x + view.w;
      camera.bottom = view.y; camera.top = view.y + view.h;
      camera.updateProjectionMatrix();
      return GH * (h / view.h) * window.devicePixelRatio;
    },
    /** Free GPU resources (the shared terminal texture is left alone). */
    dispose() {
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      bgTex.dispose();
    },
    setTexSize(w, h) { screenMat.uniforms.texSize.value.set(w, h); },
    setStrength(v) { screenMat.uniforms.strength.value = v; },
    setPostFx(on) { glowQuad.visible = on; },
    render(t, glow) {
      glowMat.uniforms.glow.value = glow;
      screenMat.uniforms.time.value = t;
      renderer.render(scene, camera);
    },
    cellFromEvent(e) {
      const ix = view.x + (e.clientX / window.innerWidth) * view.w;
      const iy = view.y + (1 - e.clientY / window.innerHeight) * view.h;
      const cx = (ix - GCX) / (GW / 2), cy = (iy - GCY) / (GH / 2);
      if (Math.abs(cx) > 1.05 || Math.abs(cy) > 1.05) return null;
      const q = flatten(cx, cy);
      return termScreen.cellAt((q.x * 0.5 + 0.5) * termScreen.refW, (1 - (q.y * 0.5 + 0.5)) * REF_H);
    },
  };
}
