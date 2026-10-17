// Copies the MediaPipe WASM runtime into public/wasm and fetches the hand model
// into public/models if it is missing. Never fails the install: the app falls
// back to the Google-hosted model / jsDelivr WASM at runtime.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const wasmDst = join(root, 'public/wasm');
const modelDst = join(root, 'public/models/hand_landmarker.task');
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

if (existsSync(wasmSrc)) {
  cpSync(wasmSrc, wasmDst, { recursive: true });
  console.log('[prepare] MediaPipe WASM copied to public/wasm');
} else {
  console.warn('[prepare] @mediapipe/tasks-vision not installed yet; skipping WASM copy');
}

if (!existsSync(modelDst)) {
  mkdirSync(dirname(modelDst), { recursive: true });
  try {
    const res = await fetch(MODEL_URL, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    writeFileSync(modelDst, Buffer.from(await res.arrayBuffer()));
    console.log('[prepare] hand_landmarker.task downloaded to public/models');
  } catch (e) {
    console.warn('[prepare] model download skipped (' + e.message + '). The app will load it from Google storage at runtime.');
  }
}
