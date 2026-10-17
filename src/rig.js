// Motion + gesture system. No DOM / WebGL here so it can be unit-tested in Node.
// Coordinates: screen uv, x right, y UP, both in [0,1]. Landmarks arrive already mapped.

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

const WRIST = 0, THUMB_TIP = 4, INDEX_TIP = 8, MIDDLE_MCP = 9;
const TIPS = [8, 12, 16, 20];
const PIPS = [6, 10, 14, 18];

// Gesture timing (seconds) + hysteresis thresholds
const PINCH_ENTER = 0.30, PINCH_EXIT = 0.50, PINCH_HOLD = 0.32, PINCH_RELEASE = 0.14;
const OPEN_ENTER = 0.82, OPEN_EXIT = 0.55, OPEN_HOLD = 0.38, OPEN_RELEASE = 0.18;
const POINT_HOLD = 0.28;
const LOST_GRACE = 0.5; // keep last pose briefly when tracking drops a frame or two

class HandState {
  constructor() {
    this.lm = null;          // smoothed [[x,y]*21]
    this.w = 0;              // presence weight 0..1
    this.lostFor = 99;
    this.pinchT = 0; this.pinched = false; this.pinchAmt = 0;
    this.openT = 0;  this.open = false;    this.openAmt = 0;
    this.pointT = 0; this.pointing = false; this.pointAmt = 0;
    this.ratio = 1;          // thumb-index distance / hand size
    this.frameAmt = 0;       // how much the hand makes an open "L" frame corner
    this.last = { x: 0.5, y: 0.5 };
  }

  update(dt, raw, aspect) {
    if (raw) {
      this.lostFor = 0;
      if (!this.lm) {
        this.lm = raw.map((p) => [p.x, p.y]);
      } else {
        for (let i = 0; i < 21; i++) {
          const p = raw[i], s = this.lm[i];
          const dx = (p.x - s[0]) * aspect, dy = p.y - s[1];
          const speed = Math.hypot(dx, dy) / Math.max(dt, 1e-3);
          // speed-adaptive smoothing: calm when still, responsive when moving
          const rate = 24 + clamp(speed, 0, 3) * 32;
          const a = 1 - Math.exp(-rate * dt);
          s[0] += (p.x - s[0]) * a;
          s[1] += (p.y - s[1]) * a;
        }
      }
    } else {
      this.lostFor += dt;
    }

    const present = this.lm && this.lostFor < LOST_GRACE;
    const fading = this.lm && !present;
    if (fading) { this.pinched = this.open = this.pointing = false; this.pinchT = this.openT = this.pointT = 0; }
    this.w = damp(this.w, present ? 1 : 0, present ? 7 : 2.4, dt);
    if (this.w < 0.003 && fading) { this.lm = null; this.w = 0; this.pinchT = this.openT = this.pointT = 0; this.pinched = this.open = this.pointing = false; }
    if (!this.lm) { this.pinchAmt = damp(this.pinchAmt, 0, 5, dt); this.openAmt = damp(this.openAmt, 0, 5, dt); this.pointAmt = damp(this.pointAmt, 0, 5, dt); return; }

    if (raw) this.measure(dt, aspect);

    this.pinchAmt = damp(this.pinchAmt, this.pinched ? 1 : 0, 5, dt);
    this.openAmt = damp(this.openAmt, this.open ? 1 : 0, 3.4, dt);
    this.pointAmt = damp(this.pointAmt, this.pointing ? 1 : 0, 6, dt);
    this.last.x = this.lm[INDEX_TIP][0]; this.last.y = this.lm[INDEX_TIP][1];
  }

  dist(a, b, aspect) {
    const p = this.lm[a], q = this.lm[b];
    return Math.hypot((p[0] - q[0]) * aspect, p[1] - q[1]);
  }

