export const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Screen space: uv in [0,1], y up. Corners ordered TL, TR, BR, BL.
export const fragmentShader = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform sampler2D uVideo;
uniform vec2  uRes;
uniform float uVidAspect;
uniform vec2  uTexel;
uniform vec2  uCorners[4];
uniform float uTime;
uniform float uPhase;   // hue clock, keeps cycling
uniform float uFocus;
uniform float uExpand;
uniform float uEnergy;
uniform float uPresence;
uniform vec3  uPoint;   // xy screen uv, z strength
uniform float uHasCam;

float cross2(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }

// Inverse bilinear (iq). u runs a->b, v runs a->d.
vec2 invBilinear(vec2 p, vec2 a, vec2 b, vec2 c, vec2 d) {
  vec2 e = b - a, f = d - a, g = a - b + c - d, h = p - a;
  float k2 = cross2(g, f);
  float k1 = cross2(e, f) + cross2(h, g);
  float k0 = cross2(h, e);
  if (abs(k2) < 0.0005) {
    float v = -k0 / (abs(k1) < 1e-6 ? 1e-6 : k1);
    float den = e.x + g.x * v;
    float u = abs(den) < 1e-6 ? (h.y - f.y * v) / (e.y + g.y * v + 1e-6) : (h.x - f.x * v) / den;
    return vec2(u, v);
  }
  float w = k1 * k1 - 4.0 * k0 * k2;
  if (w < 0.0) return vec2(-10.0);
  w = sqrt(w);
  float ik2 = 0.5 / k2;
  float v = (-k1 - w) * ik2;
  float den = e.x + g.x * v;
  float u = abs(den) < 1e-6 ? 0.0 : (h.x - f.x * v) / den;
  if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) {
    v = (-k1 + w) * ik2;
    den = e.x + g.x * v;
    u = abs(den) < 1e-6 ? 0.0 : (h.x - f.x * v) / den;
  }
  return vec2(u, v);
}

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

vec2 coverUv(vec2 uv) {
  float sa = uRes.x / uRes.y;
  vec2 s = sa > uVidAspect ? vec2(1.0, uVidAspect / sa) : vec2(sa / uVidAspect, 1.0);
  return (uv - 0.5) * s + 0.5;
}

vec3 cam(vec2 t) { return texture2D(uVideo, clamp(t, 0.001, 0.999)).rgb; }

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

// Full neon wheel. Luminance walks around the hue circle several times, so
// iso-brightness contours become rainbow rings; uPhase rotates the whole wheel
// over time so the colours keep changing.
vec3 neon(float t, float band) {
  float hue = fract(t);
  float sat = 0.86 + 0.14 * band;
  float val = 0.88 + 0.12 * fract(band * 2.3 + t * 3.0);
  return hsv2rgb(vec3(hue, sat, val));
}

