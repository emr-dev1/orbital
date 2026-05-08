// Newtonian n-body physics with a 1PN GR correction near the Sun and a
// 4th-order Yoshida symplectic integrator. SI units throughout.
//
// Initial conditions: J2000 heliocentric orbital elements for each planet
// (and geocentric for the Moon), converted to Cartesian state via Kepler.
// Barycentric momentum is zeroed so the system COM stays at the origin.

import { state } from './state.js';
import { G, ORBITAL_ELEMENTS, MOON_ELEMENTS, PLANET_DATA, MOON_DATA, RENDER_SCALE, C_LIGHT } from './data.js';

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

// =====================================================================
// Kepler-element → Cartesian state
// =====================================================================

// Solve Kepler's equation M = E − e·sin E for E, by Newton iteration.
function solveKepler(M, e, tol = 1e-12) {
  // wrap M into (−π, π] to keep Newton tame for high eccentricities
  M = ((M + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  let E = e < 0.8 ? M : Math.PI;
  for (let iter = 0; iter < 60; iter++) {
    const f  = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    const dE = f / fp;
    E -= dE;
    if (Math.abs(dE) < tol) break;
  }
  return E;
}

// Standard astronomy frame uses z = ecliptic-north. Our world frame uses
// y = ecliptic-north (three.js convention). Output is remapped so the
// caller can drop it straight into Body fields.
function elementsToState({ a, e, i, Omega, omega, M0 }, mu) {
  const E = solveKepler(M0, e);
  const cosE = Math.cos(E), sinE = Math.sin(E);
  // Position and velocity in the perifocal (orbit) frame (focus at origin)
  const xp = a * (cosE - e);
  const yp = a * Math.sqrt(1 - e*e) * sinE;
  const r  = a * (1 - e * cosE);
  const factor = Math.sqrt(mu * a) / r;
  const vxp = factor * (-sinE);
  const vyp = factor * Math.sqrt(1 - e*e) * cosE;
  // Rotation R_z(Ω) · R_x(i) · R_z(ω)
  const cw = Math.cos(omega), sw = Math.sin(omega);
  const ci = Math.cos(i),     si = Math.sin(i);
  const cO = Math.cos(Omega), sO = Math.sin(Omega);
  const R11 =  cO*cw - sO*ci*sw;
  const R12 = -cO*sw - sO*ci*cw;
  const R21 =  sO*cw + cO*ci*sw;
  const R22 = -sO*sw + cO*ci*cw;
  const R31 =  si*sw;
  const R32 =  si*cw;
  const X  = R11*xp  + R12*yp;
  const Y  = R21*xp  + R22*yp;
  const Z  = R31*xp  + R32*yp;
  const VX = R11*vxp + R12*vyp;
  const VY = R21*vxp + R22*vyp;
  const VZ = R31*vxp + R32*vyp;
  // Standard (X, Y, Z=ecliptic north) → world (X, Y=Z, Z=−Y)
  return { px: X, py: Z, pz: -Y, vx: VX, vy: VZ, vz: -VY };
}

// Subtract the system barycenter and its velocity so total momentum = 0
// and the centre of mass sits at the origin. Sun ends up wobbling slightly
// due to Jupiter, exactly like the real solar system.
function zeroBarycenter(bodies) {
  let M = 0, cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0;
  for (const b of bodies) {
    M  += b.mass;
    cx += b.mass * b.px; cy += b.mass * b.py; cz += b.mass * b.pz;
    vx += b.mass * b.vx; vy += b.mass * b.vy; vz += b.mass * b.vz;
  }
  cx /= M; cy /= M; cz /= M;
  vx /= M; vy /= M; vz /= M;
  for (const b of bodies) {
    b.px -= cx; b.py -= cy; b.pz -= cz;
    b.vx -= vx; b.vy -= vy; b.vz -= vz;
  }
}

export function buildSolarSystem() {
  const bodies = [];

  const sunData = PLANET_DATA[0];
  bodies.push(new Body({
    name: 'SUN', mass: sunData.mass, displayRadius: sunData.rad, color: sunData.color,
    glow: true, rotPeriod: sunData.rotPeriod, tilt: sunData.tilt,
  }));

  const muSun = G * sunData.mass;
  for (let k = 1; k < PLANET_DATA.length; k++) {
    const d = PLANET_DATA[k];
    const init = elementsToState(ORBITAL_ELEMENTS[d.name], muSun);
    bodies.push(new Body({
      name: d.name, mass: d.mass, displayRadius: d.rad, color: d.color,
      ring: !!d.ring, rotPeriod: d.rotPeriod, tilt: d.tilt,
      ...init,
    }));
  }

  // Moon — geocentric elements, then converted to heliocentric by adding Earth's state.
  const earth = bodies.find(b => b.name === 'EARTH');
  const muEarth = G * earth.mass;
  const moonRel = elementsToState(MOON_ELEMENTS, muEarth);
  bodies.push(new Body({
    name: 'MOON', mass: MOON_DATA.mass, displayRadius: MOON_DATA.rad, color: MOON_DATA.color,
    rotPeriod: MOON_DATA.rotPeriod, tilt: MOON_DATA.tilt,
    parent: 'EARTH', displayOrbitScale: 20, tidallyLocked: true,
    px: earth.px + moonRel.px, py: earth.py + moonRel.py, pz: earth.pz + moonRel.pz,
    vx: earth.vx + moonRel.vx, vy: earth.vy + moonRel.vy, vz: earth.vz + moonRel.vz,
  }));

  zeroBarycenter(bodies);
  state.bodies = bodies;
  state.simTime = 0;
}

// =====================================================================
// Forces
// =====================================================================

const C2 = C_LIGHT * C_LIGHT;

export function computeAccelerations(arr) {
  const n = arr.length;
  for (let i = 0; i < n; i++) { arr[i].ax = 0; arr[i].ay = 0; arr[i].az = 0; }

  // O(n²) Newtonian gravity with a small Plummer-style softening to keep
  // close approaches numerically tame.
  for (let i = 0; i < n; i++) {
    const a = arr[i]; if (!a.alive) continue;
    for (let j = i + 1; j < n; j++) {
      const b = arr[j]; if (!b.alive) continue;
      const dx = b.px - a.px, dy = b.py - a.py, dz = b.pz - a.pz;
      const r2 = dx*dx + dy*dy + dz*dz + 1e6;
      const r  = Math.sqrt(r2);
      const f  = G / (r2 * r);
      const fa = f * b.mass, fb = f * a.mass;
      a.ax += fa*dx; a.ay += fa*dy; a.az += fa*dz;
      b.ax -= fb*dx; b.ay -= fb*dy; b.az -= fb*dz;
    }
  }

  // First post-Newtonian (1PN) correction in the Sun's field, standard form:
  //   a_PN = (GM/c²r³) · [(4GM/r − v²)·r⃗ + 4(v⃗·r⃗)·v⃗]
  // where r⃗ = body − Sun, v⃗ = body − Sun velocity.
  // Sun's recoil is negligible (M_sun dominates) so we apply it only to the
  // other bodies. Mercury picks up its 43″/century perihelion advance from
  // this term; outer planets' contribution is invisibly small.
  const sun = arr.find(b => b.name === 'SUN');
  if (sun && sun.alive) {
    const GM = G * sun.mass;
    for (const b of arr) {
      if (!b.alive || b === sun) continue;
      const dx = b.px - sun.px, dy = b.py - sun.py, dz = b.pz - sun.pz;
      const r2 = dx*dx + dy*dy + dz*dz + 1e6;
      const r  = Math.sqrt(r2);
      const dvx = b.vx - sun.vx, dvy = b.vy - sun.vy, dvz = b.vz - sun.vz;
      const v2     = dvx*dvx + dvy*dvy + dvz*dvz;
      const vDotR  = dvx*dx + dvy*dy + dvz*dz;
      const factor = GM / (C2 * r2 * r);
      const kr = (4 * GM / r - v2);
      const kv = 4 * vDotR;
      b.ax += factor * (kr * dx + kv * dvx);
      b.ay += factor * (kr * dy + kv * dvy);
      b.az += factor * (kr * dz + kv * dvz);
    }
  }
}

// =====================================================================
// Yoshida 4th-order symplectic integrator
// =====================================================================
// Step = drift c1 dt → kick d1 dt → drift c2 dt → kick d2 dt → drift c3 dt
//      → kick d3 dt → drift c4 dt
// Three force evaluations per step but much better long-term energy
// conservation than velocity Verlet, especially for high eccentricities.

const _W1 = 1 / (2 - Math.cbrt(2));
const _W0 = -Math.cbrt(2) * _W1;
const _C  = [_W1 / 2, (_W0 + _W1) / 2, (_W0 + _W1) / 2, _W1 / 2];
const _D  = [_W1, _W0, _W1];

function _drift(arr, dt) {
  for (const b of arr) {
    if (!b.alive) continue;
    b.px += b.vx * dt;
    b.py += b.vy * dt;
    b.pz += b.vz * dt;
  }
}
function _kick(arr, dt) {
  computeAccelerations(arr);
  for (const b of arr) {
    if (!b.alive) continue;
    b.vx += b.ax * dt;
    b.vy += b.ay * dt;
    b.vz += b.az * dt;
  }
}

export function step(arr, dt) {
  _drift(arr, _C[0] * dt);
  _kick (arr, _D[0] * dt);
  _drift(arr, _C[1] * dt);
  _kick (arr, _D[1] * dt);
  _drift(arr, _C[2] * dt);
  _kick (arr, _D[2] * dt);
  _drift(arr, _C[3] * dt);
}

// =====================================================================
// Collision detection and trajectory prediction
// =====================================================================

export function detectImpact() {
  const bodies = state.bodies;
  for (let i = 0; i < bodies.length; i++) {
    const a = bodies[i]; if (!a.alive || !a.isAsteroid) continue;
    for (let j = 0; j < bodies.length; j++) {
      if (i === j) continue;
      const b = bodies[j]; if (!b.alive) continue;
      const dx = b.px - a.px, dy = b.py - a.py, dz = b.pz - a.pz;
      const d  = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (d < (a.displayRadius + b.displayRadius) * 1.02) return [a, b, i, j];
    }
  }
  return null;
}

// Forward shadow simulation against a copy of the world. Used to draw the
// dashed asteroid prediction line and decide whether the launch will hit.
// Probe carries the asteroid's actual mass and physical radius so massive
// impactors deflect their targets in the prediction the same way they will
// in the live sim.
export function predictTrajectory(asteroidProto, steps, dtPredict) {
  const clones = state.bodies.map(b => ({
    px: b.px, py: b.py, pz: b.pz,
    vx: b.vx, vy: b.vy, vz: b.vz,
    ax: 0, ay: 0, az: 0,
    mass: b.mass, alive: b.alive, displayRadius: b.displayRadius,
    name: b.name,
  }));
  // Probe radius from its mass + density (matches fireAsteroid).
  const density = 3000;
  const probeRadius = Math.cbrt((3 * asteroidProto.mass) / (4 * Math.PI * density));
  clones.push({
    px: asteroidProto.px, py: asteroidProto.py, pz: asteroidProto.pz,
    vx: asteroidProto.vx, vy: asteroidProto.vy, vz: asteroidProto.vz,
    ax: 0, ay: 0, az: 0,
    mass: asteroidProto.mass, alive: true, displayRadius: probeRadius,
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

// =====================================================================
// Inelastic collision: target absorbs impactor
// =====================================================================
// Conserves linear momentum exactly. Conserves angular momentum about the
// target's centre into a scalar spin-rate change projected onto the current
// spin axis (a uniform-sphere moment of inertia, I = 2/5 M R²). The spin
// axis itself does not tilt — that's a more involved rigid-body update we
// can take on later.
export function mergeImpact(impactor, target) {
  const mTotal = target.mass + impactor.mass;

  // Save pre-merge relative kinematics for the angular momentum projection
  const dvx0 = impactor.vx - target.vx;
  const dvy0 = impactor.vy - target.vy;
  const dvz0 = impactor.vz - target.vz;
  const rx = impactor.px - target.px;
  const ry = impactor.py - target.py;
  const rz = impactor.pz - target.pz;

  // Linear momentum: target gets the COM velocity of the merged pair.
  target.vx = (target.mass * target.vx + impactor.mass * impactor.vx) / mTotal;
  target.vy = (target.mass * target.vy + impactor.mass * impactor.vy) / mTotal;
  target.vz = (target.mass * target.vz + impactor.mass * impactor.vz) / mTotal;

  // Angular momentum imparted about target centre = r × Δp,
  // where Δp = m_imp · (v_imp − v_target_pre). Project onto spin axis.
  if (target.rotPeriod && Number.isFinite(target.rotPeriod)) {
    const Jx = impactor.mass * dvx0;
    const Jy = impactor.mass * dvy0;
    const Jz = impactor.mass * dvz0;
    const dLx = ry * Jz - rz * Jy;
    const dLy = rz * Jx - rx * Jz;
    const dLz = rx * Jy - ry * Jx;
    // Spin axis (world frame): pivot rotates spinner's local Y around world X by tilt.
    // local Y = (0, cos θ, sin θ) in world frame.
    const tilt = (target.tilt || 0) * Math.PI / 180;
    const ax = 0, ay = Math.cos(tilt), az = Math.sin(tilt);
    const dL_along = dLx * ax + dLy * ay + dLz * az;
    const I = 0.4 * target.mass * target.displayRadius * target.displayRadius;
    const dOmega = dL_along / I;
    const omegaNow = 2 * Math.PI / target.rotPeriod;
    const omegaNew = omegaNow + dOmega;
    target.rotPeriod = Math.abs(omegaNew) > 1e-30 ? 2 * Math.PI / omegaNew : Infinity;
  }

  target.mass = mTotal;
  impactor.alive = false;
}
