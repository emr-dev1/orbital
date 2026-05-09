// Tidal disruption — when a planet enters a black hole's tidal radius,
// stream particles flow from its surface into the BH (the "atom by atom"
// shred the user wants to see), and the planet's mass is gradually
// transferred into the BH. Once the body's mass drops below 10% of its
// original, it's fully consumed and removed from the simulation.
//
// Tidal radius (Roche-limit-ish):
//   r_tidal = R_body × (2 · M_BH / M_body)^(1/3)
// We use it as the "danger zone" — particles spawn from the body's
// surface starting at 5 × r_tidal and scale up sharply as the body sinks
// deeper. Mass drain ramps in within 2 × r_tidal.

import * as THREE from 'three';
import { state } from './state.js';
import { RENDER_SCALE } from './data.js';
import { scene } from './scene.js';
import { rebuildVisuals } from './visuals.js';

// Per-particle: position + velocity in render units, BH index, life remaining.
const STREAM_CAPACITY = 6000;
const _stream = {
  count: 0,
  px: new Float32Array(STREAM_CAPACITY),
  py: new Float32Array(STREAM_CAPACITY),
  pz: new Float32Array(STREAM_CAPACITY),
  vx: new Float32Array(STREAM_CAPACITY),
  vy: new Float32Array(STREAM_CAPACITY),
  vz: new Float32Array(STREAM_CAPACITY),
  bhRef:    new Array(STREAM_CAPACITY).fill(null),
  // Track the initial spawn distance so we can colour-grade life by depth
  // toward the event horizon (yellow far → red close).
  startR:   new Float32Array(STREAM_CAPACITY),
  life:     new Float32Array(STREAM_CAPACITY),
  lifeMax:  new Float32Array(STREAM_CAPACITY),
};

const streamGeo = new THREE.BufferGeometry();
streamGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(STREAM_CAPACITY * 3), 3));
streamGeo.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(STREAM_CAPACITY * 3), 3));
const streamMat = new THREE.PointsMaterial({
  size: 2.6, sizeAttenuation: false,
  vertexColors: true,
  transparent: true, opacity: 0.95,
  blending: THREE.AdditiveBlending, depthWrite: false,
});
const streamPoints = new THREE.Points(streamGeo, streamMat);
streamPoints.frustumCulled = false;
scene.add(streamPoints);
streamGeo.setDrawRange(0, 0);

// Spawn one particle from a random point on `body`'s surface, biased to
// drift toward `bh`. Initial velocity is small; the per-frame inverse-r²
// pull does the spiraling-in.
function spawnStreamParticle(body, bh) {
  if (_stream.count >= STREAM_CAPACITY) return;
  // Random direction on the unit sphere.
  const theta = Math.random() * Math.PI * 2;
  const phi   = Math.acos(2 * Math.random() - 1);
  const sx = Math.sin(phi) * Math.cos(theta);
  const sy = Math.cos(phi);
  const sz = Math.sin(phi) * Math.sin(theta);
  // Surface point in physical metres.
  const R = body.displayRadius;
  const wx = body.px + sx * R;
  const wy = body.py + sy * R;
  const wz = body.pz + sz * R;
  // Convert to render units.
  const rxRender = wx / RENDER_SCALE;
  const ryRender = wy / RENDER_SCALE;
  const rzRender = wz / RENDER_SCALE;
  // Starting distance to BH (render units).
  const dx = (bh.px - wx) / RENDER_SCALE;
  const dy = (bh.py - wy) / RENDER_SCALE;
  const dz = (bh.pz - wz) / RENDER_SCALE;
  const r0 = Math.hypot(dx, dy, dz);

  const k = _stream.count++;
  _stream.px[k] = rxRender;
  _stream.py[k] = ryRender;
  _stream.pz[k] = rzRender;
  // Slight tangential push so particles spiral instead of falling straight in.
  // Cross random-axis × radial gives a roughly tangent vector.
  const tx = -dy, ty = dx, tz = 0;
  const tlen = Math.hypot(tx, ty, tz) || 1;
  const tang = 0.4 + Math.random() * 0.5;     // render-units/sec
  _stream.vx[k] = (tx / tlen) * tang + (Math.random() - 0.5) * 0.3;
  _stream.vy[k] = (ty / tlen) * tang + (Math.random() - 0.5) * 0.3;
  _stream.vz[k] = (tz / tlen) * tang + (Math.random() - 0.5) * 0.3;
  _stream.bhRef[k] = bh;
  _stream.startR[k] = r0;
  const life = 4.0 + Math.random() * 3.0;     // 4-7 real seconds
  _stream.life[k]    = life;
  _stream.lifeMax[k] = life;
}

