// Asteroid launch flow: aim mode toggle, prediction line + impact-marker
// while aiming, body creation on release, and the impact analysis modal.

import * as THREE from 'three';
import { state } from './state.js';
import { scene, canvas, camera } from './scene.js';
import { Body, computeAccelerations, predictTrajectory } from './physics.js';
import { rebuildVisuals, renderPos, visualRadius } from './visuals.js';
import { camState } from './camera.js';
import { G, RENDER_SCALE, TNT_J, REF_EVENTS, WARP_LEVELS } from './data.js';

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
export function fireAsteroid(spawnRender, target) {
  const ls = computeLaunchState(spawnRender, target);
  if (!ls) return null;
  const { spawnPxM, spawnPyM, spawnPzM, dirX, dirY, dirZ, baseV } = ls;

  const speedKm = parseFloat(document.getElementById('speed').value);
  const v = speedKm * 1000;
  const massExp = parseFloat(document.getElementById('mass').value);
  const mass = Math.pow(10, massExp);

  const density = 3000;
  const radius = Math.cbrt((3 * mass) / (4 * Math.PI * density));

  const ast = new Body({
    name: 'ASTEROID-' + (state.bodies.filter(b => b.isAsteroid).length + 1).toString().padStart(2, '0'),
    mass, displayRadius: radius, color: 0xff5530, isAsteroid: true,
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