  measure(dt, aspect) {
    const size = Math.max(this.dist(WRIST, MIDDLE_MCP, aspect), 1e-4);
    this.ratio = this.dist(THUMB_TIP, INDEX_TIP, aspect) / size;

    let ext = [];
    for (let i = 0; i < 4; i++) {
      const r = this.dist(TIPS[i], WRIST, aspect) / Math.max(this.dist(PIPS[i], WRIST, aspect), 1e-4);
      ext.push(clamp((r - 1.0) / 0.4, 0, 1));
    }
    const openness = (ext[0] + ext[1] + ext[2] + ext[3]) / 4;
    const othersCurled = (ext[1] + ext[2] + ext[3]) / 3;
    this.frameAmt = smoothstep(0.35, 0.7, this.ratio);

    // Pinch: hysteresis + stable-hold timer
    const pinchCand = this.pinched ? this.ratio < PINCH_EXIT : this.ratio < PINCH_ENTER;
    if (pinchCand) this.pinchT += dt; else this.pinchT = Math.max(0, this.pinchT - dt * 3);
    if (!this.pinched && this.pinchT >= PINCH_HOLD) this.pinched = true;
    if (this.pinched && !pinchCand && this.pinchT <= Math.max(0, PINCH_HOLD - PINCH_RELEASE)) this.pinched = false;
    if (this.pinched && !pinchCand) this.pinchT -= dt * 3;

    // Open palm
    const openCand = this.open ? openness > OPEN_EXIT : openness > OPEN_ENTER && this.ratio > 0.5;
    if (openCand) this.openT += dt; else this.openT = Math.max(0, this.openT - dt * 2.5);
    if (!this.open && this.openT >= OPEN_HOLD) this.open = true;
    if (this.open && !openCand && this.openT <= Math.max(0, OPEN_HOLD - OPEN_RELEASE)) this.open = false;
    if (this.open && !openCand) this.openT -= dt * 2.5;

    // Deliberate pointing: index out, others curled, not pinching
    const pointCand = ext[0] > 0.75 && othersCurled < 0.35 && !this.pinched;
    if (pointCand) this.pointT += dt; else this.pointT = Math.max(0, this.pointT - dt * 4);
    this.pointing = this.pointT >= POINT_HOLD;
  }
}

class Spring2 {
  constructor(x, y) { this.x = x; this.y = y; this.vx = 0; this.vy = 0; }
  step(tx, ty, k, zeta, dt) {
    const c = 2 * zeta * Math.sqrt(k);
    const n = 2, h = dt / n; // two substeps keeps stiff springs stable
    for (let i = 0; i < n; i++) {
      this.vx += ((tx - this.x) * k - this.vx * c) * h;
      this.vy += ((ty - this.y) * k - this.vy * c) * h;
      this.x += this.vx * h;
      this.y += this.vy * h;
    }
  }
}

export class Rig {
  constructor() {
    this.slots = [new HandState(), new HandState()]; // 0 = left on screen, 1 = right
    this.springs = [
      new Spring2(0.3, 0.6), new Spring2(0.7, 0.6), new Spring2(0.7, 0.4), new Spring2(0.3, 0.4)
    ]; // TL, TR, BR, BL
    this.thick = 1;
    this.focus = 0; this.expand = 0; this.energy = 0; this.presence = 0;
    this.phase = 0; this.time = 0;
    this.point = { x: 0.5, y: 0.5, s: 0, px: 0.5, py: 0.5 };
    this.pointSpring = new Spring2(0.5, 0.5);
    this.corners = new Float32Array(8);
    this.mode = 'idle';
    // seed uniforms
    this.writeCorners();
  }

