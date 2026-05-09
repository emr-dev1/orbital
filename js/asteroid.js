// Asteroid launch flow: aim mode toggle, prediction line + impact-marker
// while aiming, body creation on release, and the impact analysis modal.

import * as THREE from 'three';
import { state } from './state.js';
import { scene, canvas, camera } from './scene.js';
import { Body, computeAccelerations, predictTrajectory } from './physics.js';
import { rebuildVisuals, renderPos, visualRadius, bodySpinners } from './visuals.js';
import { camState } from './camera.js';
import { G, RENDER_SCALE, TNT_J, REF_EVENTS, WARP_LEVELS, COMPOSITIONS } from './data.js';

// --- prediction visuals ---
// 1500 vertex capacity so multi-year transfer trajectories (Earth → Saturn,
// Earth → Uranus) can be drawn end-to-end at high warps without truncating.
const PRED_CAPACITY = 1500;
const predGeo = new THREE.BufferGeometry();
predGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PRED_CAPACITY * 3), 3));
const predMat = new THREE.LineDashedMaterial({
  color: 0xff5530, dashSize: 2, gapSize: 1.5, transparent: true, opacity: 0.9,
});
export const predLine = new THREE.Line(predGeo, predMat);
predLine.frustumCulled = false;
predLine.visible = false;
scene.add(predLine);

export const impactMarker = new THREE.Mesh(
  new THREE.RingGeometry(2, 3, 32),
  new THREE.MeshBasicMaterial({ color: 0xff5530, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
);
impactMarker.visible = false;
scene.add(impactMarker);

// Asteroid placeholder — a small red sphere wrapped in a green wireframe
// halo so it reads as "ghost asteroid sitting here, ready to launch."
// Sits at state.launchSpawn while aim mode is active.
export const launchpadMarker = new THREE.Group();
{
  const astMat = new THREE.MeshBasicMaterial({ color: 0xff5530 });
  const ast = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), astMat);
  const haloMat = new THREE.MeshBasicMaterial({ color: 0x6ee7a8, wireframe: true, transparent: true, opacity: 0.45 });
  const halo = new THREE.Mesh(new THREE.SphereGeometry(0.95, 14, 10), haloMat);
  launchpadMarker.add(ast, halo);
}
launchpadMarker.visible = false;
scene.add(launchpadMarker);

// =====================================================================
// Impact debris + shockwave rings.
//
// Both effects are *parent-anchored*: each particle stores its position as
// an offset from the target body's render position, so as the planet keeps
// orbiting the debris stays glued to the impact site instead of drifting
// off in absolute world coordinates. Animation runs in REAL time (not sim
// time) so the burst plays out the same way at warp 0 and warp 9.
// =====================================================================

const DEBRIS_CAPACITY = 800;
const _debris = {
  count: 0,
  parentRef: new Array(DEBRIS_CAPACITY).fill(null),
  ox:  new Float32Array(DEBRIS_CAPACITY),  // offset from parent (render units)
  oy:  new Float32Array(DEBRIS_CAPACITY),
  oz:  new Float32Array(DEBRIS_CAPACITY),
  vx:  new Float32Array(DEBRIS_CAPACITY),  // velocity (render units / real-sec)
  vy:  new Float32Array(DEBRIS_CAPACITY),
  vz:  new Float32Array(DEBRIS_CAPACITY),
  life:    new Float32Array(DEBRIS_CAPACITY),  // remaining real-sec
  lifeMax: new Float32Array(DEBRIS_CAPACITY),
};
const debrisGeo = new THREE.BufferGeometry();
debrisGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DEBRIS_CAPACITY * 3), 3));
const debrisMat = new THREE.PointsMaterial({
  color: 0xffb060, size: 3.0, sizeAttenuation: false,
  transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
});
const debrisPoints = new THREE.Points(debrisGeo, debrisMat);
debrisPoints.frustumCulled = false;
scene.add(debrisPoints);
debrisGeo.setDrawRange(0, 0);

// Active shockwave rings — concentric expanding rings tangent to the
// target's surface at the impact site. Each shock is a thin sphere-shell
// mesh attached to the target's spinner; a custom shader lights up the
// fragments at the current geodesic distance from the impact point so the
// wave actually rides the curved surface instead of flying off as a flat
// disc. The shell co-rotates with the planet (parent of spinner), so the
// impact spot stays glued to the same patch of continent.
const _shocks = [];

// Custom shader for the sphere-shell shock. Lights up fragments where the
// geodesic angle from the impact point matches the current radius. Outer
// fade so the wave dissipates rather than hitting a hard wall at uMaxRadius.
const SHOCK_VERT = `
varying vec3 vLocal;
void main() {
  vLocal = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SHOCK_FRAG = `
