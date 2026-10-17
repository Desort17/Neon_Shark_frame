# Frame: hand-framed neon camera effect

A live-camera effect: frame the shot with your thumbs and index fingers and a perspective-warped,
neon-posterised copy of yourself appears between your hands, with vertical pixel-sort drips and
dark contour lines. Built with Three.js, one fullscreen shader and MediaPipe Hand Landmarker.

## Run

    npm install
    npm run dev       # http://localhost:5173 (camera needs localhost or https)
    npm run build

`npm install` copies the MediaPipe WASM runtime to `public/wasm` and tries to download
`hand_landmarker.task` into `public/models/`. If that download fails (offline / restricted
network) the app loads the model from Google storage and the WASM from jsDelivr at runtime.
To work fully offline, put the file at `public/models/hand_landmarker.task`:
https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task

## Gestures

- Frame: both hands, thumb and index apart. Fingertips pin the four corners of the quad.
- Relaxed / closed hands: the quad contracts into a thin line between your hands.
- Point (index out, others curled, held ~0.3 s): a ripple follows the fingertip with inertia.
- Pinch (held ~0.3 s, with hysteresis): focus state. The pinched hand leads, the other side trails; smear and colour intensify.
- Open palm (held ~0.4 s): the frame expands and the drips lengthen.
- No hand: the quad drifts on its own slow orbit; hands blend back in smoothly.
- No camera: move the cursor (wheel resizes) as a fallback.

## Files

- `src/rig.js`: gesture state machines, springs, idle motion (DOM-free)
- `src/shader.js`: inverse-bilinear quad warp + the neon effect
- `src/tracker.js`: camera + MediaPipe
- `src/main.js`: Three.js scene and loop