  assignHands(hands, aspect) {
    const out = [null, null];
    if (!hands || hands.length === 0) return out;
    const wx = (h) => h[WRIST].x;
    if (hands.length >= 2) {
      const s = [...hands].sort((a, b) => wx(a) - wx(b));
      out[0] = s[0]; out[1] = s[s.length - 1];
    } else {
      const h = hands[0];
      const l = this.slots[0], r = this.slots[1];
      let slot = wx(h) < 0.5 ? 0 : 1;
      if (l.lm && r.lm) {
        const dl = Math.hypot((l.lm[WRIST][0] - h[WRIST].x) * aspect, l.lm[WRIST][1] - h[WRIST].y);
        const dr = Math.hypot((r.lm[WRIST][0] - h[WRIST].x) * aspect, r.lm[WRIST][1] - h[WRIST].y);
        slot = dl <= dr ? 0 : 1;
      } else if (l.lm && !r.lm) slot = wx(h) < l.lm[WRIST][0] - 0.25 ? 0 : (Math.abs(wx(h) - l.lm[WRIST][0]) < 0.3 ? 0 : 1);
      else if (r.lm && !l.lm) slot = Math.abs(wx(h) - r.lm[WRIST][0]) < 0.3 ? 1 : 0;
      out[slot] = h;
    }
    return out;
  }

  idleTargets(t) {
    // A thin, slowly breathing neon strip: alive, but it never looks like a stray blob.
    const cx = 0.5 + 0.08 * Math.sin(t * 0.23) + 0.02 * Math.sin(t * 0.61 + 2.0);
    const cy = 0.5 + 0.05 * Math.sin(t * 0.31 + 1.0);
    const hw = 0.26 + 0.03 * Math.sin(t * 0.41);
    const hh = 0.006 + 0.004 * (0.5 + 0.5 * Math.sin(t * 0.9));
    const th = 0.06 * Math.sin(t * 0.17);
    const c = Math.cos(th), s = Math.sin(th);
    const base = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
    return base.map(([bx, by]) => {
      const px = bx * hw, py = by * hh;
      return [cx + px * c - py * s, cy + px * s + py * c];
    });
  }

