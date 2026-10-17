import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const BASE = import.meta.env.BASE_URL;
const CDN_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const REMOTE_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

async function exists(url) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    const type = r.headers.get('content-type') || '';
    return r.ok && !type.includes('text/html');
  } catch { return false; }
}

export async function startCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } },
    audio: false
  });
  video.srcObject = stream;
  await video.play();
  if (!video.videoWidth) {
    await new Promise((res) => video.addEventListener('loadedmetadata', res, { once: true }));
  }
  return stream;
}

export class HandTracker {
  constructor(video) {
    this.video = video;
    this.landmarker = null;
    this.lastTime = -1;
    this.hands = [];
  }

  async init() {
    let fileset;
    try {
      if (!(await exists(BASE + 'wasm/vision_wasm_internal.js'))) throw new Error('no local wasm');
      fileset = await FilesetResolver.forVisionTasks(BASE + 'wasm');
    } catch {
      fileset = await FilesetResolver.forVisionTasks(CDN_WASM);
    }
    const localModel = BASE + 'models/hand_landmarker.task';
    const modelPath = (await exists(localModel)) ? localModel : REMOTE_MODEL;

    const make = (delegate) =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelPath, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.4,
        minHandPresenceConfidence: 0.4,
        minTrackingConfidence: 0.4
      });
    try { this.landmarker = await make('GPU'); }
    catch { this.landmarker = await make('CPU'); }
  }

  // Returns array of hands, each hand = 21 {x,y,z} in raw video uv (y down).
  detect(nowMs) {
    const v = this.video;
    if (!this.landmarker || v.readyState < 2) return this.hands;
    if (v.currentTime === this.lastTime) return this.hands;
    this.lastTime = v.currentTime;
    try {
      const res = this.landmarker.detectForVideo(v, nowMs);
      this.hands = res.landmarks || [];
    } catch { this.hands = []; }
    return this.hands;
  }
}
