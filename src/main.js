import * as THREE from 'three';
import { vertexShader, fragmentShader } from './shader.js';
import { Rig } from './rig.js';
import { HandTracker, startCamera } from './tracker.js';

const canvas = document.getElementById('gl');
const video = document.getElementById('cam');
const statusEl = document.getElementById('status');
const setStatus = (msg) => { if (msg) { statusEl.textContent = msg; statusEl.classList.remove('hide'); } else statusEl.classList.add('hide'); };

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // shader writes final display colours
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const scene = new THREE.Scene();
const camera = new THREE.Camera();

// Placeholder texture until the camera is live
const blank = new THREE.DataTexture(new Uint8Array([8, 8, 12, 255]), 1, 1);
blank.needsUpdate = true;

const uniforms = {
  uVideo: { value: blank },
  uRes: { value: new THREE.Vector2(1, 1) },
  uVidAspect: { value: 16 / 9 },
  uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
  uCorners: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
  uTime: { value: 0 },
  uPhase: { value: 0 },
  uFocus: { value: 0 },
  uExpand: { value: 0 },
  uEnergy: { value: 0 },
  uPresence: { value: 0 },
  uPoint: { value: new THREE.Vector3(0.5, 0.5, 0) },
  uHasCam: { value: 0 }
};

const mesh = new THREE.Mesh(
  new THREE.PlaneGeometry(2, 2),
  new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, depthTest: false, depthWrite: false })
);
mesh.frustumCulled = false;
scene.add(mesh);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  const dpr = renderer.getPixelRatio();
  uniforms.uRes.value.set(w * dpr, h * dpr);
}
window.addEventListener('resize', resize);
resize();

// ---- raw video uv -> screen uv (mirrored, cover-fit, y up) -------------------------------
function toScreen(p) {
  const w = window.innerWidth, h = window.innerHeight;
  const sa = w / h, va = uniforms.uVidAspect.value;
  const s = sa > va ? [1, va / sa] : [sa / va, 1];
  const cx = 1 - p.x, cy = 1 - p.y; // mirror + flip to y-up
  return { x: (cx - 0.5) / s[0] + 0.5, y: (cy - 0.5) / s[1] + 0.5, z: p.z || 0 };
}

// ---- state --------------------------------------------------------------------------------
const rig = new Rig();
let tracker = null;
let camOn = false;
let fallbackCanvas = null, fallbackCtx = null, fallbackTex = null;
const mouse = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, size: 0.2, last: -1e9 };

window.addEventListener('pointermove', (e) => {
  mouse.tx = e.clientX / window.innerWidth;
  mouse.ty = 1 - e.clientY / window.innerHeight;
  mouse.last = performance.now();
});
window.addEventListener('wheel', (e) => { mouse.size = Math.min(0.4, Math.max(0.08, mouse.size - e.deltaY * 0.0002)); }, { passive: true });

function makeFallbackSource() {
  fallbackCanvas = document.createElement('canvas');
  fallbackCanvas.width = 480; fallbackCanvas.height = 270;
  fallbackCtx = fallbackCanvas.getContext('2d');
  fallbackTex = new THREE.CanvasTexture(fallbackCanvas);
  uniforms.uVideo.value = fallbackTex;
  uniforms.uVidAspect.value = 16 / 9;
  uniforms.uTexel.value.set(1 / 480, 1 / 270);
}
function drawFallback(t) {
  const c = fallbackCtx, w = fallbackCanvas.width, h = fallbackCanvas.height;
  c.fillStyle = '#101018'; c.fillRect(0, 0, w, h);
  for (let i = 0; i < 6; i++) {
    const x = w * (0.5 + 0.38 * Math.sin(t * 0.3 + i * 1.9)), y = h * (0.5 + 0.35 * Math.cos(t * 0.23 + i * 2.7));
    const r = 60 + 30 * Math.sin(t * 0.5 + i);
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    const v = 120 + 110 * ((i % 3) / 2);
    g.addColorStop(0, `rgba(${v},${v * 0.8},${255 - v * 0.5},0.95)`); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
  }
  fallbackTex.needsUpdate = true;
}

async function initCamera() {
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
    await startCamera(video);
    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.NoColorSpace;
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
    uniforms.uVideo.value = tex;
    uniforms.uVidAspect.value = video.videoWidth / video.videoHeight;
    uniforms.uTexel.value.set(1 / video.videoWidth, 1 / video.videoHeight);
    uniforms.uHasCam.value = 1;
    camOn = true;
    setStatus('Loading hand tracking…');
    tracker = new HandTracker(video);
    await tracker.init();
    setStatus('v6 window mode: frame the shot with thumb and index of both hands');
  } catch (err) {
    console.warn('Camera or tracker unavailable:', err);
    if (!camOn) {
      makeFallbackSource();
      setStatus('Camera unavailable. Move the cursor to steer the frame.');
      setTimeout(() => setStatus(''), 6000);
    } else {
      setStatus('Hand tracking could not load (' + (err && err.message ? err.message : 'unknown') + '). Check your internet connection and reload.');
    }
  }
}
initCamera();

// ---- loop ---------------------------------------------------------------------------------
let prev = performance.now();
let noHandFor = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = (now - prev) / 1000;
  prev = now;

  const aspect = window.innerWidth / window.innerHeight;
  let hands = [];
  let manual = null;

  if (camOn && tracker) {
    hands = tracker.detect(now).map((h) => h.map(toScreen));
  } else if (!camOn && fallbackTex) {
    drawFallback(now / 1000);
    mouse.x += (mouse.tx - mouse.x) * (1 - Math.exp(-10 * dt));
    mouse.y += (mouse.ty - mouse.y) * (1 - Math.exp(-10 * dt));
    if (now - mouse.last < 4000) {
      manual = { cx: mouse.x, cy: mouse.y, hw: mouse.size * 1.2 / aspect * 1.4, hh: mouse.size };
    }
  }

  rig.update(dt, hands, aspect, manual);

  // tiny hint only while tracking is ready but no hand has been seen for a moment
  if (camOn && tracker?.landmarker) {
    if (hands.length) noHandFor = 0; else noHandFor += dt;
    if (noHandFor > 2.5) setStatus('Show both hands to the camera and frame with thumb + index');
    else if (hands.length) setStatus('');
  }

  for (let i = 0; i < 4; i++) uniforms.uCorners.value[i].set(rig.corners[i * 2], rig.corners[i * 2 + 1]);
  uniforms.uTime.value = rig.time;
  uniforms.uPhase.value = rig.phase;
  uniforms.uFocus.value = rig.focus;
  uniforms.uExpand.value = rig.expand;
  uniforms.uEnergy.value = rig.energy;
  uniforms.uPresence.value = rig.presence;
  uniforms.uPoint.value.set(rig.point.x, rig.point.y, rig.point.s);

  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
