// Newtonian n-body physics. Velocity Verlet, O(n^2) accelerations,
// collision detection, trajectory prediction. SI units throughout.

import { state } from './state.js';
import { G, PLANET_DATA, MOON_DATA, RENDER_SCALE } from './data.js';

export class Body {
  constructor(opts) {
    Object.assign(this, opts);
    this.px = opts.px || 0; this.py = opts.py || 0; this.pz = opts.pz || 0;
    this.vx = opts.vx || 0; this.vy = opts.vy || 0; this.vz = opts.vz || 0;
    this.ax = 0; this.ay = 0; this.az = 0;
    this.alive = true;
    this.isAsteroid = !!opts.isAsteroid;
    this.trail = [];
    this.trailMax = opts.isAsteroid ? 400 : 250;
  }
}

export function buildSolarSystem() {
  const bodies = [];
  for (const d of PLANET_DATA) {
    const isSun = d.name === 'SUN';
    const v = isSun ? 0 : Math.sqrt(G * PLANET_DATA[0].mass / d.r);
    bodies.push(new Body({
      name: d.name, mass: d.mass, displayRadius: d.rad, color: d.color,
      ring: !!d.ring, glow: !!d.glow,
      rotPeriod: d.rotPeriod, tilt: d.tilt,
      px: d.r, py: 0, pz: 0,
      vx: 0, vy: v, vz: 0,
    }));
  }
  const earth = bodies.find(b => b.name === 'EARTH');
  const vMoon = Math.sqrt(G * earth.mass / MOON_DATA.r);
  bodies.push(new Body({
    name: 'MOON', mass: MOON_DATA.mass, displayRadius: MOON_DATA.rad, color: MOON_DATA.color,
    rotPeriod: MOON_DATA.rotPeriod, tilt: MOON_DATA.tilt,
    // Render-only: Moon's true orbit (0.384 Gm) sits inside Earth's visual sphere
    // (~2 Gm). Visually expand the orbit relative to Earth so it's actually visible.
    // Physics still uses real positions/velocities — only rendering scales.
    parent: 'EARTH', displayOrbitScale: 20, tidallyLocked: true,
    px: earth.px + MOON_DATA.r, py: 0, pz: 0,
    vx: 0, vy: earth.vy + vMoon, vz: 0,
  }));
  state.bodies = bodies;
  state.simTime = 0;
}

export function computeAccelerations(arr) {
  const n = arr.length;
  for (let i = 0; i < n; i++) { arr[i].ax = 0; arr[i].ay = 0; arr[i].az = 0; }
  for (let i = 0; i < n; i++) {
    const a = arr[i]; if (!a.alive) continue;
    for (let j = i + 1; j < n; j++) {
      const b = arr[j]; if (!b.alive) continue;
      const dx = b.px - a.px, dy = b.py - a.py, dz = b.pz - a.pz;
      const r2 = dx*dx + dy*dy + dz*dz + 1e6; // softening
      const r = Math.sqrt(r2);
      const f = G / (r2 * r);
      a.ax += f * dx * b.mass; a.ay += f * dy * b.mass; a.az += f * dz * b.mass;
      b.ax -= f * dx * a.mass; b.ay -= f * dy * a.mass; b.az -= f * dz * a.mass;
    }
  }
}

export function step(arr, dt) {
  for (const b of arr) {
    if (!b.alive) continue;
    b.vx += 0.5 * b.ax * dt;
    b.vy += 0.5 * b.ay * dt;
    b.vz += 0.5 * b.az * dt;
    b.px += b.vx * dt;
    b.py += b.vy * dt;
    b.pz += b.vz * dt;
  }
  computeAccelerations(arr);
  for (const b of arr) {
    if (!b.alive) continue;
    b.vx += 0.5 * b.ax * dt;
    b.vy += 0.5 * b.ay * dt;
    b.vz += 0.5 * b.az * dt;
  }
}

export function detectImpact() {
  const bodies = state.bodies;
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i]; if (!a.alive || !a.isAsteroid) continue;
    for (let j = 0; j < bodies.length; j++) {
      if (i === j) continue;
      const b = bodies[j]; if (!b.alive) continue;
      const dx = b.px - a.px, dy = b.py - a.py, dz = b.pz - a.pz;
      const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (d < (a.displayRadius + b.displayRadius) * 1.02) return [a, b, i, j];
    }
  }
  return null;
}

// Forward shadow simulation against a copy of the world. Used to draw the
// dashed asteroid prediction line and decide whether the launch will hit.
export function predictTrajectory(asteroidProto, steps, dtPredict) {
  const clones = state.bodies.map(b => ({
    px: b.px, py: b.py, pz: b.pz,
    vx: b.vx, vy: b.vy, vz: b.vz,
    ax: 0, ay: 0, az: 0,
    mass: b.mass, alive: b.alive, displayRadius: b.displayRadius,
    name: b.name,
  }));
  clones.push({
    px: asteroidProto.px, py: asteroidProto.py, pz: asteroidProto.pz,
    vx: asteroidProto.vx, vy: asteroidProto.vy, vz: asteroidProto.vz,
    ax: 0, ay: 0, az: 0,
    mass: asteroidProto.mass, alive: true, displayRadius: 1e5,
    name: 'PROBE', isProbe: true,
  });
  computeAccelerations(clones);
  const path = [];
  let impactIdx = -1;
  const probe = clones[clones.length - 1];
  for (let s = 0; s < steps; s++) {
    step(clones, dtPredict);
    path.push([probe.px / RENDER_SCALE, probe.py / RENDER_SCALE, probe.pz / RENDER_SCALE]);
    for (let j = 0; j < clones.length - 1; j++) {
      const tgt = clones[j];
      const dx = tgt.px - probe.px, dy = tgt.py - probe.py, dz = tgt.pz - probe.pz;
      const d2 = dx*dx + dy*dy + dz*dz;
      const rSum = tgt.displayRadius + probe.displayRadius;
      if (d2 < rSum * rSum * 1.04) { impactIdx = j; s = steps; break; }
    }
  }
  return { path, impactIdx };
}