  // manual: optional {cx, cy, hw, hh} fallback pointer-driven target (only used without camera)
  update(dtRaw, hands, aspect, manual) {
    const dt = clamp(dtRaw, 1 / 240, 1 / 24);
    this.time += dt;
    const t = this.time;

    const assigned = this.assignHands(hands, aspect);
    this.slots[0].update(dt, assigned[0], aspect);
    this.slots[1].update(dt, assigned[1], aspect);
    const [L, R] = this.slots;

    const idle = this.idleTargets(t);
    const targets = [[0, 0], [0, 0], [0, 0], [0, 0]];
    const wSlot = [L.w, R.w];
    const mids = [null, null];
    const handT = [null, null, null, null];

    for (let s = 0; s < 2; s++) {
      const H = this.slots[s];
      if (!H.lm) continue;
      const a = H.lm[THUMB_TIP], b = H.lm[INDEX_TIP];
      const top = a[1] >= b[1] ? a : b, bot = a[1] >= b[1] ? b : a;
      mids[s] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      if (s === 0) { handT[0] = top; handT[3] = bot; } else { handT[1] = top; handT[2] = bot; }
    }

    // One hand only: a narrow strip between that hand's thumb and index tips
    if (!manual && handT[0] && !handT[1]) {
      handT[1] = [handT[0][0] + 0.012, handT[0][1]]; handT[2] = [handT[3][0] + 0.012, handT[3][1]];
      mids[1] = mids[0]; wSlot[1] = wSlot[0];
    } else if (!manual && handT[1] && !handT[0]) {
      handT[0] = [handT[1][0] - 0.012, handT[1][1]]; handT[3] = [handT[2][0] - 0.012, handT[2][1]];
      mids[0] = mids[1]; wSlot[0] = wSlot[1];
    }

    if (manual) {
      const { cx, cy, hw, hh } = manual;
      handT[0] = [cx - hw, cy + hh]; handT[3] = [cx - hw, cy - hh];
      handT[1] = [cx + hw, cy + hh]; handT[2] = [cx + hw, cy - hh];
      mids[0] = [cx - hw, cy]; mids[1] = [cx + hw, cy];
      wSlot[0] = wSlot[1] = 1;
    }

    // Quad thickness: collapses into a thin line between hands when both hands are present
    // but not forming a frame (relaxed / closed hands); idle & single-hand stay full.
    let thickTarget = 1;
    if (!manual && L.w > 0.5 && R.w > 0.5) {
      const f = (H) => Math.max(H.frameAmt, H.openAmt);
      thickTarget = 0.04 + 0.96 * Math.min(f(L), f(R));
    }
    this.thick = damp(this.thick, thickTarget, thickTarget > this.thick ? 4.5 : 3.2, dt);

    const map = [[0, 0], [1, 1], [1, 2], [0, 3]]; // [slot, cornerIndex]
    for (let i = 0; i < 4; i++) {
      const s = map[i][0];
      let tx = idle[i][0], ty = idle[i][1];
      if (handT[i] && mids[s]) {
        const m = mids[s];
        const hx = m[0] + (handT[i][0] - m[0]) * this.thick;
        const hy = m[1] + (handT[i][1] - m[1]) * this.thick;
        const w = wSlot[s];
        tx = tx + (hx - tx) * w;
        ty = ty + (hy - ty) * w;
      }
      targets[i] = [tx, ty];
    }

    // Open palm -> graceful expansion about the quad centre
    const openMax = Math.max(L.openAmt * (L.w > 0.5 ? 1 : 0), R.openAmt * (R.w > 0.5 ? 1 : 0));
    this.expand = damp(this.expand, openMax, 2.6, dt);
    const cxm = (targets[0][0] + targets[1][0] + targets[2][0] + targets[3][0]) / 4;
    const cym = (targets[0][1] + targets[1][1] + targets[2][1] + targets[3][1]) / 4;
    const sc = 1 + 0.28 * this.expand;
    for (const tg of targets) { tg[0] = cxm + (tg[0] - cxm) * sc; tg[1] = cym + (tg[1] - cym) * sc; }

    // Pinch -> focus. The pinched hand leads (stiff), the other side trails (looser): a "pull" feel.
    const pin = [L.pinchAmt * (L.w > 0.5 ? 1 : 0), R.pinchAmt * (R.w > 0.5 ? 1 : 0)];
    const focusT = Math.max(pin[0], pin[1]);
    this.focus = damp(this.focus, focusT, 3.2, dt);

    let energySum = 0;
    for (let i = 0; i < 4; i++) {
      const s = map[i][0];
      const w = wSlot[s];
      let k = 9 + (230 - 9) * w;
      if (focusT > 0.01) {
        const lead = pin[s], other = pin[1 - s];
        k *= 1 + 0.3 * lead - 0.45 * other * (1 - lead);
      }
      const sp = this.springs[i];
      sp.step(targets[i][0], targets[i][1], k, 0.9, dt);
      energySum += Math.hypot(sp.vx * aspect, sp.vy);
    }
    this.energy = damp(this.energy, clamp(energySum / 4 / 1.6, 0, 1), 4, dt);

    // Pointing: ripple that follows the fingertip with inertia
    let pointS = 0, pt = null;
    for (const H of this.slots) if (H.lm && H.pointAmt > pointS) { pointS = H.pointAmt; pt = H.lm[INDEX_TIP]; }
    if (pt) { this.point.px = pt[0]; this.point.py = pt[1]; }
    this.pointSpring.step(this.point.px, this.point.py, 40, 0.8, dt);
    this.point.x = this.pointSpring.x; this.point.y = this.pointSpring.y;
    this.point.s = damp(this.point.s, pointS, pointS > this.point.s ? 6 : 3, dt);

    const anyHand = L.w > 0.05 || R.w > 0.05 || !!manual;
    this.presence = damp(this.presence, 1, 2.0, dt);
    this.phase += dt * (0.30 + this.energy * 1.1 + this.focus * 0.3 + this.expand * 0.25);
    this.mode = !anyHand ? 'idle' : (focusT > 0.5 ? 'focus' : (this.expand > 0.5 ? 'expanded' : 'hand'));
    this.writeCorners();
  }

  writeCorners() {
    for (let i = 0; i < 4; i++) {
      this.corners[i * 2] = this.springs[i].x;
      this.corners[i * 2 + 1] = this.springs[i].y;
    }
  }
}
