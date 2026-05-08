// Main asteroid belt — ~1500 particles between 2.2 and 3.2 AU on independent
// Keplerian orbits. Each particle has its own (a, e, i, Ω, ω, M₀) sampled
// once at build time; positions are computed analytically from state.simTime
// every frame, so the belt rotates at realistic angular rates without
// touching the n-body integrator (which would melt under O(n²) for 10³ extra
// bodies). They don't perturb the planets and the planets don't perturb
// them — fine for visualisation, missing real Kirkwood gaps.

import * as THREE from 'three';
import { state } from './state.js';
import { scene } from './scene.js';
import { G, AU, RENDER_SCALE } from './data.js';

const BELT_INNER_AU = 2.2;
const BELT_OUTER_AU = 3.2;
const N_ASTEROIDS   = 1500;
const DEG = Math.PI / 180;

const elements = []; // packed flat: [a, e, i, Ω, ω, M0, n] × N
let belt = null;

function solveKepler(M, e) {
  // Wrap M to (−π, π] for fast Newton convergence on high-e orbits.
  M = ((M + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 30; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-10) break;
  }
  return E;
}

export function buildAsteroidBelt() {
  if (belt) {
    scene.remove(belt);
    belt.geometry.dispose();
    belt.material.dispose();
  }
  elements.length = 0;

  const sun = state.bodies.find(b => b.name === 'SUN');
  const muSun = G * (sun ? sun.mass : 1.989e30);

  for (let i = 0; i < N_ASTEROIDS; i++) {
    const a = (BELT_INNER_AU + Math.random() * (BELT_OUTER_AU - BELT_INNER_AU)) * AU;
    const n = Math.sqrt(muSun / (a * a * a));      // mean motion (rad/s)
    elements.push({
      a, e: Math.random() * 0.2,
      // Triangular ±~8° inclination — most particles cluster near ecliptic.
      i: ((Math.random() - 0.5) + (Math.random() - 0.5)) * 8 * DEG,
      Omega: Math.random() * 2 * Math.PI,
      omega: Math.random() * 2 * Math.PI,
      M0:    Math.random() * 2 * Math.PI,
      n,
    });
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N_ASTEROIDS * 3), 3));
  // Slight per-particle colour variation would need a custom shader; for
  // now a single warm-grey reads as "rocky debris" against the dark scene.
  const mat = new THREE.PointsMaterial({
    color: 0xc0a880, size: 1.5, sizeAttenuation: false,
    transparent: true, opacity: 0.7,
  });
  belt = new THREE.Points(geo, mat);
  belt.frustumCulled = false;
  scene.add(belt);
}

// Per-frame: solve Kepler for each particle at the current simTime and write
// world-frame positions into the Points buffer. Roughly 1500 × ~5 Newton
// iterations per frame — negligible at 60 fps.
export function updateAsteroidBelt() {
  if (!belt) return;
  const sun = state.bodies.find(b => b.name === 'SUN');
  if (!sun) return;
  const t = state.simTime;
  const arr = belt.geometry.attributes.position.array;

  for (let k = 0; k < elements.length; k++) {
    const el = elements[k];
    const M = el.M0 + el.n * t;
    const E = solveKepler(M, el.e);
    const cosE = Math.cos(E), sinE = Math.sin(E);
    const xp = el.a * (cosE - el.e);
    const yp = el.a * Math.sqrt(1 - el.e * el.e) * sinE;
    const cw = Math.cos(el.omega), sw = Math.sin(el.omega);
    const ci = Math.cos(el.i),     si = Math.sin(el.i);
    const cO = Math.cos(el.Omega), sO = Math.sin(el.Omega);
    // Standard ecliptic (z = north) Cartesian
    const X = (cO*cw - sO*ci*sw) * xp + (-cO*sw - sO*ci*cw) * yp;
    const Y = (sO*cw + cO*ci*sw) * xp + (-sO*sw + cO*ci*cw) * yp;
    const Z = (si*sw)            * xp + (si*cw)             * yp;
    // Map to our world frame (Y up): (X, Z, −Y) + Sun position (Sun wobbles
    // a few Mm from origin due to barycenter, so use its actual position).
    arr[k*3]   = (X + sun.px) / RENDER_SCALE;
    arr[k*3+1] = (Z + sun.py) / RENDER_SCALE;
    arr[k*3+2] = (-Y + sun.pz) / RENDER_SCALE;
  }
  belt.geometry.attributes.position.needsUpdate = true;
}

export function setBeltVisible(v) { if (belt) belt.visible = v; }
