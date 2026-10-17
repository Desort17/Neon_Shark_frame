# Neon Hand Frame ✋✨

A real-time interactive camera effect controlled by hand gestures.

The project uses **MediaPipe Hand Landmarker** for hand tracking and **Three.js** for rendering a fullscreen GPU shader effect. Your hands control a glowing neon frame around the camera feed, creating a futuristic posterized visual with pixel-sorted drips, contour lines, color distortion, and smooth motion.

## What It Does

The system turns your webcam into an interactive visual effect where your hand position and gestures control the composition.

### ✋ Frame Gesture

Place both hands in front of the camera with your thumbs and index fingers separated.

The four fingertips act as the corners of the visual frame.

### 🤏 Pinch

Hold a pinch gesture for a short moment to enter the focus state.

The pinching hand leads the frame while the opposite side follows with smoother trailing motion, creating a physical "pull" effect.

### ☝️ Point

Hold your index finger out while the other fingers remain curled.

A glowing ripple follows the fingertip with smooth inertia.

### 🖐️ Open Palm

Hold an open palm to expand the frame and increase the length and intensity of the visual drips.

### ✊ Relaxed / Closed Hands

When both hands are relaxed or closed, the frame contracts into a thin glowing line between the hands.

### 🌌 No Hands

When no hands are detected, the effect automatically transitions into a slow autonomous motion instead of disappearing abruptly.

### 🖱️ Mouse Fallback

If camera access is unavailable, the project provides a mouse-controlled fallback mode.

Move the cursor to steer the frame and use the mouse wheel to resize it.

---

## Visual Effect

The rendering is designed around a dark futuristic aesthetic:

- Neon posterized camera image
- Perspective-warped frame
- Vertical pixel-sort style drips
- Dark contour lines
- Color distortion
- Smooth motion trails
- Inertial gesture movement
- GPU shader-based rendering
- Cinematic fullscreen presentation

The effect is rendered through a custom **Three.js shader**, rather than relying on a collection of DOM elements.

---

## Technology

Built with:

- **JavaScript**
- **Three.js**
- **MediaPipe Hand Landmarker**
- **WebGL / GLSL shaders**
- **Vite**
- **WebRTC camera access**

## Architecture

```text
reference-hand-effect/
│
├── index.html
├── package.json
├── vite.config.js
│
├── public/
│   └── models/
│
├── scripts/
│   └── prepare.mjs
│
└── src/
    ├── main.js
    ├── tracker.js
    ├── rig.js
    └── shader.js
```

### `src/tracker.js`

Handles:

- Webcam access
- MediaPipe initialization
- Hand Landmarker inference
- GPU/CPU fallback
- Two-hand tracking
- 21 hand landmarks per hand

### `src/rig.js`

Handles:

- Gesture detection
- Gesture hysteresis
- Stable gesture timing
- Hand smoothing
- Spring-based movement
- Pinch focus
- Open-palm expansion
- Pointing interaction
- Idle animation

### `src/shader.js`

Contains the GPU shader responsible for the visual treatment, including the perspective-warped camera image and neon/posterized effects.

### `src/main.js`

Connects the camera, MediaPipe tracker, gesture rig, Three.js renderer, shader uniforms, and animation loop.

---

## Installation

Clone the repository:

```bash
git clone https://github.com/tubakhxn/REPOSITORY-NAME.git
cd REPOSITORY-NAME
```

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Then open the local Vite URL in your browser.

Camera access requires **localhost or HTTPS**.

---

## Production Build

Create a production build with:

```bash
npm run build
```

Preview the production build with:

```bash
npm run preview
```

---

## MediaPipe Model

During installation, the project attempts to prepare the MediaPipe WASM runtime and download the Hand Landmarker model automatically.

The application can also fall back to remote MediaPipe resources if the local assets are unavailable.

For fully offline operation, place the Hand Landmarker model inside:

```text
public/models/hand_landmarker.task
```

---

## Performance

The project is designed around real-time interaction.

Performance considerations include:

- GPU rendering through WebGL
- Three.js fullscreen shader rendering
- MediaPipe GPU delegate when available
- CPU fallback when GPU initialization fails
- Adaptive hand landmark smoothing
- Spring-based motion instead of snapping
- Limited device pixel ratio for rendering performance

---

## Creator

**Created by `tubakhxn`**

GitHub:

https://github.com/tubakhxn

Built as an experimental computer vision + creative coding project combining **hand tracking, real-time graphics, WebGL shaders, and interactive visual effects**.

---

## License

This project is intended for experimentation, learning, and creative development.