vec3 effect(vec2 t, float amt) {
  vec3 base = cam(t);
  float lb = lum(base);

  // Local-contrast ("unsharp") field: keeps every facial detail (eyes, brows, lips,
  // glasses, stubble) instead of blurring them away.
  vec2 rs = uTexel * 1.7;   // tiny smoothing, kills sensor noise only
  float fine = lb * 0.4
    + (lum(cam(t + vec2(rs.x, 0.0))) + lum(cam(t - vec2(rs.x, 0.0)))
     + lum(cam(t + vec2(0.0, rs.y))) + lum(cam(t - vec2(0.0, rs.y)))) * 0.15;
  vec2 rl = uTexel * 9.0;   // wide neighbourhood mean
  float mean = (lum(cam(t + vec2(rl.x, 0.0))) + lum(cam(t - vec2(rl.x, 0.0)))
              + lum(cam(t + vec2(0.0, rl.y))) + lum(cam(t - vec2(0.0, rl.y)))
              + lum(cam(t + rl * 0.7)) + lum(cam(t - rl * 0.7))
              + lum(cam(t + vec2(rl.x, -rl.y) * 0.7)) + lum(cam(t + vec2(-rl.x, rl.y) * 0.7))) * 0.125;
  float field = fine + (fine - mean) * 1.1;

  // tiny drip, only on motion, so detail stays crisp
  float colId = floor(t.x * 60.0);
  float h = hash(vec2(colId, floor(uTime * 0.5)));
  float len = (0.002 + 0.02 * h) * (uExpand * 0.8 + uFocus * 0.6 + uEnergy * 1.4) * amt;
  float fb = field;
  for (int i = 1; i < 5; i++) {
    float l = lum(cam(t + vec2(0.0, float(i) / 4.0 * len)));
    if (l > lb + 0.1) fb = mix(fb, l, 0.5);
  }
  field = mix(field, fb, 0.5);

  // crisp black contours (1px Sobel) + hue steered by edge direction
  vec2 px = uTexel * 1.6;
  float l1 = lum(cam(t + vec2(px.x, 0.0))), l2 = lum(cam(t - vec2(px.x, 0.0)));
  float l3 = lum(cam(t + vec2(0.0, px.y))), l4 = lum(cam(t - vec2(0.0, px.y)));
  vec2 g = vec2(l1 - l2, l3 - l4);
  float edge = length(g) * 3.4;
  float ang = atan(g.y, g.x);

  // many hue cycles per face + fast spatial/temporal wobble = lots of neon colours at once
  float wob = sin(t.y * 11.0 + uTime * 1.7) * 0.05 + sin(t.x * 9.0 - uTime * 1.3) * 0.05;
  float phase = field * 2.2 + ang * 0.05 * smoothstep(0.2, 0.8, edge) + wob + uPhase;
  float band = fract(phase * 3.0);
  float p = mix(phase, floor(phase * 9.0) / 9.0, 0.65);   // hard neon steps
  vec3 col = neon(p, band);

  col *= 1.0 - smoothstep(0.55, 1.0, edge) * 0.9;
  col += vec3(1.0) * smoothstep(1.6, 2.6, edge) * 0.15;
  col = mix(col, col * 1.12, uFocus * 0.5);
  return col;
}

void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;

  // Clean live camera: mirrored, cover-fit, untouched brightness.
  vec2 cu = coverUv(uv);
  vec3 col;
  if (uHasCam > 0.5) {
    col = cam(vec2(1.0 - cu.x, cu.y));
  } else {
    float n = 0.5 + 0.5 * sin(uv.x * 3.0 + uTime * 0.2) * cos(uv.y * 2.4 - uTime * 0.17);
    col = mix(vec3(0.02, 0.02, 0.035), vec3(0.07, 0.04, 0.10), n);
  }

  vec2 A = uCorners[0], B = uCorners[1], C = uCorners[2], D = uCorners[3];
  vec2 q = invBilinear(uv, A, B, C, D);
  float pxLenU = length((B - A) * uRes) * 0.5 + length((C - D) * uRes) * 0.5;
  float pxLenV = length((D - A) * uRes) * 0.5 + length((C - B) * uRes) * 0.5;
  float dIn = min(min(q.x, 1.0 - q.x) * pxLenU, min(q.y, 1.0 - q.y) * pxLenV);
  float valid = step(-5.0, q.x);

  if (valid > 0.5 && dIn > -1.0) {
    // The quad is a WINDOW: same camera pixels as the background, same position,
    // only the area inside the fingers' shape gets the neon treatment.
    vec2 tq = vec2(1.0 - cu.x, cu.y);

    // pointing: liquid ripple around the fingertip
    vec2 pd = (uv - uPoint.xy) * vec2(aspect, 1.0);
    float pr = length(pd);
    float ripple = uPoint.z * exp(-pr * 7.0);
    tq += normalize(pd + 1e-5) * sin(pr * 40.0 - uTime * 6.0) * 0.012 * ripple;

    vec3 fx = effect(tq, 1.0 + ripple * 1.5);
    fx += vec3(1.0, 0.6, 1.0) * ripple * 0.2;
    float m = smoothstep(-0.5, 1.2, dIn) * uPresence;
    col = mix(col, fx, m);
  }

  col += (hash(uv * uRes + fract(uTime)) - 0.5) * 0.012;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