precision highp float;
uniform vec3  uImpactPoint;
uniform float uRadius;
uniform float uWidth;
uniform float uMaxRadius;
uniform float uOpacity;
uniform vec3  uColor;
varying vec3 vLocal;
void main() {
  float cosA = dot(normalize(vLocal), uImpactPoint);
  float angle = acos(clamp(cosA, -1.0, 1.0));
  float dist = abs(angle - uRadius);
  if (dist > uWidth) discard;
  float band  = 1.0 - smoothstep(uWidth * 0.4, uWidth, dist);
  float reach = 1.0 - smoothstep(uMaxRadius * 0.7, uMaxRadius, uRadius);
  gl_FragColor = vec4(uColor, band * reach * uOpacity);
}`;

// Build an orthonormal basis (n, t1, t2) given a unit normal n.
function _basis(nx, ny, nz, out) {
  // Pick a non-parallel axis to cross with.
  const ax = Math.abs(nx) < 0.9 ? 1 : 0;
  const ay = Math.abs(nx) < 0.9 ? 0 : 1;
  // t1 = n × axis
  let t1x = ny * 0    - nz * ay;
  let t1y = nz * ax   - nx * 0;
  let t1z = nx * ay   - ny * ax;
  const len = Math.hypot(t1x, t1y, t1z) || 1;
  t1x /= len; t1y /= len; t1z /= len;
  // t2 = n × t1
  const t2x = ny * t1z - nz * t1y;
  const t2y = nz * t1x - nx * t1z;
  const t2z = nx * t1y - ny * t1x;
  out.t1x = t1x; out.t1y = t1y; out.t1z = t1z;
  out.t2x = t2x; out.t2y = t2y; out.t2z = t2z;
}

export function spawnImpactDebris(impactor, target, tImpact = 1) {
  const spinner = bodySpinners.get(target);
  if (!spinner) return;

  // Make sure the spinner's world matrix reflects this frame's pivot
  // position + axial spin before we read its quaternion. Without this we
  // can land debris on a spot that's a frame stale, which on high warp is
  // visible as a tiny lurch when the burst spawns.
  spinner.updateWorldMatrix(true, false);

  // World-frame impact site, interpolated within the substep at the actual
  // contact instant tImpact ∈ [0,1]. Using post-step positions would miss
  // the surface entirely for fast asteroids that have already tunnelled
  // past the target's centre by the end of the substep — that's what put
  // debris at the planet's centre instead of on its skin.
  const impPx = impactor.prevPx + (impactor.px - impactor.prevPx) * tImpact;
  const impPy = impactor.prevPy + (impactor.py - impactor.prevPy) * tImpact;
  const impPz = impactor.prevPz + (impactor.pz - impactor.prevPz) * tImpact;
  const tgtPx = target.prevPx + (target.px - target.prevPx) * tImpact;
  const tgtPy = target.prevPy + (target.py - target.prevPy) * tImpact;
  const tgtPz = target.prevPz + (target.pz - target.prevPz) * tImpact;

  const dxW = impPx - tgtPx;
  const dyW = impPy - tgtPy;
  const dzW = impPz - tgtPz;
  const dM  = Math.hypot(dxW, dyW, dzW) || 1;

  // Rotate the world-frame impact direction into the spinner's local frame
  // so the surface point stays glued to the same patch of continent as the
  // planet rotates on its axis. We then store all debris state in this
  // local frame and transform it back to world via spinner.matrixWorld at
  // render time — same trick the shockwave shells already use.
  const worldNormal = new THREE.Vector3(dxW / dM, dyW / dM, dzW / dM);
  const invQ = new THREE.Quaternion();
  spinner.getWorldQuaternion(invQ).invert();
  const localNormal = worldNormal.clone().applyQuaternion(invQ);
  const nx = localNormal.x, ny = localNormal.y, nz = localNormal.z;

  const vR = visualRadius(target);
  const sox = nx * vR, soy = ny * vR, soz = nz * vR;
  const basis = {};
  _basis(nx, ny, nz, basis);

  // Yield in megatons drives count, eject speed, and lifetime. We use a
  // gentle log scaling so a city-killer (~50 Mt) feels different from a
  // pebble-burst (~1 t) but a planet-cracker (1e8 Mt) doesn't fling debris
  // off-screen. yieldScale ∈ [0.5, 2.6] roughly.
  const dvx = impactor.vx - target.vx;
  const dvy = impactor.vy - target.vy;
  const dvz = impactor.vz - target.vz;
  const vRel = Math.hypot(dvx, dvy, dvz);
  const E  = 0.5 * impactor.mass * vRel * vRel;
  const Mt = E / TNT_J / 1e6;
  const yieldScale = Math.max(0.5, Math.min(2.6, 0.5 + 0.22 * Math.log10(Math.max(Mt, 1e-6) + 1)));

  const baseN = Math.round(Math.log10(Math.max(impactor.mass, 1)) * 8);
  const cap   = DEBRIS_CAPACITY - _debris.count;
  const n = Math.max(0, Math.min(cap, Math.max(35, Math.round(baseN * yieldScale))));
  const ejectV = vR * 0.55 * yieldScale;
  const lifeBase = 2.0 + 0.6 * yieldScale;

  for (let i = 0; i < n; i++) {
    const k = _debris.count++;
    _debris.parentRef[k] = target;
    // Sub-radius jitter so the burst doesn't emanate from a single
    // mathematical point (visible as a single bright dot on first frame).
    const j = vR * 0.04;
    _debris.ox[k] = sox + (Math.random() - 0.5) * j;
    _debris.oy[k] = soy + (Math.random() - 0.5) * j;
    _debris.oz[k] = soz + (Math.random() - 0.5) * j;
    // Random direction biased outward from the surface normal.
    const angle = Math.random() * Math.PI * 2;
    const elev  = 0.3 + Math.random() * 0.7;     // 30-100% along normal
    const lat   = Math.sqrt(1 - elev * elev);    // remainder spread tangentially
    const dirX = nx * elev + (Math.cos(angle) * basis.t1x + Math.sin(angle) * basis.t2x) * lat;
    const dirY = ny * elev + (Math.cos(angle) * basis.t1y + Math.sin(angle) * basis.t2y) * lat;
    const dirZ = nz * elev + (Math.cos(angle) * basis.t1z + Math.sin(angle) * basis.t2z) * lat;
    const speed = ejectV * (0.4 + Math.random() * 0.8);
    _debris.vx[k] = dirX * speed;
    _debris.vy[k] = dirY * speed;
    _debris.vz[k] = dirZ * speed;
    const life = lifeBase + Math.random() * 2.0;
    _debris.life[k]    = life;
    _debris.lifeMax[k] = life;
  }

  // Concentric shock waves and a bright surface flash, both anchored to
  // the spinner's local frame so they sit on the impact patch as it rotates.
  _spawnShockWaves(target, localNormal, Mt, yieldScale);
  _spawnImpactFlash(target, localNormal, Mt, yieldScale);
}

// Map impact yield (megatons TNT) to the wave's geodesic reach (radians).
// 1 Mt → ~15° local damage, 1e4 Mt → ~72° regional, 1e6 Mt → ~105° global,
// 1e8 Mt → ~138° (Chicxulub class), ≥1e10 Mt → π (full antipode).
function _shockReach(Mt) {
  if (Mt <= 0) return 0.1;
  return Math.min(Math.PI, Math.max(0.1, 0.26 + 0.26 * Math.log10(Mt)));
}

function _spawnShockWaves(target, localNormal, Mt, yieldScale) {
  const spinner = bodySpinners.get(target);
  if (!spinner) return;

  const reach = _shockReach(Mt);
  // Bigger waves last longer so the user has time to read them. Cap so a
  // planet-killer doesn't permanently strobe.
  const lifeMax = Math.min(4.5, 1.5 + reach * 0.4);

  // Big strikes spawn an extra wave (4 instead of 3) for visual heft.
  const nWaves = Mt > 1e4 ? 4 : 3;

  // Color shifts cooler for small, hotter for big. White-yellow at
  // planet-cracker yields, deep orange-red at city-killer scale.
  const hotness = Math.min(1, Math.max(0, (Math.log10(Math.max(Mt, 1e-6)) + 2) / 8));
  const color = new THREE.Color().setHSL(
    0.06 - hotness * 0.05,           // hue: orange → near-yellow
    0.95,                            // saturation
    0.5 + hotness * 0.25,            // lightness: 0.5 → 0.75
  );

  const vR = visualRadius(target);
  for (let i = 0; i < nWaves; i++) {
    const geo = new THREE.SphereGeometry(vR * 1.01, 64, 48);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uImpactPoint: { value: localNormal.clone() },
        uRadius:      { value: 0 },
        uWidth:       { value: 0.07 + Math.min(0.07, reach * 0.025) },
        uMaxRadius:   { value: reach },
        uOpacity:     { value: 0 },          // ramps in once delay elapses
        uColor:       { value: color.clone() },
      },
      vertexShader:   SHOCK_VERT,
      fragmentShader: SHOCK_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    spinner.add(mesh);
    _shocks.push({
      mesh, mat, spinner, parent: target,
      delay: i * 0.28,         // staggered so the waves ripple in succession
      life: lifeMax,
      lifeMax,
      reach,
    });
  }
}

// =====================================================================
// Surface flash: a bright additive billboard at the impact point that
// blooms briefly. Anchored to the spinner so it sticks to the surface
// patch even as the planet rotates. Scales with yield.
// =====================================================================
const _flashes = [];

function _spawnImpactFlash(target, localNormal, Mt, yieldScale) {
  const spinner = bodySpinners.get(target);
  if (!spinner) return;

  const vR = visualRadius(target);
  // Flash radius — small for puny strikes, vR-scale for big ones.
  const baseScale = vR * (0.18 + 0.32 * Math.min(1, Math.log10(Math.max(Mt, 1e-6) + 1) / 5));

  // Two-layer flash: a hot core + a soft outer halo. Both additive.
  const coreGeo = new THREE.SphereGeometry(baseScale, 24, 16);
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xfff2c8, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const coreMesh = new THREE.Mesh(coreGeo, coreMat);
  coreMesh.position.set(localNormal.x * vR, localNormal.y * vR, localNormal.z * vR);
  spinner.add(coreMesh);

  const haloGeo = new THREE.SphereGeometry(baseScale * 1.7, 24, 16);
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xff9a40, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const haloMesh = new THREE.Mesh(haloGeo, haloMat);
  haloMesh.position.copy(coreMesh.position);
  spinner.add(haloMesh);

  const lifeMax = 0.55 + 0.25 * yieldScale;
  _flashes.push({
    coreMesh, coreMat, haloMesh, haloMat,
    spinner, parent: target,
    life: lifeMax, lifeMax,
  });
}

// Per-frame: integrate debris in REAL time (frame-rate independent of warp),
// apply spring-style pull toward the surface so particles arc back, then
// transform local-frame offsets through the parent's spinner.matrixWorld
// to get world-space positions. Compact dead particles. Then update shock
// rings and surface flashes.
const _v3 = new THREE.Vector3();
export function updateImpactDebris(realDt) {
  // ── particles ──────────────────────────────────────────────────────────
  if (_debris.count > 0) {
    const arr = debrisGeo.attributes.position.array;
    let alive = 0;
    for (let i = 0; i < _debris.count; i++) {
      if (_debris.life[i] <= 0) continue;
      const parent = _debris.parentRef[i];
      if (!parent || !parent.alive) { _debris.life[i] = 0; continue; }

      // Spring pull toward planet surface (rest length = visualRadius).
      const r = Math.hypot(_debris.ox[i], _debris.oy[i], _debris.oz[i]);
      if (r > 1e-6) {
        const vR = visualRadius(parent);
        // Linear pull toward centre — overshoots past surface a little, then
        // returns. Tuned so particles ejected at ~vR * 0.55 arc out to about
        // 1.5–2 × vR before the spring beats them back.
        const k = vR * 1.6;     // spring constant
        const ax = -(_debris.ox[i] / r) * k;
        const ay = -(_debris.oy[i] / r) * k;
        const az = -(_debris.oz[i] / r) * k;
        _debris.vx[i] += ax * realDt;
        _debris.vy[i] += ay * realDt;
        _debris.vz[i] += az * realDt;
      }
      _debris.ox[i] += _debris.vx[i] * realDt;
      _debris.oy[i] += _debris.vy[i] * realDt;
      _debris.oz[i] += _debris.vz[i] * realDt;
      _debris.life[i] -= realDt;
      if (_debris.life[i] <= 0) continue;

      // Local offset → world via spinner.matrixWorld so the burst spins
      // with the planet AND follows it through its orbit.
      const spinner = bodySpinners.get(parent);
      if (spinner) {
        spinner.updateWorldMatrix(true, false);
        _v3.set(_debris.ox[i], _debris.oy[i], _debris.oz[i]);
        _v3.applyMatrix4(spinner.matrixWorld);
        arr[alive*3]   = _v3.x;
        arr[alive*3+1] = _v3.y;
        arr[alive*3+2] = _v3.z;
      } else {
        const [prx, pry, prz] = renderPos(parent);
        arr[alive*3]   = prx + _debris.ox[i];
        arr[alive*3+1] = pry + _debris.oy[i];
        arr[alive*3+2] = prz + _debris.oz[i];
      }
      alive++;
    }
    // Fade material globally based on the average life — roughly tracks the
    // burst's age. Keeps a bright flash early, gentle fade-out late.
    const avgLife = (() => {
      let s = 0, c = 0;
      for (let i = 0; i < _debris.count; i++) {
        if (_debris.life[i] > 0) { s += _debris.life[i] / _debris.lifeMax[i]; c++; }
      }
      return c > 0 ? s / c : 1;
    })();
    debrisMat.opacity = 0.4 + 0.55 * avgLife;
    debrisGeo.attributes.position.needsUpdate = true;
    debrisGeo.setDrawRange(0, alive);

    // Compact in place.
    if (alive < _debris.count) {
      let w = 0;
      for (let i = 0; i < _debris.count; i++) {
        if (_debris.life[i] <= 0) continue;
        if (w !== i) {
          _debris.parentRef[w] = _debris.parentRef[i];
          _debris.ox[w] = _debris.ox[i]; _debris.oy[w] = _debris.oy[i]; _debris.oz[w] = _debris.oz[i];
          _debris.vx[w] = _debris.vx[i]; _debris.vy[w] = _debris.vy[i]; _debris.vz[w] = _debris.vz[i];
          _debris.life[w] = _debris.life[i]; _debris.lifeMax[w] = _debris.lifeMax[i];
        }
        w++;
      }
      _debris.count = w;
    }
  } else {
    debrisGeo.setDrawRange(0, 0);
  }

  // ── shock waves ─────────────────────────────────────────────────────────
  for (let i = _shocks.length - 1; i >= 0; i--) {
    const s = _shocks[i];
    if (s.delay > 0) { s.delay -= realDt; continue; }
    s.life -= realDt;
    // Detach + dispose if expired, target died, or its spinner was rebuilt.
    if (
      s.life <= 0 ||
      !s.parent || !s.parent.alive ||
      s.mesh.parent !== s.spinner
    ) {
      if (s.mesh.parent) s.mesh.parent.remove(s.mesh);
      s.mesh.geometry.dispose();
      s.mat.dispose();
      _shocks.splice(i, 1);
      continue;
    }
    // Drive shader uniforms across the wave's lifetime.
    const t = 1 - (s.life / s.lifeMax);  // 0 → 1
    s.mat.uniforms.uRadius.value  = s.reach * t;
    // Bright at start, fade out near end. Slight ease-in over the first 5%
    // so the wave fades up rather than popping.
    const fadeIn  = Math.min(1, t / 0.05);
    const fadeOut = 1 - t;
    s.mat.uniforms.uOpacity.value = 0.95 * fadeIn * fadeOut;
  }

  // ── surface flashes ─────────────────────────────────────────────────────
  for (let i = _flashes.length - 1; i >= 0; i--) {
    const f = _flashes[i];
    f.life -= realDt;
    if (
      f.life <= 0 ||
      !f.parent || !f.parent.alive ||
      f.coreMesh.parent !== f.spinner
    ) {
      if (f.coreMesh.parent) f.coreMesh.parent.remove(f.coreMesh);
      if (f.haloMesh.parent) f.haloMesh.parent.remove(f.haloMesh);
      f.coreMesh.geometry.dispose(); f.coreMat.dispose();
      f.haloMesh.geometry.dispose(); f.haloMat.dispose();
      _flashes.splice(i, 1);
      continue;
    }
    const t = 1 - f.life / f.lifeMax;        // 0 → 1
    // Rapid bloom: scales up sharply then settles. Halo grows further than core.
    const coreScale = 1 + t * 1.2;
    const haloScale = 1 + t * 2.4;
    f.coreMesh.scale.setScalar(coreScale);
    f.haloMesh.scale.setScalar(haloScale);
    // Quadratic fade keeps the flash punchy at the start.
    const fadeOut = (1 - t) * (1 - t);
    f.coreMat.opacity = 0.95 * fadeOut;
    f.haloMat.opacity = 0.55 * fadeOut;
    // Cool from white-hot to deep orange across the lifetime.
    f.coreMat.color.setRGB(1.0, 0.95 - t * 0.55, 0.78 - t * 0.7);
    f.haloMat.color.setRGB(1.0, 0.6  - t * 0.4,  0.25 - t * 0.25);
  }

  // Also drain any pending population kills so the pop counter ticks down
  // visibly over real time, no matter what warp the user is at.
  _tickPopulationDrain(realDt);
}

// Real-time population kill animation. evolution.applyImpactEffects stages
// the kill on `body.populationDeathRoll` instead of mutating population
// instantly; we drain it here at a fixed real-second rate so the user
// always sees the counter tick over a few seconds.
function _tickPopulationDrain(realDt) {
  for (const b of state.bodies) {
    const d = b.populationDeathRoll;
    if (!d || d.remaining <= 0 || !b.population) continue;
    const drop = Math.min(d.ratePerRealSec * realDt, d.remaining, b.population);
    b.population = Math.max(0, b.population - drop);
    d.remaining -= drop;
    if (d.remaining <= 0 || b.population <= 0) b.populationDeathRoll = null;
  }
}

// Local circular orbital velocity (prograde, CCW around +Y) at a given
// position relative to the Sun. Without this, an asteroid placed in space
// has no Sun-orbital momentum and just falls straight in. With this
// baked in, the placeholder asteroid is co-orbiting the Sun like a real
// solar-system body would, and the slider speed becomes a Δv on top of
// that — exactly what the user expects to see.
function localOrbitalVelocity(spawnPxM, spawnPyM, spawnPzM) {
  const sun = state.bodies.find(b => b.name === 'SUN');
  if (!sun) return { vx: 0, vy: 0, vz: 0 };
  const dxSun = spawnPxM - sun.px;
  const dzSun = spawnPzM - sun.pz;
  const r = Math.hypot(dxSun, dzSun);
  if (r < 1e9) return { vx: 0, vy: 0, vz: 0 }; // too close to Sun, skip
  const vCirc = Math.sqrt(G * sun.mass / r);
  // Tangent prograde: perpendicular to radius in XZ plane (CCW from +Y).
  return {
    vx: sun.vx + vCirc * dzSun / r,
    vy: sun.vy,
    vz: sun.vz - vCirc * dxSun / r,
  };
}

// Compute the launch state for a free spawn point + target body: spawn in
// physical units, baseline orbital velocity, direction-to-target, and
// distance. Returns null if any input is missing.
function computeLaunchState(spawnRender, target) {
  if (!spawnRender || !target) return null;
  const spawnPxM = spawnRender.x * RENDER_SCALE;
  const spawnPyM = spawnRender.y * RENDER_SCALE;
  const spawnPzM = spawnRender.z * RENDER_SCALE;
  const dx = target.px - spawnPxM;
  const dy = target.py - spawnPyM;
  const dz = target.pz - spawnPzM;
  const distM = Math.hypot(dx, dy, dz);
  if (distM < 1) return null;
  const baseV = localOrbitalVelocity(spawnPxM, spawnPyM, spawnPzM);
  return {
    spawnPxM, spawnPyM, spawnPzM,
    dirX: dx / distM, dirY: dy / distM, dirZ: dz / distM,
    distM, baseV,
  };
}

export function setAimMode(on) {
  state.aimMode = on;
  if (on) {
    // Pull the camera back to a system-overview view so the user can see
    // every body and click on the one they want as a target. Save current
    // focus so we can restore it on cancel.
    camState.prevFocus = camState.focusBody;
    camState.focusBody = null;
    camState.targetGoal.set(0, 0, 0);
    camState.targetDist = 4500;
  } else {
    state.aimEnd = null;
    state.aimStart = null;
    launchpadMarker.visible = false;
    predLine.visible = false;
    impactMarker.visible = false;
    // If focus is still null (cancel rather than launch), restore prev focus.
    // After a launch, ui.js has already set focusBody to the new asteroid
    // so we leave it alone.
    if (!camState.focusBody && camState.prevFocus) {
      camState.focusBody = camState.prevFocus;
    }
    camState.prevFocus = null;
  }
  document.getElementById('aimBtn').classList.toggle('active', on);
  document.getElementById('aimPanel').classList.toggle('show', on);
  canvas.style.cursor = on ? 'crosshair' : 'grab';
}

// Live readouts for the LAUNCH panel and the contextual hint header.
function fillAimPanel(spawnRender, target, predImpactIdx, launchState) {
  if (!state.aimMode) return;

  const hintEl = document.getElementById('aimHintV');
  const fireBtn = document.getElementById('fireBtn');

  // Update the wizard hint based on what's been set.
  if (!spawnRender) {
    hintEl.textContent = 'CLICK EMPTY SPACE TO PLACE THE ASTEROID';
  } else if (!target) {
    hintEl.textContent = 'CLICK A BODY TO SET THE TARGET';
  } else {
    hintEl.textContent = 'TUNE MASS / SPEED · CLICK LAUNCH WHEN READY';
  }

  if (!spawnRender || !target || !launchState) {
    document.getElementById('aimDistV').textContent = '—';
    document.getElementById('aimVelV').textContent  = '—';
    document.getElementById('aimEtaV').textContent  = '—';
    document.getElementById('aimImpactV').textContent = '—';
    document.getElementById('aimVerdictV').textContent = '—';
    document.getElementById('aimVerdictV').className = 'v';
    document.getElementById('aimHitV').textContent  = '—';
    document.getElementById('aimHitV').className    = 'v';
    fireBtn.disabled = true;
    return;
  }
  fireBtn.disabled = false;

  const distM = launchState.distM;
  document.getElementById('aimDistV').textContent =
    distM < 1e9 ? (distM/1e6).toFixed(1) + ' Mm' : (distM/1e9).toFixed(2) + ' Gm';

  const speedKm = parseFloat(document.getElementById('speed').value);
  document.getElementById('aimVelV').textContent = speedKm.toFixed(0) + ' km/s';

  const v = speedKm * 1000;
  const etaSec = distM / v;
  document.getElementById('aimEtaV').textContent =
    etaSec < 7200       ? (etaSec/60).toFixed(0)   + ' min' :
    etaSec < 86400 * 2  ? (etaSec/3600).toFixed(1) + ' hr'  :
    etaSec < 86400 * 60 ? (etaSec/86400).toFixed(1)+ ' d'   :
                          (etaSec/86400/365).toFixed(2)+ ' yr';

  const massExp = parseFloat(document.getElementById('mass').value);
  const mass = Math.pow(10, massExp);
  const E = 0.5 * mass * v * v;
  const TNT_t  = E / TNT_J;
  const TNT_Mt = TNT_t / 1e6;
  document.getElementById('aimImpactV').textContent =
    TNT_Mt < 1e-3 ? TNT_t.toExponential(1) + ' t' : TNT_Mt.toExponential(1) + ' Mt';

  const verdictEl = document.getElementById('aimVerdictV');
  let verdict, cls;
  if      (TNT_Mt < 0.01) { verdict = 'AIRBURST';        cls = '';       }
  else if (TNT_Mt < 50)   { verdict = 'CITY-KILLER';     cls = 'warn';   }
  else if (TNT_Mt < 1e5)  { verdict = 'CONTINENTAL';     cls = 'warn';   }
  else if (TNT_Mt < 1e8)  { verdict = 'EXTINCTION';      cls = 'target'; }
  else                    { verdict = 'PLANET-CRACKER';  cls = 'target'; }
  verdictEl.textContent = verdict;
  verdictEl.className = 'v ' + cls;

  const hitEl = document.getElementById('aimHitV');
  if (predImpactIdx >= 0) {
    hitEl.textContent = 'YES · ' + target.name;
    hitEl.className = 'v target';
  } else {
    hitEl.textContent = 'WILL MISS';
    hitEl.className = 'v miss';
  }
}

// Launch from a free spawn point toward a target body. Velocity is
// baseline-orbital-at-the-spawn-point (so the asteroid co-orbits the Sun
// like a planet would) plus (slider km/s) × direction-to-target. Without
// the orbital baseline, asteroids would just fall straight into the Sun
// and gravity wouldn't appear to "work."
//
// Returns the new asteroid Body so callers can hand it to the camera for
// auto-tracking.
export function fireAsteroid(spawnRender, target, composition = 'ROCKY') {
  const ls = computeLaunchState(spawnRender, target);
  if (!ls) return null;
  const { spawnPxM, spawnPyM, spawnPzM, dirX, dirY, dirZ, baseV } = ls;

  const speedKm = parseFloat(document.getElementById('speed').value);
  const v = speedKm * 1000;
  const massExp = parseFloat(document.getElementById('mass').value);
  const mass = Math.pow(10, massExp);

  // Composition drives density (larger fluffy ice vs small dense iron)
  // and water deposit on impact. Default to rocky if unrecognised. Black
  // holes are special — physical radius is the Schwarzschild radius
  // (2GM/c²) regardless of "density", and we tag isBlackHole so visuals,
  // collision-handling, and the inspector can branch.
  const compInfo = COMPOSITIONS[composition] || COMPOSITIONS.ROCKY;
  const isBH = !!compInfo.isBlackHole;
  const C_LIGHT_LOCAL = 299792458;
  const radius = isBH
    ? (2 * G * mass) / (C_LIGHT_LOCAL * C_LIGHT_LOCAL)        // Schwarzschild
    : Math.cbrt((3 * mass) / (4 * Math.PI * compInfo.density));

  const namePrefix = isBH ? 'BH-' : 'ASTEROID-';
  const ast = new Body({
    name: namePrefix + (state.bodies.filter(b => b.isAsteroid).length + 1).toString().padStart(2, '0'),
    mass, displayRadius: radius, color: compInfo.color, isAsteroid: true,
    composition, isBlackHole: isBH,
    // Fast spin so the accretion disk visibly rotates (60-second period).
    rotPeriod: isBH ? 60 : undefined,
    waterFraction: compInfo.waterFraction,
    px: spawnPxM, py: spawnPyM, pz: spawnPzM,
    vx: baseV.vx + dirX * v, vy: baseV.vy + dirY * v, vz: baseV.vz + dirZ * v,
  });
  state.bodies.push(ast);
  computeAccelerations(state.bodies);
  rebuildVisuals();
  return ast;
}

// Per-frame: maintain the asteroid placeholder, the dashed prediction,
// and the impact marker while aim mode is on. Spawn comes from
// state.launchSpawn (set by clicking empty space) and target from the
// current TARGET pill.
export function updateAimVisual(target) {
  if (!state.aimMode) {
    predLine.visible = false;
    impactMarker.visible = false;
    launchpadMarker.visible = false;
    return;
  }

  const spawnRender = state.launchSpawn;
  if (!spawnRender) {
    // No spawn yet — hide everything until the user clicks empty space.
    launchpadMarker.visible = false;
    predLine.visible = false;
    impactMarker.visible = false;
    fillAimPanel(null, target, -1, null);
    return;
  }

  // Always show the placeholder asteroid where the user has placed it.
  launchpadMarker.position.copy(spawnRender);
  launchpadMarker.visible = true;

  const ls = computeLaunchState(spawnRender, target);
  if (!ls) {
    predLine.visible = false;
    impactMarker.visible = false;
    fillAimPanel(spawnRender, target, -1, null);
    return;
  }

  const { dirX, dirY, dirZ, baseV } = ls;
  const speedKm = parseFloat(document.getElementById('speed').value);
  const v = speedKm * 1000;
  const massExp = parseFloat(document.getElementById('mass').value);
  const mass = Math.pow(10, massExp);
  const proto = {
    px: ls.spawnPxM, py: ls.spawnPyM, pz: ls.spawnPzM,
    vx: baseV.vx + dirX * v, vy: baseV.vy + dirY * v, vz: baseV.vz + dirZ * v, mass,
  };
  // Prediction step adapts so the line covers a useful slice of the future:
  // ~62 days at warp 0 (1 min/s), ~20 years at warp 6+. predDt capped at
  // 5 days/step — coarser would lose accuracy on Earth-Moon-scale curves.
  const warpDt = WARP_LEVELS[state.warpIdx].dt;
  const predDt = Math.max(3600, Math.min(86400 * 5, warpDt));
  const pred = predictTrajectory(proto, PRED_CAPACITY, predDt);

  const arr = predLine.geometry.attributes.position.array;
  for (let i = 0; i < pred.path.length; i++) {
    arr[i*3]   = pred.path[i][0];
    arr[i*3+1] = pred.path[i][1];
    arr[i*3+2] = pred.path[i][2];
  }
  predLine.geometry.setDrawRange(0, pred.path.length);
  predLine.geometry.attributes.position.needsUpdate = true;
  predLine.computeLineDistances();
  predLine.visible = pred.path.length > 1;

  if (pred.impactIdx >= 0 && pred.path.length) {
    const last = pred.path[pred.path.length - 1];
    impactMarker.position.set(last[0], last[1], last[2]);
    impactMarker.lookAt(camera.position);
    impactMarker.visible = true;
  } else {
    impactMarker.visible = false;
  }

  fillAimPanel(spawnRender, target, pred.impactIdx, ls);
}

// --- impact analysis ---
function refEventFor(megatons) {
  let best = REF_EVENTS[0];
  for (const e of REF_EVENTS) if (megatons >= e.t) best = e;
  return best.label;
}
function verdictFor(target, megatons) {
  if (target.name === 'SUN') return 'ABSORBED. NEGLIGIBLE.';
  if (target.name === 'JUPITER' || target.name === 'SATURN') return 'GAS GIANT ATE IT. SHOEMAKER-LEVY VIBES.';
  if (megatons < 0.01) return 'AIRBURST. MINIMAL DAMAGE.';
  if (megatons < 50)   return 'REGIONAL DEVASTATION. CITY-KILLER.';
  if (megatons < 1e5)  return 'CONTINENTAL CATASTROPHE.';
  if (megatons < 1e8)  return 'GLOBAL MASS EXTINCTION EVENT.';
  return 'PLANET-CRACKING IMPACT. SURFACE STERILIZED.';
}

export function showImpact(impactor, target) {
  const dvx = impactor.vx - target.vx, dvy = impactor.vy - target.vy, dvz = impactor.vz - target.vz;
  const vRel = Math.sqrt(dvx*dvx + dvy*dvy + dvz*dvz);
  const E = 0.5 * impactor.mass * vRel * vRel;
  const TNT_t = E / TNT_J;
  const TNT_Mt = TNT_t / 1e6;
  // ballpark crater scaling: D ~ 1.8 * (E)^(1/3.4) km, E in MT
  const D = 1.8 * Math.pow(Math.max(TNT_Mt, 1e-9), 1/3.4);

  document.getElementById('impactTarget').textContent = '— ' + target.name + ' —';
  document.getElementById('iVel').textContent = (vRel/1000).toFixed(2) + ' km/s';
  document.getElementById('iE').textContent = E.toExponential(2) + ' J';
  document.getElementById('iTNT').textContent = TNT_Mt < 0.001
    ? (TNT_t).toExponential(2) + ' t'
    : TNT_Mt.toExponential(2) + ' Mt';
  document.getElementById('iCrater').textContent = D < 0.1 ? (D*1000).toFixed(0) + ' m' : D.toFixed(1) + ' km';
  document.getElementById('iRef').textContent = refEventFor(TNT_Mt);
  document.getElementById('iVerdict').textContent = verdictFor(target, TNT_Mt);
  document.getElementById('impactModal').classList.add('show');

  state.paused = true;
  const pauseBtn = document.getElementById('pauseBtn');
  pauseBtn.classList.add('active');
  pauseBtn.textContent = 'RESUME';
}