// Vertex-color helper: yellow → orange → red along [0, 1].
function gradientRGB(t, out, idx) {
  const c = Math.max(0, Math.min(1, t));
  // Hot inner: yellow-white. Cold outer: deep red. Lerp in two segments.
  if (c < 0.5) {
    const u = c / 0.5;
    out[idx]   = 1.0;                          // R
    out[idx+1] = 0.95 - 0.40 * u;              // G: 0.95 → 0.55
    out[idx+2] = 0.55 - 0.45 * u;              // B: 0.55 → 0.10
  } else {
    const u = (c - 0.5) / 0.5;
    out[idx]   = 1.0;                          // R stays high
    out[idx+1] = 0.55 - 0.45 * u;              // G: 0.55 → 0.10
    out[idx+2] = 0.10 - 0.10 * u;              // B: 0.10 → 0
  }
}

// Per-frame: spawn from victims, advance particles toward BHs, drain mass,
// destroy fully-consumed bodies. Real-time animation, decoupled from warp.
export function updateTidalStreams(realDt) {
  // ── Identify (BH, victim) pairs and spawn / drain. ──────────────────
  const bhs = state.bodies.filter(b => b.isBlackHole && b.alive);
  if (bhs.length > 0) {
    for (const bh of bhs) {
      for (const b of state.bodies) {
        if (!b.alive || b === bh || b.isBlackHole || b.isAsteroid) continue;
        // Tidal radius = R_body · (2 M_BH / M_body)^(1/3)
        const r_tidal = b.displayRadius * Math.pow(2 * bh.mass / b.mass, 1/3);
        const dx = b.px - bh.px;
        const dy = b.py - bh.py;
        const dz = b.pz - bh.pz;
        const r = Math.hypot(dx, dy, dz);
        const interactionR = r_tidal * 5;
        if (r >= interactionR) continue;

        // Track original mass once per body so destruction triggers at
        // 10% of pre-encounter mass, not 10% of "current" (would never
        // resolve as drain shrinks the threshold too).
        if (b.originalMass === undefined) b.originalMass = b.mass;

        // Particle spawn rate scales with depth in tidal zone — gentle
        // wisp at the boundary, torrent inside r_tidal.
        const depth = 1 - r / interactionR;       // 0 at edge, 1 at centre
        const rate = 8 + 80 * depth * depth;       // particles per real second
        const n = Math.max(0, Math.round(rate * realDt));
        for (let i = 0; i < n; i++) spawnStreamParticle(b, bh);

        // Mass drain: only inside 2 × r_tidal. Full speed at r_tidal,
        // zero at the boundary. ~25% of mass per second at peak.
        if (r < r_tidal * 2) {
          const drainDepth = 1 - r / (r_tidal * 2);
          const fracPerSec = 0.25 * drainDepth * drainDepth;
          const drained = b.mass * fracPerSec * realDt;
          b.mass -= drained;
          bh.mass += drained;
        }

        // Destroy the body when it's down to ~10% of original — beyond
        // this it'd need a structural-integrity model we're not doing.
        // The remaining mass is dumped into the BH so conservation holds.
        if (b.mass < b.originalMass * 0.10) {
          bh.mass += b.mass;
          if (bh.events === undefined) bh.events = [];
          if (bh.accretedCount === undefined) bh.accretedCount = 0;
          bh.accretedCount += 1;
          bh.events.unshift({
            time: state.simTime, type: 'ACCRETION',
            description: `TIDALLY DISRUPTED ${b.name} · +${(b.originalMass / 1.989e30).toExponential(2)} M☉`,
          });
          if (bh.events.length > 10) bh.events.length = 10;
          b.alive = false;
        }
      }
    }
  }

  // ── Advance particles. ────────────────────────────────────────────────
  if (_stream.count > 0) {
    const pos = streamGeo.attributes.position.array;
    const col = streamGeo.attributes.color.array;
    let alive = 0;
    for (let i = 0; i < _stream.count; i++) {
      if (_stream.life[i] <= 0) continue;
      const bh = _stream.bhRef[i];
      if (!bh || !bh.alive) { _stream.life[i] = 0; continue; }
      const bhx = bh.px / RENDER_SCALE;
      const bhy = bh.py / RENDER_SCALE;
      const bhz = bh.pz / RENDER_SCALE;
      const dx = bhx - _stream.px[i];
      const dy = bhy - _stream.py[i];
      const dz = bhz - _stream.pz[i];
      const r = Math.hypot(dx, dy, dz);
      if (r < 0.3) {                       // close enough → consumed by horizon
        _stream.life[i] = 0;
        continue;
      }
      // Inverse-r pull (not r² — r² is too aggressive and particles slam
      // straight in; r feels like proper accretion-disk in-spiral).
      const pullStrength = 12.0 / (r + 0.3);
      _stream.vx[i] += (dx / r) * pullStrength * realDt;
      _stream.vy[i] += (dy / r) * pullStrength * realDt;
      _stream.vz[i] += (dz / r) * pullStrength * realDt;
      // Cap so very-old particles don't fling at light speed.
      const v = Math.hypot(_stream.vx[i], _stream.vy[i], _stream.vz[i]);
      const VMAX = 12;
      if (v > VMAX) {
        _stream.vx[i] *= VMAX / v;
        _stream.vy[i] *= VMAX / v;
        _stream.vz[i] *= VMAX / v;
      }
      _stream.px[i] += _stream.vx[i] * realDt;
      _stream.py[i] += _stream.vy[i] * realDt;
      _stream.pz[i] += _stream.vz[i] * realDt;
      _stream.life[i] -= realDt;
      if (_stream.life[i] <= 0) continue;

      // Gradient based on depth toward BH (1 = at start, 0 = at horizon).
      const depthT = 1 - Math.max(0, Math.min(1, r / Math.max(_stream.startR[i], 0.001)));
      pos[alive*3]   = _stream.px[i];
      pos[alive*3+1] = _stream.py[i];
      pos[alive*3+2] = _stream.pz[i];
      gradientRGB(depthT, col, alive*3);
      alive++;
    }
    streamGeo.attributes.position.needsUpdate = true;
    streamGeo.attributes.color.needsUpdate = true;
    streamGeo.setDrawRange(0, alive);

    // Compact dead particles in place.
    if (alive < _stream.count) {
      let w = 0;
      for (let i = 0; i < _stream.count; i++) {
        if (_stream.life[i] <= 0) continue;
        if (w !== i) {
          _stream.px[w] = _stream.px[i]; _stream.py[w] = _stream.py[i]; _stream.pz[w] = _stream.pz[i];
          _stream.vx[w] = _stream.vx[i]; _stream.vy[w] = _stream.vy[i]; _stream.vz[w] = _stream.vz[i];
          _stream.bhRef[w] = _stream.bhRef[i];
          _stream.startR[w] = _stream.startR[i];
          _stream.life[w] = _stream.life[i]; _stream.lifeMax[w] = _stream.lifeMax[i];
        }
        w++;
      }
      _stream.count = w;
    }
  } else {
    streamGeo.setDrawRange(0, 0);
  }

  // ── Sweep destroyed bodies (mass-drained to nothing). ────────────────
  // Keep the array stable when nothing died — common case is no change.
  let anyDead = false;
  for (const b of state.bodies) if (!b.alive) { anyDead = true; break; }
  if (anyDead) {
    state.bodies = state.bodies.filter(b => b.alive);
    rebuildVisuals();
  }
}
